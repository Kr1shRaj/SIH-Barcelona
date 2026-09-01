import { describe, it } from "node:test";
import assert from "node:assert";
import { selectArTier } from "../ar/tier.js";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

describe("AR Tier Selection (selectArTier)", () => {
  it("should select Tier 1 (WebXR) when all WebXR immersive-ar capabilities are present", () => {
    const caps = {
      isSecureContext: true,
      hasWebXR: true,
      supportsImmersiveAr: true,
      hasGetUserMedia: true
    };
    const result = selectArTier(caps, mockLogger);
    assert.strictEqual(result.tier, 1);
    assert.strictEqual(result.mode, "webxr");
  });

  it("should select Tier 2 (Marker fallback) when device lacks WebXR but has camera", () => {
    const caps = {
      isSecureContext: true,
      hasWebXR: false,
      supportsImmersiveAr: false,
      hasGetUserMedia: true
    };
    const result = selectArTier(caps, mockLogger);
    assert.strictEqual(result.tier, 2);
    assert.strictEqual(result.mode, "marker");
  });

  it("should select Tier 2 (Marker fallback) when browser is insecure context even if xr exists", () => {
    const caps = {
      isSecureContext: false,
      hasWebXR: true,
      supportsImmersiveAr: false,
      hasGetUserMedia: true
    };
    const result = selectArTier(caps, mockLogger);
    assert.strictEqual(result.tier, 2);
    assert.strictEqual(result.mode, "marker");
  });

  it("should return unsupported Tier 0 when no camera access is present", () => {
    const caps = {
      isSecureContext: true,
      hasWebXR: false,
      supportsImmersiveAr: false,
      hasGetUserMedia: false
    };
    const result = selectArTier(caps, mockLogger);
    assert.strictEqual(result.tier, 0);
    assert.strictEqual(result.mode, "unsupported");
  });

  it("should throw an error if deviceCaps is null or missing", () => {
    assert.throws(() => {
      selectArTier(null, mockLogger);
    }, /deviceCaps object is required/);
  });
});
