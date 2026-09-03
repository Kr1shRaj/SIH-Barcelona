process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");

const {
  canonicalize,
  toBase64Url,
  splitQrPayload,
  buildQrPayload,
  deriveKeyId,
  CERT_PAYLOAD_VERSION
} = require("../services/certs/canonical");
const { signCertificate, renderCertificateQr } = require("../services/certs/signer");
const { verifyCertificateOffline, REASONS } = require("../services/certs/verifier");
const {
  issueCertificateForAttempt,
  buildCertificatePayload,
  computeExpiry,
  toBasisPoints,
  generateCertId,
  CertificateIssueError,
  ISSUE_ERRORS
} = require("../services/certs/issue");
const { loadPrivateKey, loadPublicKeyFromFile, loadSigningKeys } = require("../services/certs/keys");
const { initDatabase, closeDatabase } = require("../db/index");
const { seedDatabase } = require("../db/seed");
const {
  TEST_PRIVATE_KEY_B64,
  TEST_PUBLIC_KEY_PEM,
  TEST_KEY_ID,
  OTHER_KEY_ID,
  FIXED_NOW,
  publicKey,
  testKeys,
  otherKeys,
  samplePayload
} = require("./fixtures/certs");

const KEYS = testKeys();
const AT = { now: FIXED_NOW };

// sign the sample payload, optionally bent first
function signed(overrides, keys) {
  return signCertificate(samplePayload(overrides), (keys || KEYS).privateKey);
}

// swap one field inside an already signed qr, keeping the original signature
function tamperField(field, value) {
  const original = signed();
  const bent = Object.assign({}, original.payload, { [field]: value });
  return buildQrPayload(canonicalize(bent), original.signature);
}

describe("Certificate canonical form", () => {
  it("sorts keys so the same payload always makes the same bytes", () => {
    const a = canonicalize({ w: "WRK-0001", c: "X", v: 1 });
    const b = canonicalize({ v: 1, c: "X", w: "WRK-0001" });
    assert.strictEqual(a.toString(), b.toString());
    assert.strictEqual(a.toString(), '{"c":"X","v":1,"w":"WRK-0001"}');
  });

  it("derives a key id straight from the public key", () => {
    assert.strictEqual(deriveKeyId(publicKey()), TEST_KEY_ID);
  });

  it("gives different keys different ids", () => {
    assert.notStrictEqual(deriveKeyId(publicKey()), otherKeys().keyId);
  });

  it("splits a well formed qr into payload and signature", () => {
    const { qr, canonical, signature } = signed();
    const parts = splitQrPayload(qr);
    assert.strictEqual(parts.payloadBytes.toString(), canonical.toString());
    assert.strictEqual(parts.signatureBytes.toString("hex"), signature.toString("hex"));
  });
});

describe("Certificate signing", () => {
  it("signs a payload and returns the pieces", () => {
    const result = signed();
    assert.strictEqual(result.algo, "Ed25519");
    assert.strictEqual(result.keyId, TEST_KEY_ID);
    assert.ok(Buffer.isBuffer(result.signature));
  });

  it("produces a 64 byte ed25519 signature", () => {
    assert.strictEqual(signed().signature.length, 64);
  });

  it("builds a qr of exactly two dot separated parts", () => {
    assert.strictEqual(signed().qr.split(".").length, 2);
  });

  it("is deterministic — same payload and key give the same signature", () => {
    assert.strictEqual(signed().qr, signed().qr);
  });

  it("gives a different signature for a different payload", () => {
    assert.notStrictEqual(signed().qr, signed({ s: 8000 }).qr);
  });

  it("refuses to sign a non object or without a key", () => {
    assert.throws(() => signCertificate(null, KEYS.privateKey), /must be an object/);
    assert.throws(() => signCertificate(samplePayload(), null), /private key is required/);
  });

  it("renders the qr to a scannable data url", async () => {
    const url = await renderCertificateQr(signed().qr);
    assert.match(url, /^data:image\/png;base64,/);
  });
});

