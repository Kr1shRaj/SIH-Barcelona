import { createLogger } from "../js/logger.js";

const logger = createLogger("WebXR");

// load 3d assets into webxr space
function loadModule3DScene(_moduleId, _xrSession) {
  throw new Error("not implemented");
}

// setup webxr immersive ar session with hit test
async function initWebXRSession(canvasElement, options = {}) {
  if (!navigator.xr) {
    throw new Error("WebXR not available on this device");
  }

  const sessionOptions = {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["local-floor", "dom-overlay", "anchors"],
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

  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  logger.info({ event: "webxr_session_started", features: sessionOptions.requiredFeatures }, "WebXR session ready");

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
