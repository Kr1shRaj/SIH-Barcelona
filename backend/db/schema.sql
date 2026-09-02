-- SafeAR SQLite schema. Version 2.
-- Runs on every boot, IF NOT EXISTS keeps it safe to re-run.
-- Version bump is guarded in db/index.js — an older db on disk is rejected loud, never patched silently.
--
-- Naming follows the SafeAR Attempt Contract v1.0:
--   attempt           = one complete module training run   (PK is the contract attemptId)
--   checkpoint_result = one checkpoint inside that run
--
-- attempt / checkpoint_result / certificate are append-only.
-- Only certificate.revoked and certificate.revoked_at are ever updated in place.
-- All timestamps are ISO 8601 UTC strings.

-- schema version marker, db/index.js reads this before touching anything else
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mine (
  mine_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  district    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contractor (
  contractor_id TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker (
  worker_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  mine_id       TEXT REFERENCES mine(mine_id),
  contractor_id TEXT REFERENCES contractor(contractor_id),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module (
  module_id      TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  pass_threshold REAL NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  -- NULL until the Mines Act recertification period is confirmed by the team
  recert_months  INTEGER,
  created_at     TEXT NOT NULL
);

-- server side manifest. this is what lets the backend recompute instead of echo the client.
-- weight and required drive scoring. critical is wired but not yet decided by the team.
CREATE TABLE IF NOT EXISTS checkpoint_definition (
  module_id     TEXT NOT NULL REFERENCES module(module_id),
  checkpoint_id TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  weight        REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  required      INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  -- 0 = aggregate scoring only. flipping to 1 fails the whole module on this checkpoint.
  -- stays 0 until the team rules on which checkpoints are safety critical.
  critical      INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (module_id, checkpoint_id)
);

-- one row per offline batch the phone pushes up, batch_id is client supplied for replay safety
CREATE TABLE IF NOT EXISTS sync_batch (
  batch_id      TEXT PRIMARY KEY,
  worker_id     TEXT NOT NULL REFERENCES worker(worker_id),
  device_id     TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'accepted'
);

-- one complete module training run. attempt_id is the contract attemptId and the idempotency key.
-- server_* columns are the only scores that count. client_* are kept to catch disagreement.
CREATE TABLE IF NOT EXISTS attempt (
  attempt_id       TEXT PRIMARY KEY,
  worker_id        TEXT NOT NULL REFERENCES worker(worker_id),
  module_id        TEXT NOT NULL REFERENCES module(module_id),
  module_version   INTEGER NOT NULL,
  contract_version TEXT NOT NULL,

  -- provenance, diagnostics only, never touches scoring
  engine_version   TEXT,
  device_id        TEXT,
  ar_tier          INTEGER CHECK (ar_tier IS NULL OR ar_tier IN (1, 2)),
  locale           TEXT,

  started_at       TEXT NOT NULL,
  completed_at     TEXT NOT NULL,
  duration_ms      INTEGER NOT NULL CHECK (duration_ms >= 0),
  -- contract only ever submits a finished run
  status           TEXT NOT NULL CHECK (status IN ('completed')),

  -- server authoritative. the cert service reads these and nothing else.
  server_total_score REAL NOT NULL CHECK (server_total_score >= 0),
  server_max_score   REAL NOT NULL CHECK (server_max_score > 0),
  server_percentage  REAL NOT NULL CHECK (server_percentage BETWEEN 0 AND 100),
  server_passed      INTEGER NOT NULL CHECK (server_passed IN (0, 1)),
  threshold_applied  REAL NOT NULL,

  -- what the client claimed, kept only so a mismatch is detectable
  client_percentage     REAL,
  client_passed         INTEGER CHECK (client_passed IS NULL OR client_passed IN (0, 1)),
  client_claim_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (client_claim_mismatch IN (0, 1)),

  sync_batch_id      TEXT REFERENCES sync_batch(batch_id),
  server_received_at TEXT NOT NULL
);

-- one checkpoint inside one attempt. composite pk makes the contract rule
-- "exactly one entry per checkpoint" a database guarantee, not a hope.
CREATE TABLE IF NOT EXISTS checkpoint_result (
  attempt_id      TEXT NOT NULL REFERENCES attempt(attempt_id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  passed          INTEGER NOT NULL CHECK (passed IN (0, 1)),
  -- server recomputed from context, 0..1
  score           REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
  -- taken from checkpoint_definition, never from the payload
  weight          REAL NOT NULL CHECK (weight > 0),
  -- sanitized context from the engine. evidence, never proof. no answer key inside.
  context_json    TEXT,
  client_ts       TEXT NOT NULL,
  PRIMARY KEY (attempt_id, checkpoint_id)
);

-- signature and algo columns get filled by the cert service, not by seed data
CREATE TABLE IF NOT EXISTS certificate (
  cert_id      TEXT PRIMARY KEY,
  worker_id    TEXT NOT NULL REFERENCES worker(worker_id),
  module_id    TEXT NOT NULL REFERENCES module(module_id),
  -- which run earned it, so a cert is always traceable back to its evidence
  attempt_id   TEXT REFERENCES attempt(attempt_id),
  score        REAL NOT NULL,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT,
  algo         TEXT NOT NULL,
  signature    TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_mine         ON worker (mine_id);
CREATE INDEX IF NOT EXISTS idx_worker_contractor   ON worker (contractor_id);
CREATE INDEX IF NOT EXISTS idx_ckdef_module        ON checkpoint_definition (module_id);
CREATE INDEX IF NOT EXISTS idx_sync_batch_worker   ON sync_batch (worker_id);
CREATE INDEX IF NOT EXISTS idx_attempt_worker_mod  ON attempt (worker_id, module_id);
CREATE INDEX IF NOT EXISTS idx_attempt_batch       ON attempt (sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_attempt_passed      ON attempt (server_passed);
CREATE INDEX IF NOT EXISTS idx_attempt_mismatch    ON attempt (client_claim_mismatch);
CREATE INDEX IF NOT EXISTS idx_ckresult_checkpoint ON checkpoint_result (checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_cert_worker_mod     ON certificate (worker_id, module_id);
CREATE INDEX IF NOT EXISTS idx_cert_attempt        ON certificate (attempt_id);
CREATE INDEX IF NOT EXISTS idx_cert_expires        ON certificate (expires_at);
CREATE INDEX IF NOT EXISTS idx_cert_revoked        ON certificate (revoked);
