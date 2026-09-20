import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { startAlignmentSampler } from "../../ar/alignment.js";
import { selectionSingle, aimDwell, spatialAlignment, trackingSourceForTier } from "../../assessment/observations.js";
import { unloadModule } from "../../js/module-loader.js";
import { requestCertificateForAttempt, flushPendingCertificates } from "../../js/certificates.js";
import { renderCompletionPanel } from "../../js/certificate-panel.js";
import { buildFireGraphic, buildExitGraphic, buildExtinguisherGraphic, buildFireAlarmEntity, buildPeerAvatarEntity } from "./graphics.js";
import { t } from "../../js/i18n.js";
import { playNarration, stopNarration } from "../../js/audio.js";
import { cameraToMarkerSpace } from "../../ar/marker-pose.js";
import { markerDistance, formatDistance, lerpPosition, lerpAngleDeg, MARKER_SIZE_CM } from "./distance.js";
import {
  startAssessmentSession,
  finishAssessmentSession,
  abortAssessmentSession,
  getActiveSession,
  bindAssessmentSessionListeners,
  getEffectiveWorkerId
} from "../../assessment/engine.js";
import { recordStageResult, isStage2Passed } from "../../prerequisite/progress.js";
import {
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  renderGasGaugeSvg,
  renderAlertFlash,
  renderDecisionWheel,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_EXPLOSIVE_THRESHOLD,
  initOrientationNudge
} from "./decision.js";

const logger = createLogger("FireModule");
const _activeCleanups = [];
function addCleanup(fn) {
  if (typeof fn === "function") _activeCleanups.push(fn);
}

// checkpoint ids — stable identifiers for assessment engine to key on
const CP_EXIT_ID = "fire_exit_identification";
const CP_ALARM_ID = "fire_alarm_pull";
const CP_EXTINGUISHER_ID = "fire_extinguisher_aim";
// tier 2 asks the marker variant of the evacuation question. tier 1 asks its own,
// so the server holds a separate answer key for each and they must not be mixed.
const CP_EVACUATION_ID = "fire_evacuation_sequence_marker";
const CP_EVACUATION_WEBXR_ID = "fire_evacuation_sequence_webxr";

// anchor id must match checkpoint_definition.anchor_id on the server
const EXIT_ANCHOR_ID = "fire_exit_sign";

// running alignment sampler for step 1, stopped when the trainee confirms
let _exitSampler = null;

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

// branching scenario state
let _methaneReading = 2.1;
let _currentBranch = null; // "evacuate" | "suppress"
let _alarmPulled = false;
let _decisionMade = null;

// get active methane reading for scenario
function getMethaneReading() { return _methaneReading; }

// set methane reading for scenario or test
function setMethaneReading(val) { _methaneReading = val; }

// get active scenario branch
function getActiveBranch() { return _currentBranch; }

// check whether fire alarm station has been pulled
function getAlarmPulled() { return _alarmPulled; }

// get trainee choice made during drill
function getDecisionMade() { return _decisionMade; }

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

// render extinguisher in front of trainee without edge cropping
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

  // anchor extinguisher to camera comfortably within frame
  if (camera) {
    el.setAttribute("position", "0.10 -0.25 -0.88");
    el.setAttribute("rotation", "0 -10 0");
    el.setAttribute("scale", "0.26 0.26 0.26");
    camera.appendChild(el);
  } else if (scene) {
    el.setAttribute("position", "0.18 -0.28 -1.5");
    el.setAttribute("rotation", "0 -10 0");
    el.setAttribute("scale", "0.45 0.45 0.45");
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
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:0.45rem;margin-top:0.4rem;width:100%;";

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

// render hud subscreen card
function _renderSubscreen(overlay, { badge, title, desc, buttonText, onNext }) {
  if (!overlay) return;
  let hudCard = overlay.querySelector ? overlay.querySelector("#fire-hud-card") : document.getElementById("fire-hud-card");
  if (!hudCard) {
    hudCard = document.createElement("div");
    hudCard.id = "fire-hud-card";
    hudCard.className = "fire-hud-card";
    overlay.appendChild(hudCard);
  }
  hudCard.innerHTML = `
    <div class="hud-badge">${badge}</div>
    <div class="hud-title">${title}</div>
    <div class="hud-desc">${desc}</div>
  `;
  const existingBtn = document.getElementById("btn-step-next");
  if (existingBtn && existingBtn.remove) existingBtn.remove();

  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", onNext);
  hudCard.appendChild(btnNext);
  overlay.appendChild(btnNext);
}

// run branch a immediate evacuation
function _executeBranchA_Evacuate(container, tierInfo, reading) {
  _currentBranch = "evacuate";
  logger.info({ event: "fire_branch_selected", branch: "evacuate", reading }, "Branch A Evacuation activated");

  const decPanel = document.getElementById("fire-decision-panel");
  if (decPanel && decPanel.remove) decPanel.remove();
  const hudCard = document.getElementById("fire-hud-card");
  if (hudCard && hudCard.remove) hudCard.remove();
  const nextBtn = document.getElementById("btn-step-next");
  if (nextBtn && nextBtn.remove) nextBtn.remove();

  registerCheckpoint({
    id: CP_EVACUATION_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Evacuation CP triggered");
    }
  });

  let exitGraphic = _exitGraphicEl;
  if (!exitGraphic || !document.getElementById("exit-graphic")) {
    exitGraphic = _renderExitGraphic(container);
  }
  if (!_exitSampler) {
    _exitSampler = startAlignmentSampler({ targetEl: exitGraphic, anchorId: EXIT_ANCHOR_ID });
  }

  const overlay = document.getElementById("fire-module-overlay");
  if (overlay) {
    const isHigh = reading >= METHANE_EXPLOSIVE_THRESHOLD;
    overlay.innerHTML = `
      <div id="fire-hud-card" class="fire-hud-card">
        <div class="hud-badge">🚨 BRANCH A — IMMEDIATE EVACUATION</div>
        <div class="hud-title">${isHigh ? "CRITICAL METHANE LEVEL (>= 5.0%)" : "PRECAUTIONARY EVACUATION"}</div>
        <div class="hud-desc">${isHigh ? "Atmosphere is explosive. Fire suppression is strictly forbidden under mining regulations. Follow emergency route immediately." : "Evacuation selected. Move promptly along marked emergency path to the nearest safe surface exit."}</div>
      </div>
    `;

    const btn = document.createElement("button");
    btn.id = "btn-exit-found";
    btn.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
    btn.textContent = t("modules.fire_response.btn_exit", {}, "✔ I see the emergency exit");
    btn.addEventListener("click", () => {
      const sampled = _exitSampler ? _exitSampler.stop() : { angularErrorRad: null, dwellMs: 0, frameCount: 0 };
      _exitSampler = null;
      fireCheckpointResult(
        CP_EXIT_ID,
        true,
        { method: "branch_a_evacuate", measured: sampled.angularErrorRad !== null, reading },
        spatialAlignment({
          anchorId: EXIT_ANCHOR_ID,
          angularErrorRad: sampled.angularErrorRad,
          dwellMs: sampled.dwellMs,
          frameCount: sampled.frameCount,
          trackingSource: trackingSourceForTier(tierInfo && tierInfo.tier)
        })
      );
      fireCheckpointResult(
        CP_EVACUATION_ID,
        true,
        { selected: "sound_alarm_then_evacuate", branch: "evacuate", reading },
        typeof selectionSingle === "function" ? selectionSingle("sound_alarm_then_evacuate") : null
      );
      _showComplete(true);
    });
    const card = overlay.querySelector ? overlay.querySelector("#fire-hud-card") : document.getElementById("fire-hud-card");
    if (card && card.appendChild) {
      card.appendChild(btn);
    }
    overlay.appendChild(btn);
  }
}

