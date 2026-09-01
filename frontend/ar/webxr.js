import { createLogger } from "../js/logger.js";

const logger = createLogger("WebXR");

// load 3d scene for named module — fire-response and gas-leak implemented, others throw
async function loadModule3DScene(moduleId, xrSession) {
  if (moduleId === "fire-response") {
    // overlay UI runs in dom; xrSession available for future hit-test anchoring
    const { startFireModule } = await import("../modules/fire-response/fire-response.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startFireModule(container, { tier: 1, xrSession });
    return;
  }
  if (moduleId === "gas-leak") {
    const { startGasLeakModule } = await import("../modules/gas-leak/gas-leak.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startGasLeakModule(container, { tier: 1, xrSession });
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
    optionalFeatures: ["hit-test", "local-floor", "dom-overlay", "anchors", "local"],
    ...options.sessionInit
  };

  const session = await navigator.xr.requestSession("immersive-ar", sessionOptions);

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

  logger.info({ event: "webxr_session_started", features: sessionOptions.optionalFeatures }, "WebXR session ready");

  return {
    session,
    gl,
    referenceSpace,
    hitTestSource,
    viewerSpace
  };
}

// run animation frame loop for webxr tracking
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
  loadModule3DScene
};
