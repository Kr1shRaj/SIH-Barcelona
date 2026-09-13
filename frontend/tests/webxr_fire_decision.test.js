import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// minimal browser dom stubs
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

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

const _elements = {};
// make mock dom element with listener and query support
function _makeEl(initId) {
  let _id = initId;
  const el = {
    get id() { return _id; },
    set id(newId) {
      if (_id && _elements[_id] === el) delete _elements[_id];
      _id = newId;
      if (newId) _elements[newId] = el;
    },
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML + (this.children || []).map((c) => c.innerHTML).join("");
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
      this.children = [];
    },
    style: { cssText: "" },
    dataset: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    get className() { return Array.from(this.classList._classes).join(" "); },
    set className(val) {
      this.classList._classes = new Set(String(val).trim().split(/\s+/).filter(Boolean));
    },
    children: [],
    _listeners: {},
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    click() { (this._listeners["click"] || []).forEach((fn) => fn()); },
    querySelector(sel) {
      if (sel.startsWith("#")) {
        return _elements[sel.slice(1)] || null;
      }
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        const find = (node) => {
          if (node.classList && node.classList.contains(cls)) return node;
          for (const ch of (node.children || [])) {
            const found = find(ch);
            if (found) return found;
          }
          return null;
        };
        return find(this);
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === ".wheel-btn") {
        return Object.values(_elements).filter((e) => e.classList && e.classList.contains("wheel-btn"));
      }
      return [];
    },
    appendChild(child) {
      if (child && child.id) _elements[child.id] = child;
      this.children.push(child);
      child.parentNode = this;
    },
    removeChild(child) {
      if (child && child.id) delete _elements[child.id];
      if (Array.isArray(this.children)) {
        this.children = this.children.filter((c) => c !== child);
      }
      if (child) child.parentNode = null;
      return child;
    },
    remove() {
      if (_id) delete _elements[_id];
      if (this.parentNode && Array.isArray(this.parentNode.children)) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      }
    }
  };
  if (initId) _elements[initId] = el;
  return el;
}

const _body = _makeEl("body");
globalThis.document = {
  body: _body,
  documentElement: _body,
  getElementById(id) { return _elements[id] || null; },
  createElement(_tag) { return _makeEl(null); },
  querySelector(sel) {
    if (sel.startsWith("#")) return _elements[sel.slice(1)] || null;
    return null;
  }
};

import {
  startFireModuleWebXR,
  cleanupWebXRFireModule,
  getMethaneReadingWebXR,
  getActiveBranchWebXR,
  dismissWebXRDiag,
  isDiagHudVisibleWebXR,
  CP_DECISION_ID,
  DECISION_CHOICES
} from "../modules/fire-response/webxr_fire_module.js";

