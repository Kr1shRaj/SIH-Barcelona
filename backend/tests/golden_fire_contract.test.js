process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const request = require("supertest");
const { buildTestApp, activateTestTrainee, asTrainee } = require("./helpers/app");
const { syncEnvelope } = require("./fixtures/attempts");
const { scenarioFor } = require("../services/grading/scenario");

// the frontend's own builders and engine make every payload here, so this test
// breaks the day the phone and the server stop agreeing on the wire
function frontendModule(rel) {
  return import(pathToFileURL(path.join(__dirname, "../../frontend", rel)).href);
}

// fixed attempt ids with a known roll
const ROLLS = {
  high: "03134567-0f1e-4d2c-8b3a-49586a7b8c9d", // 2.49% CH4: withdraw
  diesel: "04368ace-0f1e-4d2c-8b3a-49586a7b8c9d", // 0.36%, diesel / hydraulic oil
  coal: "df4cda26-7c1d-4e2f-9a3b-5c6d7e8f9a0b", // 0.73%, conveyor belt and coal
  switchgear: "7d8453d7-7c1d-4e2f-9a3b-5c6d7e8f9a0b", // 0.23%, live switchgear
  gasJet: "f6623a9b-7c1d-4e2f-9a3b-5c6d7e8f9a0b" // 0.9%, pressurised methane jet
};

const WORKER = "WRK-0001";
const STARTED_AT = Date.parse("2026-09-20T10:00:00.000Z");

// every gate right first time, keyed by the fuel the run rolled
const FIRST_TRY_AGENT = { diesel_hydraulic: "foam", conveyor_coal: "water", electrical_switchgear: "co2" };

