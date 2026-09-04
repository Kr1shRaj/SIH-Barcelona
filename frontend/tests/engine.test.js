import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  evaluateAssessment,
  queueAttemptForSync,
  getQueuedAttempts,
  clearAttemptQueue,
  removeSyncedAttempts,
  syncQueuedAttempts,
  startAssessmentSession,
  getActiveSession,
  recordCheckpointResult,
  finishAssessmentSession,
  abortAssessmentSession,
  bindAssessmentSessionListeners,
  unbindAssessmentSessionListeners,
  getEffectiveWorkerId,
  setWorkerId,
  getDeviceId,
  fetchModuleManifests,
  getModuleManifest,
  validateModuleManifests,
  getCachedOrLocalManifest,
  CANONICAL_DEMO_WORKER_ID,
  DEFAULT_LOCAL_MANIFESTS,
  QUEUE_STORAGE_KEY,
  WORKER_STORAGE_KEY,
  MANIFEST_STORAGE_KEY
} from "../assessment/engine.js";
import { validateSyncPayload } from "../../backend/models/sync.js";

// mock local storage for node test runner
if (typeof globalThis.localStorage === "undefined") {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

// event bus for custom events in test environment
const _eventListeners = {};
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    dispatchEvent(ev) {
      (_eventListeners[ev.type] || []).forEach((fn) => fn(ev));
    },
    addEventListener(type, fn) {
      if (!_eventListeners[type]) _eventListeners[type] = [];
      _eventListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!_eventListeners[type]) return;
      _eventListeners[type] = _eventListeners[type].filter((f) => f !== fn);
    }
  };
}

// sample valid fire response attempt input
function createValidFireAttempt(overrides = {}) {
  return {
    contractVersion: "1.0",
    attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
    workerId: "WRK-0001",
    moduleId: "fire-response",
    moduleVersion: 1,
    engineVersion: "1.0.0",
    deviceId: "dev-8f3a2b1c",
    arTier: 2,
    locale: "hi",
    startedAt: "2026-09-01T10:14:02.118Z",
    completedAt: "2026-09-01T10:17:41.556Z",
    durationMs: 219438,
    status: "completed",
    checkpoints: [
      {
        checkpointId: "fire_exit_identification",
        type: "proximity",
        passed: true,
        score: 1,
        weight: 1,
        timestamp: "2026-09-01T10:14:39.902Z",
        context: { method: "button_confirm" }
      },
      {
        checkpointId: "fire_extinguisher_aim",
        type: "aim",
        passed: true,
        score: 0.75,
        weight: 1,
        timestamp: "2026-09-01T10:16:20.410Z",
        context: { accuracy: 0.75, target: "base", distance: 0.2 }
      },
      {
        checkpointId: "fire_evacuation_sequence",
        type: "select",
        passed: true,
        score: 1,
        weight: 1,
        timestamp: "2026-09-01T10:17:41.556Z",
        context: { selected: "sound_alarm_then_evacuate", correct: "sound_alarm_then_evacuate" }
      }
    ],
    ...overrides
  };
}

// sample valid gas leak attempt input
function createValidGasAttempt(overrides = {}) {
  return {
    contractVersion: "1.0",
    attemptId: "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64",
    workerId: "WRK-0004",
    moduleId: "gas-leak",
    moduleVersion: 1,
    engineVersion: "1.0.0",
    deviceId: "dev-4b19c7de",
    arTier: 2,
    locale: "sat",
    startedAt: "2026-09-01T11:02:15.004Z",
    completedAt: "2026-09-01T11:06:03.771Z",
    durationMs: 228767,
    status: "completed",
    checkpoints: [
      {
        checkpointId: "gas_hazard_zone_recognition",
        type: "proximity",
        passed: true,
        score: 1,
        weight: 1,
        timestamp: "2026-09-01T11:03:01.220Z",
        context: { method: "button_confirm" }
      },
      {
        checkpointId: "gas_ppe_selection",
        type: "select",
        passed: false,
        score: 0.67,
        weight: 1,
        timestamp: "2026-09-01T11:04:52.640Z",
        context: {
          selected: ["scba_respirator", "multi_gas_detector"],
          score: 0.67,
          missing: ["safety_harness"],
          forbidden: []
        }
      },
      {
        checkpointId: "gas_buddy_procedure",
        type: "select",
        passed: true,
        score: 1,
        weight: 1,
        timestamp: "2026-09-01T11:06:03.771Z",
        context: { selected: "standby_outside_with_lifeline", correct: "standby_outside_with_lifeline" }
      }
    ],
    ...overrides
  };
}