describe("Exact byte verification", () => {
  it("accepts a certificate it just signed", () => {
    const result = verifyCertificateOffline(signed().qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.reason, REASONS.OK);
  });

  it("returns the payload only after the signature passed", () => {
    const result = verifyCertificateOffline(signed().qr, KEYS.publicKey, AT);
    assert.strictEqual(result.payload.c, "SAFEAR-A3F1C9E25B474D18");
    assert.strictEqual(result.payload.w, "WRK-0001");
  });

  it("verifies the bytes on the wire, not a re-serialization of them", () => {
    // hand craft a payload whose key order is NOT our canonical order, sign those
    // exact bytes, and confirm it still verifies. re-stringifying would reorder
    // the keys and break the signature, so this passing proves we never do that.
    const wireBytes = Buffer.from('{"w":"WRK-0001","v":1,"k":"' + TEST_KEY_ID + '","c":"SAFEAR-A3F1C9E25B474D18","m":"fire-response","s":9167,"i":1788000000,"e":null}');
    const sig = crypto.sign(null, wireBytes, KEYS.privateKey);
    const qr = buildQrPayload(wireBytes, sig);

    const result = verifyCertificateOffline(qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, true, "non canonical key order must still verify from the wire bytes");
  });

  it("rejects a payload whose bytes changed even if the object would match", () => {
    const original = signed();
    // same fields, different byte layout (spaces), original signature
    const respaced = Buffer.from(JSON.stringify(original.payload, null, 1));
    const qr = buildQrPayload(respaced, original.signature);

    const result = verifyCertificateOffline(qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, REASONS.BAD_SIGNATURE);
  });

  it("throws when no public key is supplied", () => {
    assert.throws(() => verifyCertificateOffline(signed().qr, null), /public key is required/);
  });
});

describe("Tamper detection", () => {
  const cases = [
    ["worker id", "w", "WRK-9999"],
    ["module id", "m", "gas-leak"],
    ["score", "s", 10000],
    ["cert id", "c", "SAFEAR-FFFFFFFFFFFFFFFF"],
    ["issued at", "i", 1700000000],
    ["expiry", "e", 4102444800],
    ["key id", "k", OTHER_KEY_ID]
  ];

  cases.forEach(([label, field, value]) => {
    it(`rejects a tampered ${label}`, () => {
      const result = verifyCertificateOffline(tamperField(field, value), KEYS.publicKey, AT);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, REASONS.BAD_SIGNATURE, `${label} must break the signature`);
    });
  });

  it("rejects a truncated signature", () => {
    const { canonical, signature } = signed();
    const qr = buildQrPayload(canonical, signature.subarray(0, 32));
    const result = verifyCertificateOffline(qr, KEYS.publicKey, AT);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, REASONS.MALFORMED);
  });

  it("rejects a signature swapped in from another certificate", () => {
    const a = signed();
    const b = signed({ c: "SAFEAR-BBBBBBBBBBBBBBBB" });
    const qr = buildQrPayload(a.canonical, b.signature);

    assert.strictEqual(verifyCertificateOffline(qr, KEYS.publicKey, AT).reason, REASONS.BAD_SIGNATURE);
  });
});

describe("Wrong key", () => {
  it("rejects a certificate signed by another key", () => {
    const result = verifyCertificateOffline(signed({}, otherKeys()).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, REASONS.BAD_SIGNATURE);
  });

  it("accepts it when verified with its own matching key", () => {
    const other = otherKeys();
    const result = verifyCertificateOffline(
      signCertificate(samplePayload({ k: other.keyId }), other.privateKey).qr,
      other.publicKey,
      AT
    );
    assert.strictEqual(result.valid, true);
  });

  it("flags a key id the verifier does not hold", () => {
    const other = otherKeys();
    const qr = signCertificate(samplePayload({ k: OTHER_KEY_ID }), other.privateKey).qr;
    const result = verifyCertificateOffline(qr, other.publicKey, { now: FIXED_NOW, expectedKeyId: TEST_KEY_ID });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, REASONS.UNKNOWN_KEY);
  });

  it("passes the key id check when it matches", () => {
    const result = verifyCertificateOffline(signed().qr, KEYS.publicKey, {
      now: FIXED_NOW,
      expectedKeyId: TEST_KEY_ID
    });
    assert.strictEqual(result.valid, true);
  });
});

