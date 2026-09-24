import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  setTierLoaders,
  loadModule,
  unloadModule
} from "../js/module-loader.js";
import {
  getActiveSession,
  getQueuedAttempts,
  clearAttemptQueue,
  abortAssessmentSession,
  bindAssessmentSessionListeners,
  unbindAssessmentSessionListeners,
  syncQueuedAttempts,
  getEffectiveWorkerId
} from "../assessment/engine.js";
import { REQUIRED_EQUIPMENT_IDS } from "../prerequisite/equipment-data.js";
import { markEquipmentViewed } from "../prerequisite/progress.js";
import { startFireModule, cleanupFireModule } from "../modules/fire-response/fire-response.js";
import { startGasLeakModule, cleanupGasLeakModule } from "../modules/gas-leak/gas-leak.js";
import { loadLocale, setLocale, t, clearLocales } from "../js/i18n.js";
import { validateAttemptContract } from "../../backend/models/attempt.js";
import { validateSyncPayload } from "../../backend/models/sync.js";
import { initDatabase, closeDatabase } from "../../backend/db/index.js";
import { seedDatabase } from "../../backend/db/seed.js";
import { getModule, getCheckpointDefinitions } from "../../backend/services/modules.js";
import { ingestAttempt, recordSyncBatch } from "../../backend/services/attempts.js";
import { checkAgainstManifest } from "../../backend/models/attempt.js";

// mock storage
let store = {};
globalThis.localStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { store = {}; }
};

// mock window and DOM elements
const _listeners = {};
const _elements = {};