describe("Assessment Engine — evaluateAssessment", () => {
  beforeEach(() => {
    clearAttemptQueue();
    abortAssessmentSession();
  });

  describe("passing attempt evaluations", () => {
    it("correctly evaluates passing fire-response attempt and strips answer key", () => {
      const input = createValidFireAttempt();
      const result = evaluateAssessment(input, 0.7);

      assert.strictEqual(result.contractVersion, "1.0");
      assert.strictEqual(result.attemptId, "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51");
      assert.strictEqual(result.workerId, "WRK-0001");
      assert.strictEqual(result.moduleId, "fire-response");
      assert.strictEqual(result.totalScore, 2.75);
      assert.strictEqual(result.maxScore, 3);
      assert.strictEqual(result.percentage, 91.67);
      assert.strictEqual(result.passThresholdUsed, 0.7);
      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.status, "completed");
      assert.strictEqual(result.checkpoints.length, 3);

      const step3Context = result.checkpoints[2].context;
      assert.strictEqual(step3Context.selected, "sound_alarm_then_evacuate");
      assert.strictEqual(Object.prototype.hasOwnProperty.call(step3Context, "correct"), false);
    });

    it("correctly evaluates passing gas-leak attempt with partial score and strips answer key", () => {
      const input = createValidGasAttempt();
      const result = evaluateAssessment(input, 0.7);

      assert.strictEqual(result.moduleId, "gas-leak");
      assert.strictEqual(result.totalScore, 2.67);
      assert.strictEqual(result.maxScore, 3);
      assert.strictEqual(result.percentage, 89);
      assert.strictEqual(result.passThresholdUsed, 0.7);
      assert.strictEqual(result.passed, true);

      const buddyContext = result.checkpoints[2].context;
      assert.strictEqual(buddyContext.selected, "standby_outside_with_lifeline");
      assert.strictEqual(Object.prototype.hasOwnProperty.call(buddyContext, "correct"), false);

      const ppeContext = result.checkpoints[1].context;
      assert.deepStrictEqual(ppeContext.missing, ["safety_harness"]);
    });

    it("uses passThresholdUsed from attemptRecord if second argument is omitted", () => {
      const input = createValidFireAttempt({ passThresholdUsed: 0.8 });
      const result = evaluateAssessment(input);
      assert.strictEqual(result.passThresholdUsed, 0.8);
      assert.strictEqual(result.passed, true);
    });
  });

  describe("failing attempt evaluations", () => {
    it("correctly computes failing attempt when score falls below threshold", () => {
      const input = createValidFireAttempt({
        checkpoints: [
          {
            checkpointId: "fire_exit_identification",
            type: "proximity",
            passed: false,
            score: 0,
            weight: 1,
            timestamp: "2026-09-01T10:14:39.902Z",
            context: {}
          },
          {
            checkpointId: "fire_extinguisher_aim",
            type: "aim",
            passed: false,
            score: 0.2,
            weight: 1,
            timestamp: "2026-09-01T10:16:20.410Z",
            context: { accuracy: 0.2 }
          },
          {
            checkpointId: "fire_evacuation_sequence",
            type: "select",
            passed: false,
            score: 0,
            weight: 1,
            timestamp: "2026-09-01T10:17:41.556Z",
            context: { selected: "gather_belongings" }
          }
        ]
      });

      const result = evaluateAssessment(input, 0.7);
      assert.strictEqual(result.totalScore, 0.2);
      assert.strictEqual(result.maxScore, 3);
      assert.strictEqual(result.percentage, 6.67);
      assert.strictEqual(result.passed, false);
    });
  });

  describe("malformed input rejections", () => {
    it("throws when attemptRecord is null, string, or array", () => {
      assert.throws(() => evaluateAssessment(null, 0.7), /attemptRecord must be an object/);
      assert.throws(() => evaluateAssessment("not an object", 0.7), /attemptRecord must be an object/);
      assert.throws(() => evaluateAssessment([], 0.7), /attemptRecord must be an object/);
    });

    it("throws when attemptId is not a UUID v4", () => {
      const input = createValidFireAttempt({ attemptId: "invalid-uuid" });
      assert.throws(() => evaluateAssessment(input, 0.7), /attemptId must be a UUID v4/);
    });

    it("throws when moduleId is uppercase or invalid identifier", () => {
      const input = createValidFireAttempt({ moduleId: "Fire-Response" });
      assert.throws(() => evaluateAssessment(input, 0.7), /moduleId must be a lowercase identifier/);
    });

    it("throws when moduleVersion is missing or non-positive integer", () => {
      const input = createValidFireAttempt({ moduleVersion: 0 });
      assert.throws(() => evaluateAssessment(input, 0.7), /moduleVersion must be a positive integer/);
    });

    it("throws when arTier is not 1 or 2", () => {
      const input = createValidFireAttempt({ arTier: 3 });
      assert.throws(() => evaluateAssessment(input, 0.7), /arTier must be 1 or 2/);
    });

    it("throws when locale is invalid", () => {
      const input = createValidFireAttempt({ locale: "x" });
      assert.throws(() => evaluateAssessment(input, 0.7), /locale must be a string between 2 and 8 characters/);
    });

    it("throws when startedAt or completedAt timestamps are invalid", () => {
      const badStarted = createValidFireAttempt({ startedAt: "2026-02-31T10:00:00.000Z" });
      assert.throws(() => evaluateAssessment(badStarted, 0.7), /startedAt must be a valid ISO 8601 UTC timestamp/);

      const badCompleted = createValidFireAttempt({ completedAt: "invalid-date" });
      assert.throws(() => evaluateAssessment(badCompleted, 0.7), /completedAt must be a valid ISO 8601 UTC timestamp/);
    });

    it("throws when completedAt is earlier than startedAt", () => {
      const input = createValidFireAttempt({
        startedAt: "2026-09-01T10:20:00.000Z",
        completedAt: "2026-09-01T10:10:00.000Z"
      });
      assert.throws(() => evaluateAssessment(input, 0.7), /completedAt must not be earlier than startedAt/);
    });

    it("throws when durationMs exceeds maximum limit", () => {
      const input = createValidFireAttempt({ durationMs: 5 * 60 * 60 * 1000 });
      assert.throws(() => evaluateAssessment(input, 0.7), /durationMs must be an integer between 0 and 14400000/);
    });

    it("throws when checkpoints is empty or not an array", () => {
      const input = createValidFireAttempt({ checkpoints: [] });
      assert.throws(() => evaluateAssessment(input, 0.7), /checkpoints must be a non-empty array/);
    });

    it("throws when checkpoints contain duplicate checkpointId", () => {
      const input = createValidFireAttempt({
        checkpoints: [
          {
            checkpointId: "fire_exit_identification",
            type: "proximity",
            passed: true,
            score: 1,
            weight: 1,
            timestamp: "2026-09-01T10:14:39.902Z",
            context: {}
          },
          {
            checkpointId: "fire_exit_identification",
            type: "proximity",
            passed: true,
            score: 1,
            weight: 1,
            timestamp: "2026-09-01T10:15:39.902Z",
            context: {}
          }
        ]
      });
      assert.throws(() => evaluateAssessment(input, 0.7), /duplicate checkpoint/);
    });

    it("throws when checkpoint type is invalid", () => {
      const input = createValidFireAttempt();
      input.checkpoints[0].type = "unknown_type";
      assert.throws(() => evaluateAssessment(input, 0.7), /invalid type/);
    });

    it("throws when checkpoint score is out of range", () => {
      const input = createValidFireAttempt();
      input.checkpoints[0].score = 1.5;
      assert.throws(() => evaluateAssessment(input, 0.7), /score must be between 0 and 1/);
    });

    it("throws when checkpoint weight is non-positive", () => {
      const input = createValidFireAttempt();
      input.checkpoints[0].weight = 0;
      assert.throws(() => evaluateAssessment(input, 0.7), /weight must be a positive number/);
    });

    it("throws when checkpoint timestamp is outside attempt window", () => {
      const input = createValidFireAttempt();
      input.checkpoints[0].timestamp = "2026-09-01T09:00:00.000Z";
      assert.throws(() => evaluateAssessment(input, 0.7), /timestamp outside attempt window/);
    });

    it("throws when passThreshold is invalid", () => {
      const input = createValidFireAttempt();
      assert.throws(() => evaluateAssessment(input, -0.1), /passThreshold must be a number between 0 and 1/);
      assert.throws(() => evaluateAssessment(input, 1.5), /passThreshold must be a number between 0 and 1/);
    });

    it("throws when checkpoint context is oversized", () => {
      const input = createValidFireAttempt();
      input.checkpoints[0].context = { largeData: "x".repeat(5000) };
      assert.throws(() => evaluateAssessment(input, 0.7), /context must serialize to 4096 bytes or less/);
    });
  });
});

