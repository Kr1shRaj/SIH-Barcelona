const crypto = require("node:crypto");
const {
  generateActivationCode, normalizeActivationCode, fingerprint, sameDigest,
  hashPin, verifyPin, dummyPinHash, generateSessionToken
} = require("./credentials");

// Trainee accounts, activation codes and sessions.
//
// The rules this file exists to hold in one place:
//
//   * a trainee is never created from nothing. every account points at a worker
//     row an administrator already put on the roster, so a stranger cannot write
//     themselves into a DGMS compliance ledger.
//   * an activation code is consumed in the same transaction that creates the
//     account. one code, one account, no second use, no partial state.
//   * failure is uniform. unknown worker, no account, wrong PIN and a disabled
//     account all answer the same way and cost the same time.
//   * nothing here returns a hash, a token fingerprint or a code. the caller
//     gets an identity or an error.

// The lockout ladder. Consecutive failures only — any success clears the count.
// Never permanent: the worst case is a day, because a worker locked out forever
// at the start of a shift is a safety problem of its own.
const LOCKOUT_LADDER_SECONDS = [0, 0, 0, 0, 60, 300, 900, 3600, 86400];
const MAX_LOCKOUT_SECONDS = 86400;

const ACTIVATION_TTL_DAYS = 14;
const SESSION_TTL_DAYS = 30;

// six digits minimum. numeric on purpose: these are gloved hands on a phone in a
// mine, and an alphanumeric password would be typed wrong or written down.
const PIN_MIN_LENGTH = 6;

// PINs that are common enough to be guessed before any lockout bites
const BANNED_PINS = new Set([
  "123456", "000000", "111111", "123123", "654321", "012345", "987654",
  "121212", "112233", "666666", "888888", "999999", "555555", "222222",
  "333333", "444444", "777777", "101010", "123321", "456789", "098765"
]);

function _now(now) {
  return typeof now === "number" ? now : Date.now();
}

function _iso(ms) {
  return new Date(ms).toISOString();
}

