const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "attempts" });

// client percentage is rounded on the phone, so compare with a tolerance instead
// of exactly. 2.75/3*100 is 91.6666..., the engine sends 91.67, both are right.
const PERCENTAGE_EPSILON = 0.01;

// clamp any number into the 0..1 a checkpoint score has to live in
function _clamp01(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

// contract score rule: context.score, then context.accuracy, then plain pass or fail.
// order matters, do not swap these two without changing the contract first.
function recomputeCheckpointScore(context, passed) {
  const ctx = context && typeof context === "object" ? context : {};

  const fromScore = _clamp01(ctx.score);
  if (fromScore !== null) {
    return fromScore;
  }

  const fromAccuracy = _clamp01(ctx.accuracy);
  if (fromAccuracy !== null) {
    return fromAccuracy;
  }

  return passed ? 1 : 0;
}

// score the whole attempt from server held weights and threshold.
// nothing the client claimed is trusted here, it only gets compared afterwards.
function recomputeAttempt(attempt, definitions, moduleRow) {
  const byId = new Map(definitions.map((row) => [row.checkpoint_id, row]));

  let totalScore = 0;
  let maxScore = 0;
  const criticalFailures = [];
  const checkpoints = [];

  attempt.checkpoints.forEach((checkpoint) => {
    const definition = byId.get(checkpoint.checkpointId);
    // weight always comes from the manifest, never from the payload
    const weight = definition ? definition.weight : 1;
    const score = recomputeCheckpointScore(checkpoint.context, checkpoint.passed);

    totalScore += score * weight;
    maxScore += weight;

    // a failed critical checkpoint sinks the whole module whatever the average says.
    // every seeded critical is 0, so this is wired but dormant until the team rules.
    if (definition && definition.critical === 1 && !checkpoint.passed) {
      criticalFailures.push(checkpoint.checkpointId);
    }

    checkpoints.push({
      checkpointId: checkpoint.checkpointId,
      checkpointType: checkpoint.type,
      passed: checkpoint.passed ? 1 : 0,
      score,
      weight,
      contextJson: JSON.stringify(checkpoint.context || {}),
      clientTs: checkpoint.timestamp
    });
  });

  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100 * 100) / 100 : 0;

  // threshold is the server one, passThresholdUsed from the phone is only evidence
  const threshold = moduleRow.pass_threshold;
  const meetsThreshold = percentage / 100 >= threshold;
  const passed = meetsThreshold && criticalFailures.length === 0;

  return {
    totalScore: Math.round(totalScore * 1e6) / 1e6,
    maxScore: Math.round(maxScore * 1e6) / 1e6,
    percentage,
    passed,
    thresholdApplied: threshold,
    criticalFailures,
    checkpoints
  };
}

// server owns the clock maths too, the client durationMs never gets stored
function recomputeDuration(startedAt, completedAt) {
  return Date.parse(completedAt) - Date.parse(startedAt);
}

// did the phone and the server land on the same answer
function detectClaimMismatch(attempt, recomputed) {
  const percentageDrift = Math.abs(attempt.percentage - recomputed.percentage);
  return percentageDrift > PERCENTAGE_EPSILON || attempt.passed !== recomputed.passed;
}

// write one attempt and its checkpoints, report back what happened.
// replaying an attempt id is a normal path, not an error.
function ingestAttempt(db, { attempt, definitions, moduleRow, batchId, receivedAt }) {
  const existing = db
    .prepare("SELECT server_total_score, server_percentage, server_passed FROM attempt WHERE attempt_id = ?")
    .get(attempt.attemptId);

  if (existing) {
    log.info({ event: "attempt_duplicate", attemptId: attempt.attemptId }, "Attempt already stored, replay ignored");
    return {
      status: "duplicate",
      serverScore: existing.server_total_score,
      serverPercentage: existing.server_percentage,
      serverPassed: existing.server_passed === 1,
      certificateEligible: existing.server_passed === 1
    };
  }

  const recomputed = recomputeAttempt(attempt, definitions, moduleRow);
  const durationMs = recomputeDuration(attempt.startedAt, attempt.completedAt);
  const mismatch = detectClaimMismatch(attempt, recomputed);

  const insertAttempt = db.prepare(
    `INSERT INTO attempt (
       attempt_id, worker_id, module_id, module_version, contract_version,
       engine_version, device_id, ar_tier, locale,
       started_at, completed_at, duration_ms, status,
       server_total_score, server_max_score, server_percentage, server_passed, threshold_applied,
       client_percentage, client_passed, client_claim_mismatch,
       sync_batch_id, server_received_at
     ) VALUES (
       @attempt_id, @worker_id, @module_id, @module_version, @contract_version,
       @engine_version, @device_id, @ar_tier, @locale,
       @started_at, @completed_at, @duration_ms, @status,
       @server_total_score, @server_max_score, @server_percentage, @server_passed, @threshold_applied,
       @client_percentage, @client_passed, @client_claim_mismatch,
       @sync_batch_id, @server_received_at
     ) ON CONFLICT(attempt_id) DO NOTHING`
  );

  const insertCheckpoint = db.prepare(
    `INSERT INTO checkpoint_result
       (attempt_id, checkpoint_id, checkpoint_type, passed, score, weight, context_json, client_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
      server_total_score: recomputed.totalScore,
      server_max_score: recomputed.maxScore,
      server_percentage: recomputed.percentage,
      server_passed: recomputed.passed ? 1 : 0,
      threshold_applied: recomputed.thresholdApplied,
      client_percentage: attempt.percentage,
      client_passed: attempt.passed ? 1 : 0,
      client_claim_mismatch: mismatch ? 1 : 0,
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
        cp.passed,
        cp.score,
        cp.weight,
        cp.contextJson,
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
      certificateEligible: recomputed.passed
    };
  }

  if (mismatch) {
    log.warn(
      {
        event: "client_claim_mismatch",
        attemptId: attempt.attemptId,
        clientPercentage: attempt.percentage,
        serverPercentage: recomputed.percentage,
        clientPassed: attempt.passed,
        serverPassed: recomputed.passed
      },
      "Client score claim disagrees with server recomputation"
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
    clientClaimMismatch: mismatch,
    certificateEligible: recomputed.passed
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
  recomputeCheckpointScore,
  recomputeAttempt,
  recomputeDuration,
  detectClaimMismatch,
  ingestAttempt,
  recordSyncBatch,
  PERCENTAGE_EPSILON
};
