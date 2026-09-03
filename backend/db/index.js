const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { getConfig } = require("../config");
const { createChildLogger } = require("../logger");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");

// bump this whenever schema.sql changes shape. v2 renamed attempt/module_result
// to match the SafeAR Attempt Contract v1.0. v3 added certificate.key_id for
// ed25519 signing key rotation.
const SCHEMA_VERSION = 3;

let _db = null;

// read the version stamp, missing table means a pre-versioning db
function _readSchemaVersion(db) {
  const hasMeta = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
    .get();
  if (!hasMeta) {
    return null;
  }
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
  return row ? Number.parseInt(row.value, 10) : null;
}

// count user tables, zero means nobody has built this file yet
function _isFreshDatabase(db) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get();
  return row.n === 0;
}

// refuse an older db instead of half upgrading it. CREATE TABLE IF NOT EXISTS would
// leave stale tables sitting next to new ones and nobody would ever see the mix.
function _assertSchemaVersion(db, target) {
  if (_isFreshDatabase(db)) {
    return;
  }

  const found = _readSchemaVersion(db);
  if (found === SCHEMA_VERSION) {
    return;
  }

  throw new Error(
    `database at ${target} is schema v${found === null ? 1 : found}, this build needs v${SCHEMA_VERSION} — ` +
      "delete the local db file and re-run the seed (dev data only, nothing of value is lost)"
  );
}

// open sqlite db and make tables if missing
function initDatabase(dbPath) {
  const target = dbPath || getConfig().dbPath;
  const log = createChildLogger({ component: "db" });

  // drop any handle we already hold, a leaked one keeps a file lock on windows
  closeDatabase();

  // db folder is gitignored and may not exist on a fresh clone
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const db = new Database(target);

  // wal survives a hard kill better, foreign keys are off by default in sqlite
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // check before writing anything, a stale db must not get new tables bolted on
  try {
    _assertSchemaVersion(db, target);
  } catch (err) {
    db.close();
    throw err;
  }

  db.exec(fs.readFileSync(SCHEMA_FILE, "utf8"));

  db.prepare(
    "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(SCHEMA_VERSION));

  _db = db;
  log.info({ event: "db_initialized", dbPath: target, schemaVersion: SCHEMA_VERSION }, "Database ready");
  return db;
}

// hand back the open db, shout if nobody called init yet
function getDb() {
  if (!_db) {
    throw new Error("database not initialized — call initDatabase() first");
  }
  return _db;
}

// close the handle, mostly for tests and clean shutdown
function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { initDatabase, getDb, closeDatabase, SCHEMA_FILE, SCHEMA_VERSION };
