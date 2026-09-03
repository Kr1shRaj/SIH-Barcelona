const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { fireAttempt, syncEnvelope } = require("./fixtures/attempts");

let ctx = null;

describe("Error handling", () => {
  before(() => { ctx = buildTestApp(); });
  after(() => ctx.cleanup());

  it("answers 404 for an unknown route in the standard envelope", async () => {
    const res = await request(ctx.app).get("/api/nope");

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.code, "not_found");
    assert.match(res.body.error.message, /GET \/api\/nope/);
    assert.ok(res.body.error.requestId);
  });

  it("answers 404 for the routers that are deliberately not mounted yet", async () => {
    const certs = await request(ctx.app).post("/api/certs/issue").send({});
    const dashboard = await request(ctx.app).get("/api/dashboard/summary");

    assert.strictEqual(certs.status, 404);
    assert.strictEqual(dashboard.status, 404);
  });

  it("answers 400 on malformed JSON", async () => {
    const res = await request(ctx.app)
      .post("/api/sync")
      .set("Content-Type", "application/json")
      .send("{ this is not json");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, "malformed_json");
  });

  it("answers 413 when the body is over the limit", async () => {
    const huge = { batchId: "x", filler: "y".repeat(1024 * 1024 + 5000) };
    const res = await request(ctx.app)
      .post("/api/sync")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(huge));

    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.error.code, "payload_too_large");
  });

  it("never leaks a stack trace to the caller", async () => {
    const bad = syncEnvelope([fireAttempt({ attemptId: "nope" })], { workerId: "WRK-0001" });
    const res = await request(ctx.app).post("/api/sync").send(bad);
    const serialized = JSON.stringify(res.body);

    assert.ok(!serialized.includes("at Object."), "no stack frames");
    assert.ok(!serialized.includes(".js:"), "no file paths");
    assert.ok(!/[A-Z]:\\\\/.test(serialized), "no windows paths");
  });

  it("puts a request id on every error response", async () => {
    const notFound = await request(ctx.app).get("/api/missing");
    const badBody = await request(ctx.app)
      .post("/api/sync")
      .set("Content-Type", "application/json")
      .send("{oops");

    assert.ok(notFound.body.error.requestId);
    assert.ok(badBody.body.error.requestId);
  });

  it("does not advertise the server framework", async () => {
    const res = await request(ctx.app).get("/api/health");
    assert.strictEqual(res.headers["x-powered-by"], undefined);
  });
});
