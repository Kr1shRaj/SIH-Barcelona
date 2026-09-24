const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  validateAttemptContract,
  MAX_DURATION_MS,
  CLOCK_SKEW_TOLERANCE_MS
} = require("../models/attempt");
const { ValidationError, STRUCTURAL } = require("../models/errors");
const { FIXED_NOW, fireAttempt, gasAttempt, forgedV1Attempt } = require("./fixtures/attempts");

const AT = { now: FIXED_NOW };

// run the validator and hand back the ValidationError it threw
function failure(payload, options) {
  try {
    validateAttemptContract(payload, options || AT);
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected validation to fail, but it passed");
}

// true when some issue points at this field path
function hasIssueAt(err, path) {
  return err.issues.some((issue) => issue.path === path);
}

// true when some issue carries this code
function hasCode(err, code) {
  return err.issues.some((issue) => issue.code === code);
}

describe("Attempt contract — structural validation", () => {
  describe("golden fixtures", () => {
    it("accepts the Fire Response example from the contract", () => {
      const result = validateAttemptContract(fireAttempt(), AT);
      assert.strictEqual(result.attemptId, "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51");
      assert.strictEqual(result.checkpoints.length, 4);
    });

    it("accepts the Gas Leak example from the contract", () => {
      const result = validateAttemptContract(gasAttempt(), AT);
      assert.strictEqual(result.moduleId, "gas-leak");
      assert.deepStrictEqual(
        result.checkpoints[1].observation.selected,
        ["scba_respirator", "multi_gas_detector"],
        "the raw selection must survive untouched — the server grades it, not the phone"
      );
    });

    it("returns the parsed payload, not the raw input object", () => {
      const input = fireAttempt();
      const result = validateAttemptContract(input, AT);
      assert.notStrictEqual(result, input);
      assert.deepStrictEqual(result, input);
    });
  });

  describe("the forged v1 payload that earned a real certificate", () => {
    // this exact shape walked past the v1 server and got a signed cert with no
    // training behind it. it must never validate again.
    it("rejects the proven forgery outright", () => {
      const err = failure(forgedV1Attempt());
      assert.strictEqual(err.kind, STRUCTURAL);
      assert.ok(hasCode(err, "unsupported_contract_version"));
    });

    it("still rejects the forgery when it relabels itself as v2", () => {
      const err = failure(forgedV1Attempt({ contractVersion: "2.0" }));
      assert.strictEqual(err.kind, STRUCTURAL);
      assert.ok(
        hasCode(err, "unrecognized_keys") || hasCode(err, "invalid_type"),
        "a v1 body under a v2 label is still a v1 body"
      );
    });

    it("rejects the minimum lie — a bare passed flag", () => {
      const payload = fireAttempt({ passed: true });
      assert.ok(hasCode(failure(payload), "unrecognized_keys"));
    });
  });

  describe("contract versioning", () => {
    it("rejects an unknown contractVersion before anything else", () => {
      const err = failure(fireAttempt({ contractVersion: "9.9" }));
      assert.strictEqual(err.kind, STRUCTURAL);
      assert.ok(hasCode(err, "unsupported_contract_version"));
      assert.strictEqual(err.issues.length, 1, "version failure must not cascade into field noise");
      assert.match(err.issues[0].message, /this server speaks 2\.0/);
    });

    it("rejects contract v1.0, the version that let the client score itself", () => {
      const err = failure(fireAttempt({ contractVersion: "1.0" }));
      assert.ok(hasCode(err, "unsupported_contract_version"));
      assert.strictEqual(err.issues.length, 1);
    });

    it("rejects a missing contractVersion", () => {
      const payload = fireAttempt();
      delete payload.contractVersion;
      assert.ok(hasCode(failure(payload), "unsupported_contract_version"));
    });

    it("reports the version problem even when other fields are also broken", () => {
      const err = failure(fireAttempt({ contractVersion: "0.9", workerId: 42 }));
      assert.strictEqual(err.issues.length, 1);
      assert.strictEqual(err.issues[0].path, "contractVersion");
    });
  });

  describe("required fields", () => {
    const REQUIRED = [
      "attemptId", "workerId", "moduleId", "moduleVersion", "engineVersion",
      "deviceId", "arTier", "locale", "startedAt", "completedAt", "durationMs",
      "status", "checkpoints", "clientClaimedPercentage", "clientClaimedPassed"
    ];

    REQUIRED.forEach((field) => {
      it(`rejects a payload missing ${field}`, () => {
        const payload = fireAttempt();
        delete payload[field];
        assert.ok(hasIssueAt(failure(payload), field), `${field} must be reported`);
      });
    });
  });

  describe("field types and formats", () => {
    it("rejects a non-v4 attemptId", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ attemptId: "c232ab00-9414-11ec-b3c8-9f6bdeced846" })), "attemptId"));
    });

    it("rejects an uppercase moduleId", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ moduleId: "Fire-Response" })), "moduleId"));
    });

    it("rejects a status other than completed", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ status: "abandoned" })), "status"));
    });

    it("rejects an arTier outside the two supported tiers", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ arTier: 3 })), "arTier"));
    });

    it("rejects an empty checkpoints array", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ checkpoints: [] })), "checkpoints"));
    });

    it("rejects a durationMs beyond the four hour cap", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ durationMs: MAX_DURATION_MS + 1 })), "durationMs"));
    });

    it("rejects a negative durationMs", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ durationMs: -1 })), "durationMs"));
    });

    it("rejects a non-object payload", () => {
      assert.ok(hasCode(failure(null), "invalid_type"));
      assert.ok(hasCode(failure([]), "invalid_type"));
      assert.ok(hasCode(failure("nope"), "invalid_type"));
    });
  });

  describe("strict mode (decision B3)", () => {
    it("rejects an unknown top level key so a typo surfaces at integration", () => {
      const err = failure(fireAttempt({ certId: "CERT-1" }));
      assert.ok(hasCode(err, "unrecognized_keys"));
    });

    it("rejects an unknown key inside a checkpoint", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].bonusPoints = 5;
      assert.ok(hasCode(failure(payload), "unrecognized_keys"));
    });

    it("refuses a client supplied signature field", () => {
      assert.ok(hasCode(failure(fireAttempt({ signature: "abc" })), "unrecognized_keys"));
    });
  });

  describe("nothing the client scored may ride along", () => {
    const BANNED_TOP_LEVEL = ["passed", "score", "totalScore", "maxScore", "percentage", "passThresholdUsed"];

    BANNED_TOP_LEVEL.forEach((field) => {
      it(`rejects a top level ${field}`, () => {
        assert.ok(hasCode(failure(fireAttempt({ [field]: 1 })), "unrecognized_keys"));
      });
    });

    const BANNED_ON_CHECKPOINT = ["passed", "score", "weight", "type", "context", "timestamp"];

    BANNED_ON_CHECKPOINT.forEach((field) => {
      it(`rejects ${field} on a checkpoint`, () => {
        const payload = fireAttempt();
        payload.checkpoints[0][field] = 1;
        assert.ok(hasCode(failure(payload), "unrecognized_keys"));
      });
    });

    const BANNED_IN_OBSERVATION = ["accuracy", "score", "correct", "correctOption", "selectedOption", "passed"];

    BANNED_IN_OBSERVATION.forEach((field) => {
      it(`rejects ${field} inside an observation`, () => {
        const payload = fireAttempt();
        payload.checkpoints[2].observation[field] = "sound_alarm_then_evacuate";
        assert.ok(hasCode(failure(payload), "unrecognized_keys"));
      });
    });
  });

  describe("observation shapes", () => {
    it("rejects an unknown observation kind", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].observation = { kind: "telepathy", selected: "x" };
      assert.ok(hasIssueAt(failure(payload), "checkpoints.0.observation.kind"));
    });

    it("rejects a missing observation", () => {
      const payload = fireAttempt();
      delete payload.checkpoints[0].observation;
      assert.ok(hasIssueAt(failure(payload), "checkpoints.0.observation"));
    });

    it("rejects an angular error beyond half a turn", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].observation.angularErrorRad = Math.PI + 0.1;
      assert.ok(hasIssueAt(failure(payload), "checkpoints.0.observation.angularErrorRad"));
    });

    it("rejects a negative angular error", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].observation.angularErrorRad = -0.1;
      assert.ok(hasIssueAt(failure(payload), "checkpoints.0.observation.angularErrorRad"));
    });

    it("rejects a negative hit distance", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.hitDistanceM = -1;
      assert.ok(hasIssueAt(failure(payload), "checkpoints.1.observation.hitDistanceM"));
    });

    it("accepts a null hit distance, that is how a button fallback reports itself", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.hitDistanceM = null;
      assert.doesNotThrow(() => validateAttemptContract(payload, AT));
    });

    it("rejects a sweep coverage above 1", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.sweepCoverage = 1.5;
      assert.ok(hasIssueAt(failure(payload), "checkpoints.1.observation.sweepCoverage"));
    });

    it("rejects a tracking source the contract does not name", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.trackingSource = "vibes";
      assert.ok(hasIssueAt(failure(payload), "checkpoints.1.observation.trackingSource"));
    });

    it("accepts a declared none tracking source, the grader is what refuses it", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.trackingSource = "none";
      assert.doesNotThrow(() => validateAttemptContract(payload, AT));
    });

    it("rejects a fractional frame count", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observation.frameCount = 3.5;
      assert.ok(hasIssueAt(failure(payload), "checkpoints.1.observation.frameCount"));
    });
  });

  describe("checkpoint rules", () => {
    it("rejects a duplicate checkpoint instead of silently collapsing it", () => {
      const payload = fireAttempt();
      payload.checkpoints.push(JSON.parse(JSON.stringify(payload.checkpoints[0])));

      const err = failure(payload);
      assert.ok(hasIssueAt(err, "checkpoints.4.checkpointId"));
      assert.match(err.issues.find((i) => i.path === "checkpoints.4.checkpointId").message, /duplicate checkpoint/);
    });
  });

  describe("timestamps", () => {
    it("rejects completedAt earlier than startedAt", () => {
      const err = failure(fireAttempt({ completedAt: "2026-09-01T10:00:00.000Z" }));
      assert.ok(hasIssueAt(err, "completedAt"));
    });

    it("accepts an instantaneous attempt where the two timestamps match", () => {
      const payload = fireAttempt({
        startedAt: "2026-09-01T10:14:02.118Z",
        completedAt: "2026-09-01T10:14:02.118Z",
        durationMs: 0
      });
      payload.checkpoints.forEach((c) => { c.observedAt = "2026-09-01T10:14:02.118Z"; });
      assert.doesNotThrow(() => validateAttemptContract(payload, AT));
    });

    it("rejects a checkpoint fired before the attempt started", () => {
      const payload = fireAttempt();
      payload.checkpoints[0].observedAt = "2026-09-01T09:00:00.000Z";
      assert.ok(hasIssueAt(failure(payload), "checkpoints.0.observedAt"));
    });

    it("rejects a checkpoint fired after the attempt completed", () => {
      const payload = fireAttempt();
      payload.checkpoints[1].observedAt = "2026-09-01T23:00:00.000Z";
      assert.ok(hasIssueAt(failure(payload), "checkpoints.1.observedAt"));
    });

    it("rejects an impossible calendar date", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ startedAt: "2026-02-31T10:14:02.118Z" })), "startedAt"));
    });
  });

  describe("clock skew (decision B4)", () => {
    it("accepts an attempt completed just inside the tolerance", () => {
      const now = Date.parse("2026-09-01T10:17:41.556Z") - (CLOCK_SKEW_TOLERANCE_MS - 1000);
      assert.doesNotThrow(() => validateAttemptContract(fireAttempt(), { now }));
    });

    it("rejects an attempt completed beyond the tolerance", () => {
      const now = Date.parse("2026-09-01T10:17:41.556Z") - (CLOCK_SKEW_TOLERANCE_MS + 1000);
      const err = failure(fireAttempt(), { now });
      assert.ok(hasCode(err, "future_timestamp"));
    });

    it("uses an injected clock so the result never depends on the wall clock", () => {
      const early = Date.parse("2026-01-01T00:00:00.000Z");
      assert.ok(hasCode(failure(fireAttempt(), { now: early }), "future_timestamp"));
      assert.doesNotThrow(() => validateAttemptContract(fireAttempt(), { now: FIXED_NOW }));
    });
  });

  describe("client claims are evidence, not gospel", () => {
    // if a bad claim were rejected here, a tampered payload would never reach the
    // database and the mismatch could never be recorded
    it("accepts a claimed pass the observations do not support", () => {
      const payload = fireAttempt({ clientClaimedPercentage: 100, clientClaimedPassed: true });
      payload.checkpoints[2].observation.selected = "use_elevator";
      assert.doesNotThrow(() => validateAttemptContract(payload, AT));
    });

    it("accepts a durationMs that does not match the timestamps", () => {
      assert.doesNotThrow(() => validateAttemptContract(fireAttempt({ durationMs: 5 }), AT));
    });

    it("still enforces ranges on those claims", () => {
      assert.ok(hasIssueAt(failure(fireAttempt({ clientClaimedPercentage: 140 })), "clientClaimedPercentage"));
      assert.ok(hasIssueAt(failure(fireAttempt({ clientClaimedPassed: "yes" })), "clientClaimedPassed"));
    });
  });
});
