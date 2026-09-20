import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { startAlignmentSampler } from "../../ar/alignment.js";
import { selectionSingle, selectionMulti, spatialAlignment, trackingSourceForTier } from "../../assessment/observations.js";
import { unloadModule } from "../../js/module-loader.js";
import { requestCertificateForAttempt, flushPendingCertificates } from "../../js/certificates.js";
import { renderCompletionPanel } from "../../js/certificate-panel.js";
import {
  buildHazardZoneEntity,
  buildPpeDisplayEntity,
  createHazardZoneThreeMesh,
  createPpeThreeMesh
} from "./graphics.js";
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

// anchor id must match checkpoint_definition.anchor_id on the server
const HAZARD_ANCHOR_ID = "gas_hazard_zone";

// track active step
let _currentStep = 0;

// running alignment sampler for step 1, stopped when the trainee confirms
let _hazardSampler = null;

// track active tier info and webxr three.js mesh handles
let _currentTierInfo = null;
let _threeHazardMesh = null;
let _threePpeMesh = null;

// placement tracking for webxr tier 1
let _placedTransform = null;
let _placementConfirmedHandler = null;

// inactivity hint timer duration (15s default, adjustable constant)
const HINT_TIMEOUT_MS = 15000;
let _hintTimer = null;
let _hintShown = false;

// start inactivity timer to show hint on stall
function _startHintTimer(overlay, hintText) {
  _clearHintTimer();
  _hintShown = false;
  _hintTimer = setTimeout(() => {
    _hintShown = true;
    if (overlay) {
      let hintEl = overlay.querySelector ? overlay.querySelector("#gas-step-hint") : null;
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.id = "gas-step-hint";
        hintEl.style.cssText = "margin-top:0.6rem;padding:0.6rem 0.8rem;background:rgba(245,158,11,0.15);border-left:3px solid #f59e0b;border-radius:4px;font-size:0.85rem;color:#fcd34d;line-height:1.4;";
        overlay.appendChild(hintEl);
      }
      hintEl.textContent = hintText;
    }
  }, HINT_TIMEOUT_MS);
}

// clear running hint timer
function _clearHintTimer() {
  if (_hintTimer) {
    clearTimeout(_hintTimer);
    _hintTimer = null;
  }
}

// get active step index
function getCurrentStep() { return _currentStep; }

// position hazard three mesh at placed transform
function _positionHazardZoneThreeMesh() {
  if (!_currentTierInfo || _currentTierInfo.tier !== 1 || !_currentTierInfo.controller) return;
  if (_threeHazardMesh) {
    _currentTierInfo.controller.removeFromScene(_threeHazardMesh);
    _threeHazardMesh = null;
  }
  _threeHazardMesh = createHazardZoneThreeMesh();
  if (_threeHazardMesh) {
    const pos = (_placedTransform && _placedTransform.position) || { x: 0, y: -0.2, z: -1.0 };
    _threeHazardMesh.position.set(pos.x, pos.y, pos.z);
    _currentTierInfo.controller.addToScene(_threeHazardMesh);
  }
}

// position ppe three mesh offset from placed transform
function _positionPpeThreeMesh() {
  if (!_currentTierInfo || _currentTierInfo.tier !== 1 || !_currentTierInfo.controller) return;
  if (_threePpeMesh) {
    _currentTierInfo.controller.removeFromScene(_threePpeMesh);
    _threePpeMesh = null;
  }
  _threePpeMesh = createPpeThreeMesh();
  if (_threePpeMesh) {
    const pos = (_placedTransform && _placedTransform.position)
      ? { x: _placedTransform.position.x + 0.5, y: _placedTransform.position.y, z: _placedTransform.position.z }
      : { x: 0.5, y: -0.2, z: -0.9 };
    _threePpeMesh.position.set(pos.x, pos.y, pos.z);
    _currentTierInfo.controller.addToScene(_threePpeMesh);
  }
}

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
    "background:transparent", "color:#f3f4f6",
    "font-family:sans-serif", "padding:1.2rem",
    "z-index:100", "pointer-events:auto"
  ].join(";");
  panel.innerHTML = html;
  if (container && container.appendChild) {
    container.appendChild(panel);
  }
  return panel;
}

