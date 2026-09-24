const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { validateModuleManifestList } = require("../models/module");

let ctx = null;

describe("GET /api/modules", () => {
  before(() => { ctx = buildTestApp(); });
  after(() => ctx.cleanup());

  it("serves all seeded modules", async () => {
    const res = await request(ctx.app).get("/api/modules");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 3);
    assert.deepStrictEqual(res.body.map((m) => m.moduleId).sort(), ["fire-response", "fire-response-team", "gas-leak"]);
  });

  it("returns a payload its own validation model accepts", async () => {
    const res = await request(ctx.app).get("/api/modules");
    // dogfooding: the wire shape has to satisfy the phase b manifest schema
    assert.doesNotThrow(() => validateModuleManifestList(res.body));
  });

  it("carries every checkpoint the module defines", async () => {
    const res = await request(ctx.app).get("/api/modules");
    const counts = Object.fromEntries(
      res.body.map((manifest) => [manifest.moduleId, manifest.requiredCheckpoints.length])
    );

    // fire-response carries four: evacuation split per tier, the decision gate, the aim.
    // the exit sighting is optional until its angle is measured. team carries five
    assert.deepStrictEqual(counts, { "fire-response": 4, "fire-response-team": 5, "gas-leak": 3 });
  });

  it("exposes the checkpoint ids the AR modules actually emit", async () => {
    const res = await request(ctx.app).get("/api/modules");
    const fire = res.body.find((m) => m.moduleId === "fire-response");

    assert.deepStrictEqual(
      fire.requiredCheckpoints.map((c) => c.checkpointId).sort(),
      [
        "fire_evacuation_sequence_marker",
        "fire_evacuation_sequence_webxr",
        "fire_explosion_decision",
        "fire_extinguisher_aim"
      ]
    );
  });

  it("converts the 0/1 columns into real booleans", async () => {
    const res = await request(ctx.app).get("/api/modules");
    const checkpoint = res.body[0].requiredCheckpoints[0];

    assert.strictEqual(typeof checkpoint.required, "boolean");
    assert.strictEqual(typeof checkpoint.critical, "boolean");
  });

  it("reports critical as false everywhere except team_drill_outcome and the methane decision gate", async () => {
    const res = await request(ctx.app).get("/api/modules");
    const critical = ["team_drill_outcome", "fire_explosion_decision"];

    res.body.forEach((manifest) => {
      manifest.requiredCheckpoints.forEach((checkpoint) => {
        const expected = critical.includes(checkpoint.checkpointId);
        assert.strictEqual(checkpoint.critical, expected, `${checkpoint.checkpointId} critical flag is wrong`);
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
