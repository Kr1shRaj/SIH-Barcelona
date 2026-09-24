import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// minimal browser stubs for test environment
const _listeners = {};
globalThis.window = {
  innerWidth: 400,
  innerHeight: 800,
  matchMedia(q) {
    const isPortrait = this.innerHeight > this.innerWidth;
    return {
      matches: q.includes("portrait") ? isPortrait : !isPortrait,
      addEventListener: (type, fn) => this.addEventListener(type, fn),
      removeEventListener: (type, fn) => this.removeEventListener(type, fn)
    };
  },
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
    _textContent: "",
    get textContent() {
      return this._textContent || this._innerHTML;
    },
    set textContent(val) {
      this._textContent = String(val);
      this._innerHTML = String(val);
    },
    get innerHTML() {
      return this._innerHTML + (this.children || []).map((c) => c.innerHTML).join("");
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
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
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
    },
    setAttribute(k, v) { this[k] = v; },
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

globalThis.document = {
  getElementById(id) { return _elements[id] || null; },
  createElement(_tag) { return _makeEl(null); }
};

import {
  methaneReadingForRun,
  isCorrectDecision,
  decisionSeverity,
  getDecisionExplanation,
  renderGasGaugeSvg,
  renderAlertFlash,
  renderDecisionWheel,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_WITHDRAWAL_THRESHOLD,
  initOrientationNudge
} from "../modules/fire-response/decision.js";
import { scenarioFor } from "../modules/fire-response/scenario.js";
import { startAssessmentSession, abortAssessmentSession } from "../assessment/engine.js";

describe("Fire & Explosion Scenario: Methane Reading & Decision Logic (Phase 1)", () => {
  beforeEach(() => {
    Object.keys(_elements).forEach((k) => delete _elements[k]);
  });

  describe("methaneReadingForRun", () => {
    it("rolls the reading from the active session attemptId, the same one the server rolls", () => {
      const attemptId = "5d2c9a10-7e41-4b8f-9a3c-12ab34cd56ef";
      startAssessmentSession({ moduleId: "fire-response", attemptId });
      try {
        assert.strictEqual(methaneReadingForRun(), scenarioFor(attemptId).reading);
        assert.strictEqual(methaneReadingForRun(), methaneReadingForRun(), "same run, same reading");
      } finally {
        abortAssessmentSession();
      }
    });

    it("lets a test pin the reading", () => {
      assert.strictEqual(methaneReadingForRun({ reading: 0.7 }), 0.7);
    });

    it("throws instead of inventing a reading when no run is active", () => {
      abortAssessmentSession();
      assert.throws(() => methaneReadingForRun(), /uuid attemptId/);
    });
  });

  describe("isCorrectDecision boundary and choice verification", () => {
    it("withdrawal limit is 1.25% CH4", () => {
      assert.strictEqual(METHANE_WITHDRAWAL_THRESHOLD, 1.25);
    });

    it("at exactly 1.25% (withdrawal limit), evacuate is correct and others fail", () => {
      assert.strictEqual(isCorrectDecision(1.25, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(1.25, DECISION_CHOICES.EXTINGUISH), false);
      assert.strictEqual(isCorrectDecision(1.25, DECISION_CHOICES.WAIT), false);
    });

    it("above 1.25% (e.g. 1.3%, 2.8%), evacuate is correct and others fail", () => {
      assert.strictEqual(isCorrectDecision(1.26, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(1.3, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(2.8, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(7.5, DECISION_CHOICES.EVACUATE), true);

      assert.strictEqual(isCorrectDecision(1.3, DECISION_CHOICES.EXTINGUISH), false);
      assert.strictEqual(isCorrectDecision(1.3, DECISION_CHOICES.WAIT), false);
    });

    it("below 1.25% (e.g. 1.2%, 0.5%), extinguish is correct and others fail", () => {
      assert.strictEqual(isCorrectDecision(1.24, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(1.2, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(0.5, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(0.0, DECISION_CHOICES.EXTINGUISH), true);

      assert.strictEqual(isCorrectDecision(1.2, DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision(1.2, DECISION_CHOICES.WAIT), false);
    });

    it("'wait' is always wrong regardless of reading value", () => {
      assert.strictEqual(isCorrectDecision(0.4, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(1.24, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(1.25, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(2.8, DECISION_CHOICES.WAIT), false);
    });

    it("rejects invalid, NaN, or non-numeric readings", () => {
      assert.strictEqual(isCorrectDecision(NaN, DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision(null, DECISION_CHOICES.EXTINGUISH), false);
      assert.strictEqual(isCorrectDecision(undefined, DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision("1.5", DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision(1.5, "unknown_action"), false);
    });
  });

  describe("decisionSeverity (local copy of the server key)", () => {
    it("fighting the fire or staying put at the withdrawal limit is fatal", () => {
      assert.strictEqual(decisionSeverity(1.8, DECISION_CHOICES.EXTINGUISH), "fatal");
      assert.strictEqual(decisionSeverity(1.8, DECISION_CHOICES.WAIT), "fatal");
      assert.strictEqual(decisionSeverity(1.8, DECISION_CHOICES.EVACUATE), null);
    });

    it("walking off or waiting below the limit is a procedural slip", () => {
      assert.strictEqual(decisionSeverity(0.6, DECISION_CHOICES.EVACUATE), "procedural");
      assert.strictEqual(decisionSeverity(0.6, DECISION_CHOICES.WAIT), "procedural");
      assert.strictEqual(decisionSeverity(0.6, DECISION_CHOICES.EXTINGUISH), null);
    });
  });

  describe("getDecisionExplanation feedback messages", () => {
    it("explains why waiting for supervisor is hazardous", () => {
      const exp = getDecisionExplanation(0.8, DECISION_CHOICES.WAIT);
      assert.ok(exp.includes("0.8% CH₄"));
      assert.ok(exp.includes("waiting for a supervisor"));
    });

    it("explains why attempting to extinguish at the withdrawal limit is hazardous", () => {
      const exp = getDecisionExplanation(1.8, DECISION_CHOICES.EXTINGUISH);
      assert.ok(exp.includes("1.8% CH₄"));
      assert.ok(exp.includes("1.25% withdrawal limit"));
      assert.ok(exp.includes("evacuate immediately"));
    });

    it("explains why evacuating without suppression below the limit is suboptimal", () => {
      const exp = getDecisionExplanation(0.6, DECISION_CHOICES.EVACUATE);
      assert.ok(exp.includes("0.6% CH₄"));
      assert.ok(exp.includes("below the 1.25% withdrawal limit"));
      assert.ok(exp.includes("PASS"));
    });
  });

  describe("renderGasGaugeSvg original drawn asset", () => {
    it("generates scalable svg with dial, needle, zones, and digital readout", () => {
      const svg = renderGasGaugeSvg(1.8);
      assert.ok(svg.includes("<svg"), "Must produce valid svg opening tag");
      assert.ok(svg.includes("viewBox=\"0 0 240 240\""), "Must have standard square viewBox");
      assert.ok(svg.includes("CH₄ METHANE"), "Must display methane gas label");
      assert.ok(svg.includes("1.25%"), "Must display the withdrawal limit label");
      assert.ok(svg.includes("1.8% VOL"), "Must display digital concentration badge");
    });

    it("rotates needle correctly for boundary reading values", () => {
      // 0% -> -120 deg
      assert.ok(renderGasGaugeSvg(0.0).includes("rotate(-120.0, 120, 120)"));
      // 1.25% withdrawal limit -> -60 deg, a quarter of the dial
      assert.ok(renderGasGaugeSvg(1.25).includes("rotate(-60.0, 120, 120)"));
      // 5% full scale -> +120 deg
      assert.ok(renderGasGaugeSvg(5.0).includes("rotate(120.0, 120, 120)"));
    });

    it("clamps out-of-bounds readings between 0 and 5", () => {
      assert.ok(renderGasGaugeSvg(-5.0).includes("rotate(-120.0, 120, 120)"));
      assert.ok(renderGasGaugeSvg(15.0).includes("rotate(120.0, 120, 120)"));
    });
  });

  describe("renderAlertFlash visual emergency pulse", () => {
    it("renders full-screen alert overlay with fire alert text", () => {
      const container = document.createElement("div");
      const alert = renderAlertFlash(container, { durationMs: 2000 });

      assert.ok(alert);
      assert.ok(document.getElementById("fire-alert-overlay"));
      assert.ok(alert.element.innerHTML.includes("FIRE &amp; EXPLOSION ALERT"));
      alert.dismiss();
    });

    it("dismisses immediately on tap/click", (t, done) => {
      const container = document.createElement("div");
      let called = false;
      const alert = renderAlertFlash(container, {
        durationMs: 5000,
        onDone: () => {
          called = true;
          assert.ok(called);
          done();
        }
      });

      alert.element.click();
    });
  });

  describe("renderDecisionWheel UI component and interaction", () => {
    it("renders gauge and three decision buttons with gas reading", () => {
      const container = document.createElement("div");
      const panel = renderDecisionWheel(container, { reading: 1.9 });

      assert.ok(panel);
      // reading shown once, in the gauge digital readout
      assert.ok(panel.innerHTML.includes("1.9% VOL"));
      assert.ok(document.getElementById("btn-decision-evacuate"));
      assert.ok(document.getElementById("btn-decision-extinguish"));
      assert.ok(document.getElementById("btn-decision-wait"));
    });

    it("choosing correct option triggers onDecision callback and success feedback", (t, done) => {
      const container = document.createElement("div");
      let firedCheckpoint = null;
      window.addEventListener("safear:checkpoint", (ev) => {
        if (ev.detail.checkpointId === CP_DECISION_ID) {
          firedCheckpoint = ev.detail;
        }
      });

      const panel = renderDecisionWheel(container, {
        reading: 1.9, // >= 1.25%, so evacuate is correct
        onDecision: ({ choice, reading, correct }) => {
          assert.strictEqual(choice, DECISION_CHOICES.EVACUATE);
          assert.strictEqual(reading, 1.9);
          assert.strictEqual(correct, true);
          assert.ok(firedCheckpoint);
          assert.strictEqual(firedCheckpoint.passed, true);
          assert.strictEqual(firedCheckpoint.observation.kind, "selection_sequence");
          assert.deepStrictEqual(firedCheckpoint.observation.tries.map((x) => x.selected), ["evacuate"]);
          done();
        }
      });
      assert.ok(panel);
      // click evacuate button created by renderDecisionWheel
      const btnEvac = document.getElementById("btn-decision-evacuate");
      assert.ok(btnEvac, "evacuate button must exist in decision wheel");
      btnEvac.click();
    });

    it("choosing incorrect option blocks progress and surfaces explanation card", () => {
      const container = document.createElement("div");
      let wrongReported = false;
      const panel = renderDecisionWheel(container, {
        reading: 2.1, // >= 1.25%, so extinguish is WRONG — and fatal
        onWrongAttempt: ({ choice, correct }) => {
          assert.strictEqual(choice, DECISION_CHOICES.EXTINGUISH);
          assert.strictEqual(correct, false);
          wrongReported = true;
        }
      });

      // click extinguish button created by renderDecisionWheel
      const btnExt = document.getElementById("btn-decision-extinguish");
      assert.ok(btnExt, "extinguish button must exist in decision wheel");
      btnExt.click();

      assert.strictEqual(wrongReported, true);
      const feedbackSlot = panel.querySelector("#decision-feedback-slot");
      assert.ok(feedbackSlot.innerHTML.includes("FATAL MISTAKE"));
      assert.ok(feedbackSlot.innerHTML.includes("1.25% withdrawal limit"));
      assert.ok(feedbackSlot.innerHTML.includes("btn-decision-retry"));
      assert.strictEqual(btnExt.disabled, true, "a tried wrong option is locked out");
    });

    it("procedural slip shows the plain wrong-action card, not the fatal one", () => {
      const container = document.createElement("div");
      const panel = renderDecisionWheel(container, { reading: 0.7 });
      document.getElementById("btn-decision-evacuate").click();

      const feedbackSlot = panel.querySelector("#decision-feedback-slot");
      assert.ok(feedbackSlot.innerHTML.includes("INCORRECT SAFETY ACTION"));
      assert.ok(!feedbackSlot.innerHTML.includes("FATAL MISTAKE"));
    });

    it("fires the checkpoint once, on the right pick, carrying every try in order", () => {
      const container = document.createElement("div");
      const fired = [];
      const failures = [];
      const onCp = (ev) => { if (ev.detail.checkpointId === CP_DECISION_ID) fired.push(ev.detail); };
      const onFail = (ev) => failures.push(ev.detail);
      window.addEventListener("safear:checkpoint", onCp);
      window.addEventListener("safear:checkpoint_failure", onFail);
      try {
        renderDecisionWheel(container, { reading: 0.7 });
        document.getElementById("btn-decision-wait").click();
        document.getElementById("btn-decision-wait").click(); // locked out, ignored
        assert.strictEqual(fired.length, 0, "a wrong pick never advances the gate");
        document.getElementById("btn-decision-extinguish").click();

        assert.strictEqual(fired.length, 1);
        assert.deepStrictEqual(fired[0].observation.tries.map((x) => x.selected), ["wait", "extinguish"]);
        assert.ok(fired[0].observation.tries.every((x) => Number.isInteger(x.atMs) && x.atMs >= 0));
        assert.strictEqual(fired[0].passed, true, "a procedural slip is not a fatal fail");
        assert.strictEqual(fired[0].context.score, 0.5, "one slip costs half the gate");
        assert.strictEqual(failures.length, 1);
        assert.strictEqual(failures[0].severity, "procedural");
        assert.strictEqual(failures[0].selected, "wait");
      } finally {
        window.removeEventListener("safear:checkpoint", onCp);
        window.removeEventListener("safear:checkpoint_failure", onFail);
      }
    });

    it("a fatal pick zeroes the gate and marks it failed even after the fix", () => {
      const container = document.createElement("div");
      const fired = [];
      const onCp = (ev) => { if (ev.detail.checkpointId === CP_DECISION_ID) fired.push(ev.detail); };
      window.addEventListener("safear:checkpoint", onCp);
      try {
        renderDecisionWheel(container, { reading: 1.6 });
        document.getElementById("btn-decision-extinguish").click();
        document.getElementById("btn-decision-evacuate").click();

        assert.strictEqual(fired.length, 1);
        assert.strictEqual(fired[0].passed, false);
        assert.strictEqual(fired[0].context.score, 0);
        assert.strictEqual(fired[0].context.fatalCount, 1);
      } finally {
        window.removeEventListener("safear:checkpoint", onCp);
      }
    });
  });

  describe("initOrientationNudge (Phase 1 soft landscape recommendation)", () => {
    it("renders non-blocking toast in portrait mode", () => {
      window.innerWidth = 360;
      window.innerHeight = 740;
      const container = document.createElement("div");
      const nudge = initOrientationNudge(container);
      const toast = document.getElementById("safear-orientation-nudge");
      assert.ok(toast, "toast element must mount in portrait");
      assert.ok(toast.className.includes("orientation-nudge-toast"));
      assert.ok(toast.innerHTML.includes("Tip: rotate your device"));
      nudge.destroy();
    });

    it("does not render toast when device is already in landscape", () => {
      window.innerWidth = 800;
      window.innerHeight = 400;
      const container = document.createElement("div");
      const nudge = initOrientationNudge(container);
      const toast = document.getElementById("safear-orientation-nudge");
      assert.strictEqual(toast, null, "toast must not appear when in landscape");
      nudge.destroy();
    });

    it("allows user to dismiss toast via close button", () => {
      window.innerWidth = 360;
      window.innerHeight = 740;
      const container = document.createElement("div");
      const nudge = initOrientationNudge(container);
      const toast = document.getElementById("safear-orientation-nudge");
      assert.ok(toast);
      const closeBtn = toast.children.find((c) => c.className && c.className.includes("nudge-dismiss-btn"));
      assert.ok(closeBtn, "close button must exist on toast");
      closeBtn.click();
      assert.ok(toast.classList.contains("nudge-hidden"));
      nudge.destroy();
    });

    it("hides toast if user rotates to landscape", () => {
      window.innerWidth = 360;
      window.innerHeight = 740;
      const container = document.createElement("div");
      const nudge = initOrientationNudge(container);
      const toast = document.getElementById("safear-orientation-nudge");
      assert.ok(toast);

      // simulate device rotation to landscape
      window.innerWidth = 740;
      window.innerHeight = 360;
      window.dispatchEvent(new CustomEvent("resize"));

      assert.ok(toast.classList.contains("nudge-hidden"));
      nudge.destroy();
    });
  });

  describe("Mid-session rotation handling (Phase 3)", () => {
    it("decision wheel maintains active reading and event bindings across rotation events", (t, done) => {
      const container = document.createElement("div");
      let fired = false;
      const panel = renderDecisionWheel(container, {
        reading: 0.9,
        onDecision: ({ choice }) => {
          assert.strictEqual(choice, DECISION_CHOICES.EXTINGUISH);
          fired = true;
        }
      });

      assert.ok(panel);
      assert.ok(panel.innerHTML.includes("0.9% VOL"));

      // simulate device orientation rotation from portrait to landscape
      window.innerWidth = 800;
      window.innerHeight = 450;
      window.dispatchEvent(new CustomEvent("resize"));
      window.dispatchEvent(new CustomEvent("orientationchange"));

      // panel still mounted, reading preserved, button click still triggers onDecision
      assert.strictEqual(document.getElementById("fire-decision-panel"), panel);
      assert.ok(panel.innerHTML.includes("0.9% VOL"));

      const btnExt = document.getElementById("btn-decision-extinguish");
      assert.ok(btnExt);
      btnExt.click();

      assert.strictEqual(fired, true);
      done();
    });

    it("soft orientation nudge toggles visibility smoothly when user rotates back and forth", () => {
      // 1. start portrait
      window.innerWidth = 360;
      window.innerHeight = 740;
      const container = document.createElement("div");
      const nudge = initOrientationNudge(container);
      const toast = document.getElementById("safear-orientation-nudge");
      assert.ok(toast);
      assert.strictEqual(toast.classList.contains("nudge-hidden"), false);

      // 2. rotate to landscape -> toast hides
      window.innerWidth = 740;
      window.innerHeight = 360;
      window.dispatchEvent(new CustomEvent("resize"));
      assert.strictEqual(toast.classList.contains("nudge-hidden"), true);

      // 3. rotate back to portrait -> toast unhides if within 5s window
      window.innerWidth = 360;
      window.innerHeight = 740;
      window.dispatchEvent(new CustomEvent("resize"));
      assert.strictEqual(toast.classList.contains("nudge-hidden"), false);

      nudge.destroy();
    });
  });
});


