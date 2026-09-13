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

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class MockMeshBasicMaterial {
  constructor(opt = {}) {
    this.color = { setRGB() {} };
    this.opacity = opt.opacity ?? 1;
  }
  clone() {
    return new MockMeshBasicMaterial();
  }
}
class MockMesh {
  constructor(geo, mat) {
    this.geometry = geo;
    this.material = mat || new MockMeshBasicMaterial();
    this.position = new MockVector3();
    this.scale = new MockVector3(1, 1, 1);
    this.rotation = new MockVector3();
    this.userData = {};
    this.visible = true;
  }
}
class MockGroup {
  constructor() {
    this.children = [];
    this.position = new MockVector3();
    this.scale = new MockVector3(1, 1, 1);
    this.rotation = new MockVector3();
    this.userData = {};
    this.visible = true;
  }
  add(obj) { this.children.push(obj); }
  remove(obj) { this.children = this.children.filter((c) => c !== obj); }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      if (child.name === name) return child;
      if (child.getObjectByName) {
        const found = child.getObjectByName(name);
        if (found) return found;
      }
    }
    return null;
  }
}

const mockTHREE = {
  Vector3: MockVector3,
  BoxGeometry: class {},
  RingGeometry: class {},
  CylinderGeometry: class {},
  SphereGeometry: class {},
  ConeGeometry: class {},
  TorusGeometry: class {},
  CircleGeometry: class {},
  DodecahedronGeometry: class {},
  MeshBasicMaterial: MockMeshBasicMaterial,
  MeshStandardMaterial: MockMeshBasicMaterial,
  Mesh: MockMesh,
  Group: MockGroup,
  PointLight: class { constructor() { this.position = new MockVector3(); } },
  DoubleSide: 2
};
globalThis.window.THREE = mockTHREE;

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
      const matches = this._innerHTML.matchAll(/id=["']([^"']+)["']/g);
      for (const m of matches) {
        if (!_elements[m[1]]) {
          const childEl = _makeEl(m[1]);
          this.appendChild(childEl);
        }
      }
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
  getAlarmPulledWebXR,
  dismissWebXRDiag,
  isDiagHudVisibleWebXR,
  _setupStep3WebXR,
  _showAlarmPullStationWebXR,
  _renderDebriefCardWebXR,
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

  it("diagnostic HUD is positioned at top:64px to clear header bar badges", () => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 2.5 });

    const hudEl = document.getElementById("webxr-diag-hud");
    assert.ok(hudEl, "Diagnostic HUD must be present on start");
    assert.ok(hudEl.style.cssText.includes("top:64px"), "HUD inline style must set top:64px to clear header");
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

  it("Branch A: Evacuate choice spawns 3D exit sign, confirms route, fires checkpoints with wind_based_upwind and mounts debrief card", (t, done) => {
    const container = _makeEl("container");
    const addedMeshes = [];
    const removedMeshes = [];
    const mockController = {
      addToScene(m) { addedMeshes.push(m); },
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame() {},
      offFrame() {}
    };

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    startFireModuleWebXR(container, mockController, { reading: 6.5 });

    const overlay = document.getElementById("fire-module-overlay");
    for (let i = 0; i < 3; i++) {
      overlay.querySelector("#btn-step-next").click();
    }
    document.getElementById("fire-alert-overlay").click();

    setTimeout(() => {
      const btnEvac = document.getElementById("btn-decision-evacuate");
      assert.ok(btnEvac);
      btnEvac.click();

      const btnProceed = document.getElementById("btn-decision-proceed");
      assert.ok(btnProceed);
      btnProceed.click();

      // exit mesh added to scene
      assert.ok(addedMeshes.some((m) => m.name === "exit-graphic"), "3D Exit sign mesh must be added to scene");

      // HUD card rendered
      const hudCard = document.getElementById("fire-hud-card");
      assert.ok(hudCard);
      assert.ok(hudCard.innerHTML.includes("BRANCH A — IMMEDIATE EVACUATION"));
      assert.ok(hudCard.innerHTML.includes("CRITICAL METHANE LEVEL (>= 5.0%)"));

      const btnConfirm = document.getElementById("btn-exit-found");
      assert.ok(btnConfirm);
      btnConfirm.click();

      // exit mesh cleaned up
      assert.ok(removedMeshes.some((m) => m.name === "exit-graphic"), "3D Exit sign mesh must be removed from scene");

      // verify checkpoints
      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.strictEqual(exitCp.passed, true);
      assert.strictEqual(exitCp.context.method, "branch_a_evacuate");

      const evacCp = checkpointsFired.find((c) => c.checkpointId === "fire_evacuation_sequence_webxr");
      assert.ok(evacCp);
      assert.strictEqual(evacCp.passed, true);
      assert.strictEqual(evacCp.context.selected, "wind_based_upwind");

      // debrief card mounted
      const debrief = document.getElementById("debrief-summary-card");
      assert.ok(debrief, "Debrief summary card must be mounted");
      assert.ok(debrief.innerHTML.includes("6.5% CH₄ (EXPLOSIVE)"));
      assert.ok(debrief.innerHTML.includes("Branch A (Immediate Evacuation)"));
      assert.ok(debrief.innerHTML.includes("N/A (Evacuated Immediately)"));
      assert.ok(debrief.innerHTML.includes("Mines Act Compliance"));
      done();
    }, 300);
  });

  it("Branch B: Extinguish choice spawns 3D alarm station, pulls alarm station, sets alarmPulled flag, fires CP_EXIT_ID and advances", (t, done) => {
    const container = _makeEl("container");
    const addedMeshes = [];
    const removedMeshes = [];
    const mockController = {
      addToScene(m) { addedMeshes.push(m); },
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame() {},
      offFrame() {}
    };

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    startFireModuleWebXR(container, mockController, { reading: 2.3 });

    const overlay = document.getElementById("fire-module-overlay");
    for (let i = 0; i < 3; i++) {
      overlay.querySelector("#btn-step-next").click();
    }
    document.getElementById("fire-alert-overlay").click();

    setTimeout(() => {
      const btnExt = document.getElementById("btn-decision-extinguish");
      assert.ok(btnExt);
      btnExt.click();

      const btnProceed = document.getElementById("btn-decision-proceed");
      assert.ok(btnProceed);
      btnProceed.click();

      // alarm mesh added to scene
      assert.ok(addedMeshes.some((m) => m.name === "fire-alarm-station"), "3D Alarm station mesh must be added to scene");

      const hudCard = document.getElementById("fire-hud-card");
      assert.ok(hudCard);
      assert.ok(hudCard.innerHTML.includes("STEP 1 / 3 — SOUND ALARM (BRANCH B)"));

      assert.strictEqual(getAlarmPulledWebXR(), false);
      const btnPull = document.getElementById("btn-pull-alarm");
      assert.ok(btnPull);
      btnPull.click();

      assert.strictEqual(getAlarmPulledWebXR(), true);

      // alarm mesh cleaned up
      assert.ok(removedMeshes.some((m) => m.name === "fire-alarm-station"), "3D Alarm station mesh must be removed after pulling");

      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.strictEqual(exitCp.passed, true);
      assert.strictEqual(exitCp.context.method, "alarm_pull_activated");

      setTimeout(() => {
        // after alarm, transitions to placement screen
        const placeBtn = document.getElementById("btn-place-extinguisher");
        assert.ok(placeBtn, "Must transition to extinguisher placement screen after alarm pull");
        done();
      }, 500);
    }, 300);
  });

  it("Step 3: Evacuation selection spawns 3D exit sign, passing selection fires CP_EVACUATION_WEBXR_ID and displays debrief card", () => {
    const container = _makeEl("container");
    const addedMeshes = [];
    const removedMeshes = [];
    const mockController = {
      addToScene(m) { addedMeshes.push(m); },
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame() {},
      offFrame() {}
    };

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    startFireModuleWebXR(container, mockController, { reading: 1.8 });

    // direct invocation of Step 3
    _setupStep3WebXR(container, true);

    assert.ok(addedMeshes.some((m) => m.name === "exit-graphic"), "Step 3 must spawn 3D exit sign mesh");

    const optUpwind = document.getElementById("evacuation-opt-wind_based_upwind");
    assert.ok(optUpwind, "wind_based_upwind option must be rendered");
    optUpwind.click();

    assert.ok(removedMeshes.some((m) => m.name === "exit-graphic"), "Exit sign must be removed after choice");

    const evacCp = checkpointsFired.find((c) => c.checkpointId === "fire_evacuation_sequence_webxr");
    assert.ok(evacCp);
    assert.strictEqual(evacCp.passed, true);
    assert.strictEqual(evacCp.context.selected, "wind_based_upwind");

    const debrief = document.getElementById("debrief-summary-card");
    assert.ok(debrief, "Debrief card must render on step 3 completion");
    assert.ok(debrief.innerHTML.includes("1.8% CH₄ (SAFE/INCIPIENT)"));
  });

  it("cleanupWebXRFireModule resets all 3D meshes, alarm state, and debrief card", () => {
    const container = _makeEl("container");
    const removedMeshes = [];
    const mockController = {
      addToScene() {},
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame() {},
      offFrame() {}
    };

    startFireModuleWebXR(container, mockController, { reading: 3.0 });
    _showAlarmPullStationWebXR(container, document.getElementById("fire-module-overlay"), () => {});
    _renderDebriefCardWebXR(document.getElementById("fire-module-overlay"));

    assert.ok(document.getElementById("debrief-summary-card"));
    cleanupWebXRFireModule();

    assert.strictEqual(getAlarmPulledWebXR(), false);
    assert.strictEqual(getActiveBranchWebXR(), null);
    assert.strictEqual(document.getElementById("debrief-summary-card"), null);
    assert.ok(removedMeshes.length > 0, "Controller removeFromScene must be called during cleanup");
  });
});
