import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { unloadModule } from "../../js/module-loader.js";
import { t } from "../../js/i18n.js";
import {
  createFireMesh, animateFireMesh,
  createExtinguisherMesh, animateExtinguisherMesh,
  createExitSignMesh, animateExitSignMesh,
  createAlarmStationMesh, animateAlarmStationMesh,
  calcFireOffsetPosition,
  triggerAlarmPullVisual, ALARM_PULL_PAYOFF_MS,
  createRouteChevronStrip, layoutRouteChevronStrip, scrollRouteChevronStrip,
  createExitBeacon, animateExitBeacon,
  createConfettiBurst, animateConfettiBurst
} from "../../ar/webxr_render.js";
import { vibrate, playSiren, playLockBlip } from "../../js/sfx.js";
import {
  calcDragDistance, isPinPullComplete,
  calcRaycastAimAccuracy,
  evaluateGazeAimProgress,
  isSqueezeComplete, calcMotionSweepCoverage, isSweepComplete, SWEEP_MIN_COVERAGE,
  AIM_PASS_THRESHOLD, FIRE_BASE_MAX_DISTANCE_3D,
  CP_EXIT_ID, CP_EXTINGUISHER_ID, CP_EVACUATION_WEBXR_ID, EXIT_ANCHOR_ID
} from "./fire-response.js";
import { selectionSingle, aimDwell, spatialAlignment } from "../../assessment/observations.js";
import {
  renderAlertFlash,
  renderGasGaugeSvg,
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  renderDecisionWheel,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_EXPLOSIVE_THRESHOLD,
  initOrientationNudge
} from "./decision.js";

const logger = createLogger("FireModuleWebXR");

// step tracking
let _currentStep = 0;
let _controller = null;
let _fireMesh = null;
let _extMesh = null;
let _exitMesh = null;
let _alarmMesh = null;
let _alarmPulled = false;
let _frameHandler = null;
let _scanFrameHandler = null;
let _aimFrameHandler = null;
let _sweepFrameHandler = null;
let _placementScreenTap = null;
let _placementConfirmedHandler = null;
let _alarmPlacementFrameHandler = null;
let _exitPlacementFrameHandler = null;
let _exitWalkFrameHandler = null;
let _alarmPointerTapHandler = null;
let _exitPointerTapHandler = null;
let _step3ExitTapHandler = null;
let _interactionState = null;
let _routeStrip = null;
let _confetti = null;
let _alarmPayoffTimer = null;
let _drillBadgeTimer = null;
// where drill-complete confetti burst (exit sign spot in branch a)
let _celebrationFocus = null;

// reticle ring circumferences (svg r=16 dwell, r=21 sweep)
const RETICLE_DWELL_C = 2 * Math.PI * 16;
const RETICLE_SWEEP_C = 2 * Math.PI * 21;