// show 3d alarm station and require pull action
function _showAlarmPullStation(container, tierInfo, onDone) {
  _currentStep = 1;
  registerCheckpoint({
    id: CP_ALARM_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Alarm pull checkpoint triggered");
    }
  });
  const overlay = document.getElementById("fire-module-overlay");

  const camera = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? (document.querySelector("#main-camera") || document.querySelector("[camera]"))
    : null;
  const scene = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-scene")
    : null;

  const alarmEntity = buildFireAlarmEntity();
  if (camera) {
    alarmEntity.setAttribute("position", "-0.25 0.15 -1.2");
    alarmEntity.setAttribute("rotation", "0 10 0");
    camera.appendChild(alarmEntity);
  } else if (scene) {
    alarmEntity.setAttribute("position", "-0.3 0.25 -1.5");
    alarmEntity.setAttribute("rotation", "0 10 0");
    scene.appendChild(alarmEntity);
  } else if (container && container.appendChild) {
    container.appendChild(alarmEntity);
  }

  if (overlay) {
    overlay.innerHTML = `
      <div id="fire-hud-card" class="fire-hud-card">
        <div class="hud-badge">🔔 STEP 1 / 3 — SOUND ALARM (BRANCH B)</div>
        <div class="hud-title">Pull Fire Alarm Station</div>
        <div class="hud-desc">Methane is below 5.0% LEL. Before attacking the fire with an extinguisher, sound the mine section alarm to alert all miners!</div>
      </div>
    `;

    const btn = document.createElement("button");
    btn.id = "btn-pull-alarm";
    btn.style.cssText = "margin-top:0.5rem;padding:0.9rem 1.6rem;background:#ef4444;color:#fff;border:none;border-radius:10px;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 16px rgba(239,68,68,0.4);";
    btn.textContent = "🚨 PULL FIRE ALARM STATION";

    let pulled = false;
    const triggerPull = () => {
      if (pulled) return;
      pulled = true;
      _alarmPulled = true;
      logger.info({ event: "fire_alarm_pulled", branch: "suppress" }, "Fire alarm station pulled");

      btn.disabled = true;
      btn.style.background = "#10b981";
      btn.style.boxShadow = "0 0 16px rgba(16,185,129,0.4)";
      btn.textContent = "✔ ALARM ACTIVATED! PREPARING EXTINGUISHER...";

      fireCheckpointResult(
        CP_ALARM_ID,
        true,
        { method: "alarm_pull_activated", reading: _methaneReading, tier: tierInfo && tierInfo.tier },
        selectionSingle("alarm_pull")
      );

      if (alarmEntity && alarmEntity.remove) alarmEntity.remove();
      if (typeof onDone === "function") onDone();
    };

    btn.addEventListener("click", triggerPull);
    const card = overlay.querySelector ? overlay.querySelector("#fire-hud-card") : document.getElementById("fire-hud-card");
    if (card && card.appendChild) {
      card.appendChild(btn);
    }
    overlay.appendChild(btn);

    if (alarmEntity && typeof alarmEntity.addEventListener === "function") {
      alarmEntity.addEventListener("click", triggerPull);
    }
    const hitBox = document.getElementById("fire-alarm-hit-box");
    if (hitBox && typeof hitBox.addEventListener === "function") {
      hitBox.addEventListener("click", triggerPull);
    }
  }
}

// run branch b alarm pull and pass suppression
function _executeBranchB_Suppress(container, tierInfo, reading) {
  if (reading >= METHANE_EXPLOSIVE_THRESHOLD) {
    logger.warn({ event: "fire_suppress_blocked", reading }, "Suppression attempt blocked for explosive methane reading");
    return;
  }
  _currentBranch = "suppress";
  logger.info({ event: "fire_branch_selected", branch: "suppress", reading }, "Branch B Suppression activated");

  const decPanel = document.getElementById("fire-decision-panel");
  if (decPanel && decPanel.remove) decPanel.remove();
  const hudCard = document.getElementById("fire-hud-card");
  if (hudCard && hudCard.remove) hudCard.remove();
  const nextBtn = document.getElementById("btn-step-next");
  if (nextBtn && nextBtn.remove) nextBtn.remove();

  if (_exitSampler) {
    _exitSampler.stop();
    _exitSampler = null;
  }

  _showAlarmPullStation(container, tierInfo, () => {
    _setupStep2(container, tierInfo);
  });
}

// render post drill debrief log card
function _renderDebriefCard(overlay) {
  if (!overlay) return;
  const existing = document.getElementById("debrief-summary-card");
  if (existing && existing.remove) existing.remove();

  const isExplosive = _methaneReading >= METHANE_EXPLOSIVE_THRESHOLD;
  const card = document.createElement("div");
  card.id = "debrief-summary-card";
  card.style.cssText = [
    "background:#0f172a", "border:2px solid " + (isExplosive ? "#ef4444" : "#10b981"),
    "border-radius:12px", "padding:1rem", "margin-bottom:1rem",
    "color:#fff", "box-shadow:0 4px 14px rgba(0,0,0,0.5)"
  ].join(";");

  const branchLabel = _currentBranch === "evacuate"
    ? "Branch A (Immediate Evacuation)"
    : (_currentBranch === "suppress" ? "Branch B (Alarm & Suppression Drill)" : "Standard Sequence");

  const alarmStatus = _alarmPulled ? "✔ Sounded & Activated" : (_currentBranch === "evacuate" ? "N/A (Evacuated Immediately)" : "Completed");

  card.innerHTML = `
    <div style="font-size:0.8rem;font-weight:bold;color:${isExplosive ? "#f87171" : "#34d399"};letter-spacing:1px;">📋 DRILL DEBRIEF &amp; MINE SAFETY LOG</div>
    <div style="font-size:1.1rem;font-weight:bold;margin:0.25rem 0;">Hazard Response Summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin:0.5rem 0;font-size:0.85rem;">
      <div style="background:#1e293b;padding:0.45rem;border-radius:6px;">
        <span style="color:#94a3b8;display:block;">Methane Level:</span>
        <strong style="color:${isExplosive ? "#ef4444" : "#10b981"};">${_methaneReading.toFixed(1)}% CH₄ (${isExplosive ? "EXPLOSIVE" : "SAFE/INCIPIENT"})</strong>
      </div>
      <div style="background:#1e293b;padding:0.45rem;border-radius:6px;">
        <span style="color:#94a3b8;display:block;">Action Taken:</span>
        <strong>${branchLabel}</strong>
      </div>
      <div style="background:#1e293b;padding:0.45rem;border-radius:6px;">
        <span style="color:#94a3b8;display:block;">Alarm Station:</span>
        <strong>${alarmStatus}</strong>
      </div>
      <div style="background:#1e293b;padding:0.45rem;border-radius:6px;">
        <span style="color:#94a3b8;display:block;">Evacuation Status:</span>
        <strong style="color:#10b981;">✔ Safe Exit Reached</strong>
      </div>
    </div>
    <div style="font-size:0.8rem;color:#cbd5e1;line-height:1.4;margin-top:0.35rem;">
      ${isExplosive
        ? t("fire.training_feedback_explosive", "Training feedback: Trainee recognized explosive atmosphere above 5.0% LEL and executed immediate evacuation without risking secondary blast.")
        : t("fire.training_feedback_standard", "Training feedback: Trainee activated alarm pull station, successfully extinguished incipient flames using PASS technique, and evacuated to designated exit.")
      }
    </div>
  `;

  if (overlay && typeof overlay.insertBefore === "function" && overlay.firstChild) {
    overlay.insertBefore(card, overlay.firstChild);
  } else if (overlay && typeof overlay.appendChild === "function") {
    overlay.appendChild(card);
  }
}