describe("Tier 1 WebXR Fire Module: Phase 1 Decision Layer Port", () => {
  beforeEach(() => {
    Object.keys(_elements).forEach((k) => delete _elements[k]);
    Object.keys(_listeners).forEach((k) => delete _listeners[k]);
    cleanupWebXRFireModule();
  });

  it("initializes with generated methane reading when not supplied", () => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController);

    const reading = getMethaneReadingWebXR();
    assert.ok(typeof reading === "number");
    assert.ok(reading >= 0.5 && reading <= 9.5);
  });

  it("respects explicit reading option injected at start", () => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 7.4 });

    assert.strictEqual(getMethaneReadingWebXR(), 7.4);
  });

  it("advances through 3 subscreens then displays explosion alert and decision wheel", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 6.8 });

    const overlay = document.getElementById("fire-module-overlay");
    assert.ok(overlay, "Overlay must be created");

    // subscreen 1
    let nextBtn = overlay.querySelector("#btn-step-next");
    assert.ok(nextBtn, "Next button for subscreen 1 must exist");
    nextBtn.click();

    // subscreen 2
    nextBtn = overlay.querySelector("#btn-step-next");
    assert.ok(nextBtn, "Next button for subscreen 2 must exist");
    nextBtn.click();

    // subscreen 3
    nextBtn = overlay.querySelector("#btn-step-next");
    assert.ok(nextBtn, "Next button for subscreen 3 must exist");
    nextBtn.click();

    // alert overlay is shown
    const alertOverlay = document.getElementById("fire-alert-overlay");
    assert.ok(alertOverlay, "Alert flash overlay must appear after subscreens");

    // dismiss alert overlay to trigger decision wheel
    alertOverlay.click();

    setTimeout(() => {
      const decisionPanel = document.getElementById("fire-decision-panel");
      assert.ok(decisionPanel, "Decision panel must be rendered after alert");
      assert.ok(decisionPanel.innerHTML.includes("6.8% CH₄"));

      const btnEvac = document.getElementById("btn-decision-evacuate");
      const btnExt = document.getElementById("btn-decision-extinguish");
      const btnWait = document.getElementById("btn-decision-wait");
      assert.ok(btnEvac && btnExt && btnWait, "Three decision buttons must be present");
      done();
    }, 300);
  });

  it("fires fire_explosion_decision checkpoint matching Tier 2 shape", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 3.4 });

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    const overlay = document.getElementById("fire-module-overlay");
    // advance all 3 subscreens
    for (let i = 0; i < 3; i++) {
      const nextBtn = overlay.querySelector("#btn-step-next");
      nextBtn.click();
    }

    const alertOverlay = document.getElementById("fire-alert-overlay");
    alertOverlay.click();

    setTimeout(() => {
      // 3.4% < 5.0%, so EXTINGUISH is correct
      const btnExt = document.getElementById("btn-decision-extinguish");
      btnExt.click();

      const cp = checkpointsFired.find((c) => c.checkpointId === CP_DECISION_ID);
      assert.ok(cp, "fire_explosion_decision checkpoint must fire");
      assert.strictEqual(cp.passed, true);
      assert.strictEqual(cp.context.choice, DECISION_CHOICES.EXTINGUISH);
      assert.strictEqual(cp.context.reading, 3.4);
      assert.strictEqual(cp.type, "select");
      assert.strictEqual(cp.observation.kind, "selection_single");
      assert.strictEqual(cp.observation.selected, DECISION_CHOICES.EXTINGUISH);

      assert.strictEqual(getActiveBranchWebXR(), "suppress");
      done();
    }, 300);
  });

  it("wrong choice blocks progress and displays retry explanation", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 7.2 });

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    const overlay = document.getElementById("fire-module-overlay");
    for (let i = 0; i < 3; i++) {
      overlay.querySelector("#btn-step-next").click();
    }

    document.getElementById("fire-alert-overlay").click();

    setTimeout(() => {
      // 7.2% >= 5.0%, so EXTINGUISH is wrong
      const btnExt = document.getElementById("btn-decision-extinguish");
      btnExt.click();

      const cp = checkpointsFired.find((c) => c.checkpointId === CP_DECISION_ID);
      assert.ok(cp, "fire_explosion_decision checkpoint must fire on wrong attempt");
      assert.strictEqual(cp.passed, false);

      const feedback = document.getElementById("decision-feedback-slot");
      assert.ok(feedback.innerHTML.includes("INCORRECT SAFETY ACTION"));
      assert.ok(feedback.innerHTML.includes("btn-decision-retry"));

      const retryBtn = document.getElementById("btn-decision-retry");
      assert.ok(retryBtn);
      retryBtn.click();

      // now click correct choice (EVACUATE)
      const btnEvac = document.getElementById("btn-decision-evacuate");
      btnEvac.click();

      const cpPass = checkpointsFired.filter((c) => c.checkpointId === CP_DECISION_ID && c.passed === true);
      assert.strictEqual(cpPass.length, 1);
      assert.strictEqual(getActiveBranchWebXR(), "evacuate");
      done();
    }, 300);
  });

  it("diagnostic HUD is present during gas meter, but automatically dismissed when proceeding to next step", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 2.8 });

    const overlay = document.getElementById("fire-module-overlay");
    for (let i = 0; i < 3; i++) {
      overlay.querySelector("#btn-step-next").click();
    }
    document.getElementById("fire-alert-overlay").click();

    setTimeout(() => {
      // confirm diagnostic HUD is present during gas meter step
      const hudEl = document.getElementById("webxr-diag-hud");
      assert.ok(hudEl, "Diagnostic HUD must be present during gas meter / decision phase");
      assert.strictEqual(isDiagHudVisibleWebXR(), true);

      // click correct extinguish choice
      const btnExt = document.getElementById("btn-decision-extinguish");
      assert.ok(btnExt);
      btnExt.click();

      // proceed to placement
      const btnProceed = document.getElementById("btn-decision-proceed");
      assert.ok(btnProceed, "Proceed button must mount in feedback slot");
      btnProceed.click();

      // after gas meter, diagnostic HUD must be completely removed from DOM
      assert.strictEqual(document.getElementById("webxr-diag-hud"), null, "Diagnostic HUD must be removed after gas meter");
      assert.strictEqual(isDiagHudVisibleWebXR(), false, "isDiagHudVisibleWebXR must report false");
      done();
    }, 300);
  });

  it("diagnostic HUD close button [✕] dismisses HUD immediately", () => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 4.1 });

    const hudEl = document.getElementById("webxr-diag-hud");
    assert.ok(hudEl, "Diagnostic HUD mounted on module start");
    const closeBtn = document.getElementById("btn-close-webxr-diag");
    assert.ok(closeBtn, "Close button [✕] must exist on diagnostic HUD");

    closeBtn.click();
    assert.strictEqual(document.getElementById("webxr-diag-hud"), null, "Diagnostic HUD removed after close click");
    assert.strictEqual(isDiagHudVisibleWebXR(), false);
  });

  it("dismissWebXRDiag prevents normal state updates from recreating HUD", () => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 3.5 });

    dismissWebXRDiag();
    assert.strictEqual(isDiagHudVisibleWebXR(), false);

    // subscreen advancement or other state calls must NOT recreate it
    const overlay = document.getElementById("fire-module-overlay");
    overlay.querySelector("#btn-step-next").click();
    assert.strictEqual(document.getElementById("webxr-diag-hud"), null, "HUD must not reappear on subsequent state changes");
  });

  it("mid-session rotation (resize / orientationchange) preserves decision panel, gauge, and state", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 6.2 });

    const overlay = document.getElementById("fire-module-overlay");
    for (let i = 0; i < 3; i++) {
      overlay.querySelector("#btn-step-next").click();
    }
    document.getElementById("fire-alert-overlay").click();

    setTimeout(() => {
      const panel = document.getElementById("fire-decision-panel");
      assert.ok(panel, "Decision panel present before rotation");

      // simulate device orientation change to landscape then portrait
      window.dispatchEvent(new CustomEvent("resize"));
      window.dispatchEvent(new CustomEvent("orientationchange"));

      // panel and options remain intact and functional without resetting
      assert.strictEqual(document.getElementById("fire-decision-panel"), panel);
      assert.strictEqual(getMethaneReadingWebXR(), 6.2);

      const btnEvac = document.getElementById("btn-decision-evacuate");
      assert.ok(btnEvac);
      btnEvac.click();
      assert.strictEqual(getActiveBranchWebXR(), "evacuate");
      done();
    }, 300);
  });
});