// show center screen crosshair for aiming and raycasting
function _showAimCrosshair(container) {
  if (typeof document === "undefined") return;
  let crosshair = document.getElementById("webxr-aim-crosshair");
  if (!crosshair) {
    crosshair = document.createElement("div");
    crosshair.id = "webxr-aim-crosshair";
    crosshair.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="10" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle id="webxr-reticle-dwell" class="reticle-dwell" cx="24" cy="24" r="16" stroke="#facc15" stroke-width="2.5"
          stroke-linecap="round" stroke-dasharray="${RETICLE_DWELL_C.toFixed(2)}" stroke-dashoffset="${RETICLE_DWELL_C.toFixed(2)}" transform="rotate(-90 24 24)"/>
        <circle id="webxr-reticle-sweep" class="reticle-sweep" cx="24" cy="24" r="21" stroke="#06b6d4" stroke-width="2"
          stroke-linecap="round" stroke-dasharray="${RETICLE_SWEEP_C.toFixed(2)}" stroke-dashoffset="${RETICLE_SWEEP_C.toFixed(2)}" transform="rotate(-90 24 24)"/>
        <circle class="reticle-core" cx="24" cy="24" r="2.2" fill="#00e676"/>
        <line x1="24" y1="10" x2="24" y2="15" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="24" y1="33" x2="24" y2="38" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="10" y1="24" x2="15" y2="24" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="33" y1="24" x2="38" y2="24" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `;
    const targetParent = container || document.getElementById("fire-module-overlay") || document.body;
    if (targetParent && typeof targetParent.appendChild === "function") {
      targetParent.appendChild(crosshair);
    }
  }
  crosshair.style.display = "flex";
}

// fill ring 0..1 by shrinking dash offset
function _setReticleRing(id, circumference, progress) {
  if (typeof document === "undefined") return;
  const ring = document.getElementById(id);
  if (!ring || typeof ring.setAttribute !== "function") return;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  ring.setAttribute("stroke-dashoffset", (circumference * (1 - p)).toFixed(2));
}

// aim dwell ring around crosshair
function _setReticleDwell(progress) {
  _setReticleRing("webxr-reticle-dwell", RETICLE_DWELL_C, progress);
}

// sweep coverage arc around crosshair
function _setReticleSweep(progress) {
  _setReticleRing("webxr-reticle-sweep", RETICLE_SWEEP_C, progress);
}

// lock-on: shrink, go green, one buzz + blip
function _setReticleLocked() {
  if (typeof document === "undefined") return;
  const crosshair = document.getElementById("webxr-aim-crosshair");
  if (!crosshair || !crosshair.classList || typeof crosshair.classList.add !== "function") return;
  if (typeof crosshair.classList.contains === "function" && crosshair.classList.contains("reticle-locked")) return;
  crosshair.classList.add("reticle-locked");
  _setReticleDwell(1);
  vibrate(10);
  playLockBlip();
}

// remove center screen crosshair
function _hideAimCrosshair() {
  if (typeof document === "undefined") return;
  const crosshair = document.getElementById("webxr-aim-crosshair");
  if (crosshair && typeof crosshair.remove === "function") {
    crosshair.remove();
  }
}

// shoot ray from screen tap at mesh
function _raycastMesh(event, targetMesh) {
  if (!targetMesh || !_controller) return false;
  const THREE = typeof window !== "undefined" && window.THREE;
  if (!THREE || typeof THREE.Raycaster !== "function") return false;
  const camera = _controller.getCamera ? _controller.getCamera() : null;
  if (!camera) return false;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  if (event && event.clientX !== undefined && typeof window !== "undefined" && window.innerWidth) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  } else {
    pointer.x = 0;
    pointer.y = 0;
  }
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(targetMesh, true);
  return Array.isArray(hits) && hits.length > 0;
}

// up-component of hit surface normal from hit orientation quaternion
function _hitNormalY(q) {
  if (!q) return 1;
  const hx = Number(q.x) || 0;
  const hz = Number(q.z) || 0;
  return 1 - 2 * (hx * hx + hz * hz);
}

// find wall or floor spot and normal from xr hit test or look straight ahead
function _computePlacementPose(frame, referenceSpace, defaultDist = 2.0, elevateIfFloor = false, floorElevateY = 0, camYOffset = 0, maxWallDist = 3.5) {
  const THREE = typeof window !== "undefined" && window.THREE;
  let hitPos = null;
  let isVertical = false;
  let normal = null;
  let camPos = { x: 0, y: 1.5, z: 0 };
  let camQuat = { x: 0, y: 0, z: 0, w: 1 };

  if (_controller && typeof _controller.getViewerPosition === "function") {
    const vp = _controller.getViewerPosition();
    if (vp) camPos = { x: vp.x, y: vp.y, z: vp.z };
  } else {
    const camera = _controller && _controller.getCamera ? _controller.getCamera() : null;
    if (camera && camera.position) camPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  }

  if (_controller && typeof _controller.getViewerQuaternion === "function") {
    const vq = _controller.getViewerQuaternion();
    if (vq) camQuat = { x: vq.x, y: vq.y, z: vq.z, w: vq.w };
  } else {
    const camera = _controller && _controller.getCamera ? _controller.getCamera() : null;
    if (camera && camera.quaternion) camQuat = { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w };
  }

  let fwd = null;
  if (THREE && THREE.Vector3) {
    fwd = new THREE.Vector3(0, 0, -1);
    if (THREE.Quaternion) {
      const q = new THREE.Quaternion(camQuat.x, camQuat.y, camQuat.z, camQuat.w);
      fwd.applyQuaternion(q);
    } else {
      const qx = camQuat.x || 0, qy = camQuat.y || 0, qz = camQuat.z || 0, qw = (camQuat.w !== undefined) ? camQuat.w : 1;
      fwd.x = -2 * (qx * qz + qw * qy);
      fwd.y = 2 * (qw * qx - qy * qz);
      fwd.z = 2 * (qx * qx + qy * qy) - 1;
    }
  }

  if (frame && _controller && _controller.hitTestSource && referenceSpace) {
    try {
      const hitResults = frame.getHitTestResults(_controller.hitTestSource);
      if (hitResults && hitResults.length > 0) {
        const hitPose = hitResults[0].getPose(referenceSpace);
        if (hitPose && hitPose.transform) {
          const hp = hitPose.transform.position;
          const hq = hitPose.transform.orientation;

          let surfaceNormal = null;
          if (hq) {
            const hx = Number(hq.x) || 0;
            const hy = Number(hq.y) || 0;
            const hz = Number(hq.z) || 0;
            const hw = (hq.w !== undefined && hq.w !== null) ? Number(hq.w) : 1;
            surfaceNormal = {
              x: 2 * (hx * hy - hw * hz),
              y: 1 - 2 * (hx * hx + hz * hz),
              z: 2 * (hy * hz + hw * hx)
            };
          }

          if (surfaceNormal) {
            const ny = surfaceNormal.y !== undefined ? surfaceNormal.y : 1;
            const isVert = Math.abs(ny) < 0.70;
            const hitDist = Math.hypot(hp.x - camPos.x, hp.z - camPos.z);

            if (isVert && (hitDist <= maxWallDist || !frame)) {
              isVertical = true;
              hitPos = { x: hp.x, y: hp.y, z: hp.z };
              const len = Math.hypot(surfaceNormal.x, surfaceNormal.z) || 1;
              let wallNx = surfaceNormal.x / len;
              let wallNz = surfaceNormal.z / len;
              const toCamX = camPos.x - hp.x;
              const toCamZ = camPos.z - hp.z;
              if (wallNx * toCamX + wallNz * toCamZ < 0) {
                wallNx = -wallNx;
                wallNz = -wallNz;
              }
              normal = { x: wallNx, y: 0, z: wallNz };
            } else if (elevateIfFloor && hitDist <= 3.5) {
              hitPos = { x: hp.x, y: hp.y + floorElevateY, z: hp.z };
              const toCamX = camPos.x - hp.x;
              const toCamZ = camPos.z - hp.z;
              const len = Math.hypot(toCamX, toCamZ) || 1;
              normal = { x: toCamX / len, y: 0, z: toCamZ / len };
            }
          }
        }
      }
    } catch {
      hitPos = null;
    }
  }

  if (!hitPos) {
    if (fwd) {
      const dist = defaultDist || 2.0;
      const camY = camPos.y !== undefined ? camPos.y : 1.5;
      hitPos = {
        x: (camPos.x || 0) + fwd.x * dist,
        y: camY + fwd.y * dist + camYOffset,
        z: (camPos.z || 0) + fwd.z * dist
      };
      const lenH = Math.hypot(fwd.x, fwd.z) || 1;
      normal = { x: -fwd.x / lenH, y: 0, z: -fwd.z / lenH };
    } else {
      hitPos = { x: 0, y: floorElevateY || 0, z: -(defaultDist || 2.0) };
      normal = { x: 0, y: 0, z: 1 };
    }
  }

  return { pos: hitPos, isVertical, normal };
}

// keep frame loop ticking all active 3d models
function _ensureFrameHandler() {
  if (_frameHandler || !_controller || typeof _controller.onFrame !== "function") return;
  _frameHandler = ({ deltaMs }) => {
    if (_fireMesh && _fireMesh.userData) {
      _fireMesh.userData.sprayHitting = Boolean(_extMesh && _extMesh.userData && _extMesh.userData._discharging);
    }
    if (_fireMesh) animateFireMesh(_fireMesh, deltaMs);
    if (_extMesh) {
      let targetPos = _extMesh.userData ? _extMesh.userData.targetWorldPos : null;
      if (!targetPos && _fireMesh && _fireMesh.position) {
        targetPos = {
          x: _fireMesh.position.x,
          y: (_fireMesh.position.y || 0) + 0.12,
          z: _fireMesh.position.z
        };
      }
      animateExtinguisherMesh(_extMesh, deltaMs, false, targetPos);
    }
    if (_exitMesh && (!_exitMesh.userData || !_exitMesh.userData.isLocked)) animateExitSignMesh(_exitMesh, deltaMs);
    if (_alarmMesh) animateAlarmStationMesh(_alarmMesh, deltaMs);
    if (_confetti && !animateConfettiBurst(_confetti, deltaMs)) {
      if (_controller && typeof _controller.removeFromScene === "function") _controller.removeFromScene(_confetti);
      _confetti = null;
    }
  };
  _controller.onFrame(_frameHandler);
}

// hazard decision state
let _methaneReading = null;
let _decisionMade = null;
let _currentBranch = null;
let _alertStrobe = null;
let _orientationNudge = null;

// temporary diagnostic hud state for tablet verification
let _diagHudEl = null;
let _diagLastError = null;
let _diagErrorListener = null;
let _diagRejectionListener = null;
let _diagDismissed = false;

// dismiss temporary diagnostic hud element
function dismissWebXRDiag() {
  _diagDismissed = true;
  if (_diagHudEl && _diagHudEl.parentNode) {
    _diagHudEl.parentNode.removeChild(_diagHudEl);
    _diagHudEl = null;
  }
}

// check if diagnostic hud is mounted
function isDiagHudVisibleWebXR() {
  return Boolean(_diagHudEl && _diagHudEl.parentNode);
}

// update temporary on-screen diagnostic hud for tablet verification
function _updateWebXRDiag(stateText, err = null) {
  if (err) {
    _diagLastError = (err && (err.stack || err.message)) ? `${err.name || "Error"}: ${err.message}` : String(err);
    logger.error({ event: "webxr_diag_error", err: _diagLastError }, "Diagnostic caught error");
  }
  if (typeof document === "undefined") return;

  // if dismissed and no error, do not recreate HUD
  if (_diagDismissed && !err) {
    logger.info({ event: "webxr_diag_state", state: stateText }, stateText);
    return;
  }

  if (!_diagHudEl) {
    _diagHudEl = document.createElement("div");
    _diagHudEl.id = "webxr-diag-hud";
    _diagHudEl.style.cssText = [
      "position:fixed", "top:64px", "left:8px", "right:8px",
      "background:rgba(15,23,42,0.92)", "color:#f8fafc",
      "border:1.5px solid #38bdf8", "border-radius:6px",
      "padding:6px 10px", "font-family:monospace", "font-size:0.75rem",
      "z-index:100000", "pointer-events:auto", "line-height:1.35",
      "box-shadow:0 4px 14px rgba(0,0,0,0.8)", "word-break:break-word"
    ].join(";");
    const parent = document.body || document.documentElement;
    if (parent && parent.appendChild) {
      parent.appendChild(_diagHudEl);
    }
  }

  const decPanelInDom = typeof document !== "undefined" && Boolean(document.getElementById("fire-decision-panel"));
  const vpInDom = typeof document !== "undefined" && Boolean(document.getElementById("ar-viewport"));

  const errSection = _diagLastError
    ? `<div style="color:#f87171;font-weight:bold;margin-top:4px;">❌ THROWN ERROR:<br>${_diagLastError}</div>`
    : '<div style="color:#4ade80;margin-top:2px;">✔ Errors: none</div>';

  _diagHudEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding-right:24px;">
      <span style="color:#38bdf8;font-weight:bold;">[TEMPORARY DIAGNOSTIC — WEBXR FIRE RUNTIME]</span>
    </div>
    <div><strong>State:</strong> ${stateText}</div>
    <div style="color:#94a3b8;"><strong>DOM:</strong> vp=${vpInDom ? "yes" : "NO"} | decision-panel=${decPanelInDom ? "yes" : "no"} | step=${_currentStep}</div>
    ${errSection}
  `;

  let btnClose = document.getElementById("btn-close-webxr-diag");
  if (!btnClose) {
    btnClose = document.createElement("button");
    btnClose.id = "btn-close-webxr-diag";
    btnClose.type = "button";
    btnClose.style.cssText = "position:absolute;top:4px;right:6px;background:none;border:none;color:#94a3b8;font-size:1rem;font-weight:bold;cursor:pointer;padding:0 6px;line-height:1;";
    btnClose.title = "Dismiss diagnostic HUD";
    btnClose.textContent = "✕";
    btnClose.addEventListener("click", (ev) => {
      if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
      dismissWebXRDiag();
    });
  }
  if (_diagHudEl.appendChild) {
    _diagHudEl.appendChild(btnClose);
  }
}

// setup window level error trap for tablet diagnostics
function _initDiagErrorTraps() {
  if (typeof window === "undefined") return;
  if (!_diagErrorListener) {
    _diagErrorListener = (ev) => {
      const err = ev.error || new Error(ev.message || "Unknown window error");
      _updateWebXRDiag("Window Error Trapped", err);
    };
    window.addEventListener("error", _diagErrorListener);
  }
  if (!_diagRejectionListener) {
    _diagRejectionListener = (ev) => {
      const reason = ev.reason || new Error("Unhandled promise rejection");
      _updateWebXRDiag("Promise Rejection Trapped", reason);
    };
    window.addEventListener("unhandledrejection", _diagRejectionListener);
  }
}

// zoom state
let _zoomScale = 1.0;
let _exitSignScale = 1.0;
// door can be far down corridor, accept wall hit this far for exit sign
const EXIT_MAX_WALL_DIST_M = 8.0;
// full powder discharge time before fire count as out
const EXTINGUISH_DURATION_MS = 5000;
// no wall found, alarm sit left-front of worker
const ALARM_FALLBACK_LEFT_M = 0.8;
const ALARM_FALLBACK_FWD_M = 1.0;
const ALARM_BELOW_EYE_M = 0.15;

// no wall hit: put alarm left-front of viewer, face viewer
function calcAlarmFallbackPose(camPos, camQuat) {
  const qx = camQuat.x || 0, qy = camQuat.y || 0, qz = camQuat.z || 0, qw = camQuat.w !== undefined ? camQuat.w : 1;
  let fx = -2 * (qx * qz + qw * qy);
  let fz = 2 * (qx * qx + qy * qy) - 1;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  // left of forward (fx, fz) is (fz, -fx)
  const pos = {
    x: camPos.x + fx * ALARM_FALLBACK_FWD_M + fz * ALARM_FALLBACK_LEFT_M,
    y: camPos.y - ALARM_BELOW_EYE_M,
    z: camPos.z + fz * ALARM_FALLBACK_FWD_M - fx * ALARM_FALLBACK_LEFT_M
  };
  const toCamX = camPos.x - pos.x;
  const toCamZ = camPos.z - pos.z;
  const nLen = Math.hypot(toCamX, toCamZ) || 1;
  return { pos, normal: { x: toCamX / nLen, y: 0, z: toCamZ / nLen } };
}

// fire shrink only as fast as both spray time and sweep allow
function calcExtinguishProgress(elapsedMs, sweepCoverage, durationMs = EXTINGUISH_DURATION_MS) {
  const byTime = Math.max(0, elapsedMs) / durationMs;
  const bySweep = Math.max(0, sweepCoverage) / SWEEP_MIN_COVERAGE;
  return Math.min(1, byTime, bySweep);
}
const MIN_EXIT_SCALE = 0.5;
const MAX_EXIT_SCALE = 2.0;
const BASE_EXT_SCALE = 0.35;
const BASE_FIRE_SCALE = 0.35;
let _zoomControlsEl = null;
let _pinchStartDist = null;
let _pinchStartScale = 1.0;
let _touchZoomHandler = null;

// apply zoom scale to extinguisher and fire
function setZoomScaleWebXR(targetScale) {
  _zoomScale = Math.max(0.6, Math.min(2.5, targetScale));
  if (_extMesh) {
    const s = BASE_EXT_SCALE * _zoomScale;
    _extMesh.scale.set(s, s, s);
  }
  if (_fireMesh) {
    const s = BASE_FIRE_SCALE * _zoomScale;
    _fireMesh.scale.set(s, s, s);
  }
  return _zoomScale;
}

// read zoom scale
function getZoomScaleWebXR() {
  return _zoomScale;
}

// scale placed exit sign within sane bounds
function setExitSignScaleWebXR(targetScale) {
  _exitSignScale = Math.max(MIN_EXIT_SCALE, Math.min(MAX_EXIT_SCALE, Number(targetScale) || 1.0));
  if (_exitMesh) {
    _exitMesh.scale.set(_exitSignScale, _exitSignScale, _exitSignScale);
  }
  return _exitSignScale;
}

// read current exit sign scale
function getExitSignScaleWebXR() {
  return _exitSignScale;
}

// remove zoom buttons and pinch listeners
function _teardownZoomControls() {
  if (_zoomControlsEl && _zoomControlsEl.parentNode) {
    _zoomControlsEl.parentNode.removeChild(_zoomControlsEl);
    _zoomControlsEl = null;
  }
  if (_touchZoomHandler && typeof window !== "undefined") {
    window.removeEventListener("touchstart", _touchZoomHandler.start);
    window.removeEventListener("touchmove", _touchZoomHandler.move);
    window.removeEventListener("touchend", _touchZoomHandler.end);
    _touchZoomHandler = null;
  }
}

// spawn floating zoom buttons and pinch tracker
function _setupZoomControls(options = {}) {
  if (typeof document === "undefined") return;
  const target = (options && options.target) || "extinguisher";
  if (_zoomControlsEl) {
    _teardownZoomControls();
  }
  const zoomDiv = document.createElement("div");
  zoomDiv.id = "safear-zoom-controls";
  zoomDiv.style.cssText = "position:fixed;top:64px;right:16px;z-index:150;display:flex;flex-direction:column;gap:6px;pointer-events:auto;";

  const btnIn = document.createElement("button");
  btnIn.id = "btn-zoom-in";
  btnIn.title = target === "exit" ? "Scale Exit Sign Up" : "Zoom In";
  btnIn.style.cssText = "background:transparent !important;border:none !important;outline:none !important;box-shadow:none !important;color:#fff;font-size:1.5rem;font-weight:bold;cursor:pointer;padding:6px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);line-height:1;";
  btnIn.textContent = "🔍 +";
  btnIn.addEventListener("click", () => {
    if (target === "exit") {
      setExitSignScaleWebXR(_exitSignScale + 0.2);
    } else {
      setZoomScaleWebXR(_zoomScale + 0.2);
    }
  });

  const btnOut = document.createElement("button");
  btnOut.id = "btn-zoom-out";
  btnOut.title = target === "exit" ? "Scale Exit Sign Down" : "Zoom Out";
  btnOut.style.cssText = "background:transparent !important;border:none !important;outline:none !important;box-shadow:none !important;color:#fff;font-size:1.5rem;font-weight:bold;cursor:pointer;padding:6px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);line-height:1;";
  btnOut.textContent = "🔍 −";
  btnOut.addEventListener("click", () => {
    if (target === "exit") {
      setExitSignScaleWebXR(_exitSignScale - 0.2);
    } else {
      setZoomScaleWebXR(_zoomScale - 0.2);
    }
  });

  zoomDiv.appendChild(btnIn);
  zoomDiv.appendChild(btnOut);
  document.body.appendChild(zoomDiv);
  _zoomControlsEl = zoomDiv;

  if (typeof window !== "undefined") {
    _touchZoomHandler = {
      start: (e) => {
        if (e.touches && e.touches.length === 2) {
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          _pinchStartDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
          _pinchStartScale = target === "exit" ? _exitSignScale : _zoomScale;
        }
      },
      move: (e) => {
        if (e.touches && e.touches.length === 2 && _pinchStartDist) {
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          const currentDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
          if (_pinchStartDist > 10) {
            const factor = currentDist / _pinchStartDist;
            if (target === "exit") {
              setExitSignScaleWebXR(_pinchStartScale * factor);
            } else {
              setZoomScaleWebXR(_pinchStartScale * factor);
            }
          }
        }
      },
      end: (e) => {
        if (!e.touches || e.touches.length < 2) {
          _pinchStartDist = null;
        }
      }
    };
    window.addEventListener("touchstart", _touchZoomHandler.start, { passive: true });
    window.addEventListener("touchmove", _touchZoomHandler.move, { passive: true });
    window.addEventListener("touchend", _touchZoomHandler.end, { passive: true });
  }
}

// read active step number
function getCurrentStepWebXR() {
  return _currentStep;
}

// clean up all webxr fire module state
function cleanupWebXRFireModule() {
  if (_alarmPayoffTimer) {
    clearTimeout(_alarmPayoffTimer);
    _alarmPayoffTimer = null;
  }
  if (_drillBadgeTimer) {
    clearTimeout(_drillBadgeTimer);
    _drillBadgeTimer = null;
  }
  if (typeof document !== "undefined") {
    const badge = document.getElementById("drill-complete-badge");
    if (badge && typeof badge.remove === "function") badge.remove();
  }
  _removeRouteStrip();
  _celebrationFocus = null;
  if (_confetti && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_confetti);
  }
  _confetti = null;
  if (_frameHandler && _controller) {
    _controller.offFrame(_frameHandler);
    _frameHandler = null;
  }
  if (_scanFrameHandler && _controller) {
    _controller.offFrame(_scanFrameHandler);
    _scanFrameHandler = null;
  }
  if (_aimFrameHandler && _controller) {
    _controller.offFrame(_aimFrameHandler);
    _aimFrameHandler = null;
  }
  if (_sweepFrameHandler && _controller) {
    _controller.offFrame(_sweepFrameHandler);
    _sweepFrameHandler = null;
  }
  if (_placementScreenTap && typeof window !== "undefined") {
    window.removeEventListener("click", _placementScreenTap);
    window.removeEventListener("pointerdown", _placementScreenTap);
    _placementScreenTap = null;
  }
  if (_placementConfirmedHandler && typeof window !== "undefined") {
    window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    _placementConfirmedHandler = null;
  }
  if (_alarmPlacementFrameHandler && _controller && typeof _controller.offFrame === "function") {
    _controller.offFrame(_alarmPlacementFrameHandler);
    _alarmPlacementFrameHandler = null;
  }
  if (_exitPlacementFrameHandler && _controller && typeof _controller.offFrame === "function") {
    _controller.offFrame(_exitPlacementFrameHandler);
    _exitPlacementFrameHandler = null;
  }
  if (_exitWalkFrameHandler && _controller && typeof _controller.offFrame === "function") {
    _controller.offFrame(_exitWalkFrameHandler);
    _exitWalkFrameHandler = null;
  }
  if (_alarmPointerTapHandler && typeof window !== "undefined") {
    window.removeEventListener("pointerdown", _alarmPointerTapHandler);
    window.removeEventListener("click", _alarmPointerTapHandler);
    _alarmPointerTapHandler = null;
  }
  if (_exitPointerTapHandler && typeof window !== "undefined") {
    window.removeEventListener("pointerdown", _exitPointerTapHandler);
    window.removeEventListener("click", _exitPointerTapHandler);
    _exitPointerTapHandler = null;
  }
  if (_step3ExitTapHandler && typeof window !== "undefined") {
    window.removeEventListener("pointerdown", _step3ExitTapHandler);
    window.removeEventListener("click", _step3ExitTapHandler);
    _step3ExitTapHandler = null;
  }
  _teardownZoomControls();
  _zoomScale = 1.0;
  _exitSignScale = 1.0;
  if (_fireMesh && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_fireMesh);
    _fireMesh = null;
  }
  if (_extMesh && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_extMesh);
    _extMesh = null;
  }
  if (_exitMesh && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_exitMesh);
    _exitMesh = null;
  }
  if (_alarmMesh && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_alarmMesh);
    _alarmMesh = null;
  }
  _alarmPulled = false;
  _interactionState = null;
  _currentStep = 0;
  _hideAimCrosshair();

  if (_alertStrobe && typeof _alertStrobe.dismiss === "function") {
    _alertStrobe.dismiss();
    _alertStrobe = null;
  }
  _methaneReading = null;
  _decisionMade = null;
  _currentBranch = null;

  if (_orientationNudge && typeof _orientationNudge.destroy === "function") {
    _orientationNudge.destroy();
    _orientationNudge = null;
  }

  if (typeof document !== "undefined") {
    const nudgeEl = document.getElementById("safear-orientation-nudge");
    if (nudgeEl && nudgeEl.parentNode) nudgeEl.parentNode.removeChild(nudgeEl);
    const decPanel = document.getElementById("fire-decision-panel");
    if (decPanel && decPanel.parentNode) decPanel.parentNode.removeChild(decPanel);
    const alertEl = document.getElementById("fire-alert-overlay");
    if (alertEl && alertEl.parentNode) alertEl.parentNode.removeChild(alertEl);
    const debriefEl = document.getElementById("debrief-summary-card");
    if (debriefEl && debriefEl.parentNode) debriefEl.parentNode.removeChild(debriefEl);
    const overlay = document.getElementById("fire-module-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (_diagHudEl && _diagHudEl.parentNode) {
      _diagHudEl.parentNode.removeChild(_diagHudEl);
      _diagHudEl = null;
    }
  }
  _diagDismissed = false;

  if (typeof window !== "undefined") {
    if (_diagErrorListener) {
      window.removeEventListener("error", _diagErrorListener);
      _diagErrorListener = null;
    }
    if (_diagRejectionListener) {
      window.removeEventListener("unhandledrejection", _diagRejectionListener);
      _diagRejectionListener = null;
    }
  }
  _diagLastError = null;
}

