const { createChildLogger } = require("../logger");
const { gradeCheckpoint, GRADER_VERSION, GRADING_ERRORS, GradingError } = require("./grading");

const log = createChildLogger({ component: "attempts" });

// client percentage is rounded on the phone, so compare with a tolerance instead
// of exactly. 2.75/3*100 is 91.6666..., the engine sends 91.67, both are right.
const PERCENTAGE_EPSILON = 0.01;

// score the whole attempt from server held rules, weights and threshold.
// the payload carries raw observations only — there is no client score to trust.
function recomputeAttempt(attempt, definitions, moduleRow) {
  const byId = new Map(definitions.map((row) => [row.checkpoint_id, row]));

  let totalScore = 0;
  let maxScore = 0;
  let everyCheckpointGradeable = true;
  const criticalFailures = [];
  const checkpoints = [];

  attempt.checkpoints.forEach((checkpoint) => {
    const definitionRow = byId.get(checkpoint.checkpointId);

    // the manifest check runs first and catches this, so reaching here is a bug
    if (!definitionRow) {
      throw new GradingError(
        GRADING_ERRORS.DEFINITION_INVALID,
        `no checkpoint definition for "${checkpoint.checkpointId}"`,
        checkpoint.checkpointId
      );
    }

    // weight always comes from the manifest, never from the payload
    const weight = definitionRow.weight;
    const graded = gradeCheckpoint(checkpoint.observation, definitionRow);

    // one unconfigured rule makes the whole attempt uncertifiable, not partly scored
    if (!graded.gradeable) {
      everyCheckpointGradeable = false;
    }

    totalScore += graded.score * weight;
    maxScore += weight;

    // a failed critical checkpoint sinks the whole module whatever the average says.
    // every seeded critical is 0, so this is wired but dormant until the team rules.
    if (definitionRow.critical === 1 && !graded.passed) {
      criticalFailures.push(checkpoint.checkpointId);
    }

    checkpoints.push({
      checkpointId: checkpoint.checkpointId,
      checkpointType: definitionRow.checkpoint_type,
      observationKind: checkpoint.observation.kind,
      observationJson: JSON.stringify(checkpoint.observation),
      score: graded.score,
      passed: graded.passed ? 1 : 0,
      gradeReason: graded.reason,
      weight,
      clientTs: checkpoint.observedAt
    });
  });

  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100 * 100) / 100 : 0;

  // threshold is the server one, the phone never gets a say
  const threshold = moduleRow.pass_threshold;
  const meetsThreshold = percentage / 100 >= threshold;
  const passed = meetsThreshold && criticalFailures.length === 0;

  return {
    totalScore: Math.round(totalScore * 1e6) / 1e6,
    maxScore: Math.round(maxScore * 1e6) / 1e6,
    percentage,
    passed,
    thresholdApplied: threshold,
    gradingStatus: everyCheckpointGradeable ? "graded" : "ungradeable",
    graderVersion: GRADER_VERSION,
    criticalFailures,
    checkpoints
  };
}

// server owns the clock maths too, the client durationMs never gets stored
function recomputeDuration(startedAt, completedAt) {
  return Date.parse(completedAt) - Date.parse(startedAt);
}

// how badly did the phone and the server disagree.
// claim_inflation is a security signal, score_drift is float noise.
function classifyMismatch(attempt, recomputed) {
  if (attempt.clientClaimedPassed === true && recomputed.passed === false) {
    return "claim_inflation";
  }

  const drift = Math.abs(attempt.clientClaimedPercentage - recomputed.percentage);
  if (drift > PERCENTAGE_EPSILON || attempt.clientClaimedPassed !== recomputed.passed) {
    return "score_drift";
  }

  return "none";
}