// step 1 hazard assessment and branch selection
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

  const exitGraphic = _renderExitGraphic(container);
  // sample how well the phone stays pointed at the exit sign while the trainee
  // reads the briefing. the sign is camera anchored in this build, so the scene
  // usually cannot answer — the sampler then reports nothing measured rather than
  // inventing an angle, and the server refuses to certify on it.
  _exitSampler = startAlignmentSampler({ targetEl: exitGraphic, anchorId: EXIT_ANCHOR_ID });

  const overlay = document.getElementById("fire-module-overlay");
  playNarration({ moduleId: "fire-response", stepKey: "step_1_exit" });

  // render decision wheel for branching drill
  renderDecisionWheel(overlay, {
    reading: _methaneReading,
    onDecision: ({ choice, reading }) => {
      _decisionMade = choice;
      if (choice === DECISION_CHOICES.EVACUATE) {
        _executeBranchA_Evacuate(container, tierInfo, reading);
      } else if (choice === DECISION_CHOICES.EXTINGUISH) {
        _executeBranchB_Suppress(container, tierInfo, reading);
      }
    }
  });

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
      let hudCard = overlay.querySelector ? overlay.querySelector("#fire-hud-card") : document.getElementById("fire-hud-card");
      if (!hudCard) {
        hudCard = document.createElement("div");
        hudCard.id = "fire-hud-card";
        hudCard.className = "fire-hud-card";
        overlay.appendChild(hudCard);
      }
      hudCard.innerHTML = `
        <div class="hud-badge">🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)</div>
        <div class="hud-title">Locate Emergency Exit</div>
        <div class="hud-desc">Look for the illuminated green emergency sign anchored in AR space. Align your view with the evacuation path.</div>
      `;
      const existingBtn = document.getElementById("btn-exit-found");
      if (existingBtn && existingBtn.remove) existingBtn.remove();

      const btn = document.createElement("button");
      btn.id = "btn-exit-found";
      btn.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
      btn.textContent = t("modules.fire_response.btn_exit", {}, "✔ I see the exit");
      btn.addEventListener("click", () => {
        const sampled = _exitSampler ? _exitSampler.stop() : { angularErrorRad: null, dwellMs: 0, frameCount: 0 };
        _exitSampler = null;
        fireCheckpointResult(
          CP_EXIT_ID,
          true,
          { method: "button_confirm", measured: sampled.angularErrorRad !== null },
          spatialAlignment({
            anchorId: EXIT_ANCHOR_ID,
            angularErrorRad: sampled.angularErrorRad,
            dwellMs: sampled.dwellMs,
            frameCount: sampled.frameCount,
            trackingSource: trackingSourceForTier(tierInfo && tierInfo.tier)
          })
        );
        _setupStep2(container, tierInfo);
      });
      hudCard.appendChild(btn);
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
    if (_exitGraphicEl.parentNode && typeof _exitGraphicEl.parentNode.removeChild === "function") {
      _exitGraphicEl.parentNode.removeChild(_exitGraphicEl);
    } else if (typeof _exitGraphicEl.remove === "function") {
      _exitGraphicEl.remove();
    }
    _exitGraphicEl = null;
  }

  const graphic = _renderFireGraphic(container);
  _renderExtinguisherGraphic(container);
  const overlay = document.getElementById("fire-module-overlay");

  let _recordedAccuracy = null;
  let _recordedDistance = null;
  // a tapped button is not a measurement. only a real raycast hit sets this, and
  // only a real raycast hit may travel to the server as a distance.
  let _distanceFromRaycast = false;
  let _recordedSweepCoverage = null;
  let _aimFrameCount = 0;
  let _aimStartedMs = null;

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
      if (point) {
        _distanceFromRaycast = true;
        _aimFrameCount += 1;
        if (_aimStartedMs === null) _aimStartedMs = Date.now();
      }
      startHold(accuracy, distance);
    };

    if (gazeLaser && typeof gazeLaser.addEventListener === "function") {
      gazeLaser.addEventListener("raycaster-intersection", onRaycastIntersection);
      gazeLaser.addEventListener("raycaster-intersection-cleared", stopHold);
      gazeLaser.simulateIntersection = (point = { x: 0, y: 0.16, z: 0 }) => {
        const distance = calcIntersectionDistance(point, { x: 0, y: 0.16, z: 0 });
        const accuracy = calcRaycastAimAccuracy(distance);
        _distanceFromRaycast = true;
        _aimFrameCount += 1;
        if (_aimStartedMs === null) _aimStartedMs = Date.now();
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

      // the server grades the raw hit distance. a tapped fallback measured nothing,
      // so it reports null and the server scores it zero rather than guessing.
      const measuredDistanceM = _distanceFromRaycast ? finalDistance : null;

      fireCheckpointResult(
        CP_EXTINGUISHER_ID,
        passed,
        {
          method: sync ? "button_fallback" : "physical_motion_sweep",
          accuracy: finalAccuracy,
          distance: finalDistance,
          target: passed ? "base" : "missed",
          tier: tierInfo && tierInfo.tier
        },
        aimDwell({
          hitDistanceM: measuredDistanceM,
          dwellMs: _aimStartedMs === null ? 0 : Date.now() - _aimStartedMs,
          sweepCoverage: typeof _recordedSweepCoverage === "number" ? _recordedSweepCoverage : null,
          frameCount: _aimFrameCount,
          trackingSource: trackingSourceForTier(tierInfo && tierInfo.tier)
        })
      );

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
      _recordedSweepCoverage = coverage;
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

          _recordedSweepCoverage = coverage;
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
        fireCheckpointResult(
          CP_EVACUATION_ID,
          passed,
          { selected: selectedId, correct: "sound_alarm_then_evacuate" },
          typeof selectionSingle === "function" ? selectionSingle(selectedId) : null
        );
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
  _currentBranch = null;
  _alarmPulled = false;
  _decisionMade = null;
  // reset team scenario state
  _teamAlarmSetup = false;
  _teamExtSetup = false;
  _teamEvacSetup = false;
  _teamPhase = "lobby";
  _teamIsReady = false;
  _peerAvatars = {};
  _peerPosMap = {};
  _localMarkerPos = null;
  _teamState = {};
  _teamRoleDoubling = null;
  _clearHintTimer();
  if (_teamSessionMod && typeof _teamSessionMod.resetTeamSession === "function") {
    _teamSessionMod.resetTeamSession();
  }
  _teamSessionMod = null;
  if (typeof document !== "undefined") {
    document.getElementById("team-module-overlay")?.remove();
    document.getElementById("team-peer-banner")?.remove();
    document.getElementById("team-debrief-card")?.remove();
    document.getElementById("team-coverage-strip")?.remove();
  }
  stopNarration();
  // a sampler left running holds a requestAnimationFrame loop against a scene
  // that is about to be torn down
  if (_exitSampler) {
    _exitSampler.stop();
    _exitSampler = null;
  }
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
    "safear-orientation-nudge",
    "fire-module-overlay",
    "fire-decision-panel",
    "fire-alarm-station",
    "fire-alert-overlay",
    "btn-pull-alarm",
    "debrief-summary-card",
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
    document.querySelectorAll("#exit-graphic, #fire-graphic, #extinguisher-graphic, #fire-alarm-station").forEach((el) => {
      if (typeof el.setAttribute === "function") el.setAttribute("visible", "false");
      if (el.object3D) el.object3D.visible = false;
      if (el.parentNode) el.parentNode.removeChild(el);
      else if (typeof el.remove === "function") el.remove();
    });
  }
}