// inject dom overlay panel
function _createOverlay(container, html) {
  const panel = document.createElement("div");
  panel.id = "fire-module-overlay";
  panel.style.cssText = [
    "position:fixed", "bottom:0", "left:0", "right:0",
    "background:transparent", "color:#fff",
    "font-family:sans-serif", "padding:1.2rem",
    "z-index:100", "pointer-events:auto"
  ].join(";");
  panel.innerHTML = html;
  if (container && container.appendChild) {
    container.appendChild(panel);
  }
  return panel;
}

// render subscreen with educational text
function _renderSubscreen(overlay, { badge, title, desc, buttonText, onNext }) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${badge}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${title}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${desc}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#ff6a00;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", (e) => {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    onNext();
  });
  overlay.appendChild(btnNext);
}

// step 1: exit identification (same dom overlay as tier 2)
function _setupStep1WebXR(container) {
  _currentStep = 1;
  logger.info({ event: "webxr_fire_step_start", step: 1 }, "Exit identification (WebXR)");

  registerCheckpoint({
    id: CP_EXIT_ID,
    type: "proximity",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Exit CP (WebXR)");
    }
  });

  const overlay = document.getElementById("fire-module-overlay");

  const screens = [
    {
      badge: t("fire.exit_badge_1", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (1/4)"),
      title: t("fire.exit_title_1", "Why Identifying Exits Matters"),
      desc: t("fire.exit_desc_1", "In a fire emergency, heavy smoke reduces visibility to zero in under 30 seconds. Panic causes confusion — knowing your exit routes beforehand saves critical seconds."),
      buttonText: t("fire.exit_next_1", "Next: Primary & Backup Exits ➜")
    },
    {
      badge: t("fire.exit_badge_2", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (2/4)"),
      title: t("fire.exit_title_2", "Primary vs. Backup Route"),
      desc: t("fire.exit_desc_2", "Never rely on a single exit path. If flames or smoke block your primary route, you must immediately pivot to your pre-identified secondary emergency path."),
      buttonText: t("fire.exit_next_2", "Next: Elevators Danger ➜")
    },
    {
      badge: t("fire.exit_badge_3", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (3/4)"),
      title: t("fire.exit_title_3", "Never Use Elevators in a Fire"),
      desc: t("fire.exit_desc_3", "Elevator shafts act as natural chimneys drawing superheated toxic gases. Power failure can strand the car between burning floors. Always use designated fire stairwells."),
      buttonText: t("fire.exit_next_3", "Next: Place Extinguisher ➜")
    }
  ];

  function showPlacementScreen() {
    dismissWebXRDiag();
    if (!overlay) return;

    // spawn extinguisher hidden until surface detected or placed
    if (!_extMesh && _controller) {
      _extMesh = createExtinguisherMesh();
      if (_extMesh) {
        _extMesh.visible = false;
        const s = BASE_EXT_SCALE * _zoomScale;
        _extMesh.scale.set(s, s, s);
        _controller.addToScene(_extMesh);
      }
    }

    // lowest flat hit seen = floor, table sit higher
    let floorY = null;

    // preview extinguisher sitting on detected surface while scanning
    if (_controller && typeof _controller.onFrame === "function") {
      _scanFrameHandler = () => {
        if (placed) return;
        if (_controller._lastHitPose && _controller.state === "surface_found") {
          const hp = _controller._lastHitPose.transform.position;
          if (_hitNormalY(_controller._lastHitPose.transform.orientation) > 0.75) {
            floorY = floorY === null ? hp.y : Math.min(floorY, hp.y);
          }
          if (_extMesh) {
            _extMesh.visible = true;
            _extMesh.position.set(hp.x, hp.y, hp.z);
          }
          const statusEl = document.getElementById("placement-status-text");
          if (statusEl && !statusEl.dataset.surfaceFound) {
            statusEl.dataset.surfaceFound = "true";
            statusEl.style.color = "#00e676";
            statusEl.textContent = t("fire.surface_found", "Surface detected! Tap button or floor to place extinguisher.");
          }
        } else if (_extMesh && !placed) {
          _extMesh.visible = false;
        }
      };
      _controller.onFrame(_scanFrameHandler);
    }

    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_badge", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)")}</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_title", "Place Extinguisher on Ground")}</div>
      <div id="placement-status-text" style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_desc", "Point your tablet at the floor or table. Tap the green button below (or tap anywhere on screen) to place the extinguisher.")}</div>
      <button id="btn-place-extinguisher" style="display:block;width:100%;max-width:340px;padding:12px 0;border:none !important;outline:none !important;background:transparent !important;box-shadow:none !important;color:#00e676;font-size:1.05rem;font-weight:bold;cursor:pointer;margin:0.5rem 0;pointer-events:auto !important;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_btn", "🎯 TAP TO PLACE EXTINGUISHER ON FLOOR")}</button>
    `;

    let placed = false;
    let sessionSelectHandler = null;

    // placement execution function
    const doPlace = (pos, viewerQuat) => {
      if (placed) return;
      placed = true;

      if (_scanFrameHandler && _controller && typeof _controller.offFrame === "function") {
        _controller.offFrame(_scanFrameHandler);
        _scanFrameHandler = null;
      }

      if (_placementScreenTap && typeof window !== "undefined") {
        window.removeEventListener("click", _placementScreenTap);
        window.removeEventListener("pointerdown", _placementScreenTap);
        _placementScreenTap = null;
      }
      if (sessionSelectHandler && _controller && _controller.session && typeof _controller.session.removeEventListener === "function") {
        _controller.session.removeEventListener("select", sessionSelectHandler);
        sessionSelectHandler = null;
      }
      if (_placementConfirmedHandler && typeof window !== "undefined") {
        window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
        _placementConfirmedHandler = null;
      }

      const finalPos = { ...(pos || { x: 0, y: -0.45, z: -1.20 }) };
      if (floorY !== null) finalPos.y = floorY;
      logger.info({ event: "extinguisher_placed", position: finalPos }, "Extinguisher placed on surface");
      _updateWebXRDiag("Extinguisher Placed on Surface -> Ready for Step 2");

      // position extinguisher flush at placed spot
      if (!_extMesh && _controller) {
        _extMesh = createExtinguisherMesh();
        if (_extMesh) _controller.addToScene(_extMesh);
      }
      if (_extMesh) {
        _extMesh.visible = true;
        _extMesh.position.set(finalPos.x, finalPos.y, finalPos.z);
        const s = BASE_EXT_SCALE * _zoomScale;
        _extMesh.scale.set(s, s, s);
      }

      // spawn fire on floor 2m in front of worker, not 2m past extinguisher
      const THREE = typeof window !== "undefined" && window.THREE;
      let firePos;
      const vp = _controller && _controller.getViewerPosition ? _controller.getViewerPosition() : null;
      if (THREE && viewerQuat) {
        const q = new THREE.Quaternion(viewerQuat.x, viewerQuat.y, viewerQuat.z, viewerQuat.w);
        const p = vp ? new THREE.Vector3(vp.x, finalPos.y, vp.z) : new THREE.Vector3(finalPos.x, finalPos.y, finalPos.z);
        firePos = calcFireOffsetPosition(p, q);
      }
      if (!firePos) {
        firePos = { x: finalPos.x, y: finalPos.y, z: finalPos.z - 1.8 };
      }

      _fireMesh = createFireMesh();
      if (_fireMesh && _controller) {
        _fireMesh.position.set(firePos.x, firePos.y, firePos.z);
        const s = BASE_FIRE_SCALE * _zoomScale;
        _fireMesh.scale.set(s, s, s);
        _controller.addToScene(_fireMesh);
        if (_extMesh && _extMesh.userData) {
          _extMesh.userData.targetWorldPos = { x: firePos.x, y: firePos.y + 0.12, z: firePos.z };
        }
      }

      // setup zoom controls now that objects are anchored in scene
      _setupZoomControls();

      // start animation frame handler for active 3d models
      _ensureFrameHandler();

      // fire checkpoint and advance if not already recorded from alarm pull
      if (!_alarmPulled) {
        fireCheckpointResult(
          CP_EXIT_ID,
          true,
          { method: "webxr_surface_placement", measured: false },
          spatialAlignment({
            anchorId: EXIT_ANCHOR_ID,
            angularErrorRad: null,
            dwellMs: 0,
            frameCount: 0,
            trackingSource: "webxr_pose"
          })
        );
      }

      if (overlay) {
        overlay.innerHTML = `
          <div style="font-size:1.05rem;font-weight:bold;color:#00e676;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">✔ Extinguisher Placed on Ground!</div>
          <div style="margin:0.4rem 0 0.6rem 0;font-size:0.92rem;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">The 3D fire extinguisher is anchored to the surface. Tap below to begin PASS training.</div>
          <button id="btn-proceed-step2" style="margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#00e676;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">✔ Begin PASS Training ➜</button>
        `;
        const btnProceed = overlay.querySelector("#btn-proceed-step2");
        if (btnProceed) {
          btnProceed.addEventListener("click", () => {
            _setupStep2WebXR(container);
          });
        }
      }
    };

    const btnPlace = overlay.querySelector("#btn-place-extinguisher");

    const triggerPlacement = (e) => {
      if (e) {
        if (typeof e.preventDefault === "function") e.preventDefault();
        if (typeof e.stopPropagation === "function") e.stopPropagation();
      }
      if (placed) return;

      if (btnPlace) {
        btnPlace.style.opacity = "0.7";
        btnPlace.disabled = true;
      }

      let currentPos = null;
      let viewerQuat = null;

      if (_controller) {
        if (typeof _controller.confirmPlacement === "function") {
          _controller.confirmPlacement();
        }
        currentPos = _controller._placedTransform || (_controller._lastHitPose && {
          x: _controller._lastHitPose.transform.position.x,
          y: _controller._lastHitPose.transform.position.y,
          z: _controller._lastHitPose.transform.position.z
        });
        viewerQuat = _controller._viewerQuaternionAtPlacement || (_controller._lastViewerPose && {
          x: _controller._lastViewerPose.transform.orientation.x,
          y: _controller._lastViewerPose.transform.orientation.y,
          z: _controller._lastViewerPose.transform.orientation.z,
          w: _controller._lastViewerPose.transform.orientation.w
        });
      }

      doPlace(currentPos || { x: 0, y: -0.45, z: -1.20 }, viewerQuat);
    };

    // 1. Hook up action button with click, pointerdown, and touchstart
    if (btnPlace) {
      btnPlace.addEventListener("click", triggerPlacement);
      btnPlace.addEventListener("pointerdown", triggerPlacement);
      btnPlace.addEventListener("touchstart", triggerPlacement, { passive: false });
    }

    // 2. Hook up screen tap fallback with delay to prevent previous button click bubbling
    setTimeout(() => {
      if (placed) return;
      _placementScreenTap = (e) => {
        triggerPlacement(e);
      };
      window.addEventListener("click", _placementScreenTap, { once: true });
      window.addEventListener("pointerdown", _placementScreenTap, { once: true });
    }, 150);

    // 3. Listen for WebXR session select event directly
    if (_controller && _controller.session && typeof _controller.session.addEventListener === "function") {
      sessionSelectHandler = () => {
        triggerPlacement();
      };
      _controller.session.addEventListener("select", sessionSelectHandler, { once: true });
    }

    // 4. Listen for placement confirmation from controller
    _placementConfirmedHandler = (e) => {
      const { position, viewerQuaternion } = (e && e.detail) || {};
      doPlace(position, viewerQuaternion);
    };
    window.addEventListener("safear:placement_confirmed", _placementConfirmedHandler, { once: true });
  }

  let subIndex = 0;
  function renderCurrentSubscreen() {
    if (subIndex < screens.length) {
      _updateWebXRDiag(`Step 1 Exit Subscreen ${subIndex + 1}/${screens.length}`);
      _renderSubscreen(overlay, {
        ...screens[subIndex],
        onNext: () => {
          subIndex++;
          renderCurrentSubscreen();
        }
      });
    } else {
      _triggerHazardDecisionPhase(container, overlay, () => {
        showPlacementScreen();
      });
    }
  }

  renderCurrentSubscreen();
}

// strobe emergency flash then show gas gauge wheel
function _triggerHazardDecisionPhase(container, overlay, onExtinguishProceed) {
  _updateWebXRDiag("Step 1: Triggering Emergency Alert Flash (1500ms)");
  if (overlay) overlay.innerHTML = "";

  const onAlertDone = () => {
    _updateWebXRDiag("Step 1: Alert Dismissed -> Mount Decision Wheel");
    _showDecisionWheelStep(container, overlay, onExtinguishProceed);
  };

  _alertStrobe = renderAlertFlash(container, {
    durationMs: 1500,
    onDone: onAlertDone
  });

  if (!_alertStrobe) {
    onAlertDone();
  }
}

// show svg gas gauge and decision buttons
function _showDecisionWheelStep(container, overlay, onExtinguishProceed) {
  try {
    if (overlay) overlay.innerHTML = "";

    if (_methaneReading === null || typeof _methaneReading !== "number") {
      _methaneReading = generateMethaneReading();
    }

    // append to viewport container rather than overlay to avoid transform clipping
    const targetContainer = container || (typeof document !== "undefined" && (document.getElementById("ar-viewport") || document.body));
    _updateWebXRDiag(`Step 1: Decision Wheel Mounted to <${targetContainer ? (targetContainer.id || targetContainer.tagName) : "null"}> | CH4: ${_methaneReading}%`);

    renderDecisionWheel(targetContainer, {
      reading: _methaneReading,
      onDecision: ({ choice, reading }) => {
        _decisionMade = choice;
        _currentBranch = choice === DECISION_CHOICES.EVACUATE ? "evacuate" : "suppress";
        _updateWebXRDiag(`Decision Choice: ${choice} -> Branch: ${_currentBranch}`);

        const feedbackSlot = document.getElementById("decision-feedback-slot");

        if (choice === DECISION_CHOICES.EXTINGUISH) {
          const btnProceed = document.createElement("button");
          btnProceed.id = "btn-decision-proceed";
          btnProceed.className = "btn-decision-proceed";
          btnProceed.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.4rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 12px rgba(16,185,129,0.4);";
          btnProceed.textContent = "✔ Proceed to Alarm & Extinguisher ➜";
          btnProceed.addEventListener("click", () => {
            dismissWebXRDiag();
            _updateWebXRDiag("Proceed to Alarm Station Pull");
            const decPanel = document.getElementById("fire-decision-panel");
            if (decPanel && decPanel.remove) decPanel.remove();
            _showAlarmPullStationWebXR(container, overlay, onExtinguishProceed);
          });
          if (feedbackSlot && feedbackSlot.appendChild) feedbackSlot.appendChild(btnProceed);
        } else if (choice === DECISION_CHOICES.EVACUATE) {
          const btnProceed = document.createElement("button");
          btnProceed.id = "btn-decision-proceed";
          btnProceed.className = "btn-decision-proceed";
          btnProceed.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.4rem;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 12px rgba(239,68,68,0.4);";
          btnProceed.textContent = "🚨 Confirm Evacuation Order ➜";
          btnProceed.addEventListener("click", () => {
            dismissWebXRDiag();
            _updateWebXRDiag("Proceed to Evacuation Route Confirmation");
            const decPanel = document.getElementById("fire-decision-panel");
            if (decPanel && decPanel.remove) decPanel.remove();
            _showEvacuateConfirmationWebXR(container, overlay, reading);
          });
          if (feedbackSlot && feedbackSlot.appendChild) feedbackSlot.appendChild(btnProceed);
        }
      }
    });
  } catch (err) {
    _updateWebXRDiag("Decision Wheel Render Threw Error", err);
    throw err;
  }
}

// show pull station in 3d and wait for worker to yank alarm
function _showAlarmPullStationWebXR(container, overlay, onDone) {
  _currentStep = 1;
  _currentBranch = "suppress";
  _updateWebXRDiag("Branch B: 3D Alarm Pull Station Active");
  logger.info({ event: "webxr_fire_alarm_start", branch: "suppress" }, "Alarm pull station active (WebXR)");
  _showAimCrosshair(container);

  let alarmPlaced = false;
  let pulled = false;

  if (!_alarmMesh && _controller && typeof _controller.addToScene === "function") {
    _alarmMesh = createAlarmStationMesh({ position: { x: 0, y: 1.15, z: -1.2 } });
    if (_alarmMesh) {
      _controller.addToScene(_alarmMesh);
      _ensureFrameHandler();
    }
  }

  // live preview frame handler: hit test walls or project forward
  if (_controller && typeof _controller.onFrame === "function") {
    _alarmPlacementFrameHandler = ({ frame, referenceSpace }) => {
      if (alarmPlaced || !_alarmMesh) return;
      const hit = _computePlacementPose(frame, referenceSpace, 1.2, false, 0, 0);
      let pose = hit;
      if (!hit.isVertical) {
        const vp = _controller.getViewerPosition ? _controller.getViewerPosition() : null;
        const vq = _controller.getViewerQuaternion ? _controller.getViewerQuaternion() : null;
        pose = calcAlarmFallbackPose(vp || { x: 0, y: 1.5, z: 0 }, vq || { x: 0, y: 0, z: 0, w: 1 });
      }
      const isVertical = hit.isVertical;
      const { pos, normal } = pose;
      if (pos && _alarmMesh.position && _alarmMesh.position.set) {
        _alarmMesh.position.set(pos.x, pos.y, pos.z);
        // +z face point out of wall, flush against it
        if (normal && typeof _alarmMesh.lookAt === "function") {
          _alarmMesh.lookAt(pos.x + normal.x, pos.y, pos.z + normal.z);
        }
      }
      const statusEl = document.getElementById("alarm-status-hint");
      if (statusEl && isVertical && !statusEl.dataset.wallDetected) {
        statusEl.dataset.wallDetected = "true";
        statusEl.style.color = "#00e676";
        statusEl.textContent = t("fire.alarm_wall_found", "Wall surface detected! Tap screen or alarm to lock.");
      }
    };
    _controller.onFrame(_alarmPlacementFrameHandler);
  }

  const triggerPull = () => {
    if (pulled) return;
    pulled = true;
    alarmPlaced = true;
    _alarmPulled = true;
    _hideAimCrosshair();
    logger.info({ event: "webxr_fire_alarm_pulled", branch: "suppress" }, "Fire alarm station pulled (WebXR)");
    _updateWebXRDiag("Alarm Station Pulled -> Sounded");

    if (_alarmPlacementFrameHandler && _controller && typeof _controller.offFrame === "function") {
      _controller.offFrame(_alarmPlacementFrameHandler);
      _alarmPlacementFrameHandler = null;
    }
    if (_alarmPointerTapHandler && typeof window !== "undefined") {
      window.removeEventListener("pointerdown", _alarmPointerTapHandler);
      window.removeEventListener("click", _alarmPointerTapHandler);
      _alarmPointerTapHandler = null;
    }

    const btn = document.getElementById("btn-pull-alarm");
    if (btn) {
      btn.disabled = true;
      btn.style.background = "#10b981";
      btn.style.boxShadow = "0 0 16px rgba(16,185,129,0.4)";
      btn.textContent = "✔ ALARM ACTIVATED! PREPARING EXTINGUISHER...";
    }

    fireCheckpointResult(
      CP_EXIT_ID,
      true,
      { method: "alarm_pull_activated", reading: _methaneReading },
      spatialAlignment({
        anchorId: EXIT_ANCHOR_ID,
        angularErrorRad: 0,
        dwellMs: 500,
        frameCount: 10,
        trackingSource: "webxr_pose"
      })
    );

    // payoff: lever drop, ring green, strobe, siren; then clear station and move on
    triggerAlarmPullVisual(_alarmMesh);
    playSiren(ALARM_PULL_PAYOFF_MS);
    vibrate([60, 40, 60]);
    _alarmPayoffTimer = setTimeout(() => {
      _alarmPayoffTimer = null;
      if (_alarmMesh && _controller && typeof _controller.removeFromScene === "function") {
        _controller.removeFromScene(_alarmMesh);
        _alarmMesh = null;
      }
      if (typeof onDone === "function") onDone();
    }, ALARM_PULL_PAYOFF_MS);
  };

  const handleAlarmTap = (e) => {
    if (pulled) return;
    if (e && e.target && e.target.closest && e.target.closest("button")) return;

    const hitAlarm = _raycastMesh(e, _alarmMesh);
    if (hitAlarm) {
      triggerPull();
      return;
    }

    if (!alarmPlaced) {
      alarmPlaced = true;
      if (_alarmMesh) {
        if (!_alarmMesh.userData) _alarmMesh.userData = {};
        _alarmMesh.userData.isLocked = true;
      }
      if (_alarmPlacementFrameHandler && _controller && typeof _controller.offFrame === "function") {
        _controller.offFrame(_alarmPlacementFrameHandler);
        _alarmPlacementFrameHandler = null;
      }
      const statusEl = document.getElementById("alarm-status-hint");
      if (statusEl) {
        statusEl.style.color = "#00e676";
        statusEl.textContent = t("fire.alarm_mounted", "✔ Alarm mounted on wall! Tap 3D alarm directly (or press button below) to pull.");
      }
      _updateWebXRDiag("Alarm Station Anchored to Wall -> Ready to Pull");
    }
  };

  _alarmPointerTapHandler = handleAlarmTap;
  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", _alarmPointerTapHandler);
    window.addEventListener("click", _alarmPointerTapHandler);
  }

  if (overlay) {
    overlay.innerHTML = "";
    const hudCard = document.createElement("div");
    hudCard.id = "fire-hud-card";
    hudCard.className = "fire-hud-card";
    hudCard.innerHTML = `
      <div class="hud-badge">🔔 STEP 1 / 3 — SOUND ALARM (BRANCH B)</div>
      <div class="hud-title">Pull Fire Alarm Station</div>
      <div class="hud-desc">Methane is below 5.0% LEL. Before attacking the fire with an extinguisher, sound the mine section alarm to alert all miners!</div>
      <div id="alarm-status-hint" style="margin:0.4rem 0 0.5rem 0;font-size:0.92rem;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">
        ${t("fire.alarm_wall_hint", "Aim at wall/door and tap screen to mount alarm, or tap 3D model directly to pull.")}
      </div>
    `;
    overlay.appendChild(hudCard);

    const btn = document.createElement("button");
    btn.id = "btn-pull-alarm";
    btn.style.cssText = "margin-top:0.5rem;padding:0.9rem 1.6rem;background:#ef4444;color:#fff;border:none;border-radius:10px;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 16px rgba(239,68,68,0.4);";
    btn.textContent = "🚨 PULL FIRE ALARM STATION";
    btn.addEventListener("click", triggerPull);
    overlay.appendChild(btn);
  }
}

// check physical walk toward placed exit sign
function checkEvacuationPhysicalExit(userPos, signPos, wallNormal, options = {}) {
  const proximityThreshold = typeof options.proximityThreshold === "number" ? options.proximityThreshold : 0.80;
  const crossingThreshold = typeof options.crossingThreshold === "number" ? options.crossingThreshold : 0.10;
  const lateralTolerance = typeof options.lateralTolerance === "number" ? options.lateralTolerance : 1.20;

  const uX = (userPos && typeof userPos.x === "number") ? userPos.x : 0;
  const uZ = (userPos && typeof userPos.z === "number") ? userPos.z : 0;
  const sX = (signPos && typeof signPos.x === "number") ? signPos.x : 0;
  const sZ = (signPos && typeof signPos.z === "number") ? signPos.z : 0;

  const dx = uX - sX;
  const dz = uZ - sZ;
  const horizontalDist = Math.hypot(dx, dz);

  let crossed = false;
  if (wallNormal && (wallNormal.x !== 0 || wallNormal.z !== 0)) {
    const len = Math.hypot(wallNormal.x, wallNormal.z) || 1;
    const nx = wallNormal.x / len;
    const nz = wallNormal.z / len;

    // signed distance from sign along outward wall normal
    const dotNormal = dx * nx + dz * nz;
    // lateral distance perpendicular to wall normal in horizontal plane
    const dotLateral = Math.abs(dx * (-nz) + dz * nx);

    if (dotNormal <= crossingThreshold && dotLateral <= lateralTolerance) {
      crossed = true;
    }
  }

  const reached = horizontalDist <= proximityThreshold || crossed;

  return {
    distance: horizontalDist,
    reached,
    crossed,
    threshold: proximityThreshold
  };
}

// show exit sign in 3d and confirm run path
function _showEvacuateConfirmationWebXR(container, overlay, reading) {
  dismissWebXRDiag();
  if (!overlay) return;
  _currentBranch = "evacuate";
  _updateWebXRDiag(`Branch A Evacuation Active | Reading: ${reading}%`);

  registerCheckpoint({
    id: CP_EVACUATION_WEBXR_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Evac CP (WebXR)");
    }
  });

  let exitPlaced = false;
  let confirmed = false;
  let lastNormal = { x: 0, y: 0, z: 1 };
  let _placedSignPos = null;
  let _placedWallNormal = null;
  let _initialWalkDist = 2.0;

  _showAimCrosshair(container);

  if (!_exitMesh && _controller && typeof _controller.addToScene === "function") {
    _exitMesh = createExitSignMesh({ position: { x: 0, y: 1.8, z: -1.8 } });
    if (_exitMesh) {
      if (_exitSignScale !== 1.0) {
        _exitMesh.scale.set(_exitSignScale, _exitSignScale, _exitSignScale);
      }
      _controller.addToScene(_exitMesh);
      _ensureFrameHandler();
    }
  }

  let _lastSmoothedExitPos = null;
  let _lastSmoothedExitNormal = null;
  // hit test drop a frame, keep sign at last wall depth, not snap to 2m
  let _lastWallDist = 2.0;

  // live preview frame handler: detect door/wall or project forward
  if (_controller && typeof _controller.onFrame === "function") {
    _exitPlacementFrameHandler = ({ frame, referenceSpace }) => {
      if (exitPlaced || !_exitMesh) return;
      const { pos, isVertical, normal } = _computePlacementPose(frame, referenceSpace, _lastWallDist, false, 0, 0.0, EXIT_MAX_WALL_DIST_M);
      if (normal) lastNormal = normal;
      if (isVertical && pos) {
        const vp = _controller.getViewerPosition ? _controller.getViewerPosition() : null;
        const d = vp ? Math.hypot(pos.x - vp.x, pos.z - vp.z) : 0;
        if (d > 0.3) _lastWallDist = d;
      }
      if (pos && _exitMesh.position && _exitMesh.position.set) {
        if (!_lastSmoothedExitPos) {
          _lastSmoothedExitPos = { x: pos.x, y: pos.y, z: pos.z };
        } else {
          _lastSmoothedExitPos.x += (pos.x - _lastSmoothedExitPos.x) * 0.45;
          _lastSmoothedExitPos.y += (pos.y - _lastSmoothedExitPos.y) * 0.45;
          _lastSmoothedExitPos.z += (pos.z - _lastSmoothedExitPos.z) * 0.45;
        }
        _exitMesh.position.set(_lastSmoothedExitPos.x, _lastSmoothedExitPos.y, _lastSmoothedExitPos.z);

        if (normal) {
          if (!_lastSmoothedExitNormal) {
            _lastSmoothedExitNormal = { x: normal.x, y: 0, z: normal.z };
          } else {
            _lastSmoothedExitNormal.x += (normal.x - _lastSmoothedExitNormal.x) * 0.45;
            _lastSmoothedExitNormal.z += (normal.z - _lastSmoothedExitNormal.z) * 0.45;
          }
          const nLen = Math.hypot(_lastSmoothedExitNormal.x, _lastSmoothedExitNormal.z) || 1;
          const nx = _lastSmoothedExitNormal.x / nLen;
          const nz = _lastSmoothedExitNormal.z / nLen;
          if (typeof _exitMesh.lookAt === "function") {
            _exitMesh.lookAt(_lastSmoothedExitPos.x + nx, _lastSmoothedExitPos.y, _lastSmoothedExitPos.z + nz);
          }
        } else {
          const camera = _controller.getCamera ? _controller.getCamera() : null;
          if (camera && camera.position && typeof _exitMesh.lookAt === "function") {
            _exitMesh.lookAt(camera.position.x, _exitMesh.position.y, camera.position.z);
          }
        }
      }
      const statusEl = document.getElementById("exit-status-hint");
      if (statusEl && isVertical && !statusEl.dataset.wallDetected) {
        statusEl.dataset.wallDetected = "true";
        statusEl.style.color = "#00e676";
        statusEl.textContent = t("fire.exit_door_found", "Door/wall surface detected! Tap button or screen to anchor.");
      }
    };
    _controller.onFrame(_exitPlacementFrameHandler);
  }

  const confirmEvac = (opts = {}) => {
    if (confirmed) return;
    confirmed = true;
    exitPlaced = true;
    _hideAimCrosshair();
    _teardownZoomControls();

    if (_exitPlacementFrameHandler && _controller && typeof _controller.offFrame === "function") {
      _controller.offFrame(_exitPlacementFrameHandler);
      _exitPlacementFrameHandler = null;
    }
    if (_exitWalkFrameHandler && _controller && typeof _controller.offFrame === "function") {
      _controller.offFrame(_exitWalkFrameHandler);
      _exitWalkFrameHandler = null;
    }
    if (_exitPointerTapHandler && typeof window !== "undefined") {
      window.removeEventListener("pointerdown", _exitPointerTapHandler);
      window.removeEventListener("click", _exitPointerTapHandler);
      _exitPointerTapHandler = null;
    }

    if (_exitMesh && _controller && typeof _controller.removeFromScene === "function") {
      _controller.removeFromScene(_exitMesh);
      _exitMesh = null;
    }
    _removeRouteStrip();

    const method = (opts && opts.method) || "branch_a_evacuate";
    fireCheckpointResult(
      CP_EXIT_ID,
      true,
      { method, measured: false, reading },
      spatialAlignment({
        anchorId: EXIT_ANCHOR_ID,
        angularErrorRad: null,
        dwellMs: 0,
        frameCount: 0,
        trackingSource: "webxr_pose"
      })
    );
    fireCheckpointResult(
      CP_EVACUATION_WEBXR_ID,
      true,
      { selected: "wind_based_upwind", branch: "evacuate", reading },
      typeof selectionSingle === "function" ? selectionSingle("wind_based_upwind") : null
    );
    _showCompletionWebXR(overlay, container, true);
  };

  const lockPlacementAndStartWalk = () => {
    if (exitPlaced) return;
    exitPlaced = true;
    _hideAimCrosshair();
    if (_exitPlacementFrameHandler && _controller && typeof _controller.offFrame === "function") {
      _controller.offFrame(_exitPlacementFrameHandler);
      _exitPlacementFrameHandler = null;
    }

    if (_exitMesh) {
      if (!_exitMesh.userData) _exitMesh.userData = {};
      _exitMesh.userData.isLocked = true;
    }

    _placedSignPos = {
      x: _exitMesh ? _exitMesh.position.x : 0,
      y: _exitMesh ? _exitMesh.position.y : 1.8,
      z: _exitMesh ? _exitMesh.position.z : -2.0
    };
    _placedWallNormal = lastNormal || { x: 0, y: 0, z: 1 };
    _celebrationFocus = { ..._placedSignPos };

    // light beacon on sign + green chevron route on floor
    if (_exitMesh && typeof _exitMesh.add === "function") {
      const beacon = createExitBeacon();
      if (beacon) {
        beacon.visible = true;
        _exitMesh.add(beacon);
      }
    }
    if (!_routeStrip && _controller && typeof _controller.addToScene === "function") {
      _routeStrip = createRouteChevronStrip();
      if (_routeStrip) _controller.addToScene(_routeStrip);
    }

    let camPos = { x: 0, y: 1.5, z: 0 };
    if (_controller && typeof _controller.getViewerPosition === "function") {
      const vp = _controller.getViewerPosition();
      if (vp) camPos = { x: vp.x, y: vp.y, z: vp.z };
    } else {
      const camera = _controller && _controller.getCamera ? _controller.getCamera() : null;
      if (camera && camera.position) camPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    }
    const initDx = camPos.x - _placedSignPos.x;
    const initDz = camPos.z - _placedSignPos.z;
    _initialWalkDist = Math.max(0.81, Math.min(EXIT_MAX_WALL_DIST_M, Math.hypot(initDx, initDz)));

    _setupZoomControls({ target: "exit" });

    const statusEl = document.getElementById("exit-status-hint");
    if (statusEl) {
      statusEl.style.color = "#00e676";
      statusEl.textContent = t("fire.exit_walk_hint", "✔ Route locked! Physically walk toward doorway to evacuate.");
    }

    const walkFeedback = document.getElementById("exit-walk-feedback");
    if (walkFeedback) {
      walkFeedback.style.display = "block";
    }
    const distText = document.getElementById("exit-walk-dist-text");
    if (distText) {
      distText.textContent = `${_initialWalkDist.toFixed(1)}m`;
    }

    const btn = document.getElementById("btn-exit-found");
    if (btn) {
      btn.textContent = t("fire.exit_fallback_btn", "🚪 Small Room / Obstacle? Tap to complete");
      btn.style.background = "#334155";
      btn.style.color = "#f1f5f9";
      btn.style.border = "1px solid #64748b";
      btn.style.boxShadow = "none";
    }

    _updateWebXRDiag("Exit Sign Locked -> Walk Toward Door (<= 0.8m)");

    let _recentWalkSamples = [];
    let _lastSpeedCalcTime = 0;
    let _currentWalkingSpeed = 0;
    let _routeFrom = null;

    if (_controller && typeof _controller.onFrame === "function") {
      _exitWalkFrameHandler = (frameInfo = {}) => {
        if (confirmed || !exitPlaced || !_exitMesh) return;
        const frameDeltaMs = frameInfo.deltaMs || 16;
        let currentPos = null;
        if (_controller && typeof _controller.getViewerPosition === "function") {
          currentPos = _controller.getViewerPosition();
        } else {
          const currentCam = _controller && _controller.getCamera ? _controller.getCamera() : null;
          if (currentCam && currentCam.position) currentPos = currentCam.position;
        }
        if (!currentPos) return;

        const res = checkEvacuationPhysicalExit(currentPos, _placedSignPos, _placedWallNormal);
        const now = Date.now();

        // re-lay route only after 0.25m of walking; scroll every frame
        if (_routeStrip) {
          if (!_routeFrom || Math.hypot(currentPos.x - _routeFrom.x, currentPos.z - _routeFrom.z) > 0.25) {
            _routeFrom = { x: currentPos.x, z: currentPos.z };
            const doorFloor = {
              x: _placedSignPos.x + _placedWallNormal.x * 0.35,
              z: _placedSignPos.z + _placedWallNormal.z * 0.35
            };
            // ponytail: floor guessed as 1.3m below phone (0 on local-floor); pass tracked floor y if scan phase ever feeds branch a
            layoutRouteChevronStrip(_routeStrip, _routeFrom, doorFloor, Math.min(0, (currentPos.y || 0) - 1.3));
          }
          scrollRouteChevronStrip(_routeStrip, frameDeltaMs);
        }
        const beacon = _exitMesh && typeof _exitMesh.getObjectByName === "function" ? _exitMesh.getObjectByName("exit-beacon") : null;
        if (beacon) animateExitBeacon(beacon, frameDeltaMs, res.distance);

        _recentWalkSamples.push({ t: now, d: res.distance });
        _recentWalkSamples = _recentWalkSamples.filter(s => now - s.t <= 1200);

        if (_recentWalkSamples.length >= 2 && now - _lastSpeedCalcTime >= 200) {
          _lastSpeedCalcTime = now;
          const s0 = _recentWalkSamples[0];
          const sLatest = _recentWalkSamples[_recentWalkSamples.length - 1];
          const dtSec = (sLatest.t - s0.t) / 1000;
          if (dtSec >= 0.20) {
            const speedMps = (s0.d - sLatest.d) / dtSec;
            _currentWalkingSpeed = Math.round(speedMps * 10) / 10;
          }
        }

        const liveDistText = document.getElementById("exit-walk-dist-text");
        if (liveDistText) {
          liveDistText.textContent = `${res.distance.toFixed(1)}m`;
        }
        const liveDistBar = document.getElementById("exit-walk-bar");
        if (liveDistBar) {
          const pct = Math.max(0, Math.min(100, Math.round(((_initialWalkDist - res.distance) / (_initialWalkDist - 0.8)) * 100)));
          liveDistBar.style.width = `${pct}%`;
        }

        const livePaceText = document.getElementById("exit-walk-pace-text");
        if (livePaceText) {
          if (_currentWalkingSpeed > 0.20) {
            livePaceText.innerHTML = `🟢 <span>Walking forward (${_currentWalkingSpeed.toFixed(1)} m/s)</span>`;
          } else if (_currentWalkingSpeed < -0.20) {
            livePaceText.innerHTML = `⚠️ <span style="color:#f87171;">Moving away from exit (${Math.abs(_currentWalkingSpeed).toFixed(1)} m/s) — Turn toward door</span>`;
          } else {
            livePaceText.innerHTML = `🟡 <span style="color:#fde047;">Step forward toward doorway (${res.distance.toFixed(1)}m remaining)</span>`;
          }
        }

        if (res.reached) {
          confirmEvac({ method: "physical_walk", distance: res.distance, speed: _currentWalkingSpeed });
        }
      };
      _controller.onFrame(_exitWalkFrameHandler);
    }
  };

  const handleExitTap = (e) => {
    if (confirmed) return;
    if (e && e.target && e.target.closest && e.target.closest("button")) return;

    if (!exitPlaced) {
      lockPlacementAndStartWalk();
    } else {
      const statusEl = document.getElementById("exit-status-hint");
      if (statusEl) {
        statusEl.textContent = t("fire.exit_walk_hint_again", "🚶 Walk toward the exit doorway (<= 0.8m)! Or tap button below if space restricted.");
      }
    }
  };

  _exitPointerTapHandler = handleExitTap;
  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", _exitPointerTapHandler);
    window.addEventListener("click", _exitPointerTapHandler);
  }

  const isHigh = reading >= METHANE_EXPLOSIVE_THRESHOLD;
  overlay.innerHTML = "";
  const hudCard = document.createElement("div");
  hudCard.id = "fire-hud-card";
  hudCard.className = "fire-hud-card";
  hudCard.innerHTML = `
    <div class="hud-badge">🚨 BRANCH A — IMMEDIATE EVACUATION</div>
    <div class="hud-title">${isHigh ? "CRITICAL METHANE LEVEL (>= 5.0%)" : "PRECAUTIONARY EVACUATION"}</div>
    <div class="hud-desc">${isHigh ? "Atmosphere is explosive. Fire suppression is strictly forbidden under mining regulations. Follow emergency route immediately." : "Evacuation selected. Move promptly along marked emergency path to the nearest safe surface exit."}</div>
    <div id="exit-status-hint" style="margin:0.4rem 0 0.5rem 0;font-size:0.92rem;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">
      ${t("fire.exit_door_hint", "Aim crosshair at exit door / frame and tap button or screen to anchor.")}
    </div>
    <div id="exit-walk-feedback" style="display:none;margin:0.4rem 0;padding:0.6rem;background:rgba(15,23,42,0.92);border:1.5px solid #00e676;border-radius:10px;box-shadow:0 0 16px rgba(0,230,118,0.25);">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.88rem;font-weight:600;color:#f1f5f9;">
        <span>🚪 Distance to Door:</span>
        <span id="exit-walk-dist-text" style="color:#00e676;font-size:1.15rem;font-weight:bold;">--</span>
      </div>
      <div style="margin:0.4rem 0 0.25rem 0;height:10px;background:#334155;border-radius:5px;overflow:hidden;">
        <div id="exit-walk-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#00e676,#38bdf8);transition:width 0.15s ease;"></div>
      </div>
      <div id="exit-walk-pace-text" style="font-size:0.82rem;font-weight:600;color:#38bdf8;margin-top:0.35rem;display:flex;align-items:center;gap:0.3rem;">
        <span>🚶</span> <span>Step forward toward exit door...</span>
      </div>
    </div>
  `;
  overlay.appendChild(hudCard);

  const btn = document.createElement("button");
  btn.id = "btn-exit-found";
  btn.style.cssText = "margin-top:0.6rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 14px rgba(0,230,118,0.3);";
  btn.textContent = "📍 Lock Exit Sign on Door";
  btn.addEventListener("click", () => {
    if (!exitPlaced) {
      lockPlacementAndStartWalk();
    } else {
      confirmEvac({ method: "small_room_fallback" });
    }
  });
  overlay.appendChild(btn);
}

// step 2: PASS technique interactions against world-space entities
function _setupStep2WebXR(container) {
  dismissWebXRDiag();
  _currentStep = 2;
  _updateWebXRDiag("Step 2 PASS technique active");
  logger.info({ event: "webxr_fire_step_start", step: 2 }, "PASS technique (WebXR)");

  registerCheckpoint({
    id: CP_EXTINGUISHER_ID,
    type: "aim",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Aim CP (WebXR)");
    }
  });

  _interactionState = {
    phase: "pin",     // pin -> aim -> squeeze -> sweep
    pinSelected: false,
    pinDragStart: null,
    aimStartMs: 0,
    aimInTarget: false,
    squeezeStartMs: 0,
    squeezing: false,
    sweepSamples: [],
    sweepStarted: false
  };

  const overlay = document.getElementById("fire-module-overlay");

  // show pin pull UI
  _showPinPhase(overlay, container);
}

// pin pull phase: tap or swipe to pull pin
function _showPinPhase(overlay, container) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_pull_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (1/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_pull_title", "P — Pull the Pin")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_pull_desc", "Tap anywhere to select the pin, then swipe right to pull it out.")}</div>
  `;
  const btn = document.createElement("button");
  btn.id = "btn-webxr-pin-pull";
  btn.style.cssText = "padding:0.75rem 0;background:transparent !important;color:#00e5ff;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btn.textContent = t("fire.pass_pull_badge_btn", "👉 SWIPE RIGHT OR TAP TO PULL PIN");

  let pinPulled = false;
  const _cleanPinListeners = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("touchstart", onScreenTouchStart);
      window.removeEventListener("touchend", onScreenTouchEnd);
      window.removeEventListener("mousedown", onScreenTouchStart);
      window.removeEventListener("mouseup", onScreenTouchEnd);
    }
  };

  const doPull = () => {
    if (pinPulled) return;
    pinPulled = true;
    _cleanPinListeners();
    _onPinPulled(overlay, container);
  };

  let dragStart = null;
  btn.addEventListener("click", () => doPull());
  btn.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    if (touch) dragStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  btn.addEventListener("touchend", (e) => {
    const touch = e.changedTouches ? e.changedTouches[0] : null;
    if (touch && dragStart) {
      const dx = touch.clientX - dragStart.x;
      const dist = calcDragDistance(dragStart, { x: touch.clientX, y: touch.clientY });
      if (dx > 25 || dist < 20 || isPinPullComplete(dist)) {
        doPull();
        return;
      }
    }
    doPull();
  });
  btn.addEventListener("mousedown", (e) => {
    dragStart = { x: e.clientX, y: e.clientY };
  });
  btn.addEventListener("mouseup", (e) => {
    if (dragStart) {
      const dx = e.clientX - dragStart.x;
      const dist = calcDragDistance(dragStart, { x: e.clientX, y: e.clientY });
      if (dx > 25 || dist < 20 || isPinPullComplete(dist)) {
        doPull();
        return;
      }
    }
    doPull();
  });

  // screen swipe / tap detection on window
  let windowTouchStart = null;
  const onScreenTouchStart = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    if (touch) {
      windowTouchStart = { x: touch.clientX, y: touch.clientY };
    }
  };
  const onScreenTouchEnd = (e) => {
    const touch = e.changedTouches ? e.changedTouches[0] : (e.clientX ? e : null);
    if (touch && windowTouchStart) {
      const dx = touch.clientX - windowTouchStart.x;
      const dist = calcDragDistance(windowTouchStart, { x: touch.clientX, y: touch.clientY });
      if (dx > 25 || dist < 20) {
        doPull();
      }
    }
    windowTouchStart = null;
  };

  if (typeof window !== "undefined") {
    window.addEventListener("touchstart", onScreenTouchStart, { passive: true });
    window.addEventListener("touchend", onScreenTouchEnd, { passive: true });
    window.addEventListener("mousedown", onScreenTouchStart);
    window.addEventListener("mouseup", onScreenTouchEnd);
  }

  overlay.appendChild(btn);
}

