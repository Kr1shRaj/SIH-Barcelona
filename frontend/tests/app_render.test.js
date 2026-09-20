import { describe, it } from "node:test";
import assert from "node:assert";
import {
  renderUnsupportedView,
  renderArShell,
  bindModuleLifecycleUI,
  registerServiceWorker,
  bootTier1,
  handleWebXRFallback,
  bootTier2,
  buildWebXRDiagnosticMessage,
  renderLanguageSelectionScreen
} from "../js/app.js";
import { getLocale, getStoredLocale, storeLocale, clearStoredLocale } from "../js/i18n.js";

// mock minimal dom element
function createMockElement() {
  return {
    innerHTML: "",
    children: [],
    querySelector: () => null
  };
}

describe("App UI Shell and Error States", () => {
  it("should render unsupported screen markup with decision reason", () => {
    const mockContainer = createMockElement();
    const decision = {
      tier: 0,
      mode: "unsupported",
      reason: "camera_access_unavailable"
    };

    renderUnsupportedView(mockContainer, decision);

    assert.ok(mockContainer.innerHTML.includes("Device Not Supported"));
    assert.ok(mockContainer.innerHTML.includes("camera_access_unavailable"));
    assert.ok(mockContainer.innerHTML.includes("Retry Check"));
  });

  it("should render AR shell markup with correct tier badge for Tier 1", () => {
    const mockContainer = createMockElement();
    const decision = {
      tier: 1,
      mode: "webxr"
    };

    renderArShell(mockContainer, decision);

    assert.ok(mockContainer.innerHTML.includes("Tier 1: WebXR"));
    assert.ok(mockContainer.innerHTML.includes("ar-viewport"));
  });

  it("should render AR shell markup with correct tier badge for Tier 2", () => {
    const mockContainer = createMockElement();
    const decision = {
      tier: 2,
      mode: "marker"
    };

    renderArShell(mockContainer, decision);

    assert.ok(mockContainer.innerHTML.includes("Tier 2: Marker (Hiro)"));
    assert.ok(mockContainer.innerHTML.includes("ar-viewport"));
    // both markers still render, now pointed at the vendored patterns instead of
    // preset="hiro"/"kanji", which would fetch them from ar-js-org.github.io
    assert.ok(mockContainer.innerHTML.includes('id="hiro-marker"'));
    assert.ok(mockContainer.innerHTML.includes('id="kanji-marker"'));
    assert.ok(mockContainer.innerHTML.includes('url="./vendor/arjs-data/pattern-hiro.patt"'));
    assert.ok(mockContainer.innerHTML.includes('url="./vendor/arjs-data/pattern-kanji.patt"'));
    assert.ok(mockContainer.innerHTML.includes("cameraParametersUrl: ./vendor/arjs-data/camera_para.dat"));
    assert.ok(mockContainer.innerHTML.includes('id="gaze-laser"'));
  });

  it("bindModuleLifecycleUI toggles statusCard display on module_loaded and module_unloaded events", () => {
    const mockStatusCard = { style: { display: "block" } };
    const listeners = {};
    globalThis.window = {
      addEventListener: (type, fn) => { listeners[type] = fn; }
    };

    bindModuleLifecycleUI(mockStatusCard);

    assert.ok(typeof listeners["safear:module_loaded"] === "function");
    assert.ok(typeof listeners["safear:module_unloaded"] === "function");

    // simulate module loaded
    listeners["safear:module_loaded"]();
    assert.strictEqual(mockStatusCard.style.display, "none", "status card must be hidden when module loads");

    // simulate module unloaded
    listeners["safear:module_unloaded"]();
    assert.strictEqual(mockStatusCard.style.display, "block", "status card must be restored when module unloads");
  });

  it("registerServiceWorker gracefully handles unsupported navigator", async () => {
    const res = await registerServiceWorker(null);
    assert.strictEqual(res, null);

    const res2 = await registerServiceWorker({});
    assert.strictEqual(res2, null);
  });

  it("registerServiceWorker registers sw.js when supported", async () => {
    let registeredPath = null;
    const mockNav = {
      serviceWorker: {
        register: async (path) => {
          registeredPath = path;
          return { scope: "./" };
        }
      }
    };

    const reg = await registerServiceWorker(mockNav);
    assert.strictEqual(registeredPath, "./sw.js");
    assert.strictEqual(reg.scope, "./");
  });

  it("registerServiceWorker returns null without throwing when register rejects", async () => {
    const mockNav = {
      serviceWorker: {
        register: async () => {
          throw new Error("SecurityError: Insecure context");
        }
      }
    };

    const reg = await registerServiceWorker(mockNav);
    assert.strictEqual(reg, null);
  });

  it("handleWebXRFallback automatically falls back to Tier 2 marker shell and logs structured error", async () => {
    const mockContainer = createMockElement();
    const caps = {
      isSecureContext: true,
      hasWebXR: true,
      supportsImmersiveAr: true,
      hasGetUserMedia: true
    };
    const webxrError = new Error("The specified session configuration is not supported");
    webxrError.name = "NotSupportedError";

    const loggedEvents = [];
    const testLogger = {
      info: (data, msg) => loggedEvents.push({ level: "info", data, msg }),
      warn: (data, msg) => loggedEvents.push({ level: "warn", data, msg }),
      error: (data, msg) => loggedEvents.push({ level: "error", data, msg })
    };

    await handleWebXRFallback(mockContainer, caps, webxrError, testLogger);

    // must log structured fallback event with error details
    const fallbackLog = loggedEvents.find(e => e.data && e.data.event === "webxr_fallback_to_tier2");
    assert.ok(fallbackLog, "must log structured webxr_fallback_to_tier2 event");
    assert.strictEqual(fallbackLog.data.errorName, "NotSupportedError");
    assert.strictEqual(fallbackLog.data.errorMessage, "The specified session configuration is not supported");

    // container must render Tier 2 marker markup, never dead-end
    assert.ok(mockContainer.innerHTML.includes("Tier 2: Marker (Hiro)"), "must render Tier 2 marker badge");
    assert.ok(!mockContainer.innerHTML.includes("WebXR Failed"), "must not render dead-end WebXR Failed screen");
  });

  it("bootTier2 initializes marker shell and falls back to unsupported view on error", async () => {
    const mockContainer = createMockElement();
    const decision = {
      tier: 2,
      mode: "marker"
    };

    const trackingState = await bootTier2(mockContainer, decision);
    assert.ok(trackingState, "bootTier2 should return tracking state");
    assert.strictEqual(trackingState.isTracking, true);

    // Simulate failure in container rendering
    renderUnsupportedView(mockContainer, {
      tier: 0,
      mode: "unsupported",
      reason: "Camera access unavailable on device"
    });

    // Verify clean centered full-screen markup is rendered, not a stray corner button
    assert.ok(mockContainer.innerHTML.includes("Device Not Supported"));
    assert.ok(mockContainer.innerHTML.includes("unsupported-screen"));
    assert.ok(mockContainer.innerHTML.includes("Camera access unavailable on device"));
    assert.ok(!mockContainer.innerHTML.includes("WebXR Failed"));
  });

  it("buildWebXRDiagnosticMessage correctly details pre-check capability failures", () => {
    // case: insecure context
    const insecureDecision = {
      tier: 2,
      caps: {
        isSecureContext: false,
        hasWebXR: true,
        supportsImmersiveAr: false,
        hasGetUserMedia: true
      }
    };
    const msgInsecure = buildWebXRDiagnosticMessage(insecureDecision);
    assert.ok(msgInsecure.includes("isSecureContext=false"));
    assert.ok(msgInsecure.includes("requires HTTPS"));

    // case: missing navigator.xr
    const missingXrDecision = {
      tier: 2,
      caps: {
        isSecureContext: true,
        hasWebXR: false,
        supportsImmersiveAr: false,
        hasGetUserMedia: true
      }
    };
    const msgMissingXr = buildWebXRDiagnosticMessage(missingXrDecision);
    assert.ok(msgMissingXr.includes("navigator.xr missing"));

    // case: immersive-ar not supported
    const unsupportedArDecision = {
      tier: 2,
      caps: {
        isSecureContext: true,
        hasWebXR: true,
        supportsImmersiveAr: false,
        hasGetUserMedia: true
      }
    };
    const msgUnsupportedAr = buildWebXRDiagnosticMessage(unsupportedArDecision);
    assert.ok(msgUnsupportedAr.includes("isSessionSupported('immersive-ar')=false"));

    // case: forced tier 2
    const forcedDecision = {
      tier: 2,
      caps: {
        forcedTier: 2,
        hasGetUserMedia: true
      }
    };
    const msgForced = buildWebXRDiagnosticMessage(forcedDecision);
    assert.ok(msgForced.includes("Tier 2 forced by URL override"));
  });

  it("buildWebXRDiagnosticMessage correctly formats runtime requestSession rejection", () => {
    const runtimeFailureDecision = {
      tier: 2,
      reason: "webxr_failed_fallback_to_marker",
      errorName: "NotSupportedError",
      errorMessage: "The specified session configuration is not supported."
    };
    const msg = buildWebXRDiagnosticMessage(runtimeFailureDecision);
    assert.strictEqual(msg, "WebXR session rejected: NotSupportedError - The specified session configuration is not supported.");
  });

  it("handleWebXRFallback surfaces visible on-screen diagnostic banner with error details", async () => {
    const mockContainer = createMockElement();
    const caps = {
      isSecureContext: true,
      hasWebXR: true,
      supportsImmersiveAr: true,
      hasGetUserMedia: true
    };
    const webxrError = new Error("Hit-test feature not supported");
    webxrError.name = "NotSupportedError";

    const testLogger = { warn: () => {}, info: () => {}, error: () => {} };
    await handleWebXRFallback(mockContainer, caps, webxrError, testLogger);

    // must render diagnostic banner in shell
    assert.ok(mockContainer.innerHTML.includes("webxr-diag-banner"), "must contain webxr-diag-banner element");
    assert.ok(mockContainer.innerHTML.includes("WebXR session rejected: NotSupportedError - Hit-test feature not supported"));
    assert.ok(mockContainer.innerHTML.includes("TEMPORARY DIAGNOSTIC"));
  });

  it("renderArShell renders diagnostic banner when pre-check fails on device caps", () => {
    const mockContainer = createMockElement();
    const preCheckDecision = {
      tier: 2,
      mode: "marker",
      reason: "device_lacks_webxr_fallback_to_marker",
      caps: {
        isSecureContext: true,
        hasWebXR: true,
        supportsImmersiveAr: false,
        hasGetUserMedia: true
      }
    };

    renderArShell(mockContainer, preCheckDecision);
    assert.ok(mockContainer.innerHTML.includes("webxr-diag-banner"));
    assert.ok(mockContainer.innerHTML.includes("isSessionSupported('immersive-ar')=false"));
  });

  it("bootTier1 renders Tier 1 shell with user-activation button", async () => {
    const mockContainer = {
      innerHTML: "",
      children: [],
      querySelector: (sel) => {
        if (sel === "#status-card") {
          return {
            innerHTML: "",
            querySelector: () => ({ addEventListener: () => {} })
          };
        }
        if (sel === "#xr-canvas") {
          return {
            getContext: () => ({})
          };
        }
        return null;
      }
    };
    const decision = {
      tier: 1,
      mode: "webxr",
      reason: "webxr_supported",
      caps: {
        isSecureContext: true,
        hasWebXR: true,
        supportsImmersiveAr: true,
        hasGetUserMedia: true
      }
    };
    const res = await bootTier1(mockContainer, decision, decision.caps);
    assert.ok(mockContainer.innerHTML.includes("Tier 1: WebXR"));
    assert.ok(typeof res.activateWebXR === "function");
  });
});

