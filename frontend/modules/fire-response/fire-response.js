import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";

const logger = createLogger("FireModule");

// checkpoint ids — stable identifiers for assessment engine to key on
const CP_EXIT_ID = "fire_exit_identification";
const CP_EXTINGUISHER_ID = "fire_extinguisher_aim";
const CP_EVACUATION_ID = "fire_evacuation_sequence";

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



// render a fire icon placeholder into the ar scene container (marker tier only)
function _renderFireGraphic(container) {
  const graphic = document.createElement("div");
  graphic.id = "fire-graphic";
  graphic.style.cssText = [
    "position:absolute", "top:30%", "left:50%",
    "transform:translateX(-50%)",
    "font-size:5rem", "text-align:center",
    "pointer-events:none", "filter:drop-shadow(0 0 12px #ff6a00)"
  ].join(";");
  graphic.innerHTML = "🔥";
  if (container && container.appendChild) {
    container.appendChild(graphic);
  }
  return graphic;
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
function _setupStep1(container) {
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
    _setupStep2(container);
  });
  if (overlay) overlay.appendChild(btn);
}

// step 2: aim — user taps "Aim at base" button after pointing device at fire graphic
function _setupStep2(container) {
  _currentStep = 2;
  logger.info({ event: "fire_step_start", step: 2 }, "Extinguisher aim");

  registerCheckpoint({
    id: CP_EXTINGUISHER_ID,
    type: "aim",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Extinguisher CP triggered");
    }
  });

  _renderFireGraphic(container);

  const overlay = document.getElementById("fire-module-overlay");
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:1.1rem;font-weight:bold;color:#ff6a00">🔥 STEP 2 / 3 — EXTINGUISHER USE</div>
      <div style="margin:0.5rem 0">Aim at the BASE of the fire. Hold steady, then confirm.</div>
    `;
  }

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:0.8rem;margin-top:0.8rem;";

  const btnCorrect = document.createElement("button");
  btnCorrect.id = "btn-aim-correct";
  btnCorrect.style.cssText = "flex:1;padding:0.8rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;";
  btnCorrect.textContent = "🎯 Aimed at base";
  btnCorrect.addEventListener("click", () => {
    // accuracy: 1.0 = perfect, simulated here; real tier would use hit-test distance
    fireCheckpointResult(CP_EXTINGUISHER_ID, true, { accuracy: 1.0, target: "base" });
    _setupStep3(container);
  });

  const btnWrong = document.createElement("button");
  btnWrong.id = "btn-aim-wrong";
  btnWrong.style.cssText = "flex:1;padding:0.8rem;background:#333;color:#aaa;border:none;border-radius:8px;font-size:1rem;cursor:pointer;";
  btnWrong.textContent = "❌ Aimed at flames (wrong)";
  btnWrong.addEventListener("click", () => {
    // deliberate failure path — accuracy 0, wrong target — assessment engine sees passed:false
    fireCheckpointResult(CP_EXTINGUISHER_ID, false, { accuracy: 0.0, target: "flames" });
    _setupStep3(container);  // still advance so user sees all steps
  });

  btnRow.appendChild(btnCorrect);
  btnRow.appendChild(btnWrong);
  if (overlay) overlay.appendChild(btnRow);
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

// entry point called by loadMarkerModuleScene and loadModule3DScene
function startFireModule(container) {
  _currentStep = 0;
  logger.info({ event: "fire_module_start" }, "Fire module starting");

  // remove stale overlay/graphics if reloading
  ["fire-module-overlay", "fire-graphic", "exit-graphic", "evacuation-options"].forEach((id) => {
    document.getElementById(id)?.remove();
  });

  // create base overlay panel (will be updated per step)
  _createOverlay(container, "<div>Loading Fire &amp; Explosion Response...</div>");

  // step 1 starts immediately
  _setupStep1(container);
}

export {
  startFireModule,
  getCurrentStep,
  CP_EXIT_ID,
  CP_EXTINGUISHER_ID,
  CP_EVACUATION_ID
};