// pin pulled — animate pin out, advance to aim
function _onPinPulled(overlay, container) {
  if (_interactionState) _interactionState.phase = "aim";

  // animate pin removal on 3D mesh
  if (_extMesh && _extMesh.userData) {
    const pin = _extMesh.getObjectByName("extinguisher-pin");
    if (pin) pin.visible = false;
    const arrow = _extMesh.getObjectByName("extinguisher-guide-arrow");
    if (arrow) arrow.visible = false;
    const ring = _extMesh.getObjectByName("ext-pin-ring");
    if (ring) ring.visible = false;
    _extMesh.userData._pinPulled = true;
  }

  logger.info({ event: "webxr_pin_pulled" }, "Pin pulled (WebXR)");
  _showAimPhase(overlay, container);
}

// aim phase: point device at fire base, hold steady
function _showAimPhase(overlay, container) {
  if (!overlay) return;
  _showAimCrosshair(container);

  let aimStartMs = 0;
  let aimActive = false;
  let aimFrames = 0;

  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_aim_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (2/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_aim_title", "A — Aim at Base of Fire")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_aim_desc", "Point your device directly at the base of the fire. Hold steady for 0.8 seconds.")}</div>
    <div id="aim-progress-bar" style="width:100%;max-width:320px;height:8px;background:rgba(30,41,59,0.7);border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="aim-progress-fill" style="width:0%;height:100%;background:#00e676;transition:width 0.1s;"></div>
    </div>
  `;

  // raycaster for aim detection against fire mesh
  const THREE = typeof window !== "undefined" && window.THREE;
  if (!THREE || !_fireMesh || !_controller) {
    _showAimFallback(overlay, container);
    return;
  }

  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);

  // add frame callback for aim tracking
  _aimFrameHandler = ({ deltaMs }) => {
    if (!_fireMesh || !_controller) return;

    const camera = _controller.getCamera();
    if (!camera) return;

    // cast ray from camera center
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObject(_fireMesh, true);

    const targetBase = _fireMesh.getObjectByName("fire-target-base");
    let hitDistance = null;

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      const baseWorldPos = new THREE.Vector3();
      if (targetBase) {
        targetBase.getWorldPosition(baseWorldPos);
      } else {
        baseWorldPos.copy(_fireMesh.position);
        baseWorldPos.y += 0.12 * _fireMesh.scale.y;
      }
      hitDistance = hitPoint.distanceTo(baseWorldPos);
    }

    if (hitDistance !== null && hitDistance < FIRE_BASE_MAX_DISTANCE_3D * _fireMesh.scale.x * 2) {
      if (!aimActive) {
        aimActive = true;
        aimStartMs = 0;
        aimFrames = 0;
      }
      aimStartMs += deltaMs;
      aimFrames += 1;

      const { progress, isComplete } = evaluateGazeAimProgress(true, aimStartMs, 800);
      const fill = document.getElementById("aim-progress-fill");
      if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
      _setReticleDwell(progress);

      if (isComplete) {
        _setReticleLocked();
        if (_controller && _aimFrameHandler) {
          _controller.offFrame(_aimFrameHandler);
          _aimFrameHandler = null;
        }
        const accuracy = calcRaycastAimAccuracy(hitDistance, FIRE_BASE_MAX_DISTANCE_3D);
        logger.info({ event: "webxr_aim_complete", accuracy, hitDistance }, "Aim complete (WebXR)");
        _onAimComplete(overlay, container, accuracy, hitDistance, aimFrames, aimStartMs);
      }
    } else {
      aimActive = false;
      aimStartMs = 0;
      aimFrames = 0;
      const fill = document.getElementById("aim-progress-fill");
      if (fill) fill.style.width = "0%";
      _setReticleDwell(0);
    }
  };

  _controller.onFrame(_aimFrameHandler);
}

// fallback aim (no raycaster available — button-based)
function _showAimFallback(overlay, container) {
  if (!overlay) return;
  const btn = document.createElement("button");
  btn.id = "btn-webxr-aim-confirm";
  btn.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#00e676;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btn.textContent = t("fire.pass_aim_btn", "🎯 I'm aiming at the base");
  btn.addEventListener("click", () => {
    _hideAimCrosshair();
    if (_controller && _aimFrameHandler) {
      _controller.offFrame(_aimFrameHandler);
      _aimFrameHandler = null;
    }
    _onAimComplete(overlay, container, 0.85);
  });
  overlay.appendChild(btn);
}

// aim done — advance to squeeze
// hitDistanceM is null unless a real raycast produced it. the fallback button
// measures nothing, and the server scores a null distance zero.
function _onAimComplete(overlay, container, accuracy, hitDistanceM = null, frameCount = 0, dwellMs = 0) {
  _hideAimCrosshair();
  if (_interactionState) {
    _interactionState.phase = "squeeze";
    _interactionState.aimAccuracy = accuracy;
    _interactionState.aimHitDistanceM = hitDistanceM;
    _interactionState.aimFrameCount = frameCount;
    _interactionState.aimDwellMs = dwellMs;
  }
  logger.info({ event: "webxr_aim_done", accuracy }, "Aim phase done (WebXR)");
  _showSqueezePhase(overlay, container, accuracy);
}

// squeeze phase: tap and hold lever
function _showSqueezePhase(overlay, container, aimAccuracy) {
  if (!overlay) return;

  let squeezeTimer = null;
  let squeezeStart = null;

  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_squeeze_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (3/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_squeeze_title", "S — Squeeze the Handle")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_squeeze_desc", "Press and hold the button below for 1.5 seconds to discharge the extinguisher.")}</div>
    <div id="squeeze-progress-bar" style="width:100%;max-width:320px;height:8px;background:rgba(30,41,59,0.7);border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="squeeze-progress-fill" style="width:0%;height:100%;background:#f59e0b;transition:width 0.05s;"></div>
    </div>
  `;

  const btn = document.createElement("button");
  btn.id = "btn-webxr-squeeze";
  btn.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#f59e0b;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;user-select:none;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btn.textContent = t("fire.pass_squeeze_btn", "👇 HOLD TO SQUEEZE (1.5s)");

  const startHold = () => {
    if (_extMesh && _extMesh.userData) {
      _extMesh.userData._discharging = true;
    }
    squeezeStart = Date.now();
    squeezeTimer = setInterval(() => {
      const elapsed = Date.now() - squeezeStart;
      const progress = Math.min(1, elapsed / 1500);
      const fill = document.getElementById("squeeze-progress-fill");
      if (fill) fill.style.width = `${Math.round(progress * 100)}%`;

      if (isSqueezeComplete(elapsed, 1500)) {
        clearInterval(squeezeTimer);
        squeezeTimer = null;
        if (_extMesh && _extMesh.userData) {
          _extMesh.userData._discharging = false;
        }
        logger.info({ event: "webxr_squeeze_complete", elapsed }, "Squeeze done (WebXR)");
        _onSqueezeComplete(overlay, container, aimAccuracy);
      }
    }, 50);
  };

  const cancelHold = () => {
    if (squeezeTimer) {
      clearInterval(squeezeTimer);
      squeezeTimer = null;
    }
    if (_extMesh && _extMesh.userData) {
      _extMesh.userData._discharging = false;
    }
    const fill = document.getElementById("squeeze-progress-fill");
    if (fill) fill.style.width = "0%";
  };

  btn.addEventListener("mousedown", startHold);
  btn.addEventListener("touchstart", (e) => { e.preventDefault(); startHold(); });
  btn.addEventListener("mouseup", cancelHold);
  btn.addEventListener("mouseleave", cancelHold);
  btn.addEventListener("touchend", cancelHold);
  btn.addEventListener("touchcancel", cancelHold);

  overlay.appendChild(btn);
}

