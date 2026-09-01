import { createLogger } from "../js/logger.js";

const logger = createLogger("ARMarker");

// load marker scene for named module — only fire-response is implemented, others still throw
async function loadMarkerModuleScene(moduleId, trackingState) {
  if (moduleId === "fire-response") {
    // overlay UI anchors to document body; marker tracking handle available for future use
    const { startFireModule } = await import("../modules/fire-response/fire-response.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startFireModule(container, { tier: 2, trackingState });
    return;
  }
  throw new Error("not implemented");
}

// build default marker configuration object
function createDefaultMarkerConfig(overrides = {}) {
  return {
    markerType: "pattern",
    patternUrl: overrides.patternUrl || "./markers/default.patt",
    preset: overrides.preset || "hiro",
    minConfidence: overrides.minConfidence || 0.6,
    changeMatrixMode: "modelViewMatrix",
    cameraParametersUrl: overrides.cameraParametersUrl || "./data/camera_para.dat",
    detectionMode: overrides.detectionMode || "mono",
    ...overrides
  };
}

// setup ar js marker tracking on camera stream
async function initMarkerTracking(containerElement, customConfig = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Camera getUserMedia not supported");
  }

  const config = createDefaultMarkerConfig(customConfig);

  const videoElement = document.createElement("video");
  videoElement.setAttribute("autoplay", "");
  videoElement.setAttribute("muted", "");
  videoElement.setAttribute("playsinline", "");
  videoElement.style.position = "absolute";
  videoElement.style.top = "0";
  videoElement.style.left = "0";
  videoElement.style.width = "100%";
  videoElement.style.height = "100%";
  videoElement.style.objectFit = "cover";
  videoElement.style.zIndex = "-1";

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  videoElement.srcObject = stream;
  await videoElement.play();

  if (containerElement) {
    containerElement.appendChild(videoElement);
  }

  const trackingState = {
    isTracking: true,
    markerVisible: false,
    config,
    videoElement,
    mediaStream: stream
  };

  logger.info({
    event: "marker_tracking_initialized",
    markerType: config.markerType,
    preset: config.preset
  }, "Marker tracking started");

  return trackingState;
}

// stop camera and destroy marker tracking loop
function stopMarkerTracking(trackingState) {
  if (!trackingState) {
    return;
  }

  if (trackingState.mediaStream) {
    const tracks = trackingState.mediaStream.getTracks();
    tracks.forEach((track) => track.stop());
  }

  if (trackingState.videoElement && trackingState.videoElement.parentNode) {
    trackingState.videoElement.parentNode.removeChild(trackingState.videoElement);
  }

  trackingState.isTracking = false;
  logger.info({ event: "marker_tracking_stopped" }, "Marker tracking stopped");
}

export {
  createDefaultMarkerConfig,
  initMarkerTracking,
  stopMarkerTracking,
  loadMarkerModuleScene
};