describe("Offline Queue — queueAttemptForSync", () => {
  beforeEach(() => {
    clearAttemptQueue();
  });

  it("persists an evaluated attempt to offline queue and retrieves it", () => {
    const input = createValidFireAttempt();
    const evaluated = evaluateAssessment(input, 0.7);

    const queue = queueAttemptForSync(evaluated);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].attemptId, evaluated.attemptId);

    const retrieved = getQueuedAttempts();
    assert.strictEqual(retrieved.length, 1);
    assert.deepStrictEqual(retrieved[0], evaluated);
  });

  it("queues multiple attempts in correct chronological order", () => {
    const fireEvaluated = evaluateAssessment(createValidFireAttempt(), 0.7);
    const gasEvaluated = evaluateAssessment(createValidGasAttempt(), 0.7);

    queueAttemptForSync(fireEvaluated);
    queueAttemptForSync(gasEvaluated);

    const retrieved = getQueuedAttempts();
    assert.strictEqual(retrieved.length, 2);
    assert.strictEqual(retrieved[0].moduleId, "fire-response");
    assert.strictEqual(retrieved[1].moduleId, "gas-leak");
  });

  it("clears the attempt queue on clearAttemptQueue", () => {
    const evaluated = evaluateAssessment(createValidFireAttempt(), 0.7);
    queueAttemptForSync(evaluated);
    assert.strictEqual(getQueuedAttempts().length, 1);

    clearAttemptQueue();
    assert.strictEqual(getQueuedAttempts().length, 0);
  });

  it("uses QUEUE_STORAGE_KEY in localStorage to persist attempts", () => {
    const evaluated = evaluateAssessment(createValidFireAttempt(), 0.7);
    queueAttemptForSync(evaluated);
    const raw = globalThis.localStorage.getItem(QUEUE_STORAGE_KEY);
    assert.ok(raw !== null);
    assert.strictEqual(JSON.parse(raw).length, 1);
  });

  it("throws when trying to queue null or malformed attempt", () => {
    assert.throws(() => queueAttemptForSync(null), /attemptRecord must be an object/);
    assert.throws(() => queueAttemptForSync({}), /attemptRecord must have a valid UUID v4 attemptId/);
  });
});

