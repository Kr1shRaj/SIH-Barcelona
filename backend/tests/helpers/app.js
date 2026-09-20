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

// TEST ONLY. the shipped seed leaves the two spatial checkpoints unmeasured, so
// nothing can certify until a real device angle exists. this hands the suite a
// configured manifest to exercise the certifiable path. the number is a test
// fixture and must never be copied into db/seed.js.
const TEST_ONLY_ANGULAR_ERROR_RAD = 0.35;

// pretend somebody measured the spatial checkpoints on real hardware
function measureSpatialCheckpoints(db) {
  db.prepare(
    "UPDATE checkpoint_definition SET max_angular_error_rad = ?, gradeable = 1 WHERE observation_kind = 'spatial_alignment'"
  ).run(TEST_ONLY_ANGULAR_ERROR_RAD);
}

// TEST ONLY. Activate a roster worker and hand back a bearer token.
//
// Sync and certificate issuance now require a signed in trainee, so a suite that
// exercises them has to be somebody. This walks the real path — issue a code,
// activate with it, set a PIN — rather than writing rows directly, so the tests
// are using the same mechanism a worker would.
function activateTestTrainee(db, workerId = "WRK-0001", pin = "846215") {
  const { issueActivationCode, activateAccount } = require("../../services/accounts");
  const { code } = issueActivationCode(db, { workerId });
  return activateAccount(db, { workerId, code, pin, deviceId: "dev-test-01" });
}

// the Authorization header for a token, so a suite reads as "as this worker"
function asTrainee(session) {
  return { Authorization: `Bearer ${session.token}` };
}

module.exports = {
  buildTestApp,
  measureSpatialCheckpoints,
  TEST_CONFIG,
  TEST_ONLY_ANGULAR_ERROR_RAD,
  activateTestTrainee,
  asTrainee
};
