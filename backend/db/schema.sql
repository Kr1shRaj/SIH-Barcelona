-- SafeAR SQLite schema. Version 6.
-- Runs on every boot, IF NOT EXISTS keeps it safe to re-run.
-- Version bump is guarded in db/index.js — an older db on disk is rejected loud, never patched silently.
--
-- Naming follows the SafeAR Attempt Contract v2.0:
--   attempt           = one complete module training run   (PK is the contract attemptId)
--   checkpoint_result = one checkpoint inside that run
--
-- v2.0 moved grading to the server. The client sends raw observations only.
-- checkpoint_definition holds the rule, checkpoint_result holds the observation
-- plus what the server made of it. Nothing the client scored is authoritative.
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
  -- NULL until the recertification period is confirmed by the team
  recert_months  INTEGER,
  created_at     TEXT NOT NULL
);

-- server side grading rule. this is the whole point of v2 — the answer key, the
-- thresholds and the weights live here and never travel to or from a phone.
-- checkpoint_type stays a content label. observation_kind is what the grader
-- dispatches on, because 'proximity' currently labels checkpoints that measure
-- nothing and must never drive scoring.
CREATE TABLE IF NOT EXISTS checkpoint_definition (
  module_id     TEXT NOT NULL REFERENCES module(module_id),
  checkpoint_id TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN
    ('selection_single', 'selection_multi', 'spatial_alignment', 'aim_dwell', 'selection_sequence')),

  -- NULL = lives on every tier. a number pins it to one tier and the manifest
  -- check rejects an attempt that claims the other one.
  applies_to_tier INTEGER CHECK (applies_to_tier IS NULL OR applies_to_tier IN (1, 2)),

  -- json. string for selection_single, array for selection_multi, NULL otherwise.
  expected_value   TEXT,
  -- json array of every option the shipped ui can produce. anything else is a 422.
  allowed_values   TEXT,
  -- json array, selection_multi only
  forbidden_values TEXT,
  -- json array of tracking sources allowed to certify
  allowed_tracking_sources TEXT,

  -- selection_sequence only. json {"by": scenario field, "cases": {value: {"expected", "severity"}}}.
  -- answer depend on the scenario the server roll from attemptId, so it cannot be one expected_value.
  answer_key       TEXT,
  -- json {scenario field: value}. NULL = every scenario. a row that does not apply
  -- to this attempt's scenario is not required and must not be sent.
  applies_when     TEXT,

  -- spatial_alignment. NULL max_angular_error_rad means nobody has measured this
  -- on a real device yet, so the grader scores it zero instead of guessing.
  anchor_id             TEXT,
  max_angular_error_rad REAL,

  -- aim_dwell
  max_distance_m     REAL,
  pass_threshold     REAL,
  min_sweep_coverage REAL,

  -- optional plausibility gates for both spatial kinds. NULL = gate not applied.
  min_dwell_ms    INTEGER,
  min_frame_count INTEGER,

  -- 0 = rule not configured yet. scores zero, blocks certification, never passes.
  gradeable     INTEGER NOT NULL DEFAULT 1 CHECK (gradeable IN (0, 1)),

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

  -- graded               every checkpoint had a configured rule and got scored
  -- ungradeable          at least one checkpoint has no measurable rule yet
  -- legacy_client_graded v1 row, its score came from client claims, never certifiable
  grading_status   TEXT NOT NULL DEFAULT 'legacy_client_graded'
                     CHECK (grading_status IN ('graded', 'ungradeable', 'legacy_client_graded')),
  -- which rules produced the numbers below, so a weaker rule stays visible later
  grader_version   TEXT,
  graded_at        TEXT,

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
  -- score_drift     numbers differ, same verdict. float paths, expected.
  -- claim_inflation client said pass, server said fail. security signal.
  mismatch_kind         TEXT NOT NULL DEFAULT 'none'
                          CHECK (mismatch_kind IN ('none', 'score_drift', 'claim_inflation')),

  sync_batch_id      TEXT REFERENCES sync_batch(batch_id),
  server_received_at TEXT NOT NULL
);

