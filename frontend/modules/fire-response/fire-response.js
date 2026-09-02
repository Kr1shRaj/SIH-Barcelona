import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { unloadModule } from "../../js/module-loader.js";
import { buildFireGraphic, buildExitGraphic, buildExtinguisherGraphic } from "./graphics.js";

const logger = createLogger("FireModule");

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

// render 3D fire entity inside a-marker or fallback container
function _renderFireGraphic(container) {
  const marker = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-marker")
    : null;
  if (marker && typeof marker.querySelector === "function") {
    const testBox = marker.querySelector("#test-box");
    if (testBox) {
      if (testBox.style) testBox.style.display = "none";
      if (typeof testBox.remove === "function") testBox.remove();
    }
  }

  const graphic = buildFireGraphic();
  const parent = marker || container;
  if (parent && parent.appendChild) {
    parent.appendChild(graphic);
  }
  return graphic;
}

// render 3D exit sign entity inside a-marker or fallback container
function _renderExitGraphic(container) {
  const marker = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-marker")
    : null;
  const el = buildExitGraphic();
  const parent = marker || container;
  if (parent && parent.appendChild) {
    parent.appendChild(el);
  }
  return el;
}

// render 3D fire extinguisher entity inside a-marker or fallback container
function _renderExtinguisherGraphic(container) {
  const marker = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-marker")
    : null;
  const el = buildExtinguisherGraphic();
  const parent = marker || container;
  if (parent && parent.appendChild) {
    parent.appendChild(el);
  }
  return el;
}

