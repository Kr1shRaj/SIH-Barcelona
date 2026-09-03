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
class MockMeshBasicMaterial {}
class MockMesh {
  constructor(geo, mat) {
    this.geometry = geo;
    this.material = mat;
    this.matrix = { fromArray() {} };
    this.visible = true;
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
  }
}

const mockTHREE = {
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  RingGeometry: MockRingGeometry,
  MeshBasicMaterial: MockMeshBasicMaterial,
  Mesh: MockMesh,
  Scene: MockScene,
  PerspectiveCamera: MockCamera,
  WebGLRenderer: MockWebGLRenderer,
  AmbientLight: MockLight,
  DirectionalLight: MockLight,
  DoubleSide: 2
};

import {
  calcFireOffsetPosition,
  createPlacementReticle
} from "../ar/webxr_render.js";

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
});
