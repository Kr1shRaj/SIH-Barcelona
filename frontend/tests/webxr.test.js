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
  DoubleSide: 2
};

import {
  calcFireOffsetPosition,
  createPlacementReticle,
  createPowderSprayMesh,
  animatePowderSpray,
  createExtinguisherMesh,
  createFireMesh,
  animateFireMesh
} from "../ar/webxr_render.js";

import {
  setZoomScaleWebXR,
  getZoomScaleWebXR
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

  it("createFireMesh barrel base rests flush on floor plane Y=0", () => {
    globalThis.window.THREE = mockTHREE;
    const mesh = createFireMesh();
    assert.ok(mesh);
    const barrel = mesh.getObjectByName("fire-barrel");
    assert.ok(barrel);
    // barrel cylinder is 0.84m high, centered at Y=0.42m -> barrel bottom is 0.42 - 0.42 = 0.00m flush
    assert.strictEqual(barrel.position.y, 0.42);
    const scorch = mesh.getObjectByName("floor-scorch-decal");
    assert.ok(scorch);
    assert.strictEqual(scorch.position.y, 0.01);
  });
});
