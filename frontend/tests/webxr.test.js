import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// minimal window and document stubs
const _windowListeners = {};
globalThis.window = {
  dispatchEvent(ev) {
    (_windowListeners[ev.type] || []).forEach((fn) => fn(ev));
  },
  addEventListener(type, fn) {
    if (!_windowListeners[type]) _windowListeners[type] = [];
    _windowListeners[type].push(fn);
  },
  removeEventListener(type, fn) {
    if (!_windowListeners[type]) return;
    _windowListeners[type] = _windowListeners[type].filter((f) => f !== fn);
  },
  THREE: null
};

globalThis.document = {
  getElementById() {
    return {
      appendChild() {},
      removeChild() {},
      remove() {},
      innerHTML: "",
      style: {}
    };
  },
  createElement() {
    return {
      style: {},
      appendChild() {},
      addEventListener() {},
      innerHTML: ""
    };
  }
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail || {};
  }
};

// mock THREE for testing pure 3d calculations
class MockVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  applyQuaternion(q) {
    // simplified mock: if q rotates 180 deg around Y, invert z
    if (q && q.y === 1) {
      this.z = -this.z;
    }
    return this;
  }
  normalize() {
    const len = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= len;
    this.y /= len;
    this.z /= len;
    return this;
  }
}

class MockQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
}

class MockRingGeometry {
  rotateX() {}
}
class MockConeGeometry {}
class MockCylinderGeometry {}
class MockSphereGeometry {}
class MockBoxGeometry {}
class MockTorusGeometry {}
class MockCircleGeometry {}
class MockDodecahedronGeometry {}
class MockMeshBasicMaterial {
  constructor(opt = {}) {
    this.color = {
      setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; }
    };
    this.opacity = opt.opacity ?? 1;
  }
  clone() { return new MockMeshBasicMaterial(); }
}
class MockMesh {
  constructor(geo, mat) {
    this.geometry = geo;
    this.material = mat || new MockMeshBasicMaterial();
    this.matrix = { fromArray() {} };
    this.visible = true;
    this.position = new MockVector3();
    this.rotation = new MockVector3();
    this.scale = new MockVector3(1, 1, 1);
    this.userData = {};
  }
}
class MockGroup {
  constructor() {
    this.children = [];
    this.position = new MockVector3();
    this.rotation = new MockVector3();
    this.scale = new MockVector3(1, 1, 1);
    this.visible = true;
    this.userData = {};
  }
  add(obj) { this.children.push(obj); }
  remove(obj) { this.children = this.children.filter(c => c !== obj); }
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
class MockScene {
  constructor() {
    this.children = [];
  }
  add(obj) { this.children.push(obj); }
  remove(obj) { this.children = this.children.filter(c => c !== obj); }
}
class MockCamera {
  constructor() {
    this.position = new MockVector3();
  }
}
class MockWebGLRenderer {
  constructor() {
    this.xr = {
      enabled: false,
      setReferenceSpaceType() {},
      setSession() {}
    };
    this.autoClear = true;
  }
  setAnimationLoop(cb) {
    this._loopCb = cb;
  }
  render() {}
}
class MockLight {
  constructor() {
    this.position = new MockVector3();
    this.intensity = 1;
  }
}

class MockBox3 {
  constructor(min, max) {
    this.min = min || new MockVector3(-0.5, 0.2, -0.5);
    this.max = max || new MockVector3(0.5, 2.2, 0.5);
  }
  setFromObject(obj) {
    if (obj && obj.userData && obj.userData.mockBounds) {
      this.min = obj.userData.mockBounds.min;
      this.max = obj.userData.mockBounds.max;
    }
    return this;
  }
  getSize(target) {
    target.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z);
    return target;
  }
}

class MockAnimationMixer {
  constructor(root) {
    this.root = root;
    this.actions = [];
    this.timeUpdated = 0;
  }
  clipAction(clip) {
    const action = {
      clip,
      playing: false,
      play() { this.playing = true; return this; }
    };
    this.actions.push(action);
    return action;
  }
  update(deltaSec) {
    this.timeUpdated += deltaSec;
  }
}

