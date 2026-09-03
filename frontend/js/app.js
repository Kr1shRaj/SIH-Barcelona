import { createLogger } from "./logger.js";
import { detectDeviceCaps, selectArTier } from "../ar/tier.js";
import { initWebXRSession, loadModule3DScene } from "../ar/webxr.js";
import { initMarkerTracking, loadMarkerModuleScene } from "../ar/marker.js";
import { setTierLoaders, loadModule, unloadModule } from "./module-loader.js";
import { loadLocale } from "./i18n.js";
import {
  bindAssessmentSessionListeners,
  getEffectiveWorkerId,
  fetchModuleManifests,
  syncQueuedAttempts
} from "../assessment/engine.js";

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

  const tierMarkup = tierResult.tier === 1
    ? '<canvas id="xr-canvas" class="ar-canvas"></canvas>'
    : `<a-scene embedded arjs="sourceType: webcam; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3;" vr-mode-ui="enabled: false" renderer="logarithmicDepthBuffer: true;">
        <a-marker preset="hiro" id="hiro-marker">
          <a-box id="test-box" position="0 0.5 0" material="color: red; opacity: 0.8;"></a-box>
        </a-marker>
        <a-entity camera cursor="rayOrigin: mouse" raycaster="objects: .clickable, [data-raycast-target]"></a-entity>
      </a-scene>`;

  container.innerHTML = `
    <div id="ar-viewport" class="ar-viewport">
      ${tierMarkup}
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

  // bootstrap default and fallback locales and bind assessment listeners
  try {
    await Promise.allSettled([
      loadLocale("hi"),
      loadLocale("en")
    ]);
  } catch (err) {
    logger.warn({ event: "locale_bootstrap_error", error: err.message }, "Locale bootstrap warning");
  }

  bindAssessmentSessionListeners();
  const workerId = getEffectiveWorkerId();
  logger.info({ event: "worker_identified", workerId }, "Worker identity active");

  // prefetch and cache module manifests
  fetchModuleManifests().catch((err) => {
    logger.warn({ event: "manifest_prefetch_error", error: err.message }, "Manifest prefetch warning");
  });

  // initial sync attempt for offline records
  syncQueuedAttempts().catch(() => {});

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => {
      logger.info({ event: "network_online" }, "Device online, syncing queued attempts");
      syncQueuedAttempts().catch(() => {});
    });
  }

  // probe device hardware caps
  const caps = await detectDeviceCaps(window);
  const decision = selectArTier(caps, logger);

  if (decision.tier === 0) {
    renderUnsupportedView(appContainer, decision);
    return;
  }

  const { viewport, canvas, statusCard } = renderArShell(appContainer, decision);
  bindModuleLifecycleUI(statusCard);

  if (decision.tier === 1) {
    try {
      const sessionData = await initWebXRSession(canvas);
      // wire tier 1 loader so loadModule knows which path to call
      setTierLoaders(1, loadModule3DScene, sessionData.session);

      if (statusCard) {
        statusCard.innerHTML = `
          <h3>AR Tier 1 Active (WebXR)</h3>
          <p>Plane tracking ready. Pick a module to begin.</p>
          ${_scaffoldModuleButton()}
        `;
        _bindScaffoldButton(statusCard);
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
      // wire tier 2 loader so loadModule knows which path to call
      setTierLoaders(2, loadMarkerModuleScene, trackingState);

      if (statusCard) {
        statusCard.innerHTML = `
          <h3>AR Tier 2 Active (Hiro Marker)</h3>
          <p>Point camera at Hiro marker. Pick a module to begin.</p>
          ${_scaffoldModuleButton()}
        `;
        _bindScaffoldButton(statusCard);
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

// bind module lifecycle events to toggle status HUD visibility
function bindModuleLifecycleUI(statusCard) {
  if (typeof window === "undefined" || !statusCard) return;

  window.addEventListener("safear:module_loaded", () => {
    statusCard.style.display = "none";
  });

  window.addEventListener("safear:module_unloaded", () => {
    statusCard.style.display = "block";
  });
}

// SCAFFOLDING — remove when real module-selection UI exists
function _scaffoldModuleButton() {
  return `<div style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap;">
    <button id="scaffold-load-btn">[DEV] Fire Response</button>
    <button id="scaffold-gas-btn">[DEV] Gas Leak</button>
  </div>`;
}

// SCAFFOLDING — bind scaffold buttons to loadModule
function _bindScaffoldButton(container) {
  const btnFire = container.querySelector("#scaffold-load-btn");
  if (btnFire) {
    btnFire.addEventListener("click", async () => {
      try {
        await loadModule("fire-response");
      } catch (err) {
        logger.warn({ event: "scaffold_load_threw", error: err.message }, "Stub not implemented yet");
      }
    });
  }

  const btnGas = container.querySelector("#scaffold-gas-btn");
  if (btnGas) {
    btnGas.addEventListener("click", async () => {
      try {
        await loadModule("gas-leak");
      } catch (err) {
        logger.warn({ event: "scaffold_load_threw", error: err.message }, "Stub not implemented yet");
      }
    });
  }

  // expose unloadModule on window for manual dev testing
  if (typeof window !== "undefined") {
    window.__safear_unloadModule = unloadModule;
  }
}


if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}

export { initApp, renderUnsupportedView, renderArShell, bindModuleLifecycleUI };
