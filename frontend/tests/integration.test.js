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
  syncQueuedAttempts
} from "../assessment/engine.js";
import { startFireModule, cleanupFireModule } from "../modules/fire-response/fire-response.js";
import { startGasLeakModule, cleanupGasLeakModule } from "../modules/gas-leak/gas-leak.js";
import { loadLocale, setLocale, t, clearLocales } from "../js/i18n.js";
import { validateAttemptContract } from "../../backend/models/attempt.js";
import { validateSyncPayload } from "../../backend/models/sync.js";
import { initDatabase, closeDatabase } from "../../backend/db/index.js";
import { seedDatabase } from "../../backend/db/seed.js";

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
    await loadModule("fire-response");

    // step 1: confirm exit
    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();

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
    assert.strictEqual(attempt.passed, true);
    assert.strictEqual(attempt.checkpoints.length, 3);
    assert.strictEqual(attempt.totalScore, 2.85);

    // contract validation against backend schema
    const validation = validateAttemptContract(attempt);
    assert.ok(validation, "queued attempt must strictly pass backend contract schema");
    assert.strictEqual(validation.attemptId, attempt.attemptId);

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
    assert.strictEqual(attempt.passed, true);
    assert.strictEqual(attempt.checkpoints.length, 3);
    assert.strictEqual(attempt.totalScore, 3);

    const validation = validateAttemptContract(attempt);
    assert.ok(validation);
    assert.strictEqual(validation.attemptId, attempt.attemptId);

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
    await loadModule("fire-response");

    clickThroughSubscreens();
    _elements["btn-exit-found"]?.click();
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
        json: async () => ({ batchId: sentEnvelope.batchId, status: "accepted", processed: 1 })
      };
    };

    try {
      const syncResult = await syncQueuedAttempts();
      assert.strictEqual(syncResult.success, true);
      assert.strictEqual(syncResult.synced, 1);
      assert.strictEqual(getQueuedAttempts().length, 0);

      // validate backend envelope model
      const validatedEnvelope = validateSyncPayload(sentEnvelope, { now: Date.now() });
      assert.strictEqual(validatedEnvelope.workerId, "WRK-0001");

      // test real SQLite insertion with seed database and foreign keys enabled
      const db = initDatabase(":memory:");
      try {
        seedDatabase(db);

        // insert sync_batch referencing worker_id
        db.prepare(
          `INSERT INTO sync_batch (batch_id, worker_id, device_id, received_at, attempt_count, status)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(validatedEnvelope.batchId, validatedEnvelope.workerId, validatedEnvelope.deviceId, validatedEnvelope.sentAt, 1, "accepted");

        // insert attempt referencing worker_id and module_id
        db.prepare(
          `INSERT INTO attempt (
             attempt_id, worker_id, module_id, module_version, contract_version,
             engine_version, device_id, ar_tier, locale, started_at, completed_at,
             duration_ms, status, server_total_score, server_max_score, server_percentage,
             server_passed, threshold_applied, client_percentage, client_passed,
             sync_batch_id, server_received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          attempt.attemptId,
          attempt.workerId,
          attempt.moduleId,
          attempt.moduleVersion,
          attempt.contractVersion,
          attempt.engineVersion,
          attempt.deviceId,
          attempt.arTier,
          attempt.locale,
          attempt.startedAt,
          attempt.completedAt,
          attempt.durationMs,
          attempt.status,
          attempt.totalScore,
          attempt.maxScore,
          attempt.percentage,
          attempt.passed ? 1 : 0,
          attempt.passThresholdUsed,
          attempt.percentage,
          attempt.passed ? 1 : 0,
          validatedEnvelope.batchId,
          validatedEnvelope.sentAt
        );

        const row = db.prepare("SELECT * FROM attempt WHERE attempt_id = ?").get(attempt.attemptId);
        assert.ok(row, "attempt must be successfully inserted in database");
        assert.strictEqual(row.worker_id, "WRK-0001");
      } finally {
        closeDatabase();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
