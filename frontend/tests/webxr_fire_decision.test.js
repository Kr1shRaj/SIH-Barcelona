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
  applyQuaternion(q) {
    if (q && q._rotatesTo) {
      this.x = q._rotatesTo.x;
      this.y = q._rotatesTo.y;
      this.z = q._rotatesTo.z;
      return this;
    }
    if (q) {
      const x = this.x, y = this.y, z = this.z;
      const qx = q.x || 0, qy = q.y || 0, qz = q.z || 0, qw = (q.w !== undefined) ? q.w : 1;
      const ix = qw * x + qy * z - qz * y;
      const iy = qw * y + qz * x - qx * z;
      const iz = qw * z + qx * y - qy * x;
      const iw = -qx * x - qy * y - qz * z;
      this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
      this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    }
    return this;
  }
  normalize() { return this; }
  distanceTo() { return 0; }
}
class MockVector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
    this._rotatesTo = null;
  }
}
class MockRaycaster {
  constructor() {
    this.ray = {};
  }
  setFromCamera() {}
  intersectObject(obj) {
    if (globalThis.__mockRaycastHitTarget === obj || (obj && obj.children && obj.children.includes(globalThis.__mockRaycastHitTarget))) {
      return [{ object: obj, point: new MockVector3() }];
    }
    return [];
  }
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
  lookAt(x, y, z) { this._lookAtTarget = { x, y, z }; }
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
  Vector2: MockVector2,
  Quaternion: MockQuaternion,
  Raycaster: MockRaycaster,
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
  _showEvacuateConfirmationWebXR,
  _renderDebriefCardWebXR,
  _computePlacementPose,
  _raycastMesh,
  calcAlarmFallbackPose,
  calcExtinguishProgress,
  EXTINGUISH_DURATION_MS,
  _showAimCrosshair,
  _hideAimCrosshair,
  getExitSignScaleWebXR,
  CP_DECISION_ID,
  DECISION_CHOICES
} from "../modules/fire-response/webxr_fire_module.js";
import { startAssessmentSession, abortAssessmentSession } from "../assessment/engine.js";
import { scenarioFor } from "../modules/fire-response/scenario.js";

// the loader opens the session first, the gas reading is rolled from its attemptId
const ATTEMPT_ID = "0b5e1a2c-3d4e-4f56-8a7b-9c0d1e2f3a4b";

