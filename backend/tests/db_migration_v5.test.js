process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const request = require("supertest");
const Database = require("better-sqlite3");

const { buildTestApp, measureSpatialCheckpoints, TEST_CONFIG, activateTestTrainee, asTrainee } = require("./helpers/app");
const { fireAttempt, syncEnvelope } = require("./fixtures/attempts");
const { testKeys } = require("./fixtures/certs");
const { initDatabase, closeDatabase, SCHEMA_VERSION } = require("../db/index");
const { createApp } = require("../app");

// v4 -> v5, on a database that has something to lose.
//
// The point of making 005 additive was that an installation which has already
// trained people and issued credentials can take the upgrade without anybody
// re-earning anything. This proves it on a database holding a real graded attempt
// and a real signed certificate: the rows survive, and — the part that actually
// matters — the certificate still verifies against the bytes it was signed over.
//
// The v4 database here is built by taking a v5 one back down: the migration adds
// three tables and their indexes and changes nothing else, so v5 minus those
// tables IS v4. Hand-writing an old schema.sql copy would drift from the real one.
describe("v4 to v5 migration", () => {
  let ctx = null;
  let dbPath = null;
  let migrated = null;
  let app = null;

  const WORKER = "WRK-0001";
  const TRAINEE_TABLES = ["trainee_session", "trainee_activation", "trainee_account"];

  // everything the old database held, captured before the upgrade
  const before_ = { certId: null, qr: null, payload: null, signature: null, counts: null, attemptId: null };

  before(async () => {
    ctx = buildTestApp();
    dbPath = path.join(ctx.dir, "api-test.db");
    measureSpatialCheckpoints(ctx.db);

    const session = activateTestTrainee(ctx.db, WORKER);
    const attempt = fireAttempt({ workerId: WORKER });
    before_.attemptId = attempt.attemptId;

    await request(ctx.app).post("/api/sync").set(asTrainee(session))
      .send(syncEnvelope([attempt], { workerId: WORKER }));

    const issued = await request(ctx.app).post("/api/certs/issue").set(asTrainee(session))
      .send({ attemptId: attempt.attemptId });
    assert.strictEqual(issued.status, 201, "the fixture needs a real certificate to protect");

    before_.certId = issued.body.certId;
    before_.qr = issued.body.qr;

    const row = ctx.db.prepare("SELECT payload_json, signature FROM certificate WHERE cert_id = ?").get(before_.certId);
    before_.payload = row.payload_json;
    before_.signature = row.signature;

    const count = (table) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    before_.counts = {
      worker: count("worker"),
      attempt: count("attempt"),
      checkpoint_result: count("checkpoint_result"),
      certificate: count("certificate")
    };

    // take it back to v4: drop what 005 added, and re-stamp the version
    closeDatabase();
    const raw = new Database(dbPath);
    TRAINEE_TABLES.forEach((table) => raw.exec(`DROP TABLE IF EXISTS ${table}`));
    raw.prepare("UPDATE schema_meta SET value = '4' WHERE key = 'schema_version'").run();
    raw.close();

    // and open it the way the server does
    migrated = initDatabase(dbPath);
    app = createApp({ db: migrated, config: TEST_CONFIG, keys: testKeys() });
  });

  after(() => ctx.cleanup());

  it("1. brings a v4 database forward instead of refusing to open it", () => {
    const version = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
    assert.strictEqual(Number.parseInt(version.value, 10), SCHEMA_VERSION);
    assert.strictEqual(SCHEMA_VERSION, 5);
  });

  it("2. adds the three trainee tables and nothing else is dropped", () => {
    const tables = migrated
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all().map((row) => row.name);

    TRAINEE_TABLES.forEach((table) => assert.ok(tables.includes(table), `${table} must exist after the migration`));
    ["worker", "attempt", "checkpoint_result", "certificate", "module", "schema_meta"].forEach((table) => {
      assert.ok(tables.includes(table), `${table} must survive the migration`);
    });
  });

  it("3. keeps every row that was already there", () => {
    const count = (table) => migrated.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.deepStrictEqual({
      worker: count("worker"),
      attempt: count("attempt"),
      checkpoint_result: count("checkpoint_result"),
      certificate: count("certificate")
    }, before_.counts, "a migration that loses training history is a data loss bug");

    const attempt = migrated.prepare("SELECT worker_id, server_passed FROM attempt WHERE attempt_id = ?").get(before_.attemptId);
    assert.strictEqual(attempt.worker_id, WORKER);
    assert.strictEqual(attempt.server_passed, 1);
  });

  it("4. leaves the signed certificate bytes untouched", () => {
    const row = migrated.prepare("SELECT payload_json, signature FROM certificate WHERE cert_id = ?").get(before_.certId);
    assert.strictEqual(row.payload_json, before_.payload, "the canonical payload must be byte for byte identical");
    assert.strictEqual(row.signature, before_.signature, "the signature must be byte for byte identical");
  });

  it("5. still verifies a certificate issued before the upgrade", async () => {
    const byId = await request(app).post("/api/certs/verify").send({ certId: before_.certId });
    assert.strictEqual(byId.status, 200);
    assert.strictEqual(byId.body.verdict, "valid");
    assert.strictEqual(byId.body.checks.signature, "pass");

    // and from the QR the worker is carrying on their phone, unchanged
    const byQr = await request(app).post("/api/certs/verify").send({ qr: before_.qr });
    assert.strictEqual(byQr.body.verdict, "valid");
    assert.strictEqual(byQr.body.certificate.certId, before_.certId);
  });

  it("6. the accounts that existed before the downgrade are gone, so nobody is silently signed in", () => {
    // dropping trainee_account is what made this a v4 database; the migration
    // recreates the table empty, and an empty table cannot authenticate anybody
    const accounts = migrated.prepare("SELECT COUNT(*) AS n FROM trainee_account").get().n;
    assert.strictEqual(accounts, 0);
  });

  it("7. a worker can activate and sign in on the migrated database", async () => {
    const session = activateTestTrainee(migrated, "WRK-0002", "735192");
    const me = await request(app).get("/api/auth/me").set(asTrainee(session));
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.workerId, "WRK-0002");
  });
});
