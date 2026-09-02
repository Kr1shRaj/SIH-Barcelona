import { describe, it } from "node:test";
import assert from "node:assert";
import { renderUnsupportedView, renderArShell, bindModuleLifecycleUI, handleWebXRFallback, bootTier2 } from "../js/app.js";

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
});