class MockGLTFLoader {
  load(url, onLoad) {
    const root = new MockGroup();
    root.name = "mock-scene";
    root.userData.mockBounds = {
      min: new MockVector3(-0.5, 0.2, -0.5),
      max: new MockVector3(0.5, 2.2, 0.5)
    };
    const gltf = {
      scene: root,
      animations: [{ name: "Animation" }]
    };
    if (onLoad) onLoad(gltf);
  }
}

const mockTHREE = {
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  RingGeometry: MockRingGeometry,
  ConeGeometry: MockConeGeometry,
  CylinderGeometry: MockCylinderGeometry,
  SphereGeometry: MockSphereGeometry,
  BoxGeometry: MockBoxGeometry,
  TorusGeometry: MockTorusGeometry,
  CircleGeometry: MockCircleGeometry,
  DodecahedronGeometry: MockDodecahedronGeometry,
  MeshBasicMaterial: MockMeshBasicMaterial,
  MeshStandardMaterial: MockMeshBasicMaterial,
  Mesh: MockMesh,
  Group: MockGroup,
  Scene: MockScene,
  PerspectiveCamera: MockCamera,
  WebGLRenderer: MockWebGLRenderer,
  AmbientLight: MockLight,
  DirectionalLight: MockLight,
  PointLight: MockLight,
  DoubleSide: 2,
  Box3: MockBox3,
  AnimationMixer: MockAnimationMixer,
  GLTFLoader: MockGLTFLoader
};

import {
  calcFireOffsetPosition,
  createPlacementReticle,
  createPowderSprayMesh,
  animatePowderSpray,
  createExtinguisherMesh,
  animateExtinguisherMesh,
  orientNozzleTowardTarget,
  createFireMesh,
  animateFireMesh,
  loadGLBModel,
  createExitSignMesh,
  animateExitSignMesh,
  createAlarmStationMesh,
  animateAlarmStationMesh
} from "../ar/webxr_render.js";

import {
  setZoomScaleWebXR,
  getZoomScaleWebXR,
  setExitSignScaleWebXR,
  getExitSignScaleWebXR,
  getMethaneReadingWebXR,
  setMethaneReadingWebXR,
  getActiveBranchWebXR,
  CP_DECISION_ID,
  DECISION_CHOICES,
  checkEvacuationPhysicalExit
} from "../modules/fire-response/webxr_fire_module.js";

import {
  WebXRPlacementController,
  PLACEMENT_STATES,
  endWebXRSession,
  loadModule3DScene
} from "../ar/webxr.js";

