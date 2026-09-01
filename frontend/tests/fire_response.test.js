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
  calcAimAccuracy,
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

// helper: advance through step 1 and set up for step 2 testing
function advanceToStep2() {
  startFireModule(document.getElementById("ar-viewport"));
  _elements["btn-exit-found"]?.click();
}

// helper: fire aim confirm with injected accuracy score (bypasses missing getBoundingClientRect)
function confirmAimWithScore(score) {
  const btn = _elements["btn-aim-confirm"];
  assert.ok(btn, "btn-aim-confirm must exist after step 2 starts");
  btn._testAccuracy = score;
  btn.click();
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

  it("step 2: no tap before confirm (accuracy 0) fires passed:false", () => {
    advanceToStep2();
    // no _testAccuracy set — falls back to 0
    const events = collectCheckpointEvents(() => {
      const btn = _elements["btn-aim-confirm"];
      assert.ok(btn, "btn-aim-confirm must exist");
      btn.click();  // no _testAccuracy set, score defaults to 0
    });

    assert.strictEqual(events[0].passed, false);
    assert.strictEqual(events[0].context.accuracy, 0);
  });

  // --- calcAimAccuracy unit tests (pure function, given a mock getBoundingClientRect) ---

  it("calcAimAccuracy: returns null when graphicEl has no getBoundingClientRect", () => {
    const fakeEl = { id: "test" };  // plain object, no getBoundingClientRect
    assert.strictEqual(calcAimAccuracy(0, 0, fakeEl), null);
    assert.strictEqual(calcAimAccuracy(0, 0, null), null);
  });

  it("calcAimAccuracy: tap exactly on base (bottom-center) returns 1.0", () => {
    const mockEl = {
      getBoundingClientRect() {
        return { left: 100, width: 60, bottom: 200, top: 100, right: 160 };
      }
    };
    // base = bottom-center = (130, 200)
    const acc = calcAimAccuracy(130, 200, mockEl);
    assert.strictEqual(acc, 1.0, "zero distance must give accuracy 1.0");
  });

  it("calcAimAccuracy: tap > max radius away returns 0.0 (floor)", () => {
    const mockEl = {
      getBoundingClientRect() {
        return { left: 100, width: 60, bottom: 200, top: 100, right: 160 };
      }
    };
    // tap 500px away — way beyond max radius, must floor at 0.0
    const acc = calcAimAccuracy(630, 200, mockEl);
    assert.strictEqual(acc, 0.0, "tap beyond max radius must give accuracy 0.0");
  });

  it("calcAimAccuracy: tap half the max radius away gives ~0.5 accuracy", () => {
    const mockEl = {
      getBoundingClientRect() {
        return { left: 100, width: 60, bottom: 200, top: 100, right: 160 };
      }
    };
    // base = (130, 200), max radius = 80px; tap 40px right = half max radius
    const acc = calcAimAccuracy(170, 200, mockEl);
    // expected: 1 - 40/80 = 0.5
    assert.ok(Math.abs(acc - 0.5) < 0.01, `expected ~0.5 accuracy, got ${acc}`);
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
    // import the actual stub to verify non-fire-response modules still throw
    const { loadModule3DScene } = await import("../ar/webxr.js");
    await assert.rejects(
      () => loadModule3DScene("gas-leak", null),
      /not implemented/
    );
  });

  it("other module ids still throw not-implemented from loadMarkerModuleScene", async () => {
    const { loadMarkerModuleScene } = await import("../ar/marker.js");
    await assert.rejects(
      () => loadMarkerModuleScene("gas-leak", null),
      /not implemented/
    );
  });
});

