import { createLogger } from "./logger.js";
import { detectDeviceCaps, selectArTier } from "../ar/tier.js";
import { initWebXRSession, loadModule3DScene, WebXRPlacementController } from "../ar/webxr.js";
import { initMarkerTracking, loadMarkerModuleScene } from "../ar/marker.js";
import { setTierLoaders, loadModule, unloadModule } from "./module-loader.js";
import { t, loadLocale, setLocale, getLocale, storeLocale, clearStoredLocale } from "./i18n.js";
import { registerScreens, showScreen } from "../screens/router.js";
import { mountLanguageScreen, readLocalePreference } from "../screens/language.js";
import { mountSplashScreen } from "../screens/splash.js";
import { initTheme } from "./theme.js";
import { mountAuthScreen } from "../screens/auth.js";
import { SIGN_OUT_EVENT } from "../screens/appbar.js";
import { isSessionFresh } from "./session.js";
import { mountModulesScreen } from "../screens/modules.js";
import { mountPrerequisiteScreen } from "../prerequisite/screen.js";
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
    // calibration and both patterns come from ./vendor, never ar-js-org.github.io.
    // preset="hiro" would fetch them off the internet, which a mine does not have.
    : `<a-scene embedded arjs="sourceType: webcam; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3; cameraParametersUrl: ./vendor/arjs-data/camera_para.dat;" vr-mode-ui="enabled: false" renderer="logarithmicDepthBuffer: true;">
        <a-marker type="pattern" url="./vendor/arjs-data/pattern-hiro.patt" id="hiro-marker">
          <a-entity id="ar-root" position="0 0 0" scale="1 1 1"></a-entity>
        </a-marker>
        <a-marker type="pattern" url="./vendor/arjs-data/pattern-kanji.patt" id="kanji-marker"></a-marker>
        <a-light type="ambient" color="#ffffff" intensity="1.2"></a-light>
        <a-light type="directional" position="1 4 2" intensity="1.0"></a-light>
        <a-entity id="main-camera" camera cursor="rayOrigin: mouse" raycaster="objects: .clickable, [data-raycast-target]">
          <a-entity id="gaze-laser" raycaster="objects: .aim-target, [data-raycast-target='aim'], #aim-reticle; showLine: true; far: 30; lineColor: #febc04; lineOpacity: 0.85;" position="0 0 0" rotation="0 0 0">
            <a-ring id="gaze-dot" position="0 0 -1" radius-inner="0.008" radius-outer="0.016" material="color: #febc04; shader: flat; opacity: 0.9; side: double"></a-ring>
            <a-circle position="0 0 -1" radius="0.003" material="color: #ffffff; shader: flat; opacity: 0.95"></a-circle>
          </a-entity>
        </a-entity>
      </a-scene>`;

  const currentLocale = (typeof getLocale === "function" ? getLocale() : "en").toUpperCase();

  container.innerHTML = `
    <div id="ar-viewport" class="ar-viewport">
      ${tierMarkup}
    </div>
    <div class="ui-overlay">
      <div style="width:100%;display:flex;flex-direction:column;pointer-events:none;">
        <header class="header-bar">
          <div class="header-bar__side header-bar__side--start">
            <span class="connection-dot" aria-hidden="true"></span>
          </div>
          <div class="app-title">SafeAR</div>
          <div class="header-bar__side header-bar__side--end">
            <button id="lang-switch-btn" class="lang-switch-btn" title="Change Language / भाषा बदलें">🌐 ${currentLocale}</button>
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

  if (typeof container.querySelector === "function") {
    const langBtn = container.querySelector("#lang-switch-btn");
    if (langBtn) {
      langBtn.addEventListener("click", () => {
        clearStoredLocale();
        renderLanguageSelectionScreen(container, (newLocale) => {
          storeLocale(newLocale);
          if (typeof window !== "undefined") {
            window.location.reload();
          }
        });
      });
    }
  }

  if (typeof document === "undefined") {
    return { viewport: null, canvas: null, statusCard: null };
  }

  return {
    viewport: document.getElementById("ar-viewport"),
    canvas: document.getElementById("xr-canvas"),
    statusCard: document.getElementById("status-card")
  };
}

// boot tier 2 marker tracking flow, loading moduleId once tracking is live
async function bootTier2(container, decision, moduleId = null, moduleOptions = {}) {
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
      `;
    }

    // marker tracking needs no user gesture, so the chosen module can start at once
    if (moduleId) {
      await _startChosenModule(moduleId, moduleOptions);
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
async function handleWebXRFallback(container, caps, err, loggerInstance = logger, moduleId = null, moduleOptions = {}) {
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
  return await bootTier2(container, fallbackDecision, moduleId, moduleOptions);
}

// boot tier 1 webxr flow with user activation button, then load moduleId
async function bootTier1(container, decision, caps, moduleId = null, moduleOptions = {}) {
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
        await handleWebXRFallback(container, caps, new Error("WebXR session lost mid-training"), logger, moduleId, moduleOptions);
      }, { once: true });

      if (statusCard) {
        statusCard.innerHTML = `
          <div class="welcome-section">
            <span class="welcome-label">${t("app.webxr_label", {}, "Surface Tracking")}</span>
            <h3>${t("app.tier1_active", {}, "AR Tier 1 Active (WebXR)")}</h3>
            <p>${t("app.tier1_active_desc", {}, "Point at a flat surface and tap to place the extinguisher.")}</p>
          </div>
        `;
      }

      if (moduleId) {
        await _startChosenModule(moduleId, moduleOptions);
      }
      return controller;
    } catch (err) {
      await handleWebXRFallback(container, caps, err, logger, moduleId, moduleOptions);
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
    `;

    // webxr will only hand out a session inside a user gesture, so the module waits
    // behind this tap rather than starting the moment the screen is chosen
    const startBtn = statusCard.querySelector("#btn-start-webxr");
    if (startBtn) {
      startBtn.addEventListener("click", () => activateWebXR());
    }
  }

  return { canvas, statusCard, activateWebXR };
}

let _appInitPromise = null;

// render language picker before module or tier boot
function renderLanguageSelectionScreen(container, onLocaleChosen) {
  if (!container) return;
  container.innerHTML = `
    <div class="lang-screen">
      <div class="lang-card">
        <div class="lang-header">
          <div class="lang-globe">🌐</div>
          <h1 class="lang-title">Select Training Language</h1>
          <p class="lang-subtitle">प्रशिक्षण भाषा चुनें / ᱯᱟᱹᱨᱥᱤ ᱵᱟᱪᱷᱟᱣ ᱢᱮ</p>
        </div>
        <div class="lang-options">
          <button id="lang-opt-en" class="lang-option-btn" data-locale="en">
            <div class="lang-btn-left">
              <span class="lang-btn-name">English</span>
              <span class="lang-btn-sub">Full Safety Training</span>
            </div>
            <span class="lang-btn-badge badge-complete">Ready</span>
          </button>
          <button id="lang-opt-hi" class="lang-option-btn" data-locale="hi">
            <div class="lang-btn-left">
              <span class="lang-btn-name">हिंदी (Hindi)</span>
              <span class="lang-btn-sub">पूर्ण सुरक्षा प्रशिक्षण</span>
            </div>
            <span class="lang-btn-badge badge-complete">उपलब्ध</span>
          </button>
          <button id="lang-opt-sat" class="lang-option-btn" data-locale="sat">
            <div class="lang-btn-left">
              <span class="lang-btn-name">ᱥᱟᱱᱛᱟᱲᱤ (Santali)</span>
              <span class="lang-btn-sub">Ol Chiki — ᱨᱩᱠᱷᱤᱭᱟᱹ ᱥᱮᱪᱮᱫ</span>
            </div>
            <span class="lang-btn-badge badge-partial">⚠️ Incomplete / Partial</span>
          </button>
        </div>
        <div class="lang-footer-note">
          Selection is saved. You can switch language anytime from the top bar.
        </div>
      </div>
    </div>
  `;

  let chosen = false;
  const choose = (loc, targetBtn) => {
    if (chosen) return;
    chosen = true;
    if (targetBtn && targetBtn.classList && typeof targetBtn.classList.add === "function") {
      targetBtn.classList.add("selected");
    }
    if (typeof onLocaleChosen === "function") {
      onLocaleChosen(loc);
    }
  };

  ["en", "hi", "sat"].forEach((loc) => {
    const btn = container.querySelector ? container.querySelector(`#lang-opt-${loc}`) : null;
    if (btn && typeof btn.addEventListener === "function") {
      btn.addEventListener("click", (e) => {
        if (e && typeof e.preventDefault === "function") {
          e.preventDefault();
        }
        choose(loc, btn);
      });
      btn.addEventListener("pointerdown", (e) => {
        if (e && e.pointerType === "touch") {
          choose(loc, btn);
        }
      });
    }
  });

  if (container && typeof container.addEventListener === "function") {
    container.addEventListener("click", (e) => {
      const targetBtn = e && e.target && typeof e.target.closest === "function"
        ? e.target.closest(".lang-option-btn")
        : null;
      if (targetBtn && targetBtn.dataset && targetBtn.dataset.locale) {
        choose(targetBtn.dataset.locale, targetBtn);
      }
    });
  }
}

