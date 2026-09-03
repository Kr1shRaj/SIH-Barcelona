import { createLogger } from "../js/logger.js";
import { t } from "../js/i18n.js";

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

// show camera permission modal with step-by-step unblock instructions
function _showCameraPermissionModal() {
  if (typeof document === "undefined") return;
  if (document.getElementById("camera-permission-modal")) return;

  const modal = document.createElement("div");
  modal.id = "camera-permission-modal";
  modal.innerHTML = `
    <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,0.96);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;color:#fff;">
      <div style="font-size:3.5rem;margin-bottom:12px;">📷 🚫</div>
      <h2 style="color:#ef4444;font-size:1.35rem;margin-bottom:8px;font-weight:700;">${t("marker.camera_denied", "Camera Permission Denied")}</h2>
      <p style="color:#cbd5e1;font-size:0.92rem;line-height:1.5;max-width:320px;margin-bottom:16px;">
        ${t("marker.camera_denied_desc", "SafeAR requires live camera access to detect the Hiro safety marker.")}
      </p>
      <div style="background:rgba(30,41,59,0.95);border:1.5px solid #475569;border-radius:12px;padding:16px;text-align:left;font-size:0.88rem;color:#f1f5f9;margin-bottom:20px;max-width:340px;box-shadow:0 4px 14px rgba(0,0,0,0.5);">
        <strong style="color:#f59e0b;">${t("marker.camera_how_to", "How to enable camera in Chrome:")}</strong>
        <ol style="margin-top:8px;padding-left:20px;line-height:1.7;">
          <li>${t("marker.camera_step1", "Tap the 🔒 lock / tune icon in the top-left address bar.")}</li>
          <li>${t("marker.camera_step2", "Tap Permissions ➔ Camera.")}</li>
          <li>${t("marker.camera_step3", "Select Allow.")}</li>
          <li>${t("marker.camera_step4", "Tap Reload & Enable below.")}</li>
        </ol>
      </div>
      <button id="btn-retry-permission" style="padding:14px 28px;background:#00e676;color:#000;border:none;border-radius:10px;font-weight:700;font-size:1rem;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(0,230,118,0.4);">
        ${t("marker.reload_enable", "🔄 Reload & Enable Camera")}
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  const btnRetry = modal.querySelector("#btn-retry-permission");
  if (btnRetry) {
    btnRetry.addEventListener("click", () => {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    });
  }
}

// setup aframe arjs marker tracking and hook markerFound/markerLost events
async function initMarkerTracking(containerElement, customConfig = {}) {
  const config = createDefaultMarkerConfig(customConfig);

  if (typeof document !== "undefined") {
    document.body.classList.add("ar-active");
    const appEl = document.getElementById("app");
    if (appEl) appEl.classList.add("ar-active");
  }

  // probe/prompt userMedia to trigger camera permission dialog if needed
  if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      logger.warn({ event: "camera_permission_error", error: err.name }, "Camera permission check failed");
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        _showCameraPermissionModal();
      }
      throw err;
    }
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