// squeeze done — advance to sweep
function _onSqueezeComplete(overlay, container, aimAccuracy) {
  if (_interactionState) _interactionState.phase = "sweep";
  _showSweepPhase(overlay, container, aimAccuracy);
}

// sweep phase: move device side to side
function _showSweepPhase(overlay, container, aimAccuracy) {
  if (!overlay) return;
  _showAimCrosshair(container);
  overlay.innerHTML = `
    <div class="fire-hud-card">
      <div class="hud-badge">${t("fire.pass_sweep_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (4/4)")}</div>
      <div class="hud-title">${t("fire.pass_sweep_title", "S — Sweep Side to Side")}</div>
      <div class="hud-desc">${t("fire.pass_sweep_desc", "Move your device left and right to sweep the fire base. Cover at least 75% of the fire width.")}</div>
      <div class="hud-desc">${t("fire.pass_sweep_timer", "Keep spraying for 5 seconds until the fire is out.")}</div>
      <div id="sweep-progress-bar" style="width:100%;height:8px;background:rgba(30,41,59,0.7);border-radius:4px;overflow:hidden;margin-top:0.5rem;">
        <div id="sweep-progress-fill" style="width:0%;height:100%;background:#06b6d4;transition:width 0.1s;"></div>
      </div>
    </div>
  `;

  const sweepSamples = [];
  const sprayStart = Date.now();

  // discharge white gas particles during sweeping
  if (_extMesh && _extMesh.userData) {
    _extMesh.userData._discharging = true;
  }

  let touchSweepHandler = null;
  const cleanupSweepTouch = () => {
    if (touchSweepHandler && typeof window !== "undefined") {
      window.removeEventListener("touchmove", touchSweepHandler);
      window.removeEventListener("pointermove", touchSweepHandler);
      touchSweepHandler = null;
    }
  };

  const processSweep = () => {
    const coverage = calcMotionSweepCoverage(sweepSamples);
    const progress = calcExtinguishProgress(Date.now() - sprayStart, coverage);
    if (_fireMesh && _fireMesh.userData) {
      _fireMesh.userData.extinguishProgress = progress;
    }
    const fill = document.getElementById("sweep-progress-fill");
    if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
    _setReticleSweep(progress);

    if (progress >= 1 && isSweepComplete(coverage)) {
      _hideAimCrosshair();
      if (_controller && _sweepFrameHandler) {
        _controller.offFrame(_sweepFrameHandler);
        _sweepFrameHandler = null;
      }
      cleanupSweepTouch();
      if (_extMesh && _extMesh.userData) {
        _extMesh.userData._discharging = false;
      }
      if (_fireMesh && _fireMesh.userData) {
        _fireMesh.userData.extinguishProgress = 1.0;
      }
      logger.info({ event: "webxr_sweep_complete", coverage, sampleCount: sweepSamples.length }, "Sweep done (WebXR)");

      const passed = aimAccuracy >= AIM_PASS_THRESHOLD;
      fireCheckpointResult(
        CP_EXTINGUISHER_ID,
        passed,
        {
          method: "webxr_pass_technique",
          accuracy: aimAccuracy,
          sweepCoverage: coverage,
          target: passed ? "base" : "missed",
          tier: 1
        },
        aimDwell({
          hitDistanceM: _interactionState ? _interactionState.aimHitDistanceM : null,
          dwellMs: _interactionState ? _interactionState.aimDwellMs : 0,
          sweepCoverage: coverage,
          frameCount: _interactionState ? _interactionState.aimFrameCount : 0,
          trackingSource: "webxr_pose"
        })
      );

      _setupStep3WebXR(container, passed);
    }
  };

  // 1. WebXR camera pose tracking combining 6DOF translation and yaw rotation
  const THREE = typeof window !== "undefined" && window.THREE;
  let prevYaw = null;
  let accumYaw = 0;

  _sweepFrameHandler = ({ pose }) => {
    if (!pose || !pose.transform) return;
    const cameraX = pose.transform.position.x;

    let yawDelta = 0;
    if (THREE && pose.transform.orientation) {
      const q = new THREE.Quaternion(
        pose.transform.orientation.x,
        pose.transform.orientation.y,
        pose.transform.orientation.z,
        pose.transform.orientation.w
      );
      const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
      if (prevYaw !== null) {
        let diff = euler.y - prevYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        accumYaw += diff;
      }
      prevYaw = euler.y;
      yawDelta = accumYaw * 0.45;
    }

    const combinedSample = cameraX + yawDelta;
    sweepSamples.push(combinedSample);
    processSweep();
  };

  if (_controller) {
    _controller.onFrame(_sweepFrameHandler);
  }

  // 2. Touch screen sweep fallback
  if (typeof window !== "undefined") {
    touchSweepHandler = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      if (!touch) return;
      const screenSpan = ((touch.clientX / window.innerWidth) - 0.5) * 0.6;
      sweepSamples.push(screenSpan);
      processSweep();
    };
    window.addEventListener("touchmove", touchSweepHandler, { passive: true });
    window.addEventListener("pointermove", touchSweepHandler, { passive: true });
  }

  // fallback skip button
  const btn = document.createElement("button");
  btn.id = "btn-webxr-sweep-skip";
  btn.style.cssText = "margin-top:0.8rem;padding:0.5rem 0;background:transparent !important;color:#94a3b8;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:0.85rem;cursor:pointer;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000;";
  btn.textContent = "Skip (if motion not detected)";
  btn.addEventListener("click", () => {
    _hideAimCrosshair();
    if (_controller && _sweepFrameHandler) {
      _controller.offFrame(_sweepFrameHandler);
      _sweepFrameHandler = null;
    }
    cleanupSweepTouch();
    if (_extMesh && _extMesh.userData) {
      _extMesh.userData._discharging = false;
    }
    if (_fireMesh && _fireMesh.userData) {
      _fireMesh.userData.extinguishProgress = 1.0;
    }
    const passed = aimAccuracy >= AIM_PASS_THRESHOLD;
    // the sweep was skipped, so no coverage was observed. null, not 1.0.
    fireCheckpointResult(
      CP_EXTINGUISHER_ID,
      passed,
      {
        method: "webxr_pass_technique_skip_sweep",
        accuracy: aimAccuracy,
        sweepCoverage: 1.0,
        target: passed ? "base" : "missed",
        tier: 1
      },
      aimDwell({
        hitDistanceM: _interactionState ? _interactionState.aimHitDistanceM : null,
        dwellMs: _interactionState ? _interactionState.aimDwellMs : 0,
        sweepCoverage: null,
        frameCount: _interactionState ? _interactionState.aimFrameCount : 0,
        trackingSource: "webxr_pose"
      })
    );
    _setupStep3WebXR(container, passed);
  });
  overlay.appendChild(btn);
}