describe("Assessment Session Lifecycle", () => {
  beforeEach(() => {
    clearAttemptQueue();
    abortAssessmentSession();
    unbindAssessmentSessionListeners();
  });

  it("starts an active assessment session with default properties", () => {
    const session = startAssessmentSession({
      workerId: "WRK-0002",
      moduleId: "fire-response",
      locale: "hi"
    });

    assert.strictEqual(session.workerId, "WRK-0002");
    assert.strictEqual(session.moduleId, "fire-response");
    assert.strictEqual(session.passThreshold, 0.7);
    assert.strictEqual(session.locale, "hi");

    const active = getActiveSession();
    assert.ok(active !== null);
    assert.strictEqual(active.moduleId, "fire-response");
  });

  it("records valid checkpoints into active session and ignores duplicates", () => {
    startAssessmentSession({
      moduleId: "fire-response",
      startedAt: "2026-09-01T10:14:02.118Z"
    });

    const cp1 = recordCheckpointResult({
      checkpointId: "fire_exit_identification",
      type: "proximity",
      passed: true,
      timestamp: "2026-09-01T10:14:39.902Z",
      context: { method: "button_confirm" }
    });

    assert.strictEqual(cp1.score, 1);
    assert.strictEqual(cp1.checkpointId, "fire_exit_identification");

    // record duplicate
    const cp1Dup = recordCheckpointResult({
      checkpointId: "fire_exit_identification",
      type: "proximity",
      passed: true,
      timestamp: "2026-09-01T10:14:40.000Z"
    });

    assert.strictEqual(cp1Dup.timestamp, "2026-09-01T10:14:39.902Z");

    const active = getActiveSession();
    assert.strictEqual(active.checkpoints.length, 1);
  });

  it("completes and evaluates active session, queuing attempt for sync", () => {
    startAssessmentSession({
      attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
      workerId: "WRK-0001",
      moduleId: "fire-response",
      moduleVersion: 1,
      engineVersion: "1.0.0",
      deviceId: "dev-8f3a2b1c",
      arTier: 2,
      locale: "hi",
      passThreshold: 0.7,
      startedAt: "2026-09-01T10:14:02.118Z"
    });

    recordCheckpointResult({
      checkpointId: "fire_exit_identification",
      type: "proximity",
      passed: true,
      timestamp: "2026-09-01T10:14:39.902Z",
      context: { method: "button_confirm" }
    });

    recordCheckpointResult({
      checkpointId: "fire_extinguisher_aim",
      type: "aim",
      passed: true,
      timestamp: "2026-09-01T10:16:20.410Z",
      context: { accuracy: 0.75, target: "base", distance: 0.2 }
    });

    recordCheckpointResult({
      checkpointId: "fire_evacuation_sequence",
      type: "select",
      passed: true,
      timestamp: "2026-09-01T10:17:41.556Z",
      context: { selected: "sound_alarm_then_evacuate", correct: "sound_alarm_then_evacuate" }
    });

    const evaluated = finishAssessmentSession({
      completedAt: "2026-09-01T10:17:41.556Z"
    });

    assert.strictEqual(evaluated.passed, true);
    assert.strictEqual(evaluated.percentage, 91.67);
    assert.strictEqual(evaluated.totalScore, 2.75);
    assert.strictEqual(evaluated.status, "completed");

    // verify offline queue has attempt
    const queued = getQueuedAttempts();
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].attemptId, "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51");

    // verify active session is reset (no state leakage)
    assert.strictEqual(getActiveSession(), null);
  });

  it("binds window events to automatically record safear:checkpoint events", () => {
    startAssessmentSession({
      moduleId: "gas-leak",
      startedAt: "2026-09-01T11:02:15.004Z"
    });

    bindAssessmentSessionListeners(window);

    window.dispatchEvent(new CustomEvent("safear:checkpoint", {
      detail: {
        checkpointId: "gas_hazard_zone_recognition",
        type: "proximity",
        passed: true,
        timestamp: "2026-09-01T11:03:01.220Z",
        context: { method: "button_confirm" }
      }
    }));

    const active = getActiveSession();
    assert.strictEqual(active.checkpoints.length, 1);
    assert.strictEqual(active.checkpoints[0].checkpointId, "gas_hazard_zone_recognition");
  });

  it("aborts active session without saving or leaking state", () => {
    startAssessmentSession({ moduleId: "fire-response" });
    assert.ok(getActiveSession() !== null);

    abortAssessmentSession();
    assert.strictEqual(getActiveSession(), null);
    assert.strictEqual(getQueuedAttempts().length, 0);
  });
});

