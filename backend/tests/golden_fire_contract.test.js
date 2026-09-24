process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { syncEnvelope } = require("./fixtures/attempts");
const { scenarioFor } = require("../services/grading/scenario");

// the frontend's own builders and engine make every payload here, so this test
// breaks the day the phone and the server stop agreeing on the wire
function frontendModule(rel) {
  return import(pathToFileURL(path.join(__dirname, "../../frontend", rel)).href);
}

// fixed attempt ids with a known roll. high = at or above the 1.25% withdrawal limit
const HIGH_METHANE_ATTEMPT_ID = "03134567-0f1e-4d2c-8b3a-49586a7b8c9d";
const LOW_METHANE_ATTEMPT_ID = "04368ace-0f1e-4d2c-8b3a-49586a7b8c9d";

const WORKER = "WRK-0001";
const STARTED_AT = Date.parse("2026-09-20T10:00:00.000Z");

describe("golden fire contract: every tier and branch the phone can produce certifies", () => {
  let obs = null;
  let engine = null;
  let ctx = null;

  before(async () => {
    obs = await frontendModule("assessment/observations.js");
    engine = await frontendModule("assessment/engine.js");
  });

  beforeEach(() => { ctx = buildTestApp(); });
  afterEach(() => ctx.cleanup());

  // one checkpoint exactly as the module fires it, stamped a few seconds apart
  function cp(checkpointId, type, observation, offsetSec) {
    return {
      checkpointId,
      type,
      passed: true,
      score: 1,
      weight: 1,
      timestamp: new Date(STARTED_AT + offsetSec * 1000).toISOString(),
      context: {},
      observation
    };
  }

  // the checkpoints a real run fires on this tier and branch, in order
  function runCheckpoints({ tier, branch, decisionTries }) {
    const source = obs.trackingSourceForTier(tier);
    const list = [
      // the exit sighting, unmeasured on today's builds. optional, stored, never scored
      cp("fire_exit_identification", "proximity", obs.spatialAlignment({
        anchorId: "fire_exit_sign", angularErrorRad: null, dwellMs: 0, frameCount: 0, trackingSource: source
      }), 20),
      cp("fire_explosion_decision", "select", obs.selectionSequence(decisionTries), 35)
    ];
    if (branch === "suppress") {
      list.push(cp("fire_alarm_pull", "select", obs.selectionSingle("alarm_pull"), 50));
      list.push(cp("fire_extinguisher_aim", "aim", obs.aimDwell({
        hitDistanceM: 0.12, dwellMs: 900, sweepCoverage: 0.8, frameCount: 40, trackingSource: source
      }), 90));
    }
    list.push(tier === 1
      ? cp("fire_evacuation_sequence_webxr", "select", obs.selectionSingle("wind_based_upwind"), 120)
      : cp("fire_evacuation_sequence_marker", "select", obs.selectionSingle("sound_alarm_then_evacuate"), 120));
    return list;
  }

  // evaluate + strip to the wire with the real frontend engine
  function phonePayload({ attemptId, tier, branch, decisionTries }) {
    const evaluated = engine.evaluateAssessment({
      contractVersion: "2.0",
      attemptId,
      workerId: WORKER,
      moduleId: "fire-response",
      moduleVersion: 1,
      engineVersion: "1.0.0",
      deviceId: "dev-golden-01",
      arTier: tier,
      locale: "sat",
      startedAt: new Date(STARTED_AT).toISOString(),
      completedAt: new Date(STARTED_AT + 150 * 1000).toISOString(),
      checkpoints: runCheckpoints({ tier, branch, decisionTries })
    }, 0.7);
    return engine.toWireAttempt(evaluated);
  }

  async function syncOne(payload) {
    return request(ctx.app).post("/api/sync").send(syncEnvelope([payload], { workerId: WORKER }));
  }

  const COMBOS = [
    { name: "Tier 1 WebXR, evacuate branch", tier: 1, branch: "evacuate", attemptId: HIGH_METHANE_ATTEMPT_ID, tries: ["evacuate"] },
    { name: "Tier 1 WebXR, extinguish branch", tier: 1, branch: "suppress", attemptId: LOW_METHANE_ATTEMPT_ID, tries: ["extinguish"] },
    { name: "Tier 2 marker, evacuate branch", tier: 2, branch: "evacuate", attemptId: HIGH_METHANE_ATTEMPT_ID, tries: ["evacuate"] },
    { name: "Tier 2 marker, extinguish branch", tier: 2, branch: "suppress", attemptId: LOW_METHANE_ATTEMPT_ID, tries: ["extinguish"] }
  ];

  it("uses attempt ids that roll the methane level each branch needs", () => {
    assert.strictEqual(scenarioFor(HIGH_METHANE_ATTEMPT_ID).methaneLevel, "high");
    assert.strictEqual(scenarioFor(LOW_METHANE_ATTEMPT_ID).methaneLevel, "low");
  });

  COMBOS.forEach((combo) => {
    it(`${combo.name}: syncs, grades and earns a verifiable certificate`, async () => {
      const payload = phonePayload({
        attemptId: combo.attemptId,
        tier: combo.tier,
        branch: combo.branch,
        decisionTries: combo.tries.map((selected, i) => ({ selected, atMs: 2500 + i * 1500 }))
      });

      const sync = await syncOne(payload);
      assert.strictEqual(sync.status, 200, JSON.stringify(sync.body));
      assert.strictEqual(sync.body.rejected, 0, JSON.stringify(sync.body.results));
      const result = sync.body.results[0];
      assert.strictEqual(result.status, "accepted");
      assert.strictEqual(result.gradingStatus, "graded");
      assert.strictEqual(result.serverPercentage, combo.branch === "suppress" ? 96.25 : 100);
      assert.strictEqual(result.certificateEligible, true);

      const row = ctx.db.prepare("SELECT ar_tier, locale FROM attempt WHERE attempt_id = ?").get(payload.attemptId);
      assert.deepStrictEqual(row, { ar_tier: combo.tier, locale: "sat" }, "tier and locale land as the phone recorded them");

      const issue = await request(ctx.app).post("/api/certs/issue").send({ attemptId: payload.attemptId });
      assert.strictEqual(issue.status, 201, JSON.stringify(issue.body));
      assert.strictEqual(issue.body.algo, "Ed25519");

      const verify = await request(ctx.app).post("/api/certs/verify").send({ qr: issue.body.qr });
      assert.strictEqual(verify.status, 200);
      assert.strictEqual(verify.body.verdict, "valid");
      assert.strictEqual(verify.body.checks.signature, "pass");
    });
  });

  it("a procedural slip on the gate costs half of it but still certifies", async () => {
    const payload = phonePayload({
      attemptId: LOW_METHANE_ATTEMPT_ID,
      tier: 2,
      branch: "suppress",
      decisionTries: [{ selected: "wait", atMs: 1800 }, { selected: "extinguish", atMs: 4100 }]
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.body.results[0].status, "accepted");
    // decision 0.5 + alarm 1 + aim 0.85 + evacuation 1 over 4
    assert.strictEqual(sync.body.results[0].serverPercentage, 83.75);
    assert.strictEqual(sync.body.results[0].serverPassed, true);

    const gate = ctx.db
      .prepare("SELECT server_score, server_passed, grade_reason FROM checkpoint_result WHERE attempt_id = ? AND checkpoint_id = 'fire_explosion_decision'")
      .get(payload.attemptId);
    assert.deepStrictEqual(gate, { server_score: 0.5, server_passed: 1, grade_reason: "corrected" });
  });

  it("a fatal pick on the critical gate fails the run and earns no certificate, even after the fix", async () => {
    const payload = phonePayload({
      attemptId: HIGH_METHANE_ATTEMPT_ID,
      tier: 1,
      branch: "evacuate",
      decisionTries: [{ selected: "extinguish", atMs: 1200 }, { selected: "evacuate", atMs: 5200 }]
    });

    const sync = await syncOne(payload);
    const result = sync.body.results[0];
    assert.strictEqual(result.status, "accepted", "the run is stored as evidence");
    assert.strictEqual(result.serverPassed, false);
    assert.strictEqual(result.certificateEligible, false);

    const issue = await request(ctx.app).post("/api/certs/issue").send({ attemptId: payload.attemptId });
    assert.notStrictEqual(issue.status, 201, "a fatal mistake must never be certified");
    assert.strictEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n, 0);
  });

  it("a gate that the ui would have blocked is refused, not scored", async () => {
    // ends on a wrong pick: the shipped ui never lets a worker past that
    const payload = phonePayload({
      attemptId: HIGH_METHANE_ATTEMPT_ID,
      tier: 2,
      branch: "evacuate",
      decisionTries: [{ selected: "extinguish", atMs: 1200 }]
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.status, 422);
    assert.strictEqual(sync.body.results[0].reason, "implausible_observation");
  });

  it("an extinguisher checkpoint on a withdraw-level roll is refused, the fire was never fought", async () => {
    const payload = phonePayload({
      attemptId: HIGH_METHANE_ATTEMPT_ID,
      tier: 2,
      branch: "suppress",
      decisionTries: [{ selected: "evacuate", atMs: 1500 }]
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.body.results[0].status, "rejected");
    assert.ok(sync.body.results[0].issues.some((i) => i.code === "checkpoint_scenario_mismatch"));
  });
});
