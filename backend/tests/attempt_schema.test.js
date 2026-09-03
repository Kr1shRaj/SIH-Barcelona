// keep pino quiet and off the pretty transport for the whole file
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDatabase, closeDatabase } = require("../db/index");
const { seedDatabase } = require("../db/seed");

let tmpDir = null;
let db = null;

const ATTEMPT_ID = "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51";

// insert one attempt row shaped exactly like the contract says a run looks
function insertAttempt(overrides) {
  const a = Object.assign(
    {
      attempt_id: ATTEMPT_ID,
      worker_id: "WRK-0001",
      module_id: "fire-response",
      module_version: 1,
      contract_version: "1.0",
      engine_version: "1.0.0",
      device_id: "dev-8f3a2b1c",
      ar_tier: 2,
      locale: "hi",
      started_at: "2026-09-01T10:14:02.118Z",
      completed_at: "2026-09-01T10:17:41.556Z",
      duration_ms: 219438,
      status: "completed",
      server_total_score: 2.75,
      server_max_score: 3,
      server_percentage: 91.67,
      server_passed: 1,
      threshold_applied: 0.7,
      client_percentage: 91.67,
      client_passed: 1,
      client_claim_mismatch: 0,
      sync_batch_id: null,
      server_received_at: "2026-09-01T12:40:12.338Z"
    },
    overrides || {}
  );

  return db
    .prepare(
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
       )`
    )
    .run(a);
}

// insert one checkpoint row hanging off an attempt
function insertCheckpoint(overrides) {
  const c = Object.assign(
    {
      attempt_id: ATTEMPT_ID,
      checkpoint_id: "fire_extinguisher_aim",
      checkpoint_type: "aim",
      passed: 1,
      score: 0.75,
      weight: 1,
      context_json: JSON.stringify({ accuracy: 0.75, target: "base", distance: 0.2 }),
      client_ts: "2026-09-01T10:16:20.410Z"
    },
    overrides || {}
  );

  return db
    .prepare(
      `INSERT INTO checkpoint_result
         (attempt_id, checkpoint_id, checkpoint_type, passed, score, weight, context_json, client_ts)
       VALUES
         (@attempt_id, @checkpoint_id, @checkpoint_type, @passed, @score, @weight, @context_json, @client_ts)`
    )
    .run(c);
}

describe("Attempt Contract schema shape", () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-attempt-"));
    db = initDatabase(path.join(tmpDir, "attempt-test.db"));
  });

  beforeEach(() => {
    // wipe run data between tests, seed reference rows stay.
    // certificate first — it references attempt, so the fk blocks the delete otherwise.
    db.exec("DELETE FROM certificate; DELETE FROM checkpoint_result; DELETE FROM attempt;");
    seedDatabase(db);
  });

  after(() => {
    closeDatabase();
    // windows releases the wal/shm sidecar locks a beat late, so retry the wipe
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // --- terminology: attempt is one whole run ---

  it("stores one attempt row for one complete module run", () => {
    insertAttempt();

    const rows = db.prepare("SELECT * FROM attempt").all();
    assert.strictEqual(rows.length, 1, "one training run must be exactly one attempt row");
    assert.strictEqual(rows[0].attempt_id, ATTEMPT_ID);
    assert.strictEqual(rows[0].module_id, "fire-response");
  });

  it("hangs three checkpoint_result rows off that single attempt", () => {
    insertAttempt();
    insertCheckpoint({ checkpoint_id: "fire_exit_identification", checkpoint_type: "proximity", score: 1 });
    insertCheckpoint({ checkpoint_id: "fire_extinguisher_aim", checkpoint_type: "aim", score: 0.75 });
    insertCheckpoint({ checkpoint_id: "fire_evacuation_sequence", checkpoint_type: "select", score: 1 });

    const kids = db
      .prepare("SELECT checkpoint_id FROM checkpoint_result WHERE attempt_id = ? ORDER BY checkpoint_id")
      .all(ATTEMPT_ID)
      .map((r) => r.checkpoint_id);

    assert.deepStrictEqual(kids, [
      "fire_evacuation_sequence",
      "fire_exit_identification",
      "fire_extinguisher_aim"
    ]);
  });

  // --- the contract's "exactly one entry per checkpoint" rule ---

  it("refuses a second row for the same checkpoint in the same attempt", () => {
    insertAttempt();
    insertCheckpoint({ checkpoint_id: "fire_extinguisher_aim" });

    assert.throws(
      () => insertCheckpoint({ checkpoint_id: "fire_extinguisher_aim", score: 0.1 }),
      /UNIQUE constraint failed/,
      "composite pk must enforce one row per checkpoint per attempt"
    );
  });

  it("allows the same checkpoint id under a different attempt", () => {
    insertAttempt();
    insertCheckpoint();

    const second = "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64";
    insertAttempt({ attempt_id: second });
    insertCheckpoint({ attempt_id: second });

    const n = db.prepare("SELECT COUNT(*) AS n FROM checkpoint_result").get().n;
    assert.strictEqual(n, 2, "two runs may each record the same checkpoint");
  });

  // --- idempotency, the property offline sync depends on ---

  it("silently ignores a replayed attempt instead of duplicating it", () => {
    insertAttempt();

    const info = db
      .prepare(
        `INSERT INTO attempt (
           attempt_id, worker_id, module_id, module_version, contract_version,
           started_at, completed_at, duration_ms, status,
           server_total_score, server_max_score, server_percentage, server_passed,
           threshold_applied, server_received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id) DO NOTHING`
      )
      .run(
        ATTEMPT_ID, "WRK-0001", "fire-response", 1, "1.0",
        "2026-09-01T10:14:02.118Z", "2026-09-01T10:17:41.556Z", 219438, "completed",
        2.75, 3, 91.67, 1, 0.7, "2026-09-01T12:41:00.000Z"
      );

    assert.strictEqual(info.changes, 0, "replay must change nothing");
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM attempt").get().n, 1);
  });

  // --- integrity guards ---

  it("rejects an attempt for a worker that does not exist", () => {
    assert.throws(() => insertAttempt({ worker_id: "WRK-GHOST" }), /FOREIGN KEY constraint failed/);
  });

  it("rejects a status other than completed", () => {
    assert.throws(() => insertAttempt({ status: "abandoned" }), /CHECK constraint failed/);
  });

  it("rejects an ar_tier outside the two supported tiers", () => {
    assert.throws(() => insertAttempt({ ar_tier: 3 }), /CHECK constraint failed/);
  });

  it("rejects a percentage outside 0..100", () => {
    assert.throws(() => insertAttempt({ server_percentage: 140 }), /CHECK constraint failed/);
  });

  it("rejects a checkpoint score outside 0..1", () => {
    insertAttempt();
    assert.throws(() => insertCheckpoint({ score: 1.5 }), /CHECK constraint failed/);
  });

  it("rejects an unknown checkpoint type", () => {
    insertAttempt();
    assert.throws(() => insertCheckpoint({ checkpoint_type: "telepathy" }), /CHECK constraint failed/);
  });

  it("deletes child checkpoints when its attempt goes", () => {
    insertAttempt();
    insertCheckpoint();
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM checkpoint_result").get().n, 1);

    db.prepare("DELETE FROM attempt WHERE attempt_id = ?").run(ATTEMPT_ID);

    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS n FROM checkpoint_result").get().n,
      0,
      "cascade must not leave orphan checkpoints"
    );
  });

  // --- client vs server columns, the mismatch story ---

  it("keeps the client claim beside the server result so disagreement is visible", () => {
    // client claims a pass at 91.67, server recomputed a fail at 42
    insertAttempt({
      server_percentage: 42,
      server_passed: 0,
      client_percentage: 91.67,
      client_passed: 1,
      client_claim_mismatch: 1
    });

    const row = db.prepare("SELECT * FROM attempt WHERE attempt_id = ?").get(ATTEMPT_ID);

    assert.strictEqual(row.server_passed, 0, "server value is the one that counts");
    assert.strictEqual(row.client_passed, 1, "client claim must survive for auditing");
    assert.strictEqual(row.client_claim_mismatch, 1);
  });

  it("can find every mismatched attempt with one indexed query", () => {
    insertAttempt();
    insertAttempt({ attempt_id: "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64", client_claim_mismatch: 1 });

    const flagged = db.prepare("SELECT attempt_id FROM attempt WHERE client_claim_mismatch = 1").all();
    assert.strictEqual(flagged.length, 1);
  });

  // --- certificate traceability ---

  it("lets a certificate point back at the attempt that earned it", () => {
    insertAttempt();

    db.prepare(
      `INSERT INTO certificate
         (cert_id, worker_id, module_id, attempt_id, score, issued_at, algo, key_id, signature, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("CERT-1", "WRK-0001", "fire-response", ATTEMPT_ID, 91.67, "2026-09-01T12:45:00.000Z", "test", "testkey", "sig", "{}");

    const joined = db
      .prepare(
        `SELECT c.cert_id, a.module_id FROM certificate c
         JOIN attempt a ON a.attempt_id = c.attempt_id
         WHERE c.cert_id = ?`
      )
      .get("CERT-1");

    assert.strictEqual(joined.module_id, "fire-response");
  });

  it("rejects a certificate pointing at an attempt that does not exist", () => {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO certificate
               (cert_id, worker_id, module_id, attempt_id, score, issued_at, algo, key_id, signature, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run("CERT-2", "WRK-0001", "fire-response", "ATT-GHOST", 90, "t", "test", "testkey", "sig", "{}"),
      /FOREIGN KEY constraint failed/
    );
  });
});
