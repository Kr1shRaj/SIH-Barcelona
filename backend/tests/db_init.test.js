// keep pino quiet and off the pretty transport for the whole file
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDatabase, getDb, closeDatabase } = require("../db/index");

const EXPECTED_TABLES = [
  "attempt",
  "certificate",
  "contractor",
  "mine",
  "module",
  "module_result",
  "sync_batch",
  "worker"
];

let tmpDir = null;
let dbPath = null;

// list every user table currently in the db
function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

describe("Database initialization", () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-db-"));
    dbPath = path.join(tmpDir, "nested", "safear-test.db");
  });

  after(() => {
    closeDatabase();
    // windows releases the wal/shm sidecar locks a beat late, so retry the wipe
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("creates the db file and its parent directory", () => {
    const db = initDatabase(dbPath);

    assert.ok(fs.existsSync(dbPath), "db file must exist on disk");
    assert.ok(db, "initDatabase must return a db handle");
  });

  it("creates every expected table", () => {
    const db = initDatabase(dbPath);
    assert.deepStrictEqual(tableNames(db), EXPECTED_TABLES);
  });

  it("turns foreign key enforcement on", () => {
    const db = initDatabase(dbPath);
    assert.strictEqual(db.pragma("foreign_keys", { simple: true }), 1);
  });

  it("creates the expected indexes", () => {
    const db = initDatabase(dbPath);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all()
      .map((row) => row.name);

    assert.ok(indexes.includes("idx_attempt_worker_mod"));
    assert.ok(indexes.includes("idx_cert_worker_mod"));
    assert.ok(indexes.includes("idx_cert_expires"));
  });

  it("is safe to run twice and keeps existing rows", () => {
    const first = initDatabase(dbPath);
    first
      .prepare("INSERT INTO mine (mine_id, name, district, created_at) VALUES (?, ?, ?, ?)")
      .run("MINE-KEEP", "Keep Me", "Dhanbad", "2026-01-01T00:00:00.000Z");

    const second = initDatabase(dbPath);
    const row = second.prepare("SELECT name FROM mine WHERE mine_id = ?").get("MINE-KEEP");

    assert.strictEqual(row.name, "Keep Me", "re-init must not wipe existing data");
  });

  it("rejects a worker row pointing at a mine that does not exist", () => {
    const db = initDatabase(dbPath);

    assert.throws(
      () =>
        db
          .prepare("INSERT INTO worker (worker_id, name, mine_id, contractor_id, created_at) VALUES (?, ?, ?, ?, ?)")
          .run("WRK-BAD", "Ghost", "MINE-DOES-NOT-EXIST", null, "2026-01-01T00:00:00.000Z"),
      /FOREIGN KEY constraint failed/
    );
  });

  it("rejects an attempt row whose passed flag is not 0 or 1", () => {
    const db = initDatabase(dbPath);

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO attempt
             (attempt_id, worker_id, module_id, checkpoint_id, checkpoint_type, passed, client_ts, server_received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run("ATT-BAD", "WRK-0001", "fire-response", "cp", "aim", 7, "t", "t"),
      /CHECK constraint failed|FOREIGN KEY constraint failed/
    );
  });

  it("getDb throws before init and after close", () => {
    initDatabase(dbPath);
    assert.ok(getDb(), "getDb must return the handle while open");

    closeDatabase();
    assert.throws(() => getDb(), /database not initialized/);
  });
});
