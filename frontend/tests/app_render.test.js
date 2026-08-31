import { describe, it } from "node:test";
import assert from "node:assert";
import { renderUnsupportedView, renderArShell } from "../js/app.js";

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
});
