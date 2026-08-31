import { createLogger } from "./logger.js";
import { detectDeviceCaps, selectArTier } from "../ar/tier.js";
import { initWebXRSession, loadModule3DScene } from "../ar/webxr.js";
import { initMarkerTracking, loadMarkerModuleScene } from "../ar/marker.js";

const logger = createLogger("AppBoot");

// render unsupported screen when phone lack camera or webxr
function renderUnsupportedView(container, decision) {
  container.innerHTML = `
    <div class="unsupported-screen">
      <div class="unsupported-icon">⚠️</div>
      <div class="unsupported-title">Device Not Supported</div>
      <div class="unsupported-desc">
        SafeAR requires camera access and WebXR or marker tracking.
        <br><br>
        <strong>Reason:</strong> ${decision.reason || "Camera access unavailable"}
      </div>
      <button class="retry-btn" id="retry-btn">Retry Check</button>
    </div>
  `;

  if (typeof document !== "undefined") {
    const retryBtn = document.getElementById("retry-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      });
    }
  }
}

// render ar shell with tier badge and viewport container
function renderArShell(container, tierResult) {
  const tierClass = tierResult.tier === 1 ? "tier-1" : "tier-2";
  const tierLabel = tierResult.tier === 1 ? "Tier 1: WebXR" : "Tier 2: Marker (Hiro)";

  container.innerHTML = `
    <div id="ar-viewport" class="ar-viewport">
      <canvas id="xr-canvas" class="ar-canvas" style="display: ${tierResult.tier === 1 ? "block" : "none"}"></canvas>
    </div>
    <div class="ui-overlay">
      <header class="header-bar">
        <div class="app-title">🛡️ SafeAR</div>
        <span class="tier-badge ${tierClass}">${tierLabel}</span>
      </header>
      <div id="status-card" class="status-card">
        <h3>AR Mode Initializing</h3>
        <p>Checking module assets...</p>
      </div>
    </div>
  `;

  if (typeof document === "undefined") {
    return { viewport: null, canvas: null, statusCard: null };
  }

  return {
    viewport: document.getElementById("ar-viewport"),
    canvas: document.getElementById("xr-canvas"),
    statusCard: document.getElementById("status-card")
  };
}

// start mobile app and init audio and ar
async function initApp() {
  const appContainer = document.getElementById("app");
  if (!appContainer) {
    return;
  }

  // probe device hardware caps
  const caps = await detectDeviceCaps(window);
  const decision = selectArTier(caps, logger);

  if (decision.tier === 0) {
    renderUnsupportedView(appContainer, decision);
    return;
  }

  const { viewport, canvas, statusCard } = renderArShell(appContainer, decision);

  if (decision.tier === 1) {
    try {
      const sessionData = await initWebXRSession(canvas);

      // catch stub error while 3d module content is in development (scaffolding stage only)
      try {
        loadModule3DScene("fire-response", sessionData.session);
      } catch {
        if (statusCard) {
          statusCard.innerHTML = `
            <h3>AR Tier 1 Active (WebXR)</h3>
            <p>Module 3D content in development (Kaamil track). Plane tracking ready.</p>
          `;
        }
      }
    } catch (err) {
      logger.error({ event: "webxr_init_failed", error: err.message }, "WebXR setup failed");
      if (statusCard) {
        statusCard.innerHTML = `
          <h3>WebXR Failed</h3>
          <p>${err.message}</p>
        `;
      }
    }
  } else if (decision.tier === 2) {
    try {
      // use hiro preset placeholder until team picks final marker distribution
      const trackingState = await initMarkerTracking(viewport, {
        preset: "hiro",
        markerType: "pattern"
      });

      // catch stub error while 3d module content is in development (scaffolding stage only)
      try {
        loadMarkerModuleScene("fire-response", trackingState);
      } catch {
        if (statusCard) {
          statusCard.innerHTML = `
            <h3>AR Tier 2 Active (Hiro Marker)</h3>
            <p>Point camera at Hiro marker. Module 3D content in development (Kaamil track).</p>
          `;
        }
      }
    } catch (err) {
      logger.error({ event: "marker_init_failed", error: err.message }, "Marker tracking failed");
      if (statusCard) {
        statusCard.innerHTML = `
          <h3>Camera Error</h3>
          <p>${err.message}</p>
        `;
      }
    }
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}

export { initApp, renderUnsupportedView, renderArShell };