// show completion panel after all three steps done
function _showComplete(_lastPassed) {
  _currentStep = 0;

  const overlay = document.getElementById("fire-module-overlay");
  const theme = { passColor: "#00e676", failColor: "#ff6a00", exitColor: "#ff6a00", exitTextColor: "#fff" };

  let evaluated = null;
  if (getActiveSession()) {
    try {
      // the evaluated attempt is the aggregate result. the last checkpoint alone
      // does not decide whether the module was passed.
      evaluated = finishAssessmentSession();
    } catch (err) {
      logger.warn({ event: "assessment_finish_error", error: err.message }, "Assessment finalize failed");
    }
  }

  function draw() {
    renderCompletionPanel(overlay, {
      evaluated: evaluated || {},
      theme,
      exitLabel: t("modules.fire_response.btn_exit_module", {}, "✖ Exit Module"),
      onExit: () => {
        cleanupFireModule();
        unloadModule();
      }
    });

    _renderDebriefCard(overlay);
  }

  // draw at once from local state so the worker sees a result with no network
  draw();

  // then ask for the certificate. finishAssessmentSession already fired its own
  // background sync and discarded the response, so there is nothing left to observe
  // and no second sync is started here. the server still decides: a run that did not
  // pass comes back 422 and the pending item is dropped.
  if (evaluated && evaluated.passed === true) {
    requestCertificateForAttempt(evaluated);
    draw();
    flushPendingCertificates()
      .then(() => draw())
      .catch((err) => {
        logger.warn({ event: "certificate_flush_error", error: err.message }, "Certificate flush failed");
      });
  }

  if (evaluated && typeof evaluated.percentage === "number") {
    recordStageResult(getEffectiveWorkerId(), "fire-response", 2, evaluated.percentage / 100);
  }

  logger.info({ event: "fire_module_complete" }, "Fire module all steps done");
}

// entry point — tierInfo: { tier: 1|2, xrSession?, trackingState? }, options: { reading? }
function startFireModule(container, tierInfo, options = {}) {
  _currentStep = 0;
  logger.info({ event: "fire_module_start", tier: tierInfo && tierInfo.tier }, "Fire module starting");

  cleanupFireModule();

  if (options && typeof options.reading === "number" && !isNaN(options.reading)) {
    _methaneReading = options.reading;
  } else {
    _methaneReading = generateMethaneReading();
  }

  // initialize orientation recommendation toast for portrait view
  const nudge = initOrientationNudge(container);
  if (nudge && nudge.destroy) {
    addCleanup(() => nudge.destroy());
  }

  // trigger explosion alert flash pulse
  const alertStrobe = renderAlertFlash(container, {
    durationMs: 1800,
    onDone: () => {}
  });
  if (alertStrobe && alertStrobe.dismiss) {
    addCleanup(() => alertStrobe.dismiss());
  }

  // initialize assessment session if not already started by loader
  if (!getActiveSession()) {
    bindAssessmentSessionListeners();
    startAssessmentSession({ moduleId: "fire-response" });
  }

  _createOverlay(container, `<div>${t("modules.fire_response.title", {}, "Loading Fire & Explosion Response...")}</div>`);
  _setupStep1(container, tierInfo);
}

// hint timer for team scenario (assessment)
const HINT_TIMEOUT_MS = 15000;
let _hintTimer = null;
let _hintShown = false;

function _startHintTimer(overlay, hintText) {
  _clearHintTimer();
  _hintShown = false;
  _hintTimer = setTimeout(() => {
    _hintShown = true;
    if (overlay) {
      let hintEl = overlay.querySelector ? overlay.querySelector("#fire-step-hint") : null;
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.id = "fire-step-hint";
        hintEl.style.cssText = "margin-top:0.6rem;padding:0.6rem 0.8rem;background:rgba(245,158,11,0.15);border-left:3px solid #f59e0b;border-radius:4px;font-size:0.85rem;color:#fcd34d;line-height:1.4;";
        overlay.appendChild(hintEl);
      }
      hintEl.textContent = hintText;
    }
  }, HINT_TIMEOUT_MS);
}

function _clearHintTimer() {
  if (_hintTimer) {
    clearTimeout(_hintTimer);
    _hintTimer = null;
  }
}

let _peerAvatars = {};
let _teamState = {};
let _teamPhase = "lobby";
let _teamIsReady = false;
let _teamRoleDoubling = null;
let _peerPosMap = {};
let _localMarkerPos = null;
let _peerBannerTimer = null;
let _teamAlarmSetup = false;
let _teamExtSetup = false;
let _teamEvacSetup = false;
let _teamSessionMod = null;
let _teamCheckpointHandler = null;

// update peer avatar in marker space with lerp step
function _updatePeerAvatarPose(avatar, pos) {
  if (!avatar || !pos) return;
  const targetX = typeof pos.x === "number" ? pos.x : 0;
  const targetZ = typeof pos.z === "number" ? pos.z : 0;
  const targetHeading = typeof pos.headingDeg === "number" ? pos.headingDeg : 0;

  if (!avatar._currentPose) {
    avatar._currentPose = { x: targetX, y: 0, z: targetZ, headingDeg: targetHeading };
  } else {
    const nextPos = lerpPosition(avatar._currentPose, { x: targetX, y: 0, z: targetZ }, 0.5);
    const nextHeading = lerpAngleDeg(avatar._currentPose.headingDeg, targetHeading, 0.5);
    avatar._currentPose = { x: nextPos.x, y: 0, z: nextPos.z, headingDeg: nextHeading };
  }

  avatar.setAttribute("position", `${avatar._currentPose.x} 0 ${avatar._currentPose.z}`);
  avatar.setAttribute("rotation", `0 ${avatar._currentPose.headingDeg} 0`);
}

// dim or restore grounded avatar visuals when peer signal weak
function _setAvatarStale(peerRole, isStale) {
  const avatar = _peerAvatars[peerRole];
  if (!avatar) return;
  const elements = avatar.querySelectorAll ? avatar.querySelectorAll("a-circle, a-ring, a-triangle, a-text, a-sphere, a-cone, .peer-avatar-ground-disc, .peer-avatar-ground-ring, .peer-avatar-shadow, .peer-avatar-heading, .peer-avatar-label") : [];
  for (const el of elements) {
    if (el.setAttribute) {
      if (el.classList && el.classList.contains("peer-avatar-shadow")) {
        el.setAttribute("opacity", isStale ? "0.1" : "0.3");
      } else if (el.classList && el.classList.contains("peer-avatar-heading")) {
        el.setAttribute("opacity", isStale ? "0.2" : "0.9");
      } else if (el.classList && el.classList.contains("peer-avatar-ground-ring")) {
        el.setAttribute("opacity", isStale ? "0.25" : "0.85");
      } else if (el.classList && el.classList.contains("peer-avatar-ground-disc")) {
        el.setAttribute("opacity", isStale ? "0.1" : "0.35");
      } else {
        el.setAttribute("opacity", isStale ? "0.2" : "0.7");
      }
    }
  }
}

