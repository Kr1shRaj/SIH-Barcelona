const { describe, it } = require("node:test");
const assert = require("node:assert");
const { validateSyncPayload, MAX_BATCH_ATTEMPTS } = require("../models/sync");
const { ValidationError, STRUCTURAL } = require("../models/errors");
const { FIXED_NOW, fireAttempt, gasAttempt, syncEnvelope, clone } = require("./fixtures/attempts");

const AT = { now: FIXED_NOW };

// run the validator and hand back the ValidationError it threw
function failure(payload) {
  try {
    validateSyncPayload(payload, AT);
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected validation to fail, but it passed");
}

function hasIssueAt(err, path) {
  return err.issues.some((issue) => issue.path === path);
}

// build n attempts with distinct ids so nothing trips the duplicate rules
function manyAttempts(n) {
  const list = [];
  for (let i = 0; i < n; i += 1) {
    const hex = i.toString(16).padStart(12, "0");
    list.push(fireAttempt({ attemptId: `a3f1c9e2-5b47-4d18-9e6a-${hex}` }));
  }
  return list;
}

describe("Sync envelope validation", () => {
  describe("happy path", () => {
    it("accepts an envelope carrying one attempt", () => {
      const result = validateSyncPayload(syncEnvelope(), AT);
      assert.strictEqual(result.attempts.length, 1);
      assert.strictEqual(result.batchId, "b71e0c93-4a2f-4d55-8e10-6f3c9d2a7b48");
    });

    it("accepts a mixed batch of both modules", () => {
      const result = validateSyncPayload(syncEnvelope([fireAttempt(), gasAttempt()]), AT);
      assert.strictEqual(result.attempts.length, 2);
      assert.strictEqual(result.attempts[1].moduleId, "gas-leak");
    });

    it("accepts a full batch at the cap", () => {
      const result = validateSyncPayload(syncEnvelope(manyAttempts(MAX_BATCH_ATTEMPTS)), AT);
      assert.strictEqual(result.attempts.length, MAX_BATCH_ATTEMPTS);
    });

    it("returns parsed attempts rather than the raw input", () => {
      const envelope = syncEnvelope();
      const result = validateSyncPayload(envelope, AT);
      assert.notStrictEqual(result.attempts[0], envelope.attempts[0]);
      assert.deepStrictEqual(result.attempts[0], envelope.attempts[0]);
    });
  });

  describe("envelope shape", () => {
    it("rejects a non-object payload", () => {
      assert.ok(failure(null).issues.length > 0);
      assert.ok(failure([]).issues.length > 0);
    });

    it("rejects a missing batchId", () => {
      const envelope = syncEnvelope();
      delete envelope.batchId;
      assert.ok(hasIssueAt(failure(envelope), "batchId"));
    });

    it("rejects a batchId that is not a v4 uuid", () => {
      assert.ok(hasIssueAt(failure(syncEnvelope(undefined, { batchId: "batch-1" })), "batchId"));
    });

    it("rejects a missing deviceId and workerId", () => {
      const envelope = syncEnvelope();
      delete envelope.deviceId;
      delete envelope.workerId;
      const err = failure(envelope);
      assert.ok(hasIssueAt(err, "deviceId"));
      assert.ok(hasIssueAt(err, "workerId"));
    });

    it("rejects a malformed sentAt", () => {
      assert.ok(hasIssueAt(failure(syncEnvelope(undefined, { sentAt: "2026-09-01" })), "sentAt"));
    });

    it("rejects an unknown envelope key", () => {
      assert.ok(failure(syncEnvelope(undefined, { retryCount: 3 })).issues.length > 0);
    });
  });

  describe("batch size (decision B6)", () => {
    it("rejects an empty attempts array — an empty flush is a client bug", () => {
      assert.ok(hasIssueAt(failure(syncEnvelope([])), "attempts"));
    });

    it("rejects a batch over the cap", () => {
      const err = failure(syncEnvelope(manyAttempts(MAX_BATCH_ATTEMPTS + 1)));
      assert.ok(hasIssueAt(err, "attempts"));
    });

    it("caps at fifty, matching the contract", () => {
      assert.strictEqual(MAX_BATCH_ATTEMPTS, 50);
    });
  });

  describe("per-attempt failures carry their batch index", () => {
    it("names the index of the bad attempt", () => {
      const bad = fireAttempt({ attemptId: "not-a-uuid" });
      const err = failure(syncEnvelope([fireAttempt(), bad]));
      assert.ok(hasIssueAt(err, "attempts.1.attemptId"), `paths were ${err.issues.map((i) => i.path).join(", ")}`);
    });

    it("reports problems from several attempts at once", () => {
      const err = failure(
        syncEnvelope([
          fireAttempt({ attemptId: "nope" }),
          fireAttempt(),
          gasAttempt({ status: "abandoned" })
        ])
      );
      assert.ok(hasIssueAt(err, "attempts.0.attemptId"));
      assert.ok(hasIssueAt(err, "attempts.2.status"));
    });

    it("surfaces a version mismatch against the offending attempt", () => {
      const err = failure(syncEnvelope([fireAttempt({ contractVersion: "0.1" })]));
      assert.ok(hasIssueAt(err, "attempts.0.contractVersion"));
      assert.strictEqual(err.kind, STRUCTURAL);
    });

    it("surfaces a leaked answer key against the offending checkpoint", () => {
      const payload = fireAttempt();
      payload.checkpoints[2].context.correct = "sound_alarm_then_evacuate";
      const err = failure(syncEnvelope([payload]));
      assert.ok(hasIssueAt(err, "attempts.0.checkpoints.2.context"));
    });

    it("applies the injected clock to every attempt in the batch", () => {
      const early = Date.parse("2026-01-01T00:00:00.000Z");
      try {
        validateSyncPayload(syncEnvelope(), { now: early });
        assert.fail("expected a clock skew rejection");
      } catch (err) {
        assert.ok(err.issues.some((i) => i.code === "future_timestamp"));
      }
    });
  });

  describe("isolation", () => {
    it("does not mutate the input envelope", () => {
      const envelope = syncEnvelope();
      const before = clone(envelope);
      validateSyncPayload(envelope, AT);
      assert.deepStrictEqual(envelope, before);
    });
  });
});