// boot safeAR app with explicit language selection first
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
    try {
      await Promise.allSettled([
        loadLocale("en"),
        loadLocale("hi"),
        loadLocale("sat")
      ]);

      // a phone that has already been set to a language stays on it. the picker still
      // opens, so a different worker can change it on a shared handset.
      const saved = readLocalePreference();
      if (saved) {
        setLocale(saved);
        await loadLocale(saved);
      }
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

    // the camera stays off until a module actually starts. device caps are probed in
    // startTraining, not here, so the language and equipment screens never trigger a
    // permission prompt a worker has no context for yet.
    return startScreenFlow(appContainer);
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

// hand the chosen module to the loader. the loader re-checks the prerequisite gate
// and refuses if it is not done, so a failure here is reported, never swallowed.
async function _startChosenModule(moduleId, moduleOptions = {}) {
  try {
    await loadModule(moduleId, moduleOptions);
    return true;
  } catch (err) {
    logger.warn({ event: "module_start_failed", moduleId, error: err.message }, "Module start failed");
    return false;
  }
}

// turn the camera on and run the module. this is the first point at which SafeAR asks
// for camera permission — the language and equipment screens never do.
async function startTraining(container, moduleId, moduleOptions = {}) {
  if (typeof document !== "undefined" && container && container.classList) {
    container.classList.remove("screen-mode");
  }

  const caps = await detectDeviceCaps(window);
  const decision = selectArTier(caps);
  logger.info(decision, "AR tier selected");

  if (decision.tier === 0) {
    renderUnsupportedView(container, decision);
    return decision;
  }

  if (decision.tier === 1) {
    await bootTier1(container, decision, caps, moduleId, moduleOptions);
  } else {
    await bootTier2(container, decision, moduleId, moduleOptions);
  }

  // expose unloadModule on window for manual dev testing
  if (typeof window !== "undefined") {
    window.__safear_unloadModule = unloadModule;
  }

  return decision;
}

// wire the pre-AR flow: pick a language, meet the equipment, then choose a module.
// each screen only hands control on when its own precondition is satisfied.
function startScreenFlow(container) {
  // the inline boot in index.html already stamped a theme; this takes over as the
  // authority and keeps following the phone until the worker chooses for themselves
  initTheme();

  const enterScreenMode = () => {
    if (container && container.classList) {
      container.classList.add("screen-mode");
    }
  };

  registerScreens(container, {
    language: (host) => {
      enterScreenMode();
      return mountLanguageScreen({
        container: host,
        onPicked: () => showScreen("prerequisite")
      });
    },
    prerequisite: (host) => {
      enterScreenMode();
      return mountPrerequisiteScreen({
        container: host,
        workerId: getEffectiveWorkerId(),
        onContinue: () => showScreen("modules")
      });
    },
    modules: (host) => {
      enterScreenMode();
      return mountModulesScreen({
        container: host,
        workerId: getEffectiveWorkerId(),
        onStart: (moduleId) => showScreen("training", { moduleId }),
        onStartTeam: (moduleId) => showScreen("training", { moduleId, team: true }),
        onBack: () => showScreen("prerequisite")
      });
    },
    training: (host, params) => startTraining(host, params && params.moduleId, params)
  });

  // Where the app opens once the loading screen is done.
  //
  //   a live session token -> straight into the flow
  //   anything else        -> the sign in screen, which asks for a PIN offline
  //                           and for a worker id and PIN online
  //
  // A REMEMBERED ACCOUNT IS NOT A WAY IN. A device that has been signed in before
  // still gets a prompt; all the cached record buys is that the prompt asks for a
  // PIN instead of a worker id, and the PIN is checked against this device's own
  // verifier. Training itself is never gated on the network — once a worker is
  // in, the rest of the app behaves exactly as it always has, queue and all.
  const firstScreen = () => {
    if (isSessionFresh()) {
      return showScreen("language");
    }

    enterScreenMode();
    const host = document.createElement("div");
    host.className = "screen-host";
    container.innerHTML = "";
    container.appendChild(host);

    return mountAuthScreen({
      container: host,
      onAuthenticated: () => showScreen("language")
    });
  };

  // Signing out from any screen comes back here. The session is already gone by
  // the time this fires; all that is left is to ask who is using the phone now.
  if (container && typeof container.addEventListener === "function") {
    container.addEventListener(SIGN_OUT_EVENT, () => { firstScreen(); });
  }

  // The loading screen goes up first and hands over to the first screen. It is
  // not a step in SCREEN_ORDER and it gates nothing — if its timers never fire,
  // the handover still runs.
  enterScreenMode();
  return new Promise((resolve) => {
    mountSplashScreen({
      container,
      onDone: () => resolve(firstScreen())
    });
  });
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
  renderLanguageSelectionScreen,
  bindModuleLifecycleUI,
  registerServiceWorker,
  syncAttemptsThenCertificates,
  startScreenFlow,
  startTraining,
  bootTier1,
  bootTier2,
  handleWebXRFallback,
  buildWebXRDiagnosticMessage
};
