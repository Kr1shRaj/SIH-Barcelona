import { createLogger } from "./logger.js";
import { detectDeviceCaps, selectArTier } from "../ar/tier.js";
import { initWebXRSession, loadModule3DScene, WebXRPlacementController } from "../ar/webxr.js";
import { initMarkerTracking, loadMarkerModuleScene } from "../ar/marker.js";
import { setTierLoaders, loadModule, unloadModule } from "./module-loader.js";
import { t, loadLocale } from "./i18n.js";
import { queueEligibleCertificates, flushPendingCertificates } from "./certificates.js";
import {
  bindAssessmentSessionListeners,
  getEffectiveWorkerId,
  fetchModuleManifests,
  syncQueuedAttempts
} from "../assessment/engine.js";

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
    if (!caps.isImmersiveArSupported) {
      failedChecks.push("isSessionSupported('immersive-ar')=false");
    }
    if (!caps.hasCamera) {
      failedChecks.push("navigator.mediaDevices.getUserMedia missing or blocked");
    }

    if (failedChecks.length > 0) {
      return `WebXR check: ${failedChecks.join("; ")}`;
    }
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
    : `<a-scene embedded arjs="sourceType: webcam; debugUIEnabled: false; trackingMethod: best;" vr-mode-ui="enabled: false" renderer="logarithmicDepthBuffer: true; antialias: true;">
        <a-marker preset="hiro" id="hiro-marker">
          <a-entity id="ar-root" position="0 0 0" scale="1 1 1"></a-entity>
        </a-marker>
        <a-marker preset="kanji" id="kanji-marker"></a-marker>
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
          <div class="app-title">🛡️ SafeAR <span class="connection-dot"></span></div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
            <span class="tier-badge ${tierClass}">${tierLabel}</span>
          </div>
        </header>
        ${diagBanner}
      </div>
      <div id="status-card" class="status-card">
        <h3>${t("app.initializing", {}, "AR Mode Initializing")}</h3>
        <p>${t("app.checking_assets", {}, "Checking module assets...")}</p>
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
        <div class="welcome-section">
          <span class="welcome-label">${t("app.tier2_label", {}, "Marker Tracking")}</span>
          <h3>${t("app.tier2_active", {}, "AR Tier 2 Active (Hiro Marker)")}</h3>
          ${diagNotice}
          <p>${t("app.tier2_active_desc", {}, "Point camera at Hiro marker. Pick a module to begin.")}</p>
        </div>
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

  const fallbackCaps = {
    ...caps,
    webxrRuntimeError: true,
    errorName,
    errorMessage
  };

  const fallbackDecision = selectArTier(fallbackCaps);
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
          <div class="welcome-section">
            <span class="welcome-label">${t("app.webxr_label", {}, "Surface Tracking")}</span>
            <h3>${t("app.tier1_active", {}, "AR Tier 1 Active (WebXR)")}</h3>
            <p>${t("app.tier1_active_desc", {}, "Point at a flat surface and tap to place the extinguisher.")}</p>
          </div>
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
      <div class="welcome-section">
        <span class="welcome-label">${t("app.webxr_label", {}, "Surface Tracking")}</span>
        <h3>${t("app.tier1_ready", {}, "AR Tier 1 Ready (WebXR)")}</h3>
        <p>${t("app.tier1_ready_desc", {}, "Real-world surface tracking supported on your tablet. Tap below to start AR:")}</p>
      </div>
      <button id="btn-start-webxr" class="webxr-start-btn">${t("app.start_ar_session", {}, "🚀 START AR SESSION (WEBXR)")}</button>
      <p style="font-size:0.78rem;color:#94a3b8;margin-top:4px;text-shadow:0 1px 3px rgba(0,0,0,0.9);">${t("app.launch_module_direct", {}, "Or tap a module to launch directly:")}</p>
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

let _appInitPromise = null;

// start mobile app and init audio and ar
async function initApp() {
  if (_appInitPromise) {
    return _appInitPromise;
  }

  _appInitPromise = (async () => {
    const appContainer = document.getElementById("app");
    if (!appContainer) {
      return null;
    }

    // bootstrap default and fallback locales and bind assessment listeners.
    // loadLocale needs a locale name: called bare it throws and no dictionary
    // registers, which leaves every t() call rendering its raw key.
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
    fetchModuleManifests().catch(() => {});

    // initial sync attempt for offline records, then certificates.
    // order matters: a certificate can only be minted from an attempt the server
    // already holds, so the sync has to land first.
    syncAttemptsThenCertificates();

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", () => {
        logger.info({ event: "network_online" }, "Device online, syncing queued attempts");
        syncAttemptsThenCertificates();
      });
    }

    // register service worker for offline use in mines
    registerServiceWorker().catch(() => {});

    // probe device hardware caps
    const caps = await detectDeviceCaps(window);
    const decision = selectArTier(caps);

    // log tier selection once at module initialization per Rule 3078729
    logger.info(decision, "AR tier selected");

    if (decision.tier === 0) {
      renderUnsupportedView(appContainer, decision);
      return decision;
    }

    if (decision.tier === 1) {
      await bootTier1(appContainer, decision, caps);
    } else if (decision.tier === 2) {
      await bootTier2(appContainer, decision);
    }
    return decision;
  })();

  return _appInitPromise;
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
  return `<div class="module-grid">
    <button id="scaffold-load-btn" class="module-card module-card--fire">
      <span class="module-icon">🔥</span>
      <span class="module-name">${t("app.fire_btn", {}, "Fire Response")}</span>
      <span class="module-desc">${t("app.fire_desc", {}, "Extinguisher drill — aim, squeeze, sweep")}</span>
    </button>
    <button id="scaffold-gas-btn" class="module-card module-card--gas">
      <span class="module-icon">☣️</span>
      <span class="module-name">${t("app.gas_btn", {}, "Gas Leak")}</span>
      <span class="module-desc">${t("app.gas_desc", {}, "Identify leaks and evacuate safely")}</span>
    </button>
  </div>`;
}

// SCAFFOLDING — bind scaffold buttons to loadModule
function _bindScaffoldButton(container, onBeforeLoad) {
  const btnFire = container.querySelector("#scaffold-load-btn");
  if (btnFire) {
    btnFire.addEventListener("click", async () => {
      try {
        if (typeof onBeforeLoad === "function") {
          await onBeforeLoad();
        }
        await loadModule("fire-response");
      } catch (err) {
        logger.warn({ event: "scaffold_load_threw", error: err.message }, "Module load threw");
      }
    });
  }

  const btnGas = container.querySelector("#scaffold-gas-btn");
  if (btnGas) {
    btnGas.addEventListener("click", async () => {
      try {
        if (typeof onBeforeLoad === "function") {
          await onBeforeLoad();
        }
        await loadModule("gas-leak");
      } catch (err) {
        logger.warn({ event: "scaffold_load_threw", error: err.message }, "Module load threw");
      }
    });
  }

  // expose unloadModule on window for manual dev testing
  if (typeof window !== "undefined") {
    window.__safear_unloadModule = unloadModule;
  }
}


// push queued attempts, then mint certificates for whatever the server accepted.
// never allowed to break boot or the online handler, so every failure is swallowed.
function syncAttemptsThenCertificates(options = {}) {
  return syncQueuedAttempts(options)
    .then((syncResult) => {
      queueEligibleCertificates(syncResult);
      return flushPendingCertificates(options);
    })
    .catch((err) => {
      logger.warn({ event: "sync_certificate_cycle_error", error: err.message }, "Sync or certificate flush failed");
      return null;
    });
}

// register service worker for offline use in mines
async function registerServiceWorker(nav = (typeof navigator !== "undefined" ? navigator : null)) {
  if (nav && "serviceWorker" in nav && typeof nav.serviceWorker.register === "function") {
    try {
      const reg = await nav.serviceWorker.register("./sw.js");
      logger.info({ event: "sw_registered", scope: reg ? reg.scope : "" }, "Service worker registered");
      return reg;
    } catch (err) {
      logger.warn({ event: "sw_registration_error", error: err.message }, "Service worker registration warning");
      return null;
    }
  }
  return null;
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
  registerServiceWorker,
  syncAttemptsThenCertificates,
  bootTier1,
  bootTier2,
  handleWebXRFallback,
  buildWebXRDiagnosticMessage
};