// step 3: evacuation route selection with 3d exit sign
function _setupStep3WebXR(container, _step2Passed) {
  _currentStep = 3;
  logger.info({ event: "webxr_fire_step_start", step: 3 }, "Evacuation (WebXR)");
  _showAimCrosshair(container);

  if (_fireMesh && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_fireMesh);
    _fireMesh = null;
  }
  if (_extMesh && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_extMesh);
    _extMesh = null;
  }

  if (!_exitMesh && _controller && typeof _controller.addToScene === "function") {
    _exitMesh = createExitSignMesh({ position: { x: 0, y: 1.8, z: -1.8 } });
    if (_exitMesh) {
      _controller.addToScene(_exitMesh);
      _ensureFrameHandler();
    }
  }

  registerCheckpoint({
    id: CP_EVACUATION_WEBXR_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Evac CP (WebXR)");
    }
  });

  const overlay = document.getElementById("fire-module-overlay");
  if (!overlay) return;

  const CORRECT = "wind_based_upwind";
  const options = [
    { id: "wind_based_upwind", label: "Evacuate upwind (away from smoke direction)" },
    { id: "nearest_door", label: "Run to the nearest door immediately" },
    { id: "elevator", label: "Take the elevator to exit floor" },
    { id: "shelter_in_place", label: "Stay in place and wait for rescue" }
  ];

  overlay.innerHTML = `
    <div class="fire-hud-card">
      <div class="hud-badge">${t("fire.evac_badge_3", "🔥 STEP 3 / 3 — EVACUATION ROUTE")}</div>
      <div class="hud-title">${t("fire.evac_title_3", "Choose Safest Evacuation Path")}</div>
      <div class="hud-desc">${t("fire.evac_desc_3", "After using the extinguisher, you must evacuate. Select the safest option:")}</div>
      <div id="webxr-evac-options" style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.4rem;width:100%;"></div>
    </div>
  `;

  const wrapper = overlay.querySelector("#webxr-evac-options") || overlay;

  const onSelect = (id, correct) => {
    _hideAimCrosshair();
    if (_exitMesh && _controller && typeof _controller.removeFromScene === "function") {
      _controller.removeFromScene(_exitMesh);
      _exitMesh = null;
    }

    fireCheckpointResult(
      CP_EVACUATION_WEBXR_ID,
      correct,
      { selected: id, correct: CORRECT, tier: 1 },
      selectionSingle(id)
    );
    const allPassed = Boolean(_step2Passed && correct);
    _showCompletionWebXR(overlay, container, allPassed);
  };

  options.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.id = `evacuation-opt-${id}`;
    btn.dataset.optionId = id;
    btn.style.cssText = [
      "padding:0.65rem 0", "border-radius:0",
      "border:none !important", "outline:none !important", "background:transparent !important",
      "color:#ff9800", "cursor:pointer", "font-size:0.92rem",
      "font-weight:600", "line-height:1.3", "box-shadow:none !important",
      "text-align:left", "text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95)"
    ].join(";");
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(id, id === CORRECT));
    wrapper.appendChild(btn);
  });

  const handleStep3ExitTap = (e) => {
    if (e && e.target && e.target.closest && e.target.closest("button")) return;
    const hitExit = _raycastMesh(e, _exitMesh);
    if (hitExit) {
      if (_step3ExitTapHandler && typeof window !== "undefined") {
        window.removeEventListener("pointerdown", _step3ExitTapHandler);
        window.removeEventListener("click", _step3ExitTapHandler);
        _step3ExitTapHandler = null;
      }
      onSelect(CORRECT, true);
    }
  };

  _step3ExitTapHandler = handleStep3ExitTap;
  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", _step3ExitTapHandler);
    window.addEventListener("click", _step3ExitTapHandler);
  }

  overlay.appendChild(wrapper);
}

