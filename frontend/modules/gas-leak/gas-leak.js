import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { unloadModule } from "../../js/module-loader.js";
import { buildHazardZoneEntity, buildPpeDisplayEntity } from "./graphics.js";
import { t } from "../../js/i18n.js";
import { playNarration, stopNarration } from "../../js/audio.js";
import {
  startAssessmentSession,
  finishAssessmentSession,
  abortAssessmentSession,
  getActiveSession,
  bindAssessmentSessionListeners
} from "../../assessment/engine.js";

const logger = createLogger("GasLeakModule");

// stable checkpoint ids for assessment engine to verify gas leak protocol
const CP_HAZARD_ZONE_ID = "gas_hazard_zone_recognition";
const CP_PPE_SELECTION_ID = "gas_ppe_selection";
const CP_BUDDY_PROCEDURE_ID = "gas_buddy_procedure";

// mandatory ppe required for hazardous atmospheric entry
const MANDATORY_PPE = ["scba_respirator", "multi_gas_detector", "safety_harness"];

// dangerous or ineffective items that must not be chosen for gas zone entry
const FORBIDDEN_PPE = ["dust_mask", "welding_shield"];

// correct buddy system procedure answer
const CORRECT_BUDDY_PROCEDURE = "standby_outside_with_lifeline";

// track active step
let _currentStep = 0;

// get active step index
function getCurrentStep() { return _currentStep; }

// check if worker picked all mandatory ppe without forbidden distractors
function evaluatePpeSelection(selectedList = []) {
  if (!Array.isArray(selectedList)) {
    return { passed: false, missing: MANDATORY_PPE, forbidden: [], score: 0 };
  }

  const missing = MANDATORY_PPE.filter((item) => !selectedList.includes(item));
  const forbidden = FORBIDDEN_PPE.filter((item) => selectedList.includes(item));
  const passed = missing.length === 0 && forbidden.length === 0;

  // score: fraction of required items chosen minus penalty for forbidden items
  const correctCount = MANDATORY_PPE.filter((item) => selectedList.includes(item)).length;
  const rawScore = (correctCount - forbidden.length) / MANDATORY_PPE.length;
  const score = Math.max(0, Math.min(1, Math.round(rawScore * 100) / 100));

  return {
    passed,
    missing,
    forbidden,
    score
  };
}

// check if worker selected correct buddy role
function evaluateBuddyProcedure(selectedOption) {
  return selectedOption === CORRECT_BUDDY_PROCEDURE;
}

