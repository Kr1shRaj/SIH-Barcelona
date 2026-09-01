-- SafeAR SQLite schema.
-- Runs on every boot, IF NOT EXISTS keeps it safe to re-run.
-- attempt / module_result / certificate are append-only logs.
-- Only certificate.revoked and certificate.revoked_at are ever updated in place.
-- All timestamps are ISO 8601 UTC strings.

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

-- one row per offline batch the phone pushes up, batch_id is client supplied for replay safety
CREATE TABLE IF NOT EXISTS sync_batch (
  batch_id      TEXT PRIMARY KEY,
  worker_id     TEXT NOT NULL REFERENCES worker(worker_id),
  device_id     TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'accepted'
);

-- immutable checkpoint log, mirrors the safear:checkpoint event the AR layer emits
CREATE TABLE IF NOT EXISTS attempt (
  attempt_id         TEXT PRIMARY KEY,
  worker_id          TEXT NOT NULL REFERENCES worker(worker_id),
  module_id          TEXT NOT NULL REFERENCES module(module_id),
  checkpoint_id      TEXT NOT NULL,
  checkpoint_type    TEXT NOT NULL,
  passed             INTEGER NOT NULL CHECK (passed IN (0, 1)),
  score              REAL,
  context_json       TEXT,
  client_ts          TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  sync_batch_id      TEXT REFERENCES sync_batch(batch_id)
);

-- per module outcome the client declares, backend re-checks it before issuing a cert
CREATE TABLE IF NOT EXISTS module_result (
  result_id     TEXT PRIMARY KEY,
  worker_id     TEXT NOT NULL REFERENCES worker(worker_id),
  module_id     TEXT NOT NULL REFERENCES module(module_id),
  score         REAL NOT NULL,
  passed        INTEGER NOT NULL CHECK (passed IN (0, 1)),
  completed_at  TEXT NOT NULL,
  sync_batch_id TEXT REFERENCES sync_batch(batch_id)
);

-- signature and algo columns get filled by the cert service, not by seed data
CREATE TABLE IF NOT EXISTS certificate (
  cert_id      TEXT PRIMARY KEY,
  worker_id    TEXT NOT NULL REFERENCES worker(worker_id),
  module_id    TEXT NOT NULL REFERENCES module(module_id),
  score        REAL NOT NULL,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT,
  algo         TEXT NOT NULL,
  signature    TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_mine        ON worker (mine_id);
CREATE INDEX IF NOT EXISTS idx_worker_contractor  ON worker (contractor_id);
CREATE INDEX IF NOT EXISTS idx_sync_batch_worker  ON sync_batch (worker_id);
CREATE INDEX IF NOT EXISTS idx_attempt_worker_mod ON attempt (worker_id, module_id);
CREATE INDEX IF NOT EXISTS idx_attempt_batch      ON attempt (sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_result_worker_mod  ON module_result (worker_id, module_id);
CREATE INDEX IF NOT EXISTS idx_cert_worker_mod    ON certificate (worker_id, module_id);
CREATE INDEX IF NOT EXISTS idx_cert_expires       ON certificate (expires_at);
CREATE INDEX IF NOT EXISTS idx_cert_revoked       ON certificate (revoked);
