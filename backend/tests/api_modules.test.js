const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { validateModuleManifestList } = require("../models/module");

let ctx = null;

describe("GET /api/modules", () => {
  before(() => { ctx = buildTestApp(); });
  after(() => ctx.cleanup());

  it("serves both seeded modules", async () => {
    const res = await request(ctx.app).get("/api/modules");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    assert.deepStrictEqual(res.body.map((m) => m.moduleId).sort(), ["fire-response", "gas-leak"]);
  });

  it("returns a payload its own validation model accepts", async () => {
    const res = await request(ctx.app).get("/api/modules");
    // dogfooding: the wire shape has to satisfy the phase b manifest schema
    assert.doesNotThrow(() => validateModuleManifestList(res.body));
  });

  it("carries three required checkpoints per module", async () => {
    const res = await request(ctx.app).get("/api/modules");

    res.body.forEach((manifest) => {
      assert.strictEqual(manifest.requiredCheckpoints.length, 3, `${manifest.moduleId} must expose 3 checkpoints`);
    });
  });

  it("exposes the checkpoint ids the AR modules actually emit", async () => {
    const res = await request(ctx.app).get("/api/modules");
    const fire = res.body.find((m) => m.moduleId === "fire-response");

    assert.deepStrictEqual(
      fire.requiredCheckpoints.map((c) => c.checkpointId).sort(),
      ["fire_evacuation_sequence", "fire_exit_identification", "fire_extinguisher_aim"]
    );
  });

  it("converts the 0/1 columns into real booleans", async () => {
    const res = await request(ctx.app).get("/api/modules");
    const checkpoint = res.body[0].requiredCheckpoints[0];

    assert.strictEqual(typeof checkpoint.required, "boolean");
    assert.strictEqual(typeof checkpoint.critical, "boolean");
  });

  it("reports critical as false everywhere, the team has not ruled yet", async () => {
    const res = await request(ctx.app).get("/api/modules");

    res.body.forEach((manifest) => {
      manifest.requiredCheckpoints.forEach((checkpoint) => {
        assert.strictEqual(checkpoint.critical, false, `${checkpoint.checkpointId} must not claim a safety ruling`);
      });
    });
  });

  it("passes the pass threshold through so the engine can score offline", async () => {
    const res = await request(ctx.app).get("/api/modules");
    res.body.forEach((manifest) => {
      assert.ok(manifest.passThreshold > 0 && manifest.passThreshold <= 1);
    });
  });

  it("reports recertMonths as null while the Mines Act period is open", async () => {
    const res = await request(ctx.app).get("/api/modules");
    res.body.forEach((manifest) => {
      assert.strictEqual(manifest.recertMonths, null);
    });
  });
});
