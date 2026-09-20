import { describe, it, beforeEach, mock } from "node:test";
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
      if (m) return _elements[m[1]] || this.children.find((c) => c.id === m[1]) || null;
      return this.children.find((c) => c.tagName === sel.toLowerCase()) || null;
    },
    querySelectorAll(sel) {
      const m = sel.match(/^#(.+)$/);
      if (m) {
        const found = _elements[m[1]] || this.children.find((c) => c.id === m[1]);
        return found ? [found] : [];
      }
      return this.children.filter((c) => c.tagName === sel.toLowerCase());
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
  createElement(tag) {
    const el = _makeEl(null);
    el.tagName = (tag || "").toLowerCase();
    return el;
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
  cleanupGasLeakModule,
  evaluatePpeSelection,
  evaluateBuddyProcedure,
  CP_HAZARD_ZONE_ID,
  CP_PPE_SELECTION_ID,
  CP_BUDDY_PROCEDURE_ID,
  MANDATORY_PPE,
  CORRECT_BUDDY_PROCEDURE,
  HINT_TIMEOUT_MS
} from "../modules/gas-leak/gas-leak.js";

import {
  createHazardZoneThreeMesh,
  buildHazardZoneEntity,
  normalizeModelScale
} from "../modules/gas-leak/graphics.js";

import {
  getActiveSession
} from "../assessment/engine.js";

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

  it("startGasLeakModule begins in TEACH phase without registering checkpoints", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));

    const cps = getRegisteredCheckpoints();
    assert.strictEqual(cps.length, 0, "teach phase must not register checkpoints");
  });

  it("transitioning from teach phase to test phase registers step 1 (hazard zone recognition) checkpoint", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_HAZARD_ZONE_ID && c.type === "proximity"),
      "hazard zone checkpoint must register once test phase begins");
    assert.ok(!cps.some((c) => c.id === CP_PPE_SELECTION_ID), "ppe checkpoint must not register before step 1");
    assert.ok(!cps.some((c) => c.id === CP_BUDDY_PROCEDURE_ID), "buddy checkpoint must not register before step 2");
  });

  it("shows transition screen between teach phase and test phase", () => {
    startGasLeakModule(document.getElementById("ar-viewport"));
    // click through all 6 educational screens
    for (let i = 0; i < 6; i++) {
      const btn = _elements["btn-step-next"];
      assert.ok(btn, `screen ${i + 1} next button must exist`);
      delete _elements["btn-step-next"];
      btn.click();
    }
    // now transition screen should be displayed
    const transitionBtn = _elements["btn-step-next"];
    assert.ok(transitionBtn, "transition screen next button must exist");
    assert.strictEqual(transitionBtn.dataset.action, "start-test");
    assert.strictEqual(getRegisteredCheckpoints().length, 0, "no checkpoints before test phase starts");

    // clicking transition button starts test phase and registers step 1 checkpoint
    delete _elements["btn-step-next"];
    transitionBtn.click();

    const cps = getRegisteredCheckpoints();
    assert.ok(cps.some((c) => c.id === CP_HAZARD_ZONE_ID), "step 1 checkpoint registered after transition");
    assert.ok(document.getElementById("btn-hazard-found"), "hazard action button visible in test phase");
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
    assert.deepStrictEqual(events[0].context, { method: "button_confirm", measured: false });
    // the step now also carries the v2 observation the server grades
    assert.strictEqual(events[0].observation.kind, "spatial_alignment");

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

  it("restarting gas module after partial test resets session instead of reusing stale checkpoints", () => {
    // start module and complete step 1
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();

    const sessionBefore = getActiveSession();
    assert.ok(sessionBefore, "session must be active after step 1");
    assert.strictEqual(sessionBefore.checkpoints.length, 1);
    assert.strictEqual(sessionBefore.checkpoints[0].checkpointId, CP_HAZARD_ZONE_ID);

    // direct restart: trainee starts module again after partial test
    startGasLeakModule(document.getElementById("ar-viewport"));

    // previous stale session must be aborted
    const sessionAfterStart = getActiveSession();
    assert.strictEqual(sessionAfterStart, null, "stale session with prior checkpoints must be aborted on restart");

    // advance to step 1 and confirm fresh checkpoint recording
    clickThroughSubscreens();
    _elements["btn-hazard-found"]?.click();

    const sessionFresh = getActiveSession();
    assert.ok(sessionFresh, "new fresh session must be created for restarted run");
    assert.notStrictEqual(sessionFresh.attemptId, sessionBefore.attemptId, "new run must have new attemptId");
    assert.strictEqual(sessionFresh.checkpoints.length, 1);

    cleanupGasLeakModule();
  });

  it("tier 1 webxr renders and cleans up three.js meshes via controller", () => {
    const sceneObjects = [];
    const mockController = {
      session: {},
      addToScene(obj) { sceneObjects.push(obj); },
      removeFromScene(obj) {
        const idx = sceneObjects.indexOf(obj);
        if (idx !== -1) sceneObjects.splice(idx, 1);
      }
    };

    // mock minimal THREE
    window.THREE = {
      Group: class {
        constructor() { this.children = []; this.position = { set: () => {} }; }
        add(child) { this.children.push(child); }
      },
      RingGeometry: class { rotateX() {} },
      CylinderGeometry: class {},
      BoxGeometry: class {},
      TorusGeometry: class {},
      MeshBasicMaterial: class {},
      MeshStandardMaterial: class {},
      Mesh: class { constructor(g, m) { this.g = g; this.m = m; this.position = { set: () => {} }; } },
      DoubleSide: 2
    };

    startGasLeakModule(document.getElementById("ar-viewport"), { tier: 1, controller: mockController });
    clickThroughSubscreens();

    // in step 1, hazard three mesh should be added to controller scene
    assert.ok(sceneObjects.some((obj) => obj.name === "gas-hazard-graphic"), "hazard mesh added in tier 1");

    _elements["btn-hazard-found"]?.click();
    // in step 2, ppe three mesh should be added to controller scene
    assert.ok(sceneObjects.some((obj) => obj.name === "gas-ppe-graphic"), "ppe mesh added in tier 1");

    cleanupGasLeakModule();
    assert.strictEqual(sceneObjects.length, 0, "all tier 1 meshes cleaned up from scene");

    delete window.THREE;
  });

  it("locale files contain all required gas leak keys and navigation translations", async () => {
    const fs = await import("fs");
    const enPath = new URL("../locales/en.json", import.meta.url);
    const hiPath = new URL("../locales/hi.json", import.meta.url);
    const satPath = new URL("../locales/sat.json", import.meta.url);
    const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
    const hi = JSON.parse(fs.readFileSync(hiPath, "utf8"));
    const sat = JSON.parse(fs.readFileSync(satPath, "utf8"));

    const requiredKeys = [
      "teach_complete_badge", "test_ready_title", "test_ready_desc", "btn_start_test",
      "step1_next_2", "step2_next_2", "step3_next_2",
      "step1_action_badge", "step1_action_title", "step1_action_desc",
      "step2_action_badge", "step2_action_title", "step2_action_desc",
      "step3_action_badge", "step3_action_title", "step3_action_desc"
    ];

    [en, hi, sat].forEach((dict) => {
      assert.ok(dict.gas, "locale must have gas dictionary");
      requiredKeys.forEach((key) => {
        assert.ok(dict.gas[key], `missing key ${key} in locale`);
        assert.ok(dict.gas[key].length > 0, `empty key ${key} in locale`);
      });
    });

    assert.notStrictEqual(en.gas.step1_next_2, "Next: Confirm Hazard in AR ➜");
    assert.notStrictEqual(hi.gas.step1_next_2, "अगला: AR में खतरे की पुष्टि करें ➜");
    assert.notStrictEqual(sat.gas.step1_next_2, "ᱞᱟᱦᱟ: AR ᱨᱮ ᱵᱚᱛᱚᱨ ᱧᱮᱞ ᱢᱮ ➜");
  });

  it("AR content renders immediately in guided session (before test phase)", () => {
    const container = document.getElementById("ar-viewport");
    startGasLeakModule(container);

    // in guided step 1, hazard graphic entity should already be in the DOM
    assert.ok(
      document.getElementById("gas-hazard-graphic") !== null,
      "hazard AR graphic should render immediately at start of guided session"
    );

    // advance 2 subscreens to step 2 (PPE)
    const btn1 = document.getElementById("btn-step-next");
    btn1?.click();
    const btn2 = document.getElementById("btn-step-next");
    btn2?.click();

    // in guided step 2, PPE graphic entity should now be in the DOM
    assert.ok(
      document.getElementById("gas-ppe-graphic") !== null,
      "PPE AR graphic should render when reaching step 2 in guided session"
    );

    cleanupGasLeakModule();
  });

  it("tier 1 webxr derives mesh positions dynamically from placed transform and placement_confirmed", () => {
    const sceneObjects = [];
    let currentPlaced = null;
    const mockController = {
      session: {},
      addToScene(obj) { sceneObjects.push(obj); },
      removeFromScene(obj) {
        const idx = sceneObjects.indexOf(obj);
        if (idx !== -1) sceneObjects.splice(idx, 1);
      },
      getPlacedTransform() { return currentPlaced; }
    };

    let setX = null;
    let setY = null;
    let setZ = null;
    window.THREE = {
      Group: class {
        constructor() {
          this.children = [];
          this.position = {
            x: 0, y: 0, z: 0,
            set(x, y, z) {
              setX = x; setY = y; setZ = z;
              this.x = x; this.y = y; this.z = z;
            }
          };
        }
        add(child) { this.children.push(child); }
      },
      RingGeometry: class { rotateX() {} },
      CylinderGeometry: class {},
      BoxGeometry: class {},
      TorusGeometry: class {},
      MeshBasicMaterial: class {},
      MeshStandardMaterial: class {},
      Mesh: class {
        constructor() {
          this.position = { set() {} };
        }
      },
      DoubleSide: 2
    };

    // 1. Controller reports placement at (1.2, -0.4, -2.5) via getPlacedTransform
    currentPlaced = { position: { x: 1.2, y: -0.4, z: -2.5 } };
    startGasLeakModule(document.getElementById("ar-viewport"), { tier: 1, controller: mockController });

    assert.strictEqual(setX, 1.2, "hazard mesh X matches placed transform");
    assert.strictEqual(setY, -0.4, "hazard mesh Y matches placed transform");
    assert.strictEqual(setZ, -2.5, "hazard mesh Z matches placed transform");

    // 2. Dispatch safear:placement_confirmed event with new coordinates (2.0, -0.3, -1.8)
    window.dispatchEvent({
      type: "safear:placement_confirmed",
      detail: { position: { x: 2.0, y: -0.3, z: -1.8 } }
    });

    assert.strictEqual(setX, 2.0, "hazard mesh X updated from safear:placement_confirmed");
    assert.strictEqual(setY, -0.3, "hazard mesh Y updated from safear:placement_confirmed");
    assert.strictEqual(setZ, -1.8, "hazard mesh Z updated from safear:placement_confirmed");

    cleanupGasLeakModule();
    delete window.THREE;
  });

  it("primitive placeholders are removed once mocked .glb load resolves", () => {
    let loadCallbacks = [];

    window.THREE = {
      Group: class {
        constructor() {
          this.children = [];
          this.position = { set: () => {} };
        }
        add(child) {
          child.parent = this;
          this.children.push(child);
        }
        remove(child) {
          child.parent = null;
          const idx = this.children.indexOf(child);
          if (idx !== -1) this.children.splice(idx, 1);
        }
      },
      RingGeometry: class { rotateX() {} },
      CylinderGeometry: class {},
      MeshBasicMaterial: class {},
      MeshStandardMaterial: class {},
      Mesh: class {
        constructor(geo, mat) {
          this.geo = geo;
          this.mat = mat;
          this.position = { set: () => {} };
        }
      },
      GLTFLoader: class {
        load(url, onLoad) {
          loadCallbacks.push(onLoad);
        }
      },
      DoubleSide: 2
    };

    const group = createHazardZoneThreeMesh();
    // Initially contains ring and cylinder
    assert.strictEqual(group.children.length, 2, "initial group has 2 primitive meshes");
    const ringMesh = group.children[0];
    const cylMesh = group.children[1];
    assert.strictEqual(ringMesh.parent, group);
    assert.strictEqual(cylMesh.parent, group);

    // Trigger mock GLTF load resolution
    const mockModel = {
      position: { set: () => {} },
      scale: { set: () => {} }
    };
    loadCallbacks[0]({ scene: mockModel });

    // Primitives should be removed from group
    assert.strictEqual(ringMesh.parent, null, "ring mesh removed after GLB load");
    assert.strictEqual(cylMesh.parent, null, "cylinder mesh removed after GLB load");
    assert.ok(group.children.includes(mockModel), "loaded GLTF model added to group");

    delete window.THREE;
  });

  it("buildHazardZoneEntity creates entity and structure", () => {
    const el = buildHazardZoneEntity();
    assert.strictEqual(el.id, "gas-hazard-graphic");
    assert.ok(el.innerHTML.includes("caution_tapes.glb"));
    assert.ok(el.innerHTML.includes("a-ring"));
  });

  it("hint timer: no hint before threshold, hint shown after 15s, context records hintShown", () => {
    assert.strictEqual(HINT_TIMEOUT_MS, 15000);
    mock.timers.enable();

    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens(); // Advance through teach phase to test step 1

    // Step 1 test active: verify no hint element initially
    assert.strictEqual(document.getElementById("gas-step-hint"), null, "no hint before 15s");

    // Advance 14.9s: still no hint
    mock.timers.tick(14900);
    assert.strictEqual(document.getElementById("gas-step-hint"), null, "still no hint at 14.9s");

    // Advance remaining 100ms (reaches HINT_TIMEOUT_MS = 15000): hint appears
    mock.timers.tick(100);
    const hintEl = document.getElementById("gas-step-hint");
    assert.ok(hintEl !== null, "hint shown after 15s inactivity threshold");
    assert.match(hintEl.textContent, /Low oxygen/i, "hint contains hazard step rationale");

    // Confirm hazard zone: event context should record hintShown: true
    const events = collectCheckpointEvents(() => {
      document.getElementById("btn-hazard-found")?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].checkpointId, CP_HAZARD_ZONE_ID);
    assert.strictEqual(events[0].context.hintShown, true, "context must record hintShown: true");

    cleanupGasLeakModule();
    mock.timers.reset();
  });

  it("hint timer cleared immediately on fast checkpoint action and on cleanup", () => {
    mock.timers.enable();

    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens(); // Step 1 test

    // Fast action at 5s (well before 15s threshold)
    mock.timers.tick(5000);
    const events = collectCheckpointEvents(() => {
      document.getElementById("btn-hazard-found")?.click();
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].context.hintShown, undefined, "hintShown not set when action taken before threshold");

    // Advance past original 15s mark: ensure no stale timer fired
    mock.timers.tick(12000);

    // In Step 2 now: verify cleanup clears hint timer without firing
    startGasLeakModule(document.getElementById("ar-viewport"));
    clickThroughSubscreens();
    mock.timers.tick(5000);
    cleanupGasLeakModule();

    mock.timers.tick(20000);
    assert.strictEqual(document.getElementById("gas-step-hint"), null, "no hint after cleanup");

    mock.timers.reset();
  });

  it("normalizeModelScale scales model to target longest dimension from bounding box", () => {
    let scaledX = null;
    let scaledY = null;
    let scaledZ = null;
    const mockModel = {
      scale: {
        set(x, y, z) {
          scaledX = x; scaledY = y; scaledZ = z;
        }
      }
    };

    window.THREE = {
      Box3: class {
        setFromObject() { return this; }
        getSize(targetVec) {
          // Mock bounding box: dx=0.2, dy=1.0, dz=0.4 (longest dim = 1.0m)
          targetVec.x = 0.2;
          targetVec.y = 1.0;
          targetVec.z = 0.4;
          return targetVec;
        }
      },
      Vector3: class {
        constructor() { this.x = 0; this.y = 0; this.z = 0; }
      }
    };

    // Target longest dimension = 0.5m -> scale should be 0.5 / 1.0 = 0.5
    const scale = normalizeModelScale(mockModel, 0.5);
    assert.strictEqual(scale, 0.5, "scale should be target / maxDim");
    assert.strictEqual(scaledX, 0.5);
    assert.strictEqual(scaledY, 0.5);
    assert.strictEqual(scaledZ, 0.5);

    delete window.THREE;
  });
});