// show peer action toast banner with distance in ar view
function _showPeerActionBanner(peerRole, action, status) {
  let banner = document.getElementById("team-peer-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "team-peer-banner";
    banner.style.cssText = [
      "position:fixed", "top:60px", "left:50%", "transform:translateX(-50%)",
      "background:rgba(15,23,42,0.9)", "border:1px solid #3b82f6",
      "border-radius:20px", "padding:0.4rem 1rem", "font-size:0.85rem",
      "color:#93c5fd", "z-index:102", "pointer-events:none",
      "box-shadow:0 4px 12px rgba(0,0,0,0.4)", "transition:opacity 0.3s ease"
    ].join(";");
    document.body.appendChild(banner);
  }

  let roleName = t(`modules.fire_response.role_${peerRole}`, {}, peerRole.replace("_", " ").toUpperCase());
  const canonicalOwners = {
    fire_alarm: "alarm",
    alarm_pulled: "alarm",
    pull_alarm: "alarm",
    fire_extinguisher: "extinguisher_operator",
    fire_extinguished: "extinguisher_operator",
    extinguish_fire: "extinguisher_operator",
    evacuation_check: "backup_coordinator",
    evac_checked: "backup_coordinator",
    coordinate_evac: "backup_coordinator"
  };
  const canonicalRole = canonicalOwners[action];
  if (canonicalRole && canonicalRole !== peerRole) {
    const coveringRoleLabel = canonicalRole === "backup_coordinator" ? "EVAC" : (canonicalRole === "alarm" ? "ALARM" : "EXT");
    roleName = `${roleName} (${t("fire.team_covering_label", { role: coveringRoleLabel }, `covering ${coveringRoleLabel}`)})`;
  }

  let actionLabel = action;
  if (action === "fire_alarm" || action === "alarm_pulled" || action === "pull_alarm") actionLabel = t("fire.action_alarm", "Alarm Pull");
  else if (action === "fire_extinguisher" || action === "fire_extinguished" || action === "extinguish_fire") actionLabel = t("fire.action_ext", "Extinguisher PASS");
  else if (action === "evacuation_check" || action === "evac_checked" || action === "coordinate_evac") actionLabel = t("fire.action_evac", "Evacuation Route");

  const peerPos = _peerPosMap[peerRole];
  const dist = _localMarkerPos && peerPos ? markerDistance(_localMarkerPos, peerPos, MARKER_SIZE_CM) : null;
  const distText = dist !== null ? t("fire.dist_away", { dist: formatDistance(dist) }, ` (${formatDistance(dist)} away)`) : "";

  if (status === "started") {
    banner.textContent = t("fire.peer_action_started", { role: roleName, action: actionLabel, dist: distText }, `${roleName} approaching ${actionLabel}${distText}`);
  } else {
    banner.textContent = t("fire.peer_action_completed", { action: actionLabel, role: roleName, dist: distText }, `${actionLabel} completed by ${roleName}${distText}`);
  }

  banner.style.display = "block";
  banner.style.opacity = "1";
  const root = document.getElementById("ar-viewport") || document.body || document.documentElement;
  if (root && !banner.parentNode) root.appendChild(banner);

  if (_peerBannerTimer) clearTimeout(_peerBannerTimer);
  _peerBannerTimer = setTimeout(() => {
    if (banner) banner.style.opacity = "0";
  }, 3500);
}

// update distance hud to fire and teammates in ar view
function _updateDistanceHud(ui) {
  if (!ui) return;
  let hud = ui.querySelector("#team-distance-hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "team-distance-hud";
    hud.style.cssText = "margin-top:0.4rem;font-size:0.8rem;color:#9ca3af;display:flex;flex-wrap:wrap;gap:0.6rem;";
    const panel = ui.querySelector("#team-ui-panel");
    if (panel) panel.appendChild(hud);
  }

  const fireDist = _localMarkerPos ? markerDistance(_localMarkerPos, { x: 0, z: 0 }, MARKER_SIZE_CM) : null;
  const parts = [];
  parts.push(`${t("fire.hud_dist_fire", "Fire")}: ${fireDist !== null ? formatDistance(fireDist) : "--"}`);

  for (const [pRole, pPos] of Object.entries(_peerPosMap)) {
    const d = _localMarkerPos && pPos ? markerDistance(_localMarkerPos, pPos, MARKER_SIZE_CM) : null;
    const name = t(`modules.fire_response.role_${pRole}`, {}, pRole.replace("_", " "));
    parts.push(`${name}: ${d !== null ? formatDistance(d) : "--"}`);
  }

  hud.textContent = parts.join(" | ");
}

// show completion debrief modal with team score and breakdown
function _showDrillDebriefCard(container, role, result) {
  const oldCard = document.getElementById("team-debrief-card");
  if (oldCard) oldCard.remove();

  const card = document.createElement("div");
  card.id = "team-debrief-card";
  card.style.cssText = [
    "position:fixed", "top:50%", "left:50%", "transform:translate(-50%,-50%)",
    "background:rgba(15,23,42,0.95)", "border:2px solid #3b82f6",
    "border-radius:12px", "padding:1.5rem", "color:#fff",
    "font-family:sans-serif", "max-width:90vw", "width:360px",
    "z-index:200", "box-shadow:0 8px 32px rgba(0,0,0,0.6)", "text-align:center"
  ].join(";");

  const teamScore = typeof result.teamScore === "number" ? result.teamScore : (result.score || 0);
  const passed = result.passed !== undefined ? result.passed : teamScore >= 80;
  const roleScore = (result.perRole && result.perRole[role]) ? result.perRole[role] : teamScore;
  const bd = result.breakdown || {};

  card.innerHTML = `
    <h2 style="margin-top:0;color:#60a5fa;font-size:1.4rem;">${t("fire.team_debrief_title", "Team Drill Debrief")}</h2>
    <div style="font-size:2rem;font-weight:bold;margin:0.5rem 0;color:${passed ? '#34d399' : '#f87171'};">${teamScore}/100</div>
    <div style="display:inline-block;padding:0.25rem 0.8rem;border-radius:999px;font-weight:bold;font-size:0.85rem;background:${passed ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};color:${passed ? '#34d399' : '#f87171'};margin-bottom:1rem;">
      ${passed ? t("fire.team_passed", "DRILL PASSED") : t("fire.team_failed", "RETRY REQUIRED")}
    </div>
    <div style="text-align:left;background:rgba(0,0,0,0.3);border-radius:8px;padding:0.8rem;margin-bottom:1rem;font-size:0.85rem;line-height:1.6;">
      <div><strong>${t("fire.team_your_role_score", "Your Role Score")}:</strong> ${roleScore}%</div>
      ${bd.completionScore !== undefined ? `<div>${t("fire.bd_completion", "Completion")}: ${bd.completionScore}/60</div>` : ""}
      ${bd.speedScore !== undefined ? `<div>${t("fire.bd_speed", "Speed")}: ${bd.speedScore}/25</div>` : ""}
      ${bd.errorPenalty !== undefined ? `<div>${t("fire.bd_errors", "Error Penalty")}: -${bd.errorPenalty}</div>` : ""}
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button id="btn-team-replay" style="flex:1;padding:0.7rem;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">${t("fire.team_btn_replay", "Ready Again")}</button>
      <button id="btn-team-exit" style="flex:1;padding:0.7rem;background:#475569;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">${t("fire.team_btn_exit", "Exit")}</button>
    </div>
  `;
  const root = container || document.getElementById("ar-viewport") || document.body || document.documentElement;
  if (root) root.appendChild(card);

  card.querySelector("#btn-team-replay")?.addEventListener("click", () => {
    card.remove();
    _teamAlarmSetup = false;
    _teamExtSetup = false;
    _teamEvacSetup = false;
    _teamPhase = "lobby";
    _teamIsReady = true;
    if (_teamSessionMod && typeof _teamSessionMod.sendReady === "function") {
      _teamSessionMod.sendReady();
    }
  });

  card.querySelector("#btn-team-exit")?.addEventListener("click", () => {
    card.remove();
    cleanupFireModule();
  });
}

