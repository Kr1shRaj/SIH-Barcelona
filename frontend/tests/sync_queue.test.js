// Mixed-batch sync regression suite.
//
// The integration audit found that a batch answered with HTTP 200 but containing a
// rejected attempt had the client delete EVERY attempt it had sent, because it read
// res.ok instead of the per-attempt results[]. The rejected run was then gone from
// the local queue and absent from the server — a worker's completed training
// destroyed with no record on either side. These tests pin the fix.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  evaluateAssessment,
  queueAttemptForSync,
  getQueuedAttempts,
  clearAttemptQueue,
  syncQueuedAttempts,
  getSyncRejections,
  clearSyncRejections
} from "../assessment/engine.js";
import { validateSyncPayload } from "../../backend/models/sync.js";

// mock local storage for the node test runner
if (typeof globalThis.localStorage === "undefined") {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

const T0 = "2026-09-03T10:00:00.000Z";
const T1 = "2026-09-03T10:00:10.000Z";
const T2 = "2026-09-03T10:00:20.000Z";
const T3 = "2026-09-03T10:00:30.000Z";
const END = "2026-09-03T10:00:40.000Z";

// a complete, contract-valid fire attempt ready for evaluateAssessment
function buildFireAttempt() {
  return {
    contractVersion: "1.0",
    attemptId: globalThis.crypto.randomUUID(),
    workerId: "WRK-0001",
    moduleId: "fire-response",
    moduleVersion: 1,
    engineVersion: "1.0.0",
    deviceId: "dev-test",
    arTier: 2,
    locale: "hi",
    startedAt: T0,
    completedAt: END,
    checkpoints: [
      {
        checkpointId: "fire_exit_identification",
        type: "proximity",
        passed: true,
        score: 1,
        weight: 1,
        timestamp: T1,
        context: { method: "button_confirm" }
      },
      {
        checkpointId: "fire_extinguisher_aim",
        type: "aim",
        passed: true,
        score: 0.75,
        weight: 1,
        timestamp: T2,
        context: { accuracy: 0.75, target: "base", distance: 0.2 }
      },
      {
        checkpointId: "fire_evacuation_sequence",
        type: "select",
        passed: true,
        score: 1,
        weight: 1,
        timestamp: T3,
        context: { selected: "sound_alarm_then_evacuate" }
      }
    ],
    passThresholdUsed: 0.7
  };
}

describe("syncQueuedAttempts per-attempt result handling", () => {
  beforeEach(() => {
    clearAttemptQueue();
    clearSyncRejections();
  });

  // stub the backend, echoing back a chosen status per attempt in send order
  function stubSync(statuses, options = {}) {
    const httpStatus = options.httpStatus === undefined ? 200 : options.httpStatus;
    const omitResults = options.omitResults === true;

    return async (_url, init) => {
      const body = JSON.parse(init.body);
      const results = body.attempts.map((attempt, i) => {
        if (statuses[i] === "rejected") {
          return {
            attemptId: attempt.attemptId,
            status: "rejected",
            reason: "unknown_worker",
            message: "worker " + attempt.workerId + " is not registered on this server",
            issues: []
          };
        }
        return { attemptId: attempt.attemptId, status: statuses[i] };
      });

      const payload = {
        batchId: body.batchId,
        receivedAt: new Date().toISOString(),
        received: results.length,
        accepted: results.filter((r) => r.status === "accepted").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        rejected: results.filter((r) => r.status === "rejected").length
      };
      if (!omitResults) {
        payload.results = results;
      }

      return {
        ok: httpStatus >= 200 && httpStatus < 300,
        status: httpStatus,
        json: async () => payload
      };
    };
  }

  // queue n attempts, return their ids in queue order
  function queueN(n) {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const evaluated = evaluateAssessment(buildFireAttempt(), 0.7);
      queueAttemptForSync(evaluated);
      ids.push(evaluated.attemptId);
    }
    return ids;
  }

  async function withStub(stub, fn) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      return await fn();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it("1. all accepted clears the whole queue", async () => {
    queueN(2);
    const result = await withStub(stubSync(["accepted", "accepted"]), () => syncQueuedAttempts());

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.synced, 2);
    assert.strictEqual(result.rejected, 0);
    assert.strictEqual(getQueuedAttempts().length, 0);
  });

  it("2. all duplicate clears the whole queue", async () => {
    queueN(2);
    const result = await withStub(stubSync(["duplicate", "duplicate"]), () => syncQueuedAttempts());

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.synced, 2, "a duplicate is settled, the server already holds it");
    assert.strictEqual(getQueuedAttempts().length, 0);
  });

  it("3. mixed accepted plus rejected keeps only the rejected one", async () => {
    queueN(2);
    const result = await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, false, "a mixed 200 is not a full success");
    assert.strictEqual(result.synced, 1);
    assert.strictEqual(result.rejected, 1);
    assert.strictEqual(getQueuedAttempts().length, 1);
  });

  it("4. all rejected on HTTP 422 retains everything", async () => {
    queueN(2);
    const result = await withStub(
      stubSync(["rejected", "rejected"], { httpStatus: 422 }),
      () => syncQueuedAttempts()
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 422);
    assert.strictEqual(getQueuedAttempts().length, 2, "nothing landed, so nothing may be dropped");
  });

  it("5. network error retains everything", async () => {
    queueN(2);
    const result = await withStub(
      async () => { throw new Error("Failed to fetch (offline)"); },
      () => syncQueuedAttempts()
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "network_offline");
    assert.strictEqual(getQueuedAttempts().length, 2);
  });

  it("6. the rejected attempt is the one still queued", async () => {
    const ids = queueN(2);
    await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());

    const remaining = getQueuedAttempts();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].attemptId, ids[1], "the rejected run must survive");
    assert.notStrictEqual(remaining[0].attemptId, ids[0]);
  });

  it("7. an accepted attempt is removed", async () => {
    const ids = queueN(2);
    await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());

    const remainingIds = getQueuedAttempts().map((a) => a.attemptId);
    assert.ok(!remainingIds.includes(ids[0]));
    assert.ok(remainingIds.includes(ids[1]));
  });

  it("8. a duplicate attempt is removed", async () => {
    const ids = queueN(2);
    await withStub(stubSync(["duplicate", "rejected"]), () => syncQueuedAttempts());

    const remainingIds = getQueuedAttempts().map((a) => a.attemptId);
    assert.ok(!remainingIds.includes(ids[0]), "a duplicate would resend forever if kept");
    assert.ok(remainingIds.includes(ids[1]));
  });

  it("9. the rejection reason is preserved in its own storage key", async () => {
    const ids = queueN(2);
    const result = await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());

    assert.strictEqual(result.rejections.length, 1);
    assert.strictEqual(result.rejections[0].attemptId, ids[1]);
    assert.strictEqual(result.rejections[0].reason, "unknown_worker");
    assert.match(result.rejections[0].message, /not registered/);

    const logged = getSyncRejections();
    assert.strictEqual(logged.length, 1);
    assert.strictEqual(logged[0].attemptId, ids[1]);
    assert.strictEqual(logged[0].reason, "unknown_worker");
    assert.ok(typeof logged[0].at === "string");
  });

  it("9b. the reason never rides on the queued attempt, the backend schema is strict", async () => {
    queueN(2);
    await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());

    const queued = getQueuedAttempts()[0];
    ["reason", "message", "_lastRejection", "syncState", "at"].forEach((key) => {
      assert.ok(!(key in queued), "queued attempt must not carry " + key);
    });

    // and it must still satisfy the real backend envelope validator on resend
    assert.doesNotThrow(() =>
      validateSyncPayload(
        {
          batchId: "b71e0c93-4a2f-4d55-8e10-6f3c9d2a7b48",
          deviceId: "dev-retry",
          workerId: "WRK-0001",
          sentAt: new Date().toISOString(),
          attempts: [queued]
        },
        { now: Date.now() }
      )
    );
  });

  it("10. HTTP 200 without results[] retains everything", async () => {
    queueN(2);
    const result = await withStub(
      stubSync(["accepted", "accepted"], { omitResults: true }),
      () => syncQueuedAttempts()
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "malformed_response");
    assert.strictEqual(getQueuedAttempts().length, 2, "cannot tell what landed, so drop nothing");
  });

  it("11. regression: one accepted plus one unknown_worker, the exact audit case", async () => {
    const ids = queueN(2);
    const result = await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());

    // before the fix this reported synced 2, remaining 0, and the rejected run was gone
    assert.strictEqual(result.synced, 1);
    assert.strictEqual(result.remaining, 1);
    assert.strictEqual(result.success, false);

    const remaining = getQueuedAttempts();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].attemptId, ids[1]);
    assert.ok(!remaining.map((a) => a.attemptId).includes(ids[0]));

    assert.strictEqual(getSyncRejections()[0].reason, "unknown_worker");
  });

  it("12. a later sync retries only what is left", async () => {
    queueN(2);
    await withStub(stubSync(["accepted", "rejected"]), () => syncQueuedAttempts());
    assert.strictEqual(getQueuedAttempts().length, 1);

    // the worker gets provisioned, so the retry now lands
    const second = await withStub(stubSync(["accepted"]), () => syncQueuedAttempts());
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.synced, 1);
    assert.strictEqual(getQueuedAttempts().length, 0);
  });
});
