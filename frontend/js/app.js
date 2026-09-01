import { createLogger } from "./logger.js";
import { detectDeviceCaps, selectArTier } from "../ar/tier.js";
import { initWebXRSession, loadModule3DScene } from "../ar/webxr.js";
import { initMarkerTracking, loadMarkerModuleScene } from "../ar/marker.js";
import { setTierLoaders, loadModule, unloadModule } from "./module-loader.js";

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

// boot tier 2 marker tracking flow
async function _bootTier2(container, decision) {
  const { viewport, statusCard } = renderArShell(container, decision);
  bindModuleLifecycleUI(statusCard);

  try {
    const trackingState = await initMarkerTracking(viewport, {
      preset: "hiro",
      markerType: "pattern"
    });
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

  if (decision.tier === 1) {
    const { canvas, statusCard } = renderArShell(appContainer, decision);
    bindModuleLifecycleUI(statusCard);

    if (statusCard) {
      statusCard.innerHTML = `
        <h3>AR Tier 1 Ready (WebXR)</h3>
        <p>Device supports WebXR. Tap to start AR session or switch to Hiro marker.</p>
        <div style="display:flex;gap:0.6rem;margin-top:0.8rem;flex-wrap:wrap;">
          <button id="btn-start-webxr" style="padding:0.65rem 1.1rem;background:#00e676;color:#000;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:0.95rem;">🚀 Start WebXR AR</button>
          <button id="btn-fallback-marker" style="padding:0.65rem 1.1rem;background:#334155;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:0.95rem;">📷 Use Hiro Marker (Tier 2)</button>
        </div>
      `;

      const btnFallbackMarker = statusCard.querySelector("#btn-fallback-marker");
      btnFallbackMarker?.addEventListener("click", () => {
        logger.info({ event: "user_selected_marker_mode" }, "User selected marker mode fallback");
        _bootTier2(appContainer, {
          tier: 2,
          mode: "marker",
          reason: "user_selected_marker_mode",
          caps
        });
      });

      const btnStartWebXR = statusCard.querySelector("#btn-start-webxr");
      btnStartWebXR?.addEventListener("click", async () => {
        try {
          btnStartWebXR.disabled = true;
          btnStartWebXR.textContent = "Starting WebXR Session...";
          const sessionData = await initWebXRSession(canvas);
          setTierLoaders(1, loadModule3DScene, sessionData.session);

          statusCard.innerHTML = `
            <h3>AR Tier 1 Active (WebXR)</h3>
            <p>Plane tracking ready. Pick a module to begin.</p>
            ${_scaffoldModuleButton()}
          `;
          _bindScaffoldButton(statusCard);
        } catch (err) {
          logger.warn({ event: "webxr_init_failed", error: err.message }, "WebXR session request failed, falling back to marker");
          statusCard.innerHTML = `
            <div style="background:rgba(15,23,42,0.92);padding:14px;border-radius:10px;border:1px solid #f59e0b;margin-bottom:16px;">
              <h3 style="color:#f59e0b;font-size:1rem;">WebXR Unavailable</h3>
              <p style="margin:4px 0 8px 0;font-size:0.85rem;color:#cbd5e1;">${err.message}</p>
              <p style="font-weight:bold;color:#10b981;font-size:0.9rem;">Switching to Tier 2 (Hiro Marker)...</p>
            </div>
          `;
          setTimeout(() => {
            _bootTier2(appContainer, {
              tier: 2,
              mode: "marker",
              reason: "webxr_session_not_supported_fallback",
              caps
            });
          }, 1200);
        }
      });
    }
  } else if (decision.tier === 2) {
    _bootTier2(appContainer, decision);
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
  return `<div style="display:flex;gap:0.6rem;margin-top:0.8rem;flex-wrap:wrap;width:100%;">
    <button id="scaffold-load-btn" style="flex:1;min-width:130px;padding:12px 14px;background:#ef4444;color:#fff;border:none;border-radius:10px;font-weight:bold;font-size:0.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 3px 10px rgba(0,0,0,0.6);">🔥 Fire Response</button>
    <button id="scaffold-gas-btn" style="flex:1;min-width:130px;padding:12px 14px;background:#f59e0b;color:#000;border:none;border-radius:10px;font-weight:bold;font-size:0.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 3px 10px rgba(0,0,0,0.6);">☣️ Gas Leak</button>
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
