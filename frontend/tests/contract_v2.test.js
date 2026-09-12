import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  startAssessmentSession,
  recordCheckpointResult,
  finishAssessmentSession,
  getQueuedAttempts,
  clearAttemptQueue,
  abortAssessmentSession,
  toWireAttempt,
  CONTRACT_VERSION
} from "../assessment/engine.js";
import {
  selectionSingle,
  selectionMulti,
  aimDwell,
  spatialAlignment,
  trackingSourceForTier,
  UNMEASURED_ANGLE_RAD
} from "../assessment/observations.js";
// the real backend validators, not a copy of them
import { validateAttemptContract } from "../../backend/models/attempt.js";
import { validateSyncPayload } from "../../backend/models/sync.js";

let store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { store = {}; }
};
globalThis.window = { localStorage: globalThis.localStorage, addEventListener() {}, removeEventListener() {} };

// drive a whole fire-response run through the real engine, tier 2
function runFireAttempt() {
  startAssessmentSession({
    workerId: "WRK-0001",
    moduleId: "fire-response",
    arTier: 2,
    locale: "hi",
    deviceId: "dev-8f3a2b1c"
  });

  recordCheckpointResult({
    checkpointId: "fire_exit_identification",
    type: "proximity",
    passed: true,
    context: { method: "button_confirm", measured: false },
    observation: spatialAlignment({
      anchorId: "fire_exit_sign",
      angularErrorRad: null,
      dwellMs: 4200,
      frameCount: 0,
      trackingSource: trackingSourceForTier(2)
    }),
    timestamp: new Date().toISOString()
  });

  recordCheckpointResult({
    checkpointId: "fire_extinguisher_aim",
    type: "aim",
    passed: true,
    context: { accuracy: 0.75, distance: 0.2 },
    observation: aimDwell({
      hitDistanceM: 0.2,
      dwellMs: 900,
      sweepCoverage: 0.82,
      frameCount: 54,
      trackingSource: trackingSourceForTier(2)
    }),
    timestamp: new Date().toISOString()
  });

  recordCheckpointResult({
    checkpointId: "fire_evacuation_sequence_marker",
    type: "select",
    passed: true,
    context: { selected: "sound_alarm_then_evacuate", correct: "sound_alarm_then_evacuate" },
    observation: selectionSingle("sound_alarm_then_evacuate"),
    timestamp: new Date().toISOString()
  });

  return finishAssessmentSession();
}

