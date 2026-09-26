// Who this device is signed in as.
//
// Three things live here, and they are deliberately separate:
//
//   1. the SERVER SESSION — an opaque bearer token the backend issued. It is the
//      only thing that proves identity to the server, and the server decides
//      when it stops working.
//   2. the IDENTITY — worker id and display name, cached so the app can show who
//      it belongs to without a round trip.
//   3. the OFFLINE VERIFIER — a locally derived value that lets this device check
//      a PIN with no network.
//
// The verifier is NOT the server's PIN hash and must never be. The server stores
// scrypt with its own salt; this device stores PBKDF2-SHA256 with a different
// salt, derived here from the PIN the worker just typed. Neither can be used in
// place of the other: stealing the device gives an attacker a value that is
// useless against the server, and stealing the database gives a value that is
// useless against the device.
//
// WHAT THIS NEVER DOES: unlock the app because a cached record exists. A record
// without a PIN gets you a PIN prompt, not a session.

const SESSION_KEY = "safear_session";
const IDENTITY_KEY = "safear_offline_identity";

// PBKDF2 cost. High enough to be slow to grind on a stolen phone, low enough
// that a mid-range android does it in well under a second.
const PBKDF2_ITERATIONS = 210000;
const VERIFIER_BYTES = 32;
const SALT_BYTES = 16;

// offline PIN attempts before the verifier is wiped and the worker must come
// back online to prove who they are
const OFFLINE_MAX_ATTEMPTS = 10;

function _storage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch (_err) {
    return null;
  }
  return null;
}

function _read(key) {
  const storage = _storage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    // a corrupted record is not a crash and not a way in: it reads as absent,
    // which sends the worker to the login screen
    return null;
  }
}

function _write(key, value) {
  const storage = _storage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_err) {
    return false;
  }
}

function _remove(key) {
  const storage = _storage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (_err) {
    // nothing to do: a storage that will not forget is still not a session
  }
}

function _crypto() {
  if (typeof window !== "undefined" && window.crypto) return window.crypto;
  if (typeof globalThis !== "undefined" && globalThis.crypto) return globalThis.crypto;
  return null;
}

// WebCrypto needs a secure context. Capacitor (capacitor://localhost) and
// http://localhost have one; http://192.168.x.x in a plain browser does not, and
// there is no safe way to fake it — a hand written PBKDF2 in javascript would be
// slow enough to be useless and wrong often enough to be dangerous. Where it is
// missing the app says so and requires an online login.
function offlineVerificationAvailable() {
  const crypto = _crypto();
  return Boolean(crypto && crypto.subtle && typeof crypto.subtle.deriveBits === "function");
}

function _toBase64(bytes) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

function _fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// derive the device-local verifier from a PIN and a salt
async function deriveVerifier(pin, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const crypto = _crypto();
  if (!crypto || !crypto.subtle) throw new Error("offline verification is unavailable here");

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(pin)), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" }, key, VERIFIER_BYTES * 8
  );
  return new Uint8Array(bits);
}

// constant time compare of two byte arrays
function _sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------- session

function getSession() {
  const session = _read(SESSION_KEY);
  if (!session || typeof session.token !== "string") return null;
  return session;
}

function getToken() {
  const session = getSession();
  return session ? session.token : null;
}

// is the token still inside its own stated lifetime? the server decides for real
// — this only avoids sending one we already know is spent.
function isSessionFresh(now = Date.now()) {
  const session = getSession();
  if (!session || !session.expiresAt) return false;
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

function getIdentity() {
  const identity = _read(IDENTITY_KEY);
  if (!identity || typeof identity.workerId !== "string") return null;
  return identity;
}

function getWorkerId() {
  const identity = getIdentity();
  return identity ? identity.workerId : null;
}

// Remember a successful sign in. `pin` is used once, here, to build the offline
// verifier and is not stored in any form — only the value derived from it.
async function rememberSession({ token, expiresAt, workerId, name }, pin) {
  _write(SESSION_KEY, { token, expiresAt, workerId });

  const identity = { workerId, name: name || null, updatedAt: new Date().toISOString() };

  if (pin && offlineVerificationAvailable()) {
    const crypto = _crypto();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const verifier = await deriveVerifier(pin, salt);
    identity.verifierSalt = _toBase64(salt);
    identity.verifier = _toBase64(verifier);
    identity.iterations = PBKDF2_ITERATIONS;
    identity.algo = "PBKDF2-SHA256";
    identity.failedOffline = 0;
  }

  _write(IDENTITY_KEY, identity);
  return identity;
}

// Check a PIN against the device-local verifier. Never talks to the network and
// never touches the server session.
async function verifyOfflinePin(pin) {
  const identity = getIdentity();
  if (!identity || !identity.verifier || !identity.verifierSalt) {
    return { ok: false, reason: "no_verifier" };
  }
  if (!offlineVerificationAvailable()) {
    return { ok: false, reason: "unavailable" };
  }
  if ((identity.failedOffline || 0) >= OFFLINE_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }

  let derived = null;
  try {
    derived = await deriveVerifier(pin, _fromBase64(identity.verifierSalt), identity.iterations || PBKDF2_ITERATIONS);
  } catch (_err) {
    return { ok: false, reason: "unavailable" };
  }

  if (_sameBytes(derived, _fromBase64(identity.verifier))) {
    identity.failedOffline = 0;
    _write(IDENTITY_KEY, identity);
    return { ok: true, workerId: identity.workerId, name: identity.name };
  }

  identity.failedOffline = (identity.failedOffline || 0) + 1;
  // too many guesses on a device nobody can supervise: drop the verifier so the
  // only way back in is an online login against the real server
  if (identity.failedOffline >= OFFLINE_MAX_ATTEMPTS) {
    delete identity.verifier;
    delete identity.verifierSalt;
  }
  _write(IDENTITY_KEY, identity);
  return { ok: false, reason: identity.failedOffline >= OFFLINE_MAX_ATTEMPTS ? "locked" : "wrong_pin" };
}

// can this device offer an offline PIN prompt at all?
function canReenterOffline() {
  const identity = getIdentity();
  return Boolean(identity && identity.verifier && offlineVerificationAvailable());
}

// Forget this session. The QUEUE IS NOT TOUCHED: attempts a worker has already
// completed are theirs, and logging out is not a reason to throw away work that
// has not reached the server yet.
function clearSession({ forgetDevice = false } = {}) {
  _remove(SESSION_KEY);
  if (forgetDevice) {
    _remove(IDENTITY_KEY);
  }
}

export {
  SESSION_KEY,
  IDENTITY_KEY,
  PBKDF2_ITERATIONS,
  OFFLINE_MAX_ATTEMPTS,
  offlineVerificationAvailable,
  deriveVerifier,
  getSession,
  getToken,
  isSessionFresh,
  getIdentity,
  getWorkerId,
  rememberSession,
  verifyOfflinePin,
  canReenterOffline,
  clearSession
};
