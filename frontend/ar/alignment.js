import { createLogger } from "../js/logger.js";

const logger = createLogger("Alignment");

// how far off the device may point before a frame stops counting as "looking at it".
// this is a sampling window only — the pass mark lives in the server's manifest.
const SAMPLE_WINDOW_RAD = Math.PI / 2;

// grab the a-frame camera entity, whatever the scene called it
function _cameraEl() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") {
    return null;
  }
  return document.querySelector("#main-camera") || document.querySelector("[camera]");
}

// an entity only has a real pose once a-frame has built its object3D
function _object3D(el) {
  return el && el.object3D && typeof el.object3D.getWorldPosition === "function" ? el.object3D : null;
}

// angle between where the camera points and where the target actually is.
// null whenever the scene cannot answer — a mock dom, a marker not yet tracked,
// or an entity a-frame has not attached yet.
function measureAngularError(targetEl, cameraEl) {
  const THREE = typeof window !== "undefined" ? window.THREE : null;
  if (!THREE || typeof THREE.Vector3 !== "function") {
    return null;
  }

  const camObj = _object3D(cameraEl || _cameraEl());
  const targetObj = _object3D(targetEl);
  if (!camObj || !targetObj) {
    return null;
  }

  try {
    const camPos = new THREE.Vector3();
    const targetPos = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1);

    camObj.getWorldPosition(camPos);
    targetObj.getWorldPosition(targetPos);
    forward.applyQuaternion(camObj.getWorldQuaternion(new THREE.Quaternion())).normalize();

    const toTarget = targetPos.sub(camPos);
    if (toTarget.length() === 0) {
      return null;
    }
    toTarget.normalize();

    const dot = Math.max(-1, Math.min(1, forward.dot(toTarget)));
    return Math.acos(dot);
  } catch (err) {
    logger.warn({ event: "alignment_measure_failed", err: err.message }, "Could not measure alignment");
    return null;
  }
}

// watch how well the device stays pointed at an anchored object.
// returns a handle whose stop() reports what was actually seen — never a guess.
// if the scene cannot be measured the handle still works and reports nothing
// measured, which is what an unsampled step honestly looks like.
function startAlignmentSampler({ targetEl, anchorId, cameraEl = null, now = () => Date.now() } = {}) {
  const startedAt = now();
  let frameCount = 0;
  let bestAngleRad = null;
  let stopped = false;
  let rafHandle = null;

  const raf = (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function")
    ? window.requestAnimationFrame.bind(window)
    : null;
  const cancel = (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function")
    ? window.cancelAnimationFrame.bind(window)
    : null;

  function tick() {
    if (stopped) return;
    const angle = measureAngularError(targetEl, cameraEl);
    if (angle !== null) {
      frameCount += 1;
      if (angle <= SAMPLE_WINDOW_RAD && (bestAngleRad === null || angle < bestAngleRad)) {
        bestAngleRad = angle;
      }
    }
    if (raf) {
      rafHandle = raf(tick);
    }
  }

  if (raf) {
    rafHandle = raf(tick);
  }

  return {
    anchorId,
    // read the sampler without ending it, used by tests and diagnostics
    peek() {
      return { angularErrorRad: bestAngleRad, dwellMs: now() - startedAt, frameCount };
    },
    stop() {
      stopped = true;
      if (rafHandle !== null && cancel) {
        cancel(rafHandle);
      }
      const result = { angularErrorRad: bestAngleRad, dwellMs: now() - startedAt, frameCount };
      logger.info(
        { event: "alignment_sampled", anchorId, measured: bestAngleRad !== null, frameCount },
        "Alignment sampler stopped"
      );
      return result;
    }
  };
}

export { startAlignmentSampler, measureAngularError, SAMPLE_WINDOW_RAD };