describe("Worker Identification & Resolution", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    delete globalThis.window.location;
  });

  it("returns canonical provisioned demo worker WRK-0001 by default", () => {
    const workerId = getEffectiveWorkerId();
    assert.strictEqual(workerId, CANONICAL_DEMO_WORKER_ID);
    assert.strictEqual(workerId, "WRK-0001");
  });

  it("resolves worker id from localStorage when configured", () => {
    globalThis.localStorage.setItem(WORKER_STORAGE_KEY, "WRK-0003");
    const workerId = getEffectiveWorkerId();
    assert.strictEqual(workerId, "WRK-0003");
  });

  it("resolves worker id from URL query parameter ?workerId= and persists it", () => {
    globalThis.window.location = { search: "?workerId=WRK-0004" };
    const workerId = getEffectiveWorkerId();
    assert.strictEqual(workerId, "WRK-0004");
    assert.strictEqual(globalThis.localStorage.getItem(WORKER_STORAGE_KEY), "WRK-0004");
  });

  it("resolves worker id from URL query parameter ?worker= as alias", () => {
    globalThis.window.location = { search: "?worker=WRK-0005" };
    const workerId = getEffectiveWorkerId();
    assert.strictEqual(workerId, "WRK-0005");
    assert.strictEqual(globalThis.localStorage.getItem(WORKER_STORAGE_KEY), "WRK-0005");
  });

  it("setWorkerId stores valid worker id in localStorage", () => {
    setWorkerId("WRK-0006");
    assert.strictEqual(globalThis.localStorage.getItem(WORKER_STORAGE_KEY), "WRK-0006");
    assert.strictEqual(getEffectiveWorkerId(), "WRK-0006");
  });

  it("setWorkerId rejects empty or oversized worker ids", () => {
    assert.throws(() => setWorkerId(""), /workerId must be a string between 1 and 64 characters/);
    assert.throws(() => setWorkerId("a".repeat(65)), /workerId must be a string between 1 and 64 characters/);
  });

  it("startAssessmentSession defaults to canonical worker WRK-0001, never WRK-DEFAULT", () => {
    const session = startAssessmentSession({ moduleId: "fire-response" });
    assert.strictEqual(session.workerId, "WRK-0001");
    assert.notStrictEqual(session.workerId, "WRK-DEFAULT");
    abortAssessmentSession();
  });

  it("getDeviceId creates and persists stable device identifier", () => {
    const devId1 = getDeviceId();
    assert.ok(typeof devId1 === "string" && devId1.length > 0);
    const devId2 = getDeviceId();
    assert.strictEqual(devId1, devId2);
  });
});

