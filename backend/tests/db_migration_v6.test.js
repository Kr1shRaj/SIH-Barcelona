process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Database = require("better-sqlite3");
const request = require("supertest");
const { buildTestApp, measureSpatialCheckpoints, activateTestTrainee, asTrainee, TEST_CONFIG } = require("./helpers/app");
const { initDatabase, closeDatabase, SCHEMA_VERSION } = require("../db/index");
const { seedDatabase } = require("../db/seed");
const { createApp } = require("../app");
const { testKeys } = require("./fixtures/certs");
const { gasAttempt, fireAttempt, syncEnvelope } = require("./fixtures/attempts");

// v5 -> v6, on a database that has something to lose.
//
// v6 widens a CHECK on two tables, which SQLite can only do by rebuilding them, so
// this is the migration most able to lose data. The v5 shape of those two tables is
// frozen here verbatim from the v5 schema.sql (main before the gates landed): v5 is
// history now and never changes, so freezing it cannot drift.
const V5_CHECKPOINT_DEFINITION = `CREATE TABLE checkpoint_definition_v5 (
  module_id     TEXT NOT NULL REFERENCES module(module_id),
  checkpoint_id TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN
    ('selection_single', 'selection_multi', 'spatial_alignment', 'aim_dwell')),

  applies_to_tier INTEGER CHECK (applies_to_tier IS NULL OR applies_to_tier IN (1, 2)),

  expected_value   TEXT,
  allowed_values   TEXT,
  forbidden_values TEXT,
  allowed_tracking_sources TEXT,

  anchor_id             TEXT,
  max_angular_error_rad REAL,

  max_distance_m     REAL,
  pass_threshold     REAL,
  min_sweep_coverage REAL,

  min_dwell_ms    INTEGER,
  min_frame_count INTEGER,

  gradeable     INTEGER NOT NULL DEFAULT 1 CHECK (gradeable IN (0, 1)),

  weight        REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  required      INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  critical      INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (module_id, checkpoint_id)
);`;
const V5_CHECKPOINT_RESULT = `CREATE TABLE checkpoint_result_v5 (
  attempt_id      TEXT NOT NULL REFERENCES attempt(attempt_id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN
    ('selection_single', 'selection_multi', 'spatial_alignment', 'aim_dwell')),
  observation_json TEXT NOT NULL,

  server_score    REAL NOT NULL CHECK (server_score BETWEEN 0 AND 1),
  server_passed   INTEGER NOT NULL CHECK (server_passed IN (0, 1)),
  grade_reason    TEXT,
  weight          REAL NOT NULL CHECK (weight > 0),
  client_claimed_passed INTEGER CHECK (client_claimed_passed IS NULL OR client_claimed_passed IN (0, 1)),
  client_ts       TEXT NOT NULL,
  PRIMARY KEY (attempt_id, checkpoint_id)
);`;

// rebuild both tables back into their v5 shape, dropping what only v6 can hold
const DOWNGRADE_TO_V5 = `
${V5_CHECKPOINT_DEFINITION};
INSERT INTO checkpoint_definition_v5 (module_id, checkpoint_id, checkpoint_type, observation_kind, applies_to_tier, expected_value, allowed_values, forbidden_values, allowed_tracking_sources, anchor_id, max_angular_error_rad, max_distance_m, pass_threshold, min_sweep_coverage, min_dwell_ms, min_frame_count, gradeable, weight, required, critical, created_at)
  SELECT module_id, checkpoint_id, checkpoint_type, observation_kind, applies_to_tier, expected_value, allowed_values, forbidden_values, allowed_tracking_sources, anchor_id, max_angular_error_rad, max_distance_m, pass_threshold, min_sweep_coverage, min_dwell_ms, min_frame_count, gradeable, weight, required, critical, created_at FROM checkpoint_definition WHERE observation_kind != 'selection_sequence';
DROP TABLE checkpoint_definition;
ALTER TABLE checkpoint_definition_v5 RENAME TO checkpoint_definition;
CREATE INDEX idx_ckdef_module ON checkpoint_definition (module_id);
${V5_CHECKPOINT_RESULT};
INSERT INTO checkpoint_result_v5 (attempt_id, checkpoint_id, checkpoint_type, observation_kind, observation_json, server_score, server_passed, grade_reason, weight, client_claimed_passed, client_ts) SELECT attempt_id, checkpoint_id, checkpoint_type, observation_kind, observation_json, server_score, server_passed, grade_reason, weight, client_claimed_passed, client_ts FROM checkpoint_result;
DROP TABLE checkpoint_result;
ALTER TABLE checkpoint_result_v5 RENAME TO checkpoint_result;
CREATE INDEX idx_ckresult_checkpoint ON checkpoint_result (checkpoint_id);
UPDATE schema_meta SET value = '5' WHERE key = 'schema_version';
`;

