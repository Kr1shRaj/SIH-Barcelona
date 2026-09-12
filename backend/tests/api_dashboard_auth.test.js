const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildTestApp, TEST_CONFIG } = require("./helpers/app");
const { initDatabase, closeDatabase } = require("../db/index");
const { seedDatabase } = require("../db/seed");
const { createApp } = require("../app");
const { testKeys } = require("./fixtures/certs");

let ctx = null;

// both aliases, because protecting one and forgetting the other protects nothing
const PATHS = ["/api/dashboard/compliance", "/api/dashboard"];

describe("dashboard admin authentication", () => {
  before(() => {
    ctx = buildTestApp();
  });
  after(() => ctx.cleanup());

  it("1. refuses an anonymous request on both aliases", async () => {
    for (const p of PATHS) {
      const res = await request(ctx.app).get(p);
      assert.strictEqual(res.status, 401, `${p} must refuse an anonymous caller`);
      assert.strictEqual(res.body.error.code, "unauthorized");
      assert.ok(res.body.error.requestId, "the house error envelope carries a request id");
    }
  });

  it("2. refuses a wrong key on both aliases", async () => {
    for (const p of PATHS) {
      const res = await request(ctx.app).get(p).set("x-admin-key", "not-the-key");
      assert.strictEqual(res.status, 401, `${p} must refuse a wrong key`);
      assert.strictEqual(res.body.error.code, "unauthorized");
    }
  });

  it("3. refuses an empty key", async () => {
    const res = await request(ctx.app).get("/api/dashboard/compliance").set("x-admin-key", "");
    assert.strictEqual(res.status, 401);
  });

  it("4. refuses a key that is a prefix of the real one", async () => {
    const short = TEST_CONFIG.adminApiKey.slice(0, -1);
    const res = await request(ctx.app).get("/api/dashboard/compliance").set("x-admin-key", short);
    assert.strictEqual(res.status, 401);
  });

  it("5. lets the correct key through on both aliases", async () => {
    for (const p of PATHS) {
      const res = await request(ctx.app).get(p).set("x-admin-key", TEST_CONFIG.adminApiKey);
      assert.strictEqual(res.status, 200, `${p} must serve a correctly keyed caller`);
      assert.strictEqual(typeof res.body.summary, "object");
    }
  });

  it("6. answers the same way for a missing key and a wrong key", async () => {
    // differing responses would let somebody probe for a valid key
    const missing = await request(ctx.app).get("/api/dashboard/compliance");
    const wrong = await request(ctx.app).get("/api/dashboard/compliance").set("x-admin-key", "nope");
    assert.strictEqual(missing.status, wrong.status);
    assert.strictEqual(missing.body.error.code, wrong.body.error.code);
  });

  it("7. never echoes the key back to the caller", async () => {
    const res = await request(ctx.app).get("/api/dashboard/compliance").set("x-admin-key", TEST_CONFIG.adminApiKey);
    const body = JSON.stringify(res.body);
    const headers = JSON.stringify(res.headers);
    assert.ok(body.indexOf(TEST_CONFIG.adminApiKey) === -1, "the key must not appear in the body");
    assert.ok(headers.indexOf(TEST_CONFIG.adminApiKey) === -1, "the key must not appear in a header");
  });

  it("8. hides which dashboard paths exist from an anonymous caller", async () => {
    const real = await request(ctx.app).get("/api/dashboard/compliance");
    const fake = await request(ctx.app).get("/api/dashboard/does-not-exist");
    assert.strictEqual(real.status, 401);
    assert.strictEqual(fake.status, 401);
  });
});

describe("dashboard admin authentication fails closed", () => {
  // the dangerous case: a server with no ADMIN_API_KEY set. an undefined key must
  // never compare equal to an absent header and open the roster to everyone.
  function buildAppWithConfig(config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "safear-auth-"));
    const db = initDatabase(path.join(dir, "auth-test.db"));
    seedDatabase(db);
    const app = createApp({ db, config, keys: testKeys() });
    return {
      app,
      cleanup() {
        closeDatabase();
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    };
  }

  const withoutKey = (extra) => Object.assign({}, TEST_CONFIG, extra);

  it("9. refuses everything when no admin key is configured", async () => {
    const t = buildAppWithConfig(withoutKey({ adminApiKey: undefined }));
    try {
      const anon = await request(t.app).get("/api/dashboard/compliance");
      assert.strictEqual(anon.status, 401, "an unconfigured server must not serve the roster");
      assert.strictEqual(anon.body.error.code, "unauthorized");

      // and no header value can satisfy a server that has nothing to compare against
      for (const attempt of ["", "undefined", "null", TEST_CONFIG.adminApiKey]) {
        const res = await request(t.app).get("/api/dashboard/compliance").set("x-admin-key", attempt);
        assert.strictEqual(res.status, 401, `"${attempt}" must not authenticate against an unset key`);
      }
    } finally {
      t.cleanup();
    }
  });

  it("10. refuses everything when the admin key is blank or whitespace", async () => {
    for (const blank of ["", "   "]) {
      const t = buildAppWithConfig(withoutKey({ adminApiKey: blank }));
      try {
        const res = await request(t.app).get("/api/dashboard/compliance").set("x-admin-key", blank);
        assert.strictEqual(res.status, 401, `a ${JSON.stringify(blank)} key must not authenticate`);
      } finally {
        t.cleanup();
      }
    }
  });

  it("11. refuses to build the router without config at all", () => {
    const { createDashboardRouter } = require("../routes/dashboard");
    assert.throws(
      () => createDashboardRouter({ db: {} }),
      /requires config for admin authentication/
    );
  });
});
