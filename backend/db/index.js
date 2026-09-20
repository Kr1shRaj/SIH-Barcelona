const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { getConfig } = require("../config");
const { createChildLogger } = require("../logger");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");

// bump this whenever schema.sql changes shape. v2 renamed attempt/module_result
// to match the SafeAR Attempt Contract v1.0. v3 added certificate.key_id for
// ed25519 signing key rotation. v4 moved grading to the server for Contract v2.0 —
// checkpoint_definition holds the rule, checkpoint_result holds the raw observation.
// v5 added trainee authentication: trainee_account, trainee_activation and
// trainee_session. Additive only, which is what made it migratable in place.
const SCHEMA_VERSION = 5;

// forward migrations, applied in order for a database that is behind. each entry
// is additive and runs inside one transaction, so a database is never left half
// upgraded. there is no downgrade: going back means restoring a backup.
const MIGRATIONS = [
  { from: 4, to: 5, file: "005_trainee_auth.sql" }
];

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

// write the version stamp
function _stampSchemaVersion(db, version) {
  db.prepare(
    "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(version));
}

// Bring an existing database forward, or refuse if there is no path.
//
// This used to throw for any mismatch and tell the developer to delete the file.
// That was honest while the only thing in a database was seed data; it stopped
// being acceptable the moment real attempts and signed certificates lived there.
// Every migration below is additive, so upgrading cannot invalidate a credential
// that was already issued.
function _migrateSchema(db, target) {
  if (_isFreshDatabase(db)) {
    return "fresh";
  }

  let found = _readSchemaVersion(db);
  if (found === SCHEMA_VERSION) {
    return "current";
  }

  const log = createChildLogger({ component: "db" });

  while (found !== SCHEMA_VERSION) {
    const step = MIGRATIONS.find((entry) => entry.from === found);
    if (!step) {
      throw new Error(
        `database at ${target} is schema v${found === null ? 1 : found}, this build needs v${SCHEMA_VERSION} ` +
          "and no migration path exists — restore a backup or start a fresh database"
      );
    }

    const sql = fs.readFileSync(path.join(__dirname, "migrations", step.file), "utf8");
    // one transaction per step: a failure leaves the database exactly as it was
    db.exec("BEGIN");
    try {
      db.exec(sql);
      _stampSchemaVersion(db, step.to);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${step.from} -> ${step.to} failed: ${err.message}`);
    }

    log.info({ event: "db_migrated", from: step.from, to: step.to, file: step.file }, "Schema migrated");
    found = step.to;
  }

  return "migrated";
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
  let schemaState = null;
  try {
    schemaState = _migrateSchema(db, target);
  } catch (err) {
    db.close();
    throw err;
  }

  // a fresh file gets the whole schema; a migrated one has already been brought
  // forward statement by statement and must not have it replayed over the top
  if (schemaState !== "migrated") {
    db.exec(fs.readFileSync(SCHEMA_FILE, "utf8"));
    _stampSchemaVersion(db, SCHEMA_VERSION);
  }

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