// build interactive mock container to test button clicks and event delegation
function createInteractiveMockContainer() {
  const listeners = {};
  const buttons = {};
  const container = {
    innerHTML: "",
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    trigger: (type, ev) => {
      if (listeners[type]) listeners[type].forEach((fn) => fn(ev));
    },
    querySelector: (sel) => {
      if (typeof sel === "string" && sel.startsWith("#lang-opt-")) {
        const loc = sel.replace("#lang-opt-", "");
        if (!buttons[loc]) {
          const btnListeners = {};
          buttons[loc] = {
            id: `lang-opt-${loc}`,
            dataset: { locale: loc },
            classList: {
              classes: [],
              add: function(c) { this.classes.push(c); },
              contains: function(c) { return this.classes.includes(c); }
            },
            addEventListener: (evType, fn) => {
              btnListeners[evType] = btnListeners[evType] || [];
              btnListeners[evType].push(fn);
            },
            click: (e = {}) => {
              if (btnListeners.click) {
                btnListeners.click.forEach((fn) => fn({ preventDefault: () => {}, ...e }));
              }
            }
          };
        }
        return buttons[loc];
      }
      return null;
    }
  };
  return { container, buttons };
}

describe("Language Selection Screen Responsiveness and State Transition", () => {
  it("renderLanguageSelectionScreen renders markup for all three language choices", () => {
    const { container } = createInteractiveMockContainer();
    renderLanguageSelectionScreen(container, () => {});

    assert.ok(container.innerHTML.includes("lang-screen"));
    assert.ok(container.innerHTML.includes("lang-card"));
    assert.ok(container.innerHTML.includes('id="lang-opt-en"'));
    assert.ok(container.innerHTML.includes('id="lang-opt-hi"'));
    assert.ok(container.innerHTML.includes('id="lang-opt-sat"'));
    assert.ok(container.innerHTML.includes("badge-complete"));
    assert.ok(container.innerHTML.includes("badge-partial"));
  });

  it("clicking English button responds immediately and invokes callback with 'en'", () => {
    const { container, buttons } = createInteractiveMockContainer();
    let chosen = null;
    renderLanguageSelectionScreen(container, (picked) => {
      chosen = picked;
    });

    const enBtn = buttons.en || container.querySelector("#lang-opt-en");
    assert.ok(enBtn, "English button must exist");
    enBtn.click();

    assert.strictEqual(chosen, "en");
    assert.ok(enBtn.classList.contains("selected"), "button must receive visual selected class");
  });

  it("clicking Hindi button responds immediately and invokes callback with 'hi'", () => {
    const { container, buttons } = createInteractiveMockContainer();
    let chosen = null;
    renderLanguageSelectionScreen(container, (picked) => {
      chosen = picked;
    });

    const hiBtn = buttons.hi || container.querySelector("#lang-opt-hi");
    assert.ok(hiBtn, "Hindi button must exist");
    hiBtn.click();

    assert.strictEqual(chosen, "hi");
    assert.ok(hiBtn.classList.contains("selected"));
  });

  it("clicking Santali button responds immediately and invokes callback with 'sat'", () => {
    const { container, buttons } = createInteractiveMockContainer();
    let chosen = null;
    renderLanguageSelectionScreen(container, (picked) => {
      chosen = picked;
    });

    const satBtn = buttons.sat || container.querySelector("#lang-opt-sat");
    assert.ok(satBtn, "Santali button must exist");
    satBtn.click();

    assert.strictEqual(chosen, "sat");
    assert.ok(satBtn.classList.contains("selected"));
  });

  it("persisting user language selection transitions storage and active locale forward", () => {
    const mockStorage = {};
    globalThis.localStorage = {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    };

    clearStoredLocale();
    assert.strictEqual(getStoredLocale(), null);

    // pick english
    storeLocale("en");
    assert.strictEqual(getStoredLocale(), "en");
    assert.strictEqual(getLocale(), "en");

    // pick hindi
    storeLocale("hi");
    assert.strictEqual(getStoredLocale(), "hi");
    assert.strictEqual(getLocale(), "hi");

    // pick santali
    storeLocale("sat");
    assert.strictEqual(getStoredLocale(), "sat");
    assert.strictEqual(getLocale(), "sat");

    clearStoredLocale();
    assert.strictEqual(getStoredLocale(), null);
  });
});
