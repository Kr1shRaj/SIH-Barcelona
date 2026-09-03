import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { unloadModule } from "../../js/module-loader.js";
import { buildFireGraphic, buildExitGraphic, buildExtinguisherGraphic } from "./graphics.js";
import { t } from "../../js/i18n.js";
import { playNarration, stopNarration } from "../../js/audio.js";
import {
  startAssessmentSession,
  finishAssessmentSession,
  abortAssessmentSession,
  getActiveSession,
  bindAssessmentSessionListeners
} from "../../assessment/engine.js";

const logger = createLogger("FireModule");
const _activeCleanups = [];
function addCleanup(fn) {
  if (typeof fn === "function") _activeCleanups.push(fn);
}

// checkpoint ids — stable identifiers for assessment engine to key on
const CP_EXIT_ID = "fire_exit_identification";
const CP_EXTINGUISHER_ID = "fire_extinguisher_aim";
const CP_EVACUATION_ID = "fire_evacuation_sequence";

// aim must score >= 0.6 to pass: within 40% of max-miss radius counts as good aim
const AIM_PASS_THRESHOLD = 0.6;

// max 3D distance from base before accuracy hits 0.0 — fire entity is ~0.8m high
const FIRE_BASE_MAX_DISTANCE_3D = 0.8;

// target 3D base coordinate relative to marker space
const FIRE_BASE_TARGET_3D = { x: 0, y: 0.3, z: 0 };

let _exitGraphicEl = null;

// track which step is active; steps are sequential — next only registers after prev passes
let _currentStep = 0;

// expose current step for testing and assessment engine reads
function getCurrentStep() { return _currentStep; }

// inject dom overlay panel into container for marker/webxr overlay ui
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

// compute 3D Euclidean distance from raycast point to target base
function calcIntersectionDistance(intersectionPoint, targetPoint = FIRE_BASE_TARGET_3D) {
  if (!intersectionPoint || typeof intersectionPoint.x !== "number") {
    return null;
  }
  const target = targetPoint || FIRE_BASE_TARGET_3D;
  const tx = typeof target.x === "number" ? target.x : 0;
  const ty = typeof target.y === "number" ? target.y : 0;
  const tz = typeof target.z === "number" ? target.z : 0;
  return Math.hypot(intersectionPoint.x - tx, intersectionPoint.y - ty, intersectionPoint.z - tz);
}

// compute aim accuracy from 3D distance, 0.0-1.0
function calcRaycastAimAccuracy(distance3D, maxDistance = FIRE_BASE_MAX_DISTANCE_3D) {
  if (typeof distance3D !== "number" || isNaN(distance3D) || distance3D < 0) {
    return null;
  }
  return Math.max(0, Math.min(1, 1 - distance3D / maxDistance));
}

// polymorphic accuracy calculator supporting 3D distance, point, or legacy fallback
function _calcAimAccuracy(input, arg2, arg3) {
  if (typeof input === "number") {
    return calcRaycastAimAccuracy(input, typeof arg2 === "number" ? arg2 : FIRE_BASE_MAX_DISTANCE_3D);
  }
  if (input && typeof input.x === "number") {
    const dist = calcIntersectionDistance(input, arg2);
    return calcRaycastAimAccuracy(dist);
  }
  // legacy DOM rect fallback if given tapX, tapY, element
  if (arg3 && typeof arg3.getBoundingClientRect === "function") {
    const rect = arg3.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.bottom;
    const dist = Math.hypot(input - targetX, arg2 - targetY);
    return Math.max(0, 1 - dist / 80);
  }
  return null;
}

// render 3D fire entity anchored to camera so AR.js shows it without printed marker
function _renderFireGraphic(container) {
  const camera = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? (document.querySelector("#main-camera") || document.querySelector("[camera]"))
    : null;
  const scene = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-scene")
    : null;

  const graphic = buildFireGraphic();

  // anchor to camera on the ground floor (SENAR markerless benchmark)
  if (camera) {
    graphic.setAttribute("position", "0 -1.15 -2.2");
    graphic.setAttribute("rotation", "0 0 0");
    graphic.setAttribute("scale", "0.60 0.60 0.60");
    graphic.setAttribute("visible", "true");
    camera.appendChild(graphic);
  } else if (scene) {
    graphic.setAttribute("position", "0 -1.15 -2.2");
    graphic.setAttribute("rotation", "0 0 0");
    graphic.setAttribute("scale", "0.90 0.90 0.90");
    graphic.setAttribute("visible", "true");
    scene.appendChild(graphic);
  } else {
    const parent = container;
    if (parent && parent.appendChild) {
      parent.appendChild(graphic);
    }
  }

  return graphic;
}

// render 3D exit sign entity anchored to camera so AR.js shows it without marker
function _renderExitGraphic(container) {
  const camera = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? (document.querySelector("#main-camera") || document.querySelector("[camera]"))
    : null;
  const scene = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-scene")
    : null;

  const el = buildExitGraphic();
  _exitGraphicEl = el;
  // anchor to camera so exit sign renders without printed marker
  if (camera) {
    el.setAttribute("position", "0 0.60 -2.5");
    el.setAttribute("rotation", "0 0 0");
    camera.appendChild(el);
  } else if (scene) {
    el.setAttribute("position", "0 0.85 -2.2");
    el.setAttribute("rotation", "0 0 0");
    scene.appendChild(el);
  } else {
    const parent = container;
    if (parent && parent.appendChild) {
      parent.appendChild(el);
    }
  }
  return el;
}

// render 3D fire extinguisher directly in front of trainee (markerless/world AR)
function _renderExtinguisherGraphic(container) {
  const camera = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? (document.querySelector("#main-camera") || document.querySelector("[camera]"))
    : null;
  const scene = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-scene")
    : null;
  const hiroMarker = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? (document.querySelector("#hiro-marker") || document.querySelector("a-marker[preset='hiro']"))
    : null;

  const el = buildExtinguisherGraphic();

  // anchor extinguisher to first-person view (SENAR trainee hands look)
  if (camera) {
    el.setAttribute("position", "0.28 -0.22 -0.80");
    el.setAttribute("rotation", "0 -15 0");
    el.setAttribute("scale", "0.24 0.24 0.24");
    camera.appendChild(el);
  } else if (scene) {
    el.setAttribute("position", "0 0.05 -1.5");
    el.setAttribute("rotation", "0 0 0");
    el.setAttribute("scale", "0.60 0.60 0.60");
    scene.appendChild(el);
  } else {
    const parent = hiroMarker || container;
    if (parent && parent.appendChild) {
      parent.appendChild(el);
    }
  }
  return el;
}

// build evacuation option buttons for step 3
function _renderEvacuationOptions(container, onSelect) {
  const CORRECT = "sound_alarm_then_evacuate";
  const options = [
    { id: "gather_belongings", label: t("modules.fire_response.opt_gather_belongings", {}, "Gather belongings first") },
    { id: "sound_alarm_then_evacuate", label: t("modules.fire_response.opt_sound_alarm_then_evacuate", {}, "Sound alarm → evacuate") },
    { id: "use_elevator", label: t("modules.fire_response.opt_use_elevator", {}, "Use elevator to escape") },
    { id: "wait_for_instructions", label: t("modules.fire_response.opt_wait_for_instructions", {}, "Wait at desk for instructions") }
  ];

  const wrapper = document.createElement("div");
  wrapper.id = "evacuation-options";
  wrapper.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.6rem;width:100%;";

  options.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.id = `evacuation-opt-${id}`;
    btn.dataset.optionId = id;
    btn.style.cssText = [
      "padding:0.75rem 0.5rem", "border-radius:10px",
      "border:2px solid #ff6a00", "background:#1e293b",
      "color:#fff", "cursor:pointer", "font-size:0.86rem",
      "font-weight:600", "line-height:1.3", "box-shadow:0 2px 8px rgba(0,0,0,0.4)"
    ].join(";");
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(id, id === CORRECT));
    wrapper.appendChild(btn);
  });

  if (container && container.appendChild) {
    container.appendChild(wrapper);
  }
  return wrapper;
}

// render subscreen with educational text and next navigation button
function _renderSubscreen(overlay, { badge, title, desc, buttonText, onNext }) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="fire-hud-card">
      <div class="hud-badge">${badge}</div>
      <div class="hud-title">${title}</div>
      <div class="hud-desc">${desc}</div>
    </div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", onNext);
  const card = overlay.querySelector(".fire-hud-card");
  if (card && card.appendChild) {
    card.appendChild(btnNext);
  }
  overlay.appendChild(btnNext);
}

