const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");

// Credential primitives: how a PIN is hashed, how a token or an activation code
// is fingerprinted, and how any of them are compared.
//
// One file owns this so there is a single answer to "how do we store secrets",
// the same way middleware/admin-auth.js owns the admin key comparison. Nothing
// here ever logs, returns or stores a plaintext secret.
//
// scrypt rather than bcrypt or argon2 on purpose: it is in node's standard
// library, so the backend keeps exactly one native dependency (better-sqlite3)
// and a laptop with no build tools can still run the server.

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 });

// scrypt with these parameters needs more than node's 32MB default
const SCRYPT_MAX_MEM = 64 * 1024 * 1024;

// Crockford base32: no I, L, O or U, so a code read aloud down a noisy radio or
// copied off a printout cannot turn into a different code
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_GROUPS = 3;
const CODE_GROUP_LEN = 4;
const CODE_PREFIX = "SAFEAR";

// 12 characters of a 32 letter alphabet is 60 bits
function generateActivationCode() {
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g += 1) {
    let group = "";
    for (let i = 0; i < CODE_GROUP_LEN; i += 1) {
      // randomInt is uniform; a modulo of randomBytes would not be
      group += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return `${CODE_PREFIX}-${groups.join("-")}`;
}

// What a worker types is not always what was printed: they may lower case it,
// drop the dashes, or type O for 0. Normalise before hashing so the hash is of
// the code itself rather than of one way of writing it.
function normalizeActivationCode(raw) {
  if (typeof raw !== "string") return "";
  const upper = raw.toUpperCase().replace(/[\s-]/g, "");
  const body = upper.startsWith(CODE_PREFIX) ? upper.slice(CODE_PREFIX.length) : upper;
  return body.replace(/[ILO]/g, (ch) => (ch === "O" ? "0" : "1"));
}

// sha256, hex. used for activation codes and session tokens: both are already
// high entropy random values, so a slow hash would buy nothing.
function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

// constant time compare of two hex digests
function sameDigest(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// scrypt$N$r$p$salt$hash — the parameters travel with the hash so they can be
// raised later without invalidating every PIN already stored
function hashPin(pin) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const derived = crypto.scryptSync(String(pin), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAX_MEM
  });
  return [
    "scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString("base64"), derived.toString("base64")
  ].join("$");
}

// Verify a PIN against a stored hash. Returns a boolean and never throws for a
// malformed stored value — a corrupt row must read as "wrong PIN", not as a
// crash that tells an attacker something.
function verifyPin(pin, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt = null;
  let expected = null;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch (_err) {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived = null;
  try {
    derived = crypto.scryptSync(String(pin), salt, expected.length, { N, r, p, maxmem: SCRYPT_MAX_MEM });
  } catch (_err) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

// A hash to compare against when no account exists, so an unknown worker id
// costs the same time as a known one and cannot be told apart by a stopwatch.
let _dummyHash = null;
function dummyPinHash() {
  if (!_dummyHash) {
    _dummyHash = hashPin(crypto.randomBytes(16).toString("hex"));
  }
  return _dummyHash;
}

// 32 bytes of randomness, base64url. the raw token is returned to the caller
// once and only its fingerprint is ever stored.
function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

module.exports = {
  SCRYPT,
  CODE_ALPHABET,
  generateActivationCode,
  normalizeActivationCode,
  fingerprint,
  sameDigest,
  hashPin,
  verifyPin,
  dummyPinHash,
  generateSessionToken
};
