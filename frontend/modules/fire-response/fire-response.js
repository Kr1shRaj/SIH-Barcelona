import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";

const logger = createLogger("FireModule");

// checkpoint ids — stable identifiers for assessment engine to key on
const CP_EXIT_ID = "fire_exit_identification";
const CP_EXTINGUISHER_ID = "fire_extinguisher_aim";
const CP_EVACUATION_ID = "fire_evacuation_sequence";

// aim must score >= 0.6 to pass: within 40% of max-miss radius counts as good aim
const AIM_PASS_THRESHOLD = 0.6;

// max acceptable miss radius in px for aim score — beyond this, score floors at 0
// set to 80px: roughly the diameter of the fire graphic on a budget phone screen
const FIRE_BASE_MAX_RADIUS_PX = 80;

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
    "background:rgba(20,10,0,0.88)", "color:#fff",
    "font-family:sans-serif", "padding:1.2rem",
    "border-top:3px solid #ff6a00", "z-index:100"
  ].join(";");
  panel.innerHTML = html;
  if (container && container.appendChild) {
    container.appendChild(panel);
  }
  return panel;
}



// render fire graphic; pointer-events on so user can tap it for aim accuracy
function _renderFireGraphic(container) {
  const graphic = document.createElement("div");
  graphic.id = "fire-graphic";
  graphic.style.cssText = [
    "position:absolute", "top:30%", "left:50%",
    "transform:translateX(-50%)",
    "font-size:5rem", "text-align:center",
    "cursor:crosshair", "filter:drop-shadow(0 0 12px #ff6a00)"
  ].join(";");
  graphic.innerHTML = "🔥";
  if (container && container.appendChild) {
    container.appendChild(graphic);
  }
  return graphic;
}

// compute aim accuracy: distance from tap point to base of fire graphic, 0.0–1.0
// base = bottom-center of bounding rect; uses getBoundingClientRect if available
function _calcAimAccuracy(tapX, tapY, graphicEl) {
  if (!graphicEl || typeof graphicEl.getBoundingClientRect !== "function") {
    // no rect available (test env without layout) — caller must supply stub
    return null;
  }
  const rect = graphicEl.getBoundingClientRect();
  // target point: bottom-center of graphic = base of the fire
  const targetX = rect.left + rect.width / 2;
  const targetY = rect.bottom;
  const dist = Math.hypot(tapX - targetX, tapY - targetY);
  // invert and clamp: 0 distance = 1.0 accuracy, max radius = 0.0
  return Math.max(0, 1 - dist / FIRE_BASE_MAX_RADIUS_PX);
}