// step 1: proximity — user learns exit protocols and taps "I see the exit"
function _setupStep1(container, tierInfo) {
  _currentStep = 1;
  logger.info({ event: "fire_step_start", step: 1 }, "Exit identification");
  playNarration({ moduleId: "fire-response", stepKey: "step_1_exit" });

  registerCheckpoint({
    id: CP_EXIT_ID,
    type: "proximity",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Exit CP triggered");
    }
  });

  _renderExitGraphic(container);

  const overlay = document.getElementById("fire-module-overlay");
  playNarration({ moduleId: "fire-response", stepKey: "step_1_exit" });

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
      buttonText: t("fire.exit_next_3", "Next: Locate Exit in AR ➜")
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div class="fire-hud-card">
          <div class="hud-badge">🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)</div>
          <div class="hud-title">Locate Emergency Exit</div>
          <div class="hud-desc">Look for the illuminated green emergency sign anchored in AR space. Align your view with the evacuation path.</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.id = "btn-exit-found";
      btn.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
      btn.textContent = t("modules.fire_response.btn_exit", {}, "✔ I see the exit");
      btn.addEventListener("click", () => {
        fireCheckpointResult(CP_EXIT_ID, true, { method: "button_confirm" });
        _setupStep2(container, tierInfo);
      });
      const card = overlay.querySelector(".fire-hud-card");
      if (card && card.appendChild) {
        card.appendChild(btn);
      }
      overlay.appendChild(btn);
    }
  }

  let subIndex = 0;
  function renderCurrentSubscreen() {
    if (subIndex < screens.length) {
      _renderSubscreen(overlay, {
        ...screens[subIndex],
        onNext: () => {
          subIndex++;
          renderCurrentSubscreen();
        }
      });
    } else {
      showActionScreen();
    }
  }

  renderCurrentSubscreen();
}

// gesture thresholds and constants for PASS extinguisher interaction
const PIN_PULL_THRESHOLD_PX = 50;
const AIM_HOLD_DURATION_MS = 800;
const SQUEEZE_HOLD_DURATION_MS = 1500;
const SWEEP_MIN_COVERAGE = 0.75;

// compute 2d drag distance from start position to current position
function calcDragDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  const x1 = typeof p1.x === "number" ? p1.x : (typeof p1.clientX === "number" ? p1.clientX : 0);
  const y1 = typeof p1.y === "number" ? p1.y : (typeof p1.clientY === "number" ? p1.clientY : 0);
  const x2 = typeof p2.x === "number" ? p2.x : (typeof p2.clientX === "number" ? p2.clientX : 0);
  const y2 = typeof p2.y === "number" ? p2.y : (typeof p2.clientY === "number" ? p2.clientY : 0);
  return Math.hypot(x2 - x1, y2 - y1);
}

// verify if pin pull drag displacement meets minimum threshold
function isPinPullComplete(dragDistance, threshold = PIN_PULL_THRESHOLD_PX) {
  return typeof dragDistance === "number" && !isNaN(dragDistance) && dragDistance >= threshold;
}

// verify if aim reticle hold duration on target meets required minimum
function isAimHoldComplete(heldDurationMs, minDurationMs = AIM_HOLD_DURATION_MS) {
  return typeof heldDurationMs === "number" && !isNaN(heldDurationMs) && heldDurationMs >= minDurationMs;
}

// check if aim distance is within target zone
function isAimInTargetZone(distance3D, maxDistance = FIRE_BASE_MAX_DISTANCE_3D) {
  return typeof distance3D === "number" && !isNaN(distance3D) && distance3D >= 0 && distance3D <= maxDistance;
}

// verify if lever squeeze duration meets continuous threshold
function isSqueezeComplete(durationMs, minDurationMs = SQUEEZE_HOLD_DURATION_MS) {
  return typeof durationMs === "number" && !isNaN(durationMs) && durationMs >= minDurationMs;
}

// default physical horizontal motion sweep span target in 3D marker units (~0.4m physical sweep)
const MOTION_SWEEP_TARGET_SPAN = 0.4;

// compute horizontal coverage fraction of swipe gestures across track width
function calcSweepCoverage(positionsX = [], trackWidth = 240) {
  if (!Array.isArray(positionsX) || positionsX.length === 0 || typeof trackWidth !== "number" || trackWidth <= 0) {
    return 0;
  }
  const validPositions = positionsX.filter((x) => typeof x === "number" && !isNaN(x));
  if (validPositions.length === 0) return 0;
  const minX = Math.min(...validPositions);
  const maxX = Math.max(...validPositions);
  const span = Math.max(0, maxX - minX);
  return Math.min(1, Math.round((span / trackWidth) * 100) / 100);
}

// compute horizontal sweep coverage fraction from physical camera motion samples
function calcMotionSweepCoverage(samples = [], targetSpan = MOTION_SWEEP_TARGET_SPAN) {
  if (!Array.isArray(samples) || samples.length === 0 || typeof targetSpan !== "number" || targetSpan <= 0) {
    return 0;
  }
  const valid = samples
    .map((s) => (typeof s === "number" ? s : (s && typeof s.x === "number" ? s.x : null)))
    .filter((x) => typeof x === "number" && !isNaN(x));
  if (valid.length === 0) return 0;
  const minX = Math.min(...valid);
  const maxX = Math.max(...valid);
  const span = Math.max(0, maxX - minX);
  return Math.min(1, Math.round((span / targetSpan) * 100) / 100);
}

// verify if sweep coverage across fire base meets threshold
function isSweepComplete(coverageFraction, threshold = SWEEP_MIN_COVERAGE) {
  return typeof coverageFraction === "number" && !isNaN(coverageFraction) && coverageFraction >= threshold;
}

// transition selection state on interactive 3d target
function evaluateSelectionState(currentState = false, actionType = "toggle") {
  if (actionType === "select") return true;
  if (actionType === "deselect") return false;
  if (actionType === "toggle") return !currentState;
  return Boolean(currentState);
}

// verify whether gesture action can proceed based on selection state
function canExecuteSelectedAction(isSelected = false) {
  return isSelected === true;
}

// compute progress fraction and completion for gaze-based aim hold
function evaluateGazeAimProgress(isIntersecting, elapsedMs = 0, holdDurationMs = AIM_HOLD_DURATION_MS) {
  if (!isIntersecting || typeof elapsedMs !== "number" || elapsedMs <= 0 || typeof holdDurationMs !== "number" || holdDurationMs <= 0) {
    return { progress: 0, isComplete: false };
  }
  const progress = Math.min(1, Math.round((elapsedMs / holdDurationMs) * 100) / 100);
  const isComplete = progress >= 1;
  return { progress, isComplete };
}

// compute 3d distance from camera to marker in meters
function calcMarkerDistance(pos) {
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") {
    return null;
  }
  return Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
}

// check if trainee is within safe industrial standoff distance (1.5m - 3.5m)
function isSafeStandoffDistance(distanceMeters) {
  if (typeof distanceMeters !== "number" || isNaN(distanceMeters)) return false;
  return distanceMeters >= 1.5 && distanceMeters <= 3.5;
}