// render 3d hazard zone in a-marker, webxr three scene, or fallback container
function _renderHazardZoneGraphic(container) {
  if (_currentTierInfo && _currentTierInfo.tier === 1 && _currentTierInfo.controller) {
    if (!_placedTransform && typeof _currentTierInfo.controller.getPlacedTransform === "function") {
      _placedTransform = _currentTierInfo.controller.getPlacedTransform();
    }
    if (_placedTransform) {
      _positionHazardZoneThreeMesh();
    } else if (typeof _currentTierInfo.controller.getPlacedTransform !== "function") {
      _placedTransform = { position: { x: 0, y: -0.2, z: -1.0 } };
      _positionHazardZoneThreeMesh();
    }

    if (!_placementConfirmedHandler && typeof window !== "undefined") {
      _placementConfirmedHandler = (e) => {
        const detail = (e && e.detail) || {};
        _placedTransform = {
          position: detail.position || { x: 0, y: -0.2, z: -1.0 },
          quaternion: detail.quaternion,
          viewerQuaternion: detail.viewerQuaternion
        };
        if (_currentStep === 0 || _currentStep === 1) {
          _positionHazardZoneThreeMesh();
        } else if (_currentStep === 2) {
          _positionPpeThreeMesh();
        }
      };
      window.addEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    }
  }

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
  let parent = marker;
  if (!parent && typeof document !== "undefined" && typeof document.querySelector === "function") {
    parent = document.querySelector("a-scene");
  }
  if (!parent) {
    parent = container;
  }
  if (parent && parent.appendChild) {
    parent.appendChild(graphic);
  }
  return graphic;
}

// render 3d ppe visual in a-marker, webxr three scene, or fallback container
function _renderPpeGraphic(container) {
  if (_currentTierInfo && _currentTierInfo.tier === 1 && _currentTierInfo.controller) {
    if (!_placedTransform && typeof _currentTierInfo.controller.getPlacedTransform === "function") {
      _placedTransform = _currentTierInfo.controller.getPlacedTransform();
    }
    if (_placedTransform) {
      _positionPpeThreeMesh();
    } else if (typeof _currentTierInfo.controller.getPlacedTransform !== "function") {
      _placedTransform = { position: { x: 0, y: -0.2, z: -1.0 } };
      _positionPpeThreeMesh();
    }

    if (!_placementConfirmedHandler && typeof window !== "undefined") {
      _placementConfirmedHandler = (e) => {
        const detail = (e && e.detail) || {};
        _placedTransform = {
          position: detail.position || { x: 0, y: -0.2, z: -1.0 },
          quaternion: detail.quaternion,
          viewerQuaternion: detail.viewerQuaternion
        };
        if (_currentStep === 0 || _currentStep === 1) {
          _positionHazardZoneThreeMesh();
        } else if (_currentStep === 2) {
          _positionPpeThreeMesh();
        }
      };
      window.addEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    }
  }

  const marker = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector("a-marker")
    : null;
  const el = buildPpeDisplayEntity();
  let parent = marker;
  if (!parent && typeof document !== "undefined" && typeof document.querySelector === "function") {
    parent = document.querySelector("a-scene");
  }
  if (!parent) {
    parent = container;
  }
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
      "border:1px solid #343a40", "background:#1a1d20",
      "color:#f3f4f6", "cursor:pointer", "font-size:0.9rem",
      "text-align:left", "display:flex", "align-items:center", "gap:0.5rem"
    ].join(";");
    row.textContent = `[ ] ${label}`;

    row.addEventListener("click", () => {
      if (selectedSet.has(id)) {
        selectedSet.delete(id);
        row.style.borderColor = "#343a40";
        row.style.background = "#1a1d20";
        row.textContent = `[ ] ${label}`;
      } else {
        selectedSet.add(id);
        row.style.borderColor = "#febc04";
        row.style.background = "rgba(203, 209, 216, 0.18)";
        row.textContent = `[✔] ${label}`;
      }
    });

    wrapper.appendChild(row);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.id = "btn-confirm-ppe";
  confirmBtn.style.cssText = "padding:0.75rem;background:#febc04;color:#000;border:none;border-radius:8px;font-size:1rem;font-weight:bold;cursor:pointer;margin-top:0.4rem;";
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
      "border:1px solid #febc04", "background:#1a1d20",
      "color:#f3f4f6", "cursor:pointer", "font-size:0.85rem",
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
    <div class="hud-eyebrow">${badge}</div>
    <div class="hud-title">${title}</div>
    <div class="hud-instruction">${desc}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#febc04;color:#000;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", () => {
    if (typeof btnNext.remove === "function") btnNext.remove();
    onNext();
  });
  overlay.appendChild(btnNext);
}