describe("Malformed input", () => {
  const bad = [
    ["no separator", "abcdef"],
    ["three parts", "aaa.bbb.ccc"],
    ["empty first half", ".bbb"],
    ["empty second half", "aaa."],
    ["empty string", ""],
    ["standard base64 padding", "aGVsbG8=.aGVsbG8="],
    ["base64 plus and slash", "a+b/c.a+b/c"]
  ];

  bad.forEach(([label, value]) => {
    it(`rejects ${label} as malformed`, () => {
      const result = verifyCertificateOffline(value, KEYS.publicKey, AT);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, REASONS.MALFORMED);
    });
  });

  it("rejects a non string qr", () => {
    assert.strictEqual(verifyCertificateOffline(null, KEYS.publicKey, AT).reason, REASONS.MALFORMED);
    assert.strictEqual(verifyCertificateOffline(42, KEYS.publicKey, AT).reason, REASONS.MALFORMED);
  });

  it("rejects signed bytes that are not JSON", () => {
    const bytes = Buffer.from("this is signed but it is not json");
    const qr = buildQrPayload(bytes, crypto.sign(null, bytes, KEYS.privateKey));
    assert.strictEqual(verifyCertificateOffline(qr, KEYS.publicKey, AT).reason, REASONS.MALFORMED);
  });

  it("rejects signed JSON that is not an object", () => {
    const bytes = Buffer.from("[1,2,3]");
    const qr = buildQrPayload(bytes, crypto.sign(null, bytes, KEYS.privateKey));
    assert.strictEqual(verifyCertificateOffline(qr, KEYS.publicKey, AT).reason, REASONS.MALFORMED);
  });

  it("rejects a signed payload missing required fields", () => {
    const bytes = canonicalize({ v: 1, k: TEST_KEY_ID });
    const qr = buildQrPayload(bytes, crypto.sign(null, bytes, KEYS.privateKey));
    const result = verifyCertificateOffline(qr, KEYS.publicKey, AT);

    assert.strictEqual(result.reason, REASONS.MALFORMED);
    assert.match(result.message, /missing/);
  });

  it("rejects an unknown payload version", () => {
    const result = verifyCertificateOffline(signed({ v: 99 }).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.reason, REASONS.UNKNOWN_VERSION);
  });

  it("rejects a non numeric expiry", () => {
    const result = verifyCertificateOffline(signed({ e: "next year" }).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.reason, REASONS.MALFORMED);
  });
});

describe("Expiry", () => {
  const nowSeconds = Math.floor(FIXED_NOW / 1000);

  it("accepts a certificate that has not expired", () => {
    const result = verifyCertificateOffline(signed({ e: nowSeconds + 86400 }).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.noExpiry, false);
  });

  it("rejects an expired certificate", () => {
    const result = verifyCertificateOffline(signed({ e: nowSeconds - 1 }).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, REASONS.EXPIRED);
  });

  it("accepts a certificate expiring exactly now", () => {
    const result = verifyCertificateOffline(signed({ e: nowSeconds }).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, true, "boundary is inclusive");
  });

  it("accepts a certificate with no expiry and flags it", () => {
    const result = verifyCertificateOffline(signed({ e: null }).qr, KEYS.publicKey, AT);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.noExpiry, true);
  });

  it("uses the injected clock, never the wall clock", () => {
    const qr = signed({ e: nowSeconds + 10 }).qr;
    assert.strictEqual(verifyCertificateOffline(qr, KEYS.publicKey, { now: FIXED_NOW }).valid, true);
    assert.strictEqual(
      verifyCertificateOffline(qr, KEYS.publicKey, { now: FIXED_NOW + 60000 }).reason,
      REASONS.EXPIRED
    );
  });

  it("computeExpiry returns null while recert_months is unset", () => {
    assert.strictEqual(computeExpiry(FIXED_NOW, null), null);
    assert.strictEqual(computeExpiry(FIXED_NOW, undefined), null);
  });

  it("computeExpiry adds whole months when the team has set one", () => {
    const twelve = computeExpiry(Date.parse("2026-09-03T12:00:00.000Z"), 12);
    assert.strictEqual(new Date(twelve * 1000).toISOString(), "2027-09-03T12:00:00.000Z");
  });
});

