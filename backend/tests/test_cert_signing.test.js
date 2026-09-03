/**
 * SafeAR Certificate Signing and Tamper Verification Test Suite
 *
 * This file is the plain-language statement of how a SafeAR certificate proves it is
 * genuine. It is deliberately small and heavily commented: the exhaustive edge-case
 * coverage lives in services_certs.test.js, whereas this file exists so that a reader
 * who has never seen the codebase can understand the tamper-detection scheme by
 * reading one file.
 *
 * The scheme
 * ----------
 * Certificates are signed with Ed25519, an asymmetric signature scheme. This matters:
 *
 *   - The PRIVATE key lives only on the server, in .env, and never leaves it.
 *     It is the only thing in the system that can create a valid certificate.
 *   - The PUBLIC key is committed to the repository and shipped inside the app.
 *     It can verify a certificate but cannot create one.
 *
 * That asymmetry is the whole point. A symmetric scheme such as HMAC would require the
 * phone to hold the same secret that signs, which would mean any worker who extracted
 * the key from the APK could mint their own certificates. With Ed25519, a phone that is
 * fully reverse-engineered still cannot forge anything, and a mine inspector can verify
 * a worker's certificate independently without any access to SafeAR's servers.
 *
 * What is signed
 * --------------
 * A compact payload: version, key id, certificate id, worker id, module id, score in
 * integer basis points, issued-at and expires-at as Unix seconds. It is serialised to
 * canonical JSON — keys sorted, no whitespace — so that the same certificate always
 * produces the exact same bytes.
 *
 * The QR code carries:  base64url(canonicalPayload) "." base64url(signature)
 *
 * The rule that makes verification sound
 * --------------------------------------
 * Verification decodes the payload half of the QR and checks the signature against
 * THOSE EXACT BYTES, before parsing the JSON. It never parses the payload and
 * re-serialises it. If it did, the bytes being verified would be ours rather than the
 * ones that were actually signed, and a certificate could be altered in ways the
 * signature check would not notice. Signature first, parse second — never the reverse.
 *
 * Tamper detection therefore needs no special logic. Changing any byte of the payload
 * changes the message the signature was computed over, and Ed25519 verification fails.
 * The tests below demonstrate that directly.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { signCertificate } = require("../services/certs/signer");
const { verifyCertificateOffline, REASONS } = require("../services/certs/verifier");
const { canonicalize, buildQrPayload } = require("../services/certs/canonical");
const { testKeys, otherKeys, samplePayload, FIXED_NOW } = require("./fixtures/certs");

// A fixed keypair and a pinned clock, so every run produces byte-identical signatures
// and expiry never depends on when the suite happens to execute.
const AUTHORITY = testKeys();
const AT = { now: FIXED_NOW };

describe("Certificate Signing and Tamper Verification", () => {
  it("should generate a verifiable signature for valid training completion", () => {
    // A worker passes a module, so the server signs a certificate payload with the
    // private key that only it holds.
    const certificate = signCertificate(samplePayload(), AUTHORITY.privateKey);

    // Ed25519 signatures are always 64 bytes, and the QR is the two base64url halves
    // joined by a dot.
    assert.strictEqual(certificate.algo, "Ed25519");
    assert.strictEqual(certificate.signature.length, 64);
    assert.strictEqual(certificate.qr.split(".").length, 2);

    // Anyone holding the public key can now confirm the certificate is genuine. This is
    // the offline path: no network, no database, just the QR and the public key.
    const result = verifyCertificateOffline(certificate.qr, AUTHORITY.publicKey, AT);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.reason, REASONS.OK);

    // The payload is only returned once the signature has already passed, so every field
    // read from it is one the authority actually signed.
    assert.strictEqual(result.payload.w, "WRK-0001");
    assert.strictEqual(result.payload.m, "fire-response");
    assert.strictEqual(result.payload.s, 9167); // 91.67% stored as basis points

    // Online verification layers a database lookup on top of this same check, to confirm
    // the certificate exists in the issuing records and has not been revoked. That lookup
    // is covered in services_certs.test.js; the signature check itself is identical.
  });

  it("should detect and reject tampered certificate data (e.g. modified score or worker ID)", () => {
    // Start from a genuine certificate signed by the authority.
    const genuine = signCertificate(samplePayload(), AUTHORITY.privateKey);
    assert.strictEqual(verifyCertificateOffline(genuine.qr, AUTHORITY.publicKey, AT).valid, true);

    // Now forge two variants. In each case the attacker edits one field and re-packages
    // the QR, but cannot produce a matching signature because they do not hold the
    // private key. They are forced to reuse the original signature.

    // Attack 1: inflate the score from 91.67% to a perfect 100%.
    const inflatedScore = Object.assign({}, genuine.payload, { s: 10000 });
    const forgedScoreQr = buildQrPayload(canonicalize(inflatedScore), genuine.signature);

    const scoreResult = verifyCertificateOffline(forgedScoreQr, AUTHORITY.publicKey, AT);
    assert.strictEqual(scoreResult.valid, false);
    assert.strictEqual(scoreResult.reason, REASONS.BAD_SIGNATURE);

    // Attack 2: transfer the certificate to a different worker.
    const stolenIdentity = Object.assign({}, genuine.payload, { w: "WRK-9999" });
    const forgedWorkerQr = buildQrPayload(canonicalize(stolenIdentity), genuine.signature);

    const workerResult = verifyCertificateOffline(forgedWorkerQr, AUTHORITY.publicKey, AT);
    assert.strictEqual(workerResult.valid, false);
    assert.strictEqual(workerResult.reason, REASONS.BAD_SIGNATURE);

    // Note what is NOT required here: there is no list of protected fields and no
    // per-field comparison. The signature covers the whole byte string, so altering any
    // part of it — including fields added in future versions — breaks verification
    // automatically. Tamper detection cannot fall out of date.
  });

  it("should reject certificates signed with an invalid or unauthorized key", () => {
    // An attacker with their own valid Ed25519 keypair signs a payload that looks
    // entirely correct. The cryptography is sound; the key simply is not ours.
    const impostor = otherKeys();
    const forged = signCertificate(samplePayload({ k: impostor.keyId }), impostor.privateKey);

    // Against SafeAR's public key the signature does not verify, so the certificate is
    // refused. Possessing a well-formed certificate is not enough; it has to have been
    // signed by the authority.
    const result = verifyCertificateOffline(forged.qr, AUTHORITY.publicKey, AT);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, REASONS.BAD_SIGNATURE);

    // The same payload verifies perfectly against the impostor's own public key, which
    // confirms the rejection above is about key trust rather than a malformed payload.
    assert.strictEqual(verifyCertificateOffline(forged.qr, impostor.publicKey, AT).valid, true);

    // A certificate also carries the id of the key that signed it. When a verifier is
    // told which key to expect, a certificate from an unrecognised key is reported as
    // an unknown key rather than a bad signature — a clearer diagnosis for whoever is
    // holding the scanner, and the hook that key rotation will later use.
    const keyIdResult = verifyCertificateOffline(forged.qr, impostor.publicKey, {
      now: FIXED_NOW,
      expectedKeyId: AUTHORITY.keyId
    });
    assert.strictEqual(keyIdResult.valid, false);
    assert.strictEqual(keyIdResult.reason, REASONS.UNKNOWN_KEY);
  });
});