// show transition screen between teach and test phase
function _renderTransitionScreen(overlay, onStartTest) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="hud-eyebrow">${t("gas.teach_complete_badge", {}, "🎓 TEACH PHASE COMPLETE")}</div>
    <div class="hud-title">${t("gas.test_ready_title", {}, "Ready for your assessment?")}</div>
    <div class="hud-instruction">${t("gas.test_ready_desc", {}, "You will now execute the 3 critical protocol steps without educational hints. Demonstrate proper hazard recognition, PPE selection, and buddy communication.")}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.dataset.action = "start-test";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#2f9e63;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btnNext.textContent = t("gas.btn_start_test", {}, "Begin Graded Test ➜");
  btnNext.addEventListener("click", () => {
    if (typeof btnNext.remove === "function") btnNext.remove();
    onStartTest();
  });
  overlay.appendChild(btnNext);
}

// run all educational briefing subscreens back to back without checkpoints
function _startTeachPhase(container, tierInfo) {
  _currentStep = 0;
  logger.info({ event: "gas_teach_phase_start", tier: tierInfo && tierInfo.tier }, "Gas leak module teach phase start");

  const overlay = document.getElementById("gas-module-overlay");

  // step 1: render hazard zone immediately with narration and rationale
  _renderHazardZoneGraphic(container);
  playNarration({ moduleId: "gas-leak", stepKey: "step_1_hazard" });

  const screens = [
    {
      badge: t("gas.step1_badge_1", {}, "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (1/3)"),
      title: t("gas.step1_title_1", {}, "Confined Space Atmospheric Hazards"),
      desc: t("gas.step1_desc_1", {}, "Confined spaces (tanks, sumps, silos, underground pits) trap invisible lethal gases like H₂S, methane, or CO. Low oxygen (<19.5%) causes sudden loss of consciousness without warning."),
      buttonText: t("gas.step1_next_1", {}, "Next: Testing & Permits ➜")
    },
    {
      badge: t("gas.step1_badge_2", {}, "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (2/3)"),
      title: t("gas.step1_title_2", {}, "Atmospheric Testing & Entry Permits"),
      desc: t("gas.step1_desc_2", {}, "Never enter without a signed Confined Space Entry Permit. Calibrated gas detectors must sample the atmosphere at top (light gases), middle, and bottom (heavy gases) levels before entry."),
      buttonText: t("gas.step1_next_2", {}, "Next: Protective Equipment ➜"),
      onAfter: () => {
        _renderPpeGraphic(container);
        playNarration({ moduleId: "gas-leak", stepKey: "step_2_ppe" });
      }
    },
    {
      badge: t("gas.step2_badge_1", {}, "☣ STEP 2 / 3 — PPE SELECTION (1/3)"),
      title: t("gas.step2_title_1", {}, "Respiratory Protection for Toxic Gas"),
      desc: t("gas.step2_desc_1", {}, "In oxygen-deficient (<19.5% O₂) or unknown toxic gas atmospheres, only a Self-Contained Breathing Apparatus (SCBA) provides clean air. Cloth or dust masks offer zero protection against gases."),
      buttonText: t("gas.step2_next_1", {}, "Next: Gas Monitoring & Retrieval ➜")
    },
    {
      badge: t("gas.step2_badge_2", {}, "☣ STEP 2 / 3 — PPE SELECTION (2/3)"),
      title: t("gas.step2_title_2", {}, "Continuous Monitoring & Retrieval Lifeline"),
      desc: t("gas.step2_desc_2", {}, "A multi-gas monitor must continuously alert the entrant to rising toxic levels. A full-body harness and retrieval lifeline allow non-entry rescue if a worker collapses inside."),
      buttonText: t("gas.step2_next_2", {}, "Next: Buddy Protocol ➜"),
      onAfter: () => playNarration({ moduleId: "gas-leak", stepKey: "step_3_buddy" })
    },
    {
      badge: t("gas.step3_badge_1", {}, "☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL (1/3)"),
      title: t("gas.step3_title_1", {}, "The Standby Buddy Role"),
      desc: t("gas.step3_desc_1", {}, "The safety attendant (buddy) remains stationed strictly outside the entrance opening. Over 60% of confined space fatalities are would-be rescuers entering without protection."),
      buttonText: t("gas.step3_next_1", {}, "Next: Communication & Emergency Rescue ➜")
    },
    {
      badge: t("gas.step3_badge_2", {}, "☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL (2/3)"),
      title: t("gas.step3_title_2", {}, "Continuous Comms & Non-Entry Rescue"),
      desc: t("gas.step3_desc_2", {}, "The attendant maintains unbroken visual or radio communication at fixed intervals. If an entrant becomes unresponsive, the attendant immediately initiates external winch retrieval and summons emergency response."),
      buttonText: t("gas.step3_next_2", {}, "Next: Assessment ➜"),
      onAfter: () => stopNarration()
    }
  ];

  let subIndex = 0;
  function renderCurrentSubscreen() {
    if (subIndex < screens.length) {
      const item = screens[subIndex];
      _renderSubscreen(overlay, {
        badge: item.badge,
        title: item.title,
        desc: item.desc,
        buttonText: item.buttonText,
        onNext: () => {
          if (typeof item.onAfter === "function") item.onAfter();
          subIndex++;
          renderCurrentSubscreen();
        }
      });
    } else {
      stopNarration();
      _renderTransitionScreen(overlay, () => {
        _startTestPhase(container, tierInfo);
      });
    }
  }

  renderCurrentSubscreen();
}

