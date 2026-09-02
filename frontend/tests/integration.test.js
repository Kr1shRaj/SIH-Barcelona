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
  unbindAssessmentSessionListeners
} from "../assessment/engine.js";
import { startFireModule, cleanupFireModule } from "../modules/fire-response/fire-response.js";
import { startGasLeakModule, cleanupGasLeakModule } from "../modules/gas-leak/gas-leak.js";
import { loadLocale, setLocale, t, clearLocales } from "../js/i18n.js";
import { validateAttemptContract } from "../../backend/models/attempt.js";

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
    _elements["btn-exit-found"]?.click();

    const session = getActiveSession();
    assert.strictEqual(session.checkpoints.length, 1);
    assert.strictEqual(session.checkpoints[0].checkpointId, "fire_exit_identification");

    cleanupFireModule();
    unloadModule();
  });

  it("checkpoint event is recorded by the active session", async () => {
    await loadModule("fire-response");

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
    _elements["btn-exit-found"]?.click();

    // step 2: aim and confirm
    const btnAimConfirm = _elements["btn-aim-confirm"];
    assert.ok(btnAimConfirm, "aim confirm button must exist");
    btnAimConfirm._testAccuracy = 0.85;
    btnAimConfirm.click();

    // step 3: pick correct evacuation option
    const btnEvac = _elements["evacuation-opt-sound_alarm_then_evacuate"];
    assert.ok(btnEvac, "evacuation option button must exist");
    btnEvac.click();

    // assessment session should now be finalized and queued
    assert.strictEqual(getActiveSession(), null, "active session should be closed after completion");

    const queued = getQueuedAttempts();
    assert.strictEqual(queued.length, 1, "exactly one attempt should be queued");

    const attempt = queued[0];
    assert.strictEqual(attempt.moduleId, "fire-response");
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
    _elements["btn-hazard-found"]?.click();

    // step 2: toggle mandatory PPE and confirm
    _elements["ppe-opt-scba_respirator"]?.click();
    _elements["ppe-opt-multi_gas_detector"]?.click();
    _elements["ppe-opt-safety_harness"]?.click();
    _elements["btn-confirm-ppe"]?.click();

    // step 3: select correct buddy procedure
    _elements["buddy-opt-standby_outside_with_lifeline"]?.click();

    assert.strictEqual(getActiveSession(), null);

    const queued = getQueuedAttempts();
    assert.strictEqual(queued.length, 1);

    const attempt = queued[0];
    assert.strictEqual(attempt.moduleId, "gas-leak");
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
});
