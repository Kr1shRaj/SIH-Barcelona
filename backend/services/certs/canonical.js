const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");

// payload shape version. bump only when the field set changes.
const CERT_PAYLOAD_VERSION = 1;

// ed25519 signatures are always this long, anything else is not one
const ED25519_SIGNATURE_BYTES = 64;

// the two halves of a qr string are joined by this
const QR_SEPARATOR = ".";

// deterministic bytes for a payload. sorted keys, no whitespace.
// signer and verifier both go through here so they can never drift apart.
function canonicalize(payload) {
  const sortedKeys = Object.keys(payload).sort();
  return Buffer.from(JSON.stringify(payload, sortedKeys), "utf8");
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

// strict decode. base64url never contains + / or =, so reject those outright
// instead of letting Buffer quietly skip characters it does not understand.
function fromBase64Url(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("expected a non empty base64url string");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error("not valid base64url");
  }
  return Buffer.from(text, "base64url");
}

// key id is derived from the public key itself, so anyone holding the key can
// recompute it and confirm the match. no registry needed.
function deriveKeyId(publicKey) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  // last 32 bytes of the spki wrapper are the raw ed25519 public key
  const raw = spki.subarray(spki.length - 32);
  return crypto.createHash("sha256").update(raw).digest("base64url").slice(0, 12);
}

// qr content is base64url(canonical payload) . base64url(signature)
function buildQrPayload(canonicalBytes, signature) {
  return toBase64Url(canonicalBytes) + QR_SEPARATOR + toBase64Url(signature);
}

// pull a qr string back apart. returns the raw signed bytes untouched —
// the caller must verify these exact bytes, never a re-serialized object.
function splitQrPayload(qrPayload) {
  if (typeof qrPayload !== "string" || qrPayload.length === 0) {
    throw new Error("qr payload must be a non empty string");
  }

  const parts = qrPayload.split(QR_SEPARATOR);
  if (parts.length !== 2) {
    throw new Error(`qr payload must have exactly two parts separated by "${QR_SEPARATOR}"`);
  }

  const payloadBytes = fromBase64Url(parts[0]);
  const signatureBytes = fromBase64Url(parts[1]);

  if (signatureBytes.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error(`signature must be ${ED25519_SIGNATURE_BYTES} bytes, got ${signatureBytes.length}`);
  }

  return { payloadBytes, signatureBytes };
}

module.exports = {
  canonicalize,
  toBase64Url,
  fromBase64Url,
  deriveKeyId,
  buildQrPayload,
  splitQrPayload,
  CERT_PAYLOAD_VERSION,
  ED25519_SIGNATURE_BYTES,
  QR_SEPARATOR
};