// start graded test phase with session and cold replay of actions
function _startTestPhase(container, tierInfo) {
  logger.info({ event: "gas_test_phase_start", tier: tierInfo && tierInfo.tier }, "Gas leak module test phase starting");
  stopNarration();

  // initialize assessment session if not already active for gas leak
  if (!getActiveSession() || getActiveSession().moduleId !== "gas-leak") {
    if (getActiveSession()) {
      abortAssessmentSession();
    }
    bindAssessmentSessionListeners();
    startAssessmentSession({ moduleId: "gas-leak" });
  }

  _setupTestAction1(container, tierInfo);
}

// action 1: hazard zone confirm in test phase
function _setupTestAction1(container, tierInfo) {
  _currentStep = 1;
  _clearHintTimer();
  logger.info({ event: "gas_step_start", step: 1, tier: tierInfo && tierInfo.tier }, "Hazard zone recognition");

  if (typeof document !== "undefined") {
    document.getElementById("btn-step-next")?.remove();
  }

  registerCheckpoint({
    id: CP_HAZARD_ZONE_ID,
    type: "proximity",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Hazard zone CP triggered");
    }
  });

  const hazardGraphic = _renderHazardZoneGraphic(container);
  // the hazard zone hangs off the printed marker, so the angle between where the
  // phone points and where the zone is really is measurable. sample it while the
  // trainee reads the briefing; report nothing measured if the scene cannot answer.
  _hazardSampler = startAlignmentSampler({ targetEl: hazardGraphic, anchorId: HAZARD_ANCHOR_ID });

  const overlay = document.getElementById("gas-module-overlay");
  if (overlay) {
    overlay.innerHTML = `
      <div class="hud-eyebrow">${t("gas.step1_action_badge", {}, "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION")}</div>
      <div class="hud-title">${t("gas.step1_action_title", {}, "Identify Confined Hazard Perimeter")}</div>
      <div class="hud-instruction">${t("gas.step1_action_desc", {}, "Identify marked toxic/confined gas perimeter in AR space. Confirm you recognize the hazard boundary.")}</div>
    `;

    const btn = document.createElement("button");
    btn.id = "btn-hazard-found";
    btn.style.cssText = "margin-top:0.4rem;padding:0.8rem 1.5rem;background:#2f9e63;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
    btn.textContent = t("modules.gas_leak.btn_hazard", {}, "✔ Hazard Zone Acknowledged");
    btn.addEventListener("click", () => {
      _clearHintTimer();
      const sampled = _hazardSampler ? _hazardSampler.stop() : { angularErrorRad: null, dwellMs: 0, frameCount: 0 };
      _hazardSampler = null;
      const context = {
        method: "button_confirm",
        measured: sampled.angularErrorRad !== null
      };
      if (_hintShown) {
        context.hintShown = true;
      }
      fireCheckpointResult(
        CP_HAZARD_ZONE_ID,
        true,
        context,
        spatialAlignment({
          anchorId: HAZARD_ANCHOR_ID,
          angularErrorRad: sampled.angularErrorRad,
          dwellMs: sampled.dwellMs,
          frameCount: sampled.frameCount,
          trackingSource: trackingSourceForTier(tierInfo && tierInfo.tier)
        })
      );
      _setupTestAction2(container, tierInfo);
    });
    overlay.appendChild(btn);

    _startHintTimer(
      overlay,
      t("gas.step1_hint", {}, "Hint: Low oxygen (<19.5%) and toxic gases (H₂S, methane) trap in confined pits. Verify hazard boundary before entry.")
    );
  }
}