describe("Key loading", () => {
  let dir = null;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-keys-"));
    fs.writeFileSync(path.join(dir, "pub.pem"), TEST_PUBLIC_KEY_PEM, "utf8");
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("loads a base64 pkcs8 private key", () => {
    assert.strictEqual(loadPrivateKey(TEST_PRIVATE_KEY_B64).asymmetricKeyType, "ed25519");
  });

  it("refuses an empty or junk private key", () => {
    assert.throws(() => loadPrivateKey(""), /CERT_PRIVATE_KEY is empty/);
    assert.throws(() => loadPrivateKey("not-base64-key"), /not a valid base64 PKCS8/);
  });

  it("loads a public key from a pem file", () => {
    assert.strictEqual(loadPublicKeyFromFile(path.join(dir, "pub.pem")).asymmetricKeyType, "ed25519");
  });

  it("says which file is missing", () => {
    assert.throws(() => loadPublicKeyFromFile(path.join(dir, "nope.pem")), /cannot read public key/);
  });

  it("loads a matching pair", () => {
    const keys = loadSigningKeys({
      certPrivateKey: TEST_PRIVATE_KEY_B64,
      certPublicKeyPath: path.join(dir, "pub.pem")
    });
    assert.strictEqual(keys.keyId, TEST_KEY_ID);
    assert.strictEqual(keys.algo, "Ed25519");
  });

  it("refuses a private key that does not match the public key file", () => {
    assert.throws(
      () =>
        loadSigningKeys({
          certPrivateKey: require("./fixtures/certs").OTHER_PRIVATE_KEY_B64,
          certPublicKeyPath: path.join(dir, "pub.pem")
        }),
      /are not a pair/
    );
  });
});

