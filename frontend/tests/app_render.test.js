import { describe, it } from "node:test";
import assert from "node:assert";
import { renderUnsupportedView, renderArShell, bindModuleLifecycleUI } from "../js/app.js";

// mock minimal dom element
function createMockElement() {
  return {
    innerHTML: "",
    children: []
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
});