// action 2: ppe selection in test phase
function _setupTestAction2(container, tierInfo) {
  _currentStep = 2;
  _clearHintTimer();
  logger.info({ event: "gas_step_start", step: 2, tier: tierInfo && tierInfo.tier }, "PPE selection");

  if (typeof document !== "undefined") {
    document.getElementById("btn-step-next")?.remove();
  }

  registerCheckpoint({
    id: CP_PPE_SELECTION_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "PPE selection CP triggered");
    }
  });

  _renderPpeGraphic(container);

  const overlay = document.getElementById("gas-module-overlay");
  if (overlay) {
    overlay.innerHTML = `
      <div class="hud-eyebrow">${t("gas.step2_action_badge", {}, "☣ STEP 2 / 3 — PPE SELECTION")}</div>
      <div class="hud-title">${t("gas.step2_action_title", {}, "Select Required Gas Entry PPE")}</div>
      <div class="hud-instruction">${t("gas.step2_action_desc", {}, "Select all required PPE for hazardous gas entry (select all that apply):")}</div>
    `;

    _renderPpeOptions(overlay, (selectedList) => {
      _clearHintTimer();
      const result = evaluatePpeSelection(selectedList);
      const context = {
        selected: selectedList,
        score: result.score,
        missing: result.missing,
        forbidden: result.forbidden
      };
      if (_hintShown) {
        context.hintShown = true;
      }
      fireCheckpointResult(
        CP_PPE_SELECTION_ID,
        result.passed,
        context,
        selectionMulti(selectedList)
      );
      _setupTestAction3(container);
    });

    _startHintTimer(
      overlay,
      t("gas.step2_hint", {}, "Hint: Only SCBA provides clean breathable air in toxic or low-oxygen atmospheres. Cloth or dust masks offer zero protection.")
    );
  }
}