describe("Certificate issuance and persistence", () => {
  let dir = null;
  let db = null;

  const PASSED_ATTEMPT = "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51";
  const FAILED_ATTEMPT = "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64";

  function insertAttempt(attemptId, passed, percentage) {
    db.prepare(
      `INSERT INTO attempt (
         attempt_id, worker_id, module_id, module_version, contract_version,
         started_at, completed_at, duration_ms, status,
         server_total_score, server_max_score, server_percentage, server_passed,
         threshold_applied, client_percentage, client_passed, server_received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      attemptId, "WRK-0001", "fire-response", 1, "1.0",
      "2026-09-03T10:00:00.000Z", "2026-09-03T10:03:00.000Z", 180000, "completed",
      percentage / 100 * 3, 3, percentage, passed ? 1 : 0,
      0.7, percentage, passed ? 1 : 0, "2026-09-03T10:05:00.000Z"
    );
  }

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-cert-"));
    db = initDatabase(path.join(dir, "cert-test.db"));
  });

  beforeEach(() => {
    db.exec("DELETE FROM certificate; DELETE FROM checkpoint_result; DELETE FROM attempt;");
    seedDatabase(db);
    insertAttempt(PASSED_ATTEMPT, true, 91.67);
    insertAttempt(FAILED_ATTEMPT, false, 42);
  });

  after(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("issues a certificate for a passed attempt", () => {
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });

    assert.match(cert.certId, /^SAFEAR-[0-9A-F]{16}$/);
    assert.strictEqual(cert.algo, "Ed25519");
    assert.strictEqual(cert.keyId, TEST_KEY_ID);
    assert.ok(cert.qr.includes("."));
  });

  it("takes the score from the server result, never a client claim", () => {
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });
    assert.strictEqual(cert.payload.s, 9167, "91.67 percent must become 9167 basis points");
  });

  it("stores the row with key_id and the attempt link", () => {
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });
    const row = db.prepare("SELECT * FROM certificate WHERE cert_id = ?").get(cert.certId);

    assert.strictEqual(row.attempt_id, PASSED_ATTEMPT);
    assert.strictEqual(row.worker_id, "WRK-0001");
    assert.strictEqual(row.algo, "Ed25519");
    assert.strictEqual(row.key_id, TEST_KEY_ID);
    assert.strictEqual(row.score, 91.67);
    assert.strictEqual(row.revoked, 0);
  });

  it("stores the exact signed bytes as payload_json", () => {
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });
    const row = db.prepare("SELECT payload_json FROM certificate WHERE cert_id = ?").get(cert.certId);

    assert.strictEqual(row.payload_json, canonicalize(cert.payload).toString());
  });

  it("issues a certificate that verifies", () => {
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });
    const result = verifyCertificateOffline(cert.qr, KEYS.publicKey, { now: FIXED_NOW, expectedKeyId: TEST_KEY_ID });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.payload.c, cert.certId);
  });

  it("refuses a failed attempt", () => {
    assert.throws(
      () => issueCertificateForAttempt(db, { attemptId: FAILED_ATTEMPT, keys: KEYS, now: FIXED_NOW }),
      (err) => err instanceof CertificateIssueError && err.code === ISSUE_ERRORS.ATTEMPT_NOT_PASSED
    );
  });

  it("stores nothing when it refuses a failed attempt", () => {
    try {
      issueCertificateForAttempt(db, { attemptId: FAILED_ATTEMPT, keys: KEYS, now: FIXED_NOW });
    } catch (_err) { /* expected */ }
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n, 0);
  });

  it("refuses a second certificate for the same attempt", () => {
    issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });

    assert.throws(
      () => issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW }),
      (err) => err instanceof CertificateIssueError && err.code === ISSUE_ERRORS.ALREADY_ISSUED
    );
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n, 1);
  });

  it("refuses an attempt that does not exist", () => {
    assert.throws(
      () =>
        issueCertificateForAttempt(db, {
          attemptId: "11111111-2222-4333-8444-555566667777",
          keys: KEYS,
          now: FIXED_NOW
        }),
      (err) => err instanceof CertificateIssueError && err.code === ISSUE_ERRORS.ATTEMPT_NOT_FOUND
    );
  });

  it("issues with no expiry while recert_months is NULL", () => {
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });
    const row = db.prepare("SELECT expires_at FROM certificate WHERE cert_id = ?").get(cert.certId);

    assert.strictEqual(cert.payload.e, null, "no Mines Act figure may be invented");
    assert.strictEqual(row.expires_at, null);
  });

  it("issues with an expiry once the team sets recert_months", () => {
    db.prepare("UPDATE module SET recert_months = 12 WHERE module_id = ?").run("fire-response");
    const cert = issueCertificateForAttempt(db, { attemptId: PASSED_ATTEMPT, keys: KEYS, now: FIXED_NOW });

    assert.strictEqual(typeof cert.payload.e, "number");
    assert.strictEqual(new Date(cert.payload.e * 1000).toISOString(), "2027-09-03T12:00:00.000Z");
  });

  it("gives every certificate a different id", () => {
    const ids = new Set([generateCertId(), generateCertId(), generateCertId()]);
    assert.strictEqual(ids.size, 3);
  });
});

describe("Payload helpers", () => {
  it("converts a percentage to integer basis points", () => {
    assert.strictEqual(toBasisPoints(91.67), 9167);
    assert.strictEqual(toBasisPoints(100), 10000);
    assert.strictEqual(toBasisPoints(0), 0);
  });

  it("builds a payload carrying the declared version", () => {
    const payload = buildCertificatePayload({
      certId: "SAFEAR-A3F1C9E25B474D18",
      keyId: TEST_KEY_ID,
      attempt: { worker_id: "WRK-0001", module_id: "fire-response", server_percentage: 91.67 },
      recertMonths: null,
      issuedAtMs: FIXED_NOW
    });

    assert.strictEqual(payload.v, CERT_PAYLOAD_VERSION);
    assert.strictEqual(payload.k, TEST_KEY_ID);
    assert.strictEqual(payload.s, 9167);
    assert.strictEqual(payload.e, null);
  });

  it("keeps the qr small enough to scan on a cheap camera", () => {
    const qr = signed().qr;
    assert.ok(qr.length < 300, `qr string was ${qr.length} chars`);
    assert.ok(toBase64Url(Buffer.from("x")).length > 0);
  });
});