-- one checkpoint inside one attempt. composite pk makes the contract rule
-- "exactly one entry per checkpoint" a database guarantee, not a hope.
-- observation_json is what the phone reported, server_* is what the server made of it.
CREATE TABLE IF NOT EXISTS checkpoint_result (
  attempt_id      TEXT NOT NULL REFERENCES attempt(attempt_id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN
    ('selection_single', 'selection_multi', 'spatial_alignment', 'aim_dwell', 'selection_sequence')),
  -- raw observation exactly as it arrived. evidence, never proof, never an answer key.
  observation_json TEXT NOT NULL,

  -- graded on this server from checkpoint_definition, 0..1
  server_score    REAL NOT NULL CHECK (server_score BETWEEN 0 AND 1),
  server_passed   INTEGER NOT NULL CHECK (server_passed IN (0, 1)),
  -- why the grader landed there, e.g. no_aim_sample, threshold_unconfigured
  grade_reason    TEXT,
  -- taken from checkpoint_definition, never from the payload
  weight          REAL NOT NULL CHECK (weight > 0),
  -- v2 carries no per checkpoint client verdict, so this stays NULL for now
  client_claimed_passed INTEGER CHECK (client_claimed_passed IS NULL OR client_claimed_passed IN (0, 1)),
  client_ts       TEXT NOT NULL,
  PRIMARY KEY (attempt_id, checkpoint_id)
);

-- signature and algo columns get filled by the cert service, not by seed data.
-- attempt_id is UNIQUE, so one run earns at most one certificate and the db says so.
CREATE TABLE IF NOT EXISTS certificate (
  cert_id      TEXT PRIMARY KEY,
  worker_id    TEXT NOT NULL REFERENCES worker(worker_id),
  module_id    TEXT NOT NULL REFERENCES module(module_id),
  -- which run earned it, so a cert is always traceable back to its evidence
  attempt_id   TEXT UNIQUE REFERENCES attempt(attempt_id),
  score        REAL NOT NULL,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT,
  algo         TEXT NOT NULL,
  -- which signing key made this, so a rotation can find what the old key signed
  key_id       TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_attempt_grading     ON attempt (grading_status);
CREATE INDEX IF NOT EXISTS idx_ckresult_checkpoint ON checkpoint_result (checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_cert_worker_mod     ON certificate (worker_id, module_id);
CREATE INDEX IF NOT EXISTS idx_cert_attempt        ON certificate (attempt_id);
CREATE INDEX IF NOT EXISTS idx_cert_expires        ON certificate (expires_at);
CREATE INDEX IF NOT EXISTS idx_cert_revoked        ON certificate (revoked);
CREATE INDEX IF NOT EXISTS idx_cert_key_id         ON certificate (key_id);

-- ---------------------------------------------------------------- v5: auth
-- One credential record per roster worker. The worker row stays the
-- organisational record an administrator owns — name, mine, contractor — and this
-- row only says the worker can log in, and how to check that they are who they say.
CREATE TABLE IF NOT EXISTS trainee_account (
  account_id        TEXT PRIMARY KEY,
  worker_id         TEXT NOT NULL UNIQUE REFERENCES worker(worker_id),
  -- scrypt$N$r$p$salt_b64$hash_b64. never a plaintext pin, never reversible.
  pin_hash          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  activated_at      TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_login_at     TEXT,
  -- brute force ladder. counts consecutive failures, cleared by any success.
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT
);

-- One row per activation code ever issued. The code itself is NEVER stored: only
-- sha256 of its normalised form, so a copy of this database cannot activate
-- anybody. The plaintext exists once, on the CLI's stdout, and is not recoverable.
CREATE TABLE IF NOT EXISTS trainee_activation (
  activation_id     TEXT PRIMARY KEY,
  worker_id         TEXT NOT NULL REFERENCES worker(worker_id),
  code_hash         TEXT NOT NULL UNIQUE,
  issued_at         TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  -- non-null means spent, forever. one-time means one time.
  consumed_at       TEXT,
  consumed_by       TEXT REFERENCES trainee_account(account_id),
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT
);

-- Opaque bearer sessions. Only the hash of the token is here, so a stolen
-- database yields no usable session — the same rule the admin key already follows.
CREATE TABLE IF NOT EXISTS trainee_session (
  token_hash    TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES trainee_account(account_id),
  issued_at     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  revoked       INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  device_id     TEXT
);

CREATE INDEX IF NOT EXISTS idx_activation_worker   ON trainee_activation (worker_id);
CREATE INDEX IF NOT EXISTS idx_activation_consumed ON trainee_activation (consumed_at);
CREATE INDEX IF NOT EXISTS idx_session_account     ON trainee_session (account_id);
CREATE INDEX IF NOT EXISTS idx_session_expires     ON trainee_session (expires_at);