// render lobby screen with role status and ready toggle
function _renderLobbyUI(ui, role, tierInfo) {
  let lobby = ui.querySelector("#team-lobby-panel");
  if (!lobby) {
    lobby = document.createElement("div");
    lobby.id = "team-lobby-panel";
    lobby.style.cssText = "margin-top:0.6rem;background:rgba(0,0,0,0.3);border-radius:6px;padding:0.8rem;";
    const panel = ui.querySelector("#team-ui-panel");
    if (panel) panel.appendChild(lobby);
  }

  const markerOk = tierInfo && tierInfo.trackingState && tierInfo.trackingState.markerVisible;
  const markerStatusText = markerOk
    ? t("fire.team_marker_calibrated", "✔ Hiro marker calibrated")
    : t("fire.team_calibrate_notice", "Aim camera at Hiro marker to calibrate");

  const peers = _teamSessionMod && typeof _teamSessionMod.getPeers === "function" ? _teamSessionMod.getPeers() : [];
  const presentRoles = new Set(peers);
  presentRoles.add(role);

  const roles = ["alarm", "extinguisher_operator", "backup_coordinator"];
  const roleItems = roles.map((r) => {
    const isSelf = r === role;
    const isPresent = presentRoles.has(r);
    const label = t(`modules.fire_response.role_${r}`, {}, r.replace("_", " ").toUpperCase());
    return `<div style="display:flex;justify-content:space-between;font-size:0.85rem;padding:0.2rem 0;color:${isPresent ? '#34d399' : '#9ca3af'};">
      <span>${isPresent ? "✔" : "⌛"} ${label} ${isSelf ? `(${t("fire.team_self", "You")})` : ""}</span>
      <span>${isPresent ? t("fire.team_status_present", "Connected") : t("fire.team_status_waiting_for", { role: label }, `Waiting for: ${label}`)}</span>
    </div>`;
  }).join("");

  const isDoublingPair = presentRoles.size === 2 && presentRoles.has("alarm") && presentRoles.has("extinguisher_operator");
  const doublingNoticeHtml = isDoublingPair
    ? `<div id="team-doubling-notice" style="margin-bottom:0.6rem;padding:0.3rem 0.5rem;background:rgba(59,130,246,0.2);border:1px solid #3b82f6;border-radius:4px;font-size:0.8rem;color:#93c5fd;">${t("fire.team_doubling_notice", "2 players connected: Alarm Operator will cover Evacuation.")}</div>`
    : "";

  lobby.innerHTML = `
    <div style="font-size:0.85rem;margin-bottom:0.4rem;color:#93c5fd;"><strong>${t("fire.team_lobby_header", "Drill Lobby")}</strong></div>
    <div style="margin-bottom:0.6rem;">${roleItems}</div>
    ${doublingNoticeHtml}
    <div style="font-size:0.8rem;color:${markerOk ? '#34d399' : '#fbbf24'};margin-bottom:0.6rem;">${markerStatusText}</div>
    <button id="btn-team-ready" style="width:100%;padding:0.6rem;background:${_teamIsReady ? '#10b981' : '#2563eb'};color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
      ${_teamIsReady ? t("fire.team_ready_waiting", "Ready (Waiting for team...)") : t("fire.team_ready", "I am Ready")}
    </button>
  `;

  const readyBtn = lobby.querySelector("#btn-team-ready");
  readyBtn?.addEventListener("click", () => {
    _teamIsReady = true;
    if (_teamSessionMod && typeof _teamSessionMod.sendReady === "function") {
      _teamSessionMod.sendReady();
    }
    readyBtn.textContent = t("fire.team_ready_waiting", "Ready (Waiting for team...)");
    readyBtn.style.background = "#10b981";
  });
}

// update role coverage strip chips based on team state
function _updateRoleCoverageStrip(ui) {
  if (!ui) return;
  let strip = ui.querySelector("#team-coverage-strip");
  if (!strip) {
    strip = document.createElement("div");
    strip.id = "team-coverage-strip";
    strip.style.cssText = "display:flex;gap:0.4rem;margin-bottom:0.6rem;";
    const panel = ui.querySelector("#team-ui-panel");
    const instr = ui.querySelector("#team-instruction");
    if (panel && instr) {
      panel.insertBefore(strip, instr);
    } else if (panel) {
      panel.appendChild(strip);
    }
  }

  const isAlarmDone = Boolean(_teamState && _teamState.alarm_pulled);
  const isExtDone = Boolean(_teamState && _teamState.fire_extinguished);
  const isEvacDone = Boolean(_teamState && _teamState.evac_checked);

  const chips = [
    { key: "alarm", done: isAlarmDone, label: t("fire.team_chip_alarm", "Alarm") },
    { key: "ext", done: isExtDone, label: t("fire.team_chip_ext", "Extinguisher") },
    { key: "evac", done: isEvacDone, label: t("fire.team_chip_evac", "Evacuation") }
  ];

  strip.innerHTML = chips.map((c) => {
    const bg = c.done ? "rgba(16,185,129,0.25)" : "rgba(107,114,128,0.2)";
    const border = c.done ? "#10b981" : "#4b5563";
    const text = c.done ? "#34d399" : "#9ca3af";
    const icon = c.done ? "✔" : "○";
    return `<div id="chip-${c.key}" style="flex:1;padding:0.25rem 0.4rem;border-radius:4px;background:${bg};border:1px solid ${border};color:${text};font-size:0.75rem;text-align:center;font-weight:600;">${icon} ${c.label}</div>`;
  }).join("");
}

