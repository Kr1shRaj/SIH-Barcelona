const crypto = require("node:crypto");
const { splitQrPayload, CERT_PAYLOAD_VERSION } = require("./canonical");

// every way a certificate can be turned down, one code each
const REASONS = Object.freeze({
  OK: "ok",
  MALFORMED: "malformed",
  BAD_SIGNATURE: "bad_signature",
  UNKNOWN_VERSION: "unknown_version",
  UNKNOWN_KEY: "unknown_key",
  EXPIRED: "expired"
});

// fields a signed payload must carry before we will believe it
const REQUIRED_FIELDS = ["v", "k", "c", "w", "m", "s", "i"];

function _fail(reason, message) {
  return { valid: false, reason, message };
}

// verify cert signature offline with key.
//
// the order here is the whole point and must not be rearranged:
//   1. split the qr and decode the two halves
//   2. verify the signature over the EXACT decoded bytes
//   3. only then parse the json
//
// parsing first and re-serializing would let a payload verify that is not the
// one that was signed, because key order and spacing would be ours, not theirs.
function verifyCertificateOffline(qrPayload, publicKey, options = {}) {
  if (!publicKey) {
    throw new Error("a public key is required to verify a certificate");
  }

  let payloadBytes;
  let signatureBytes;
  try {
    ({ payloadBytes, signatureBytes } = splitQrPayload(qrPayload));
  } catch (err) {
    return _fail(REASONS.MALFORMED, err.message);
  }

  // step 2, before anything looks inside the payload
  let signatureOk;
  try {
    signatureOk = crypto.verify(null, payloadBytes, publicKey, signatureBytes);
  } catch (err) {
    return _fail(REASONS.BAD_SIGNATURE, `signature could not be checked: ${err.message}`);
  }

  if (!signatureOk) {
    return _fail(REASONS.BAD_SIGNATURE, "signature does not match the payload");
  }

  // step 3, the bytes are trusted now so it is safe to read them
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch (err) {
    return _fail(REASONS.MALFORMED, `signed payload is not valid JSON: ${err.message}`);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return _fail(REASONS.MALFORMED, "signed payload is not an object");
  }

  const missing = REQUIRED_FIELDS.filter((field) => payload[field] === undefined);
  if (missing.length > 0) {
    return _fail(REASONS.MALFORMED, `signed payload is missing ${missing.join(", ")}`);
  }

  if (payload.v !== CERT_PAYLOAD_VERSION) {
    return _fail(
      REASONS.UNKNOWN_VERSION,
      `certificate payload version ${payload.v} is not understood, this build reads v${CERT_PAYLOAD_VERSION}`
    );
  }

  // single key deployment, so we verify first and check the id after. a multi key
  // setup would instead read k first to pick which public key to try.
  if (options.expectedKeyId && payload.k !== options.expectedKeyId) {
    return _fail(
      REASONS.UNKNOWN_KEY,
      `certificate was signed by key ${payload.k}, this verifier holds ${options.expectedKeyId}`
    );
  }

  // e is null while the recertification period is unsettled, that is not an error
  const noExpiry = payload.e === null || payload.e === undefined;
  if (!noExpiry) {
    if (typeof payload.e !== "number" || !Number.isFinite(payload.e)) {
      return _fail(REASONS.MALFORMED, "expiry must be a unix timestamp in seconds or null");
    }
    const nowSeconds = Math.floor((typeof options.now === "number" ? options.now : Date.now()) / 1000);
    if (payload.e < nowSeconds) {
      return _fail(REASONS.EXPIRED, `certificate expired at unix ${payload.e}`);
    }
  }

  return {
    valid: true,
    reason: REASONS.OK,
    payload,
    noExpiry
  };
}

module.exports = { verifyCertificateOffline, REASONS, REQUIRED_FIELDS };