// build evacuation option buttons for step 3
function _renderEvacuationOptions(container, onSelect) {
  const CORRECT = "sound_alarm_then_evacuate";
  const options = [
    { id: "gather_belongings",       label: "Gather belongings first" },
    { id: "sound_alarm_then_evacuate", label: "Sound alarm → evacuate" },
    { id: "use_elevator",            label: "Use elevator to escape" },
    { id: "wait_for_instructions",   label: "Wait at desk for instructions" }
  ];

  const wrapper = document.createElement("div");
  wrapper.id = "evacuation-options";
  wrapper.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.8rem;";

  options.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.id = `evacuation-opt-${id}`;
    btn.dataset.optionId = id;
    btn.style.cssText = [
      "padding:0.7rem 0.5rem", "border-radius:8px",
      "border:2px solid #ff6a00", "background:#1a0a00",
      "color:#fff", "cursor:pointer", "font-size:0.9rem"
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
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${badge}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${title}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${desc}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", onNext);
  overlay.appendChild(btnNext);
}

// step 1: proximity — user learns exit protocols and taps "I see the exit"
function _setupStep1(container, tierInfo) {
  _currentStep = 1;
  logger.info({ event: "fire_step_start", step: 1 }, "Exit identification");

  registerCheckpoint({
    id: CP_EXIT_ID,
    type: "proximity",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Exit CP triggered");
    }
  });

  _renderExitGraphic(container);

  const overlay = document.getElementById("fire-module-overlay");

  const screens = [
    {
      badge: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (1/4)",
      title: "Why Identifying Exits Matters",
      desc: "In a fire emergency, heavy smoke reduces visibility to zero in under 30 seconds. Panic causes confusion — knowing your exit routes beforehand saves critical seconds.",
      buttonText: "Next: Primary & Backup Exits ➜"
    },
    {
      badge: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (2/4)",
      title: "Primary vs. Backup Route",
      desc: "Never rely on a single exit path. If flames or smoke block your primary route, you must immediately pivot to your pre-identified secondary emergency path.",
      buttonText: "Next: Elevators Danger ➜"
    },
    {
      badge: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (3/4)",
      title: "Never Use Elevators in a Fire",
      desc: "Elevator shafts act as natural chimneys drawing superheated toxic gases. Power failure can strand the car between burning floors. Always use designated fire stairwells.",
      buttonText: "Next: Locate Exit in AR ➜"
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)</div>
        <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">Locate Emergency Exit</div>
        <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Look for the illuminated green emergency sign anchored in AR space. Align your view with the evacuation path.</div>
      `;
      const btn = document.createElement("button");
      btn.id = "btn-exit-found";
      btn.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
      btn.textContent = "✔ I see the exit";
      btn.addEventListener("click", () => {
        fireCheckpointResult(CP_EXIT_ID, true, { method: "button_confirm" });
        _setupStep2(container, tierInfo);
      });
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

// verify if sweep coverage across fire base meets threshold
function isSweepComplete(coverageFraction, threshold = SWEEP_MIN_COVERAGE) {
  return typeof coverageFraction === "number" && !isNaN(coverageFraction) && coverageFraction >= threshold;
}

// step 2: aim — user performs sequential PASS physical gesture interactions
function _setupStep2(container, tierInfo) {
  _currentStep = 2;
  logger.info({ event: "fire_step_start", step: 2, tier: tierInfo && tierInfo.tier }, "Extinguisher aim");

  registerCheckpoint({
    id: CP_EXTINGUISHER_ID,
    type: "aim",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Extinguisher CP triggered");
    }
  });

  // clean up step 1 exit graphic so only step 2 entities are visible
  const oldExit = document.getElementById("exit-graphic");
  if (oldExit && typeof oldExit.remove === "function") {
    oldExit.remove();
  }

  const graphic = _renderFireGraphic(container);
  _renderExtinguisherGraphic(container);
  const overlay = document.getElementById("fire-module-overlay");

  let _recordedAccuracy = null;
  let _recordedDistance = null;

  // pass sub-step 1: P — Pull pin drag gesture targeting 3D extinguisher
  function _renderPullPin() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 2 / 3 — PASS TECHNIQUE (1/4)</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">P — Pull the Pin</div>
      <div style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Drag the safety pin on the 3D extinguisher to the right to unlock.</div>
    `;

    // target 3d pin sub-entity, hit proxy, and 3d progress bar
    const pin = document.getElementById("extinguisher-pin");
    const pinHitbox = document.getElementById("pin-hitbox");
    const progressFill = document.getElementById("pin-progress-fill");

    const BASE_PIN_X = 0.03;
    const BASE_PIN_Y = 0.57;
    const BASE_PIN_Z = 0.05;

    let startX = null;
    let currentDrag = 0;
    let completed = false;

    function handleFinish(sync = false) {
      if (completed) return;
      completed = true;
      if (pin && typeof pin.setAttribute === "function") {
        pin.setAttribute("position", `${BASE_PIN_X + 0.14} ${BASE_PIN_Y} ${BASE_PIN_Z}`);
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
      if (progressFill && typeof progressFill.setAttribute === "function") {
        progressFill.setAttribute("scale", "1 1 1");
      }
      if (sync) {
        _renderAim();
      } else {
        setTimeout(_renderAim, 350);
      }
    }

    if (pin) {
      pin.simulatePull = (dist = 60) => {
        if (isPinPullComplete(dist, PIN_PULL_THRESHOLD_PX)) handleFinish(true);
      };
      pin.addEventListener("click", () => handleFinish(true));

      const onPointerStart = (clientX) => {
        if (completed) return;
        startX = clientX;
        currentDrag = 0;
      };

      const onPointerMove = (clientX) => {
        if (startX === null || completed) return;
        currentDrag = Math.max(0, clientX - startX);
        const fraction = Math.min(1, currentDrag / PIN_PULL_THRESHOLD_PX);
        if (pin && typeof pin.setAttribute === "function") {
          pin.setAttribute("position", `${BASE_PIN_X + fraction * 0.14} ${BASE_PIN_Y} ${BASE_PIN_Z}`);
        }
        if (progressFill && typeof progressFill.setAttribute === "function") {
          progressFill.setAttribute("scale", `${Math.max(0.01, fraction)} 1 1`);
        }
        if (isPinPullComplete(currentDrag, PIN_PULL_THRESHOLD_PX)) {
          handleFinish(false);
        }
      };

      const onPointerEnd = () => {
        startX = null;
        if (!completed) {
          if (pin && typeof pin.setAttribute === "function") {
            pin.setAttribute("position", `${BASE_PIN_X} ${BASE_PIN_Y} ${BASE_PIN_Z}`);
          }
          if (progressFill && typeof progressFill.setAttribute === "function") {
            progressFill.setAttribute("scale", "0.01 1 1");
          }
        }
      };

      const interactiveTargets = [pin, pinHitbox].filter(Boolean);
      interactiveTargets.forEach((target) => {
        target.addEventListener("pointerdown", (e) => {
          onPointerStart(e.clientX);
          target.setPointerCapture?.(e.pointerId);
        });
        target.addEventListener("pointermove", (e) => onPointerMove(e.clientX));
        target.addEventListener("pointerup", (e) => {
          onPointerEnd();
          target.releasePointerCapture?.(e.pointerId);
        });

        target.addEventListener("touchstart", (e) => {
          if (e.touches && e.touches[0]) onPointerStart(e.touches[0].clientX);
        }, { passive: true });
        target.addEventListener("touchmove", (e) => {
          if (e.touches && e.touches[0]) onPointerMove(e.touches[0].clientX);
        }, { passive: true });
        target.addEventListener("touchend", onPointerEnd);
      });

      // also wire drag on overlay for flexible mobile touch
      overlay.addEventListener("pointerdown", (e) => {
        if (startX === null) onPointerStart(e.clientX);
      });
      overlay.addEventListener("pointermove", (e) => {
        if (startX !== null) onPointerMove(e.clientX);
      });
      overlay.addEventListener("pointerup", onPointerEnd);
      overlay.addEventListener("touchstart", (e) => {
        if (startX === null && e.touches && e.touches[0]) onPointerStart(e.touches[0].clientX);
      }, { passive: true });
      overlay.addEventListener("touchmove", (e) => {
        if (startX !== null && e.touches && e.touches[0]) onPointerMove(e.touches[0].clientX);
      }, { passive: true });
      overlay.addEventListener("touchend", onPointerEnd);
    }
  }

  // pass sub-step 2: A — Aim sustained hold on fire base
  function _renderAim() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 2 / 3 — PASS TECHNIQUE (2/4)</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">A — Aim at the Base</div>
      <div style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Drag crosshair onto the base of the 3D fire and hold steady for 1 second.</div>
    `;

    const reticleBox = document.createElement("div");
    reticleBox.id = "aim-reticle-box";
    reticleBox.style.cssText = "width:100%;max-width:280px;background:rgba(30,41,59,0.85);border:2px solid #ff6a00;border-radius:12px;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;margin:0.5rem 0;";

    const reticle = document.createElement("div");
    reticle.id = "aim-reticle";
    reticle.style.cssText = "padding:8px 18px;background:rgba(239,68,68,0.9);color:#fff;border-radius:8px;font-weight:bold;font-size:0.95rem;display:flex;align-items:center;gap:6px;cursor:crosshair;touch-action:none;user-select:none;box-shadow:0 2px 6px rgba(0,0,0,0.5);";

    const label = document.createElement("span");
    label.id = "aim-label";
    label.textContent = "Hold on Fire Base";
    reticle.innerHTML = "<span>🎯</span> ";
    reticle.appendChild(label);

    const barWrapper = document.createElement("div");
    barWrapper.style.cssText = "width:100%;height:6px;background:#475569;border-radius:3px;margin-top:10px;overflow:hidden;";

    const progressBar = document.createElement("div");
    progressBar.id = "aim-progress-bar";
    progressBar.style.cssText = "width:0%;height:100%;background:#00e676;transition:width 0.08s linear;";

    barWrapper.appendChild(progressBar);
    reticleBox.appendChild(reticle);
    reticleBox.appendChild(barWrapper);
    overlay.appendChild(reticleBox);

    let holdStart = null;
    let holdTimer = null;
    let completed = false;

    function handleAimSuccess(accuracy = 0.9, distance = 0.1, sync = false) {
      if (completed) return;
      completed = true;
      _recordedAccuracy = accuracy;
      _recordedDistance = distance;
      progressBar.style.width = "100%";
      reticle.style.background = "#10b981";
      label.textContent = "AIM LOCKED!";
      if (sync) {
        _renderSqueeze();
      } else {
        setTimeout(_renderSqueeze, 350);
      }
    }

    reticle.simulateAim = (score = 0.9, dist = 0.1) => {
      handleAimSuccess(score, dist, true);
    };
    reticle.addEventListener("click", () => handleAimSuccess(0.9, 0.08, true));

    const startHold = (accuracy = 0.85, distance = 0.12) => {
      if (completed) return;
      holdStart = Date.now();
      clearInterval(holdTimer);
      holdTimer = setInterval(() => {
        const elapsed = Date.now() - holdStart;
        const pct = Math.min(100, Math.round((elapsed / AIM_HOLD_DURATION_MS) * 100));
        progressBar.style.width = `${pct}%`;
        if (isAimHoldComplete(elapsed, AIM_HOLD_DURATION_MS)) {
          clearInterval(holdTimer);
          handleAimSuccess(accuracy, distance, false);
        }
      }, 50);
    };

    const stopHold = () => {
      if (completed) return;
      clearInterval(holdTimer);
      holdStart = null;
      progressBar.style.width = "0%";
    };

    reticle.addEventListener("pointerdown", () => startHold(0.9, 0.08));
    reticle.addEventListener("pointerup", stopHold);
    reticle.addEventListener("pointercancel", stopHold);
    reticle.addEventListener("touchstart", () => startHold(0.9, 0.08), { passive: true });
    reticle.addEventListener("touchend", stopHold);

    if (graphic && typeof graphic.addEventListener === "function") {
      graphic.addEventListener("pointerdown", (ev) => {
        const intersection = ev && ev.detail && ev.detail.intersection ? ev.detail.intersection : null;
        const distance = intersection ? calcIntersectionDistance(intersection.point) : 0.15;
        const accuracy = calcRaycastAimAccuracy(distance);
        startHold(accuracy, distance);
      });
      graphic.addEventListener("pointerup", stopHold);
    }
  }

  // pass sub-step 3: S — Squeeze lever for 1.5s
  function _renderSqueeze() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 2 / 3 — PASS TECHNIQUE (3/4)</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">S — Squeeze the Handle</div>
      <div style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Press and hold the lever for 1.5 seconds to discharge agent.</div>
    `;

    const handle = document.createElement("button");
    handle.id = "extinguisher-handle";
    handle.style.cssText = "width:100%;max-width:280px;padding:12px 16px;background:#ff6a00;color:#fff;border:none;border-radius:10px;font-size:0.95rem;font-weight:bold;cursor:pointer;touch-action:none;user-select:none;box-shadow:0 3px 8px rgba(0,0,0,0.5);display:flex;flex-direction:column;align-items:center;gap:6px;margin:0.5rem 0;";

    const label = document.createElement("span");
    label.id = "handle-label";
    label.textContent = "🗜 PRESS & HOLD LEVER";

    const barWrapper = document.createElement("div");
    barWrapper.style.cssText = "width:100%;height:6px;background:rgba(0,0,0,0.3);border-radius:3px;overflow:hidden;";

    const progressBar = document.createElement("div");
    progressBar.id = "squeeze-progress-bar";
    progressBar.style.cssText = "width:0%;height:100%;background:#00e676;transition:width 0.08s linear;";

    barWrapper.appendChild(progressBar);
    handle.appendChild(label);
    handle.appendChild(barWrapper);
    overlay.appendChild(handle);

    let startTime = null;
    let timer = null;
    let completed = false;

    function handleSqueezeSuccess(sync = false) {
      if (completed) return;
      completed = true;
      clearInterval(timer);
      progressBar.style.width = "100%";
      handle.style.background = "#10b981";
      label.textContent = "✔ DISCHARGING AGENT!";
      if (sync) {
        _renderSweep();
      } else {
        setTimeout(_renderSweep, 350);
      }
    }

    handle.simulateSqueeze = (durationMs = 1500) => {
      if (isSqueezeComplete(durationMs, SQUEEZE_HOLD_DURATION_MS)) handleSqueezeSuccess(true);
    };
    handle.addEventListener("click", () => handleSqueezeSuccess(true));

    const startSqueeze = () => {
      if (completed) return;
      startTime = Date.now();
      clearInterval(timer);
      timer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, Math.round((elapsed / SQUEEZE_HOLD_DURATION_MS) * 100));
        progressBar.style.width = `${pct}%`;
        if (isSqueezeComplete(elapsed, SQUEEZE_HOLD_DURATION_MS)) {
          handleSqueezeSuccess(false);
        }
      }, 50);
    };

    const stopSqueeze = () => {
      if (completed) return;
      clearInterval(timer);
      startTime = null;
      progressBar.style.width = "0%";
    };

    handle.addEventListener("pointerdown", startSqueeze);
    handle.addEventListener("pointerup", stopSqueeze);
    handle.addEventListener("pointercancel", stopSqueeze);
    handle.addEventListener("touchstart", startSqueeze, { passive: true });
    handle.addEventListener("touchend", stopSqueeze);
  }

  // pass sub-step 4: S — Sweep across base of fire
  function _renderSweep() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 2 / 3 — PASS TECHNIQUE (4/4)</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">S — Sweep Side to Side</div>
      <div style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Swipe left and right across the fire base to cover the full width.</div>
    `;

    const sweepZone = document.createElement("div");
    sweepZone.id = "sweep-zone";
    sweepZone.style.cssText = "position:relative;width:100%;max-width:280px;height:54px;background:rgba(30,41,59,0.9);border:2px solid #00e676;border-radius:27px;display:flex;align-items:center;padding:4px;box-sizing:border-box;margin:0.5rem 0;touch-action:none;user-select:none;";

    const progressFill = document.createElement("div");
    progressFill.id = "sweep-progress-fill";
    progressFill.style.cssText = "position:absolute;left:0;top:0;height:100%;width:0%;background:rgba(0,230,118,0.3);border-radius:25px;pointer-events:none;transition:width 0.05s ease;";

    const nozzle = document.createElement("div");
    nozzle.id = "sweep-nozzle";
    nozzle.style.cssText = "position:absolute;left:4px;height:44px;padding:0 14px;background:#00e676;color:#000;border-radius:22px;display:flex;align-items:center;gap:6px;font-weight:bold;font-size:0.85rem;cursor:ew-resize;box-shadow:0 2px 6px rgba(0,0,0,0.5);";
    nozzle.innerHTML = "<span>↔</span> <span>Sweep</span>";

    const statusText = document.createElement("div");
    statusText.id = "sweep-status-text";
    statusText.style.cssText = "width:100%;text-align:right;padding-right:16px;color:#00e676;font-size:0.8rem;font-weight:bold;";
    statusText.textContent = "0% COVERED";

    sweepZone.appendChild(progressFill);
    sweepZone.appendChild(nozzle);
    sweepZone.appendChild(statusText);
    overlay.appendChild(sweepZone);

    const positionsX = [];
    let completed = false;

    function handleSweepFinish(sync = false) {
      if (completed) return;
      completed = true;
      statusText.textContent = "✔ EXTINGUISHED!";
      progressFill.style.width = "100%";

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
        accuracy: finalAccuracy,
        target: passed ? "base" : "missed",
        distance: finalDistance
      });

      if (sync) {
        _setupStep3(container);
      } else {
        setTimeout(() => _setupStep3(container), 450);
      }
    }

    sweepZone.simulateSweep = (positions = [0, 80, 160, 220]) => {
      const coverage = calcSweepCoverage(positions, 220);
      if (isSweepComplete(coverage, SWEEP_MIN_COVERAGE)) {
        handleSweepFinish(true);
      }
    };
    sweepZone.addEventListener("click", () => handleSweepFinish(true));

    const handleMove = (clientX) => {
      if (completed) return;
      const rect = sweepZone.getBoundingClientRect?.() || { left: 0, width: 280 };
      const relX = clientX - rect.left;
      positionsX.push(relX);
      nozzle.style.transform = `translateX(${Math.max(0, Math.min(relX - 20, 180))}px)`;
      const coverage = calcSweepCoverage(positionsX, 200);
      progressFill.style.width = `${Math.min(100, Math.round(coverage * 100))}%`;
      statusText.textContent = `${Math.min(100, Math.round(coverage * 100))}% COVERED`;
      if (isSweepComplete(coverage, SWEEP_MIN_COVERAGE)) {
        handleSweepFinish(false);
      }
    };

    sweepZone.addEventListener("pointermove", (e) => handleMove(e.clientX));
    sweepZone.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX);
    }, { passive: true });
  }

  // start with PASS step 1 (Pull)
  _renderPullPin();
}

// step 3: select — user learns evacuation sequencing before choosing protocol
function _setupStep3(_container) {
  _currentStep = 3;
  logger.info({ event: "fire_step_start", step: 3 }, "Evacuation sequence");

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

  const screens = [
    {
      badge: "🔥 STEP 3 / 3 — EVACUATION (1/3)",
      title: "Why Evacuation Order Matters",
      desc: "Sounding the building alarm immediately alerts everyone before heat spreads. Never delay evacuation to gather personal belongings or tools.",
      buttonText: "Next: Assembly Area Purpose ➜"
    },
    {
      badge: "🔥 STEP 3 / 3 — EVACUATION (2/3)",
      title: "Assembly & Headcount",
      desc: "Proceed directly to your designated external assembly area. Immediate headcount verification ensures rescuers know if anyone is trapped inside.",
      buttonText: "Next: Evacuation Protocol Choice ➜"
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 3 / 3 — EVACUATION (3/3)</div>
        <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">Evacuation Protocol Choice</div>
        <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">What is the correct immediate action after attempting extinguisher use?</div>
      `;

      _renderEvacuationOptions(overlay, (selectedId, passed) => {
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
  [
    "fire-module-overlay",
    "fire-graphic",
    "extinguisher-graphic",
    "extinguisher-pin",
    "extinguisher-pin-progress",
    "exit-graphic",
    "evacuation-options",
    "aim-accuracy-display"
  ].forEach((id) => {
    if (typeof document !== "undefined") {
      document.getElementById(id)?.remove();
    }
  });

  if (typeof document !== "undefined" && typeof document.querySelector === "function") {
    const marker = document.querySelector("a-marker");
    if (marker && typeof marker.querySelector === "function") {
      const oldFire = marker.querySelector("#fire-graphic");
      if (oldFire && typeof oldFire.remove === "function") oldFire.remove();
      const oldExit = marker.querySelector("#exit-graphic");
      if (oldExit && typeof oldExit.remove === "function") oldExit.remove();
      const oldExt = marker.querySelector("#extinguisher-graphic");
      if (oldExt && typeof oldExt.remove === "function") oldExt.remove();
    }
  }
}

// show completion panel after all three steps done
function _showComplete(lastPassed) {
  _currentStep = 0;
  const overlay = document.getElementById("fire-module-overlay");
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:1.2rem;font-weight:bold;color:${lastPassed ? "#00e676" : "#ff6a00"}">
        ${lastPassed ? "✅ MODULE COMPLETE" : "⚠ MODULE COMPLETE — Review step 3"}
      </div>
      <div style="margin:0.5rem 0;font-size:0.95rem">All checkpoints fired. Assessment engine will score your attempt.</div>
    `;

    const btnExit = document.createElement("button");
    btnExit.id = "btn-module-exit";
    btnExit.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.5rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;";
    btnExit.textContent = "✖ Exit Module";
    btnExit.addEventListener("click", () => {
      cleanupFireModule();
      unloadModule();
    });
    overlay.appendChild(btnExit);
  }
  logger.info({ event: "fire_module_complete" }, "Fire module all steps done");
}

// entry point — tierInfo: { tier: 1|2, xrSession?, trackingState? } from webxr/marker loaders
function startFireModule(container, tierInfo) {
  _currentStep = 0;
  logger.info({ event: "fire_module_start", tier: tierInfo && tierInfo.tier }, "Fire module starting");

  // remove stale overlay/graphics if reloading
  cleanupFireModule();

  // create base overlay panel (will be updated per step)
  _createOverlay(container, "<div>Loading Fire &amp; Explosion Response...</div>");

  // step 1 starts immediately; pass tierInfo through so step 2 knows which tier is active
  _setupStep1(container, tierInfo);
}

// public aliases for tests and external callers
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
  isSweepComplete,
  PIN_PULL_THRESHOLD_PX,
  AIM_HOLD_DURATION_MS,
  SQUEEZE_HOLD_DURATION_MS,
  SWEEP_MIN_COVERAGE,
  FIRE_BASE_MAX_DISTANCE_3D,
  FIRE_BASE_TARGET_3D,
  AIM_PASS_THRESHOLD,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID
};