describe("Module Manifest Integration — /api/modules", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("validateModuleManifests validates correct manifest list and rejects malformed", () => {
    assert.strictEqual(validateModuleManifests(DEFAULT_LOCAL_MANIFESTS), true);
    assert.strictEqual(validateModuleManifests([]), false);
    assert.strictEqual(validateModuleManifests(null), false);
    assert.strictEqual(validateModuleManifests([{ moduleId: "bad" }]), false);
  });

  it("getCachedOrLocalManifest returns deterministic offline manifest for fire and gas", () => {
    const fire = getCachedOrLocalManifest("fire-response");
    assert.ok(fire !== null);
    assert.strictEqual(fire.moduleId, "fire-response");
    assert.strictEqual(fire.requiredCheckpoints.length, 3);
    assert.strictEqual(fire.passThreshold, 0.7);

    const gas = getCachedOrLocalManifest("gas-leak");
    assert.ok(gas !== null);
    assert.strictEqual(gas.moduleId, "gas-leak");
    assert.strictEqual(gas.requiredCheckpoints.length, 3);
  });

  it("getCachedOrLocalManifest prioritizes cached manifest when present", () => {
    const custom = [
      {
        ...DEFAULT_LOCAL_MANIFESTS[0],
        passThreshold: 0.85
      }
    ];
    globalThis.localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(custom));

    const fire = getCachedOrLocalManifest("fire-response");
    assert.strictEqual(fire.passThreshold, 0.85);
  });

  it("fetchModuleManifests falls back safely to default manifests when offline", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Network unreachable"); };

    try {
      const manifests = await fetchModuleManifests();
      assert.strictEqual(manifests.length, 2);
      assert.strictEqual(manifests[0].moduleId, "fire-response");
      assert.strictEqual(manifests[1].moduleId, "gas-leak");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetchModuleManifests caches online response in localStorage", async () => {
    const onlineData = [
      {
        moduleId: "fire-response",
        title: "Fire Response Online",
        version: 2,
        passThreshold: 0.75,
        recertMonths: null,
        requiredCheckpoints: [
          { checkpointId: "fire_exit_identification", type: "proximity", weight: 1, required: true, critical: false }
        ]
      }
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => onlineData
    });

    try {
      const manifests = await fetchModuleManifests();
      assert.strictEqual(manifests.length, 1);
      assert.strictEqual(manifests[0].title, "Fire Response Online");

      const cached = JSON.parse(globalThis.localStorage.getItem(MANIFEST_STORAGE_KEY));
      assert.strictEqual(cached[0].version, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getModuleManifest retrieves single module manifest", async () => {
    const fire = await getModuleManifest("fire-response");
    assert.strictEqual(fire.moduleId, "fire-response");
    const gas = await getModuleManifest("gas-leak");
    assert.strictEqual(gas.moduleId, "gas-leak");
  });
});

