-- v4 -> v5. Trainee authentication.
--
-- ADDITIVE ONLY. This migration creates three tables and their indexes and
-- touches nothing that already exists: no ALTER, no DROP, no UPDATE, no DELETE.
-- Workers, attempts, checkpoint results and certificates come through byte for
-- byte, which is why a certificate signed under v4 still verifies under v5.
--
-- Identity lives in `worker` and keeps living there. These tables only answer a
-- question the schema could not answer before: "is this really that worker?"

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