// a run of one repeated digit, or a straight ascending/descending run
function _isSequential(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i += 1) {
    const step = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

// Is this PIN allowed? Returns null when fine, or a machine readable reason.
// The reason is safe to show a worker: it is about their own new PIN, and says
// nothing about anybody else's.
function checkPinPolicy(pin) {
  if (typeof pin !== "string" || pin.length === 0) return "pin_required";
  if (!/^\d+$/.test(pin)) return "pin_digits_only";
  if (pin.length < PIN_MIN_LENGTH) return "pin_too_short";
  if (BANNED_PINS.has(pin)) return "pin_too_common";
  if (_isSequential(pin)) return "pin_too_simple";
  return null;
}

// how long a row with this many consecutive failures is locked for
function lockoutSecondsFor(failures) {
  if (failures <= 0) return 0;
  const index = Math.min(failures, LOCKOUT_LADDER_SECONDS.length - 1);
  const fromLadder = LOCKOUT_LADDER_SECONDS[index];
  return failures >= LOCKOUT_LADDER_SECONDS.length ? MAX_LOCKOUT_SECONDS : fromLadder;
}

// seconds still to wait, or 0 when the row is open
function _lockRemaining(row, nowMs) {
  if (!row || !row.locked_until) return 0;
  const until = Date.parse(row.locked_until);
  if (!Number.isFinite(until) || until <= nowMs) return 0;
  return Math.ceil((until - nowMs) / 1000);
}

// record one failure against a row and apply the ladder
function _registerFailure(db, table, idColumn, idValue, current, nowMs) {
  const failures = (current || 0) + 1;
  const seconds = lockoutSecondsFor(failures);
  const lockedUntil = seconds > 0 ? _iso(nowMs + seconds * 1000) : null;
  db.prepare(`UPDATE ${table} SET failed_attempts = ?, locked_until = ? WHERE ${idColumn} = ?`)
    .run(failures, lockedUntil, idValue);
  return { failures, retryAfterSeconds: seconds };
}

// ---------------------------------------------------------------- activation

// Issue a code for a roster worker. Returns the PLAINTEXT once — the caller (the
// CLI) prints it and it is never recoverable again, because only its hash is
// stored. Any earlier unconsumed code for that worker is retired at the same
// time, so exactly one code can ever be live.
function issueActivationCode(db, { workerId, now, ttlDays = ACTIVATION_TTL_DAYS } = {}) {
  const worker = db.prepare("SELECT worker_id, name FROM worker WHERE worker_id = ?").get(workerId);
  if (!worker) {
    const err = new Error(`worker "${workerId}" is not on the roster`);
    err.code = "unknown_worker";
    throw err;
  }

  const existing = db.prepare("SELECT account_id FROM trainee_account WHERE worker_id = ?").get(workerId);
  if (existing) {
    const err = new Error(`worker "${workerId}" already has an account`);
    err.code = "already_activated";
    throw err;
  }

  const nowMs = _now(now);
  const code = generateActivationCode();

  const tx = db.transaction(() => {
    // retire any live code: one worker, one usable code
    db.prepare(
      "UPDATE trainee_activation SET consumed_at = ? WHERE worker_id = ? AND consumed_at IS NULL"
    ).run(_iso(nowMs), workerId);

    db.prepare(
      `INSERT INTO trainee_activation (activation_id, worker_id, code_hash, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      workerId,
      fingerprint(normalizeActivationCode(code)),
      _iso(nowMs),
      _iso(nowMs + ttlDays * 24 * 60 * 60 * 1000)
    );
  });
  tx();

  return { code, workerId, name: worker.name, expiresAt: _iso(nowMs + ttlDays * 24 * 60 * 60 * 1000) };
}

// Activate: worker id + code + new PIN, in one transaction.
//
// Every failure answers "activation_failed" with no hint about which half was
// wrong, because telling somebody "that worker exists but the code is wrong" is
// how a roster becomes a target list. The exception is the PIN policy, which is
// about the caller's own choice, and a lockout, which they need to be told about.
function activateAccount(db, { workerId, code, pin, now, deviceId } = {}) {
  const nowMs = _now(now);

  const policy = checkPinPolicy(pin);
  if (policy) {
    const err = new Error("pin does not meet the policy");
    err.code = policy;
    throw err;
  }

  const normalized = normalizeActivationCode(code);
  const row = normalized
    ? db.prepare("SELECT * FROM trainee_activation WHERE code_hash = ?").get(fingerprint(normalized))
    : null;

  // no matching code. spend the same work an accepted code would have, so a
  // wrong code and a right one for a locked row are not distinguishable by time.
  if (!row) {
    verifyPin(String(pin), dummyPinHash());
    const err = new Error("activation failed");
    err.code = "activation_failed";
    throw err;
  }

  const waiting = _lockRemaining(row, nowMs);
  if (waiting > 0) {
    const err = new Error("too many attempts");
    err.code = "too_many_attempts";
    err.retryAfterSeconds = waiting;
    throw err;
  }

  const expired = Date.parse(row.expires_at) <= nowMs;
  const consumed = row.consumed_at !== null;
  const workerMismatch = row.worker_id !== workerId;

  if (expired || consumed || workerMismatch) {
    const failure = _registerFailure(db, "trainee_activation", "activation_id", row.activation_id, row.failed_attempts, nowMs);
    const err = new Error("activation failed");
    err.code = "activation_failed";
    if (failure.retryAfterSeconds > 0) err.retryAfterSeconds = failure.retryAfterSeconds;
    throw err;
  }

  const already = db.prepare("SELECT account_id FROM trainee_account WHERE worker_id = ?").get(workerId);
  if (already) {
    const err = new Error("activation failed");
    err.code = "activation_failed";
    throw err;
  }

  const accountId = crypto.randomUUID();
  const iso = _iso(nowMs);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO trainee_account (account_id, worker_id, pin_hash, status, activated_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).run(accountId, workerId, hashPin(String(pin)), iso, iso);

    // one-time: consumed in the same transaction that created the account, so a
    // crash between the two is impossible
    db.prepare(
      "UPDATE trainee_activation SET consumed_at = ?, consumed_by = ?, failed_attempts = 0, locked_until = NULL WHERE activation_id = ?"
    ).run(iso, accountId, row.activation_id);
  });
  tx();

  return createSession(db, { accountId, workerId, now: nowMs, deviceId });
}

// ---------------------------------------------------------------- login

function login(db, { workerId, pin, now, deviceId } = {}) {
  const nowMs = _now(now);
  const account = db.prepare("SELECT * FROM trainee_account WHERE worker_id = ?").get(workerId);

  // no account: still run one verify so the timing matches a real check
  if (!account) {
    verifyPin(String(pin || ""), dummyPinHash());
    const err = new Error("invalid credentials");
    err.code = "invalid_credentials";
    throw err;
  }

  const waiting = _lockRemaining(account, nowMs);
  if (waiting > 0) {
    const err = new Error("too many attempts");
    err.code = "too_many_attempts";
    err.retryAfterSeconds = waiting;
    throw err;
  }

  const ok = verifyPin(String(pin || ""), account.pin_hash);

  // a disabled account is answered exactly like a wrong PIN, after doing the work
  if (!ok || account.status !== "active") {
    const failure = _registerFailure(db, "trainee_account", "account_id", account.account_id, account.failed_attempts, nowMs);
    const err = new Error("invalid credentials");
    err.code = "invalid_credentials";
    if (failure.retryAfterSeconds > 0) err.retryAfterSeconds = failure.retryAfterSeconds;
    throw err;
  }

  db.prepare(
    "UPDATE trainee_account SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE account_id = ?"
  ).run(_iso(nowMs), _iso(nowMs), account.account_id);

  return createSession(db, { accountId: account.account_id, workerId: account.worker_id, now: nowMs, deviceId });
}

// ---------------------------------------------------------------- sessions

// Mint a session. The raw token is returned once, to be sent to the device; the
// database keeps only its fingerprint, so a copy of the database cannot be used
// to impersonate anybody.
function createSession(db, { accountId, workerId, now, deviceId, ttlDays = SESSION_TTL_DAYS } = {}) {
  const nowMs = _now(now);
  const token = generateSessionToken();
  const expiresAt = _iso(nowMs + ttlDays * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO trainee_session (token_hash, account_id, issued_at, expires_at, last_seen_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(fingerprint(token), accountId, _iso(nowMs), expiresAt, _iso(nowMs), deviceId || null);

  const worker = db.prepare("SELECT name FROM worker WHERE worker_id = ?").get(workerId);

  return {
    token,
    expiresAt,
    workerId,
    accountId,
    name: worker ? worker.name : null
  };
}

// Resolve a bearer token to an identity, or null. Null covers every reason —
// unknown, revoked, expired, disabled account — because the caller answers all
// of them with the same 401.
function resolveSession(db, token, { now } = {}) {
  if (typeof token !== "string" || token.length === 0) return null;
  const nowMs = _now(now);

  const row = db.prepare(
    `SELECT s.token_hash, s.account_id, s.expires_at, s.revoked, a.worker_id, a.status, w.name
     FROM trainee_session s
     JOIN trainee_account a ON a.account_id = s.account_id
     JOIN worker w ON w.worker_id = a.worker_id
     WHERE s.token_hash = ?`
  ).get(fingerprint(token));

  if (!row) return null;
  if (row.revoked === 1) return null;
  if (row.status !== "active") return null;
  if (Date.parse(row.expires_at) <= nowMs) return null;

  db.prepare("UPDATE trainee_session SET last_seen_at = ? WHERE token_hash = ?")
    .run(_iso(nowMs), row.token_hash);

  return {
    accountId: row.account_id,
    workerId: row.worker_id,
    name: row.name,
    expiresAt: row.expires_at
  };
}

// Revoke one token. Idempotent, and says nothing about whether it existed.
function revokeSession(db, token) {
  if (typeof token !== "string" || token.length === 0) return false;
  const result = db.prepare("UPDATE trainee_session SET revoked = 1 WHERE token_hash = ?")
    .run(fingerprint(token));
  return result.changes > 0;
}

// every session for one account, used when an account is reset or disabled
function revokeAllSessionsForAccount(db, accountId) {
  return db.prepare("UPDATE trainee_session SET revoked = 1 WHERE account_id = ?").run(accountId).changes;
}

module.exports = {
  PIN_MIN_LENGTH,
  BANNED_PINS,
  ACTIVATION_TTL_DAYS,
  SESSION_TTL_DAYS,
  LOCKOUT_LADDER_SECONDS,
  checkPinPolicy,
  lockoutSecondsFor,
  issueActivationCode,
  activateAccount,
  login,
  createSession,
  resolveSession,
  revokeSession,
  revokeAllSessionsForAccount,
  sameDigest
};
