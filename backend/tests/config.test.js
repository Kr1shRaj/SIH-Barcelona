const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadConfig, REQUIRED_VARS } = require("../config");

// full valid env, tests override one key at a time
function baseEnv(overrides) {
  return Object.assign(
    {
      NODE_ENV: "test",
      PORT: "3000",
      LOG_LEVEL: "silent",
      DB_PATH: "./data/test.db",
      CERT_SIGNING_SECRET: "unit_test_secret_value",
      CERT_ISSUER: "SafeAR-Test-Authority",
      ADMIN_API_KEY: "unit_test_admin_key"
    },
    overrides || {}
  );
}

describe("Backend config loader", () => {
  it("builds a frozen config from a complete env", () => {
    const config = loadConfig(baseEnv());

    assert.strictEqual(config.nodeEnv, "test");
    assert.strictEqual(config.isProduction, false);
    assert.strictEqual(config.port, 3000);
    assert.strictEqual(config.logLevel, "silent");
    assert.strictEqual(config.certIssuer, "SafeAR-Test-Authority");
    assert.ok(Object.isFrozen(config), "config must be frozen");
  });

  it("resolves a relative DB_PATH into an absolute path under backend/", () => {
    const config = loadConfig(baseEnv({ DB_PATH: "./data/test.db" }));

    assert.ok(path.isAbsolute(config.dbPath), "dbPath must be absolute");
    assert.ok(
      config.dbPath.endsWith(path.join("data", "test.db")),
      `dbPath should end with data/test.db, got ${config.dbPath}`
    );
  });

  it("leaves an absolute DB_PATH untouched", () => {
    const absolute = path.resolve(path.sep, "tmp", "safear-abs.db");
    const config = loadConfig(baseEnv({ DB_PATH: absolute }));

    assert.strictEqual(config.dbPath, absolute);
  });

  it("throws naming any required env var that is missing", () => {
    REQUIRED_VARS.forEach((key) => {
      const env = baseEnv();
      delete env[key];

      assert.throws(
        () => loadConfig(env),
        new RegExp(`missing required env vars.*${key}`),
        `removing ${key} must throw`
      );
    });
  });

  it("throws when a required env var is only whitespace", () => {
    assert.throws(
      () => loadConfig(baseEnv({ CERT_SIGNING_SECRET: "   " })),
      /missing required env vars.*CERT_SIGNING_SECRET/
    );
  });

  it("throws on a non-numeric or out-of-range PORT", () => {
    assert.throws(() => loadConfig(baseEnv({ PORT: "not-a-port" })), /PORT must be integer/);
    assert.throws(() => loadConfig(baseEnv({ PORT: "0" })), /PORT must be integer/);
    assert.throws(() => loadConfig(baseEnv({ PORT: "70000" })), /PORT must be integer/);
  });

  it("applies defaults for NODE_ENV, PORT and LOG_LEVEL when absent", () => {
    const env = baseEnv();
    delete env.NODE_ENV;
    delete env.PORT;
    delete env.LOG_LEVEL;

    const config = loadConfig(env);
    assert.strictEqual(config.nodeEnv, "development");
    assert.strictEqual(config.port, 3000);
    assert.strictEqual(config.logLevel, "info");
  });

  it("refuses to boot in production while a .env.example placeholder is still set", () => {
    assert.throws(
      () =>
        loadConfig(
          baseEnv({
            NODE_ENV: "production",
            CERT_SIGNING_SECRET: "change_me_to_a_secure_random_secret_in_production"
          })
        ),
      /CERT_SIGNING_SECRET still holds the .env.example placeholder/
    );
  });

  it("warns but still boots in dev while a placeholder secret is set", () => {
    const config = loadConfig(
      baseEnv({
        NODE_ENV: "development",
        CERT_SIGNING_SECRET: "change_me_to_a_secure_random_secret_in_production",
        ADMIN_API_KEY: "change_me_admin_api_key"
      })
    );

    assert.strictEqual(config.warnings.length, 2);
    assert.ok(config.warnings.some((w) => w.indexOf("CERT_SIGNING_SECRET") === 0));
    assert.ok(config.warnings.some((w) => w.indexOf("ADMIN_API_KEY") === 0));
  });

  it("reports no warnings when real secrets are set", () => {
    const config = loadConfig(baseEnv());
    assert.strictEqual(config.warnings.length, 0);
  });
});
