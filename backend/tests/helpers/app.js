process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDatabase, closeDatabase } = require("../../db/index");
const { seedDatabase } = require("../../db/seed");
const { createApp } = require("../../app");
const { testKeys } = require("../fixtures/certs");

// config the app needs, without touching a real .env
const TEST_CONFIG = Object.freeze({
  nodeEnv: "test",
  // a real value on purpose. leaving it undefined would let the admin gate compare
  // undefined against undefined and wave every unauthenticated request through,
  // so the suite would pass while the routes were wide open.
  adminApiKey: "test_admin_key_not_a_real_secret",
  allowedOrigins: Object.freeze([
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost",
    "https://localhost",
    "capacitor://localhost"
  ]),
  bodyLimit: "1mb"
});

// fresh seeded database plus an app wired to it, no port and no network
function buildTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-api-"));
  const db = initDatabase(path.join(dir, "api-test.db"));
  seedDatabase(db);

  const app = createApp({ db, config: TEST_CONFIG, keys: testKeys() });

  function cleanup() {
    closeDatabase();
    // windows releases the wal and shm locks a beat late, so retry the wipe
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  return { app, db, dir, cleanup };
}

module.exports = { buildTestApp, TEST_CONFIG };
