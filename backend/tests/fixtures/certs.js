const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");

// FIXED TEST KEYPAIRS — tests only, never production.
// Hardcoded on purpose so signatures are byte identical on every run and every
// machine. Generating a pair per run would make signature assertions untestable.
// These keys sign nothing real and are safe to commit.
const TEST_PRIVATE_KEY_B64 =
  "MC4CAQAwBQYDK2VwBCIEIKUCvrqTQQPp3A21S8fA+7F6tKlr2VW+gGWDywjsQv9c";

const TEST_PUBLIC_KEY_PEM =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MCowBQYDK2VwAyEAyEEXSK+T9Xy62bkLa7KElHSdpJKC2BH3hm+tx1eSOl8=\n" +
  "-----END PUBLIC KEY-----\n";

// a second, unrelated pair for the wrong key tests
const OTHER_PRIVATE_KEY_B64 =
  "MC4CAQAwBQYDK2VwBCIEIHFbtnC0FdWCXYcUM+9H8Oo49VjisG1GhKjOFMgewfyq";

const TEST_KEY_ID = "V5WoSvuQCY48";
const OTHER_KEY_ID = "tqroOqAylADg";

// a clock the tests can pin so expiry never depends on when they run
const FIXED_NOW = Date.parse("2026-09-03T12:00:00.000Z");

function privateKey(base64 = TEST_PRIVATE_KEY_B64) {
  return crypto.createPrivateKey({
    key: Buffer.from(base64, "base64"),
    format: "der",
    type: "pkcs8"
  });
}

function publicKey(pem = TEST_PUBLIC_KEY_PEM) {
  return crypto.createPublicKey(pem);
}

// the bundle issue.js expects
function testKeys() {
  return {
    privateKey: privateKey(),
    publicKey: publicKey(),
    keyId: TEST_KEY_ID,
    algo: "Ed25519"
  };
}

function otherKeys() {
  const priv = privateKey(OTHER_PRIVATE_KEY_B64);
  return {
    privateKey: priv,
    publicKey: crypto.createPublicKey(priv),
    keyId: OTHER_KEY_ID,
    algo: "Ed25519"
  };
}

// a valid signed payload, before any test bends it out of shape
function samplePayload(overrides) {
  return Object.assign(
    {
      v: 1,
      k: TEST_KEY_ID,
      c: "SAFEAR-A3F1C9E25B474D18",
      w: "WRK-0001",
      m: "fire-response",
      s: 9167,
      i: Math.floor(FIXED_NOW / 1000),
      e: null
    },
    overrides || {}
  );
}

module.exports = {
  TEST_PRIVATE_KEY_B64,
  TEST_PUBLIC_KEY_PEM,
  OTHER_PRIVATE_KEY_B64,
  TEST_KEY_ID,
  OTHER_KEY_ID,
  FIXED_NOW,
  privateKey,
  publicKey,
  testKeys,
  otherKeys,
  samplePayload
};