async function startTeamScenario(container, tierInfo) {
  logger.info({ tier: tierInfo.tier }, "Starting Fire-Response Team Scenario");

  if (!isStage2Passed(getEffectiveWorkerId(), "fire-response")) {
    _createOverlay(container, `<div><h3>${t("fire.team_locked_title", "Team Drill Locked")}</h3><p>${t("fire.team_locked_desc", "Pass the solo fire drill with 80% or higher before joining a team drill.")}</p></div>`);
    logger.warn({ event: "team_drill_blocked_stage" }, "Team drill blocked, solo stage not passed");
    return false;
  }

  if (tierInfo.tier === 1) {
    _createOverlay(container, `<div><h3 style="color:#ef4444;">${t("fire.team_tier1_error", "Team Scenario requires Tier-2 (Marker) Mode")}</h3><p>${t("fire.team_tier1_desc", "Please use the AR.js marker version for multiplayer so all devices share the same coordinate system.")}</p></div>`);
    return;
  }

  // dynamic import so solo play never loads ws client
  _teamSessionMod = await import("./team-session.js");
  const {
    promptJoinTeamSession,
    sendPositionUpdate,
    sendHeartbeat,
    updateRoomState,
    getRoomState,
    onStateChange,
    onPeerPosition,
    onPeerJoinLeave,
    onSessionError,
    onPeerStale,
    onDrillAborted,
    sendActionStart,
    sendActionEnd,
    onPhaseChange,
    onPeerAction,
    onDrillResult,
    getCurrentPhase,
    getRoleDoubling
  } = _teamSessionMod;

  const workerId = getEffectiveWorkerId();
  const role = await promptJoinTeamSession(container, { workerId, markerId: "hiro", markerSizeCm: MARKER_SIZE_CM });
  logger.info({ role, workerId }, "Team session joined");
  _teamState = getRoomState();
  _teamPhase = (typeof getCurrentPhase === "function" ? getCurrentPhase() : "lobby") || "lobby";
  _teamRoleDoubling = (typeof getRoleDoubling === "function" ? getRoleDoubling() : null) || null;

  // team overlay uses distinct id so _showAlarmPullStation doesn't nuke it
  const ui = document.createElement("div");
  ui.id = "team-module-overlay";
  ui.style.cssText = [
    "position:fixed", "bottom:0", "left:0", "right:0",
    "background:transparent", "color:#fff",
    "font-family:sans-serif", "padding:1.2rem",
    "z-index:101", "pointer-events:auto"
  ].join(";");
  ui.innerHTML = `
    <div id="team-ui-panel" style="background:rgba(0,0,0,0.8);border:1px solid #444;border-radius:8px;padding:1rem;">
      <div style="margin-bottom:0.4rem;padding:0.4rem 0.6rem;background:rgba(245,158,11,0.15);border-left:3px solid #f59e0b;border-radius:4px;font-size:0.8rem;color:#fcd34d;">${t("fire.team_wifi_notice", "⚠ Phase 3 needs all devices on the same WiFi")}</div>
      <h3 style="margin-top:0;margin-bottom:0.5rem;color:#fff;">${t("fire.team_role", "Role")}: <span style="color:#60a5fa;text-transform:uppercase;">${role.replace("_", " ")}</span></h3>
      <div id="team-coverage-strip" style="display:flex;gap:0.4rem;margin-bottom:0.6rem;"></div>
      <div id="team-instruction" style="font-size:1.1rem;color:#e5e7eb;margin-bottom:0.5rem;">${t("fire.team_wait", "Waiting for team...")}</div>
      <div id="team-error" role="status" style="min-height:1.2rem;color:#fca5a5;font-size:0.85rem;"></div>
    </div>
  `;
  container.appendChild(ui);
  addCleanup(() => { if (ui.parentNode) ui.remove(); });
  _updateRoleCoverageStrip(ui);

  onSessionError((message) => {
    const errorEl = ui.querySelector("#team-error");
    if (errorEl) errorEl.textContent = message;
  });

  // dim avatar and warn when peer connection weak
  onPeerStale((peerRole) => {
    _setAvatarStale(peerRole, true);
    const errorEl = ui.querySelector("#team-error");
    if (errorEl) {
      const roleName = t(`modules.fire_response.role_${peerRole}`, {}, peerRole.replace("_", " "));
      errorEl.textContent = t("fire.team_peer_weak", { role: roleName }, `${roleName} connection weak`);
    }
  });

  // reset scene and return to lobby on abort
  onDrillAborted((reason) => {
    const errorEl = ui.querySelector("#team-error");
    if (errorEl) {
      errorEl.textContent = t("fire.team_drill_aborted", { reason }, `Drill aborted: ${reason}`);
    }
    _teamAlarmSetup = false;
    _teamExtSetup = false;
    _teamEvacSetup = false;
    _teamPhase = "lobby";
    _teamIsReady = false;
    _teamRoleDoubling = null;
    _clearHintTimer();
    _updateRoleCoverageStrip(ui);
    const instr = ui.querySelector("#team-instruction");
    if (instr) instr.textContent = t("fire.team_wait", "Waiting for team...");
    _updateTeamFlow(role, container, tierInfo, ui);
  });

  // broadcast position in marker-local space, only when marker tracked
  const camera = document.querySelector("[camera]");
  const marker = document.querySelector("a-marker");
  if (!marker) return;

  const sendPosInterval = setInterval(() => {
    if (camera && marker && tierInfo.trackingState && tierInfo.trackingState.markerVisible) {
      const camPos = camera.getAttribute("position");
      const camRot = camera.getAttribute("rotation");
      const markerPos = marker.getAttribute("position");
      const markerRot = marker.getAttribute("rotation");
      const local = cameraToMarkerSpace(
        camPos, camRot && camRot.y,
        markerPos, markerRot && markerRot.y
      );
      if (local) {
        _localMarkerPos = local;
        sendPositionUpdate({ x: local.x, z: local.z, headingDeg: local.yawDeg });
        _updateDistanceHud(ui);
      }
    }
  }, 250);
  addCleanup(() => clearInterval(sendPosInterval));

  // heartbeat every 2s so server can tell marker-lost from phone-dead
  const heartbeatInterval = setInterval(() => {
    sendHeartbeat(tierInfo.trackingState ? tierInfo.trackingState.markerVisible : false);
  }, 2000);
  addCleanup(() => clearInterval(heartbeatInterval));

  onPeerPosition((peerRole, pos) => {
    _setAvatarStale(peerRole, false);
    _peerPosMap[peerRole] = pos;
    const errorEl = ui.querySelector("#team-error");
    if (errorEl && errorEl.textContent && errorEl.textContent.includes("connection weak")) {
      errorEl.textContent = "";
    }
    if (!_peerAvatars[peerRole]) {
      const avatar = buildPeerAvatarEntity(peerRole);
      marker.appendChild(avatar);
      _peerAvatars[peerRole] = avatar;
    }
    _updatePeerAvatarPose(_peerAvatars[peerRole], pos);
    _updateDistanceHud(ui);
  });
  
  onPeerJoinLeave((peerRole, action) => {
    if (action === "left") {
      delete _peerPosMap[peerRole];
      if (_peerAvatars[peerRole]) {
        if (_peerAvatars[peerRole].parentNode) _peerAvatars[peerRole].parentNode.removeChild(_peerAvatars[peerRole]);
        delete _peerAvatars[peerRole];
      }
      _updateDistanceHud(ui);
    }
    if (_teamPhase === "lobby") {
      _renderLobbyUI(ui, role, tierInfo);
    }
  });

  onStateChange((newState) => {
    _teamState = newState;
    _updateRoleCoverageStrip(ui);
    _updateTeamFlow(role, container, tierInfo, ui);
  });

  onPhaseChange((newPhase, startedAtMs, roleDoubling) => {
    _teamPhase = newPhase;
    if (roleDoubling !== undefined) _teamRoleDoubling = roleDoubling;
    if (newPhase === "guided" || newPhase === "unguided") {
      _teamAlarmSetup = false;
      _teamExtSetup = false;
      _teamEvacSetup = false;
    }
    if (newPhase === "unguided") {
      const oldCard = document.getElementById("fire-hud-card");
      if (oldCard) oldCard.remove();
    }
    logger.info({ newPhase }, "Team phase changed");
    _updateRoleCoverageStrip(ui);
    _updateTeamFlow(role, container, tierInfo, ui);
  });

  onPeerAction((peerRole, action, status) => {
    _showPeerActionBanner(peerRole, action, status);
  });

  onDrillResult((msg) => {
    _teamPhase = "complete";
    const res = msg.result || msg;
    const teamScore = typeof res.teamScore === "number" ? res.teamScore : (res.score || 0);
    const passed = res.passed !== undefined ? res.passed : teamScore >= 80;
    const currentWorkerId = getEffectiveWorkerId();

    if (passed) {
      const myAttemptId = (res.attempts && res.attempts[role]) || res.attemptId;
      if (myAttemptId) {
        requestCertificateForAttempt({
          attemptId: myAttemptId,
          moduleId: "fire-response-team",
          workerId: currentWorkerId,
          passed: true
        });
        flushPendingCertificates().catch(() => {});
      }
    }

    _showDrillDebriefCard(container, role, res);
  });

  // listen for AR interactions to update shared state
  _teamCheckpointHandler = (e) => {
    const detail = e.detail || {};
    if (_hintShown) {
      logger.info({ event: "team_hint_used", role }, "Team hint was visible before action");
      _hintShown = false;
    }
    const isCoveringAlarm = _teamRoleDoubling === "alarm" || (_teamRoleDoubling && _teamRoleDoubling.alarm === role);
    const canDoAlarm = role === "alarm" || isCoveringAlarm;
    const isCoveringExt = _teamRoleDoubling === "extinguisher_operator" || (_teamRoleDoubling && _teamRoleDoubling.extinguisher_operator === role);
    const canDoExt = role === "extinguisher_operator" || isCoveringExt;
    const isCoveringEvac = _teamRoleDoubling === "backup_coordinator" || (_teamRoleDoubling && _teamRoleDoubling.backup_coordinator === role);
    const canDoEvac = role === "backup_coordinator" || isCoveringEvac;

    if (detail.checkpointId === CP_ALARM_ID && canDoAlarm && detail.passed) {
      if (typeof sendActionStart === "function") sendActionStart("fire_alarm");
      updateRoomState({ alarm_pulled: true });
      if (typeof sendActionEnd === "function") sendActionEnd("fire_alarm");
    }
    if (detail.checkpointId === CP_EXTINGUISHER_ID && canDoExt && detail.passed) {
      if (typeof sendActionStart === "function") sendActionStart("fire_extinguisher");
      updateRoomState({ fire_extinguished: true });
      if (typeof sendActionEnd === "function") sendActionEnd("fire_extinguisher");
    }
    if ((detail.checkpointId === CP_EVACUATION_ID || detail.checkpointId === CP_EVACUATION_WEBXR_ID) && canDoEvac && detail.passed) {
      if (typeof sendActionStart === "function") sendActionStart("evacuation_check");
      updateRoomState({ evac_checked: true });
      if (typeof sendActionEnd === "function") sendActionEnd("evacuation_check");
    }
  };
  window.addEventListener("safear:checkpoint", _teamCheckpointHandler);
  addCleanup(() => window.removeEventListener("safear:checkpoint", _teamCheckpointHandler));

  _updateTeamFlow(role, container, tierInfo, ui);
}