// write one attempt and its checkpoints, report back what happened.
// replaying an attempt id is a normal path, not an error.
function ingestAttempt(db, { attempt, definitions, moduleRow, batchId, receivedAt }) {
  const existing = db
    .prepare(
      "SELECT server_total_score, server_percentage, server_passed, grading_status FROM attempt WHERE attempt_id = ?"
    )
    .get(attempt.attemptId);

  if (existing) {
    log.info({ event: "attempt_duplicate", attemptId: attempt.attemptId }, "Attempt already stored, replay ignored");
    return {
      status: "duplicate",
      serverScore: existing.server_total_score,
      serverPercentage: existing.server_percentage,
      serverPassed: existing.server_passed === 1,
      gradingStatus: existing.grading_status,
      certificateEligible: existing.server_passed === 1 && existing.grading_status === "graded"
    };
  }

  const recomputed = recomputeAttempt(attempt, definitions, moduleRow);
  const durationMs = recomputeDuration(attempt.startedAt, attempt.completedAt);
  const mismatchKind = classifyMismatch(attempt, recomputed);

  const insertAttempt = db.prepare(
    `INSERT INTO attempt (
       attempt_id, worker_id, module_id, module_version, contract_version,
       engine_version, device_id, ar_tier, locale,
       started_at, completed_at, duration_ms, status,
       grading_status, grader_version, graded_at,
       server_total_score, server_max_score, server_percentage, server_passed, threshold_applied,
       client_percentage, client_passed, client_claim_mismatch, mismatch_kind,
       sync_batch_id, server_received_at
     ) VALUES (
       @attempt_id, @worker_id, @module_id, @module_version, @contract_version,
       @engine_version, @device_id, @ar_tier, @locale,
       @started_at, @completed_at, @duration_ms, @status,
       @grading_status, @grader_version, @graded_at,
       @server_total_score, @server_max_score, @server_percentage, @server_passed, @threshold_applied,
       @client_percentage, @client_passed, @client_claim_mismatch, @mismatch_kind,
       @sync_batch_id, @server_received_at
     ) ON CONFLICT(attempt_id) DO NOTHING`
  );

  const insertCheckpoint = db.prepare(
    `INSERT INTO checkpoint_result
       (attempt_id, checkpoint_id, checkpoint_type, observation_kind, observation_json,
        server_score, server_passed, grade_reason, weight, client_claimed_passed, client_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(attempt_id, checkpoint_id) DO NOTHING`
  );

  // one transaction per attempt, so a bad record cannot roll back its neighbours
  const write = db.transaction(() => {
    const info = insertAttempt.run({
      attempt_id: attempt.attemptId,
      worker_id: attempt.workerId,
      module_id: attempt.moduleId,
      module_version: attempt.moduleVersion,
      contract_version: attempt.contractVersion,
      engine_version: attempt.engineVersion,
      device_id: attempt.deviceId,
      ar_tier: attempt.arTier,
      locale: attempt.locale,
      started_at: attempt.startedAt,
      completed_at: attempt.completedAt,
      duration_ms: durationMs,
      status: attempt.status,
      grading_status: recomputed.gradingStatus,
      grader_version: recomputed.graderVersion,
      graded_at: receivedAt,
      server_total_score: recomputed.totalScore,
      server_max_score: recomputed.maxScore,
      server_percentage: recomputed.percentage,
      server_passed: recomputed.passed ? 1 : 0,
      threshold_applied: recomputed.thresholdApplied,
      client_percentage: attempt.clientClaimedPercentage,
      client_passed: attempt.clientClaimedPassed ? 1 : 0,
      client_claim_mismatch: mismatchKind === "none" ? 0 : 1,
      mismatch_kind: mismatchKind,
      sync_batch_id: batchId,
      server_received_at: receivedAt
    });

    // lost a race with an identical concurrent insert, treat it as the replay it is
    if (info.changes === 0) {
      return false;
    }

    recomputed.checkpoints.forEach((cp) => {
      insertCheckpoint.run(
        attempt.attemptId,
        cp.checkpointId,
        cp.checkpointType,
        cp.observationKind,
        cp.observationJson,
        cp.score,
        cp.passed,
        cp.gradeReason,
        cp.weight,
        null,
        cp.clientTs
      );
    });
    return true;
  });

  const inserted = write();

  if (!inserted) {
    return {
      status: "duplicate",
      serverScore: recomputed.totalScore,
      serverPercentage: recomputed.percentage,
      serverPassed: recomputed.passed,
      gradingStatus: recomputed.gradingStatus,
      certificateEligible: recomputed.passed && recomputed.gradingStatus === "graded"
    };
  }

  if (mismatchKind === "claim_inflation") {
    log.warn(
      {
        event: "client_claim_inflation",
        attemptId: attempt.attemptId,
        deviceId: attempt.deviceId,
        clientPercentage: attempt.clientClaimedPercentage,
        serverPercentage: recomputed.percentage,
        clientPassed: attempt.clientClaimedPassed,
        serverPassed: recomputed.passed
      },
      "Client claimed a pass the server did not grade"
    );
  } else if (mismatchKind === "score_drift") {
    log.info(
      {
        event: "client_claim_drift",
        attemptId: attempt.attemptId,
        clientPercentage: attempt.clientClaimedPercentage,
        serverPercentage: recomputed.percentage
      },
      "Client score claim drifted from server grading"
    );
  }

  if (recomputed.gradingStatus === "ungradeable") {
    log.warn(
      {
        event: "attempt_ungradeable",
        attemptId: attempt.attemptId,
        moduleId: attempt.moduleId
      },
      "Attempt stored but a checkpoint rule is not configured, so it cannot certify"
    );
  }

  if (recomputed.criticalFailures.length > 0) {
    log.warn(
      {
        event: "critical_checkpoint_failed",
        attemptId: attempt.attemptId,
        checkpoints: recomputed.criticalFailures
      },
      "Attempt failed a critical checkpoint"
    );
  }

  return {
    status: "accepted",
    serverScore: recomputed.totalScore,
    serverPercentage: recomputed.percentage,
    serverPassed: recomputed.passed,
    gradingStatus: recomputed.gradingStatus,
    mismatchKind,
    clientClaimMismatch: mismatchKind !== "none",
    certificateEligible: recomputed.passed && recomputed.gradingStatus === "graded"
  };
}

// record the envelope itself so a replayed batch stays traceable
function recordSyncBatch(db, { batchId, workerId, deviceId, receivedAt, attemptCount }) {
  db.prepare(
    `INSERT INTO sync_batch (batch_id, worker_id, device_id, received_at, attempt_count, status)
     VALUES (?, ?, ?, ?, ?, 'accepted')
     ON CONFLICT(batch_id) DO NOTHING`
  ).run(batchId, workerId, deviceId, receivedAt, attemptCount);
}

module.exports = {
  recomputeAttempt,
  recomputeDuration,
  classifyMismatch,
  ingestAttempt,
  recordSyncBatch,
  PERCENTAGE_EPSILON
};
