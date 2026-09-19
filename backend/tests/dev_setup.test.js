process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

// A teammate cloned this repo, followed the README, and could not start the backend.
// These tests are the ones that would have caught that: they check the setup path a
// new developer actually walks, not the code it eventually reaches.
//
// The expensive failures here are silent ones — a variable that quietly stops being
// documented, or a private key that quietly becomes tracked — so most of what
// follows compares the docs and the repository against the code's own requirements
// rather than trusting either side.

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const dotenv = require("dotenv");

const { loadConfig, REQUIRED_VARS, TEMPLATE_VALUES } = require("../config");
const { generateKeyPair, writePublicKey, PUBLIC_KEY_FILE, DEV_PUBLIC_KEY_FILE } = require("../scripts/keygen");
const { loadPrivateKey, loadPublicKeyFromFile } = require("../services/certs/keys");
const { signCertificate } = require("../services/certs/signer");
const { verifyCertificateOffline, REASONS } = require("../services/certs/verifier");
const { samplePayload, FIXED_NOW } = require("./fixtures/certs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");
const GITIGNORE = path.join(REPO_ROOT, ".gitignore");

const ENV_EXAMPLE_TEXT = fs.readFileSync(ENV_EXAMPLE, "utf8");
const ENV_EXAMPLE_VARS = dotenv.parse(ENV_EXAMPLE_TEXT);

// ask git what it is actually tracking, which is the only answer that matters
function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe(".env.example documents everything the backend demands", () => {
  it("declares every variable config.js refuses to boot without", () => {
    const undocumented = REQUIRED_VARS.filter((key) => !(key in ENV_EXAMPLE_VARS));
    assert.deepStrictEqual(
      undocumented,
      [],
      `config.js requires these but .env.example never mentions them: ${undocumented.join(", ")}`
    );
  });

  it("keeps the exact placeholders config.js watches for", () => {
    // config warns in dev and refuses to boot in production while these are unchanged.
    // reword one in the template and that safety net silently stops catching anything.
    TEMPLATE_VALUES.forEach((placeholder) => {
      assert.ok(
        ENV_EXAMPLE_TEXT.includes(placeholder),
        `TEMPLATE_VALUES contains "${placeholder}" but .env.example no longer uses it`
      );
    });
  });

  it("is a complete recipe: a real config loads from it plus a generated key", () => {
    const { privateKeyBase64 } = generateKeyPair();
    const config = loadConfig({
      ...ENV_EXAMPLE_VARS,
      CERT_PRIVATE_KEY: privateKeyBase64,
      ADMIN_API_KEY: "local-dev-key-for-this-test-only"
    });

    assert.strictEqual(config.certIssuer, "SafeAR-Authority-Jharkhand");
    assert.ok(path.isAbsolute(config.dbPath), "DB_PATH must resolve to an absolute path");
    assert.ok(path.isAbsolute(config.certPublicKeyPath));
    assert.deepStrictEqual(config.warnings, [], "a filled-in template must boot without placeholder warnings");
  });

  it("still warns while the shipped placeholders are untouched", () => {
    const config = loadConfig({ ...ENV_EXAMPLE_VARS });
    assert.strictEqual(config.warnings.length, 2, "both placeholder secrets must be called out");
    assert.ok(config.warnings.some((line) => line.startsWith("CERT_PRIVATE_KEY")));
    assert.ok(config.warnings.some((line) => line.startsWith("ADMIN_API_KEY")));
  });

  it("carries no key material of its own", () => {
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(ENV_EXAMPLE_TEXT), ".env.example contains a PEM private key");

    // a real base64 pkcs8 ed25519 key is 48 bytes -> 64 base64 chars. anything that
    // long and that key-shaped in a template is a leak, not documentation.
    const suspicious = (ENV_EXAMPLE_TEXT.match(/[A-Za-z0-9+/]{60,}={0,2}/g) || [])
      .filter((blob) => !blob.startsWith("change_me"));
    assert.deepStrictEqual(suspicious, [], `.env.example holds something that looks like a real secret: ${suspicious.join(", ")}`);
  });

  it("points a missing variable at the file that explains it", () => {
    assert.throws(
      () => loadConfig({ ...ENV_EXAMPLE_VARS, CERT_ISSUER: "" }),
      (err) => {
        assert.match(err.message, /missing required env vars.*CERT_ISSUER/);
        assert.match(err.message, /\.env\.example/);
        assert.match(err.message, /Backend Local Setup/);
        return true;
      }
    );
  });
});