describe("Tier 1 WebXR Fire Module: Phase 1 Decision Layer Port", () => {
  beforeEach(() => {
    Object.keys(_elements).forEach((k) => delete _elements[k]);
    Object.keys(_listeners).forEach((k) => delete _listeners[k]);
    cleanupWebXRFireModule();
    abortAssessmentSession();
    startAssessmentSession({ moduleId: "fire-response", arTier: 1, attemptId: ATTEMPT_ID });
  });

  it("rolls the methane reading from the session attemptId when not supplied", () => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController);

    assert.strictEqual(getMethaneReadingWebXR(), scenarioFor(ATTEMPT_ID).reading, "server rolls the same reading");
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
    startFireModuleWebXR(container, mockController, { reading: 1.8 });

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
      assert.ok(decisionPanel.innerHTML.includes("1.8% VOL"));

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
    startFireModuleWebXR(container, mockController, { reading: 0.9 });

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
      // 0.9% < 1.25%, so EXTINGUISH is correct
      const btnExt = document.getElementById("btn-decision-extinguish");
      btnExt.click();

      const cp = checkpointsFired.find((c) => c.checkpointId === CP_DECISION_ID);
      assert.ok(cp, "fire_explosion_decision checkpoint must fire");
      assert.strictEqual(cp.passed, true);
      assert.strictEqual(cp.context.choice, DECISION_CHOICES.EXTINGUISH);
      assert.strictEqual(cp.context.reading, 0.9);
      assert.strictEqual(cp.type, "select");
      assert.strictEqual(cp.observation.kind, "selection_sequence");
      assert.deepStrictEqual(cp.observation.tries.map((x) => x.selected), [DECISION_CHOICES.EXTINGUISH]);

      assert.strictEqual(getActiveBranchWebXR(), "suppress");
      done();
    }, 300);
  });

  it("wrong choice blocks progress and displays retry explanation", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 2.1 });

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
      // 2.1% >= 1.25%, so EXTINGUISH is wrong — and fatal
      const btnExt = document.getElementById("btn-decision-extinguish");
      btnExt.click();

      assert.ok(!checkpointsFired.some((c) => c.checkpointId === CP_DECISION_ID), "a wrong pick must not advance the gate");

      const feedback = document.getElementById("decision-feedback-slot");
      assert.ok(feedback.innerHTML.includes("FATAL MISTAKE"));
      assert.ok(feedback.innerHTML.includes("btn-decision-retry"));

      const retryBtn = document.getElementById("btn-decision-retry");
      assert.ok(retryBtn);
      retryBtn.click();

      // now click correct choice (EVACUATE)
      const btnEvac = document.getElementById("btn-decision-evacuate");
      btnEvac.click();

      // one checkpoint, carrying both tries. the fatal first pick keeps it failed
      const cps = checkpointsFired.filter((c) => c.checkpointId === CP_DECISION_ID);
      assert.strictEqual(cps.length, 1);
      assert.strictEqual(cps[0].passed, false);
      assert.deepStrictEqual(cps[0].observation.tries.map((x) => x.selected), ["extinguish", "evacuate"]);
      assert.strictEqual(getActiveBranchWebXR(), "evacuate");
      done();
    }, 300);
  });

  it("diagnostic HUD is present during gas meter, but automatically dismissed when proceeding to next step", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 0.7 });

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
    startFireModuleWebXR(container, mockController, { reading: 1.1 });

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
    startFireModuleWebXR(container, mockController, { reading: 0.95 });

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
    startFireModuleWebXR(container, mockController, { reading: 0.6 });

    const hudEl = document.getElementById("webxr-diag-hud");
    assert.ok(hudEl, "Diagnostic HUD must be present on start");
    assert.ok(hudEl.style.cssText.includes("top:64px"), "HUD inline style must set top:64px to clear header");
  });

  it("mid-session rotation (resize / orientationchange) preserves decision panel, gauge, and state", (t, done) => {
    const container = _makeEl("container");
    const mockController = {};
    startFireModuleWebXR(container, mockController, { reading: 1.7 });

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
      assert.strictEqual(getMethaneReadingWebXR(), 1.7);

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

    startFireModuleWebXR(container, mockController, { reading: 1.6 });

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
      assert.ok(hudCard.innerHTML.includes("METHANE AT WITHDRAWAL LIMIT (>= 1.25%)"));

      const btnConfirm = document.getElementById("btn-exit-found");
      assert.ok(btnConfirm);
      btnConfirm.click();
      btnConfirm.click();

      // exit mesh cleaned up
      assert.ok(removedMeshes.some((m) => m.name === "exit-graphic"), "3D Exit sign mesh must be removed from scene");

      // verify checkpoints
      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.ok(["branch_a_evacuate", "small_room_fallback", "physical_walk"].includes(exitCp.context.method));

      // no evacuation answer is recorded until the worker gives one
      assert.ok(!checkpointsFired.some((c) => c.checkpointId === "fire_evacuation_sequence_webxr"), "no evacuation answer may be faked");
      document.getElementById("evacuation-opt-wind_based_upwind").click();

      const evacCp = checkpointsFired.find((c) => c.checkpointId === "fire_evacuation_sequence_webxr");
      assert.ok(evacCp);
      assert.strictEqual(evacCp.passed, true);
      assert.strictEqual(evacCp.context.selected, "wind_based_upwind");

      // debrief card mounted
      const debrief = document.getElementById("debrief-summary-card");
      assert.ok(debrief, "Debrief summary card must be mounted");
      assert.ok(debrief.innerHTML.includes("1.6% CH₄ (WITHDRAW)"));
      assert.ok(debrief.innerHTML.includes("Branch A (Immediate Evacuation)"));
      assert.ok(debrief.innerHTML.includes("N/A (Evacuated Immediately)"));
      assert.ok(debrief.innerHTML.includes("Training feedback"));
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

    startFireModuleWebXR(container, mockController, { reading: 0.8 });

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

      // station stays up for the 1s pull payoff (lever, strobe, siren) before it is cleared
      assert.ok(!removedMeshes.some((m) => m.name === "fire-alarm-station"), "Alarm station must stay visible during pull payoff");

      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.strictEqual(exitCp.passed, true);
      assert.strictEqual(exitCp.context.method, "alarm_pull_activated");

      setTimeout(() => {
        // alarm mesh cleaned up once payoff is over
        assert.ok(removedMeshes.some((m) => m.name === "fire-alarm-station"), "3D Alarm station mesh must be removed after pulling");
        // after alarm, transitions to placement screen
        const placeBtn = document.getElementById("btn-place-extinguisher");
        assert.ok(placeBtn, "Must transition to extinguisher placement screen after alarm pull");
        done();
      }, 1200);
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

    startFireModuleWebXR(container, mockController, { reading: 0.8 });

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
    assert.ok(debrief.innerHTML.includes("0.8% CH₄ (BELOW LIMIT)"));
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

    startFireModuleWebXR(container, mockController, { reading: 0.7 });
    _showAlarmPullStationWebXR(container, document.getElementById("fire-module-overlay"), () => {});
    _renderDebriefCardWebXR(document.getElementById("fire-module-overlay"));

    assert.ok(document.getElementById("debrief-summary-card"));
    cleanupWebXRFireModule();

    assert.strictEqual(getAlarmPulledWebXR(), false);
    assert.strictEqual(getActiveBranchWebXR(), null);
    assert.strictEqual(document.getElementById("debrief-summary-card"), null);
    assert.ok(removedMeshes.length > 0, "Controller removeFromScene must be called during cleanup");
  });

  it("debrief card renders #btn-exit-module and clicking it cleanly unloads module and cleans up WebXR state", () => {
    const container = _makeEl("container");
    const overlay = _makeEl("fire-module-overlay");
    container.appendChild(overlay);

    _renderDebriefCardWebXR(overlay);
    const card = document.getElementById("debrief-summary-card");
    assert.ok(card, "Debrief card must exist");

    const exitBtn = document.getElementById("btn-exit-module");
    assert.ok(exitBtn, "#btn-exit-module must exist inside debrief card");
    assert.ok(exitBtn.textContent.includes("Finish & Exit"), "Exit button text must invite completion");

    let unloadedEventFired = false;
    const handler = () => { unloadedEventFired = true; };
    window.addEventListener("safear:module_unloaded", handler, { once: true });

    exitBtn.click();

    assert.ok(unloadedEventFired, "safear:module_unloaded event must be fired on exit click");
    assert.strictEqual(document.getElementById("debrief-summary-card"), null, "Debrief card removed");
    assert.strictEqual(document.getElementById("fire-module-overlay"), null, "Overlay cleaned up");
  });

  it("debrief card includes overflow-safe styles and minmax grid columns to prevent right-edge clipping", () => {
    const container = _makeEl("container");
    const overlay = _makeEl("fire-module-overlay");
    container.appendChild(overlay);

    _renderDebriefCardWebXR(overlay);
    const card = document.getElementById("debrief-summary-card");
    assert.ok(card);
    assert.ok(card.style.cssText.includes("overflow:hidden"), "Card must have overflow:hidden");
    assert.ok(card.style.cssText.includes("word-break:break-word"), "Card must have word-break:break-word");
    assert.ok(card.style.cssText.includes("box-sizing:border-box"), "Card must have box-sizing:border-box");
    assert.ok(card.innerHTML.includes("minmax(0,1fr)"), "KPI grid must use minmax(0,1fr) to prevent column blowout");
    assert.ok(card.innerHTML.includes("min-width:0"), "KPI cells must declare min-width:0 to allow shrinking");
  });

  it("_computePlacementPose snaps to vertical surface when wall hit detected", () => {
    const container = _makeEl("container");
    const mockHitPose = {
      transform: {
        position: { x: 0.5, y: 1.2, z: -2.1 },
        orientation: { x: 0, y: 0, z: 0, w: 1 }
      }
    };
    const mockFrame = {
      getHitTestResults() {
        return [{
          getPose() { return mockHitPose; }
        }];
      }
    };
    const mockController = {
      hitTestSource: {},
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };
    startFireModuleWebXR(container, mockController);

    // hit normal pointing horizontally (wall/door): rotated 90 deg around X (normalY = 0)
    mockHitPose.transform.orientation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

    const result = _computePlacementPose(mockFrame, {}, 1.2, true, 1.15, -0.35);
    assert.strictEqual(result.isVertical, true);
    assert.strictEqual(result.pos.x, 0.5);
    assert.strictEqual(result.pos.y, 1.2);
    assert.strictEqual(result.pos.z, -2.1);
    assert.ok(result.normal, "Wall surface normal must be returned");
    assert.strictEqual(Math.round(result.normal.z), 1);
    assert.strictEqual(result.normal.y, 0);
  });

  it("_computePlacementPose accepts 4m door when caller raises wall cap, rejects it at default 3.5m", () => {
    const container = _makeEl("container");
    const mockHitPose = {
      transform: {
        position: { x: 0, y: 2.0, z: -4.0 },
        orientation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }
      }
    };
    const mockFrame = { getHitTestResults() { return [{ getPose() { return mockHitPose; } }]; } };
    const mockController = {
      hitTestSource: {},
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };
    startFireModuleWebXR(container, mockController);

    const capped = _computePlacementPose(mockFrame, {}, 2.0, false, 0, 0);
    assert.strictEqual(capped.isVertical, false, "default cap must still drop far wall hits");

    const far = _computePlacementPose(mockFrame, {}, 2.0, false, 0, 0, 8.0);
    assert.strictEqual(far.isVertical, true);
    assert.strictEqual(far.pos.z, -4.0, "sign must land on the door, not 2m ahead");
  });

  it("calcAlarmFallbackPose puts alarm left-front of viewer, below eye, facing viewer", () => {
    const { pos, normal } = calcAlarmFallbackPose({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    assert.ok(Math.abs(pos.x - -0.8) < 1e-9, "0.8m to the left");
    assert.ok(Math.abs(pos.z - -1.0) < 1e-9, "1.0m forward");
    assert.ok(Math.abs(pos.y - 1.35) < 1e-9, "just below eye level");
    // normal must point back at the viewer
    assert.ok(normal.x > 0 && normal.z > 0);

    // viewer turned 90 deg left (facing -x): left is now +z
    const yaw = Math.PI / 2;
    const turned = calcAlarmFallbackPose({ x: 0, y: 1.5, z: 0 }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    assert.ok(Math.abs(turned.pos.x - -1.0) < 1e-9);
    assert.ok(Math.abs(turned.pos.z - 0.8) < 1e-9);
  });

  it("calcExtinguishProgress needs full 5s spray and full sweep before fire is out", () => {
    assert.strictEqual(EXTINGUISH_DURATION_MS, 5000);
    assert.strictEqual(calcExtinguishProgress(0, 1), 0);
    assert.strictEqual(calcExtinguishProgress(2500, 1), 0.5, "linear in time when sweep is ahead");
    assert.ok(calcExtinguishProgress(3000, 1) < 1, "old 3s is no longer enough");
    assert.strictEqual(calcExtinguishProgress(5000, 1), 1);
    assert.strictEqual(calcExtinguishProgress(10000, 0), 0, "no sweep, fire does not shrink");
    assert.ok(calcExtinguishProgress(10000, 0.375) === 0.5, "half the required sweep caps at half");
  });

  it("_computePlacementPose elevates position when horizontal floor hit detected", () => {
    const container = _makeEl("container");
    const mockHitPose = {
      transform: {
        position: { x: 0, y: 0, z: -1.5 },
        orientation: { x: 0, y: 0, z: 0, w: 1 }
      }
    };
    const mockFrame = {
      getHitTestResults() {
        return [{
          getPose() { return mockHitPose; }
        }];
      }
    };
    const mockController = {
      hitTestSource: {},
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };
    startFireModuleWebXR(container, mockController);

    // hit normal pointing vertically upward (floor): identity quaternion (normalY = 1)
    mockHitPose.transform.orientation = { x: 0, y: 0, z: 0, w: 1 };

    const result = _computePlacementPose(mockFrame, {}, 1.2, true, 1.15, -0.35);
    assert.strictEqual(result.isVertical, false);
    assert.strictEqual(result.pos.x, 0);
    assert.strictEqual(result.pos.y, 1.15);
    assert.strictEqual(result.pos.z, -1.5);
    assert.ok(result.normal, "Normal facing approaching user must be returned");
    assert.strictEqual(result.normal.y, 0);
    assert.strictEqual(Math.round(result.normal.z), 1);
  });

  it("_computePlacementPose projects forward along camera gaze when no hit results", () => {
    const container = _makeEl("container");
    const mockFrame = {
      getHitTestResults() { return []; }
    };
    const mockController = {
      hitTestSource: {},
      getCamera() { return { position: new MockVector3(1, 1.5, -2), quaternion: new MockQuaternion() }; }
    };
    startFireModuleWebXR(container, mockController);

    const result = _computePlacementPose(mockFrame, {}, 1.2, true, 1.15, -0.35);
    assert.strictEqual(result.isVertical, false);
    assert.strictEqual(result.pos.x, 1);
    assert.strictEqual(result.pos.y, 1.15); // 1.5 + (-0.35)
    assert.strictEqual(result.pos.z, -3.2); // -2 + (-1.2)
    assert.ok(result.normal, "Normal facing back along gaze must be returned");
    assert.strictEqual(result.normal.y, 0);
    assert.strictEqual(Math.round(result.normal.z), 1);
  });

  it("_raycastMesh returns true on direct intersection and false on miss", () => {
    const mockMesh = new MockMesh();
    globalThis.__mockRaycastHitTarget = mockMesh;
    assert.strictEqual(_raycastMesh({ clientX: 100, clientY: 100 }, mockMesh), true);
    globalThis.__mockRaycastHitTarget = null;
    assert.strictEqual(_raycastMesh({ clientX: 100, clientY: 100 }, mockMesh), false);
  });

  it("Branch B: Tapping 3D alarm station directly via raycasting pulls alarm without DOM button", (t, done) => {
    const container = _makeEl("container");
    let addedAlarmMesh = null;
    const removedMeshes = [];
    const mockController = {
      addToScene(m) {
        if (m.name === "fire-alarm-station") addedAlarmMesh = m;
      },
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame() {},
      offFrame() {},
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    startFireModuleWebXR(container, mockController, { reading: 0.6 });
    const overlay = document.getElementById("fire-module-overlay");

    _showAlarmPullStationWebXR(container, overlay, () => {
      // verified completion callback called
      assert.strictEqual(getAlarmPulledWebXR(), true);
      assert.ok(removedMeshes.some((m) => m.name === "fire-alarm-station"));
      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.strictEqual(exitCp.passed, true);
      done();
    });

    assert.ok(addedAlarmMesh);
    assert.strictEqual(getAlarmPulledWebXR(), false);

    // simulate direct tap on 3D alarm station mesh
    globalThis.__mockRaycastHitTarget = addedAlarmMesh;
    window.dispatchEvent(new CustomEvent("pointerdown", { detail: { clientX: 200, clientY: 300 } }));
    globalThis.__mockRaycastHitTarget = null;
  });

  it("Branch A: Physically walking toward placed exit sign triggers evacuation completion", (t, done) => {
    const container = _makeEl("container");
    let addedExitMesh = null;
    const removedMeshes = [];
    let activeWalkHandler = null;
    const mockCamera = { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() };
    const mockController = {
      addToScene(m) {
        if (m.name === "exit-graphic") addedExitMesh = m;
      },
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame(fn) { activeWalkHandler = fn; },
      offFrame() { activeWalkHandler = null; },
      getCamera() { return mockCamera; }
    };

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    startFireModuleWebXR(container, mockController, { reading: 1.7 });
    const overlay = document.getElementById("fire-module-overlay");

    _showEvacuateConfirmationWebXR(container, overlay, 1.7);

    assert.ok(addedExitMesh);

    // simulate tapping screen to lock placement and start walk tracking
    window.dispatchEvent(new CustomEvent("pointerdown", { detail: { clientX: 200, clientY: 300 } }));

    const walkFeedback = document.getElementById("exit-walk-feedback");
    assert.ok(walkFeedback, "Walk feedback HUD must be displayed after locking exit route");
    const distText = document.getElementById("exit-walk-dist-text");
    assert.ok(distText);
    assert.ok(distText.textContent.includes("m"));

    // User physically walks forward towards exit sign at (0, 1.8, -1.8)
    // Distance from (0, 1.5, -1.2) to (0, 1.8, -1.8) is 0.6m in XZ <= 0.8m threshold
    mockCamera.position.z = -1.2;
    assert.ok(activeWalkHandler);
    activeWalkHandler();

    setTimeout(() => {
      assert.ok(removedMeshes.some((m) => m.name === "exit-graphic"));
      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.strictEqual(exitCp.passed, true);
      assert.ok(!checkpointsFired.some((c) => c.checkpointId === "fire_evacuation_sequence_webxr"), "no evacuation answer may be faked");
      document.getElementById("evacuation-opt-wind_based_upwind").click();
      const evacCp = checkpointsFired.find((c) => c.checkpointId === "fire_evacuation_sequence_webxr");
      assert.ok(evacCp);
      assert.strictEqual(evacCp.passed, true);
      const debrief = document.getElementById("debrief-summary-card");
      assert.ok(debrief, "Debrief summary card must be mounted after physical walk completion");
      done();
    }, 100);
  });

  it("Branch A: Small-room fallback button confirms evacuation when physical walking is restricted", (t, done) => {
    const container = _makeEl("container");
    let addedExitMesh = null;
    const removedMeshes = [];
    const mockController = {
      addToScene(m) {
        if (m.name === "exit-graphic") addedExitMesh = m;
      },
      removeFromScene(m) { removedMeshes.push(m); },
      onFrame() {},
      offFrame() {},
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };

    const checkpointsFired = [];
    window.addEventListener("safear:checkpoint", (ev) => {
      checkpointsFired.push(ev.detail);
    });

    startFireModuleWebXR(container, mockController, { reading: 1.7 });
    const overlay = document.getElementById("fire-module-overlay");

    _showEvacuateConfirmationWebXR(container, overlay, 1.7);
    assert.ok(addedExitMesh);

    // Tap to lock exit sign
    window.dispatchEvent(new CustomEvent("pointerdown", { detail: { clientX: 200, clientY: 300 } }));

    const fallbackBtn = document.getElementById("btn-exit-found");
    assert.ok(fallbackBtn);
    assert.ok(fallbackBtn.textContent.includes("Restricted") || fallbackBtn.textContent.includes("complete"));

    // Click small-room fallback
    fallbackBtn.click();

    setTimeout(() => {
      assert.ok(removedMeshes.some((m) => m.name === "exit-graphic"));
      const exitCp = checkpointsFired.find((c) => c.checkpointId === "fire_exit_identification");
      assert.ok(exitCp);
      assert.strictEqual(exitCp.passed, true);
      assert.ok(!checkpointsFired.some((c) => c.checkpointId === "fire_evacuation_sequence_webxr"), "no evacuation answer may be faked");
      document.getElementById("evacuation-opt-wind_based_upwind").click();
      const evacCp = checkpointsFired.find((c) => c.checkpointId === "fire_evacuation_sequence_webxr");
      assert.ok(evacCp);
      assert.strictEqual(evacCp.passed, true);
      assert.strictEqual(evacCp.context.branch, "evacuate");
      const debrief = document.getElementById("debrief-summary-card");
      assert.ok(debrief, "Debrief summary card must be mounted after fallback button tap");
      done();
    }, 100);
  });

  it("Aim crosshair: _showAimCrosshair mounts reticle and _hideAimCrosshair removes it", () => {
    const container = _makeEl("container");
    assert.strictEqual(document.getElementById("webxr-aim-crosshair"), null);

    _showAimCrosshair(container);
    const crosshair = document.getElementById("webxr-aim-crosshair");
    assert.ok(crosshair, "Crosshair element must be mounted");
    assert.ok(crosshair.innerHTML.includes("<svg"), "Crosshair must contain SVG reticle");
    assert.ok(crosshair.innerHTML.includes("#00e676"), "Crosshair must have emerald center indicator");

    _hideAimCrosshair();
    assert.strictEqual(document.getElementById("webxr-aim-crosshair"), null);
  });

  it("Aim crosshair: cleanupWebXRFireModule removes mounted crosshair", () => {
    const container = _makeEl("container");
    _showAimCrosshair(container);
    assert.ok(document.getElementById("webxr-aim-crosshair"));

    cleanupWebXRFireModule();
    assert.strictEqual(document.getElementById("webxr-aim-crosshair"), null);
  });

  it("Branch A: Locking exit sign mounts real-time +/- zoom controls and scales placed mesh", () => {
    const container = _makeEl("container");
    let addedExitMesh = null;
    const mockController = {
      addToScene(m) {
        if (m.name === "exit-graphic") addedExitMesh = m;
      },
      removeFromScene() {},
      onFrame() {},
      offFrame() {},
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };

    startFireModuleWebXR(container, mockController, { reading: 1.7 });
    const overlay = document.getElementById("fire-module-overlay");

    _showEvacuateConfirmationWebXR(container, overlay, 1.7);
    assert.ok(addedExitMesh);

    // simulate tapping screen to lock the exit sign in place
    window.dispatchEvent(new CustomEvent("pointerdown", { detail: { clientX: 200, clientY: 300 } }));

    const zoomDiv = document.getElementById("safear-zoom-controls");
    assert.ok(zoomDiv, "Zoom controls must be mounted once exit sign is placed");
    const btnIn = document.getElementById("btn-zoom-in");
    const btnOut = document.getElementById("btn-zoom-out");
    assert.ok(btnIn, "Zoom In button must be present");
    assert.ok(btnOut, "Zoom Out button must be present");

    // Initial scale is 1.0
    assert.strictEqual(getExitSignScaleWebXR(), 1.0);

    // Tap zoom in
    btnIn.click();
    assert.strictEqual(Math.round(getExitSignScaleWebXR() * 10) / 10, 1.2);
    assert.strictEqual(Math.round(addedExitMesh.scale.x * 10) / 10, 1.2);

    // Tap zoom out twice
    btnOut.click();
    btnOut.click();
    assert.strictEqual(Math.round(getExitSignScaleWebXR() * 10) / 10, 0.8);
    assert.strictEqual(Math.round(addedExitMesh.scale.x * 10) / 10, 0.8);

    cleanupWebXRFireModule();
    assert.strictEqual(document.getElementById("safear-zoom-controls"), null);
    assert.strictEqual(getExitSignScaleWebXR(), 1.0);
  });

  it("Branch A: Exit sign rotates to align flush with detected wall angle in live preview", () => {
    const container = _makeEl("container");
    let addedExitMesh = null;
    let registeredFrameHandler = null;
    const mockHitPose = {
      transform: {
        position: { x: 0.8, y: 1.8, z: -2.0 },
        // normal rotated 90 deg around X
        orientation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }
      }
    };
    const mockFrame = {
      getHitTestResults() {
        return [{ getPose() { return mockHitPose; } }];
      }
    };
    const mockController = {
      hitTestSource: {},
      addToScene(m) {
        if (m.name === "exit-graphic") addedExitMesh = m;
      },
      removeFromScene() {},
      onFrame(fn) { registeredFrameHandler = fn; },
      offFrame() { registeredFrameHandler = null; },
      getCamera() { return { position: new MockVector3(0, 1.5, 0), quaternion: new MockQuaternion() }; }
    };

    startFireModuleWebXR(container, mockController, { reading: 1.7 });
    const overlay = document.getElementById("fire-module-overlay");

    _showEvacuateConfirmationWebXR(container, overlay, 1.7);
    assert.ok(addedExitMesh);
    assert.ok(registeredFrameHandler);

    // run frame handler to simulate camera scanning wall
    registeredFrameHandler({ frame: mockFrame, referenceSpace: {} });

    // exit mesh position set to hit pos
    assert.strictEqual(addedExitMesh.position.x, 0.8);
    assert.strictEqual(addedExitMesh.position.y, 1.8);
    assert.strictEqual(addedExitMesh.position.z, -2.0);

    // exit mesh lookAt called with pos + normal to sit flush with wall
    assert.ok(addedExitMesh._lookAtTarget);
    assert.strictEqual(addedExitMesh._lookAtTarget.x, 0.8);
    assert.strictEqual(addedExitMesh._lookAtTarget.y, 1.8);
    assert.strictEqual(Math.round(addedExitMesh._lookAtTarget.z), -1); // -2.0 + 1.0 = -1.0 (looking along outward wall normal)

    // locking placement switches from placement preview to walk tracking
    window.dispatchEvent(new CustomEvent("pointerdown", { detail: { clientX: 200, clientY: 300 } }));
    assert.ok(registeredFrameHandler);
    assert.ok(document.getElementById("exit-walk-feedback"));

    cleanupWebXRFireModule();
  });
});