describe("Attempt Contract v2.0 — the real engine against the real backend validator", () => {
  beforeEach(() => {
    store = {};
    abortAssessmentSession();
    clearAttemptQueue();
  });

  it("1. the engine speaks contract 2.0", () => {
    assert.strictEqual(CONTRACT_VERSION, "2.0");
    const evaluated = runFireAttempt();
    assert.strictEqual(evaluated.contractVersion, "2.0");
  });

  // this is the test the whole migration exists for
  it("2. a real engine-built attempt passes the backend structural validator", () => {
    runFireAttempt();
    const [queued] = getQueuedAttempts();
    assert.ok(queued, "the run must reach the sync queue");

    const parsed = validateAttemptContract(queued, { now: Date.now() });
    assert.strictEqual(parsed.contractVersion, "2.0");
    assert.strictEqual(parsed.checkpoints.length, 3);
  });

  it("3. the whole sync envelope passes the backend validator", () => {
    runFireAttempt();
    const envelope = {
      batchId: "b71e0c93-4a2f-4d55-8e10-6f3c9d2a7b48",
      deviceId: "dev-8f3a2b1c",
      workerId: "WRK-0001",
      sentAt: new Date().toISOString(),
      attempts: getQueuedAttempts()
    };
    assert.doesNotThrow(() => validateSyncPayload(envelope, { now: Date.now() }));
  });

  it("4. every queued checkpoint has exactly the v2 shape", () => {
    runFireAttempt();
    const [queued] = getQueuedAttempts();

    queued.checkpoints.forEach((cp) => {
      assert.deepStrictEqual(
        Object.keys(cp).sort(),
        ["checkpointId", "observation", "observedAt"],
        `checkpoint ${cp.checkpointId} carries keys the contract does not allow`
      );
      assert.ok(typeof cp.observedAt === "string" && cp.observedAt.endsWith("Z"));
      assert.ok(cp.observation && typeof cp.observation.kind === "string");
    });
  });

  it("5. no server-owned grading field is ever sent inside a checkpoint", () => {
    runFireAttempt();
    const [queued] = getQueuedAttempts();
    const FORBIDDEN = ["passed", "score", "weight", "type", "context", "timestamp", "accuracy"];

    queued.checkpoints.forEach((cp) => {
      FORBIDDEN.forEach((key) => {
        assert.ok(!(key in cp), `checkpoint ${cp.checkpointId} leaked "${key}"`);
        assert.ok(!(key in cp.observation), `observation for ${cp.checkpointId} leaked "${key}"`);
      });
    });
  });

  it("6. the answer key never rides along, under any spelling", () => {
    runFireAttempt();
    const wire = JSON.stringify(getQueuedAttempts());

    ["\"correct\"", "\"correctOption\"", "\"selectedOption\"", "passThresholdUsed", "totalScore", "maxScore"]
      .forEach((needle) => {
        assert.ok(!wire.includes(needle), `the wire payload contains ${needle}`);
      });
    // the correct answer's value must not appear outside the trainee's own choice
    const [queued] = getQueuedAttempts();
    const evac = queued.checkpoints.find((c) => c.checkpointId === "fire_evacuation_sequence_marker");
    assert.deepStrictEqual(Object.keys(evac.observation).sort(), ["kind", "selected"]);
  });

  it("7. attempt-level claims keep the contract's names and types", () => {
    runFireAttempt();
    const [queued] = getQueuedAttempts();

    assert.strictEqual(typeof queued.clientClaimedPercentage, "number");
    assert.strictEqual(typeof queued.clientClaimedPassed, "boolean");
    assert.ok(!("percentage" in queued));
    assert.ok(!("passed" in queued));
    assert.ok(!("passThresholdUsed" in queued));
    assert.ok(!("totalScore" in queued));
    assert.ok(!("maxScore" in queued));
  });

  it("8. fire evacuation uses the tier-specific checkpoint id", () => {
    runFireAttempt();
    const [queued] = getQueuedAttempts();
    const ids = queued.checkpoints.map((c) => c.checkpointId);

    assert.ok(ids.includes("fire_evacuation_sequence_marker"));
    assert.ok(!ids.includes("fire_evacuation_sequence"), "the un-split v1 id must be gone");
    assert.ok(!ids.includes("fire_evacuation_sequence_webxr"), "a tier 2 run must not claim the tier 1 question");
  });

  it("9. the local result still carries what the ui needs", () => {
    const evaluated = runFireAttempt();

    assert.strictEqual(typeof evaluated.percentage, "number");
    assert.strictEqual(typeof evaluated.passed, "boolean");
    assert.strictEqual(typeof evaluated.totalScore, "number");
    assert.ok(Array.isArray(evaluated.checkpoints));
    assert.ok(evaluated.checkpoints[0].observation, "local state keeps the observation too");
  });

  it("10. an unmeasured alignment is reported as unmeasured, not as a good angle", () => {
    runFireAttempt();
    const [queued] = getQueuedAttempts();
    const exit = queued.checkpoints.find((c) => c.checkpointId === "fire_exit_identification");

    assert.strictEqual(exit.observation.kind, "spatial_alignment");
    assert.strictEqual(exit.observation.angularErrorRad, UNMEASURED_ANGLE_RAD);
    assert.strictEqual(exit.observation.frameCount, 0);
    assert.strictEqual(exit.observation.trackingSource, "arjs_marker");
  });

  it("11. a measured alignment reports the angle the sampler actually saw", () => {
    const obs = spatialAlignment({
      anchorId: "gas_hazard_zone",
      angularErrorRad: 0.21,
      dwellMs: 3000,
      frameCount: 91,
      trackingSource: "arjs_marker"
    });
    assert.strictEqual(obs.angularErrorRad, 0.21);
    assert.strictEqual(obs.frameCount, 91);
  });

  it("12. a tapped aim fallback reports no distance rather than a flattering one", () => {
    const obs = aimDwell({
      hitDistanceM: null,
      dwellMs: 400,
      sweepCoverage: null,
      frameCount: 0,
      trackingSource: "arjs_marker"
    });
    assert.strictEqual(obs.hitDistanceM, null);
    assert.strictEqual(obs.sweepCoverage, null);
  });

  it("13. a selection_multi keeps the raw choice and drops duplicates", () => {
    const obs = selectionMulti(["scba_respirator", "scba_respirator", "multi_gas_detector"]);
    assert.deepStrictEqual(obs.selected, ["scba_respirator", "multi_gas_detector"]);
    assert.deepStrictEqual(Object.keys(obs).sort(), ["kind", "selected"]);
  });

  it("14. the engine refuses to build a payload for a checkpoint with no observation", () => {
    startAssessmentSession({ workerId: "WRK-0001", moduleId: "fire-response", arTier: 2 });
    recordCheckpointResult({
      checkpointId: "fire_exit_identification",
      type: "proximity",
      passed: true,
      context: {},
      observation: null,
      timestamp: new Date().toISOString()
    });
    assert.throws(() => finishAssessmentSession(), /missing its v2 observation/);
    abortAssessmentSession();
  });

  it("15. toWireAttempt refuses an unknown observation kind", () => {
    assert.throws(
      () => toWireAttempt({
        attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
        checkpoints: [{ checkpointId: "x", timestamp: new Date().toISOString(), observation: null }]
      }),
      /cannot sync without an observation/
    );
  });
});
