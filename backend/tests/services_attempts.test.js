process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  recomputeAttempt,
  recomputeDuration,
  classifyMismatch,
  PERCENTAGE_EPSILON
} = require("../services/attempts");
const { GradingError } = require("../services/grading");
const {
  manifestRows,
  measuredManifestRows,
  fireAttempt,
  gasAttempt
} = require("./fixtures/attempts");

const FIRE_MODULE = { module_id: "fire-response", pass_threshold: 0.7 };
const GAS_MODULE = { module_id: "gas-leak", pass_threshold: 0.7 };

// manifest rows with the weights or critical flags a test wants
function rowsWith(overrides, rows) {
  return (rows || measuredManifestRows("fire-response")).map((row) =>
    Object.assign(row, overrides[row.checkpoint_id] || {})
  );
}

describe("Server side grading", () => {
  describe("the shipped manifest and its unmeasured spatial checkpoints", () => {
    // fire_exit_identification and gas_hazard_zone_recognition have no measured
    // angle, so the seed leaves them ungradeable. the gas one is required, so it
    // must show up as an ungradeable attempt, never a quiet pass. the fire one is
    // optional (team ruling), so it is stored as evidence and left out of the score.
    it("scores an unconfigured spatial checkpoint zero", () => {
      const result = recomputeAttempt(fireAttempt(), manifestRows("fire-response"), FIRE_MODULE);
      const exit = result.checkpoints.find((c) => c.checkpointId === "fire_exit_identification");

      assert.strictEqual(exit.score, 0);
      assert.strictEqual(exit.passed, 0);
      assert.strictEqual(exit.gradeReason, "not_gradeable");
    });

    it("leaves an optional unconfigured checkpoint out of the score instead of blocking", () => {
      const result = recomputeAttempt(fireAttempt(), manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.gradingStatus, "graded");
      assert.strictEqual(result.maxScore, 3, "exit weight is not counted");
      assert.strictEqual(result.percentage, 91.67, "decision 1 + aim 0.75 + evacuation 1 out of 3");
      assert.strictEqual(result.passed, true);
    });

    it("still marks the attempt ungradeable when a required rule is unconfigured", () => {
      const rows = manifestRows("fire-response").map((row) =>
        row.checkpoint_id === "fire_exit_identification" ? { ...row, required: 1 } : row
      );
      const result = recomputeAttempt(fireAttempt(), rows, FIRE_MODULE);
      assert.strictEqual(result.gradingStatus, "ungradeable");
      assert.strictEqual(result.percentage, 68.75, "0 + 1 + 0.75 + 1 out of 4");
      assert.strictEqual(result.passed, false);
    });

    it("does the same for the gas hazard zone", () => {
      const result = recomputeAttempt(gasAttempt(), manifestRows("gas-leak"), GAS_MODULE);
      assert.strictEqual(result.gradingStatus, "ungradeable");
    });
  });

  describe("recomputeAttempt with every rule configured", () => {
    it("reproduces the contract fire example exactly", () => {
      const result = recomputeAttempt(fireAttempt(), measuredManifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.totalScore, 3.75);
      assert.strictEqual(result.maxScore, 4);
      assert.strictEqual(result.percentage, 93.75);
      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.gradingStatus, "graded");
    });

    it("stamps the grader version onto the result", () => {
      const result = recomputeAttempt(fireAttempt(), measuredManifestRows("fire-response"), FIRE_MODULE);
      assert.match(result.graderVersion, /^\d+\.\d+\.\d+$/);
    });

    it("keeps the raw observation, not a derived number", () => {
      const result = recomputeAttempt(fireAttempt(), measuredManifestRows("fire-response"), FIRE_MODULE);
      const aim = result.checkpoints.find((c) => c.checkpointId === "fire_extinguisher_aim");
      const stored = JSON.parse(aim.observationJson);

      assert.strictEqual(stored.hitDistanceM, 0.2);
      assert.strictEqual(stored.kind, "aim_dwell");
      assert.ok(!("score" in stored) && !("accuracy" in stored), "no derived value may be stored as evidence");
    });

    it("reproduces the gas example with its partial PPE credit", () => {
      const result = recomputeAttempt(gasAttempt(), measuredManifestRows("gas-leak"), GAS_MODULE);
      const ppe = result.checkpoints.find((c) => c.checkpointId === "gas_ppe_selection");

      assert.strictEqual(ppe.score, 0.67, "two of three mandatory items");
      assert.strictEqual(ppe.passed, 0, "partial PPE is not a pass");
      assert.strictEqual(result.percentage, 89);
    });

    it("uses server weights, the payload has none to offer", () => {
      const result = recomputeAttempt(fireAttempt(), measuredManifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.maxScore, 4, "maxScore comes from the manifest");
    });

    it("uses the server threshold", () => {
      const strictModule = { module_id: "fire-response", pass_threshold: 0.95 };
      const result = recomputeAttempt(fireAttempt(), measuredManifestRows("fire-response"), strictModule);

      assert.strictEqual(result.thresholdApplied, 0.95);
      assert.strictEqual(result.passed, false, "93.75 percent must fail a 95 percent threshold");
    });

    it("honours a weighted manifest", () => {
      const rows = rowsWith({ fire_extinguisher_aim: { weight: 2 } });
      const result = recomputeAttempt(fireAttempt(), rows, FIRE_MODULE);

      assert.strictEqual(result.maxScore, 5);
      assert.strictEqual(result.totalScore, 4.5);
      assert.strictEqual(result.percentage, 90);
    });

    it("passes a run at exactly the threshold", () => {
      const payload = fireAttempt();
      // aim 0.32m of 0.8m is exactly 0.6, the aim pass mark
      payload.checkpoints[1].observation.hitDistanceM = 0.32;
      const rows = rowsWith(
        { fire_evacuation_sequence_marker: { weight: 0.4 } },
        measuredManifestRows("fire-response")
      );

      const result = recomputeAttempt(payload, rows, FIRE_MODULE);
      assert.strictEqual(result.thresholdApplied, 0.7);
      assert.ok(result.percentage >= 70, "boundary must be inclusive");
      assert.strictEqual(result.passed, true);
    });

    it("throws rather than guessing when a definition is missing", () => {
      const rows = measuredManifestRows("fire-response").filter(
        (r) => r.checkpoint_id !== "fire_extinguisher_aim"
      );
      assert.throws(() => recomputeAttempt(fireAttempt(), rows, FIRE_MODULE), GradingError);
    });
  });

  describe("critical checkpoints", () => {
    it("stays dormant while every critical checkpoint passes", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.hitDistanceM = null;

      const result = recomputeAttempt(payload, measuredManifestRows("fire-response"), FIRE_MODULE);
      assert.deepStrictEqual(result.criticalFailures, []);
      assert.strictEqual(result.percentage, 75, "exit 1 + decision 1 + aim 0 + evacuation 1 out of 4");
    });

    it("fails the whole module when a critical checkpoint fails", () => {
      const rows = rowsWith({ fire_extinguisher_aim: { critical: 1, weight: 0.1 } });
      const payload = fireAttempt();
      payload.checkpoints[1].observation.hitDistanceM = null;

      const result = recomputeAttempt(payload, rows, FIRE_MODULE);
      assert.deepStrictEqual(result.criticalFailures, ["fire_extinguisher_aim"]);
      assert.ok(result.percentage >= 70, "the aggregate would have passed");
      assert.strictEqual(result.passed, false, "a critical failure must sink the module anyway");
    });

    it("leaves a passing critical checkpoint alone", () => {
      const rows = rowsWith({ fire_extinguisher_aim: { critical: 1 } });
      const result = recomputeAttempt(fireAttempt(), rows, FIRE_MODULE);

      assert.deepStrictEqual(result.criticalFailures, []);
      assert.strictEqual(result.passed, true);
    });
  });

  describe("duration", () => {
    it("computes duration from the timestamps", () => {
      assert.strictEqual(
        recomputeDuration("2026-09-01T10:14:02.118Z", "2026-09-01T10:17:41.556Z"),
        219438
      );
    });
  });

  describe("mismatch classification", () => {
    it("sees no mismatch when the client agrees", () => {
      const payload = fireAttempt();
      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(classifyMismatch(payload, result), "none");
    });

    it("tolerates rounding drift inside the epsilon", () => {
      const payload = fireAttempt({ clientClaimedPercentage: 91.67 - PERCENTAGE_EPSILON / 2 });
      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(classifyMismatch(payload, result), "none");
    });

    it("calls a numbers only disagreement score_drift", () => {
      const payload = fireAttempt({ clientClaimedPercentage: 100 });
      const result = recomputeAttempt(payload, measuredManifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.passed, true);
      assert.strictEqual(classifyMismatch(payload, result), "score_drift");
    });

    it("calls a claimed pass the server failed claim_inflation", () => {
      const payload = fireAttempt({ clientClaimedPassed: true, clientClaimedPercentage: 91.67 });
      const strictModule = { module_id: "fire-response", pass_threshold: 0.95 };
      const result = recomputeAttempt(payload, measuredManifestRows("fire-response"), strictModule);

      assert.strictEqual(result.passed, false);
      assert.strictEqual(classifyMismatch(payload, result), "claim_inflation");
    });

    it("does not call a pessimistic client an inflation", () => {
      const payload = fireAttempt({ clientClaimedPassed: false, clientClaimedPercentage: 10 });
      const result = recomputeAttempt(payload, measuredManifestRows("fire-response"), FIRE_MODULE);

      assert.strictEqual(result.passed, true);
      assert.strictEqual(classifyMismatch(payload, result), "score_drift");
    });
  });
});
