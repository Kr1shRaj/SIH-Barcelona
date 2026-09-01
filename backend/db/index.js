const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { getConfig } = require("../config");
const { createChildLogger } = require("../logger");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");

let _db = null;

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

  db.exec(fs.readFileSync(SCHEMA_FILE, "utf8"));

  _db = db;
  log.info({ event: "db_initialized", dbPath: target }, "Database ready");
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

module.exports = { initDatabase, getDb, closeDatabase, SCHEMA_FILE };