// render exit arrow graphic pointing toward exit direction
function _renderExitGraphic(container) {
  const el = document.createElement("div");
  el.id = "exit-graphic";
  el.style.cssText = [
    "position:absolute", "top:20%", "right:10%",
    "font-size:4rem", "text-align:center",
    "pointer-events:none", "color:#00e676"
  ].join(";");
  el.innerHTML = "🚪 ➜";
  if (container && container.appendChild) {
    container.appendChild(el);
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

// step 1: proximity — user taps "I see the exit" button to confirm identification
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

  // desc text via innerHTML is fine — it has no interactive children
  const overlay = document.getElementById("fire-module-overlay");
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:1.1rem;font-weight:bold;color:#ff6a00">🔥 STEP 1 / 3 — EXIT IDENTIFICATION</div>
      <div style="margin:0.5rem 0">Locate emergency exit. Face the green arrow.</div>
    `;
  }

  // create button programmatically so getElementById can find it in test and browser alike
  const btn = document.createElement("button");
  btn.id = "btn-exit-found";
  btn.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;";
  btn.textContent = "✔ I see the exit";
  btn.addEventListener("click", () => {
    // passed = true: user correctly identified the exit location
    fireCheckpointResult(CP_EXIT_ID, true, { method: "button_confirm" });
    _setupStep2(container, tierInfo);
  });
  if (overlay) overlay.appendChild(btn);
}

// step 2: aim — user taps the fire graphic; distance from base determines accuracy
// tier 1 note: uses same DOM hit calc as tier 2 — real XR hit-test not wired yet (see report)
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
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:1.1rem;font-weight:bold;color:#ff6a00">🔥 STEP 2 / 3 — EXTINGUISHER USE</div>
      <div style="margin:0.5rem 0">Tap the <strong>base</strong> of the fire to aim your extinguisher.</div>
    `;
  }

  // confirm button — fires after user has tapped to record their aim point
  const btnConfirm = document.createElement("button");
  btnConfirm.id = "btn-aim-confirm";
  btnConfirm.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.5rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:none;";
  btnConfirm.textContent = "✔ Confirm aim";
  if (overlay) overlay.appendChild(btnConfirm);

  // stores last tap position relative to viewport; null until user taps
  let _lastTap = null;

  // tap anywhere in viewport registers aim point; show confirm button
  const tapTarget = container || (typeof document !== "undefined" ? document.getElementById("ar-viewport") : null);

  // listen on the graphic itself for more precise tap targeting
  if (graphic) {
    graphic.addEventListener("pointerdown", (ev) => {
      _lastTap = { x: ev.clientX, y: ev.clientY };
      btnConfirm.style.display = "inline-block";
      logger.info({ event: "aim_tap", x: _lastTap.x, y: _lastTap.y }, "User tapped fire graphic");
    });
  }

  // also listen on the whole container for misses (taps away from graphic)
  if (tapTarget && tapTarget !== graphic) {
    tapTarget.addEventListener("pointerdown", (ev) => {
      // only register if not already set by graphic listener above
      if (!_lastTap) {
        _lastTap = { x: ev.clientX, y: ev.clientY };
        btnConfirm.style.display = "inline-block";
        logger.info({ event: "aim_tap_miss", x: _lastTap.x, y: _lastTap.y }, "User tapped outside graphic");
      }
    });
  }

  btnConfirm.addEventListener("click", () => {
    // use last recorded tap; if none yet (e.g. test env), fall back to zero accuracy
    const tapX = _lastTap ? _lastTap.x : 0;
    const tapY = _lastTap ? _lastTap.y : 0;
    const accuracy = _calcAimAccuracy(tapX, tapY, graphic);

    if (accuracy === null) {
      // _calcAimAccuracy returns null when no getBoundingClientRect — use injected value
      const injected = btnConfirm._testAccuracy;
      const score = typeof injected === "number" ? injected : 0;
      const passed = score >= AIM_PASS_THRESHOLD;
      fireCheckpointResult(CP_EXTINGUISHER_ID, passed, {
        accuracy: score,
        target: passed ? "base" : "missed",
        distance: null
      });
      _setupStep3(container);
      return;
    }

    const passed = accuracy >= AIM_PASS_THRESHOLD;
    const rect = graphic.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.bottom;
    const distance = Math.hypot(tapX - targetX, tapY - targetY);

    logger.info({
      event: "aim_scored",
      accuracy,
      distance,
      passed,
      tier: tierInfo && tierInfo.tier
    }, "Aim checkpoint scored");

    fireCheckpointResult(CP_EXTINGUISHER_ID, passed, {
      accuracy: Math.round(accuracy * 100) / 100,
      target: passed ? "base" : "missed",
      distance: Math.round(distance)
    });
    _setupStep3(container);
  });
}

// step 3: select — user picks correct evacuation sequence from 4 options
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
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:1.1rem;font-weight:bold;color:#ff6a00">🔥 STEP 3 / 3 — EVACUATION</div>
      <div style="margin:0.5rem 0">What is the correct action after using extinguisher?</div>
    `;
  }

  _renderEvacuationOptions(overlay, (selectedId, passed) => {
    // context carries what the user picked so assessment engine can log the wrong answer too
    fireCheckpointResult(CP_EVACUATION_ID, passed, {
      selected: selectedId,
      correct: "sound_alarm_then_evacuate"
    });
    _showComplete(passed);
  });
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
  }
  logger.info({ event: "fire_module_complete" }, "Fire module all steps done");
}

// entry point — tierInfo: { tier: 1|2, xrSession?, trackingState? } from webxr/marker loaders
function startFireModule(container, tierInfo) {
  _currentStep = 0;
  logger.info({ event: "fire_module_start", tier: tierInfo && tierInfo.tier }, "Fire module starting");

  // remove stale overlay/graphics if reloading
  ["fire-module-overlay", "fire-graphic", "exit-graphic", "evacuation-options"].forEach((id) => {
    document.getElementById(id)?.remove();
  });

  // create base overlay panel (will be updated per step)
  _createOverlay(container, "<div>Loading Fire &amp; Explosion Response...</div>");

  // step 1 starts immediately; pass tierInfo through so step 2 knows which tier is active
  _setupStep1(container, tierInfo);
}

// public alias for tests and external callers
const calcAimAccuracy = _calcAimAccuracy;

export {
  startFireModule,
  getCurrentStep,
  calcAimAccuracy,
  AIM_PASS_THRESHOLD,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID
};