// create overlay ui panel
function _createOverlay(container, html) {
  const panel = document.createElement("div");
  panel.id = "gas-module-overlay";
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

// render 3d hazard zone in a-marker or fallback container
function _renderHazardZoneGraphic(container) {
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

  const graphic = buildHazardZoneEntity();
  const parent = marker || container;
  if (parent && parent.appendChild) {
    parent.appendChild(graphic);
  }
  return graphic;
}

// render 3d ppe visual in a-marker or fallback container
function _renderPpeGraphic(container) {
  const marker = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-marker")
    : null;
  const el = buildPpeDisplayEntity();
  const parent = marker || container;
  if (parent && parent.appendChild) {
    parent.appendChild(el);
  }
  return el;
}

// render ppe selection toggle list
function _renderPpeOptions(container, onConfirm) {
  const ppeItems = [
    { id: "scba_respirator", label: t("modules.gas_leak.ppe_scba_respirator", {}, "SCBA / Positive Pressure Respirator") },
    { id: "multi_gas_detector", label: t("modules.gas_leak.ppe_multi_gas_detector", {}, "Multi-Gas Atmospheric Detector") },
    { id: "safety_harness", label: t("modules.gas_leak.ppe_safety_harness", {}, "Full Body Harness & Retrieval Line") },
    { id: "dust_mask", label: t("modules.gas_leak.ppe_dust_mask", {}, "Cloth Dust Mask") },
    { id: "welding_shield", label: t("modules.gas_leak.ppe_welding_shield", {}, "Welding Face Shield") }
  ];

  const wrapper = document.createElement("div");
  wrapper.id = "gas-ppe-options";
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:0.5rem;margin:0.8rem 0;";

  const selectedSet = new Set();

  ppeItems.forEach(({ id, label }) => {
    const row = document.createElement("button");
    row.id = `ppe-opt-${id}`;
    row.dataset.ppeId = id;
    row.style.cssText = [
      "padding:0.6rem 0.8rem", "border-radius:8px",
      "border:1px solid #475569", "background:#1e293b",
      "color:#fff", "cursor:pointer", "font-size:0.9rem",
      "text-align:left", "display:flex", "align-items:center", "gap:0.5rem"
    ].join(";");
    row.textContent = `[ ] ${label}`;

    row.addEventListener("click", () => {
      if (selectedSet.has(id)) {
        selectedSet.delete(id);
        row.style.borderColor = "#475569";
        row.style.background = "#1e293b";
        row.textContent = `[ ] ${label}`;
      } else {
        selectedSet.add(id);
        row.style.borderColor = "#f59e0b";
        row.style.background = "#334155";
        row.textContent = `[✔] ${label}`;
      }
    });

    wrapper.appendChild(row);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.id = "btn-confirm-ppe";
  confirmBtn.style.cssText = "padding:0.75rem;background:#f59e0b;color:#000;border:none;border-radius:8px;font-size:1rem;font-weight:bold;cursor:pointer;margin-top:0.4rem;";
  confirmBtn.textContent = t("modules.gas_leak.btn_ppe_confirm", {}, "✔ Confirm PPE Selection");
  confirmBtn.addEventListener("click", () => {
    onConfirm(Array.from(selectedSet));
  });

  wrapper.appendChild(confirmBtn);

  if (container && container.appendChild) {
    container.appendChild(wrapper);
  }
  return wrapper;
}

// render buddy procedure radio options
function _renderBuddyOptions(container, onSelect) {
  const options = [
    { id: "standby_outside_with_lifeline", label: t("modules.gas_leak.buddy_standby_lifeline", {}, "Standby outside opening with continuous communication & lifeline") },
    { id: "both_enter_together", label: t("modules.gas_leak.buddy_both_enter", {}, "Both workers enter confined space together to work faster") },
    { id: "buddy_leaves_for_tools", label: t("modules.gas_leak.buddy_leaves_tools", {}, "Buddy leaves area to fetch spare tools from workshop") },
    { id: "enter_without_communication", label: t("modules.gas_leak.buddy_enter_alone", {}, "Enter alone first, buddy follows only if alarms sound") }
  ];

  const wrapper = document.createElement("div");
  wrapper.id = "gas-buddy-options";
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:0.6rem;margin-top:0.8rem;";

  options.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.id = `buddy-opt-${id}`;
    btn.dataset.optionId = id;
    btn.style.cssText = [
      "padding:0.7rem 0.8rem", "border-radius:8px",
      "border:1px solid #f59e0b", "background:#1e293b",
      "color:#fff", "cursor:pointer", "font-size:0.85rem",
      "text-align:left"
    ].join(";");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      const passed = evaluateBuddyProcedure(id);
      onSelect(id, passed);
    });
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
    <div style="font-size:0.95rem;font-weight:bold;color:#f59e0b;letter-spacing:0.5px;">${badge}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${title}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${desc}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#f59e0b;color:#000;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", onNext);
  overlay.appendChild(btnNext);
}

// step 1: proximity — user learns atmospheric hazards before acknowledging 3D hazard zone
function _setupStep1(container, tierInfo) {
  _currentStep = 1;
  logger.info({ event: "gas_step_start", step: 1, tier: tierInfo && tierInfo.tier }, "Hazard zone recognition");
  playNarration({ moduleId: "gas-leak", stepKey: "step_1_hazard" });

  registerCheckpoint({
    id: CP_HAZARD_ZONE_ID,
    type: "proximity",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Hazard zone CP triggered");
    }
  });

  _renderHazardZoneGraphic(container);

  const overlay = document.getElementById("gas-module-overlay");
  playNarration({ moduleId: "gas-leak", stepKey: "step_1_hazard" });

  const screens = [
    {
      badge: t("gas.step1_badge_1", "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (1/3)"),
      title: t("gas.step1_title_1", "Confined Space Atmospheric Hazards"),
      desc: t("gas.step1_desc_1", "Confined spaces (tanks, sumps, silos, underground pits) trap invisible lethal gases like H₂S, methane, or CO. Low oxygen (<19.5%) causes sudden loss of consciousness without warning."),
      buttonText: t("gas.step1_next_1", "Next: Testing & Permits ➜")
    },
    {
      badge: t("gas.step1_badge_2", "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (2/3)"),
      title: t("gas.step1_title_2", "Atmospheric Testing & Entry Permits"),
      desc: t("gas.step1_desc_2", "Never enter without a signed Confined Space Entry Permit. Calibrated gas detectors must sample the atmosphere at top (light gases), middle, and bottom (heavy gases) levels before entry."),
      buttonText: t("gas.step1_next_2", "Next: Confirm Hazard in AR ➜")
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size:0.95rem;font-weight:bold;color:#f59e0b;letter-spacing:0.5px;">☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (3/3)</div>
        <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">Identify Confined Hazard Perimeter</div>
        <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Identify marked toxic/confined gas perimeter in AR space. Confirm you recognize the hazard boundary.</div>
      `;

      const btn = document.createElement("button");
      btn.id = "btn-hazard-found";
      btn.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#10b981;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
      btn.textContent = t("modules.gas_leak.btn_hazard", {}, "✔ Hazard Zone Acknowledged");
      btn.addEventListener("click", () => {
        fireCheckpointResult(CP_HAZARD_ZONE_ID, true, { method: "button_confirm" });
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

// step 2: select — user learns PPE equipment purposes before selecting bundle
function _setupStep2(container, tierInfo) {
  _currentStep = 2;
  logger.info({ event: "gas_step_start", step: 2, tier: tierInfo && tierInfo.tier }, "PPE selection");
  playNarration({ moduleId: "gas-leak", stepKey: "step_2_ppe" });

  registerCheckpoint({
    id: CP_PPE_SELECTION_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "PPE selection CP triggered");
    }
  });

  _renderPpeGraphic(container);

  const overlay = document.getElementById("gas-module-overlay");

  const screens = [
    {
      badge: t("gas.step2_badge_1", "☣ STEP 2 / 3 — PPE SELECTION (1/3)"),
      title: t("gas.step2_title_1", "Respiratory Protection for Toxic Gas"),
      desc: t("gas.step2_desc_1", "In oxygen-deficient (<19.5% O₂) or unknown toxic gas atmospheres, only a Self-Contained Breathing Apparatus (SCBA) provides clean air. Cloth or dust masks offer zero protection against gases."),
      buttonText: t("gas.step2_next_1", "Next: Gas Monitoring & Retrieval ➜")
    },
    {
      badge: t("gas.step2_badge_2", "☣ STEP 2 / 3 — PPE SELECTION (2/3)"),
      title: t("gas.step2_title_2", "Continuous Monitoring & Retrieval Lifeline"),
      desc: t("gas.step2_desc_2", "A multi-gas monitor must continuously alert the entrant to rising toxic levels. A full-body harness and retrieval lifeline allow non-entry rescue if a worker collapses inside."),
      buttonText: t("gas.step2_next_2", "Next: Select Required PPE ➜")
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size:0.95rem;font-weight:bold;color:#f59e0b;letter-spacing:0.5px;">☣ STEP 2 / 3 — PPE SELECTION (3/3)</div>
        <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">Select Required Gas Entry PPE</div>
        <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">Select all required PPE for hazardous gas entry (select all that apply):</div>
      `;

      _renderPpeOptions(overlay, (selectedList) => {
        const result = evaluatePpeSelection(selectedList);
        fireCheckpointResult(CP_PPE_SELECTION_ID, result.passed, {
          selected: selectedList,
          score: result.score,
          missing: result.missing,
          forbidden: result.forbidden
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

// step 3: select — user learns buddy system expectations before choosing protocol
function _setupStep3(_container) {
  _currentStep = 3;
  logger.info({ event: "gas_step_start", step: 3 }, "Buddy procedure");
  playNarration({ moduleId: "gas-leak", stepKey: "step_3_buddy" });

  registerCheckpoint({
    id: CP_BUDDY_PROCEDURE_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Buddy procedure CP triggered");
    }
  });

  const overlay = document.getElementById("gas-module-overlay");

  const screens = [
    {
      badge: t("gas.step3_badge_1", "☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL (1/3)"),
      title: t("gas.step3_title_1", "The Standby Buddy Role"),
      desc: t("gas.step3_desc_1", "The safety attendant (buddy) remains stationed strictly outside the entrance opening. Over 60% of confined space fatalities are would-be rescuers entering without protection."),
      buttonText: t("gas.step3_next_1", "Next: Communication & Emergency Rescue ➜")
    },
    {
      badge: t("gas.step3_badge_2", "☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL (2/3)"),
      title: t("gas.step3_title_2", "Continuous Comms & Non-Entry Rescue"),
      desc: t("gas.step3_desc_2", "The attendant maintains unbroken visual or radio communication at fixed intervals. If an entrant becomes unresponsive, the attendant immediately initiates external winch retrieval and summons emergency response."),
      buttonText: t("gas.step3_next_2", "Next: Select Buddy Procedure ➜")
    }
  ];

  function showActionScreen() {
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size:0.95rem;font-weight:bold;color:#f59e0b;letter-spacing:0.5px;">☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL (3/3)</div>
        <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">Buddy System Protocol Choice</div>
        <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">What is the safety attendant role outside the confined opening?</div>
      `;

      _renderBuddyOptions(overlay, (selectedOption, passed) => {
        fireCheckpointResult(CP_BUDDY_PROCEDURE_ID, passed, {
          selected: selectedOption,
          correct: CORRECT_BUDDY_PROCEDURE
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

// clean up all gas module visuals and overlay from DOM and a-marker
function cleanupGasLeakModule() {
  _currentStep = 0;
  stopNarration();
  if (getActiveSession()) {
    abortAssessmentSession();
  }
  ["gas-module-overlay", "gas-hazard-graphic", "gas-ppe-graphic", "gas-ppe-options", "gas-buddy-options"].forEach((id) => {
    if (typeof document !== "undefined") {
      document.getElementById(id)?.remove();
    }
  });

  if (typeof document !== "undefined" && typeof document.querySelector === "function") {
    const marker = document.querySelector("a-marker");
    if (marker && typeof marker.querySelector === "function") {
      const oldHazard = marker.querySelector("#gas-hazard-graphic");
      if (oldHazard && typeof oldHazard.remove === "function") oldHazard.remove();
      const oldPpe = marker.querySelector("#gas-ppe-graphic");
      if (oldPpe && typeof oldPpe.remove === "function") oldPpe.remove();
    }
  }
}

// show completion screen with exit button
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

  const overlay = document.getElementById("gas-module-overlay");
  if (overlay) {
    const titlePass = t("modules.gas_leak.complete_pass", {}, "✅ MODULE COMPLETE");
    const titleReview = t("modules.gas_leak.complete_review", {}, "⚠ MODULE COMPLETE — Review step 3");
    const desc = t("modules.gas_leak.complete_desc", {}, "All gas protocol checkpoints fired. Assessment engine will score your attempt.");
    overlay.innerHTML = `
      <div style="font-size:1.2rem;font-weight:bold;color:${lastPassed ? "#10b981" : "#f59e0b"}">
        ${lastPassed ? titlePass : titleReview}
      </div>
      <div style="margin:0.5rem 0;font-size:0.95rem">${desc}</div>
    `;

    const btnExit = document.createElement("button");
    btnExit.id = "btn-module-exit";
    btnExit.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.5rem;background:#f59e0b;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;";
    btnExit.textContent = t("modules.gas_leak.btn_exit_module", {}, "✖ Exit Module");
    btnExit.addEventListener("click", () => {
      cleanupGasLeakModule();
      unloadModule();
    });
    overlay.appendChild(btnExit);
  }
  logger.info({ event: "gas_module_complete" }, "Gas leak module all steps done");
}

// start gas leak module entry point
function startGasLeakModule(container, tierInfo) {
  _currentStep = 0;
  logger.info({ event: "gas_module_start", tier: tierInfo && tierInfo.tier }, "Gas leak module starting");

  cleanupGasLeakModule();

  // initialize assessment session if not already started by loader
  if (!getActiveSession()) {
    bindAssessmentSessionListeners();
    startAssessmentSession({ moduleId: "gas-leak" });
  }

  _createOverlay(container, `<div>${t("modules.gas_leak.title", {}, "Loading Gas Leak & Confined Space Protocol...")}</div>`);
  _setupStep1(container, tierInfo);
}

const handlePpeSelection = evaluatePpeSelection;

export {
  startGasLeakModule,
  cleanupGasLeakModule,
  getCurrentStep,
  evaluatePpeSelection,
  evaluateBuddyProcedure,
  handlePpeSelection,
  CP_HAZARD_ZONE_ID,
  CP_PPE_SELECTION_ID,
  CP_BUDDY_PROCEDURE_ID,
  MANDATORY_PPE,
  FORBIDDEN_PPE,
  CORRECT_BUDDY_PROCEDURE
};
