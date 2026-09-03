process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  recomputeCheckpointScore,
  recomputeAttempt,
  recomputeDuration,
  detectClaimMismatch,
  PERCENTAGE_EPSILON
} = require("../services/attempts");
const { manifestRows, fireAttempt } = require("./fixtures/attempts");

const FIRE_MODULE = { module_id: "fire-response", pass_threshold: 0.7 };

// manifest rows with the weights or critical flags a test wants
function rowsWith(overrides) {
  return manifestRows("fire-response").map((row) => Object.assign(row, overrides[row.checkpoint_id] || {}));
}

describe("Score recomputation", () => {
  describe("recomputeCheckpointScore precedence", () => {
    it("prefers context.score above everything else", () => {
      assert.strictEqual(recomputeCheckpointScore({ score: 0.2, accuracy: 0.9 }, true), 0.2);
    });

    it("falls back to context.accuracy when there is no score", () => {
      assert.strictEqual(recomputeCheckpointScore({ accuracy: 0.75 }, true), 0.75);
    });

    it("falls back to the pass flag when the context carries neither", () => {
      assert.strictEqual(recomputeCheckpointScore({ method: "button_confirm" }, true), 1);
      assert.strictEqual(recomputeCheckpointScore({ method: "button_confirm" }, false), 0);
    });

    it("survives a missing or junk context", () => {
      assert.strictEqual(recomputeCheckpointScore(null, true), 1);
      assert.strictEqual(recomputeCheckpointScore(undefined, false), 0);
      assert.strictEqual(recomputeCheckpointScore("nope", true), 1);
    });

    it("clamps a score outside 0..1 rather than trusting it", () => {
      assert.strictEqual(recomputeCheckpointScore({ score: 5 }, true), 1);
      assert.strictEqual(recomputeCheckpointScore({ score: -3 }, true), 0);
    });

    it("ignores NaN and Infinity and drops through to the next rule", () => {
      assert.strictEqual(recomputeCheckpointScore({ score: NaN, accuracy: 0.4 }, true), 0.4);
      assert.strictEqual(recomputeCheckpointScore({ score: Infinity, accuracy: 0.4 }, true), 0.4);
    });
  });

  describe("recomputeAttempt", () => {
    it("reproduces the contract fire example exactly", () => {
      const result = recomputeAttempt(fireAttempt(), manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.totalScore, 2.75);
      assert.strictEqual(result.maxScore, 3);
      assert.strictEqual(result.percentage, 91.67);
      assert.strictEqual(result.passed, true);
    });

    it("uses server weights and ignores whatever the payload claimed", () => {
      const payload = fireAttempt();
      // client insists every checkpoint is worth 99
      payload.checkpoints.forEach((cp) => { cp.weight = 99; });

      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.maxScore, 3, "maxScore must come from the manifest, not the payload");
    });

    it("uses the server threshold and ignores the client one", () => {
      const payload = fireAttempt({ passThresholdUsed: 0.01 });
      const strictModule = { module_id: "fire-response", pass_threshold: 0.95 };

      const result = recomputeAttempt(payload, manifestRows("fire-response"), strictModule);
      assert.strictEqual(result.thresholdApplied, 0.95);
      assert.strictEqual(result.passed, false, "91.67 percent must fail a 95 percent threshold");
    });

    it("recomputes the score from context and ignores a lying checkpoint score", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].score = 1;

      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.percentage, 91.67, "accuracy 0.75 in context must win over the claimed 1");
    });

    it("honours a weighted manifest", () => {
      const rows = rowsWith({ fire_extinguisher_aim: { weight: 2 } });
      const result = recomputeAttempt(fireAttempt(), rows, FIRE_MODULE);

      assert.strictEqual(result.maxScore, 4);
      assert.strictEqual(result.totalScore, 3.5);
      assert.strictEqual(result.percentage, 87.5);
    });

    it("passes a run at exactly the threshold", () => {
      const payload = fireAttempt();
      payload.checkpoints.forEach((cp) => { cp.context = { score: 0.7 }; });

      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(result.percentage, 70);
      assert.strictEqual(result.passed, true, "boundary must be inclusive");
    });
  });

  describe("critical checkpoints", () => {
    it("stays dormant while every manifest critical flag is 0", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].passed = false;

      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.deepStrictEqual(result.criticalFailures, []);
      assert.strictEqual(result.passed, true, "aggregate scoring still rules while nothing is critical");
    });

    it("fails the whole module when a critical checkpoint fails", () => {
      const rows = rowsWith({ fire_extinguisher_aim: { critical: 1 } });
      const payload = fireAttempt();
      payload.checkpoints[1].passed = false;

      const result = recomputeAttempt(payload, rows, FIRE_MODULE);
      assert.deepStrictEqual(result.criticalFailures, ["fire_extinguisher_aim"]);
      assert.strictEqual(result.passed, false, "a critical failure must sink the module whatever the average");
      assert.ok(result.percentage >= 70, "and it must do so even though the aggregate passed");
    });

    it("leaves a passing critical checkpoint alone", () => {
      const rows = rowsWith({ fire_extinguisher_aim: { critical: 1 } });
      const result = recomputeAttempt(fireAttempt(), rows, FIRE_MODULE);

      assert.deepStrictEqual(result.criticalFailures, []);
      assert.strictEqual(result.passed, true);
    });
  });

  describe("duration and mismatch", () => {
    it("computes duration from the timestamps", () => {
      assert.strictEqual(
        recomputeDuration("2026-09-01T10:14:02.118Z", "2026-09-01T10:17:41.556Z"),
        219438
      );
    });

    it("sees no mismatch when the client agrees", () => {
      const payload = fireAttempt();
      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(detectClaimMismatch(payload, result), false);
    });

    it("tolerates rounding drift inside the epsilon", () => {
      const payload = fireAttempt({ percentage: 91.67 - PERCENTAGE_EPSILON / 2 });
      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(detectClaimMismatch(payload, result), false);
    });

    it("flags a percentage claim beyond the epsilon", () => {
      const payload = fireAttempt({ percentage: 100 });
      const result = recomputeAttempt(payload, manifestRows("fire-response"), FIRE_MODULE);
      assert.strictEqual(detectClaimMismatch(payload, result), true);
    });

    it("flags a pass claim the scores do not support", () => {
      const payload = fireAttempt({ passed: true, percentage: 91.67 });
      const strictModule = { module_id: "fire-response", pass_threshold: 0.95 };
      const result = recomputeAttempt(payload, manifestRows("fire-response"), strictModule);

      assert.strictEqual(result.passed, false);
      assert.strictEqual(detectClaimMismatch(payload, result), true);
    });
  });
});
