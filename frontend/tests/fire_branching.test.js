import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// minimal browser stubs for test harness
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
  },
  requestAnimationFrame(fn) { return globalThis.setTimeout(fn, 16); },
  cancelAnimationFrame(id) { globalThis.clearTimeout(id); }
};

const _elements = {};

function _makeEl(initId) {
  let _id = initId;
  const classes = new Set();
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
    classList: {
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      contains(cls) { return classes.has(cls); }
    },
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    setAttribute(name, val) {
      this[name] = val;
    },
    removeAttribute(name) {
      delete this[name];
    },
    click() { (this._listeners["click"] || []).forEach((fn) => fn()); },
    querySelector(sel) {
      const m = sel.match(/^#(.+)$/);
      if (m) return _elements[m[1]] || null;
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      const parts = sel.split(",").map((s) => s.trim());
      parts.forEach((p) => {
        const m = p.match(/^#(.+)$/);
        if (m && _elements[m[1]]) results.push(_elements[m[1]]);
      });
      return results;
    },
    appendChild(child) {
      if (child && child.id) _elements[child.id] = child;
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      if (child && child.id) delete _elements[child.id];
      return child;
    },
    insertBefore(child, _ref) {
      return this.appendChild(child);
    },
    remove() {
      delete _elements[_id];
      if (this.parentNode && this.parentNode.children) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      }
    }
  };
  if (initId) _elements[initId] = el;
  return el;
}

