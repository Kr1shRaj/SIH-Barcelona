const crypto = require("node:crypto");
const QRCode = require("qrcode");
const { canonicalize, buildQrPayload } = require("./canonical");
const { ALGO } = require("./keys");

// sign cert payload with ed25519 key and make qr code
function signCertificate(payload, privateKey) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("certificate payload must be an object");
  }
  if (!privateKey) {
    throw new Error("a private key is required to sign a certificate");
  }

  const canonical = canonicalize(payload);

  // null algorithm because ed25519 does its own hashing internally
  const signature = crypto.sign(null, canonical, privateKey);

  return {
    payload,
    canonical,
    signature,
    algo: ALGO,
    keyId: payload.k,
    qr: buildQrPayload(canonical, signature)
  };
}

// turn the qr string into a scannable image.
// error correction Q gives 25 percent damage tolerance, which a cracked phone
// screen down a mine actually needs.
async function renderCertificateQr(qrPayload, options = {}) {
  return QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: options.errorCorrectionLevel || "Q",
    margin: options.margin === undefined ? 2 : options.margin,
    width: options.width || 320
  });
}

module.exports = { signCertificate, renderCertificateQr };
