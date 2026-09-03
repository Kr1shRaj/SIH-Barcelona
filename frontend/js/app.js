import { createLogger } from "./logger.js";
import { detectDeviceCaps, selectArTier } from "../ar/tier.js";
import { initWebXRSession, loadModule3DScene, WebXRPlacementController } from "../ar/webxr.js";
import { initMarkerTracking, loadMarkerModuleScene } from "../ar/marker.js";
import { setTierLoaders, loadModule, unloadModule } from "./module-loader.js";

const logger = createLogger("AppBoot");

// format diagnostic text for webxr failure reasons
function buildWebXRDiagnosticMessage(decision) {
  if (!decision || typeof decision !== "object") return "";

  // Case B: runtime requestSession failure caught by handleWebXRFallback
  if (decision.reason === "webxr_failed_fallback_to_marker") {
    const name = decision.errorName || "Error";
    const msg = decision.errorMessage || decision.originalError || "session request rejected";
    return `WebXR session rejected: ${name} - ${msg}`;
  }

  // Case A: selectArTier pre-check decided Tier 1 not supported
  if (decision.tier === 2 && decision.caps) {
    const caps = decision.caps;
    if (caps.forcedTier === 2) {
      return "WebXR check: Tier 2 forced by URL override (?tier=2 or ?mode=marker)";
    }

    const failedChecks = [];
    if (!caps.isSecureContext) {
      failedChecks.push("isSecureContext=false (insecure context — WebXR requires HTTPS or localhost)");
    }
    if (!caps.hasWebXR) {
      failedChecks.push("navigator.xr missing (WebXR API not available in browser)");
    }
    if (caps.hasWebXR && !caps.supportsImmersiveAr) {
      const errNote = caps.sessionSupportedError ? ` error: ${caps.sessionSupportedError}` : "";
      failedChecks.push(`isSessionSupported('immersive-ar')=false${errNote}`);
    }
    if (!caps.hasGetUserMedia) {
      failedChecks.push("camera getUserMedia missing (camera permission blocked)");
    }

    const reasonSummary = failedChecks.length > 0
      ? failedChecks.join(" | ")
      : (decision.reason || "unknown_precheck_failure");

    return `WebXR check: ${reasonSummary} [secureContext=${caps.isSecureContext}, navigator.xr=${caps.hasWebXR}, immersive-ar=${caps.supportsImmersiveAr}, camera=${caps.hasGetUserMedia}]`;
  }

  if (decision.tier === 0) {
    return `WebXR check: ${decision.reason || "unsupported_device"}`;
  }

  return "";
}

