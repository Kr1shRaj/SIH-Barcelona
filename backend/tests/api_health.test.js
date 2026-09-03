const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");

let ctx = null;

describe("GET /api/health", () => {
  before(() => { ctx = buildTestApp(); });
  after(() => ctx.cleanup());

  it("reports ok with a live database", async () => {
    const res = await request(ctx.app).get("/api/health");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.db, "up");
    assert.ok(typeof res.body.ts === "string");
  });

  it("carries a request id in the body and the header", async () => {
    const res = await request(ctx.app).get("/api/health");

    assert.ok(res.body.requestId, "body must carry a request id");
    assert.strictEqual(res.headers["x-request-id"], res.body.requestId);
  });

  it("echoes a caller supplied request id so a client can correlate", async () => {
    const res = await request(ctx.app).get("/api/health").set("x-request-id", "trace-me-123");
    assert.strictEqual(res.body.requestId, "trace-me-123");
  });

  it("answers 503 when the database is gone", async () => {
    const broken = buildTestApp();
    broken.db.close();

    const res = await request(broken.app).get("/api/health");
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.db, "down");

    broken.cleanup();
  });
});
