import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// event bus for custom events
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

// minimal document stub for overlay and buttons
const _elements = {};

function _makeEl(initId) {
  let _id = initId;
  const el = {
    get id() { return _id; },
    set id(newId) {
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
    return _makeEl(null);
  },
  querySelector(sel) {
    const m = sel.match(/^#(.+)$/);
    return m ? (_elements[m[1]] || null) : null;
  }
};

import {
  clearCheckpoints,
  getRegisteredCheckpoints
} from "../ar/interactions.js";

import {
  startGasLeakModule,
  evaluatePpeSelection,
  evaluateBuddyProcedure,
  CP_HAZARD_ZONE_ID,
  CP_PPE_SELECTION_ID,
  CP_BUDDY_PROCEDURE_ID,
  MANDATORY_PPE,
  CORRECT_BUDDY_PROCEDURE
} from "../modules/gas-leak/gas-leak.js";

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

// helper: collect safear:checkpoint events during execution
function collectCheckpointEvents(fn) {
  const events = [];
  const handler = (ev) => events.push(ev.detail);
  window.addEventListener("safear:checkpoint", handler);
  fn();
  window.removeEventListener("safear:checkpoint", handler);
  return events;
}

describe("Gas Leak & Confined Space Protocol module", () => {
  beforeEach(() => {
    clearCheckpoints();
    Object.keys(_elements).forEach((k) => delete _elements[k]);
    _makeEl("ar-viewport");
  });

  // --- Pure scoring function unit tests ---

  it("evaluatePpeSelection: empty or invalid list fails with full missing list", () => {
    const r1 = evaluatePpeSelection([]);
    assert.strictEqual(r1.passed, false);
    assert.strictEqual(r1.score, 0);
    assert.deepStrictEqual(r1.missing, MANDATORY_PPE);

    const r2 = evaluatePpeSelection(null);
    assert.strictEqual(r2.passed, false);
    assert.strictEqual(r2.score, 0);
  });

  it("evaluatePpeSelection: all mandatory items chosen without forbidden items passes with score 1.0", () => {
    const selected = ["scba_respirator", "multi_gas_detector", "safety_harness"];
    const r = evaluatePpeSelection(selected);
    assert.strictEqual(r.passed, true);
    assert.strictEqual(r.score, 1.0);
    assert.strictEqual(r.missing.length, 0);
    assert.strictEqual(r.forbidden.length, 0);
  });

  it("evaluatePpeSelection: missing mandatory item fails", () => {
    const selected = ["scba_respirator", "multi_gas_detector"];
    const r = evaluatePpeSelection(selected);
    assert.strictEqual(r.passed, false);
    assert.deepStrictEqual(r.missing, ["safety_harness"]);
    assert.strictEqual(r.score, 0.67);
  });

  it("evaluatePpeSelection: choosing forbidden dust mask fails even if required items present", () => {
    const selected = ["scba_respirator", "multi_gas_detector", "safety_harness", "dust_mask"];
    const r = evaluatePpeSelection(selected);
    assert.strictEqual(r.passed, false);
    assert.deepStrictEqual(r.forbidden, ["dust_mask"]);
  });

  it("evaluateBuddyProcedure: correct procedure passes", () => {
    assert.strictEqual(evaluateBuddyProcedure("standby_outside_with_lifeline"), true);
    assert.strictEqual(evaluateBuddyProcedure("both_enter_together"), false);
    assert.strictEqual(evaluateBuddyProcedure("buddy_leaves_for_tools"), false);
    assert.strictEqual(evaluateBuddyProcedure("enter_without_communication"), false);
    assert.strictEqual(evaluateBuddyProcedure(""), false);
  });

  // --- Checkpoint flow & interaction tests ---

  it("startGasLeakModule registers step 1 (hazard zone recognition) checkpoint immediately", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_HAZARD_ZONE_ID && c.type === "proximity"),
      "hazard zone checkpoint must be registered on start");
    assert.ok(!cps.some((c) => c.id === CP_PPE_SELECTION_ID), "ppe checkpoint must not register before step 1");
    assert.ok(!cps.some((c) => c.id === CP_BUDDY_PROCEDURE_ID), "buddy checkpoint must not register before step 2");
  });

  it("completing step 1 fires proximity event and registers step 2", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();

    const events = collectCheckpointEvents(() => {
      _elements["btn-hazard-found"]?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_HAZARD_ZONE_ID);
    assert.strictEqual(events[0].type, "proximity");
    assert.strictEqual(events[0].passed, true);
    assert.deepStrictEqual(events[0].context, { method: "button_confirm" });

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_PPE_SELECTION_ID && c.type === "select"),
      "ppe checkpoint must register after step 1");
  });

  it("step 2 correct PPE selection fires passed:true and registers step 3", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();
    clickThroughSubscreens();

    // toggle required PPE items
    _elements["ppe-opt-scba_respirator"]?.click();
    _elements["ppe-opt-multi_gas_detector"]?.click();
    _elements["ppe-opt-safety_harness"]?.click();

    const events = collectCheckpointEvents(() => {
      _elements["btn-confirm-ppe"]?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_PPE_SELECTION_ID);
    assert.strictEqual(events[0].type, "select");
    assert.strictEqual(events[0].passed, true);
    assert.strictEqual(events[0].context.score, 1.0);
    assert.strictEqual(events[0].context.missing.length, 0);

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_BUDDY_PROCEDURE_ID && c.type === "select"),
      "buddy procedure checkpoint must register after step 2");
  });

  it("step 2 wrong PPE selection fires passed:false and advances to step 3", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();
    clickThroughSubscreens();

    // select dust mask only
    _elements["ppe-opt-dust_mask"]?.click();

    const events = collectCheckpointEvents(() => {
      _elements["btn-confirm-ppe"]?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_PPE_SELECTION_ID);
    assert.strictEqual(events[0].passed, false);
    assert.ok(events[0].context.forbidden.includes("dust_mask"));

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_BUDDY_PROCEDURE_ID),
      "should still advance to step 3 on fail");
  });

  it("step 3 correct buddy role fires passed:true and renders completion exit button", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();
    clickThroughSubscreens();
    _elements["ppe-opt-scba_respirator"]?.click();
    _elements["ppe-opt-multi_gas_detector"]?.click();
    _elements["ppe-opt-safety_harness"]?.click();
    _elements["btn-confirm-ppe"]?.click();
    clickThroughSubscreens();

    const events = collectCheckpointEvents(() => {
      _elements[`buddy-opt-${CORRECT_BUDDY_PROCEDURE}`]?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_BUDDY_PROCEDURE_ID);
    assert.strictEqual(events[0].type, "select");
    assert.strictEqual(events[0].passed, true);
    assert.strictEqual(events[0].context.selected, CORRECT_BUDDY_PROCEDURE);

    const exitBtn = _elements["btn-module-exit"];
    assert.ok(exitBtn, "exit button must be present on completion screen");

    // clicking exit cleans up overlay and resets checkpoints
    exitBtn.click();
    assert.strictEqual(getRegisteredCheckpoints().length, 0);
    assert.strictEqual(document.getElementById("gas-module-overlay"), null);
  });

  it("step 3 wrong buddy option fires passed:false", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();
    clickThroughSubscreens();
    _elements["btn-confirm-ppe"]?.click();
    clickThroughSubscreens();

    const events = collectCheckpointEvents(() => {
      _elements["buddy-opt-both_enter_together"]?.click();
    });

    assert.strictEqual(events[0].checkpointId, CP_BUDDY_PROCEDURE_ID);
    assert.strictEqual(events[0].passed, false);
    assert.strictEqual(events[0].context.selected, "both_enter_together");
  });

  it("loadModule3DScene and loadMarkerModuleScene execute for gas-leak", async () => {
    const { loadModule3DScene } = await import("../ar/webxr.js");
    const { loadMarkerModuleScene } = await import("../ar/marker.js");

    await assert.doesNotReject(() => loadModule3DScene("gas-leak", null));
    await assert.doesNotReject(() => loadMarkerModuleScene("gas-leak", null));
  });
});
