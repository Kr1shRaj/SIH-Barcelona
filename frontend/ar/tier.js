import { defaultLogger } from "../js/logger.js";

// probe device for webxr and camera support
async function detectDeviceCaps(win = window) {
  const isSecureContext = Boolean(win.isSecureContext);
  const hasGetUserMedia = Boolean(
    win.navigator &&
    win.navigator.mediaDevices &&
    typeof win.navigator.mediaDevices.getUserMedia === "function"
  );
  const hasWebXR = Boolean(win.navigator && win.navigator.xr);

  let supportsImmersiveAr = false;
  if (hasWebXR && typeof win.navigator.xr.isSessionSupported === "function") {
    try {
      supportsImmersiveAr = await win.navigator.xr.isSessionSupported("immersive-ar");
    } catch {
      supportsImmersiveAr = false;
    }
  }

  let forcedTier = null;
  if (win && win.location && typeof win.location.search === "string") {
    try {
      const params = new URLSearchParams(win.location.search);
      if (params.get("tier") === "2" || params.get("mode") === "marker") {
        forcedTier = 2;
      } else if (params.get("tier") === "1" || params.get("mode") === "webxr") {
        forcedTier = 1;
      }
    } catch {
      forcedTier = null;
    }
  }

  return {
    isSecureContext,
    hasGetUserMedia,
    hasWebXR,
    supportsImmersiveAr,
    forcedTier,
    userAgent: win.navigator ? win.navigator.userAgent : ""
  };
}

// pick ar tier, fall back if phone too weak
function selectArTier(deviceCaps, logger = defaultLogger) {
  if (!deviceCaps || typeof deviceCaps !== "object") {
    throw new Error("deviceCaps object is required");
  }

  const isWebXREligible = Boolean(
    deviceCaps.isSecureContext &&
    deviceCaps.hasWebXR &&
    deviceCaps.supportsImmersiveAr &&
    deviceCaps.hasGetUserMedia
  );

  let decision;

  if (deviceCaps.forcedTier === 2 && deviceCaps.hasGetUserMedia) {
    decision = {
      tier: 2,
      mode: "marker",
      reason: "tier_2_forced_by_user_override",
      caps: deviceCaps
    };
  } else if (isWebXREligible) {
    decision = {
      tier: 1,
      mode: "webxr",
      reason: "device_supports_webxr_immersive_ar",
      caps: deviceCaps
    };
  } else if (deviceCaps.hasGetUserMedia) {
    decision = {
      tier: 2,
      mode: "marker",
      reason: "device_lacks_webxr_fallback_to_marker",
      caps: deviceCaps
    };
  } else {
    decision = {
      tier: 0,
      mode: "unsupported",
      reason: "camera_access_unavailable",
      caps: deviceCaps
    };
  }

  if (logger && typeof logger.info === "function") {
    logger.info(decision, "AR tier selected");
  }

  return decision;
}

export {
  detectDeviceCaps,
  selectArTier
};
