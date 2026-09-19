const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

// real values live here. the file is gitignored and is not in a fresh clone.
const ENV_FILE = path.resolve(__dirname, "..", ".env");

// env keys backend refuse to boot without
const REQUIRED_VARS = [
  "DB_PATH",
  "CERT_PRIVATE_KEY",
  "CERT_PUBLIC_KEY_PATH",
  "CERT_ISSUER",
  "ADMIN_API_KEY"
];

// placeholder values shipped in .env.example — ok in dev, fatal in production
const TEMPLATE_VALUES = [
  "change_me_run_npm_run_keygen_and_paste_the_private_key",
  "change_me_admin_api_key"
];

// only non-secret vars get defaults, secrets never do
const DEFAULTS = {
  NODE_ENV: "development",
  PORT: "3000",
  LOG_LEVEL: "info",
  // dev server, dashboard, and the two origins a capacitor webview actually uses.
  // miss the capacitor ones and the apk cannot reach the api at all.
  ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:5174,http://localhost,https://localhost,capacitor://localhost",
  // 50 attempts x 3 checkpoints x 4kb context tops out near 600kb
  BODY_LIMIT: "1mb"
};

let _config = null;

// suck .env into process.env, real values live there and nowhere else.
// says whether the file was actually there, so a fresh clone can be told the
// difference between "you missed a variable" and "you never made the file"
function loadDotEnv() {
  dotenv.config({ path: ENV_FILE });
  return fs.existsSync(ENV_FILE);
}

// turn raw env map into frozen config, shout loud when something needed missing
function loadConfig(env) {
  const raw = env || process.env;

  const missing = REQUIRED_VARS.filter(
    (key) => !raw[key] || String(raw[key]).trim() === ""
  );
  if (missing.length > 0) {
    throw new Error(
      `missing required env vars: ${missing.join(", ")} — copy .env.example to .env and fill them` +
        '\nEach one is documented in .env.example. Setup steps: README.md, "Backend Local Setup".'
    );
  }

  const nodeEnv = raw.NODE_ENV || DEFAULTS.NODE_ENV;
  const isProduction = nodeEnv === "production";

  const port = Number.parseInt(raw.PORT || DEFAULTS.PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be integer 1-65535, got "${raw.PORT}"`);
  }

  // placeholder secret kills production boot, only warns in dev
  const warnings = [];
  REQUIRED_VARS.forEach((key) => {
    if (TEMPLATE_VALUES.indexOf(raw[key]) !== -1) {
      if (isProduction) {
        throw new Error(
          `${key} still holds the .env.example placeholder — set a real secret before running in production`
        );
      }
      warnings.push(
        `${key} still holds the .env.example placeholder — fine for local dev, never for production`
      );
    }
  });

  return Object.freeze({
    nodeEnv,
    isProduction,
    port,
    logLevel: raw.LOG_LEVEL || DEFAULTS.LOG_LEVEL,
    // relative DB_PATH resolves against backend/, so ./data/safear.db lands in backend/data
    dbPath: path.resolve(__dirname, raw.DB_PATH),
    // base64 pkcs8 ed25519 private key. lives in .env and nowhere else.
    certPrivateKey: raw.CERT_PRIVATE_KEY,
    // public key is committed, so a relative path resolves against backend/
    certPublicKeyPath: path.resolve(__dirname, raw.CERT_PUBLIC_KEY_PATH),
    certIssuer: raw.CERT_ISSUER,
    adminApiKey: raw.ADMIN_API_KEY,
    allowedOrigins: Object.freeze(
      (raw.ALLOWED_ORIGINS || DEFAULTS.ALLOWED_ORIGINS)
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    ),
    bodyLimit: raw.BODY_LIMIT || DEFAULTS.BODY_LIMIT,
    warnings: Object.freeze(warnings)
  });
}

// a fresh clone has .env.example and no .env. saying that outright saves a new
// teammate from hunting for a variable they were never going to find.
const NO_ENV_FILE_HELP =
  `\n\nThere is no .env file at ${ENV_FILE}.\n` +
  "Copy the template, then fill in the values it asks for:\n\n" +
  "  PowerShell   Copy-Item .env.example .env\n" +
  "  bash / zsh   cp .env.example .env\n\n" +
  'Full walkthrough: README.md, "Backend Local Setup".';

// lazy singleton so requiring this file never explode before env ready
function getConfig() {
  if (!_config) {
    const hasEnvFile = loadDotEnv();
    try {
      _config = loadConfig(process.env);
    } catch (err) {
      // still fail closed. the extra sentence is a signpost, not a rescue.
      // no value is echoed back, so a malformed secret cannot leak into a log.
      if (!hasEnvFile) {
        throw new Error(err.message + NO_ENV_FILE_HELP);
      }
      throw err;
    }
  }
  return _config;
}

// drop cached config, tests only
function resetConfig() {
  _config = null;
}

module.exports = {
  loadConfig,
  getConfig,
  resetConfig,
  REQUIRED_VARS,
  TEMPLATE_VALUES,
  ENV_FILE
};