describe("Attempt Synchronization — /api/sync", () => {
  beforeEach(() => {
    clearAttemptQueue();
    globalThis.localStorage.clear();
  });

  it("removeSyncedAttempts removes only confirmed attempt ids and preserves others", () => {
    const att1 = { ...createValidFireAttempt(), attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51" };
    const att2 = { ...createValidGasAttempt(), attemptId: "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64" };

    queueAttemptForSync(att1);
    queueAttemptForSync(att2);
    assert.strictEqual(getQueuedAttempts().length, 2);

    const remaining = removeSyncedAttempts(["a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51"]);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].attemptId, "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64");
    assert.strictEqual(getQueuedAttempts().length, 1);
  });

  it("syncQueuedAttempts returns immediately when queue is empty", async () => {
    const result = await syncQueuedAttempts();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.synced, 0);
    assert.strictEqual(result.remaining, 0);
  });

  it("syncQueuedAttempts constructs payload validated by backend validateSyncPayload", async () => {
    const fire = evaluateAssessment(createValidFireAttempt(), 0.7);
    queueAttemptForSync(fire);

    let sentBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          batchId: sentBody.batchId,
          received: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          results: sentBody.attempts.map((a) => ({ attemptId: a.attemptId, status: "accepted" }))
        })
      };
    };

    try {
      const result = await syncQueuedAttempts({ workerId: "WRK-0001" });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.synced, 1);
      assert.strictEqual(result.remaining, 0);

      // validate envelope using Krishna's backend validator directly
      const validatedEnvelope = validateSyncPayload(sentBody, { now: Date.now() });
      assert.strictEqual(validatedEnvelope.batchId, sentBody.batchId);
      assert.strictEqual(validatedEnvelope.workerId, "WRK-0001");
      assert.strictEqual(validatedEnvelope.attempts.length, 1);
      assert.strictEqual(validatedEnvelope.attempts[0].workerId, "WRK-0001");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("syncQueuedAttempts retains attempts in queue on network offline failure", async () => {
    const fire = evaluateAssessment(createValidFireAttempt(), 0.7);
    queueAttemptForSync(fire);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Failed to fetch (offline)"); };

    try {
      const result = await syncQueuedAttempts();
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, "network_offline");
      assert.strictEqual(result.remaining, 1);

      // attempt remains in localStorage queue
      assert.strictEqual(getQueuedAttempts().length, 1);
      assert.strictEqual(getQueuedAttempts()[0].attemptId, fire.attemptId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("syncQueuedAttempts retains attempts in queue on backend 4xx or 5xx rejection", async () => {
    const fire = evaluateAssessment(createValidFireAttempt(), 0.7);
    queueAttemptForSync(fire);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "validation_error", issues: ["worker not found"] })
    });

    try {
      const result = await syncQueuedAttempts();
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.reason, "validation_error");
      assert.strictEqual(result.remaining, 1);

      // attempt MUST NOT be dropped on rejection
      assert.strictEqual(getQueuedAttempts().length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

