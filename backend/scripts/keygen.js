const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { deriveKeyId } = require("../services/certs/canonical");

const KEYS_DIR = path.join(__dirname, "..", "keys");

// the team key. its public half is committed, and every machine verifies against it.
const PUBLIC_KEY_FILE = path.join(KEYS_DIR, "cert-signing.public.pem");

// a key for one developer's laptop. gitignored, and only ever paired with a
// CERT_PRIVATE_KEY that never leaves that laptop. It exists so somebody can clone
// and run the backend without waiting for a teammate to send them a real secret.
// Certificates it signs verify on that machine and nowhere else — which is the
// point: a dev key must not be able to mint something the team would trust.
const DEV_PUBLIC_KEY_FILE = path.join(KEYS_DIR, "cert-signing.dev.public.pem");

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
function writePublicKey(publicKeyPem, targetFile = PUBLIC_KEY_FILE) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(targetFile, publicKeyPem, "utf8");
  return targetFile;
}

// cli entry: npm run keygen [--dev] [--force]
if (require.main === module) {
  const isDev = process.argv.indexOf("--dev") !== -1;
  const isForced = process.argv.indexOf("--force") !== -1;
  const targetFile = isDev ? DEV_PUBLIC_KEY_FILE : PUBLIC_KEY_FILE;

  if (fs.existsSync(targetFile) && !isForced) {
    // a key file is never replaced behind somebody's back. rotating the team key
    // orphans every certificate already issued; replacing a dev key silently would
    // leave a developer with a .env that no longer matches their own public half.
    process.stdout.write(
      `Refusing to overwrite ${targetFile}\n` +
        (isDev
          ? "Your local dev key already exists. The CERT_PRIVATE_KEY in your .env goes with it.\n"
          : "Every certificate signed with the current key would stop verifying.\n") +
        "Pass --force if you really mean to rotate.\n"
    );
    process.exit(1);
  }

  const { privateKeyBase64, publicKeyPem, keyId } = generateKeyPair();
  const written = writePublicKey(publicKeyPem, targetFile);

  if (isDev) {
    process.stdout.write(
      "\nSafeAR LOCAL DEV signing key generated. The team key was not touched.\n\n" +
        `  key id      ${keyId}\n` +
        `  public key  ${written}   (gitignored, local to this machine)\n\n` +
        "Put BOTH of these lines in your .env, and never commit either of them:\n\n" +
        `CERT_PRIVATE_KEY=${privateKeyBase64}\n` +
        "CERT_PUBLIC_KEY_PATH=./keys/cert-signing.dev.public.pem\n\n" +
        "Certificates you sign with this key verify on this machine only.\n" +
        "For a demo across two machines, use the shared team key instead — see README.\n\n"
    );
  } else {
    process.stdout.write(
      "\nSafeAR certificate signing key generated.\n\n" +
        `  key id      ${keyId}\n` +
        `  public key  ${written}   (commit this, it is not a secret)\n\n` +
        "Put this line in your .env, and never commit it:\n\n" +
        `CERT_PRIVATE_KEY=${privateKeyBase64}\n\n` +
        "This is the TEAM key. Everyone verifying against it needs this same private\n" +
        "key. To just run the backend on your own machine, use: npm run keygen:dev\n\n"
    );
  }
}

module.exports = { generateKeyPair, writePublicKey, PUBLIC_KEY_FILE, DEV_PUBLIC_KEY_FILE, KEYS_DIR };