describe("v5 to v6 migration", () => {
  const WORKER = "WRK-0001";
  let ctx = null;
  let dbPath = null;
  let migrated = null;
  let app = null;
  let session = null;
  const before_ = { certId: null, qr: null, cert: null, results: null, counts: null };

  const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  before(async () => {
    ctx = buildTestApp();
    dbPath = path.join(ctx.dir, "api-test.db");
    measureSpatialCheckpoints(ctx.db);

    // a v5 database only ever held v5 observation kinds: a graded, certified gas run
    session = activateTestTrainee(ctx.db, WORKER);
    const attempt = gasAttempt({ workerId: WORKER });
    const synced = await request(ctx.app).post("/api/sync").set(asTrainee(session)).send(syncEnvelope([attempt], { workerId: WORKER }));
    assert.strictEqual(synced.body.results[0].status, "accepted", JSON.stringify(synced.body));
    const issued = await request(ctx.app).post("/api/certs/issue").set(asTrainee(session)).send({ attemptId: attempt.attemptId });
    assert.strictEqual(issued.status, 201, "the fixture needs a real certificate to protect");
    before_.certId = issued.body.certId;
    before_.qr = issued.body.qr;

    closeDatabase();
    const raw = new Database(dbPath);
    raw.exec("BEGIN");
    raw.exec(DOWNGRADE_TO_V5);
    raw.exec("COMMIT");
    assert.ok(!columns(raw, "checkpoint_definition").includes("answer_key"), "the fixture really is v5");
    before_.cert = raw.prepare("SELECT * FROM certificate WHERE cert_id = ?").get(before_.certId);
    before_.results = raw.prepare("SELECT * FROM checkpoint_result ORDER BY attempt_id, checkpoint_id").all();
    before_.definitions = raw.prepare("SELECT * FROM checkpoint_definition ORDER BY module_id, checkpoint_id").all();
    before_.counts = Object.fromEntries(
      ["worker", "attempt", "checkpoint_result", "checkpoint_definition", "certificate", "trainee_account"].map((t) => [t, count(raw, t)])
    );
    raw.close();

    // and open it the way the server does
    migrated = initDatabase(dbPath);
    app = createApp({ db: migrated, config: TEST_CONFIG, keys: testKeys() });
  });

  after(() => ctx.cleanup());

  it("1. brings a v5 database forward to v6 instead of refusing it", () => {
    const version = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
    assert.strictEqual(Number.parseInt(version.value, 10), 6);
    assert.strictEqual(SCHEMA_VERSION, 6);
  });

  it("2. adds answer_key and applies_when, empty on every old rule", () => {
    assert.ok(columns(migrated, "checkpoint_definition").includes("answer_key"));
    assert.ok(columns(migrated, "checkpoint_definition").includes("applies_when"));
    const filled = migrated.prepare("SELECT COUNT(*) AS n FROM checkpoint_definition WHERE answer_key IS NOT NULL OR applies_when IS NOT NULL").get().n;
    assert.strictEqual(filled, 0, "null means today's behaviour: not scenario graded, applies everywhere");
  });

  it("3. keeps every row, and every old column of every rebuilt row byte for byte", () => {
    Object.entries(before_.counts).forEach(([table, n]) => assert.strictEqual(count(migrated, table), n, table));
    assert.deepStrictEqual(migrated.prepare("SELECT * FROM checkpoint_result ORDER BY attempt_id, checkpoint_id").all(), before_.results);
    const after = migrated.prepare("SELECT * FROM checkpoint_definition ORDER BY module_id, checkpoint_id").all()
      .map(({ answer_key: _a, applies_when: _w, ...rest }) => rest);
    assert.deepStrictEqual(after, before_.definitions);
  });

  it("4. keeps the indexes the rebuilt tables had", () => {
    const names = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    assert.ok(names.includes("idx_ckdef_module") && names.includes("idx_ckresult_checkpoint"));
  });

  it("5. leaves the signed certificate untouched and still verifies it", async () => {
    assert.deepStrictEqual(migrated.prepare("SELECT * FROM certificate WHERE cert_id = ?").get(before_.certId), before_.cert);
    const res = await request(app).post("/api/certs/verify").send({ qr: before_.qr });
    assert.strictEqual(res.body.verdict, "valid");
  });

  it("6. keeps the trainee signed in, and accepts a fire run with its gates once the seed is re-run", async () => {
    seedDatabase(migrated);
    measureSpatialCheckpoints(migrated);
    const attempt = fireAttempt({ workerId: WORKER });
    const res = await request(app).post("/api/sync").set(asTrainee(session)).send(syncEnvelope([attempt], { workerId: WORKER }));
    assert.strictEqual(res.body.results[0].status, "accepted", JSON.stringify(res.body.results));
    const gate = migrated.prepare("SELECT observation_kind FROM checkpoint_result WHERE attempt_id = ? AND checkpoint_id = 'fire_explosion_decision'").get(attempt.attemptId);
    assert.strictEqual(gate.observation_kind, "selection_sequence", "the widened CHECK lets the new kind in");
  });
});
