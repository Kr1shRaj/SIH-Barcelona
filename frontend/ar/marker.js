import { createLogger } from "../js/logger.js";

const logger = createLogger("ARMarker");

// load marker scene for named module — fire-response and gas-leak implemented, others throw
async function loadMarkerModuleScene(moduleId, trackingState) {
  if (moduleId === "fire-response") {
    // overlay UI anchors to document body; marker tracking handle available for future use
    const { startFireModule } = await import("../modules/fire-response/fire-response.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startFireModule(container, { tier: 2, trackingState });
    return;
  }
  if (moduleId === "gas-leak") {
    const { startGasLeakModule } = await import("../modules/gas-leak/gas-leak.js");
    const container = typeof document !== "undefined" ? document.getElementById("ar-viewport") : null;
    startGasLeakModule(container, { tier: 2, trackingState });
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
    ...overrides
  };
}

// setup aframe arjs marker tracking and hook markerFound/markerLost events
async function initMarkerTracking(containerElement, customConfig = {}) {
  const config = createDefaultMarkerConfig(customConfig);

  if (typeof document !== "undefined") {
    document.body.classList.add("ar-active");
    const appEl = document.getElementById("app");
    if (appEl) appEl.classList.add("ar-active");
  }

  // locate a-scene and a-marker inside container if present
  const sceneElement = containerElement && typeof containerElement.querySelector === "function"
    ? containerElement.querySelector("a-scene")
    : null;
  const markerElement = sceneElement && typeof sceneElement.querySelector === "function"
    ? sceneElement.querySelector("a-marker")
    : null;

  const trackingState = {
    isTracking: true,
    markerVisible: false,
    config,
    sceneElement,
    markerElement,
    _listeners: []
  };

  if (markerElement && typeof markerElement.addEventListener === "function") {
    const onFound = () => {
      trackingState.markerVisible = true;
      logger.info({ event: "marker_found", preset: config.preset }, "Hiro marker detected");
    };
    const onLost = () => {
      trackingState.markerVisible = false;
      logger.info({ event: "marker_lost", preset: config.preset }, "Hiro marker lost");
    };

    markerElement.addEventListener("markerFound", onFound);
    markerElement.addEventListener("markerLost", onLost);

    trackingState._listeners.push(
      { el: markerElement, ev: "markerFound", fn: onFound },
      { el: markerElement, ev: "markerLost", fn: onLost }
    );
  }

  logger.info({
    event: "marker_tracking_initialized",
    markerType: config.markerType,
    preset: config.preset
  }, "A-Frame AR.js marker tracking initialized");

  return trackingState;
}

// stop marker tracking and unbind marker events
function stopMarkerTracking(trackingState) {
  if (!trackingState) {
    return;
  }

  if (trackingState._listeners && trackingState._listeners.length > 0) {
    trackingState._listeners.forEach(({ el, ev, fn }) => {
      if (el && typeof el.removeEventListener === "function") {
        el.removeEventListener(ev, fn);
      }
    });
    trackingState._listeners = [];
  }

  trackingState.isTracking = false;
  trackingState.markerVisible = false;
  logger.info({ event: "marker_tracking_stopped" }, "Marker tracking stopped");
}

export {
  createDefaultMarkerConfig,
  initMarkerTracking,
  stopMarkerTracking,
  loadMarkerModuleScene
};

