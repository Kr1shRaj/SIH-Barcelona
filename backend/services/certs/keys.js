const fs = require("node:fs");
const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");
const { deriveKeyId } = require("./canonical");

const ALGO = "Ed25519";

// private key arrives as base64 pkcs8 der from .env, never from a file in the repo
function loadPrivateKey(base64Pkcs8) {
  if (typeof base64Pkcs8 !== "string" || base64Pkcs8.trim().length === 0) {
    throw new Error("CERT_PRIVATE_KEY is empty — run npm run keygen and paste the value into .env");
  }

  let key;
  try {
    key = crypto.createPrivateKey({
      key: Buffer.from(base64Pkcs8.trim(), "base64"),
      format: "der",
      type: "pkcs8"
    });
  } catch (err) {
    throw new Error(`CERT_PRIVATE_KEY is not a valid base64 PKCS8 key: ${err.message}`);
  }

  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`CERT_PRIVATE_KEY must be an ed25519 key, got ${key.asymmetricKeyType}`);
  }

  return key;
}

// public key is a committed pem, it is not a secret
function loadPublicKeyFromFile(publicKeyPath) {
  let pem;
  try {
    pem = fs.readFileSync(publicKeyPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read public key at ${publicKeyPath} — run npm run keygen (${err.code})`);
  }

  let key;
  try {
    key = crypto.createPublicKey(pem);
  } catch (err) {
    throw new Error(`public key at ${publicKeyPath} is not a valid PEM key: ${err.message}`);
  }

  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`public key must be an ed25519 key, got ${key.asymmetricKeyType}`);
  }

  return key;
}

// derive the public half straight from the private key, so a mismatched pair is impossible
function publicKeyFromPrivate(privateKey) {
  return crypto.createPublicKey(privateKey);
}

// everything the signer and verifier need, loaded once at boot
function loadSigningKeys(config) {
  const privateKey = loadPrivateKey(config.certPrivateKey);
  const publicKey = loadPublicKeyFromFile(config.certPublicKeyPath);

  // a private key paired with somebody elses public key would sign certs nobody
  // can verify, so catch it here rather than at the first failed scan
  const derivedPublic = publicKeyFromPrivate(privateKey);
  if (deriveKeyId(derivedPublic) !== deriveKeyId(publicKey)) {
    throw new Error(
      "CERT_PRIVATE_KEY and the public key file are not a pair — re-run npm run keygen and update both"
    );
  }

  return { privateKey, publicKey, keyId: deriveKeyId(publicKey), algo: ALGO };
}

module.exports = {
  loadPrivateKey,
  loadPublicKeyFromFile,
  publicKeyFromPrivate,
  loadSigningKeys,
  ALGO
};
