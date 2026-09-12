import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// minimal browser stubs for test environment
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
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  renderGasGaugeSvg,
  renderAlertFlash,
  renderDecisionWheel,
  CP_DECISION_ID,
  DECISION_CHOICES
} from "../modules/fire-response/decision.js";

describe("Fire & Explosion Scenario: Methane Reading & Decision Logic (Phase 1)", () => {
  beforeEach(() => {
    Object.keys(_elements).forEach((k) => delete _elements[k]);
  });

  describe("generateMethaneReading", () => {
    it("generates reading within 0.5% and 9.5% range", () => {
      for (let i = 0; i < 50; i++) {
        const val = generateMethaneReading();
        assert.ok(typeof val === "number");
        assert.ok(val >= 0.5 && val <= 9.5, `Reading ${val} should be between 0.5 and 9.5`);
        // confirms 1 decimal place precision
        assert.strictEqual(Math.round(val * 10) / 10, val);
      }
    });

    it("respects deterministic random function injection", () => {
      // 0.5 + 0 * 9 = 0.5
      assert.strictEqual(generateMethaneReading(() => 0.0), 0.5);
      // 0.5 + 0.5 * 9 = 5.0
      assert.strictEqual(generateMethaneReading(() => 0.5), 5.0);
      // 0.5 + 1.0 * 9 = 9.5
      assert.strictEqual(generateMethaneReading(() => 1.0), 9.5);
    });
  });

  describe("isCorrectDecision boundary and choice verification", () => {
    it("at exactly 5.0% threshold (explosive lower limit), evacuate is correct and others fail", () => {
      assert.strictEqual(isCorrectDecision(5.0, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(5.0, DECISION_CHOICES.EXTINGUISH), false);
      assert.strictEqual(isCorrectDecision(5.0, DECISION_CHOICES.WAIT), false);
    });

    it("just above 5.0% (e.g. 5.1%, 5.01%), evacuate is correct and others fail", () => {
      assert.strictEqual(isCorrectDecision(5.01, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(5.1, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(7.5, DECISION_CHOICES.EVACUATE), true);
      assert.strictEqual(isCorrectDecision(10.0, DECISION_CHOICES.EVACUATE), true);

      assert.strictEqual(isCorrectDecision(5.1, DECISION_CHOICES.EXTINGUISH), false);
      assert.strictEqual(isCorrectDecision(5.1, DECISION_CHOICES.WAIT), false);
    });

    it("just below 5.0% (e.g. 4.9%, 4.99%), extinguish is correct and others fail", () => {
      assert.strictEqual(isCorrectDecision(4.99, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(4.9, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(2.4, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(0.5, DECISION_CHOICES.EXTINGUISH), true);
      assert.strictEqual(isCorrectDecision(0.0, DECISION_CHOICES.EXTINGUISH), true);

      assert.strictEqual(isCorrectDecision(4.9, DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision(4.9, DECISION_CHOICES.WAIT), false);
    });

    it("'wait' is always wrong regardless of reading value", () => {
      assert.strictEqual(isCorrectDecision(1.0, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(4.9, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(5.0, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(7.2, DECISION_CHOICES.WAIT), false);
      assert.strictEqual(isCorrectDecision(9.5, DECISION_CHOICES.WAIT), false);
    });

    it("rejects invalid, NaN, or non-numeric readings", () => {
      assert.strictEqual(isCorrectDecision(NaN, DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision(null, DECISION_CHOICES.EXTINGUISH), false);
      assert.strictEqual(isCorrectDecision(undefined, DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision("5.0", DECISION_CHOICES.EVACUATE), false);
      assert.strictEqual(isCorrectDecision(5.0, "unknown_action"), false);
    });
  });

  describe("getDecisionExplanation feedback messages", () => {
    it("explains why waiting for supervisor is hazardous", () => {
      const exp = getDecisionExplanation(4.2, DECISION_CHOICES.WAIT);
      assert.ok(exp.includes("4.2% CH₄"));
      assert.ok(exp.includes("waiting for a supervisor"));
    });

    it("explains why attempting to extinguish above 5.0% is hazardous", () => {
      const exp = getDecisionExplanation(7.2, DECISION_CHOICES.EXTINGUISH);
      assert.ok(exp.includes("7.2% CH₄"));
      assert.ok(exp.includes("above the 5.0% lower explosive limit"));
      assert.ok(exp.includes("evacuate immediately"));
    });

    it("explains why evacuating without suppression below 5.0% is suboptimal", () => {
      const exp = getDecisionExplanation(3.5, DECISION_CHOICES.EVACUATE);
      assert.ok(exp.includes("3.5% CH₄"));
      assert.ok(exp.includes("below 5.0%"));
      assert.ok(exp.includes("PASS"));
    });
  });

  describe("renderGasGaugeSvg original drawn asset", () => {
    it("generates scalable svg with dial, needle, zones, and digital readout", () => {
      const svg = renderGasGaugeSvg(7.2);
      assert.ok(svg.includes("<svg"), "Must produce valid svg opening tag");
      assert.ok(svg.includes("viewBox=\"0 0 240 240\""), "Must have standard square viewBox");
      assert.ok(svg.includes("CH₄ METHANE"), "Must display methane gas label");
      assert.ok(svg.includes("5% LEL"), "Must display 5% explosive threshold label");
      assert.ok(svg.includes("7.2% VOL"), "Must display digital concentration badge");
    });

    it("rotates needle correctly for boundary reading values", () => {
      // 0% -> -120 deg
      const svg0 = renderGasGaugeSvg(0.0);
      assert.ok(svg0.includes("rotate(-120.0, 120, 120)"));

      // 5% -> 0.0 deg (straight up)
      const svg5 = renderGasGaugeSvg(5.0);
      assert.ok(svg5.includes("rotate(0.0, 120, 120)"));

      // 10% -> +120 deg
      const svg10 = renderGasGaugeSvg(10.0);
      assert.ok(svg10.includes("rotate(120.0, 120, 120)"));
    });

    it("clamps out-of-bounds readings between 0 and 10", () => {
      const svgNeg = renderGasGaugeSvg(-5.0);
      assert.ok(svgNeg.includes("rotate(-120.0, 120, 120)"));

      const svgOver = renderGasGaugeSvg(15.0);
      assert.ok(svgOver.includes("rotate(120.0, 120, 120)"));
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
      const panel = renderDecisionWheel(container, { reading: 6.5 });

      assert.ok(panel);
      assert.ok(panel.innerHTML.includes("6.5% CH₄"));
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
        reading: 6.5, // >= 5%, so evacuate is correct
        onDecision: ({ choice, reading, correct }) => {
          assert.strictEqual(choice, DECISION_CHOICES.EVACUATE);
          assert.strictEqual(reading, 6.5);
          assert.strictEqual(correct, true);
          assert.ok(firedCheckpoint);
          assert.strictEqual(firedCheckpoint.passed, true);
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
        reading: 7.0, // >= 5%, so extinguish is WRONG
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
      assert.ok(feedbackSlot.innerHTML.includes("INCORRECT SAFETY ACTION"));
      assert.ok(feedbackSlot.innerHTML.includes("above the 5.0% lower explosive limit"));
      assert.ok(feedbackSlot.innerHTML.includes("btn-decision-retry"));
    });
  });
});
