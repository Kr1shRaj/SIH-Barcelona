import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { unloadModule } from "../../js/module-loader.js";
import { buildFireGraphic, buildExitGraphic } from "./graphics.js";

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

// step 2: aim — user learns PASS technique sub-screens then taps 3D fire base
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

  const graphic = _renderFireGraphic(container);
  const overlay = document.getElementById("fire-module-overlay");

  const screens = [
    {
      badge: "🔥 STEP 2 / 3 — EXTINGUISHER USE (1/5)",
      title: "PASS: P — Pull the Pin",
      desc: "Firmly pull the safety pin at the top of the extinguisher. This breaks the plastic tamper seal and unlocks the operating lever.",
      buttonText: "Next: A — Aim ➜"
    },
    {
      badge: "🔥 STEP 2 / 3 — EXTINGUISHER USE (2/5)",
      title: "PASS: A — Aim at the Base",
      desc: "Do NOT aim at high flames — burning smoke rises. Aim directly at the fuel source at the very base of the fire to extinguish the combustion.",
      buttonText: "Next: S — Squeeze ➜"
    },
    {
      badge: "🔥 STEP 2 / 3 — EXTINGUISHER USE (3/5)",
      title: "PASS: S — Squeeze the Handle",
      desc: "Stand 6 to 8 feet away from the fire. Squeeze the discharge lever evenly and smoothly to release the extinguishing agent under pressure.",
      buttonText: "Next: S — Sweep ➜"
    },
    {
      badge: "🔥 STEP 2 / 3 — EXTINGUISHER USE (4/5)",
      title: "PASS: S — Sweep Side to Side",
      desc: "Sweep the nozzle slowly across the entire width of the fire base in a steady motion until all embers are fully extinguished and cooled.",
      buttonText: "Next: Practice Aiming in AR ➜"
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">🔥 STEP 2 / 3 — EXTINGUISHER USE (5/5)</div>
        <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">Aim at 3D Fire Base</div>
        <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Aim at the <strong>base</strong> of the 3D fire. Tap the fire entity in AR space to aim, then confirm.</div>
      `;

      const btnConfirm = document.createElement("button");
      btnConfirm.id = "btn-aim-confirm";
      btnConfirm.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:none;width:100%;max-width:320px;";
      btnConfirm.textContent = "✔ Confirm aim";
      overlay.appendChild(btnConfirm);

      // stores recorded aim point/distance
      let _recordedAim = null;

      const handleAimEvent = (ev) => {
        const intersection = ev && ev.detail && ev.detail.intersection ? ev.detail.intersection : null;
        if (intersection && intersection.point) {
          const distance = calcIntersectionDistance(intersection.point);
          const accuracy = calcRaycastAimAccuracy(distance);
          _recordedAim = { distance, accuracy, method: "raycast" };
          logger.info({ event: "aim_raycast_hit", distance, accuracy }, "Raycast intersected fire entity");
        } else if (ev && typeof ev._testDistance === "number") {
          const distance = ev._testDistance;
          const accuracy = calcRaycastAimAccuracy(distance);
          _recordedAim = { distance, accuracy, method: "test_distance" };
        } else if (ev && typeof ev._testAccuracy === "number") {
          _recordedAim = { distance: null, accuracy: ev._testAccuracy, method: "test_accuracy" };
        } else if (ev && ev.clientX !== undefined && ev.clientY !== undefined) {
          _recordedAim = { x: ev.clientX, y: ev.clientY, method: "2d_tap" };
        }
        btnConfirm.style.display = "block";
      };

      if (graphic && typeof graphic.addEventListener === "function") {
        graphic.addEventListener("click", handleAimEvent);
        graphic.addEventListener("pointerdown", handleAimEvent);
      }

      const tapTarget = container || (typeof document !== "undefined" ? document.getElementById("ar-viewport") : null);
      if (tapTarget && tapTarget !== graphic && typeof tapTarget.addEventListener === "function") {
        tapTarget.addEventListener("click", (ev) => {
          if (!_recordedAim) handleAimEvent(ev);
        });
        tapTarget.addEventListener("pointerdown", (ev) => {
          if (!_recordedAim) handleAimEvent(ev);
        });
      }

      btnConfirm.addEventListener("click", () => {
        let accuracy = null;
        let distance = null;

        if (btnConfirm._testAccuracy !== undefined) {
          accuracy = typeof btnConfirm._testAccuracy === "number" ? btnConfirm._testAccuracy : 0;
          distance = typeof btnConfirm._testDistance === "number" ? btnConfirm._testDistance : null;
        } else if (btnConfirm._testDistance !== undefined) {
          distance = btnConfirm._testDistance;
          accuracy = calcRaycastAimAccuracy(distance);
        } else if (_recordedAim) {
          if (typeof _recordedAim.accuracy === "number") {
            accuracy = _recordedAim.accuracy;
            distance = _recordedAim.distance;
          } else if (_recordedAim.x !== undefined) {
            accuracy = _calcAimAccuracy(_recordedAim.x, _recordedAim.y, graphic);
          }
        }

        if (accuracy === null) accuracy = 0;

        const passed = accuracy >= AIM_PASS_THRESHOLD;
        const finalAccuracy = Math.round(accuracy * 100) / 100;
        const finalDistance = distance !== null && typeof distance === "number" ? Math.round(distance * 100) / 100 : null;

        logger.info({
          event: "aim_scored",
          accuracy: finalAccuracy,
          distance: finalDistance,
          passed,
          tier: tierInfo && tierInfo.tier
        }, "Aim checkpoint scored");

        fireCheckpointResult(CP_EXTINGUISHER_ID, passed, {
          accuracy: finalAccuracy,
          target: passed ? "base" : "missed",
          distance: finalDistance
        });
        _setupStep3(container);
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

// step 3: select — user learns evacuation sequencing before choosing protocol
function _setupStep3(_container) {
  _currentStep = 3;
  logger.info({ event: "fire_step_start", step: 3 }, "Evacuation sequence");

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
  ["fire-module-overlay", "fire-graphic", "exit-graphic", "evacuation-options", "aim-accuracy-display"].forEach((id) => {
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
  FIRE_BASE_MAX_DISTANCE_3D,
  FIRE_BASE_TARGET_3D,
  AIM_PASS_THRESHOLD,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID
};