// update team flow ui based on server phase and room state
function _updateTeamFlow(role, container, tierInfo, ui) {
  const instr = ui.querySelector("#team-instruction");
  if (!instr) return;

  const phase = _teamPhase || "guided";

  if (phase === "lobby") {
    _renderLobbyUI(ui, role, tierInfo);
    return;
  }

  // clear lobby elements if phase transitioned
  const lobbyPanel = ui.querySelector("#team-lobby-panel");
  if (lobbyPanel) lobbyPanel.remove();

  if (phase === "unguided") {
    // COLD START: no hint timer on entry, neutral prompt, no order reveal
    const oldCard = document.getElementById("fire-hud-card");
    if (oldCard) oldCard.remove();
    instr.textContent = t("fire.team_unguided_prompt", "Emergency scenario active: Take proper action for your role.");

    const isCoveringEvac = _teamRoleDoubling === "backup_coordinator" || (_teamRoleDoubling && _teamRoleDoubling.backup_coordinator === role);

    if (role === "alarm") {
      if (!_teamAlarmSetup) {
        _teamAlarmSetup = true;
        _startHintTimer(ui, t("fire.team_alarm_hint", "Hint: Tap the red fire alarm pull station."));
        _showAlarmPullStation(container, tierInfo, () => {
          _clearHintTimer();
        });
      }
      if (isCoveringEvac && _teamState.alarm_pulled && !_teamEvacSetup) {
        _teamEvacSetup = true;
        _startHintTimer(ui, t("fire.team_evac_hint", "Hint: Check the exit routes and confirm evacuation."));
        const card = document.getElementById("fire-hud-card");
        if (card) card.remove();
        _setupStep3(container);
      }
    } else if (role === "extinguisher_operator") {
      if (!_teamExtSetup) {
        _teamExtSetup = true;
        _startHintTimer(ui, t("fire.team_ext_hint", "Hint: Approach the fire and use the extinguisher (Pull, Aim, Squeeze, Sweep)."));
        const card = document.getElementById("fire-hud-card");
        if (card) card.remove();
        _setupStep2(container, tierInfo);
      }
    } else if (role === "backup_coordinator") {
      if (!_teamEvacSetup) {
        _teamEvacSetup = true;
        _startHintTimer(ui, t("fire.team_evac_hint", "Hint: Check the exit routes and confirm evacuation."));
        const card = document.getElementById("fire-hud-card");
        if (card) card.remove();
        _setupStep3(container);
      }
    }
    return;
  }

  if (phase === "complete") {
    instr.textContent = t("fire.team_complete", "Team drill complete! Reviewing debrief...");
    _clearHintTimer();
    return;
  }

  // guided phase: step-by-step guidance and hint timer
  if (!_teamState.alarm_pulled) {
    if (role === "alarm") {
      instr.textContent = t("fire.team_alarm_instr", "Your task: Locate and pull the fire alarm.");
      if (!_teamAlarmSetup) {
        _teamAlarmSetup = true;
        _startHintTimer(ui, t("fire.team_alarm_hint", "Hint: Tap the red fire alarm pull station."));
        _showAlarmPullStation(container, tierInfo, () => {
          _clearHintTimer();
        });
      }
    } else {
      instr.textContent = t("fire.team_wait_alarm", "Waiting for Alarm Operator to pull the alarm...");
      _clearHintTimer();
    }
  } else if (!_teamState.fire_extinguished) {
    if (role === "extinguisher_operator") {
      instr.textContent = t("fire.team_ext_instr", "Alarm pulled! Extinguish the fire using PASS.");
      if (!_teamExtSetup) {
        _teamExtSetup = true;
        _startHintTimer(ui, t("fire.team_ext_hint", "Hint: Approach the fire and use the extinguisher (Pull, Aim, Squeeze, Sweep)."));
        const oldCard = document.getElementById("fire-hud-card");
        if (oldCard) oldCard.remove();
        _setupStep2(container, tierInfo);
      }
    } else {
      instr.textContent = t("fire.team_wait_ext", "Waiting for Extinguisher Operator to suppress the fire...");
      _clearHintTimer();
    }
  } else if (!_teamState.evac_checked) {
    if (role === "extinguisher_operator") {
      const hud = document.getElementById("fire-hud-card");
      if (hud) hud.remove();
    }
    const isEvacRole = role === "backup_coordinator" || (_teamRoleDoubling === "backup_coordinator") || (_teamRoleDoubling && _teamRoleDoubling.backup_coordinator === role);
    if (isEvacRole) {
      instr.textContent = t("fire.team_backup_instr", "Fire suppressed! Coordinate evacuation.");
      if (!_teamEvacSetup) {
        _teamEvacSetup = true;
        _startHintTimer(ui, t("fire.team_evac_hint", "Hint: Check the exit routes and confirm evacuation."));
        const oldCard = document.getElementById("fire-hud-card");
        if (oldCard) oldCard.remove();
        _setupStep3(container);
      }
    } else {
      instr.textContent = t("fire.team_wait_evac", "Waiting for Backup Coordinator to clear the area...");
      _clearHintTimer();
    }
  } else {
    const isEvacRole = role === "backup_coordinator" || (_teamRoleDoubling === "backup_coordinator") || (_teamRoleDoubling && _teamRoleDoubling.backup_coordinator === role);
    if (isEvacRole) {
      const hud = document.getElementById("fire-hud-card");
      if (hud) hud.remove();
    }
    instr.textContent = t("fire.team_done", "Scenario Complete! All roles fulfilled.");
    _clearHintTimer();
  }
}

const calcAimAccuracy = _calcAimAccuracy;

export {
  startFireModule,
  startTeamScenario,
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
  CP_ALARM_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID,
  CP_EVACUATION_WEBXR_ID,
  EXIT_ANCHOR_ID,
  calcMarkerDistance,
  isSafeStandoffDistance,
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  renderGasGaugeSvg,
  renderAlertFlash,
  renderDecisionWheel,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_EXPLOSIVE_THRESHOLD,
  getMethaneReading,
  setMethaneReading,
  getActiveBranch,
  getAlarmPulled,
  getDecisionMade
};