describe("golden fire contract: every tier, branch and gate the phone can produce", () => {
  let obs = null;
  let engine = null;
  let ctx = null;
  // sync and certificate issue need a signed in trainee: the worker the runs belong to
  let session = null;

  // fresh seeded app plus that worker's session
  function freshApp() {
    ctx = buildTestApp();
    session = activateTestTrainee(ctx.db, WORKER);
  }

  before(async () => {
    obs = await frontendModule("assessment/observations.js");
    engine = await frontendModule("assessment/engine.js");
  });

  beforeEach(() => freshApp());
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

  // picks in order, each a second apart
  const tries = (...picks) => obs.selectionSequence(picks.map((selected, i) => ({ selected, atMs: 1500 + i * 1000 })));

  // the checkpoints a real run fires on this tier and branch, in order.
  // branch: "evacuate" (withdraw), "fight" (alarm, gates 2-3, PASS, gate 5) or "isolate" (gas jet)
  function runCheckpoints({ tier, branch, picks }) {
    const source = obs.trackingSourceForTier(tier);
    const list = [
      // the exit sighting, unmeasured on today's builds. optional, stored, never scored
      cp("fire_exit_identification", "proximity", obs.spatialAlignment({
        anchorId: "fire_exit_sign", angularErrorRad: null, dwellMs: 0, frameCount: 0, trackingSource: source
      }), 20),
      cp("fire_explosion_decision", "select", tries(...picks.decision), 35)
    ];
    if (branch !== "evacuate") {
      list.push(cp("fire_alarm_pull", "select", obs.selectionSingle("alarm_pull"), 45));
      list.push(cp("fire_g2_media", "select", tries(...picks.g2), 55));
    }
    if (branch === "fight") {
      list.push(cp("fire_g3_stance", "select", tries(...picks.g3), 65));
      list.push(cp("fire_extinguisher_aim", "aim", obs.aimDwell({
        hitDistanceM: 0.12, dwellMs: 900, sweepCoverage: 0.8, frameCount: 40, trackingSource: source
      }), 90));
      list.push(cp("fire_g5_post", "select", tries(...picks.g5), 105));
    }
    list.push(tier === 1
      ? cp("fire_evacuation_sequence_webxr", "select", obs.selectionSingle("wind_based_upwind"), 120)
      : cp("fire_evacuation_sequence_marker", "select", obs.selectionSingle("sound_alarm_then_evacuate"), 120));
    return list;
  }

  // evaluate + strip to the wire with the real frontend engine
  function phonePayload({ attemptId, tier, branch, picks }) {
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
      checkpoints: runCheckpoints({ tier, branch, picks })
    }, 0.7);
    return engine.toWireAttempt(evaluated);
  }

  // a fight run, every gate right first time unless overridden
  function fightPicks(attemptId, overrides = {}) {
    return {
      decision: ["extinguish"],
      g2: [FIRST_TRY_AGENT[scenarioFor(attemptId).fuel]],
      g3: ["approach_upwind_2_3m"],
      g5: ["back_away_facing_fire"],
      ...overrides
    };
  }

  async function syncOne(payload) {
    return request(ctx.app).post("/api/sync").set(asTrainee(session)).send(syncEnvelope([payload], { workerId: WORKER }));
  }

  // score the server gave one checkpoint of one attempt
  function gateRow(attemptId, checkpointId) {
    return ctx.db
      .prepare("SELECT server_score, server_passed, grade_reason FROM checkpoint_result WHERE attempt_id = ? AND checkpoint_id = ?")
      .get(attemptId, checkpointId);
  }

  async function issue(attemptId) {
    return request(ctx.app).post("/api/certs/issue").set(asTrainee(session)).send({ attemptId });
  }

  it("uses attempt ids that roll the fire each case needs", () => {
    assert.strictEqual(scenarioFor(ROLLS.high).methaneLevel, "high");
    assert.deepStrictEqual(
      ["diesel", "coal", "switchgear", "gasJet"].map((k) => [scenarioFor(ROLLS[k]).methaneLevel, scenarioFor(ROLLS[k]).fuel]),
      [["low", "diesel_hydraulic"], ["low", "conveyor_coal"], ["low", "electrical_switchgear"], ["low", "pressurized_methane"]]
    );
  });

  const COMBOS = [
    { name: "Tier 1 WebXR, evacuate branch", tier: 1, branch: "evacuate", attemptId: ROLLS.high, percent: 100 },
    { name: "Tier 1 WebXR, fight branch", tier: 1, branch: "fight", attemptId: ROLLS.diesel, percent: 97.86 },
    { name: "Tier 2 marker, evacuate branch", tier: 2, branch: "evacuate", attemptId: ROLLS.high, percent: 100 },
    { name: "Tier 2 marker, fight branch", tier: 2, branch: "fight", attemptId: ROLLS.diesel, percent: 97.86 }
  ];

  COMBOS.forEach((combo) => {
    it(`${combo.name}: syncs, grades every gate first try at full marks, earns a verifiable certificate`, async () => {
      const picks = combo.branch === "evacuate" ? { decision: ["evacuate"] } : fightPicks(combo.attemptId);
      const payload = phonePayload({ attemptId: combo.attemptId, tier: combo.tier, branch: combo.branch, picks });

      const sync = await syncOne(payload);
      assert.strictEqual(sync.status, 200, JSON.stringify(sync.body));
      assert.strictEqual(sync.body.rejected, 0, JSON.stringify(sync.body.results));
      const result = sync.body.results[0];
      assert.strictEqual(result.status, "accepted");
      assert.strictEqual(result.gradingStatus, "graded");
      // fight: six at 1 plus the aim at 0.85, over seven
      assert.strictEqual(result.serverPercentage, combo.percent);
      assert.strictEqual(result.certificateEligible, true);

      const gates = combo.branch === "fight"
        ? ["fire_explosion_decision", "fire_g2_media", "fire_g3_stance", "fire_g5_post"]
        : ["fire_explosion_decision"];
      gates.forEach((gate) => {
        assert.deepStrictEqual(gateRow(payload.attemptId, gate), { server_score: 1, server_passed: 1, grade_reason: "first_try" }, gate);
      });

      const row = ctx.db.prepare("SELECT ar_tier, locale FROM attempt WHERE attempt_id = ?").get(payload.attemptId);
      assert.deepStrictEqual(row, { ar_tier: combo.tier, locale: "sat" }, "tier and locale land as the phone recorded them");

      const cert = await issue(payload.attemptId);
      assert.strictEqual(cert.status, 201, JSON.stringify(cert.body));
      assert.strictEqual(cert.body.algo, "Ed25519");

      const verify = await request(ctx.app).post("/api/certs/verify").send({ qr: cert.body.qr });
      assert.strictEqual(verify.status, 200);
      assert.strictEqual(verify.body.verdict, "valid");
      assert.strictEqual(verify.body.checks.signature, "pass");
    });
  });

  it("every fightable fuel certifies with one of its right agents", async () => {
    for (const [attemptId, agent] of [[ROLLS.coal, "abc_powder"], [ROLLS.switchgear, "abc_powder"], [ROLLS.coal, "water"]]) {
      ctx.cleanup();
      freshApp();
      const payload = phonePayload({ attemptId, tier: 2, branch: "fight", picks: fightPicks(attemptId, { g2: [agent] }) });
      const sync = await syncOne(payload);
      assert.strictEqual(sync.body.results[0].status, "accepted", JSON.stringify(sync.body.results));
      assert.strictEqual(gateRow(attemptId, "fire_g2_media").server_score, 1, `${agent} on ${scenarioFor(attemptId).fuel}`);
      assert.strictEqual((await issue(attemptId)).status, 201);
    }
  });

  it("a gas jet is isolated and walked away from: no stance, drill or post-fire gate, and it certifies", async () => {
    const payload = phonePayload({
      attemptId: ROLLS.gasJet,
      tier: 1,
      branch: "isolate",
      picks: { decision: ["extinguish"], g2: ["isolate_supply_then_evacuate"] }
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.status, 200, JSON.stringify(sync.body.results));
    assert.strictEqual(sync.body.results[0].serverPercentage, 100, "decision, alarm, agent gate, evacuation");
    assert.strictEqual((await issue(payload.attemptId)).status, 201);
  });

  it("one procedural slip on a gate costs half of that gate and still certifies", async () => {
    const payload = phonePayload({
      attemptId: ROLLS.diesel,
      tier: 2,
      branch: "fight",
      picks: fightPicks(ROLLS.diesel, { g5: ["poke_debris", "back_away_facing_fire"] })
    });

    const sync = await syncOne(payload);
    const result = sync.body.results[0];
    assert.strictEqual(result.status, "accepted");
    // decision, alarm, g2, g3, evacuation 1 each + aim 0.85 + g5 0.5, over seven
    assert.strictEqual(result.serverPercentage, 90.71);
    assert.strictEqual(result.serverPassed, true);
    assert.deepStrictEqual(gateRow(payload.attemptId, "fire_g5_post"), { server_score: 0.5, server_passed: 1, grade_reason: "corrected" });
    assert.strictEqual((await issue(payload.attemptId)).status, 201);
  });

  const FAILS = [
    { name: "water on live switchgear (fatal agent)", attemptId: ROLLS.switchgear, gate: "fire_g2_media", overrides: { g2: ["water", "co2"] } },
    { name: "water on burning oil (fatal agent)", attemptId: ROLLS.diesel, gate: "fire_g2_media", overrides: { g2: ["water", "foam"] } },
    { name: "walking into the smoke (fatal stance)", attemptId: ROLLS.diesel, gate: "fire_g3_stance", overrides: { g3: ["approach_downwind", "approach_upwind_2_3m"] } },
    { name: "standing under 1 m (critical stance)", attemptId: ROLLS.diesel, gate: "fire_g3_stance", overrides: { g3: ["under_1m", "approach_upwind_2_3m"] } },
    { name: "turning your back on the fire (critical)", attemptId: ROLLS.diesel, gate: "fire_g5_post", overrides: { g5: ["turn_and_walk_away", "back_away_facing_fire"] } }
  ];

  FAILS.forEach((f) => {
    it(`${f.name} fails the gate and the run, and never certifies`, async () => {
      const payload = phonePayload({ attemptId: f.attemptId, tier: 2, branch: "fight", picks: fightPicks(f.attemptId, f.overrides) });

      const sync = await syncOne(payload);
      const result = sync.body.results[0];
      assert.strictEqual(result.status, "accepted", "the run is stored as evidence");
      assert.strictEqual(result.serverPassed, false);
      assert.strictEqual(result.certificateEligible, false);
      assert.deepStrictEqual(gateRow(payload.attemptId, f.gate), { server_score: 0, server_passed: 0, grade_reason: "fatal_then_corrected" });

      assert.notStrictEqual((await issue(payload.attemptId)).status, 201, "a fatal or critical pick must never certify");
      assert.strictEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n, 0);
    });
  });

  it("a fatal pick on the methane decision also fails the run, even after the fix", async () => {
    const payload = phonePayload({
      attemptId: ROLLS.high,
      tier: 1,
      branch: "evacuate",
      picks: { decision: ["extinguish", "evacuate"] }
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.body.results[0].serverPassed, false);
    assert.notStrictEqual((await issue(payload.attemptId)).status, 201);
  });

  it("a gate that the ui would have blocked is refused, not scored", async () => {
    // ends on a wrong pick: the shipped ui never lets a worker past that
    const payload = phonePayload({
      attemptId: ROLLS.diesel,
      tier: 2,
      branch: "fight",
      picks: fightPicks(ROLLS.diesel, { g3: ["over_4m"] })
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.status, 422);
    assert.strictEqual(sync.body.results[0].reason, "implausible_observation");
  });

  it("fight checkpoints on a withdraw-level roll are refused, the fire was never fought", async () => {
    const payload = phonePayload({
      attemptId: ROLLS.high,
      tier: 2,
      branch: "fight",
      picks: fightPicks(ROLLS.diesel, { decision: ["evacuate"] })
    });

    const sync = await syncOne(payload);
    assert.strictEqual(sync.body.results[0].status, "rejected");
    assert.ok(sync.body.results[0].issues.some((i) => i.code === "checkpoint_scenario_mismatch"));
  });

  it("stance, drill and post-fire checkpoints on a gas-jet roll are refused, nobody fights a gas jet", async () => {
    const payload = phonePayload({
      attemptId: ROLLS.gasJet,
      tier: 2,
      branch: "fight",
      picks: fightPicks(ROLLS.gasJet, { g2: ["isolate_supply_then_evacuate"] })
    });

    const sync = await syncOne(payload);
    const issues = sync.body.results[0].issues || [];
    assert.strictEqual(sync.body.results[0].status, "rejected");
    ["fire_g3_stance", "fire_extinguisher_aim", "fire_g5_post"].forEach((id) => {
      assert.ok(issues.some((i) => i.code === "checkpoint_scenario_mismatch" && i.message.includes(id)), id);
    });
  });
});
