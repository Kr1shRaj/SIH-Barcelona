const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { fireAttempt, gasAttempt, syncEnvelope } = require("./fixtures/attempts");

let ctx = null;

const SECOND_BATCH = "c0ffee00-1111-4222-8333-444455556666";
const OTHER_ATTEMPT = "11111111-2222-4333-8444-555566667777";

function post(body) {
  return request(ctx.app).post("/api/sync").send(body);
}

// fixture attempts aimed at workers the seed actually knows
function fire(overrides) {
  return fireAttempt(Object.assign({ workerId: "WRK-0001" }, overrides || {}));
}
function gas(overrides) {
  return gasAttempt(Object.assign({ workerId: "WRK-0004" }, overrides || {}));
}
function envelope(attempts, overrides) {
  return syncEnvelope(attempts, Object.assign({ workerId: "WRK-0001" }, overrides || {}));
}

describe("POST /api/sync", () => {
  beforeEach(() => { ctx = buildTestApp(); });
  afterEach(() => ctx.cleanup());

  describe("the contract sample lands and is stored", () => {
    it("accepts the fire example and reports the server score", async () => {
      const res = await post(envelope([fire()]));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, 1);
      assert.strictEqual(res.body.accepted, 1);
      assert.strictEqual(res.body.rejected, 0);

      const result = res.body.results[0];
      assert.strictEqual(result.status, "accepted");
      assert.strictEqual(result.serverPercentage, 91.67);
      assert.strictEqual(result.serverPassed, true);
      assert.strictEqual(result.clientClaimMismatch, false);
      assert.strictEqual(result.certificateEligible, true);
    });

    it("writes the attempt row with server authoritative values", async () => {
      const payload = fire();
      await post(envelope([payload]));

      const row = ctx.db.prepare("SELECT * FROM attempt WHERE attempt_id = ?").get(payload.attemptId);
      assert.ok(row, "attempt must be persisted");
      assert.strictEqual(row.worker_id, "WRK-0001");
      assert.strictEqual(row.module_id, "fire-response");
      assert.strictEqual(row.server_percentage, 91.67);
      assert.strictEqual(row.server_passed, 1);
      assert.strictEqual(row.threshold_applied, 0.7);
      assert.strictEqual(row.status, "completed");
    });

    it("writes one checkpoint_result per checkpoint", async () => {
      const payload = fire();
      await post(envelope([payload]));

      const rows = ctx.db
        .prepare("SELECT * FROM checkpoint_result WHERE attempt_id = ? ORDER BY checkpoint_id")
        .all(payload.attemptId);

      assert.strictEqual(rows.length, 3);
      assert.deepStrictEqual(rows.map((r) => r.checkpoint_id), [
        "fire_evacuation_sequence",
        "fire_exit_identification",
        "fire_extinguisher_aim"
      ]);
    });

    it("computes duration itself and ignores the client number", async () => {
      const payload = fire({ durationMs: 7 });
      await post(envelope([payload]));

      const row = ctx.db.prepare("SELECT duration_ms FROM attempt WHERE attempt_id = ?").get(payload.attemptId);
      assert.strictEqual(row.duration_ms, 219438, "server must recompute from the timestamps");
    });

    it("records the sync batch envelope", async () => {
      const env = envelope([fire()]);
      await post(env);

      const batch = ctx.db.prepare("SELECT * FROM sync_batch WHERE batch_id = ?").get(env.batchId);
      assert.ok(batch);
      assert.strictEqual(batch.attempt_count, 1);
    });

    it("accepts the gas example with its partial PPE credit", async () => {
      const res = await post(envelope([gas()]));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.results[0].status, "accepted");
      assert.strictEqual(res.body.results[0].serverPercentage, 89);
    });

    it("stores the sanitized context as evidence", async () => {
      const payload = gas();
      await post(envelope([payload]));

      const row = ctx.db
        .prepare("SELECT context_json FROM checkpoint_result WHERE attempt_id = ? AND checkpoint_id = ?")
        .get(payload.attemptId, "gas_ppe_selection");

      const context = JSON.parse(row.context_json);
      assert.deepStrictEqual(context.missing, ["safety_harness"]);
      assert.ok(!Object.prototype.hasOwnProperty.call(context, "correct"));
    });
  });

  describe("replay is safe", () => {
    it("reports duplicate on a second delivery of the same attempt", async () => {
      const payload = fire();
      const first = await post(envelope([payload]));
      assert.strictEqual(first.body.results[0].status, "accepted");

      const second = await post(envelope([payload], { batchId: SECOND_BATCH }));
      assert.strictEqual(second.status, 200);
      assert.strictEqual(second.body.duplicates, 1);
      assert.strictEqual(second.body.accepted, 0);
      assert.strictEqual(second.body.results[0].status, "duplicate");
    });

    it("creates no second row on replay", async () => {
      const payload = fire();
      await post(envelope([payload]));
      await post(envelope([payload], { batchId: SECOND_BATCH }));

      const count = ctx.db.prepare("SELECT COUNT(*) AS n FROM attempt WHERE attempt_id = ?").get(payload.attemptId).n;
      assert.strictEqual(count, 1);

      const checkpoints = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM checkpoint_result WHERE attempt_id = ?")
        .get(payload.attemptId).n;
      assert.strictEqual(checkpoints, 3, "checkpoints must not be duplicated either");
    });

    it("returns the stored server score on a duplicate", async () => {
      const payload = fire();
      await post(envelope([payload]));

      const replay = await post(envelope([payload], { batchId: SECOND_BATCH }));
      assert.strictEqual(replay.body.results[0].serverPercentage, 91.67);
      assert.strictEqual(replay.body.results[0].certificateEligible, true);
    });

    it("survives the exact same batch being sent twice", async () => {
      const env = envelope([fire()]);
      await post(env);
      const second = await post(env);

      assert.strictEqual(second.status, 200);
      assert.strictEqual(second.body.duplicates, 1);
    });
  });

  describe("structural failures reject the whole batch with 400", () => {
    it("rejects a malformed attempt", async () => {
      const res = await post(envelope([fire({ attemptId: "not-a-uuid" })]));

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "validation_failed");
      assert.ok(res.body.issues.some((i) => i.path === "attempts.0.attemptId"));
    });

    it("rejects an unsupported contract version", async () => {
      const res = await post(envelope([fire({ contractVersion: "9.9" })]));

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.issues.some((i) => i.code === "unsupported_contract_version"));
    });

    it("rejects a payload still carrying the answer key", async () => {
      const payload = fire();
      payload.checkpoints[2].context.correct = "sound_alarm_then_evacuate";

      const res = await post(envelope([payload]));
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.issues.some((i) => i.path === "attempts.0.checkpoints.2.context"));
    });

    it("stores nothing when the batch is structurally rejected", async () => {
      const payload = fire();
      await post(envelope([payload, fire({ attemptId: "nope" })]));

      const count = ctx.db.prepare("SELECT COUNT(*) AS n FROM attempt").get().n;
      assert.strictEqual(count, 0, "a 400 must not half write the batch");
    });

    it("rejects an empty attempts array", async () => {
      const res = await post(envelope([]));
      assert.strictEqual(res.status, 400);
    });
  });

  describe("referential failures are per attempt", () => {
    it("rejects an unknown worker without sinking the batch", async () => {
      const good = fire();
      const bad = fire({ workerId: "WRK-DEFAULT", attemptId: OTHER_ATTEMPT });

      const res = await post(envelope([good, bad]));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.accepted, 1);
      assert.strictEqual(res.body.rejected, 1);

      const rejection = res.body.results.find((r) => r.status === "rejected");
      assert.strictEqual(rejection.reason, "unknown_worker");
      assert.match(rejection.message, /WRK-DEFAULT/);
    });

    it("still stores the good attempt from a mixed batch", async () => {
      const good = fire();
      const bad = fire({ workerId: "WRK-DEFAULT", attemptId: OTHER_ATTEMPT });
      await post(envelope([good, bad]));

      assert.ok(ctx.db.prepare("SELECT 1 FROM attempt WHERE attempt_id = ?").get(good.attemptId));
      assert.ok(!ctx.db.prepare("SELECT 1 FROM attempt WHERE attempt_id = ?").get(bad.attemptId));
    });

    it("rejects an unknown module", async () => {
      const payload = fire({ moduleId: "machinery-safety" });
      payload.checkpoints.forEach((cp, i) => { cp.checkpointId = `machine_step_${i + 1}`; });

      const res = await post(envelope([payload]));
      assert.strictEqual(res.body.results[0].status, "rejected");
      assert.strictEqual(res.body.results[0].reason, "unknown_module");
    });

    it("rejects an unknown checkpoint id", async () => {
      const payload = fire();
      payload.checkpoints[1].checkpointId = "fire_invented_step";

      const res = await post(envelope([payload]));
      const result = res.body.results[0];

      assert.strictEqual(result.status, "rejected");
      assert.strictEqual(result.reason, "contract_violation");
      assert.ok(result.issues.some((i) => i.code === "unknown_checkpoint"));
    });

    it("rejects an attempt that skipped a required checkpoint", async () => {
      const payload = fire();
      payload.checkpoints.pop();

      const res = await post(envelope([payload]));
      assert.strictEqual(res.body.results[0].status, "rejected");
      assert.ok(res.body.results[0].issues.some((i) => i.code === "missing_required_checkpoint"));
    });

    it("answers 422 when nothing in the batch landed", async () => {
      const res = await post(envelope([fire({ workerId: "WRK-DEFAULT" })]));

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.accepted, 0);
      assert.strictEqual(res.body.rejected, 1);
    });
  });

  describe("the server is the authority", () => {
    it("ignores client weights", async () => {
      const payload = fire();
      payload.checkpoints.forEach((cp) => { cp.weight = 99; });
      await post(envelope([payload]));

      const row = ctx.db.prepare("SELECT server_max_score FROM attempt WHERE attempt_id = ?").get(payload.attemptId);
      assert.strictEqual(row.server_max_score, 3);
    });

    it("ignores the client pass threshold", async () => {
      const payload = fire({ passThresholdUsed: 0.01 });
      await post(envelope([payload]));

      const row = ctx.db.prepare("SELECT threshold_applied FROM attempt WHERE attempt_id = ?").get(payload.attemptId);
      assert.strictEqual(row.threshold_applied, 0.7);
    });

    it("records a mismatch when the client inflates its percentage", async () => {
      const payload = fire({ percentage: 100 });
      const res = await post(envelope([payload]));

      assert.strictEqual(res.body.results[0].clientClaimMismatch, true);
      assert.strictEqual(res.body.results[0].serverPercentage, 91.67);

      const row = ctx.db
        .prepare("SELECT client_percentage, server_percentage, client_claim_mismatch FROM attempt WHERE attempt_id = ?")
        .get(payload.attemptId);

      assert.strictEqual(row.client_percentage, 100);
      assert.strictEqual(row.server_percentage, 91.67);
      assert.strictEqual(row.client_claim_mismatch, 1);
    });

    it("still accepts and stores a mismatched attempt, evidence beats rejection", async () => {
      const payload = fire({ percentage: 100 });
      const res = await post(envelope([payload]));

      assert.strictEqual(res.body.results[0].status, "accepted");
      assert.ok(ctx.db.prepare("SELECT 1 FROM attempt WHERE attempt_id = ?").get(payload.attemptId));
    });

    it("finds every mismatched attempt with one query", async () => {
      await post(envelope([fire()]));
      await post(envelope([gas({ percentage: 5 })], { batchId: SECOND_BATCH }));

      const flagged = ctx.db.prepare("SELECT attempt_id FROM attempt WHERE client_claim_mismatch = 1").all();
      assert.strictEqual(flagged.length, 1);
    });
  });

  describe("mixed batch bookkeeping", () => {
    it("counts accepted, duplicate and rejected separately", async () => {
      const already = fire();
      await post(envelope([already]));

      const fresh = gas();
      const bad = fire({ workerId: "WRK-DEFAULT", attemptId: OTHER_ATTEMPT });

      const res = await post(envelope([already, fresh, bad], { batchId: SECOND_BATCH }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, 3);
      assert.strictEqual(res.body.accepted, 1);
      assert.strictEqual(res.body.duplicates, 1);
      assert.strictEqual(res.body.rejected, 1);
      assert.strictEqual(res.body.results.length, 3);
    });

    it("returns a result for every attempt in order", async () => {
      const a = fire();
      const b = gas();
      const res = await post(envelope([a, b]));

      assert.deepStrictEqual(res.body.results.map((r) => r.attemptId), [a.attemptId, b.attemptId]);
    });
  });
});