describe("WebXR Placement and Tracking", () => {
  beforeEach(() => {
    globalThis.window.THREE = null;
    for (const k of Object.keys(_windowListeners)) {
      delete _windowListeners[k];
    }
  });

  it("PLACEMENT_STATES has scanning, surface_found, placed", () => {
    assert.strictEqual(PLACEMENT_STATES.SCANNING, "scanning");
    assert.strictEqual(PLACEMENT_STATES.SURFACE_FOUND, "surface_found");
    assert.strictEqual(PLACEMENT_STATES.PLACED, "placed");
  });

  it("calcFireOffsetPosition returns null if THREE or position missing", () => {
    assert.strictEqual(calcFireOffsetPosition(null), null);
    globalThis.window.THREE = mockTHREE;
    assert.strictEqual(calcFireOffsetPosition(null), null);
  });

  it("calcFireOffsetPosition offsets fire 2 meters forward in default direction", () => {
    globalThis.window.THREE = mockTHREE;
    const placedPos = { x: 1, y: 0, z: -3 };
    const offset = calcFireOffsetPosition(placedPos, null);

    assert.ok(offset);
    assert.strictEqual(offset.x, 1);
    assert.strictEqual(offset.y, 0);
    // default forward is (0, 0, -1) -> 2m forward gives z: -5
    assert.strictEqual(offset.z, -5);
  });

  it("createPlacementReticle returns null when THREE not present", () => {
    globalThis.window.THREE = null;
    const reticle = createPlacementReticle();
    assert.strictEqual(reticle, null);
  });

  it("createPlacementReticle creates hidden mesh when THREE present", () => {
    globalThis.window.THREE = mockTHREE;
    const reticle = createPlacementReticle();
    assert.ok(reticle);
    assert.strictEqual(reticle.name, "placement-reticle");
    assert.strictEqual(reticle.visible, false);
  });

  it("WebXRPlacementController starts in scanning state", () => {
    globalThis.window.THREE = mockTHREE;
    const listeners = {};
    const mockSession = {
      addEventListener(type, fn) { listeners[type] = fn; },
      removeEventListener(type) { delete listeners[type]; },
      end: async () => {}
    };
    const mockCanvas = {};
    const mockGl = { canvas: mockCanvas };

    const controller = new WebXRPlacementController({
      session: mockSession,
      gl: mockGl,
      referenceSpace: {},
      hitTestSource: {},
      viewerSpace: {}
    });

    assert.strictEqual(controller.state, PLACEMENT_STATES.SCANNING);
    assert.strictEqual(controller.getPlacedTransform(), null);
  });

  it("WebXRPlacementController transitions scanning -> surface_found -> placed on hit and tap", () => {
    globalThis.window.THREE = mockTHREE;
    const sessionListeners = {};
    const mockSession = {
      addEventListener(type, fn) { sessionListeners[type] = fn; },
      removeEventListener(type) { delete sessionListeners[type]; },
      end: async () => {}
    };
    const mockCanvas = {};
    const mockGl = { canvas: mockCanvas };

    const controller = new WebXRPlacementController({
      session: mockSession,
      gl: mockGl,
      referenceSpace: {},
      hitTestSource: {},
      viewerSpace: {}
    });

    controller.start();

    // mock frame hit test returning surface pose
    const mockHitPose = {
      transform: {
        position: { x: 0.5, y: -0.8, z: -1.5 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,-0.8,-1.5,1]
      }
    };
    const mockFrame = {
      getViewerPose: () => ({
        transform: { orientation: { x: 0, y: 0, z: 0, w: 1 } }
      }),
      getHitTestResults: () => [{
        getPose: () => mockHitPose
      }]
    };

    // run animation frame loop iteration
    controller._renderer._loopCb(100, mockFrame);

    assert.strictEqual(controller.state, PLACEMENT_STATES.SURFACE_FOUND);

    // trigger tap / select event
    let eventDetail = null;
    globalThis.window.addEventListener("safear:placement_confirmed", (e) => {
      eventDetail = e.detail;
    });

    sessionListeners["select"]();

    assert.strictEqual(controller.state, PLACEMENT_STATES.PLACED);
    const placed = controller.getPlacedTransform();
    assert.ok(placed);
    assert.strictEqual(placed.position.x, 0.5);
    assert.strictEqual(placed.position.y, -0.8);
    assert.strictEqual(placed.position.z, -1.5);
    assert.ok(eventDetail);
    assert.strictEqual(eventDetail.position.x, 0.5);
  });

  it("WebXRPlacementController emits safear:webxr_session_lost when session ends unexpectedly", () => {
    globalThis.window.THREE = mockTHREE;
    const sessionListeners = {};
    const mockSession = {
      addEventListener(type, fn) { sessionListeners[type] = fn; },
      removeEventListener(type) { delete sessionListeners[type]; },
      end: async () => {}
    };
    const mockGl = { canvas: {} };

    const controller = new WebXRPlacementController({
      session: mockSession,
      gl: mockGl,
      referenceSpace: {},
      hitTestSource: null,
      viewerSpace: null
    });

    let sessionLost = false;
    globalThis.window.addEventListener("safear:webxr_session_lost", () => {
      sessionLost = true;
    });

    // trigger session end
    sessionListeners["end"]();
    assert.strictEqual(sessionLost, true);
    assert.strictEqual(controller._destroyed, true);
  });

  it("WebXRPlacementController.end() cleanly terminates session without emitting session_lost", async () => {
    globalThis.window.THREE = mockTHREE;
    const sessionListeners = {};
    let sessionEnded = false;
    const mockSession = {
      addEventListener(type, fn) { sessionListeners[type] = fn; },
      removeEventListener(type) { delete sessionListeners[type]; },
      end: async () => {
        sessionEnded = true;
        if (sessionListeners["end"]) sessionListeners["end"]();
      }
    };
    const mockGl = { canvas: {} };

    const controller = new WebXRPlacementController({
      session: mockSession,
      gl: mockGl,
      referenceSpace: {},
      hitTestSource: null,
      viewerSpace: null
    });

    let sessionLost = false;
    let cleanEnd = false;
    globalThis.window.addEventListener("safear:webxr_session_lost", () => {
      sessionLost = true;
    });
    globalThis.window.addEventListener("safear:webxr_session_ended", () => {
      cleanEnd = true;
    });

    await controller.end();
    assert.strictEqual(sessionEnded, true);
    assert.strictEqual(sessionLost, false);
    assert.strictEqual(cleanEnd, true);
    assert.strictEqual(controller._destroyed, true);
  });

  it("endWebXRSession safely ends session", async () => {
    let ended = false;
    const session = {
      end: async () => { ended = true; }
    };
    await endWebXRSession(session);
    assert.strictEqual(ended, true);

    // handles null without throwing
    await endWebXRSession(null);
  });

  it("loadModule3DScene loads fire-response and gas-leak, throws on unknown", async () => {
    const mockController = {
      session: { addEventListener() {} },
      onFrame() {},
      addToScene() {},
      removeFromScene() {}
    };

    // fire-response route
    await assert.doesNotReject(async () => {
      await loadModule3DScene("fire-response", mockController);
    });

    // gas-leak route
    await assert.doesNotReject(async () => {
      await loadModule3DScene("gas-leak", mockController);
    });

    // unknown throws not implemented
    await assert.rejects(async () => {
      await loadModule3DScene("unknown-module", mockController);
    }, /not implemented/);
  });

  it("confirmPlacement dispatches placement_confirmed even if called multiple times or already placed", () => {
    globalThis.window.THREE = mockTHREE;
    const mockSession = { addEventListener() {}, removeEventListener() {}, end: async () => {} };
    const controller = new WebXRPlacementController({
      session: mockSession,
      gl: { canvas: {} },
      referenceSpace: {},
      hitTestSource: {},
      viewerSpace: {}
    });

    const events = [];
    globalThis.window.addEventListener("safear:placement_confirmed", (e) => {
      events.push(e.detail);
    });

    // first placement
    controller.confirmPlacement({ x: 0.1, y: -0.5, z: -1.2 });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(controller.state, PLACEMENT_STATES.PLACED);

    // second confirmation (e.g. from explicit TAP TO PLACE button)
    controller.confirmPlacement();
    assert.strictEqual(events.length, 2, "must dispatch confirmed event on re-trigger");
    assert.strictEqual(events[1].position.x, 0.1);
  });

  it("createPowderSprayMesh creates spray cone and particles when THREE present", () => {
    globalThis.window.THREE = mockTHREE;
    const spray = createPowderSprayMesh();
    assert.notStrictEqual(spray, null);
    assert.strictEqual(spray.name, "powder-spray");
    assert.strictEqual(spray.visible, false);
    assert.ok(spray.userData.particles && spray.userData.particles.length >= 15);
  });

  it("animatePowderSpray toggles visibility and animates particles", () => {
    globalThis.window.THREE = mockTHREE;
    const spray = createPowderSprayMesh();
    animatePowderSpray(spray, true, 16);
    assert.strictEqual(spray.visible, true);
    animatePowderSpray(spray, false, 16);
    assert.strictEqual(spray.visible, false);
  });

  it("orientNozzleTowardTarget dynamically points nozzle and spray at fire base", () => {
    globalThis.window.THREE = mockTHREE;
    const extMesh = createExtinguisherMesh();
    assert.ok(extMesh);
    const nozzle = extMesh.getObjectByName("extinguisher-nozzle");
    assert.ok(nozzle);

    // simulate fire placed on floor in front of extinguisher
    const fireTarget = { x: 0, y: 0.12, z: -3.0 };
    orientNozzleTowardTarget(nozzle, extMesh, fireTarget);

    assert.ok(nozzle.userData.aimDirection);
    // target is lower than nozzle (y=0.12 vs y=1.02), so dirY is negative (pitching downward)
    assert.ok(nozzle.userData.aimDirection.y < 0, "Nozzle should tilt downward toward fire base");
    assert.ok(nozzle.userData.aimDirection.z < 0, "Nozzle should point forward along -Z toward fire");
    assert.ok(nozzle.userData.aimDirection.dist > 1.0, "Aim distance should be calculated");
    assert.ok(nozzle.rotation.x < 0, "Pitch angle should be negative (downward)");

    // test dynamic update via animateExtinguisherMesh
    extMesh.userData.targetWorldPos = { x: 0.5, y: 0.12, z: -2.5 };
    animateExtinguisherMesh(extMesh, 16, true);
    assert.ok(nozzle.userData.aimDirection);
    const spray = extMesh.getObjectByName("powder-spray");
    assert.strictEqual(spray.visible, true);
  });

  it("animateFireMesh reduces flames and hides them when extinguished", () => {
    globalThis.window.THREE = mockTHREE;
    const fireGroup = new mockTHREE.Group();
    const outer = new mockTHREE.Mesh();
    outer.name = "fire-outer-cone";
    const inner = new mockTHREE.Mesh();
    inner.name = "fire-inner-cone";
    const light = new mockTHREE.PointLight();
    light.name = "fire-light";
    fireGroup.add(outer);
    fireGroup.add(inner);
    fireGroup.add(light);

    // active fire
    fireGroup.userData.extinguishProgress = 0;
    animateFireMesh(fireGroup, 16);
    assert.strictEqual(outer.visible, true);
    assert.strictEqual(inner.visible, true);

    // 100% extinguished fire in dustbin
    fireGroup.userData.extinguishProgress = 1.0;
    animateFireMesh(fireGroup, 16);
    assert.strictEqual(outer.visible, false);
    assert.strictEqual(inner.visible, false);
    assert.strictEqual(light.intensity, 0);
  });

  it("setZoomScaleWebXR clamps zoom factor between 0.6 and 2.5", () => {
    assert.strictEqual(setZoomScaleWebXR(1.5), 1.5);
    assert.strictEqual(getZoomScaleWebXR(), 1.5);

    // clamped at lower bound
    assert.strictEqual(setZoomScaleWebXR(0.2), 0.6);
    assert.strictEqual(getZoomScaleWebXR(), 0.6);

    // clamped at upper bound
    assert.strictEqual(setZoomScaleWebXR(4.0), 2.5);
    assert.strictEqual(getZoomScaleWebXR(), 2.5);

    // reset
    setZoomScaleWebXR(1.0);
  });

  it("setExitSignScaleWebXR clamps zoom factor between 0.5 and 2.0", () => {
    assert.strictEqual(setExitSignScaleWebXR(1.5), 1.5);
    assert.strictEqual(getExitSignScaleWebXR(), 1.5);

    // clamped at lower bound
    assert.strictEqual(setExitSignScaleWebXR(0.2), 0.5);
    assert.strictEqual(getExitSignScaleWebXR(), 0.5);

    // clamped at upper bound
    assert.strictEqual(setExitSignScaleWebXR(3.5), 2.0);
    assert.strictEqual(getExitSignScaleWebXR(), 2.0);

    // reset
    setExitSignScaleWebXR(1.0);
    assert.strictEqual(getExitSignScaleWebXR(), 1.0);
  });

  it("checkEvacuationPhysicalExit computes horizontal distance and detects proximity/crossing", () => {
    const signPos = { x: 0, y: 1.8, z: -2.0 };
    const wallNormal = { x: 0, y: 0, z: 1 }; // wall facing +Z into room toward user

    // 1. Far away (2 meters)
    const far = checkEvacuationPhysicalExit({ x: 0, y: 1.5, z: 0 }, signPos, wallNormal);
    assert.strictEqual(far.distance, 2.0);
    assert.strictEqual(far.reached, false);
    assert.strictEqual(far.crossed, false);

    // 2. Approaching within proximity threshold (0.7m <= 0.8m)
    const close = checkEvacuationPhysicalExit({ x: 0, y: 1.5, z: -1.3 }, signPos, wallNormal);
    assert.strictEqual(Math.round(close.distance * 10) / 10, 0.7);
    assert.strictEqual(close.reached, true);
    assert.strictEqual(close.crossed, false);

    // 3. Crossing past the wall plane within doorway aperture (dz = -0.05m past sign, dx = 0.3m)
    const crossed = checkEvacuationPhysicalExit({ x: 0.3, y: 1.5, z: -2.05 }, signPos, wallNormal);
    assert.strictEqual(crossed.crossed, true);
    assert.strictEqual(crossed.reached, true);

    // 4. Past the wall plane but outside lateral door tolerance (dx = 2.5m > 1.2m)
    const outsideAperture = checkEvacuationPhysicalExit({ x: 2.5, y: 1.5, z: -2.05 }, signPos, wallNormal);
    assert.strictEqual(outsideAperture.crossed, false);
    assert.strictEqual(outsideAperture.reached, false);

    // 5. Default zero / missing inputs do not throw
    const empty = checkEvacuationPhysicalExit(null, null, null);
    assert.strictEqual(empty.distance, 0);
    assert.strictEqual(empty.reached, true); // at 0 distance <= 0.8m
  });

  it("createExtinguisherMesh base rests flush on floor plane Y=0", () => {
    globalThis.window.THREE = mockTHREE;
    const mesh = createExtinguisherMesh();
    assert.ok(mesh);
    const base = mesh.getObjectByName("ext-base");
    assert.ok(base);
    // base cylinder is 0.14m high, centered at Y=0.07m -> base bottom is 0.07 - 0.07 = 0.00m flush
    assert.strictEqual(base.position.y, 0.07);
    const body = mesh.getObjectByName("ext-body");
    assert.ok(body);
    // body cylinder rests on top of base at Y=0.14
    assert.strictEqual(body.position.y, 0.79);
  });

  it("createFireMesh scorch and flame cluster rest flush on floor plane Y=0 with no dustbin", () => {
    globalThis.window.THREE = mockTHREE;
    const mesh = createFireMesh();
    assert.ok(mesh);
    assert.strictEqual(mesh.getObjectByName("fire-barrel"), null, "Dustbin barrel must be completely removed");
    assert.strictEqual(mesh.getObjectByName("fire-barrel-rim"), null, "Barrel rim must be completely removed");
    assert.strictEqual(mesh.getObjectByName("fire-trash-heap"), null, "Trash heap must be completely removed");
    const scorch = mesh.getObjectByName("floor-scorch-decal");
    assert.ok(scorch);
    assert.strictEqual(scorch.position.y, 0.01);
    const targetBase = mesh.getObjectByName("fire-target-base");
    assert.ok(targetBase);
    assert.strictEqual(targetBase.position.y, 0.12);
  });

  it("getMethaneReadingWebXR and setMethaneReadingWebXR manage gas state", () => {
    setMethaneReadingWebXR(5.5);
    assert.strictEqual(getMethaneReadingWebXR(), 5.5);
    setMethaneReadingWebXR(2.1);
    assert.strictEqual(getMethaneReadingWebXR(), 2.1);

    assert.strictEqual(getActiveBranchWebXR(), null);
    assert.strictEqual(CP_DECISION_ID, "fire_explosion_decision");
    assert.strictEqual(DECISION_CHOICES.EVACUATE, "evacuate");
    assert.strictEqual(DECISION_CHOICES.EXTINGUISH, "extinguish");
    assert.strictEqual(DECISION_CHOICES.WAIT, "wait");
  });

  it("loadGLBModel rejects if THREE or GLTFLoader is missing", async () => {
    globalThis.window.THREE = null;
    await assert.rejects(async () => {
      await loadGLBModel("dummy.glb");
    }, /THREE or GLTFLoader not available/);

    globalThis.window.THREE = { ...mockTHREE, GLTFLoader: null };
    await assert.rejects(async () => {
      await loadGLBModel("dummy.glb");
    }, /THREE or GLTFLoader not available/);
  });

  it("loadGLBModel normalizes model pivot flush to floor Y=0 and centers horizontally", async () => {
    globalThis.window.THREE = mockTHREE;
    const { root, container, mixer } = await loadGLBModel("frontend/assets/models/fire_extinguisher.glb", {
      targetHeight: 1.75,
      flushFloor: true,
      centerHorizontal: true
    });

    assert.ok(container);
    assert.ok(root);
    assert.ok(mixer);
    assert.ok(root.position.y <= 0);
    assert.strictEqual(root.position.x, 0);
    assert.strictEqual(root.position.z, 0);
  });

  it("createExitSignMesh creates exit sign with fallback geometry and touch hit area", () => {
    globalThis.window.THREE = mockTHREE;
    const exitGroup = createExitSignMesh({ position: { x: 0, y: 1.4, z: -2.2 } });
    assert.ok(exitGroup);
    assert.strictEqual(exitGroup.name, "exit-graphic");
    assert.strictEqual(exitGroup.userData.raycastTarget, "exit");
    assert.strictEqual(exitGroup.position.y, 1.4);

    const hitArea = exitGroup.getObjectByName("exit-hit-area");
    assert.ok(hitArea);
    assert.strictEqual(hitArea.userData.raycastTarget, "exit");

    const fallback = exitGroup.getObjectByName("exit-sign-fallback");
    assert.ok(fallback);
  });

  it("animateExitSignMesh bobs exit sign Y position smoothly", () => {
    globalThis.window.THREE = mockTHREE;
    const exitGroup = createExitSignMesh({ position: { x: 0, y: 1.5, z: -2.0 } });
    animateExitSignMesh(exitGroup, 100);
    assert.notStrictEqual(exitGroup.position.y, 1.5);
  });

  it("createAlarmStationMesh creates pull station with hit box and pulsing ring", () => {
    globalThis.window.THREE = mockTHREE;
    const alarmGroup = createAlarmStationMesh({ position: { x: 0.8, y: 1.2, z: -1.5 } });
    assert.ok(alarmGroup);
    assert.strictEqual(alarmGroup.name, "fire-alarm-station");
    assert.strictEqual(alarmGroup.userData.raycastTarget, "alarm");

    const hit = alarmGroup.getObjectByName("alarm-hit-box");
    assert.ok(hit);
    assert.strictEqual(hit.userData.raycastTarget, "alarm");

    const ring = alarmGroup.getObjectByName("alarm-pulse-ring");
    assert.ok(ring);

    const fallback = alarmGroup.getObjectByName("alarm-box-fallback");
    assert.ok(fallback);
  });

  it("animateAlarmStationMesh pulses red ring scale and opacity", () => {
    globalThis.window.THREE = mockTHREE;
    const alarmGroup = createAlarmStationMesh();
    animateAlarmStationMesh(alarmGroup, 150);
    const ring = alarmGroup.getObjectByName("alarm-pulse-ring");
    assert.ok(ring);
    assert.notStrictEqual(ring.scale.x, 1.0);
  });

  it("createFireMesh includes fire-flames-group and updates animation mixers", () => {
    globalThis.window.THREE = mockTHREE;
    const mesh = createFireMesh();
    assert.ok(mesh);
    const flamesGroup = mesh.getObjectByName("fire-flames-group");
    assert.ok(flamesGroup);
    assert.strictEqual(flamesGroup.position.y, 0.00);
    assert.ok(Array.isArray(mesh.userData.mixers));
  });

  it("createFireMesh loads 5 varied GLB fire instances with distinct offsets and anim offsets", async () => {
    globalThis.window.THREE = mockTHREE;
    const mesh = createFireMesh();
    assert.ok(mesh);
    await new Promise((r) => setTimeout(r, 10));
    const flamesGroup = mesh.getObjectByName("fire-flames-group");
    assert.ok(flamesGroup);
    assert.strictEqual(flamesGroup.children.length, 5, "5 varied fire instances must be loaded into flames group");
    assert.strictEqual(mesh.userData.mixers.length, 5, "All 5 fire instances must have active animation mixers");
  });

  it("animateFireMesh advances animation mixers and scales flames group with extinguishProgress", () => {
    globalThis.window.THREE = mockTHREE;
    const fireGroup = new mockTHREE.Group();
    const flamesGroup = new mockTHREE.Group();
    flamesGroup.name = "fire-flames-group";
    fireGroup.add(flamesGroup);
    fireGroup.userData.flamesGroup = flamesGroup;

    const mockMixer = new MockAnimationMixer();
    fireGroup.userData.mixers = [mockMixer];

    // active fire
    fireGroup.userData.extinguishProgress = 0.5;
    animateFireMesh(fireGroup, 50);
    assert.strictEqual(mockMixer.timeUpdated, 0.05);
    assert.strictEqual(flamesGroup.visible, true);
    assert.strictEqual(flamesGroup.scale.x, 0.5);

    // extinguished fire
    fireGroup.userData.extinguishProgress = 1.0;
    animateFireMesh(fireGroup, 50);
    assert.strictEqual(flamesGroup.visible, false);
  });
});
