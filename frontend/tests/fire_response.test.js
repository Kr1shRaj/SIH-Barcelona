import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// --- minimal browser stubs needed by logger, interactions, and fire module ---

// event bus used for both safear:log and safear:checkpoint
const _listeners = {};
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
  }
};

// minimal document stub — enough for fire module overlay + buttons
// _elements: id -> element; lookup is always by current .id value
const _elements = {};

function _makeEl(initId) {
  let _id = initId;
  const el = {
    get id() { return _id; },
    set id(newId) {
      // re-register under new id when id is set after creation
      if (_id && _elements[_id] === el) delete _elements[_id];
      _id = newId;
      if (newId) _elements[newId] = el;
    },
    innerHTML: "",
    style: { cssText: "" },
    dataset: {},
    children: [],
    _listeners: {},
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    setAttribute(name, val) {
      this[name] = val;
    },
    click() { (this._listeners["click"] || []).forEach((fn) => fn()); },
    querySelector(sel) {
      const m = sel.match(/^#(.+)$/);
      return m ? (_elements[m[1]] || null) : null;
    },
    appendChild(child) {
      // register child under its current id so getElementById finds it
      if (child && child.id) _elements[child.id] = child;
      this.children.push(child);
    },
    remove() {
      delete _elements[_id];
    }
  };
  if (initId) _elements[initId] = el;
  return el;
}

globalThis.document = {
  getElementById(id) { return _elements[id] || null; },
  createElement(_tag) {
    // start with no id — the module code sets .id explicitly
    return _makeEl(null);
  }
};

// --- now import the modules under test ---

import {
  clearCheckpoints,
  getRegisteredCheckpoints
} from "../ar/interactions.js";

import {
  startFireModule,
  calcRaycastAimAccuracy,
  calcIntersectionDistance,
  calcDragDistance,
  isPinPullComplete,
  isAimHoldComplete,
  isAimInTargetZone,
  isSqueezeComplete,
  calcSweepCoverage,
  isSweepComplete,
  PIN_PULL_THRESHOLD_PX,
  AIM_HOLD_DURATION_MS,
  SQUEEZE_HOLD_DURATION_MS,
  SWEEP_MIN_COVERAGE,
  AIM_PASS_THRESHOLD,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID
} from "../modules/fire-response/fire-response.js";

// helper: collect safear:checkpoint events during a callback
function collectCheckpointEvents(fn) {
  const events = [];
  const handler = (ev) => events.push(ev.detail);
  window.addEventListener("safear:checkpoint", handler);
  fn();
  window.removeEventListener("safear:checkpoint", handler);
  return events;
}

// helper: click next button until action screen reached
function clickThroughSubscreens(maxSteps = 10) {
  let count = 0;
  while (_elements["btn-step-next"] && count < maxSteps) {
    const btn = _elements["btn-step-next"];
    delete _elements["btn-step-next"];
    btn.click();
    count++;
  }
}

// helper: advance through step 1 and set up for step 2 testing
function advanceToStep2() {
  startFireModule(document.getElementById("ar-viewport"));
  clickThroughSubscreens();
  _elements["btn-exit-found"]?.click();
  clickThroughSubscreens();
}

// helper: fire PASS extinguisher sequence with simulated accuracy score
function confirmAimWithScore(score) {
  clickThroughSubscreens();
  // P - Pull pin
  const pin = _elements["extinguisher-pin"];
  assert.ok(pin, "extinguisher-pin must exist in step 2 (P)");
  if (typeof pin.simulatePull === "function") {
    pin.simulatePull(60);
  } else {
    pin.click();
  }

  // A - Aim reticle
  const reticle = _elements["aim-reticle"];
  assert.ok(reticle, "aim-reticle must exist in step 2 (A)");
  const dist = typeof score === "number" && score > 0 ? (1 - score) * 0.8 : (score === 0 ? 0.9 : 0.1);
  if (typeof reticle.simulateAim === "function") {
    reticle.simulateAim(score, dist);
  } else {
    reticle.click();
  }

  // S - Squeeze handle
  const handle = _elements["extinguisher-handle"];
  assert.ok(handle, "extinguisher-handle must exist in step 2 (S)");
  if (typeof handle.simulateSqueeze === "function") {
    handle.simulateSqueeze(1500);
  } else {
    handle.click();
  }

  // S - Sweep nozzle
  const sweep = _elements["sweep-zone"];
  assert.ok(sweep, "sweep-zone must exist in step 2 (S)");
  if (typeof sweep.simulateSweep === "function") {
    sweep.simulateSweep([0, 100, 200, 240]);
  } else {
    sweep.click();
  }

  clickThroughSubscreens();
}

describe("Fire & Explosion Response module", () => {
  beforeEach(() => {
    clearCheckpoints();
    // reset element store for clean overlay state
    Object.keys(_elements).forEach((k) => delete _elements[k]);
    // create the ar-viewport container the module expects
    _makeEl("ar-viewport");
  });

  it("startFireModule registers step 1 (exit identification) checkpoint immediately", () => {
    startFireModule(document.getElementById("ar-viewport"));

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_EXIT_ID && c.type === "proximity"),
      "exit checkpoint must be registered on load");
    // step 2 and 3 must NOT be registered yet
    assert.ok(!cps.some((c) => c.id === CP_EXTINGUISHER_ID), "extinguisher CP must not register before step 1 passes");
    assert.ok(!cps.some((c) => c.id === CP_EVACUATION_ID), "evacuation CP must not register before step 2");
  });

  it("completing step 1 registers step 2 (extinguisher aim) checkpoint", () => {
    startFireModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();

    // simulate user clicking the exit button
    const btn = _elements["btn-exit-found"];
    assert.ok(btn, "exit button must exist after step 1 starts");
    btn.click();

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_EXTINGUISHER_ID && c.type === "aim"),
      "extinguisher checkpoint must register after step 1 passes");
    assert.ok(!cps.some((c) => c.id === CP_EVACUATION_ID), "evacuation CP must not register before step 2");
  });

  it("completing step 2 (high accuracy) registers step 3 (evacuation select) checkpoint", () => {
    advanceToStep2();
    // inject high accuracy score — passes threshold, proceeds to step 3
    confirmAimWithScore(0.9);

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_EVACUATION_ID && c.type === "select"),
      "evacuation checkpoint must register after step 2 completes");
  });

  it("step 1 fires safear:checkpoint event with correct shape (proximity, passed:true)", () => {
    startFireModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();

    const events = collectCheckpointEvents(() => {
      _elements["btn-exit-found"]?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_EXIT_ID);
    assert.strictEqual(events[0].type, "proximity");
    assert.strictEqual(events[0].passed, true);
    assert.deepStrictEqual(events[0].context, { method: "button_confirm" });
    assert.ok(typeof events[0].timestamp === "string");
  });

  // --- step 2 aim accuracy tests ---

  it("step 2: near-target tap (injected 0.9) fires passed:true, accuracy >= threshold, target:base", () => {
    advanceToStep2();

    const events = collectCheckpointEvents(() => confirmAimWithScore(0.9));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_EXTINGUISHER_ID);
    assert.strictEqual(events[0].type, "aim");
    assert.strictEqual(events[0].passed, true, "accuracy 0.9 >= 0.6 threshold must pass");
    assert.ok(events[0].context.accuracy >= AIM_PASS_THRESHOLD,
      `accuracy ${events[0].context.accuracy} must be >= threshold ${AIM_PASS_THRESHOLD}`);
    assert.strictEqual(events[0].context.target, "base");
  });

  it("step 2: far-off tap (injected 0.2) fires passed:false, accuracy below threshold, target:missed", () => {
    advanceToStep2();

    const events = collectCheckpointEvents(() => confirmAimWithScore(0.2));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_EXTINGUISHER_ID);
    assert.strictEqual(events[0].type, "aim");
    assert.strictEqual(events[0].passed, false, "accuracy 0.2 < 0.6 threshold must fail");
    assert.ok(events[0].context.accuracy < AIM_PASS_THRESHOLD,
      `accuracy ${events[0].context.accuracy} must be < threshold ${AIM_PASS_THRESHOLD}`);
    assert.strictEqual(events[0].context.target, "missed");
  });

  it("step 2: exact threshold (injected 0.6) fires passed:true (boundary inclusive)", () => {
    advanceToStep2();

    const events = collectCheckpointEvents(() => confirmAimWithScore(0.6));

    assert.strictEqual(events[0].passed, true, "score exactly at threshold must pass");
    assert.strictEqual(events[0].context.accuracy, 0.6);
  });

  it("step 2: zero accuracy score fires passed:false", () => {
    advanceToStep2();
    const events = collectCheckpointEvents(() => confirmAimWithScore(0));

    assert.strictEqual(events[0].passed, false);
    assert.strictEqual(events[0].context.accuracy, 0);
  });

  // --- PASS physical gesture pure function unit tests ---

  it("calcDragDistance: calculates 2d euclidean distance between points", () => {
    assert.strictEqual(calcDragDistance({ x: 0, y: 0 }, { x: 30, y: 40 }), 50);
    assert.strictEqual(calcDragDistance({ clientX: 10, clientY: 20 }, { clientX: 10, clientY: 70 }), 50);
    assert.strictEqual(calcDragDistance(null, { x: 10, y: 10 }), 0);
    assert.strictEqual(calcDragDistance({ x: 10, y: 10 }, null), 0);
  });

  it("isPinPullComplete: checks 50px drag distance threshold", () => {
    assert.strictEqual(isPinPullComplete(PIN_PULL_THRESHOLD_PX), true);
    assert.strictEqual(isPinPullComplete(60), true);
    assert.strictEqual(isPinPullComplete(49.9), false);
    assert.strictEqual(isPinPullComplete(0), false);
    assert.strictEqual(isPinPullComplete(null), false);
    assert.strictEqual(isPinPullComplete(NaN), false);
  });

  it("isAimHoldComplete: checks 800ms sustained aim hold duration", () => {
    assert.strictEqual(isAimHoldComplete(AIM_HOLD_DURATION_MS), true);
    assert.strictEqual(isAimHoldComplete(1000), true);
    assert.strictEqual(isAimHoldComplete(799), false);
    assert.strictEqual(isAimHoldComplete(0), false);
    assert.strictEqual(isAimHoldComplete(null), false);
  });

  it("isAimInTargetZone: checks target distance within maximum range", () => {
    assert.strictEqual(isAimInTargetZone(0), true);
    assert.strictEqual(isAimInTargetZone(0.4), true);
    assert.strictEqual(isAimInTargetZone(0.8), true);
    assert.strictEqual(isAimInTargetZone(0.81), false);
    assert.strictEqual(isAimInTargetZone(-0.1), false);
    assert.strictEqual(isAimInTargetZone(null), false);
  });

  it("isSqueezeComplete: checks 1500ms continuous squeeze hold duration", () => {
    assert.strictEqual(isSqueezeComplete(SQUEEZE_HOLD_DURATION_MS), true);
    assert.strictEqual(isSqueezeComplete(2000), true);
    assert.strictEqual(isSqueezeComplete(1499), false);
    assert.strictEqual(isSqueezeComplete(0), false);
  });

  it("calcSweepCoverage: calculates horizontal coverage span fraction", () => {
    assert.strictEqual(calcSweepCoverage([0, 120, 240], 240), 1.0);
    assert.strictEqual(calcSweepCoverage([20, 200], 240), 0.75);
    assert.strictEqual(calcSweepCoverage([50, 110], 240), 0.25);
    assert.strictEqual(calcSweepCoverage([], 240), 0);
    assert.strictEqual(calcSweepCoverage(null, 240), 0);
  });

  it("isSweepComplete: checks 75% sweep coverage threshold", () => {
    assert.strictEqual(isSweepComplete(SWEEP_MIN_COVERAGE), true);
    assert.strictEqual(isSweepComplete(0.9), true);
    assert.strictEqual(isSweepComplete(0.74), false);
    assert.strictEqual(isSweepComplete(0), false);
  });

  // --- 3D raycast aim accuracy pure function unit tests ---

  // --- 3D raycast aim accuracy pure function unit tests ---

  it("calcRaycastAimAccuracy: returns null for invalid / negative inputs", () => {
    assert.strictEqual(calcRaycastAimAccuracy(null), null);
    assert.strictEqual(calcRaycastAimAccuracy(undefined), null);
    assert.strictEqual(calcRaycastAimAccuracy(NaN), null);
    assert.strictEqual(calcRaycastAimAccuracy(-1), null);
  });

  it("calcRaycastAimAccuracy: exact hit (distance 0) returns 1.0", () => {
    const acc = calcRaycastAimAccuracy(0.0);
    assert.strictEqual(acc, 1.0, "zero distance must give accuracy 1.0");
  });

  it("calcRaycastAimAccuracy: near base hit (distance 0.2m) gives 0.75 accuracy (pass)", () => {
    const acc = calcRaycastAimAccuracy(0.2);
    // expected: 1 - 0.2 / 0.8 = 0.75
    assert.strictEqual(acc, 0.75);
    assert.ok(acc >= AIM_PASS_THRESHOLD, "0.75 >= 0.6 threshold must pass");
  });

  it("calcRaycastAimAccuracy: exact threshold hit (distance 0.32m) gives 0.6 accuracy (pass)", () => {
    const acc = calcRaycastAimAccuracy(0.32);
    // expected: 1 - 0.32 / 0.8 = 0.6
    assert.strictEqual(Math.round(acc * 100) / 100, 0.6);
    assert.ok(acc >= AIM_PASS_THRESHOLD);
  });

  it("calcRaycastAimAccuracy: high flame hit (distance 0.6m) gives 0.25 accuracy (fail)", () => {
    const acc = calcRaycastAimAccuracy(0.6);
    // expected: 1 - 0.6 / 0.8 = 0.25
    assert.strictEqual(Math.round(acc * 100) / 100, 0.25);
    assert.ok(acc < AIM_PASS_THRESHOLD, "0.25 < 0.6 threshold must fail");
  });

  it("calcRaycastAimAccuracy: out-of-bounds hit (> 0.8m) floors at 0.0", () => {
    const acc = calcRaycastAimAccuracy(1.5);
    assert.strictEqual(acc, 0.0);
  });

  it("calcIntersectionDistance: calculates 3D Euclidean distance correctly", () => {
    assert.strictEqual(calcIntersectionDistance(null), null);
    // target is (0, 0.3, 0)
    const exact = calcIntersectionDistance({ x: 0, y: 0.3, z: 0 });
    assert.strictEqual(exact, 0);

    const offset = calcIntersectionDistance({ x: 0.3, y: 0.7, z: 0.0 });
    // distance = Math.hypot(0.3, 0.4, 0) = 0.5
    assert.strictEqual(Math.round(offset * 100) / 100, 0.5);
  });

  it("completing step 2 after step 3 evacuation: correct option fires passed:true", () => {
    advanceToStep2();
    confirmAimWithScore(0.9);

    const correctBtn = document.getElementById("evacuation-opt-sound_alarm_then_evacuate");
    assert.ok(correctBtn, "correct evacuation button must exist");

    const events = collectCheckpointEvents(() => correctBtn.click());

    assert.strictEqual(events[0].checkpointId, CP_EVACUATION_ID);
    assert.strictEqual(events[0].type, "select");
    assert.strictEqual(events[0].passed, true);
    assert.strictEqual(events[0].context.selected, "sound_alarm_then_evacuate");
    assert.strictEqual(events[0].context.correct, "sound_alarm_then_evacuate");
  });

  it("step 3 wrong evacuation option fires passed:false", () => {
    advanceToStep2();
    confirmAimWithScore(0.9);

    const wrongBtn = document.getElementById("evacuation-opt-use_elevator");
    assert.ok(wrongBtn, "wrong evacuation button must exist");

    const events = collectCheckpointEvents(() => wrongBtn.click());

    assert.strictEqual(events[0].passed, false);
    assert.strictEqual(events[0].context.selected, "use_elevator");
  });

  it("completion screen exit button triggers unloadModule and cleans up overlay", () => {
    advanceToStep2();
    confirmAimWithScore(0.9);

    const correctBtn = document.getElementById("evacuation-opt-sound_alarm_then_evacuate");
    correctBtn.click();

    const exitBtn = document.getElementById("btn-module-exit");
    assert.ok(exitBtn, "exit button must exist on completion screen");

    // clicking exit button clears checkpoints and removes overlay
    exitBtn.click();
    assert.strictEqual(getRegisteredCheckpoints().length, 0, "checkpoints must be cleared on exit");
    assert.strictEqual(document.getElementById("fire-module-overlay"), null, "overlay must be removed on exit");
  });

  it("other module ids still throw not-implemented from loadModule3DScene", async () => {
    // import the actual stub to verify unimplemented modules still throw
    const { loadModule3DScene } = await import("../ar/webxr.js");
    await assert.rejects(
      () => loadModule3DScene("electrical-safety", null),
      /not implemented/
    );
  });

  it("other module ids still throw not-implemented from loadMarkerModuleScene", async () => {
    const { loadMarkerModuleScene } = await import("../ar/marker.js");
    await assert.rejects(
      () => loadMarkerModuleScene("electrical-safety", null),
      /not implemented/
    );
  });
});