// render unsupported screen when phone lack camera or webxr
function renderUnsupportedView(container, decision) {
  const diagMessage = buildWebXRDiagnosticMessage(decision);
  const diagNotice = diagMessage
    ? `<div style="background:rgba(185,28,28,0.35);border:1.5px solid #ef4444;border-radius:8px;padding:8px 12px;margin-top:12px;font-family:monospace;font-size:0.82rem;color:#fecaca;word-break:break-word;text-align:left;">
        <strong style="color:#fef08a;">[TEMPORARY DIAGNOSTIC]</strong><br>${diagMessage}
       </div>`
    : "";

  container.innerHTML = `
    <div class="unsupported-screen">
      <div class="unsupported-icon">⚠️</div>
      <div class="unsupported-title">Device Not Supported</div>
      <div class="unsupported-desc">
        SafeAR requires camera access and WebXR or marker tracking.
        <br><br>
        <strong>Reason:</strong> ${decision.reason || "Camera access unavailable"}
        ${diagNotice}
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

  // temporary diagnostic banner showing real webxr failure reason for tab a8 testing
  const diagMessage = buildWebXRDiagnosticMessage(tierResult);
  const diagBanner = diagMessage
    ? `<div id="webxr-diag-banner" style="background:#b91c1c;color:#ffffff;padding:10px 14px;margin-top:6px;border-radius:8px;font-size:0.82rem;font-family:monospace;line-height:1.4;border:2px solid #ef4444;word-break:break-word;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,0.9);z-index:9999;">
        <div style="font-weight:bold;color:#fef08a;margin-bottom:2px;font-size:0.75rem;letter-spacing:0.5px;">[TEMPORARY DIAGNOSTIC — WEBXR FAILURE REASON]</div>
        <div>${diagMessage}</div>
       </div>`
    : "";

  const tierMarkup = tierResult.tier === 1
    ? '<canvas id="xr-canvas" class="ar-canvas"></canvas>'
    : `<a-scene embedded arjs="sourceType: webcam; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3;" vr-mode-ui="enabled: false" renderer="logarithmicDepthBuffer: true;">
        <a-marker preset="hiro" id="hiro-marker"></a-marker>
        <a-marker preset="kanji" id="kanji-marker"></a-marker>
        <a-light type="ambient" color="#ffffff" intensity="1.2"></a-light>
        <a-light type="directional" position="1 4 2" intensity="1.0"></a-light>
        <a-entity id="main-camera" camera cursor="rayOrigin: mouse" raycaster="objects: .clickable, [data-raycast-target]">
          <a-entity id="gaze-laser" raycaster="objects: .aim-target, [data-raycast-target='aim'], #aim-reticle; showLine: true; far: 30; lineColor: #00e5ff; lineOpacity: 0.85;" position="0 0 0" rotation="0 0 0">
            <a-ring id="gaze-dot" position="0 0 -1" radius-inner="0.008" radius-outer="0.016" material="color: #00e5ff; shader: flat; opacity: 0.9; side: double"></a-ring>
            <a-circle position="0 0 -1" radius="0.003" material="color: #ffffff; shader: flat; opacity: 0.95"></a-circle>
          </a-entity>
        </a-entity>
      </a-scene>`;

  container.innerHTML = `
    <div id="ar-viewport" class="ar-viewport">
      ${tierMarkup}
    </div>
    <div class="ui-overlay">
      <div style="width:100%;display:flex;flex-direction:column;pointer-events:none;">
        <header class="header-bar">
          <div class="app-title">🛡️ SafeAR</div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
            <span class="tier-badge ${tierClass}">${tierLabel}</span>
          </div>
        </header>
        ${diagBanner}
      </div>
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
async function bootTier2(container, decision) {
  const { viewport, statusCard } = renderArShell(container, decision);
  bindModuleLifecycleUI(statusCard);

  try {
    const trackingState = await initMarkerTracking(viewport, {
      preset: "hiro",
      markerType: "pattern"
    });
    setTierLoaders(2, loadMarkerModuleScene, trackingState);

    if (statusCard) {
      // temporary diagnostic output for real webxr failure reason
      const diagMessage = buildWebXRDiagnosticMessage(decision);
      const diagNotice = diagMessage
        ? `<div id="status-card-diag" style="background:rgba(185,28,28,0.35);border:1.5px solid #ef4444;border-radius:8px;padding:8px 12px;margin:8px 0;font-family:monospace;font-size:0.82rem;color:#fecaca;word-break:break-word;line-height:1.35;">
            <strong style="color:#fef08a;">🔍 WebXR Diagnostic:</strong><br>${diagMessage}
           </div>`
        : "";

      statusCard.innerHTML = `
        <h3>AR Tier 2 Active (Hiro Marker)</h3>
        ${diagNotice}
        <p>Point camera at Hiro marker. Pick a module to begin.</p>
        ${_scaffoldModuleButton()}
      `;
      _bindScaffoldButton(statusCard);
    }
    return trackingState;
  } catch (err) {
    logger.error({ event: "marker_init_failed", error: err.message }, "Marker tracking failed");
    renderUnsupportedView(container, {
      tier: 0,
      mode: "unsupported",
      reason: err.message || "Marker tracking failed"
    });
    return null;
  }
}

// fall back to tier 2 marker mode when webxr fail at runtime
async function handleWebXRFallback(container, caps, err, loggerInstance = logger) {
  const errorName = (err && err.name) || "Error";
  const errorMessage = (err && err.message) || String(err);

  if (loggerInstance && typeof loggerInstance.warn === "function") {
    loggerInstance.warn({
      event: "webxr_fallback_to_tier2",
      errorName,
      errorMessage,
      errorStack: err && err.stack,
      caps
    }, "WebXR runtime failed; falling back to Tier 2 (marker)");
  }

  const fallbackDecision = {
    tier: 2,
    mode: "marker",
    reason: "webxr_failed_fallback_to_marker",
    caps,
    originalError: errorMessage,
    errorName,
    errorMessage
  };

  return await bootTier2(container, fallbackDecision);
}

// boot tier 1 webxr flow with user activation button
async function bootTier1(container, decision, caps) {
  const { canvas, statusCard } = renderArShell(container, decision);
  bindModuleLifecycleUI(statusCard);

  let controller = null;

  // start webxr inside user gesture
  async function activateWebXR() {
    if (controller) return controller;
    try {
      const sessionData = await initWebXRSession(canvas);
      controller = new WebXRPlacementController(sessionData);
      controller.start();
      setTierLoaders(1, loadModule3DScene, controller);

      // mid-session fallback: if webxr session dies, degrade to tier 2
      window.addEventListener("safear:webxr_session_lost", async () => {
        logger.warn({ event: "webxr_mid_session_loss" }, "WebXR session lost mid-training");
        await handleWebXRFallback(container, caps, new Error("WebXR session lost mid-training"), logger);
      }, { once: true });

      if (statusCard) {
        statusCard.innerHTML = `
          <h3>AR Tier 1 Active (WebXR)</h3>
          <p>Point at a flat surface and tap to place the extinguisher.</p>
          ${_scaffoldModuleButton()}
        `;
        _bindScaffoldButton(statusCard);
      }
      return controller;
    } catch (err) {
      await handleWebXRFallback(container, caps, err, logger);
      return null;
    }
  }

  if (statusCard) {
    statusCard.innerHTML = `
      <h3>AR Tier 1 Ready (WebXR)</h3>
      <p>Real-world surface tracking supported on your tablet. Tap below to start AR:</p>
      <button id="btn-start-webxr" style="display:block;width:100%;max-width:340px;padding:14px 20px;border-radius:10px;border:2px solid #38bdf8;background:linear-gradient(135deg,#0284c7,#0369a1);color:#ffffff;font-size:1.05rem;font-weight:bold;cursor:pointer;margin:10px 0;box-shadow:0 4px 16px rgba(56,189,248,0.4);pointer-events:auto !important;text-align:center;">🚀 START AR SESSION (WEBXR)</button>
      <p style="font-size:0.8rem;color:#94a3b8;margin-top:4px;">Or tap a module to launch directly:</p>
      ${_scaffoldModuleButton()}
    `;

    const startBtn = statusCard.querySelector("#btn-start-webxr");
    if (startBtn) {
      startBtn.addEventListener("click", () => activateWebXR());
    }

    _bindScaffoldButton(statusCard, async () => {
      await activateWebXR();
    });
  }

  return { canvas, statusCard, activateWebXR };
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
    await bootTier1(appContainer, decision, caps);
  } else if (decision.tier === 2) {
    await bootTier2(appContainer, decision);
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

export {
  initApp,
  renderUnsupportedView,
  renderArShell,
  bindModuleLifecycleUI,
  bootTier1,
  bootTier2,
  handleWebXRFallback,
  buildWebXRDiagnosticMessage
};