globalThis.document = {
  getElementById(id) { return _elements[id] || null; },
  createElement(_tag) { return _makeEl(null); },
  querySelector(sel) {
    const m = sel.match(/^#(.+)$/);
    return m ? (_elements[m[1]] || null) : null;
  },
  querySelectorAll(sel) {
    const results = [];
    const parts = sel.split(",").map((s) => s.trim());
    parts.forEach((p) => {
      const m = p.match(/^#(.+)$/);
      if (m && _elements[m[1]]) results.push(_elements[m[1]]);
    });
    return results;
  }
};

import {
  clearCheckpoints
} from "../ar/interactions.js";

import {
  startFireModule,
  cleanupFireModule,
  getCurrentStep,
  getMethaneReading,
  setMethaneReading,
  getActiveBranch,
  getAlarmPulled,
  getDecisionMade,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID,
  CP_DECISION_ID,
  DECISION_CHOICES
} from "../modules/fire-response/fire-response.js";

// helper: collect safear:checkpoint events during callback
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

describe("Fire Response Branching Scenario Drill", () => {
  beforeEach(() => {
    Object.keys(_elements).forEach((k) => delete _elements[k]);
    Object.keys(_listeners).forEach((k) => delete _listeners[k]);
    clearCheckpoints();
    cleanupFireModule();
  });

  it("initializes module with specified reading and renders decision wheel", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 6.8 });

    assert.strictEqual(getMethaneReading(), 6.8, "reading must equal option reading");
    assert.strictEqual(getCurrentStep(), 1, "step must be 1 on start");
    assert.strictEqual(getActiveBranch(), null, "initial branch must be null");

    // check decision wheel elements
    assert.ok(_elements["fire-decision-panel"], "fire-decision-panel must exist");
    assert.ok(_elements["btn-decision-evacuate"], "evacuate button must exist");
    assert.ok(_elements["btn-decision-extinguish"], "extinguish button must exist");
    assert.ok(_elements["btn-decision-wait"], "wait button must exist");

    setMethaneReading(5.5);
    assert.strictEqual(getMethaneReading(), 5.5, "setMethaneReading updates reading");
  });

  it("Branch A: allows immediate evacuation on high methane (CH4 >= 5.0%) and completes drill", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 7.2 });

    const events = collectCheckpointEvents(() => {
      // 1. Trainee evaluates monitor and chooses to evacuate
      const btnEvac = _elements["btn-decision-evacuate"];
      assert.ok(btnEvac, "evacuate button must exist");
      btnEvac.click();
    });

    assert.strictEqual(getActiveBranch(), "evacuate", "active branch must be evacuate");
    assert.strictEqual(getDecisionMade(), DECISION_CHOICES.EVACUATE, "decision made recorded");

    // verify CP_DECISION_ID fired
    const decisionEv = events.find((e) => e.checkpointId === CP_DECISION_ID);
    assert.ok(decisionEv, "decision checkpoint event must be emitted");
    assert.strictEqual(decisionEv.passed, true, "evacuate at 7.2% must be correct");
    assert.strictEqual(decisionEv.context.choice, DECISION_CHOICES.EVACUATE);

    // 2. Emergency exit confirmation button should appear
    const btnExit = _elements["btn-exit-found"];
    assert.ok(btnExit, "exit confirmation button must appear in Branch A");

    const completeEvents = collectCheckpointEvents(() => {
      btnExit.click();
    });

    // verify CP_EXIT_ID and CP_EVACUATION_ID were fired
    assert.ok(completeEvents.some((e) => e.checkpointId === CP_EXIT_ID), "exit cp must fire");
    assert.ok(completeEvents.some((e) => e.checkpointId === CP_EVACUATION_ID), "evacuation cp must fire");

    // debrief summary card must be present
    assert.ok(_elements["debrief-summary-card"], "debrief card must be rendered");
  });

  it("Wrong Choice: premature evacuation on low methane (CH4 < 5.0%) is rejected in favor of suppression", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 1.8 });

    const events = collectCheckpointEvents(() => {
      _elements["btn-decision-evacuate"]?.click();
    });

    assert.notStrictEqual(getActiveBranch(), "evacuate", "cannot activate evacuate on low methane");
    const decisionEv = events.find((e) => e.checkpointId === CP_DECISION_ID);
    assert.strictEqual(decisionEv.passed, false, "evacuating on low methane is incorrect per protocol");
    assert.ok(_elements["btn-decision-retry"], "retry button must be displayed");
  });

  it("Wrong Choice: blocks suppression drill when methane is explosive (CH4 >= 5.0%)", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 8.4 });

    const events = collectCheckpointEvents(() => {
      _elements["btn-decision-extinguish"]?.click();
    });

    // should NOT set branch to suppress
    assert.notStrictEqual(getActiveBranch(), "suppress", "must NOT activate suppress branch on 8.4%");

    // decision checkpoint should be recorded as failed
    const decisionEv = events.find((e) => e.checkpointId === CP_DECISION_ID);
    assert.ok(decisionEv, "decision event must fire");
    assert.strictEqual(decisionEv.passed, false, "attempting fire suppression at 8.4% must fail");

    // retry button must appear
    const retryBtn = _elements["btn-decision-retry"];
    assert.ok(retryBtn, "retry button must be displayed");
    retryBtn.click();

    // trainee now picks evacuate
    _elements["btn-decision-evacuate"]?.click();
    assert.strictEqual(getActiveBranch(), "evacuate");
  });

  it("Wrong Choice: waiting is never an acceptable protocol", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 2.5 });

    const events = collectCheckpointEvents(() => {
      _elements["btn-decision-wait"]?.click();
    });

    assert.strictEqual(getActiveBranch(), null, "waiting does not select branch");
    const decisionEv = events.find((e) => e.checkpointId === CP_DECISION_ID);
    assert.strictEqual(decisionEv.passed, false, "waiting must fail");
    assert.ok(_elements["btn-decision-retry"], "retry button must exist");
  });

  it("Branch B: requires pull alarm first, then PASS drill and post-extinguish evacuation", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 2.2 });

    // 1. Choose suppression drill (valid since 2.2% < 5.0%)
    const decisionEvents = collectCheckpointEvents(() => {
      _elements["btn-decision-extinguish"]?.click();
    });

    assert.strictEqual(getActiveBranch(), "suppress", "suppress branch activated");
    const decEv = decisionEvents.find((e) => e.checkpointId === CP_DECISION_ID);
    assert.strictEqual(decEv.passed, true, "extinguish decision is valid for 2.2%");

    // 2. Alarm pull station should be rendered first
    assert.strictEqual(getAlarmPulled(), false, "alarm not yet pulled");
    const btnAlarm = _elements["btn-pull-alarm"];
    assert.ok(btnAlarm, "btn-pull-alarm must exist in Branch B");

    // 3. Pull alarm station
    const alarmEvents = collectCheckpointEvents(() => {
      btnAlarm.click();
    });

    assert.strictEqual(getAlarmPulled(), true, "alarm must be pulled");
    assert.ok(alarmEvents.some((e) => e.checkpointId === CP_EXIT_ID), "exit/alarm cp must fire on pull");

    // 4. Extinguisher PASS step 2: Pull pin
    const pin = _elements["extinguisher-pin"];
    assert.ok(pin, "pin must exist");
    if (pin.simulateSelect) pin.simulateSelect();
    if (pin.simulatePull) pin.simulatePull(60);
    else pin.click();

    // Aim step: Aim at base
    const reticle = _elements["aim-reticle"];
    assert.ok(reticle, "aim-reticle must exist");
    if (reticle.simulateAim) reticle.simulateAim(0.9, 0.1);
    else reticle.click();

    // Squeeze step
    const handle = _elements["extinguisher-handle"];
    if (handle?.simulateSelect) handle.simulateSelect();
    if (handle?.simulateSqueeze) handle.simulateSqueeze(1500);
    else if (_elements["squeeze-status-badge"]) _elements["squeeze-status-badge"].click();

    // Sweep step
    const sweep = _elements["sweep-zone"];
    assert.ok(sweep, "sweep-zone must exist");
    const passEvents = collectCheckpointEvents(() => {
      if (sweep.simulateSweep) sweep.simulateSweep([0, 100, 200, 240]);
      else sweep.click();
    });

    assert.ok(passEvents.some((e) => e.checkpointId === CP_EXTINGUISHER_ID), "PASS extinguisher CP must fire");

    // 5. Mandatory post-extinguish evacuation in Step 3
    clickThroughSubscreens();
    const btnEvac = _elements["evacuation-opt-sound_alarm_then_evacuate"];
    assert.ok(btnEvac, "evacuation option button must exist");

    const finalEvents = collectCheckpointEvents(() => {
      btnEvac.click();
    });

    assert.ok(finalEvents.some((e) => e.checkpointId === CP_EVACUATION_ID), "evacuation CP must fire");

    // 6. Debrief summary card verification
    const debrief = _elements["debrief-summary-card"];
    assert.ok(debrief, "debrief card must be present");
    assert.ok(debrief.innerHTML.includes("2.2% CH₄"), "debrief must include 2.2% CH4 reading");
    assert.ok(debrief.innerHTML.includes("Branch B"), "debrief must indicate Branch B");
  });

  it("cleanupFireModule resets branch state and clears all overlay elements", () => {
    const container = _makeEl("ar-viewport");
    startFireModule(container, null, { reading: 3.1 });

    _elements["btn-decision-extinguish"]?.click();
    assert.strictEqual(getActiveBranch(), "suppress");

    cleanupFireModule();

    assert.strictEqual(getActiveBranch(), null, "active branch must reset to null on cleanup");
    assert.strictEqual(getAlarmPulled(), false, "alarm state must reset to false");
    assert.strictEqual(getCurrentStep(), 0, "current step must reset to 0");
    assert.strictEqual(_elements["fire-decision-panel"], undefined, "panel removed from DOM registry");
  });
});