// action 3: buddy procedure in test phase
function _setupTestAction3(_container) {
  _currentStep = 3;
  _clearHintTimer();
  logger.info({ event: "gas_step_start", step: 3 }, "Buddy procedure");

  if (typeof document !== "undefined") {
    document.getElementById("btn-step-next")?.remove();
  }

  registerCheckpoint({
    id: CP_BUDDY_PROCEDURE_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Buddy procedure CP triggered");
    }
  });

  const overlay = document.getElementById("gas-module-overlay");
  if (overlay) {
    overlay.innerHTML = `
      <div class="hud-eyebrow">${t("gas.step3_action_badge", {}, "☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL")}</div>
      <div class="hud-title">${t("gas.step3_action_title", {}, "Buddy System Protocol Choice")}</div>
      <div class="hud-instruction">${t("gas.step3_action_desc", {}, "What is the safety attendant role outside the confined opening?")}</div>
    `;

    _renderBuddyOptions(overlay, (selectedOption, passed) => {
      _clearHintTimer();
      const context = {
        selected: selectedOption,
        correct: CORRECT_BUDDY_PROCEDURE
      };
      if (_hintShown) {
        context.hintShown = true;
      }
      fireCheckpointResult(
        CP_BUDDY_PROCEDURE_ID,
        passed,
        context,
        selectionSingle(selectedOption)
      );
      _showComplete(passed);
    });

    _startHintTimer(
      overlay,
      t("gas.step3_hint", {}, "Hint: The standby buddy must remain outside with a continuous lifeline. Never enter to attempt unequipped rescue.")
    );
  }
}

// clean up all gas module visuals and overlay from DOM and a-marker
function cleanupGasLeakModule(options = {}) {
  _currentStep = 0;
  _clearHintTimer();
  _hintShown = false;
  stopNarration();
  // a sampler left running holds a requestAnimationFrame loop against a scene
  // that is about to be torn down
  if (_hazardSampler) {
    _hazardSampler.stop();
    _hazardSampler = null;
  }
  if (!options.preserveSession && getActiveSession()) {
    abortAssessmentSession();
  }

  if (_placementConfirmedHandler && typeof window !== "undefined") {
    window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    _placementConfirmedHandler = null;
  }
  _placedTransform = null;

  if (_currentTierInfo && _currentTierInfo.controller) {
    if (_threeHazardMesh) {
      _currentTierInfo.controller.removeFromScene(_threeHazardMesh);
      _threeHazardMesh = null;
    }
    if (_threePpeMesh) {
      _currentTierInfo.controller.removeFromScene(_threePpeMesh);
      _threePpeMesh = null;
    }
  }

  ["gas-module-overlay", "gas-hazard-graphic", "gas-ppe-graphic", "gas-ppe-options", "gas-buddy-options", "gas-step-hint"].forEach((id) => {
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
    const scene = document.querySelector("a-scene");
    if (scene && typeof scene.querySelector === "function") {
      const oldHazard = scene.querySelector("#gas-hazard-graphic");
      if (oldHazard && typeof oldHazard.remove === "function") oldHazard.remove();
      const oldPpe = scene.querySelector("#gas-ppe-graphic");
      if (oldPpe && typeof oldPpe.remove === "function") oldPpe.remove();
    }
  }
}

// show completion screen with exit button
function _showComplete(_lastPassed) {
  _currentStep = 0;

  const overlay = document.getElementById("gas-module-overlay");
  const theme = { passColor: "#2f9e63", failColor: "#febc04", exitColor: "#febc04", exitTextColor: "#000" };

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
    return renderCompletionPanel(overlay, {
      evaluated: evaluated || {},
      theme,
      exitLabel: t("modules.gas_leak.btn_exit_module", {}, "✖ Exit Module"),
      onExit: () => {
        cleanupGasLeakModule();
        unloadModule();
      }
    });
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

  logger.info({ event: "gas_module_complete" }, "Gas leak module all steps done");
}

// start gas leak module entry point
function startGasLeakModule(container, tierInfo) {
  _currentStep = 0;
  _currentTierInfo = tierInfo || null;
  logger.info({ event: "gas_module_start", tier: tierInfo && tierInfo.tier }, "Gas leak module starting");

  // preserve only fresh empty session from current loader call; restart with checkpoints must reset
  const existingSession = getActiveSession();
  const isFreshLoaderSession = Boolean(
    existingSession &&
    existingSession.moduleId === "gas-leak" &&
    (!existingSession.checkpoints || existingSession.checkpoints.length === 0)
  );

  cleanupGasLeakModule({ preserveSession: isFreshLoaderSession });

  _createOverlay(container, `<div>${t("modules.gas_leak.title", {}, "Loading Gas Leak & Confined Space Protocol...")}</div>`);
  _startTeachPhase(container, tierInfo);
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
  CORRECT_BUDDY_PROCEDURE,
  HINT_TIMEOUT_MS
};