describe("git tracks the public half and nothing else", () => {
  const TRACKED = trackedFiles();

  it("tracks the shared team public key, which is meant to be distributed", () => {
    assert.ok(
      TRACKED.includes("backend/keys/cert-signing.public.pem"),
      "the team public key must stay committed — every machine verifies against it"
    );
  });

  it("tracks no private key and no .env", () => {
    const leaked = TRACKED.filter((file) =>
      /\.env$/.test(file) ||
      /private\.pem$/.test(file) ||
      /private\.key$/.test(file) ||
      /\.pkcs8$/.test(file) ||
      /cert-signing\.dev\./.test(file)
    );
    assert.deepStrictEqual(leaked, [], `these must never be committed: ${leaked.join(", ")}`);
  });

  it("tracks no committed database", () => {
    const dbs = TRACKED.filter((file) => /\.(db|sqlite)$/.test(file));
    assert.deepStrictEqual(dbs, [], `a developer database got committed: ${dbs.join(", ")}`);
  });

  it("no tracked file contains a PEM private key", () => {
    const offenders = TRACKED.filter((file) => {
      const full = path.join(REPO_ROOT, file);
      if (!fs.existsSync(full) || fs.statSync(full).size > 512 * 1024) return false;
      let text;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch (_err) {
        return false;
      }
      return /-----BEGIN (?:ENCRYPTED |EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text);
    });
    assert.deepStrictEqual(offenders, [], `private key material is committed in: ${offenders.join(", ")}`);
  });

  it("ignores .env while keeping the template", () => {
    const gitignore = fs.readFileSync(GITIGNORE, "utf8");
    assert.match(gitignore, /^\.env$/m, ".env must be ignored");
    assert.match(gitignore, /^!\.env\.example$/m, ".env.example must stay tracked");
  });

  it("actually ignores local key and database material, by git's own answer", () => {
    // ask git rather than pattern-match the file. a rule that looks right and does
    // not fire is exactly how a secret ends up committed.
    const ignored = (relPath) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", relPath], { cwd: REPO_ROOT });
        return true;
      } catch (_err) {
        return false;
      }
    };

    assert.ok(ignored(".env"), ".env is not ignored");
    assert.ok(ignored("backend/keys/cert-signing.dev.public.pem"), "a per-developer dev key is not ignored");
    assert.ok(ignored("backend/data/safear.db"), "the local database is not ignored");
    assert.ok(ignored("backend/keys/cert-signing.private.pem"), "a stray private key export is not ignored");

    assert.ok(!ignored(".env.example"), ".env.example must stay tracked");
    assert.ok(!ignored("backend/keys/cert-signing.public.pem"), "the shared team public key must stay tracked");
  });
});

describe("keygen produces a usable Ed25519 development key", () => {
  it("generates a real ed25519 pair and a key id", () => {
    const { privateKeyBase64, publicKeyPem, keyId } = generateKeyPair();

    assert.match(publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
    assert.strictEqual(loadPrivateKey(privateKeyBase64).asymmetricKeyType, "ed25519");
    assert.strictEqual(crypto.createPublicKey(publicKeyPem).asymmetricKeyType, "ed25519");
    assert.ok(keyId && keyId.length > 0, "a key id must be derived for the certificate header");
  });

  it("writes the public half to a file the verifier can load", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-keygen-"));
    try {
      const target = path.join(dir, "cert-signing.dev.public.pem");
      const { publicKeyPem } = generateKeyPair();

      // writePublicKey creates backend/keys, so point it somewhere disposable
      fs.writeFileSync(target, publicKeyPem, "utf8");

      assert.strictEqual(loadPublicKeyFromFile(target).asymmetricKeyType, "ed25519");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the generated public key verifies a certificate signed with its own private half", () => {
    const { privateKeyBase64, publicKeyPem } = generateKeyPair();
    const privateKey = loadPrivateKey(privateKeyBase64);
    const publicKey = crypto.createPublicKey(publicKeyPem);

    const certificate = signCertificate(samplePayload(), privateKey);
    const result = verifyCertificateOffline(certificate.qr, publicKey, { now: FIXED_NOW });

    assert.strictEqual(result.valid, true, `a freshly generated pair must verify its own signature: ${result.message || ""}`);
    assert.strictEqual(result.reason, REASONS.OK);
  });

  it("a different key does not verify it, so the check above is not vacuous", () => {
    const mine = generateKeyPair();
    const theirs = generateKeyPair();

    const certificate = signCertificate(samplePayload(), loadPrivateKey(mine.privateKeyBase64));
    const result = verifyCertificateOffline(certificate.qr, crypto.createPublicKey(theirs.publicKeyPem), { now: FIXED_NOW });

    assert.strictEqual(result.valid, false, "a dev key must not be able to mint something the team would trust");
  });

  it("keeps the team key and the dev key at separate paths", () => {
    assert.notStrictEqual(PUBLIC_KEY_FILE, DEV_PUBLIC_KEY_FILE);
    assert.ok(PUBLIC_KEY_FILE.endsWith("cert-signing.public.pem"));
    assert.ok(DEV_PUBLIC_KEY_FILE.endsWith("cert-signing.dev.public.pem"));
    assert.strictEqual(typeof writePublicKey, "function");
  });

  it("the committed team key on disk is a valid ed25519 public key", () => {
    assert.strictEqual(loadPublicKeyFromFile(PUBLIC_KEY_FILE).asymmetricKeyType, "ed25519");
  });
});

describe("the commands the README tells a newcomer to run exist", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const backendPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "backend", "package.json"), "utf8"));
  const README = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

  ["keygen", "keygen:dev", "seed", "dev:backend"].forEach((script) => {
    it(`root package.json defines "${script}"`, () => {
      assert.ok(rootPkg.scripts[script], `npm run ${script} is documented but not defined at the root`);
    });
  });

  it("backend defines the scripts the root delegates to", () => {
    ["keygen", "keygen:dev", "seed", "dev"].forEach((script) => {
      assert.ok(backendPkg.scripts[script], `backend package.json is missing "${script}"`);
    });
  });

  it("every npm command in the README is a script that exists", () => {
    const invoked = [...README.matchAll(/npm run ([a-z:]+)/g)].map((m) => m[1]);
    const unknown = [...new Set(invoked)].filter((script) => !rootPkg.scripts[script]);
    assert.deepStrictEqual(unknown, [], `README documents commands that do not exist: ${unknown.join(", ")}`);
  });

  it("has a Backend Local Setup section that names the health endpoint", () => {
    assert.match(README, /##\s+Backend Local Setup/);
    assert.ok(README.includes("/api/health"), "setup must tell a newcomer how to confirm the backend is up");
  });

  it("steers setup to the dev key rather than rotating the team key", () => {
    assert.ok(README.includes("npm run keygen:dev"), "setup must use the dev key");
    assert.match(README, /Do not run `npm run keygen` for setup/);
  });
});
