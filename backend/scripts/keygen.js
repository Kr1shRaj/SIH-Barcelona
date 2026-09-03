const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { deriveKeyId } = require("../services/certs/canonical");

const KEYS_DIR = path.join(__dirname, "..", "keys");
const PUBLIC_KEY_FILE = path.join(KEYS_DIR, "cert-signing.public.pem");

// make a fresh ed25519 signing pair.
//
// deliberately NOT seeded. AGENTS.md asks for reproducible randomness so demo
// data comes out the same every run — that rule is about demo data. A signing key
// that anyone could reproduce would be no key at all.
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyBase64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    keyId: deriveKeyId(publicKey)
  };
}

// write the public half, hand the private half back for the operator to paste
function writePublicKey(publicKeyPem) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(PUBLIC_KEY_FILE, publicKeyPem, "utf8");
  return PUBLIC_KEY_FILE;
}

// cli entry: npm run keygen
if (require.main === module) {
  if (fs.existsSync(PUBLIC_KEY_FILE) && process.argv.indexOf("--force") === -1) {
    // overwriting the public key silently would orphan every certificate already issued
    process.stdout.write(
      `Refusing to overwrite ${PUBLIC_KEY_FILE}\n` +
        "Every certificate signed with the current key would stop verifying.\n" +
        "Pass --force if you really mean to rotate.\n"
    );
    process.exit(1);
  }

  const { privateKeyBase64, publicKeyPem, keyId } = generateKeyPair();
  const written = writePublicKey(publicKeyPem);

  process.stdout.write(
    "\nSafeAR certificate signing key generated.\n\n" +
      `  key id      ${keyId}\n` +
      `  public key  ${written}   (commit this, it is not a secret)\n\n` +
      "Put this line in your .env, and never commit it:\n\n" +
      `CERT_PRIVATE_KEY=${privateKeyBase64}\n\n`
  );
}

module.exports = { generateKeyPair, writePublicKey, PUBLIC_KEY_FILE, KEYS_DIR };
