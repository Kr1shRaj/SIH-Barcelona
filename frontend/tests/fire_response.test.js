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

  it("completing step 2 registers step 3 (evacuation select) checkpoint", () => {
    startFireModule(document.getElementById("ar-viewport"));
    _elements["btn-exit-found"]?.click();
    _elements["btn-aim-correct"]?.click();

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_EVACUATION_ID && c.type === "select"),
      "evacuation checkpoint must register after step 2 passes");
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

  it("step 2 correct aim fires passed:true with accuracy and target in context", () => {
    startFireModule(document.getElementById("ar-viewport"));
    _elements["btn-exit-found"]?.click();

    const events = collectCheckpointEvents(() => {
      _elements["btn-aim-correct"]?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_EXTINGUISHER_ID);
    assert.strictEqual(events[0].type, "aim");
    assert.strictEqual(events[0].passed, true);
    assert.strictEqual(events[0].context.accuracy, 1.0);
    assert.strictEqual(events[0].context.target, "base");
  });

  it("step 2 wrong aim fires passed:false with accuracy:0 and target:flames", () => {
    startFireModule(document.getElementById("ar-viewport"));
    _elements["btn-exit-found"]?.click();

    const events = collectCheckpointEvents(() => {
      _elements["btn-aim-wrong"]?.click();
    });

    assert.strictEqual(events[0].passed, false);
    assert.strictEqual(events[0].context.accuracy, 0.0);
    assert.strictEqual(events[0].context.target, "flames");
  });

  it("step 3 correct evacuation option fires passed:true with selected and correct in context", () => {
    startFireModule(document.getElementById("ar-viewport"));
    _elements["btn-exit-found"]?.click();
    _elements["btn-aim-correct"]?.click();

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
    startFireModule(document.getElementById("ar-viewport"));
    _elements["btn-exit-found"]?.click();
    _elements["btn-aim-correct"]?.click();

    const wrongBtn = document.getElementById("evacuation-opt-use_elevator");
    assert.ok(wrongBtn, "wrong evacuation button must exist");

    const events = collectCheckpointEvents(() => wrongBtn.click());

    assert.strictEqual(events[0].passed, false);
    assert.strictEqual(events[0].context.selected, "use_elevator");
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
