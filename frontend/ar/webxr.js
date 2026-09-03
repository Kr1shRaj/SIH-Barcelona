import { createLogger } from "../js/logger.js";
import { createPlacementReticle } from "./webxr_render.js";

const logger = createLogger("WebXR");

// placement state machine: scanning -> surface_found -> placed
const PLACEMENT_STATES = {
  SCANNING: "scanning",
  SURFACE_FOUND: "surface_found",
  PLACED: "placed"
};

// load 3d scene for named module — routes to webxr fire module for tier 1
async function loadModule3DScene(moduleId, controller) {
  if (moduleId === "fire-response") {
    const { startFireModuleWebXR } = await import("../modules/fire-response/webxr_fire_module.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startFireModuleWebXR(container, controller);
    return;
  }
  if (moduleId === "gas-leak") {
    const { startGasLeakModule } = await import("../modules/gas-leak/gas-leak.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startGasLeakModule(container, { tier: 1, xrSession: controller && controller.session });
    return;
  }
  throw new Error("not implemented");
}

// setup webxr immersive ar session with hit test
async function initWebXRSession(canvasElement, options = {}) {
  if (!navigator.xr) {
    throw new Error("WebXR not available on this device");
  }

  const sessionOptions = {
    requiredFeatures: ["hit-test", "local-floor"],
    optionalFeatures: ["dom-overlay", "anchors"],
    domOverlay: typeof document !== "undefined" && document.body ? { root: document.body } : undefined,
    ...options.sessionInit
  };

  let session;
  try {
    session = await navigator.xr.requestSession("immersive-ar", sessionOptions);
  } catch (err) {
    logger.warn({
      event: "webxr_request_session_failed",
      errorName: err.name || "Error",
      errorMessage: err.message,
      sessionOptions
    }, "navigator.xr.requestSession rejected");
    throw err;
  }

  const gl = canvasElement.getContext("webgl", { xrCompatible: true });
  if (!gl) {
    await session.end();
    throw new Error("WebGL context creation failed");
  }

  await session.updateRenderState({
    baseLayer: new window.XRWebGLLayer(session, gl)
  });

  const referenceSpace = await session.requestReferenceSpace("local-floor").catch(async () => {
    return await session.requestReferenceSpace("local");
  });

  let viewerSpace = null;
  let hitTestSource = null;
  try {
    viewerSpace = await session.requestReferenceSpace("viewer");
    if (typeof session.requestHitTestSource === "function") {
      hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    }
  } catch {
    hitTestSource = null;
  }

  logger.info({ event: "webxr_session_started", hasHitTest: !!hitTestSource }, "WebXR session ready");

  return {
    session,
    gl,
    referenceSpace,
    hitTestSource,
    viewerSpace
  };
}

// controller that manages placement lifecycle and three.js rendering
class WebXRPlacementController {
  constructor(sessionData) {
    this.session = sessionData.session;
    this.gl = sessionData.gl;
    this.referenceSpace = sessionData.referenceSpace;
    this.hitTestSource = sessionData.hitTestSource;
    this.viewerSpace = sessionData.viewerSpace;

    this.state = PLACEMENT_STATES.SCANNING;
    this._placedTransform = null;
    this._placedQuaternion = null;
    this._viewerQuaternionAtPlacement = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._reticle = null;
    this._frameCallbacks = [];
    this._lastTime = 0;
    this._animationHandle = null;
    this._destroyed = false;

    this._initThreeJS();
    this._bindSelectEvent();
    this._bindSessionEnd();
  }

  // wire up three.js scene/camera/renderer to webgl context
  _initThreeJS() {
    const THREE = typeof window !== "undefined" && window.THREE;
    if (!THREE) {
      logger.warn({ event: "three_not_available" }, "THREE.js not found on window");
      return;
    }

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(70, 1, 0.01, 100);

    this._renderer = new THREE.WebGLRenderer({
      canvas: this.gl.canvas,
      context: this.gl,
      antialias: true,
      alpha: true
    });
    this._renderer.autoClear = false;
    this._renderer.xr.enabled = true;
    this._renderer.xr.setReferenceSpaceType("local-floor");
    this._renderer.xr.setSession(this.session);

    // ambient + directional light so meshes are visible
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    this._scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(1, 4, 2);
    this._scene.add(directional);

    // placement reticle
    this._reticle = createPlacementReticle();
    if (this._reticle) {
      this._scene.add(this._reticle);
    }
  }

  // listen for screen tap to place object
  _bindSelectEvent() {
    if (!this.session) return;
    this._onSelect = () => {
      if (this.state === PLACEMENT_STATES.SURFACE_FOUND && this._lastHitPose) {
        this._placedTransform = {
          x: this._lastHitPose.transform.position.x,
          y: this._lastHitPose.transform.position.y,
          z: this._lastHitPose.transform.position.z
        };
        this._placedQuaternion = {
          x: this._lastHitPose.transform.orientation.x,
          y: this._lastHitPose.transform.orientation.y,
          z: this._lastHitPose.transform.orientation.z,
          w: this._lastHitPose.transform.orientation.w
        };
        // capture viewer facing direction at placement time for fire offset
        if (this._lastViewerPose) {
          this._viewerQuaternionAtPlacement = {
            x: this._lastViewerPose.transform.orientation.x,
            y: this._lastViewerPose.transform.orientation.y,
            z: this._lastViewerPose.transform.orientation.z,
            w: this._lastViewerPose.transform.orientation.w
          };
        }
        this.state = PLACEMENT_STATES.PLACED;
        if (this._reticle) this._reticle.visible = false;
        logger.info({
          event: "webxr_object_placed",
          position: this._placedTransform
        }, "Object placed on surface");

        // emit event for modules
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("safear:placement_confirmed", {
            detail: {
              position: this._placedTransform,
              quaternion: this._placedQuaternion,
              viewerQuaternion: this._viewerQuaternionAtPlacement
            }
          }));
        }
      }
    };
    this.session.addEventListener("select", this._onSelect);
  }

  // handle unexpected session termination
  _bindSessionEnd() {
    if (!this.session) return;
    this._onEnd = () => {
      this._destroyed = true;
      logger.warn({ event: "webxr_session_ended_unexpectedly" }, "XR session ended");
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("safear:webxr_session_lost"));
      }
    };
    this.session.addEventListener("end", this._onEnd);
  }

  // get the placed world position or null if not yet placed
  getPlacedTransform() {
    if (this.state !== PLACEMENT_STATES.PLACED) return null;
    return {
      position: { ...this._placedTransform },
      quaternion: this._placedQuaternion ? { ...this._placedQuaternion } : null,
      viewerQuaternion: this._viewerQuaternionAtPlacement ? { ...this._viewerQuaternionAtPlacement } : null
    };
  }

  // register callback for each xr frame (modules use this for interaction)
  onFrame(callback) {
    if (typeof callback === "function") {
      this._frameCallbacks.push(callback);
    }
  }

  // remove a frame callback
  offFrame(callback) {
    this._frameCallbacks = this._frameCallbacks.filter(cb => cb !== callback);
  }

  // add three.js object to scene
  addToScene(obj) {
    if (this._scene && obj) this._scene.add(obj);
  }

  // remove three.js object from scene
  removeFromScene(obj) {
    if (this._scene && obj) this._scene.remove(obj);
  }

  // get three.js scene for direct access
  getScene() { return this._scene; }

  // get three.js camera
  getCamera() { return this._camera; }

  // start the xr frame loop
  start() {
    if (!this.session || !this._renderer) return;

    this._renderer.setAnimationLoop((time, frame) => {
      if (this._destroyed || !frame) return;

      const pose = frame.getViewerPose(this.referenceSpace);
      if (!pose) return;

      this._lastViewerPose = pose;
      const deltaMs = this._lastTime ? (time - this._lastTime) : 16;
      this._lastTime = time;

      // hit test for surface detection (only when scanning)
      if (this.state !== PLACEMENT_STATES.PLACED && this.hitTestSource) {
        const hitResults = frame.getHitTestResults(this.hitTestSource);
        if (hitResults.length > 0) {
          const hit = hitResults[0];
          const hitPose = hit.getPose(this.referenceSpace);
          if (hitPose) {
            this._lastHitPose = hitPose;
            if (this.state === PLACEMENT_STATES.SCANNING) {
              this.state = PLACEMENT_STATES.SURFACE_FOUND;
            }
            // update reticle position
            if (this._reticle) {
              this._reticle.visible = true;
              this._reticle.matrix.fromArray(hitPose.transform.matrix);
            }
          }
        } else {
          if (this._reticle) this._reticle.visible = false;
          if (this.state === PLACEMENT_STATES.SURFACE_FOUND) {
            this.state = PLACEMENT_STATES.SCANNING;
          }
        }
      }

      // fire registered frame callbacks
      for (const cb of this._frameCallbacks) {
        try {
          cb({ time, frame, pose, deltaMs, referenceSpace: this.referenceSpace });
        } catch (err) {
          logger.error({ event: "frame_cb_error", error: err.message }, "Frame callback threw");
        }
      }

      // render three.js scene
      if (this._renderer && this._scene && this._camera) {
        this._renderer.render(this._scene, this._camera);
      }
    });
  }

  // clean shutdown
  async destroy() {
    this._destroyed = true;
    this._frameCallbacks = [];
    if (this._renderer) {
      this._renderer.setAnimationLoop(null);
    }
    if (this.session) {
      this.session.removeEventListener("select", this._onSelect);
      this.session.removeEventListener("end", this._onEnd);
      try {
        await this.session.end();
      } catch {
        // session may already be ended
      }
    }
    logger.info({ event: "webxr_controller_destroyed" }, "Placement controller cleaned up");
  }
}

// run animation frame loop for webxr tracking (legacy, kept for backward compat)
function startWebXRFrameLoop(sessionData, onFrameCallback) {
  const { session, referenceSpace, hitTestSource } = sessionData;

  function onXRFrame(time, frame) {
    const xrSession = frame.session;
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(referenceSpace);
    if (!pose) {
      return;
    }

    const hitTestResults = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];

    if (typeof onFrameCallback === "function") {
      onFrameCallback({
        time,
        frame,
        pose,
        hitTestResults,
        referenceSpace
      });
    }
  }

  const animationHandle = session.requestAnimationFrame(onXRFrame);
  return animationHandle;
}

// stop webxr session and free camera
async function endWebXRSession(session) {
  if (session) {
    await session.end();
    logger.info({ event: "webxr_session_ended" }, "WebXR session terminated");
  }
}

export {
  initWebXRSession,
  startWebXRFrameLoop,
  endWebXRSession,
  loadModule3DScene,
  WebXRPlacementController,
  PLACEMENT_STATES
};