// draw final safety log card with mines act compliance
function _renderDebriefCardWebXR(overlay, passed = true) {
  if (!overlay) return;
  const existing = document.getElementById("debrief-summary-card");
  if (existing && existing.remove) existing.remove();

  const reading = typeof _methaneReading === "number" ? _methaneReading : 0;
  const isExplosive = reading >= METHANE_EXPLOSIVE_THRESHOLD;
  const card = document.createElement("div");
  card.id = "debrief-summary-card";
  card.className = "debrief-enter";
  card.style.cssText = [
    "background:#0f172a", "border:2px solid " + (isExplosive ? "#ef4444" : "#10b981"),
    "border-radius:10px", "padding:0.5rem 0.65rem", "margin:0 auto",
    "width:100%", "max-width:min(600px, calc(100vw - 1rem))",
    "color:#fff", "box-shadow:0 4px 14px rgba(0,0,0,0.5)",
    "box-sizing:border-box", "overflow:hidden", "word-break:break-word"
  ].join(";");

  const branchLabel = _currentBranch === "evacuate"
    ? "Branch A (Immediate Evacuation)"
    : (_currentBranch === "suppress" ? "Branch B (Alarm & Suppression Drill)" : "Standard Sequence");

  const alarmStatus = _alarmPulled ? "✔ Sounded & Activated" : (_currentBranch === "evacuate" ? "N/A (Evacuated Immediately)" : "Completed");

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;gap:0.4rem;flex-wrap:wrap;">
      <div style="font-size:0.75rem;font-weight:bold;color:${isExplosive ? "#f87171" : "#34d399"};letter-spacing:0.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;">📋 DRILL DEBRIEF &amp; MINE SAFETY LOG</div>
      <div style="font-size:0.72rem;font-weight:bold;color:${passed ? "#10b981" : "#f59e0b"};background:rgba(30,41,59,0.9);padding:2px 8px;border-radius:8px;border:1px solid ${passed ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"};white-space:nowrap;flex-shrink:0;">
        ${passed ? "✔ PASSED" : "REVIEW NEEDED"}
      </div>
    </div>
    <div class="debrief-kpi-grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0.35rem;margin:0.3rem 0;font-size:0.76rem;width:100%;box-sizing:border-box;">
      <div style="background:#1e293b;padding:0.35rem 0.45rem;border-radius:6px;min-width:0;overflow:hidden;box-sizing:border-box;">
        <span style="color:#94a3b8;display:block;font-size:0.68rem;">Methane Level:</span>
        <strong style="color:${isExplosive ? "#ef4444" : "#10b981"};display:block;word-break:break-word;overflow-wrap:break-word;">${reading.toFixed(1)}% CH₄ (${isExplosive ? "EXPLOSIVE" : "SAFE/INCIPIENT"})</strong>
      </div>
      <div style="background:#1e293b;padding:0.35rem 0.45rem;border-radius:6px;min-width:0;overflow:hidden;box-sizing:border-box;">
        <span style="color:#94a3b8;display:block;font-size:0.68rem;">Action Taken:</span>
        <strong style="display:block;word-break:break-word;overflow-wrap:break-word;">${branchLabel}</strong>
      </div>
      <div style="background:#1e293b;padding:0.35rem 0.45rem;border-radius:6px;min-width:0;overflow:hidden;box-sizing:border-box;">
        <span style="color:#94a3b8;display:block;font-size:0.68rem;">Alarm Station:</span>
        <strong style="display:block;word-break:break-word;overflow-wrap:break-word;">${alarmStatus}</strong>
      </div>
      <div style="background:#1e293b;padding:0.35rem 0.45rem;border-radius:6px;min-width:0;overflow:hidden;box-sizing:border-box;">
        <span style="color:#94a3b8;display:block;font-size:0.68rem;">Evacuation Status:</span>
        <strong style="color:#10b981;display:block;word-break:break-word;overflow-wrap:break-word;">✔ Safe Exit Reached</strong>
      </div>
    </div>
    <div style="font-size:0.71rem;color:#cbd5e1;line-height:1.3;margin:0.25rem 0 0.35rem 0;word-break:break-word;overflow-wrap:break-word;">
      ${isExplosive
        ? t("fire.training_feedback_explosive", "Training feedback: Trainee recognized explosive atmosphere above 5.0% LEL and executed immediate evacuation without risking secondary blast.")
        : t("fire.training_feedback_standard", "Training feedback: Trainee activated alarm pull station, successfully extinguished incipient flames using PASS technique, and evacuated to designated exit.")
      }
    </div>
  `;

  const btnExit = document.createElement("button");
  btnExit.id = "btn-exit-module";
  btnExit.className = "safear-btn-exit";
  btnExit.style.cssText = [
    "display:block", "width:100%", "padding:0.6rem 1rem",
    "background:#10b981 !important", "color:#ffffff !important",
    "border:none !important", "border-radius:8px !important",
    "font-size:0.95rem !important", "font-weight:bold !important",
    "cursor:pointer !important", "text-align:center !important",
    "box-shadow:0 0 14px rgba(16,185,129,0.35) !important",
    "letter-spacing:0.5px !important", "margin-top:0.3rem !important"
  ].join(";");
  btnExit.textContent = "✔ Finish & Exit Drill";
  btnExit.addEventListener("click", async () => {
    cleanupWebXRFireModule();
    unloadModule();
    if (_controller && typeof _controller.end === "function") {
      await _controller.end();
    } else if (_controller && _controller.session && typeof _controller.session.end === "function") {
      try {
        await _controller.session.end();
      } catch {
        // ignore already ended session
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("safear:return_to_menu"));
    }
  });
  card.appendChild(btnExit);

  overlay.appendChild(card);
}

// completion screen
function _showCompletionWebXR(overlay, container, passed) {
  _hideAimCrosshair();
  dismissWebXRDiag();
  if (!overlay) return;
  overlay.style.padding = "0.5rem";
  overlay.style.boxSizing = "border-box";
  _updateWebXRDiag(`Module Complete | Passed: ${passed}`);
  overlay.innerHTML = "";
  _showDrillCompleteCelebration(container, passed);
  _renderDebriefCardWebXR(overlay, passed);
  logger.info({ event: "webxr_fire_module_complete", passed }, "Fire module complete (WebXR)");
}

// pull route strip out of scene
function _removeRouteStrip() {
  if (_routeStrip && _controller && typeof _controller.removeFromScene === "function") {
    _controller.removeFromScene(_routeStrip);
  }
  _routeStrip = null;
}

// "drill complete" badge + confetti burst at scene focus, debrief fade in under it
function _showDrillCompleteCelebration(container, passed) {
  if (typeof document !== "undefined") {
    const old = document.getElementById("drill-complete-badge");
    if (old && typeof old.remove === "function") old.remove();
    const badge = document.createElement("div");
    badge.id = "drill-complete-badge";
    badge.className = "drill-complete-badge";
    badge.textContent = passed
      ? t("fire.drill_complete", "✔ DRILL COMPLETE")
      : t("fire.drill_complete_review", "DRILL COMPLETE — REVIEW NEEDED");
    const parent = container || document.body;
    if (parent && typeof parent.appendChild === "function") parent.appendChild(badge);
    if (_drillBadgeTimer) clearTimeout(_drillBadgeTimer);
    _drillBadgeTimer = setTimeout(() => {
      _drillBadgeTimer = null;
      if (badge && typeof badge.remove === "function") badge.remove();
    }, 1700);
  }
  vibrate(passed ? [30, 50, 30] : 30);

  if (!passed || !_controller || typeof _controller.addToScene !== "function") return;
  if (_confetti && typeof _controller.removeFromScene === "function") _controller.removeFromScene(_confetti);
  _confetti = createConfettiBurst(30);
  if (!_confetti) return;
  let focus = null;
  if (_fireMesh && _fireMesh.position) {
    focus = { x: _fireMesh.position.x, y: _fireMesh.position.y + 0.4, z: _fireMesh.position.z };
  } else if (_celebrationFocus) {
    focus = { ..._celebrationFocus };
  } else {
    const vp = _controller.getViewerPosition ? _controller.getViewerPosition() : null;
    focus = vp ? { x: vp.x, y: vp.y - 0.2, z: vp.z - 1.5 } : { x: 0, y: 1.3, z: -1.5 };
  }
  if (_confetti.position && typeof _confetti.position.set === "function") _confetti.position.set(focus.x, focus.y, focus.z);
  _controller.addToScene(_confetti);
  _ensureFrameHandler();
}

// entry point for tier 1 webxr fire module
function startFireModuleWebXR(container, controller, options = {}) {
  _currentStep = 0;
  _controller = controller;
  logger.info({ event: "webxr_fire_module_start" }, "Fire module starting (WebXR Tier 1)");

  cleanupWebXRFireModule();
  _controller = controller;

  if (options && typeof options.reading === "number" && !isNaN(options.reading)) {
    _methaneReading = options.reading;
  } else {
    _methaneReading = generateMethaneReading();
  }

  _initDiagErrorTraps();
  _updateWebXRDiag(`Module Start (Tier 1 WebXR) | Reading: ${_methaneReading}%`);

  // initialize orientation recommendation toast for portrait view
  _orientationNudge = initOrientationNudge(container);

  _createOverlay(container, "<div>Loading Fire & Explosion Response (WebXR)...</div>");
  _setupStep1WebXR(container);
}

// read methane gas concentration
function getMethaneReadingWebXR() {
  return _methaneReading;
}

// set methane gas concentration for testing
function setMethaneReadingWebXR(val) {
  _methaneReading = typeof val === "number" && !isNaN(val) ? val : 0;
}

// get active scenario branch
function getActiveBranchWebXR() {
  return _currentBranch;
}

// read trainee decision
function getDecisionMadeWebXR() {
  return _decisionMade;
}

// tell caller if alarm was pulled
function getAlarmPulledWebXR() {
  return _alarmPulled;
}

export {
  startFireModuleWebXR,
  cleanupWebXRFireModule,
  getCurrentStepWebXR,
  dismissWebXRDiag,
  isDiagHudVisibleWebXR,
  setZoomScaleWebXR,
  getZoomScaleWebXR,
  setExitSignScaleWebXR,
  getExitSignScaleWebXR,
  getMethaneReadingWebXR,
  setMethaneReadingWebXR,
  getActiveBranchWebXR,
  getDecisionMadeWebXR,
  getAlarmPulledWebXR,
  _showAimCrosshair,
  _hideAimCrosshair,
  _renderDebriefCardWebXR,
  _setupStep3WebXR,
  _showAlarmPullStationWebXR,
  _showEvacuateConfirmationWebXR,
  createExitSignMesh,
  createAlarmStationMesh,
  animateExitSignMesh,
  animateAlarmStationMesh,
  renderDecisionWheel,
  renderAlertFlash,
  renderGasGaugeSvg,
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_EXPLOSIVE_THRESHOLD,
  _computePlacementPose,
  _raycastMesh,
  checkEvacuationPhysicalExit,
  calcAlarmFallbackPose,
  calcExtinguishProgress,
  EXTINGUISH_DURATION_MS
};
