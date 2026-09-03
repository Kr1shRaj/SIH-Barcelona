const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");

let ctx = null;

describe("CORS", () => {
  before(() => { ctx = buildTestApp(); });
  after(() => ctx.cleanup());

  it("allows the frontend dev server origin", async () => {
    const res = await request(ctx.app).get("/api/health").set("Origin", "http://localhost:5173");
    assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:5173");
  });

  it("allows the dashboard dev server origin", async () => {
    const res = await request(ctx.app).get("/api/health").set("Origin", "http://localhost:5174");
    assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:5174");
  });

  it("allows the Capacitor WebView origins, without these the APK cannot call the API", async () => {
    for (const origin of ["capacitor://localhost", "http://localhost", "https://localhost"]) {
      const res = await request(ctx.app).get("/api/health").set("Origin", origin);
      assert.strictEqual(res.headers["access-control-allow-origin"], origin, `${origin} must be allowed`);
    }
  });

  it("refuses an origin nobody listed", async () => {
    const res = await request(ctx.app).get("/api/health").set("Origin", "https://evil.example.com");
    assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
  });

  it("never answers with a wildcard", async () => {
    const res = await request(ctx.app).get("/api/health").set("Origin", "http://localhost:5173");
    assert.notStrictEqual(res.headers["access-control-allow-origin"], "*");
  });

  it("answers a preflight for the sync POST", async () => {
    const res = await request(ctx.app)
      .options("/api/sync")
      .set("Origin", "capacitor://localhost")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    assert.ok(res.status === 204 || res.status === 200);
    assert.strictEqual(res.headers["access-control-allow-origin"], "capacitor://localhost");
    assert.match(res.headers["access-control-allow-methods"], /POST/);
  });

  it("serves a request that carries no Origin header at all", async () => {
    const res = await request(ctx.app).get("/api/health");
    assert.strictEqual(res.status, 200);
  });
});