// step 2: aim — user performs sequential PASS physical gesture interactions
function _setupStep2(container, tierInfo) {
  _currentStep = 2;
  logger.info({ event: "fire_step_start", step: 2, tier: tierInfo && tierInfo.tier }, "Extinguisher aim");
  playNarration({ moduleId: "fire-response", stepKey: "step_2_extinguisher" });

  registerCheckpoint({
    id: CP_EXTINGUISHER_ID,
    type: "aim",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Extinguisher CP triggered");
    }
  });

  playNarration({ moduleId: "fire-response", stepKey: "step_2_extinguisher" });

  // clean up step 1 exit graphic completely so only step 2 entities are visible
  const scene = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-scene")
    : null;
  const camera = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? (document.querySelector("#main-camera") || document.querySelector("[camera]"))
    : null;
  const searchRoots = [scene, camera].filter(Boolean);
  searchRoots.forEach((root) => {
    if (root && typeof root.querySelectorAll === "function") {
      root.querySelectorAll("#exit-graphic, #exit-board, #exit-arrow-shaft, #exit-arrow-head").forEach((el) => {
        if (typeof el.removeAttribute === "function") el.removeAttribute("animation");
        if (typeof el.setAttribute === "function") el.setAttribute("visible", "false");
        if (el.object3D) {
          el.object3D.visible = false;
          if (root.object3D) root.object3D.remove(el.object3D);
        }
      });
    }
  });

  if (_exitGraphicEl) {
    if (typeof _exitGraphicEl.removeAttribute === "function") _exitGraphicEl.removeAttribute("animation");
    if (typeof _exitGraphicEl.setAttribute === "function") _exitGraphicEl.setAttribute("visible", "false");
    if (_exitGraphicEl.object3D) {
      _exitGraphicEl.object3D.visible = false;
      const parentObj = _exitGraphicEl.parentEl && _exitGraphicEl.parentEl.object3D;
      if (parentObj) parentObj.remove(_exitGraphicEl.object3D);
    }
    if (_exitGraphicEl.parentNode) _exitGraphicEl.parentNode.removeChild(_exitGraphicEl);
    _exitGraphicEl = null;
  }

  const graphic = _renderFireGraphic(container);
  _renderExtinguisherGraphic(container);
  const overlay = document.getElementById("fire-module-overlay");

  let _recordedAccuracy = null;
  let _recordedDistance = null;

  // pass sub-step 1: P — Pull pin tap-to-select then drag gesture on 3D extinguisher
  function _renderPullPin() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="fire-hud-card">
        <div class="hud-badge">${t("fire.pass_pull_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (1/4)")}</div>
        <div class="hud-title">${t("fire.pass_pull_title", "P — Pull the Pin")}</div>
        <div id="pin-instruction-text" class="hud-desc">${t("fire.pass_pull_desc", "Tap the golden safety pin (or button below) to select, then drag right to unlock.")}</div>
        <button id="pin-status-badge" style="display:block;width:100%;padding:12px 18px;border-radius:10px;border:2px solid #00e5ff;background:#0f172a;color:#00e5ff;font-size:0.95rem;font-weight:bold;cursor:pointer;margin:0.3rem 0;box-shadow:0 0 15px rgba(0,229,255,0.3);pointer-events:auto !important;text-align:center;">👉 TAP HERE TO SELECT PIN</button>
      </div>
    `;

    // target 3d pin sub-entities and 3d progress bar
    const pin = document.getElementById("extinguisher-pin");
    const progressFill = document.getElementById("pin-progress-fill");
    const statusBadge = document.getElementById("pin-status-badge");
    const instructionText = document.getElementById("pin-instruction-text");

    const BASE_PIN_X = 0.06;
    const BASE_PIN_Y = 0.88;
    const BASE_PIN_Z = 0.15;

    let isSelected = false;
    let startX = null;
    let currentDrag = 0;
    let completed = false;

    function applySelectedVisuals(selected) {
      isSelected = selected;
      if (statusBadge) {
        if (selected) {
          statusBadge.textContent = "👉 SWIPE RIGHT OR TAP TO PULL PIN";
          statusBadge.style.background = "linear-gradient(135deg, #00e5ff, #00b0ff)";
          statusBadge.style.color = "#000000";
          statusBadge.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.6)";
        } else {
          statusBadge.textContent = "👉 TAP HERE TO SELECT PIN";
          statusBadge.style.background = "#0f172a";
          statusBadge.style.color = "#00e5ff";
          statusBadge.style.boxShadow = "0 0 15px rgba(0, 229, 255, 0.3)";
        }
      }
      if (instructionText) {
        instructionText.textContent = selected
          ? "Pin selected! Now drag your finger to the right to pull the pin."
          : "Tap the golden safety pin to select it, then drag right to unlock.";
      }
      const shaft = document.getElementById("ext-pin-shaft");
      const ring = document.getElementById("ext-pin-ring");
      const guideArrow = document.getElementById("extinguisher-guide-arrow");
      const arrowText = document.getElementById("guide-arrow-text");
      if (shaft && typeof shaft.setAttribute === "function") {
        shaft.setAttribute(
          "material",
          selected
            ? "color: #00e5ff; emissive: #00e5ff; emissiveIntensity: 0.8; metalness: 0.8; roughness: 0.2"
            : "color: #fbbf24; metalness: 0.8; roughness: 0.2"
        );
      }
      if (ring && typeof ring.setAttribute === "function") {
        ring.setAttribute(
          "material",
          selected
            ? "color: #00e5ff; emissive: #00e5ff; emissiveIntensity: 0.9; metalness: 0.6; roughness: 0.2"
            : "color: #fbbf24; emissive: #f59e0b; emissiveIntensity: 0.7; metalness: 0.6; roughness: 0.2"
        );
      }
      if (guideArrow && typeof guideArrow.setAttribute === "function") {
        if (selected) {
          guideArrow.setAttribute("position", "0.65 0.88 0.15");
          guideArrow.setAttribute("rotation", "0 0 -90");
          guideArrow.setAttribute("animation", "property: position; to: 0.85 0.88 0.15; from: 0.55 0.88 0.15; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
        } else {
          guideArrow.setAttribute("position", "0.26 1.45 0.15");
          guideArrow.setAttribute("rotation", "0 0 0");
          guideArrow.setAttribute("animation", "property: position; to: 0.26 1.15 0.15; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
        }
      }
      if (arrowText && typeof arrowText.setAttribute === "function") {
        arrowText.setAttribute("value", selected ? "DRAG RIGHT 👉" : "TAP PIN");
      }
      const phantomPin = document.getElementById("phantom-ghost-pin");
      if (phantomPin && typeof phantomPin.setAttribute === "function") {
        phantomPin.setAttribute("visible", selected ? "false" : "true");
      }
      const bPill = document.getElementById("billboard-pill-text");
      if (bPill) {
        bPill.setAttribute("value", selected ? "🔵 PIN SELECTED — DRAG RIGHT" : "⚪ AWAITING PIN SELECTION");
      }
    }

    function handleFinish(sync = false) {
      if (completed) return;
      completed = true;
      const guideArrow = document.getElementById("extinguisher-guide-arrow");
      if (guideArrow && typeof guideArrow.setAttribute === "function") {
        guideArrow.setAttribute("visible", "false");
      }
      if (pin && typeof pin.setAttribute === "function") {
        pin.setAttribute("position", `${BASE_PIN_X + 0.40} ${BASE_PIN_Y} ${BASE_PIN_Z}`);
      }
      const pinShaft = document.getElementById("ext-pin-shaft");
      const pinRing = document.getElementById("ext-pin-ring");
      if (pinShaft && typeof pinShaft.setAttribute === "function") {
        pinShaft.setAttribute("material", "color: #10b981; metalness: 0.8; roughness: 0.2");
      }
      if (pinRing && typeof pinRing.setAttribute === "function") {
        pinRing.setAttribute("material", "color: #10b981; metalness: 0.8; roughness: 0.2");
        if (typeof pinRing.removeAttribute === "function") pinRing.removeAttribute("animation");
      }
      if (statusBadge) {
        statusBadge.textContent = "✔ PIN UNLOCKED";
        statusBadge.style.background = "rgba(16, 185, 129, 0.25)";
        statusBadge.style.color = "#10b981";
      }
      if (progressFill && typeof progressFill.setAttribute === "function") {
        progressFill.setAttribute("scale", "1 1 1");
      }
      if (sync) {
        _renderAim();
      } else {
        setTimeout(_renderAim, 350);
      }
      const tamperSeal = document.getElementById("tamper-seal");
      if (tamperSeal && typeof tamperSeal.setAttribute === "function") {
        tamperSeal.setAttribute("visible", "false");
      }
      const phantomPin = document.getElementById("phantom-ghost-pin");
      if (phantomPin && typeof phantomPin.setAttribute === "function") {
        phantomPin.setAttribute("visible", "false");
      }
      const bTitle = document.getElementById("billboard-step-title");
      const bPill = document.getElementById("billboard-pill-text");
      if (bTitle) bTitle.setAttribute("value", "✔ PIN REMOVED");
      if (bPill) bPill.setAttribute("value", "✔ UNLOCKED");
    }

    if (pin) {
      pin.simulateSelect = () => {
        applySelectedVisuals(true);
      };
      pin.simulatePull = (dist = 60, requireSelected = false) => {
        if (requireSelected && !canExecuteSelectedAction(isSelected)) {
          return false;
        }
        if (isPinPullComplete(dist, PIN_PULL_THRESHOLD_PX)) {
          handleFinish(true);
          return true;
        }
        return false;
      };
      pin.addEventListener("click", () => {
        if (!isSelected) {
          applySelectedVisuals(true);
        } else {
          handleFinish(true);
        }
      });

      const onSelectTap = (e) => {
        if (completed) return;
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        applySelectedVisuals(true);
      };

      const onDragStart = (clientX) => {
        if (completed || !canExecuteSelectedAction(isSelected)) return;
        startX = clientX;
        currentDrag = 0;
      };

      const onDragMove = (clientX) => {
        if (startX === null || completed || !canExecuteSelectedAction(isSelected)) return;
        currentDrag = Math.max(0, clientX - startX);
        const fraction = Math.min(1, currentDrag / PIN_PULL_THRESHOLD_PX);
        if (pin && typeof pin.setAttribute === "function") {
          pin.setAttribute("position", `${BASE_PIN_X + fraction * 0.40} ${BASE_PIN_Y} ${BASE_PIN_Z}`);
        }
        if (progressFill && typeof progressFill.setAttribute === "function") {
          progressFill.setAttribute("scale", `${Math.max(0.01, fraction)} 1 1`);
        }
        if (isPinPullComplete(currentDrag, PIN_PULL_THRESHOLD_PX)) {
          handleFinish(false);
        }
      };

      const onDragEnd = () => {
        startX = null;
        if (!completed && isSelected) {
          if (pin && typeof pin.setAttribute === "function") {
            pin.setAttribute("position", `${BASE_PIN_X} ${BASE_PIN_Y} ${BASE_PIN_Z}`);
          }
          if (progressFill && typeof progressFill.setAttribute === "function") {
            progressFill.setAttribute("scale", "0.01 1 1");
          }
        }
      };

      // real tap directly on pin mesh elements, hit target, or guide arrow triggers select
      const pinMeshes = [
        pin,
        document.getElementById("ext-pin-shaft"),
        document.getElementById("ext-pin-ring"),
        document.getElementById("pin-hit-area"),
        document.getElementById("extinguisher-guide-arrow"),
        document.getElementById("guide-arrow-cone"),
        document.getElementById("guide-arrow-shaft")
      ].filter(Boolean);

      pinMeshes.forEach((mesh) => {
        mesh.addEventListener("click", () => {
          if (!isSelected) {
            applySelectedVisuals(true);
          } else {
            handleFinish(true);
          }
        });
        mesh.addEventListener("pointerdown", (e) => {
          if (!isSelected) {
            onSelectTap(e);
          } else {
            onDragStart(e.clientX);
          }
        });
        mesh.addEventListener("mousedown", (e) => {
          if (!isSelected) {
            onSelectTap(e);
          } else {
            onDragStart(e.clientX);
          }
        });
        mesh.addEventListener("touchstart", (e) => {
          if (!isSelected) {
            onSelectTap(e);
          } else if (e.touches && e.touches[0]) {
            onDragStart(e.touches[0].clientX);
          }
        }, { passive: true });
      });

      if (statusBadge) {
        statusBadge.style.cursor = "pointer";
        const triggerBadge = (e) => {
          if (e && typeof e.stopPropagation === "function") e.stopPropagation();
          if (!isSelected) {
            applySelectedVisuals(true);
          } else {
            handleFinish(true);
          }
        };
        statusBadge.addEventListener("click", triggerBadge);
        statusBadge.addEventListener("touchend", triggerBadge);
        statusBadge.addEventListener("pointerup", triggerBadge);
      }

      // dragging once selected tracks smoothly anywhere on the screen
      const dragTargets = [
        typeof window !== "undefined" ? window : null,
        overlay,
        typeof document !== "undefined" ? document : null
      ].filter((t) => t && typeof t.addEventListener === "function");
      dragTargets.forEach((target) => {
        const onDown = (e) => { if (isSelected) onDragStart(e.clientX); };
        const onTouchStart = (e) => { if (isSelected && e.touches && e.touches[0]) onDragStart(e.touches[0].clientX); };
        const onMove = (e) => { if (isSelected && startX !== null) onDragMove(e.clientX); };
        const onTouchMove = (e) => { if (isSelected && startX !== null && e.touches && e.touches[0]) onDragMove(e.touches[0].clientX); };

        target.addEventListener("pointerdown", onDown);
        target.addEventListener("touchstart", onTouchStart, { passive: true });
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onDragEnd);
        target.addEventListener("touchmove", onTouchMove, { passive: true });
        target.addEventListener("touchend", onDragEnd);

        addCleanup(() => {
          target.removeEventListener("pointerdown", onDown);
          target.removeEventListener("touchstart", onTouchStart);
          target.removeEventListener("pointermove", onMove);
          target.removeEventListener("pointerup", onDragEnd);
          target.removeEventListener("touchmove", onTouchMove);
          target.removeEventListener("touchend", onDragEnd);
        });
      });

      // tap anywhere on viewport or canvas selects pin if not selected, or pulls if selected
      const viewport = typeof document !== "undefined" ? (document.getElementById("ar-viewport") || document.body) : null;
      if (viewport && typeof viewport.addEventListener === "function") {
        const onViewportClick = () => {
          if (completed) return;
          if (!isSelected) {
            applySelectedVisuals(true);
          }
        };
        viewport.addEventListener("click", onViewportClick);
        addCleanup(() => viewport.removeEventListener("click", onViewportClick));
      }
    }
  }

  // pass sub-step 2: A — Aim via screen-center camera gaze laser or direct tap on fire base
  function _renderAim() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="fire-hud-card">
        <div class="hud-badge">${t("fire.pass_aim_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (2/4)")}</div>
        <div class="hud-title">${t("fire.pass_aim_title", "A — Aim at the Base")}</div>
        <div id="aim-instruction-text" class="hud-desc">${t("fire.pass_aim_desc", "Aim at the glowing green ring at the bottom of the fire. Tap the button below or point your phone camera at it.")}</div>
        <button id="aim-status-badge" style="display:block;width:100%;padding:12px 18px;border-radius:10px;border:2px solid #00e676;background:#0f172a;color:#00e676;font-size:0.95rem;font-weight:bold;cursor:pointer;margin:0.3rem 0;box-shadow:0 0 15px rgba(0,230,118,0.35);pointer-events:auto !important;text-align:center;">🎯 TAP TO LOCK AIM AT FIRE BASE</button>
        <div style="width:100%;height:8px;background:#334155;border-radius:4px;overflow:hidden;margin:0.3rem 0;">
          <div id="aim-progress-bar" style="width:0%;height:100%;background:#00e676;transition:width 0.08s linear;"></div>
        </div>
        <div id="aim-status-label" style="font-size:0.85rem;color:#94a3b8;font-weight:bold;">READY — TAP BUTTON OR POINT AT BASE</div>
      </div>
    `;

    const progressBar = document.getElementById("aim-progress-bar");
    const statusLabel = document.getElementById("aim-status-label");
    const statusBadge = document.getElementById("aim-status-badge");
    const reticle = document.getElementById("aim-reticle");
    const gazeLaser = document.getElementById("gaze-laser");
    const gazeDot = document.getElementById("gaze-dot");
    const kanjiMarker = document.getElementById("kanji-marker");
    const fireGraphic = document.getElementById("fire-graphic");
    if (fireGraphic && typeof fireGraphic.setAttribute === "function") {
      fireGraphic.setAttribute("visible", "true");
      fireGraphic.setAttribute("position", "0 -1.15 -2.2");
      fireGraphic.setAttribute("scale", "0.60 0.60 0.60");
    }

    const bTitle = document.getElementById("billboard-step-title");
    const bDesc = document.getElementById("billboard-step-desc");
    const bPill = document.getElementById("billboard-pill-text");
    if (bTitle) bTitle.setAttribute("value", "A — AIM AT BASE");
    if (bDesc) bDesc.setAttribute("value", "Aim reticle at base\nof fire container.");
    if (bPill) bPill.setAttribute("value", "⚪ POINT AT FIRE BASE");

    let holdStart = null;
    let holdTimer = null;
    let completed = false;

    function handleAimSuccess(accuracy = 0.9, distance = 0.1, sync = false) {
      if (completed) return;
      completed = true;
      clearInterval(holdTimer);
      _recordedAccuracy = accuracy;
      _recordedDistance = distance;
      if (progressBar) progressBar.style.width = "100%";
      if (statusBadge) {
        statusBadge.textContent = "✔ AIM LOCKED ON FIRE BASE";
        statusBadge.style.background = "rgba(16, 185, 129, 0.25)";
        statusBadge.style.color = "#10b981";
      }
      if (statusLabel) {
        statusLabel.textContent = "✔ AIM LOCKED!";
        statusLabel.style.color = "#10b981";
      }
      if (gazeDot && typeof gazeDot.setAttribute === "function") {
        gazeDot.setAttribute("material", "color: #10b981; shader: flat; opacity: 0.95; side: double");
      }
      if (reticle && typeof reticle.setAttribute === "function") {
        reticle.setAttribute("material", "color: #10b981; emissive: #10b981; emissiveIntensity: 0.9; side: double");
        if (typeof reticle.removeAttribute === "function") reticle.removeAttribute("animation");
      }
      if (sync) {
        _renderSqueeze();
      } else {
        setTimeout(_renderSqueeze, 350);
      }
    }

    const startHold = (accuracy = 0.85, distance = 0.12) => {
      if (completed) return;
      if (!holdStart) holdStart = Date.now();
      clearInterval(holdTimer);
      if (statusBadge) {
        statusBadge.textContent = "🟢 LASER ON TARGET — HOLD PHONE STEADY";
        statusBadge.style.background = "rgba(16, 185, 129, 0.25)";
        statusBadge.style.color = "#10b981";
      }
      if (statusLabel) {
        statusLabel.textContent = "AIMING AT BASE... HOLD STEADY";
        statusLabel.style.color = "#00e676";
      }
      const bPill = document.getElementById("billboard-pill-text");
      if (bPill) bPill.setAttribute("value", "🟢 HOLD STEADY (800ms)");
      if (gazeDot && typeof gazeDot.setAttribute === "function") {
        gazeDot.setAttribute("material", "color: #00e676; shader: flat; opacity: 1.0; side: double");
      }
      holdTimer = setInterval(() => {
        const elapsed = Date.now() - holdStart;
        const { progress, isComplete } = evaluateGazeAimProgress(true, elapsed, AIM_HOLD_DURATION_MS);
        const pct = Math.min(100, Math.round(progress * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (isComplete) {
          clearInterval(holdTimer);
          handleAimSuccess(accuracy, distance, false);
        }
      }, 50);
    };

    const stopHold = () => {
      if (completed) return;
      clearInterval(holdTimer);
      holdStart = null;
      if (progressBar) progressBar.style.width = "0%";
      if (statusBadge) {
        statusBadge.textContent = "⚪ POINT PHONE AT BASE OF FIRE";
        statusBadge.style.background = "#334155";
        statusBadge.style.color = "#94a3b8";
      }
      if (statusLabel) {
        statusLabel.textContent = "AWAITING GAZE INTERSECTION";
        statusLabel.style.color = "#94a3b8";
      }
      if (gazeDot && typeof gazeDot.setAttribute === "function") {
        gazeDot.setAttribute("material", "color: #00e5ff; shader: flat; opacity: 0.9; side: double");
      }
    };

    // clean marker lost / found handling
    if (kanjiMarker && typeof kanjiMarker.addEventListener === "function") {
      kanjiMarker.addEventListener("markerLost", () => {
        if (!completed) {
          stopHold();
          if (statusBadge) {
            statusBadge.textContent = "⚠️ TARGET LOST — POINT PHONE AT FIRE BASE";
            statusBadge.style.color = "#f59e0b";
          }
        }
      });
      kanjiMarker.addEventListener("markerFound", () => {
        if (!completed) {
          if (statusBadge) {
            statusBadge.textContent = "⚪ POINT PHONE AT BASE OF FIRE";
            statusBadge.style.color = "#94a3b8";
          }
        }
      });
    }

    // handle gaze raycaster intersection on gazeLaser or reticle
    const onRaycastIntersection = (ev) => {
      if (completed) return;
      const intersections = ev && ev.detail && ev.detail.intersections ? ev.detail.intersections : null;
      const point = intersections && intersections[0] && intersections[0].point
        ? intersections[0].point
        : (ev && ev.detail && ev.detail.intersection ? ev.detail.intersection.point : null);
      const distance = point ? calcIntersectionDistance(point, { x: 0, y: 0.16, z: 0 }) : 0.12;
      const accuracy = calcRaycastAimAccuracy(distance);
      startHold(accuracy, distance);
    };

    if (gazeLaser && typeof gazeLaser.addEventListener === "function") {
      gazeLaser.addEventListener("raycaster-intersection", onRaycastIntersection);
      gazeLaser.addEventListener("raycaster-intersection-cleared", stopHold);
      gazeLaser.simulateIntersection = (point = { x: 0, y: 0.16, z: 0 }) => {
        const distance = calcIntersectionDistance(point, { x: 0, y: 0.16, z: 0 });
        const accuracy = calcRaycastAimAccuracy(distance);
        handleAimSuccess(accuracy, distance, true);
      };
    }

    if (statusBadge && typeof statusBadge.addEventListener === "function") {
      statusBadge.addEventListener("click", () => handleAimSuccess(0.92, 0.08, true));
    }

    const targetBase = typeof document !== "undefined" ? document.getElementById("fire-target-base") : null;
    if (targetBase && typeof targetBase.addEventListener === "function") {
      targetBase.addEventListener("click", () => handleAimSuccess(0.92, 0.08, false));
    }

    if (reticle) {
      reticle.simulateAim = (score = 0.9, dist = 0.1) => {
        handleAimSuccess(score, dist, true);
      };
      reticle.addEventListener("click", () => handleAimSuccess(0.92, 0.08, false));
      reticle.addEventListener("raycaster-intersected", onRaycastIntersection);
      reticle.addEventListener("raycaster-intersected-cleared", stopHold);
      reticle.addEventListener("pointerdown", () => startHold(0.9, 0.08));
      reticle.addEventListener("mousedown", () => startHold(0.9, 0.08));
      reticle.addEventListener("pointerup", stopHold);
      reticle.addEventListener("mouseup", stopHold);
    }

    if (graphic && typeof graphic.addEventListener === "function") {
      graphic.addEventListener("click", () => handleAimSuccess(0.90, 0.10, false));
      graphic.addEventListener("raycaster-intersected", onRaycastIntersection);
      graphic.addEventListener("raycaster-intersected-cleared", stopHold);
    }
  }

  // pass sub-step 3: S — Squeeze 3D operating lever directly (tap-to-select then press-and-hold)
  function _renderSqueeze() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="fire-hud-card">
        <div class="hud-badge">${t("fire.pass_squeeze_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (3/4)")}</div>
        <div class="hud-title">${t("fire.pass_squeeze_title", "S — Squeeze the Handle")}</div>
        <div id="squeeze-instruction-text" class="hud-desc">${t("fire.pass_squeeze_desc", "Tap the 3D operating lever (or button below) to select, then press &amp; hold 1.5s.")}</div>
        <button id="squeeze-status-badge" style="display:block;width:100%;padding:12px 18px;border-radius:10px;border:2px solid #ff9100;background:#0f172a;color:#ff9100;font-size:0.95rem;font-weight:bold;cursor:pointer;margin:0.3rem 0;box-shadow:0 0 15px rgba(255,145,0,0.3);pointer-events:auto !important;text-align:center;">👉 TAP HERE TO SELECT LEVER</button>
        <div style="width:100%;height:8px;background:#334155;border-radius:4px;overflow:hidden;margin:0.3rem 0;">
          <div id="squeeze-progress-bar" style="width:0%;height:100%;background:#ff6a00;transition:width 0.08s linear;"></div>
        </div>
        <div id="squeeze-status-label" style="font-size:0.85rem;color:#94a3b8;font-weight:bold;">AWAITING LEVER SELECTION</div>
      </div>
    `;

    const progressBar = document.getElementById("squeeze-progress-bar");
    const statusLabel = document.getElementById("squeeze-status-label");
    const statusBadge = document.getElementById("squeeze-status-badge");
    const instructionText = document.getElementById("squeeze-instruction-text");
    const handle = document.getElementById("extinguisher-handle");
    const guideArrow = document.getElementById("extinguisher-guide-arrow");
    const arrowText = document.getElementById("guide-arrow-text");
    const arrowCone = document.getElementById("guide-arrow-cone");
    const arrowShaft = document.getElementById("guide-arrow-shaft");

    // position 3d guide arrow pointing directly at lever
    if (guideArrow && typeof guideArrow.setAttribute === "function") {
      guideArrow.setAttribute("visible", "true");
      guideArrow.setAttribute("position", "0.15 1.45 0");
      guideArrow.setAttribute("rotation", "0 0 0");
      guideArrow.setAttribute("animation", "property: position; to: 0.15 1.15 0; from: 0.15 1.45 0; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
    }
    if (arrowText && typeof arrowText.setAttribute === "function") {
      arrowText.setAttribute("value", "TAP LEVER");
    }
    if (arrowCone && typeof arrowCone.setAttribute === "function") {
      arrowCone.setAttribute("material", "color: #ff9100; emissive: #ff9100; emissiveIntensity: 0.9");
    }
    if (arrowShaft && typeof arrowShaft.setAttribute === "function") {
      arrowShaft.setAttribute("material", "color: #ff9100; emissive: #ff9100; emissiveIntensity: 0.8");
    }

    const bTitle = document.getElementById("billboard-step-title");
    const bDesc = document.getElementById("billboard-step-desc");
    const bPill = document.getElementById("billboard-pill-text");
    if (bTitle) bTitle.setAttribute("value", "S — SQUEEZE HANDLE");
    if (bDesc) bDesc.setAttribute("value", "Tap operating lever,\nhold 1.5s to discharge.");
    if (bPill) bPill.setAttribute("value", "⚪ AWAITING LEVER TAP");

    let isSelected = false;
    let startTime = null;
    let timer = null;
    let completed = false;

    function applySelectedVisuals(selected) {
      isSelected = selected;
      if (statusBadge) {
        if (selected) {
          statusBadge.textContent = "👉 PRESS & HOLD HERE (1.5s) TO DISCHARGE";
          statusBadge.style.background = "linear-gradient(135deg, #ff9100, #ff6a00)";
          statusBadge.style.color = "#000000";
          statusBadge.style.boxShadow = "0 0 20px rgba(255, 145, 0, 0.6)";
        } else {
          statusBadge.textContent = "👉 TAP HERE TO SELECT LEVER";
          statusBadge.style.background = "#0f172a";
          statusBadge.style.color = "#ff9100";
          statusBadge.style.boxShadow = "0 0 15px rgba(255, 145, 0, 0.3)";
        }
      }
      if (instructionText) {
        instructionText.textContent = selected
          ? "Lever selected! Now press and hold the lever for 1.5s to discharge."
          : "Tap the 3D operating lever to select it, then press & hold for 1.5s.";
      }
      if (statusLabel) {
        statusLabel.textContent = selected ? "PRESS & HOLD SELECTED 3D LEVER" : "AWAITING LEVER SELECTION";
        statusLabel.style.color = selected ? "#ff9100" : "#94a3b8";
      }
      if (arrowText && typeof arrowText.setAttribute === "function") {
        arrowText.setAttribute("value", selected ? "HOLD 1.5s" : "TAP LEVER");
      }
      if (handle && typeof handle.setAttribute === "function") {
        handle.setAttribute(
          "material",
          selected
            ? "color: #ff9100; emissive: #ff9100; emissiveIntensity: 0.85; metalness: 0.5; roughness: 0.3"
            : "color: #334155; metalness: 0.5; roughness: 0.3"
        );
        if (selected) {
          handle.setAttribute("animation", "property: scale; to: 1.15 1.15 1.15; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
        } else if (typeof handle.removeAttribute === "function") {
          handle.removeAttribute("animation");
        }
      }
    }

    function handleSqueezeSuccess(sync = false) {
      if (completed) return;
      completed = true;
      clearInterval(timer);
      if (guideArrow && typeof guideArrow.setAttribute === "function") {
        guideArrow.setAttribute("visible", "false");
      }
      if (progressBar) progressBar.style.width = "100%";
      if (statusBadge) {
        statusBadge.textContent = "✔ AGENT DISCHARGED";
        statusBadge.style.background = "rgba(16, 185, 129, 0.25)";
        statusBadge.style.color = "#10b981";
      }
      if (statusLabel) {
        statusLabel.textContent = "✔ DISCHARGING AGENT!";
        statusLabel.style.color = "#10b981";
      }
      if (handle && typeof handle.setAttribute === "function") {
        handle.setAttribute("material", "color: #10b981; emissive: #10b981; emissiveIntensity: 0.8; metalness: 0.5; roughness: 0.3");
        if (typeof handle.removeAttribute === "function") handle.removeAttribute("animation");
      }
      if (sync) {
        _renderSweep();
      } else {
        setTimeout(_renderSweep, 350);
      }
    }

    if (handle) {
      handle.simulateSelect = () => {
        applySelectedVisuals(true);
      };
      handle.simulateSqueeze = (durationMs = 1500, requireSelected = false) => {
        if (requireSelected && !canExecuteSelectedAction(isSelected)) {
          return false;
        }
        if (isSqueezeComplete(durationMs, SQUEEZE_HOLD_DURATION_MS)) {
          handleSqueezeSuccess(true);
          return true;
        }
        return false;
      };
      handle.addEventListener("click", () => {
        if (!isSelected) {
          applySelectedVisuals(true);
        } else {
          handleSqueezeSuccess(true);
        }
      });

      const startSqueeze = (e) => {
        if (completed) return;
        if (!isSelected) {
          if (e && typeof e.stopPropagation === "function") e.stopPropagation();
          applySelectedVisuals(true);
          return;
        }
        startTime = Date.now();
        clearInterval(timer);
        if (statusLabel) {
          statusLabel.textContent = "SQUEEZING LEVER... DISCHARGING";
          statusLabel.style.color = "#ff6a00";
        }
        const powderSpray = document.getElementById("powder-spray-cone");
        if (powderSpray && typeof powderSpray.setAttribute === "function") {
          powderSpray.setAttribute("visible", "true");
          powderSpray.setAttribute("material", "color: #f8fafc; opacity: 0.85; transparent: true");
        }
        const bPill = document.getElementById("billboard-pill-text");
        if (bPill) bPill.setAttribute("value", "🟠 DISCHARGING AGENT");
        timer = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const pct = Math.min(100, Math.round((elapsed / SQUEEZE_HOLD_DURATION_MS) * 100));
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (isSqueezeComplete(elapsed, SQUEEZE_HOLD_DURATION_MS)) {
            handleSqueezeSuccess(false);
          }
        }, 50);
      };

      const stopSqueeze = () => {
        if (completed) return;
        clearInterval(timer);
        startTime = null;
        if (progressBar) progressBar.style.width = "0%";
        if (statusLabel && isSelected) {
          statusLabel.textContent = "PRESS & HOLD SELECTED 3D LEVER";
          statusLabel.style.color = "#ff9100";
        }
        const powderSpray = document.getElementById("powder-spray-cone");
        if (powderSpray && typeof powderSpray.setAttribute === "function") {
          powderSpray.setAttribute("visible", "false");
        }
      };

      const handleMeshes = [
        handle,
        document.getElementById("handle-hit-area"),
        document.getElementById("extinguisher-guide-arrow"),
        document.getElementById("guide-arrow-cone"),
        document.getElementById("guide-arrow-shaft")
      ].filter(Boolean);

      handleMeshes.forEach((mesh) => {
        mesh.addEventListener("pointerdown", startSqueeze);
        mesh.addEventListener("mousedown", startSqueeze);
        mesh.addEventListener("touchstart", startSqueeze, { passive: true });
      });

      if (statusBadge) {
        statusBadge.style.cursor = "pointer";
        statusBadge.addEventListener("click", () => {
          if (!isSelected) {
            applySelectedVisuals(true);
          } else {
            handleSqueezeSuccess(true);
          }
        });
        statusBadge.addEventListener("pointerdown", startSqueeze);
        statusBadge.addEventListener("mousedown", startSqueeze);
        statusBadge.addEventListener("touchstart", startSqueeze, { passive: true });
        addCleanup(() => {
          statusBadge.removeEventListener("pointerdown", startSqueeze);
          statusBadge.removeEventListener("mousedown", startSqueeze);
          statusBadge.removeEventListener("touchstart", startSqueeze);
        });
      }

      const releaseTargets = [
        typeof window !== "undefined" ? window : null,
        overlay,
        typeof document !== "undefined" ? document : null
      ].filter((t) => t && typeof t.addEventListener === "function");
      releaseTargets.forEach((target) => {
        target.addEventListener("pointerup", stopSqueeze);
        target.addEventListener("mouseup", stopSqueeze);
        target.addEventListener("pointercancel", stopSqueeze);
        target.addEventListener("touchend", stopSqueeze);

        addCleanup(() => {
          target.removeEventListener("pointerup", stopSqueeze);
          target.removeEventListener("mouseup", stopSqueeze);
          target.removeEventListener("pointercancel", stopSqueeze);
          target.removeEventListener("touchend", stopSqueeze);
        });
      });
    }
  }

  // pass sub-step 4: S — Sweep across base of fire via physical camera motion or on-screen drag
  function _renderSweep() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="fire-hud-card">
        <div class="hud-badge">${t("fire.pass_sweep_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (4/4)")}</div>
        <div class="hud-title">${t("fire.pass_sweep_title", "S — Sweep Side to Side")}</div>
        <div id="sweep-desc-text" class="hud-desc">${t("fire.pass_sweep_desc", "Move your phone side to side (or drag across screen) to spray powder across the burning dustbin.")}</div>
        <div style="width:100%;height:10px;background:#334155;border-radius:6px;overflow:hidden;margin:0.3rem 0;">
          <div id="sweep-progress-fill" style="width:0%;height:100%;background:#00e676;transition:width 0.08s ease;"></div>
        </div>
        <div id="sweep-status-text" style="font-size:0.85rem;color:#00e676;font-weight:bold;margin:0.2rem 0;">↔ SWEEP SIDE TO SIDE (0% EXTINGUISHED)</div>
        <button id="btn-sweep-complete-fallback" style="margin-top:0.4rem;padding:0.55rem 0.9rem;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:8px;font-size:0.82rem;cursor:pointer;display:block;width:100%;">Tap here if motion not detected ➜</button>
      </div>
    `;

    // activate powder spray cone and particle stream on extinguisher nozzle
    const powderSpray = document.getElementById("powder-spray-cone");
    if (powderSpray && typeof powderSpray.setAttribute === "function") {
      powderSpray.setAttribute("visible", "true");
    }

    // invisible sweep zone controller for tests and fallback
    const sweepZone = document.createElement("div");
    sweepZone.id = "sweep-zone";
    sweepZone.style.display = "none";
    overlay.appendChild(sweepZone);

    const statusText = document.getElementById("sweep-status-text");
    const progressFill = document.getElementById("sweep-progress-fill");
    const fallbackBtn = document.getElementById("btn-sweep-complete-fallback");

    // billboard text updates for step 4 (Sweep)
    const billboardTitle = document.getElementById("billboard-step-title");
    const billboardPill = document.getElementById("billboard-pill-text");
    if (billboardTitle) billboardTitle.setAttribute("value", "STEP 4: SWEEP");
    if (billboardPill) billboardPill.setAttribute("value", "↔ SWEEP SIDE TO SIDE");

    let completed = false;
    let rafId = null;

    // progressive extinguishing feedback on burning dustbin
    function updateExtinguishProgress(coverage) {
      const clamped = Math.max(0, Math.min(1, coverage));
      if (progressFill) {
        progressFill.style.width = `${Math.min(100, Math.round(clamped * 100))}%`;
      }
      if (statusText) {
        statusText.textContent = `↔ SWEEPING... (${Math.round(clamped * 100)}% EXTINGUISHED)`;
      }
      // dynamically shrink flames
      const flameGroup = document.getElementById("fire-flames-group");
      if (flameGroup && typeof flameGroup.setAttribute === "function") {
        const scaleY = Math.max(0.02, 1.0 - clamped * 0.96);
        const scaleXZ = Math.max(0.05, 1.0 - clamped * 0.92);
        flameGroup.setAttribute("scale", `${scaleXZ} ${scaleY} ${scaleXZ}`);
      }
      // dim fire point light
      const fireLight = document.getElementById("fire-light");
      if (fireLight && typeof fireLight.setAttribute === "function") {
        fireLight.setAttribute("intensity", `${Math.max(0, 2.2 * (1.0 - clamped))}`);
      }
      // show steam cloud as extinguishing progresses
      const steam = document.getElementById("fire-extinguish-steam");
      if (steam && typeof steam.setAttribute === "function" && clamped > 0.3) {
        steam.setAttribute("material", `color: #f1f5f9; opacity: ${Math.min(0.55, clamped * 0.55)}; transparent: true`);
      }
    }

    addCleanup(() => {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function" && rafId) {
        window.cancelAnimationFrame(rafId);
      }
    });

    const handleSweepFinish = (sync = false) => {
      if (completed) return;
      completed = true;
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function" && rafId) {
        window.cancelAnimationFrame(rafId);
      }

      updateExtinguishProgress(1.0);

      if (statusText) {
        statusText.textContent = "✔ FIRE EXTINGUISHED!";
        statusText.style.color = "#00e676";
      }
      if (progressFill) progressFill.style.width = "100%";

      const fireEl = document.getElementById("fire-graphic");
      if (fireEl && typeof fireEl.setAttribute === "function") {
        fireEl.setAttribute("scale", "0.01 0.01 0.01");
      }
      const flameGroup = document.getElementById("fire-flames-group");
      if (flameGroup && typeof flameGroup.setAttribute === "function") {
        flameGroup.setAttribute("scale", "0.01 0.01 0.01");
      }
      const embers = document.getElementById("fire-embers");
      if (embers && typeof embers.setAttribute === "function") {
        embers.setAttribute("material", "color: #1e293b; shader: flat; opacity: 0.7");
        if (typeof embers.removeAttribute === "function") embers.removeAttribute("animation");
      }
      const powder = document.getElementById("powder-spray-cone");
      if (powder && typeof powder.setAttribute === "function") {
        powder.setAttribute("visible", "false");
      }
      const bTitle = document.getElementById("billboard-step-title");
      const bPill = document.getElementById("billboard-pill-text");
      if (bTitle) bTitle.setAttribute("value", "✔ EXTINGUISHED");
      if (bPill) bPill.setAttribute("value", "✔ HAZARD SECURED");

      const accuracy = _recordedAccuracy !== null ? _recordedAccuracy : 0.85;
      const distance = _recordedDistance !== null ? _recordedDistance : 0.12;
      const passed = accuracy >= AIM_PASS_THRESHOLD;
      const finalAccuracy = Math.round(accuracy * 100) / 100;
      const finalDistance = typeof distance === "number" ? Math.round(distance * 100) / 100 : null;

      logger.info({
        event: "pass_technique_completed",
        accuracy: finalAccuracy,
        distance: finalDistance,
        passed,
        tier: tierInfo && tierInfo.tier
      }, "PASS technique completed");

      fireCheckpointResult(CP_EXTINGUISHER_ID, passed, {
        method: sync ? "button_fallback" : "physical_motion_sweep",
        accuracy: finalAccuracy,
        distance: finalDistance,
        target: passed ? "base" : "missed",
        tier: tierInfo && tierInfo.tier
      });

      if (sync) {
        _setupStep3(container);
      } else {
        setTimeout(() => {
          _setupStep3(container);
        }, 450);
      }
    };

    if (fallbackBtn) {
      fallbackBtn.addEventListener("click", () => handleSweepFinish(true));
    }

    sweepZone.simulateSweep = (positions = [0, 80, 160, 220]) => {
      const maxVal = Math.max(...positions.map(Math.abs));
      const coverage = maxVal > 5
        ? calcSweepCoverage(positions, 220)
        : calcMotionSweepCoverage(positions);
      updateExtinguishProgress(coverage);
      if (isSweepComplete(coverage)) {
        handleSweepFinish(true);
      }
    };
    sweepZone.addEventListener("click", () => handleSweepFinish(true));

    const cameraEl = document.getElementById("main-camera");
    const sweepSamples = [];

    // 1. Device orientation sweep listener (handles phone/tablet tilting & turning)
    let lastOrientationAngle = null;
    const onOrientationSweep = (event) => {
      if (completed) return;
      const angle = (typeof event.gamma === "number" && !isNaN(event.gamma))
        ? event.gamma
        : (typeof event.alpha === "number" && !isNaN(event.alpha) ? event.alpha : null);
      if (angle !== null) {
        if (lastOrientationAngle !== null) {
          const delta = angle - lastOrientationAngle;
          if (Math.abs(delta) > 0.3) {
            sweepSamples.push(delta * 14);
            const coverage = calcSweepCoverage(sweepSamples, 220);
            updateExtinguishProgress(coverage);
            if (isSweepComplete(coverage, SWEEP_MIN_COVERAGE)) {
              handleSweepFinish(false);
            }
          }
        }
        lastOrientationAngle = angle;
      }
    };

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("deviceorientation", onOrientationSweep, { passive: true });
      addCleanup(() => {
        window.removeEventListener("deviceorientation", onOrientationSweep);
      });
    }

    // 2. Touch / pointer drag sweep listener (allows user to drag finger across fire)
    let isDragging = false;
    let lastTouchX = null;
    const onDragStart = (e) => {
      isDragging = true;
      lastTouchX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || null;
    };
    const onDragMove = (e) => {
      if (!isDragging || completed) return;
      const curX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX);
      if (typeof curX === "number" && lastTouchX !== null) {
        const dx = curX - lastTouchX;
        if (Math.abs(dx) > 1) {
          sweepSamples.push(dx * 2.5);
          lastTouchX = curX;
          const coverage = calcSweepCoverage(sweepSamples, 220);
          updateExtinguishProgress(coverage);
          if (isSweepComplete(coverage, SWEEP_MIN_COVERAGE)) {
            handleSweepFinish(false);
          }
        }
      }
    };
    const onDragEnd = () => {
      isDragging = false;
      lastTouchX = null;
    };

    const dragTarget = typeof window !== "undefined" ? window : null;
    if (dragTarget && typeof dragTarget.addEventListener === "function") {
      dragTarget.addEventListener("pointerdown", onDragStart, { passive: true });
      dragTarget.addEventListener("pointermove", onDragMove, { passive: true });
      dragTarget.addEventListener("pointerup", onDragEnd, { passive: true });
      dragTarget.addEventListener("touchstart", onDragStart, { passive: true });
      dragTarget.addEventListener("touchmove", onDragMove, { passive: true });
      dragTarget.addEventListener("touchend", onDragEnd, { passive: true });
      addCleanup(() => {
        dragTarget.removeEventListener("pointerdown", onDragStart);
        dragTarget.removeEventListener("pointermove", onDragMove);
        dragTarget.removeEventListener("pointerup", onDragEnd);
        dragTarget.removeEventListener("touchstart", onDragStart);
        dragTarget.removeEventListener("touchmove", onDragMove);
        dragTarget.removeEventListener("touchend", onDragEnd);
      });
    }

    // 3. Camera rotation yaw loop in A-Frame
    let lastRotY = null;
    function checkMotionFrame() {
      if (completed) return;
      if (cameraEl && cameraEl.object3D) {
        const rotY = cameraEl.object3D.rotation ? cameraEl.object3D.rotation.y : null;
        const posX = cameraEl.object3D.position ? cameraEl.object3D.position.x : 0;
        if (typeof rotY === "number") {
          if (lastRotY !== null) {
            const deltaRot = rotY - lastRotY;
            if (Math.abs(deltaRot) > 0.002) {
              sweepSamples.push(deltaRot * 280);
            }
          }
          lastRotY = rotY;
        }
        if (Math.abs(posX) > 0.01) {
          sweepSamples.push(posX * 120);
        }

        if (sweepSamples.length >= 3) {
          const maxVal = Math.max(...sweepSamples.map(Math.abs));
          const coverage = maxVal > 5
            ? calcSweepCoverage(sweepSamples, 220)
            : calcMotionSweepCoverage(sweepSamples);
          updateExtinguishProgress(coverage);

          if (isSweepComplete(coverage, SWEEP_MIN_COVERAGE)) {
            handleSweepFinish(false);
            return;
          }
        }
      }
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        rafId = window.requestAnimationFrame(checkMotionFrame);
      }
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      rafId = window.requestAnimationFrame(checkMotionFrame);
    }
  }

  // start with PASS step 1 (Pull)
  _renderPullPin();
}