function _mockElement(id) {
  const listeners = {};
  const el = {
    id,
    dataset: {},
    style: {},
    innerHTML: "",
    textContent: "",
    appendChild(child) {
      if (child && child.id) {
        _elements[child.id] = child;
      }
      return child;
    },
    querySelector(sel) {
      if (sel.startsWith("#")) {
        return _elements[sel.slice(1)] || null;
      }
      return null;
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    click() {
      (listeners.click || []).forEach((fn) => fn({}));
    },
    remove() {
      delete _elements[id];
    }
  };
  _elements[id] = el;
  return el;
}

globalThis.document = {
  createElement: (tag) => {
    const el = _mockElement(`mock-${tag}-${Math.random()}`);
    return el;
  },
  getElementById: (id) => _elements[id] || null,
  querySelector: (sel) => {
    if (sel.startsWith("#")) {
      return _elements[sel.slice(1)] || null;
    }
    return null;
  }
};

globalThis.window = {
  dispatchEvent(ev) {
    (_listeners[ev.type] || []).forEach((fn) => fn(ev));
  },
  addEventListener(type, fn) {
    if (!_listeners[type]) _listeners[type] = [];
    _listeners[type].push(fn);
  },
  removeEventListener(type, fn) {
    if (!_listeners[type]) return;
    _listeners[type] = _listeners[type].filter((f) => f !== fn);
  },
  localStorage: globalThis.localStorage
};

// the loader rolls the attemptId and the gas reading comes from it. pin the id so the
// branch is known: 0b5e1a2c rolls 0.88% CH4, below the 1.25% withdrawal limit
const LOW_METHANE_ATTEMPT_ID = "0b5e1a2c-3d4e-4f56-8a7b-9c0d1e2f3a4b";

async function loadFireWithAttempt(attemptId) {
  const original = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => attemptId;
  try {
    await loadModule("fire-response");
  } finally {
    globalThis.crypto.randomUUID = original;
  }
}

// gas below the limit: fight the fire, sound the alarm first
function decideToFightAndPullAlarm() {
  _elements["btn-decision-extinguish"]?.click();
  _elements["btn-pull-alarm"]?.click();
}

function clickThroughSubscreens() {
  let nextBtn = _elements["btn-step-next"];
  let count = 0;
  while (nextBtn && count < 10) {
    nextBtn.click();
    nextBtn = _elements["btn-step-next"];
    count++;
  }
}

describe("End-to-End Runtime Integration", () => {
  beforeEach(() => {
    store = {};
    clearAttemptQueue();
    abortAssessmentSession();
    unbindAssessmentSessionListeners();
    clearLocales();
    setLocale("hi");

    // every module entry runs the equipment gate now. these tests are about what
    // happens after a worker is let in, so they walk the set first.
    REQUIRED_EQUIPMENT_IDS.forEach((id) => markEquipmentViewed(getEffectiveWorkerId(), id));

    Object.keys(_elements).forEach((k) => delete _elements[k]);
    _mockElement("ar-viewport");

    // mock tier scene loader
    setTierLoaders(2, async (moduleId) => {
      const container = document.getElementById("ar-viewport");
      if (moduleId === "fire-response") {
        startFireModule(container, { tier: 2 });
      } else if (moduleId === "gas-leak") {
        startGasLeakModule(container, { tier: 2 });
      }
    }, {});
  });

  it("loading Fire starts exactly one assessment session", async () => {
    await loadModule("fire-response");
    const session = getActiveSession();
    assert.ok(session !== null, "session must be active");
    assert.strictEqual(session.moduleId, "fire-response");
    assert.strictEqual(session.checkpoints.length, 0);

    cleanupFireModule();
    unloadModule();
  });

  it("loading Gas starts exactly one assessment session", async () => {
    await loadModule("gas-leak");
    const session = getActiveSession();
    assert.ok(session !== null, "session must be active");
    assert.strictEqual(session.moduleId, "gas-leak");
    assert.strictEqual(session.checkpoints.length, 0);

    cleanupGasLeakModule();
    unloadModule();
  });

  it("repeated module load does not register duplicate checkpoint listeners", async () => {
    bindAssessmentSessionListeners();
    bindAssessmentSessionListeners();
    bindAssessmentSessionListeners();

    await loadModule("fire-response");

    // emit checkpoint
    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();

    const session = getActiveSession();
    assert.strictEqual(session.checkpoints.length, 1);
    assert.strictEqual(session.checkpoints[0].checkpointId, "fire_exit_identification");

    cleanupFireModule();
    unloadModule();
  });

  it("checkpoint event is recorded by the active session", async () => {
    await loadModule("fire-response");

    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();

    const session = getActiveSession();
    assert.strictEqual(session.checkpoints.length, 1);
    assert.strictEqual(session.checkpoints[0].checkpointId, "fire_exit_identification");
    assert.strictEqual(session.checkpoints[0].passed, true);

    cleanupFireModule();
    unloadModule();
  });

  it("completing Fire module creates exactly one queued attempt matching backend contract", async () => {
    await loadFireWithAttempt(LOW_METHANE_ATTEMPT_ID);

    // step 1: confirm exit, then the gas decision gate
    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();
    decideToFightAndPullAlarm();

    // step 2: PASS technique
    const pin = _elements["extinguisher-pin"];
    if (pin?.simulateSelect) pin.simulateSelect();
    if (pin?.simulatePull) pin.simulatePull(60);
    const reticle = _elements["aim-reticle"];
    if (reticle?.simulateAim) reticle.simulateAim(0.85, 0.12);
    const handle = _elements["extinguisher-handle"];
    if (handle?.simulateSelect) handle.simulateSelect();
    if (handle?.simulateSqueeze) handle.simulateSqueeze(1500);
    const sweep = _elements["sweep-zone"];
    if (sweep?.simulateSweep) sweep.simulateSweep([0, 100, 200, 240]);

    // step 3: pick correct evacuation option
    clickThroughSubscreens();
    const btnEvac = _elements["evacuation-opt-sound_alarm_then_evacuate"];
    assert.ok(btnEvac, "evacuation option button must exist");
    btnEvac.click();

    // assessment session should now be finalized and queued
    assert.strictEqual(getActiveSession(), null, "active session should be closed after completion");

    const queued = getQueuedAttempts();
    assert.strictEqual(queued.length, 1, "exactly one attempt should be queued");

    const attempt = queued[0];
    assert.strictEqual(attempt.moduleId, "fire-response");
    assert.strictEqual(attempt.workerId, "WRK-0001", "workerId must be valid provisioned worker WRK-0001");
    assert.notStrictEqual(attempt.workerId, "WRK-DEFAULT", "workerId must NEVER be WRK-DEFAULT");
    assert.strictEqual(attempt.status, "completed");
    assert.strictEqual(attempt.contractVersion, "2.0");
    assert.strictEqual(attempt.clientClaimedPassed, true);
    assert.strictEqual(typeof attempt.clientClaimedPercentage, "number");
    // exit, decision gate, alarm, aim, evacuation
    assert.strictEqual(attempt.checkpoints.length, 5);
    assert.strictEqual(attempt.arTier, 2, "the loader records the tier it booted");
    assert.strictEqual(attempt.locale, "hi", "the loader records the active locale");
    // the phone's own score never rides on the wire
    assert.ok(!("passed" in attempt) && !("totalScore" in attempt) && !("percentage" in attempt));

    // the migration's whole point: a payload the real modules built, accepted by
    // the real backend validator
    const validatedFire = validateAttemptContract(attempt);
    assert.strictEqual(validatedFire.attemptId, attempt.attemptId);
    assert.ok(attempt.checkpoints.every((cp) => cp.observedAt && cp.observation));

    // exit module — must not discard queued attempt
    _elements["btn-module-exit"]?.click();
    assert.strictEqual(getQueuedAttempts().length, 1, "queued attempt must persist after exit button click");
  });

  it("completing Gas module creates exactly one queued attempt matching backend contract", async () => {
    await loadModule("gas-leak");

    // step 1: acknowledge hazard zone
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();

    // step 2: toggle mandatory PPE and confirm
    clickThroughSubscreens();
    _elements["ppe-opt-scba_respirator"]?.click();
    _elements["ppe-opt-multi_gas_detector"]?.click();
    _elements["ppe-opt-safety_harness"]?.click();
    _elements["btn-confirm-ppe"]?.click();

    // step 3: select correct buddy procedure
    clickThroughSubscreens();
    _elements["buddy-opt-standby_outside_with_lifeline"]?.click();

    assert.strictEqual(getActiveSession(), null);

    const queued = getQueuedAttempts();
    assert.strictEqual(queued.length, 1);

    const attempt = queued[0];
    assert.strictEqual(attempt.moduleId, "gas-leak");
    assert.strictEqual(attempt.workerId, "WRK-0001", "workerId must be valid provisioned worker WRK-0001");
    assert.notStrictEqual(attempt.workerId, "WRK-DEFAULT", "workerId must NEVER be WRK-DEFAULT");
    assert.strictEqual(attempt.status, "completed");
    assert.strictEqual(attempt.contractVersion, "2.0");
    assert.strictEqual(attempt.clientClaimedPassed, true);
    assert.strictEqual(attempt.checkpoints.length, 3);

    const validatedGas = validateAttemptContract(attempt);
    assert.strictEqual(validatedGas.moduleId, "gas-leak");
    assert.ok(attempt.checkpoints.every((cp) => cp.observedAt && cp.observation));

    _elements["btn-module-exit"]?.click();
    assert.strictEqual(getQueuedAttempts().length, 1);
  });

  it("incomplete/aborted module does NOT create a false completed attempt", async () => {
    await loadModule("fire-response");

    // complete only step 1
    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();
    assert.ok(getActiveSession() !== null);

    // worker leaves module prematurely
    unloadModule();

    assert.strictEqual(getActiveSession(), null);
    assert.strictEqual(getQueuedAttempts().length, 0, "aborted module must not queue an attempt");
  });

  it("locale dictionary is available before localized module rendering", async () => {
    await loadLocale("hi");
    setLocale("hi");

    const translatedExit = t("modules.fire_response.step_exit");
    assert.strictEqual(translatedExit, "आपातकालीन निकास पहचानें");

    const translatedHazard = t("modules.gas_leak.step_hazard");
    assert.strictEqual(translatedHazard, "खतरे का क्षेत्र पहचानें");
  });

  it("remaining module options resolve through i18n", async () => {
    await loadLocale("hi");
    setLocale("hi");

    // test fire options localization
    const optSoundAlarm = t("modules.fire_response.opt_sound_alarm_then_evacuate");
    assert.strictEqual(optSoundAlarm, "अलार्म बजाएं → बाहर निकलें");

    // test gas options localization
    const ppeScba = t("modules.gas_leak.ppe_scba_respirator");
    assert.strictEqual(ppeScba, "SCBA / सकारात्मक दबाव श्वासयंत्र");

    const buddyStandby = t("modules.gas_leak.buddy_standby_lifeline");
    assert.strictEqual(buddyStandby, "निरंतर संचार और लाइफलाइन के साथ प्रवेश द्वार के बाहर तैयार रहें");

    // test step indicator localization
    const stepInd = t("app.step_indicator", { current: 1, total: 3 });
    assert.strictEqual(stepInd, "चरण 1 / 3");
  });

  it("completed attempt can be synced via /api/sync envelope and satisfies SQLite database schema", async () => {
    clearAttemptQueue();
    await loadFireWithAttempt(LOW_METHANE_ATTEMPT_ID);

    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();
    decideToFightAndPullAlarm();
    const pin = _elements["extinguisher-pin"];
    if (pin?.simulateSelect) pin.simulateSelect();
    if (pin?.simulatePull) pin.simulatePull(60);
    const reticle = _elements["aim-reticle"];
    if (reticle?.simulateAim) reticle.simulateAim(0.9, 0.1);
    const handle = _elements["extinguisher-handle"];
    if (handle?.simulateSelect) handle.simulateSelect();
    if (handle?.simulateSqueeze) handle.simulateSqueeze(1500);
    const sweep = _elements["sweep-zone"];
    if (sweep?.simulateSweep) sweep.simulateSweep([0, 100, 200, 240]);

    clickThroughSubscreens();
    _elements["evacuation-opt-sound_alarm_then_evacuate"]?.click();

    const queued = getQueuedAttempts();
    assert.strictEqual(queued.length, 1);
    const attempt = queued[0];

    // verify payload passes Krishna's backend sync validator
    let sentEnvelope = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      sentEnvelope = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          batchId: sentEnvelope.batchId,
          received: 1,
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          results: sentEnvelope.attempts.map((a) => ({ attemptId: a.attemptId, status: "accepted" }))
        })
      };
    };

    try {
      const syncResult = await syncQueuedAttempts();
      assert.strictEqual(syncResult.success, true);
      assert.strictEqual(syncResult.synced, 1);
      assert.strictEqual(getQueuedAttempts().length, 0);

      assert.strictEqual(sentEnvelope.workerId, "WRK-0001");

      const validatedEnvelope = validateSyncPayload(sentEnvelope, { now: Date.now() });
      assert.strictEqual(validatedEnvelope.attempts.length, 1);
      assert.strictEqual(validatedEnvelope.attempts[0].contractVersion, "2.0");

      // test real SQLite insertion with seed database and foreign keys enabled
      const db = initDatabase(":memory:");
      try {
        seedDatabase(db);

        recordSyncBatch(db, {
          batchId: sentEnvelope.batchId,
          workerId: sentEnvelope.workerId,
          deviceId: sentEnvelope.deviceId,
          receivedAt: sentEnvelope.sentAt,
          attemptCount: 1
        });

        // the real referential check and the real grader, not a hand-rolled insert
        const definitions = getCheckpointDefinitions(db, attempt.moduleId);
        checkAgainstManifest(validatedEnvelope.attempts[0], definitions);

        const outcome = ingestAttempt(db, {
          attempt: validatedEnvelope.attempts[0],
          definitions,
          moduleRow: getModule(db, attempt.moduleId),
          batchId: sentEnvelope.batchId,
          receivedAt: sentEnvelope.sentAt
        });
        assert.strictEqual(outcome.status, "accepted", "the server must accept what the modules built");
        assert.strictEqual(outcome.gradingStatus, "graded", "the optional exit sighting must not block grading");

        const row = db.prepare("SELECT * FROM attempt WHERE attempt_id = ?").get(attempt.attemptId);
        assert.ok(row, "attempt must be successfully inserted in database");
        assert.strictEqual(row.contract_version, "2.0");
        assert.strictEqual(row.worker_id, "WRK-0001");
      } finally {
        closeDatabase();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