// step 3: select — user learns evacuation sequencing before choosing protocol
function _setupStep3(_container) {
  _currentStep = 3;
  logger.info({ event: "fire_step_start", step: 3 }, "Evacuation sequence");
  playNarration({ moduleId: "fire-response", stepKey: "step_3_evacuate" });

  // clean up step 2 extinguisher and fire graphics for step 3
  ["extinguisher-graphic", "fire-graphic"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && typeof el.remove === "function") el.remove();
  });

  registerCheckpoint({
    id: CP_EVACUATION_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Evacuation CP triggered");
    }
  });

  const overlay = document.getElementById("fire-module-overlay");

  playNarration({ moduleId: "fire-response", stepKey: "step_3_evacuate" });

  const screens = [
    {
      badge: t("fire.evac_badge_1", "🔥 STEP 3 / 3 — EVACUATION (1/3)"),
      title: t("fire.evac_title_1", "Why Evacuation Order Matters"),
      desc: t("fire.evac_desc_1", "Sounding the building alarm immediately alerts everyone before heat spreads. Never delay evacuation to gather personal belongings or tools."),
      buttonText: t("fire.evac_next_1", "Next: Assembly Area Purpose ➜")
    },
    {
      badge: t("fire.evac_badge_2", "🔥 STEP 3 / 3 — EVACUATION (2/3)"),
      title: t("fire.evac_title_2", "Assembly & Headcount"),
      desc: t("fire.evac_desc_2", "Proceed directly to your designated external assembly area. Immediate headcount verification ensures rescuers know if anyone is trapped inside."),
      buttonText: t("fire.evac_next_2", "Next: Evacuation Protocol Choice ➜")
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div class="fire-hud-card">
          <div class="hud-badge">${t("fire.evac_badge_3", "🔥 STEP 3 / 3 — EVACUATION ROUTE")}</div>
          <div class="hud-title">${t("fire.evac_title_3", "Choose Safest Evacuation Path")}</div>
          <div class="hud-desc">${t("fire.evac_desc_3", "After using the extinguisher, you must evacuate. Select the safest option:")}</div>
          <div id="evacuation-options-container"></div>
        </div>
      `;
      const optionsContainer = overlay.querySelector("#evacuation-options-container") || overlay;
      _renderEvacuationOptions(optionsContainer, (selectedId, passed) => {
        fireCheckpointResult(CP_EVACUATION_ID, passed, {
          selected: selectedId,
          correct: "sound_alarm_then_evacuate"
        });
        _showComplete(passed);
      });
    }
  }

  let subIndex = 0;
  function renderCurrentSubscreen() {
    if (subIndex < screens.length) {
      _renderSubscreen(overlay, {
        ...screens[subIndex],
        onNext: () => {
          subIndex++;
          renderCurrentSubscreen();
        }
      });
    } else {
      showActionScreen();
    }
  }

  renderCurrentSubscreen();
}

// clean up all fire module graphics and overlay from DOM and a-marker
function cleanupFireModule() {
  _currentStep = 0;
  stopNarration();
  if (getActiveSession()) {
    abortAssessmentSession();
  }

  // drain tracked event listeners and animation frames
  while (_activeCleanups.length > 0) {
    const fn = _activeCleanups.pop();
    try {
      fn();
    } catch {
      // ignore cleanup errors
    }
  }

  [
    "fire-module-overlay",
    "fire-graphic",
    "extinguisher-graphic",
    "extinguisher-pin",
    "extinguisher-pin-progress",
    "extinguisher-guide-arrow",
    "spatial-step-billboard",
    "phantom-ghost-pin",
    "powder-spray-cone",
    "tamper-seal",
    "exit-graphic",
    "evacuation-options",
    "aim-accuracy-display",
    "test-box"
  ].forEach((id) => {
    if (typeof document !== "undefined") {
      document.getElementById(id)?.remove();
    }
  });

  if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
    document.querySelectorAll("#exit-graphic, #fire-graphic, #extinguisher-graphic").forEach((el) => {
      if (typeof el.setAttribute === "function") el.setAttribute("visible", "false");
      if (el.object3D) el.object3D.visible = false;
      if (el.parentNode) el.parentNode.removeChild(el);
      else if (typeof el.remove === "function") el.remove();
    });
  }
}

// show completion panel after all three steps done
function _showComplete(lastPassed) {
  _currentStep = 0;

  // finalize assessment attempt if session is active
  if (getActiveSession()) {
    try {
      finishAssessmentSession();
    } catch (err) {
      logger.warn({ event: "assessment_finish_error", error: err.message }, "Assessment finalize failed");
    }
  }

  const overlay = document.getElementById("fire-module-overlay");
  if (overlay) {
    const titlePass = t("modules.fire_response.complete_pass", {}, "✅ MODULE COMPLETE");
    const titleReview = t("modules.fire_response.complete_review", {}, "⚠ MODULE COMPLETE — Review step 3");
    const desc = t("modules.fire_response.complete_desc", {}, "All checkpoints fired. Assessment engine will score your attempt.");
    overlay.innerHTML = `
      <div class="fire-hud-card">
        <div class="hud-title" style="color:${lastPassed ? "#00e676" : "#ff6a00"};">
          ${lastPassed ? titlePass : titleReview}
        </div>
        <div class="hud-desc">${desc}</div>
      </div>
    `;

    const btnExit = document.createElement("button");
    btnExit.id = "btn-module-exit";
    btnExit.style.cssText = "margin-top:0.6rem;padding:0.8rem 1.5rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;width:100%;";
    btnExit.textContent = t("modules.fire_response.btn_exit_module", {}, "✖ Exit Module");
    btnExit.addEventListener("click", () => {
      cleanupFireModule();
      unloadModule();
    });
    const card = overlay.querySelector(".fire-hud-card");
    if (card && card.appendChild) {
      card.appendChild(btnExit);
    }
    overlay.appendChild(btnExit);
  }
  logger.info({ event: "fire_module_complete" }, "Fire module all steps done");
}

// entry point — tierInfo: { tier: 1|2, xrSession?, trackingState? } from webxr/marker loaders
function startFireModule(container, tierInfo) {
  _currentStep = 0;
  logger.info({ event: "fire_module_start", tier: tierInfo && tierInfo.tier }, "Fire module starting");

  cleanupFireModule();

  // initialize assessment session if not already started by loader
  if (!getActiveSession()) {
    bindAssessmentSessionListeners();
    startAssessmentSession({ moduleId: "fire-response" });
  }

  _createOverlay(container, `<div>${t("modules.fire_response.title", {}, "Loading Fire & Explosion Response...")}</div>`);
  _setupStep1(container, tierInfo);
}

const calcAimAccuracy = _calcAimAccuracy;

export {
  startFireModule,
  cleanupFireModule,
  getCurrentStep,
  calcAimAccuracy,
  calcRaycastAimAccuracy,
  calcIntersectionDistance,
  calcDragDistance,
  isPinPullComplete,
  isAimHoldComplete,
  isAimInTargetZone,
  isSqueezeComplete,
  calcSweepCoverage,
  calcMotionSweepCoverage,
  isSweepComplete,
  PIN_PULL_THRESHOLD_PX,
  AIM_HOLD_DURATION_MS,
  SQUEEZE_HOLD_DURATION_MS,
  SWEEP_MIN_COVERAGE,
  MOTION_SWEEP_TARGET_SPAN,
  FIRE_BASE_MAX_DISTANCE_3D,
  FIRE_BASE_TARGET_3D,
  AIM_PASS_THRESHOLD,
  evaluateSelectionState,
  canExecuteSelectedAction,
  evaluateGazeAimProgress,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID,
  calcMarkerDistance,
  isSafeStandoffDistance
};
