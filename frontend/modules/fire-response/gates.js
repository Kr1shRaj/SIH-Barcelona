import { t } from "../../js/i18n.js";
import { runDecisionGate, escapeHtml } from "./decision.js";
import { GATE_ANSWER_KEYS, gateSeverity } from "./scenario.js";

// english fallbacks for every gate string. en.json and hi.json carry the same keys under "fire."
const GATE_TEXT = {
  "gate_critical_title": "✖ CRITICAL MISTAKE",
  "gate_retry": "🔄 Try again",
  "gate_continue": "Continue ➜",
  "g2_badge": "🧯 GATE 2 — CHOOSE THE AGENT",
  "g2_title": "What do you put on this fire?",
  "g2_prompt_conveyor_coal": "The conveyor belt and coal spillage are burning (Class A solids).",
  "g2_prompt_diesel_hydraulic": "Diesel and hydraulic oil are burning on the floor (Class B liquids).",
  "g2_prompt_electrical_switchgear": "The switchgear panel is on fire and its cables are still live.",
  "g2_prompt_pressurized_methane": "A jet of methane is burning from a damaged gas line under pressure.",
  "g2_opt_abc_powder": "ABC dry powder",
  "g2_opt_co2": "CO₂",
  "g2_opt_water": "Water",
  "g2_opt_foam": "Foam",
  "g2_opt_isolate_supply_then_evacuate": "Isolate the gas supply, then evacuate",
  "g2_why_conveyor_coal_co2": "CO₂ drifts off a deep-seated solid fire and it rekindles. Use water or ABC powder.",
  "g2_why_conveyor_coal_foam": "Foam is for burning liquids. On a solid belt and coal fire use water or ABC powder.",
  "g2_why_conveyor_coal_isolate_supply_then_evacuate": "There is no gas supply feeding this fire. It is a solid-fuel fire you can fight: use water or ABC powder.",
  "g2_why_diesel_hydraulic_water": "Water sinks under burning oil, boils and throws the fire outward — boilover and spread. Use foam or ABC powder.",
  "g2_why_diesel_hydraulic_co2": "CO₂ knocks the flame down for a moment, but hot oil reignites. Use foam or ABC powder.",
  "g2_why_diesel_hydraulic_isolate_supply_then_evacuate": "There is no gas supply to isolate. A burning oil pool needs foam or ABC powder.",
  "g2_why_electrical_switchgear_water": "Water conducts electricity through energised cables. Electrocution. Use CO₂ or ABC powder.",
  "g2_why_electrical_switchgear_foam": "Foam is water-based and conducts electricity. Electrocution. Use CO₂ or ABC powder.",
  "g2_why_electrical_switchgear_isolate_supply_then_evacuate": "Isolating a gas line does nothing for an electrical fire. Use CO₂ or ABC powder.",
  "g2_why_pressurized_methane_agent": "Putting out a gas jet without shutting the supply lets methane keep pouring out and re-ignite explosively. Isolate the supply, then evacuate.",
  "g2_correct": "Right choice for this fire.",
  "g3_badge": "🧍 GATE 3 — WHERE DO YOU STAND?",
  "g3_title": "Choose your stance before you spray",
  "g3_prompt_intake_left": "Fresh air comes in from your LEFT and carries the smoke away to the right.",
  "g3_prompt_intake_right": "Fresh air comes in from your RIGHT and carries the smoke away to the left.",
  "g3_opt_approach_upwind_2_3m": "Fresh-air side, 2–3 m from the fire",
  "g3_opt_approach_downwind": "Smoke side, where the air flows past the fire",
  "g3_opt_under_1m": "Right up close, under 1 m",
  "g3_opt_over_4m": "Far back, over 4 m",
  "g3_why_approach_downwind": "Downwind you walk straight into the smoke stream — carbon monoxide and toxic gases. Stand on the fresh-air side.",
  "g3_why_under_1m": "Under 1 m the radiant heat burns you before the agent works. Stay 2–3 m back.",
  "g3_why_over_4m": "Past 4 m the agent spreads out before it reaches the fire base. Move in to 2–3 m.",
  "g3_correct": "Fresh air behind you, agent in reach.",
  "pass_aim_tips": "Flame tips — the powder passes straight through. 0% progress. Aim lower, at the base.",
  "g5_badge": "👀 GATE 5 — AFTER THE FLAMES",
  "g5_title": "The fire looks out. What now?",
  "g5_prompt": "The last flame is gone, but the fuel is still hot.",
  "g5_opt_back_away_facing_fire": "Back away slowly, still facing the fire",
  "g5_opt_turn_and_walk_away": "Turn around and walk away",
  "g5_opt_poke_debris": "Poke the debris to check it is out",
  "g5_why_turn_and_walk_away": "Hot fuel can flash back. Turn your back and it re-ignites behind you with no one watching. Back away facing it.",
  "g5_why_poke_debris": "Stirring hot debris feeds it air and can restart the fire. Back away facing it and let it cool.",
  "g5_correct": "You keep watch for flashback as you leave.",
  "evac_desc_3_isolate": "Supply isolated. You never fight a gas jet. Select the safest way out:",
  "training_feedback_isolate": "Training feedback: Trainee sounded the alarm, recognised a pressurised gas fire, isolated the supply and evacuated without fighting it."
};

// look up a gate string under fire.<key>, english fallback from GATE_TEXT
function tx(key) {
  return t(`fire.${key}`, GATE_TEXT[key]);
}

// every option each gate shows, in the order it shows them
export const GATE_OPTIONS = Object.freeze({
  fire_g2_media: ["abc_powder", "co2", "water", "foam", "isolate_supply_then_evacuate"],
  fire_g3_stance: ["approach_upwind_2_3m", "approach_downwind", "under_1m", "over_4m"],
  fire_g5_post: ["back_away_facing_fire", "turn_and_walk_away", "poke_debris"]
});

// short prefix each gate's strings live under
const GATE_PREFIX = Object.freeze({ fire_g2_media: "g2", fire_g3_stance: "g3", fire_g5_post: "g5" });

// the prompt line: gate 2 describes the fuel, gate 3 names the intake side
function gatePrompt(gateId, scenario) {
  if (gateId === "fire_g2_media") return tx(`g2_prompt_${scenario.fuel}`);
  if (gateId === "fire_g3_stance") return tx(`g3_prompt_${scenario.airflow}`);
  return tx("g5_prompt");
}

// why a wrong pick is wrong, in the worker's words. every agent on a gas jet shares one reason
export function gateExplanation(gateId, scenario, choice) {
  if (gateId === "fire_g2_media") {
    const key = scenario.fuel === "pressurized_methane"
      ? "g2_why_pressurized_methane_agent"
      : `g2_why_${scenario.fuel}_${choice}`;
    return tx(key);
  }
  return tx(`${GATE_PREFIX[gateId]}_why_${choice}`);
}

// true when the ray hits the upper flame, not the fuel bed: powder passes through, no progress
export function isFlameTipAim(heightAboveBaseM, flameHeightM) {
  return typeof heightAboveBaseM === "number" && typeof flameHeightM === "number" && flameHeightM > 0 &&
    heightAboveBaseM > FLAME_TIP_FRACTION * flameHeightM;
}

// above this share of the flame height the spray is on the tips, not the base
export const FLAME_TIP_FRACTION = 0.4;

// show one fail-to-learn gate card; onDone({ choice }) after the worker picks right and taps continue
export function renderGateCard(container, gateId, scenario, onDone) {
  const key = GATE_ANSWER_KEYS[gateId];
  const prefix = GATE_PREFIX[gateId];

  const panel = document.createElement("div");
  panel.id = "fire-gate-panel";
  panel.className = "fire-decision-panel fire-gate-panel";

  const cardShell = document.createElement("div");
  cardShell.className = "decision-card-shell";
  cardShell.innerHTML = `
    <div class="decision-header">
      <div class="decision-step-badge">${escapeHtml(tx(`${prefix}_badge`))}</div>
      <div class="decision-title">${escapeHtml(tx(`${prefix}_title`))}</div>
    </div>
    <div class="decision-prompt">${escapeHtml(gatePrompt(gateId, scenario))}</div>
  `;

  const optionsBox = document.createElement("div");
  optionsBox.className = "wheel-options-cluster";
  const buttons = GATE_OPTIONS[gateId].map((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `gate-opt-${choice}`;
    btn.className = "wheel-btn gate-opt-btn";
    btn.dataset.choice = choice;
    btn.textContent = tx(`${prefix}_opt_${choice}`);
    optionsBox.appendChild(btn);
    return btn;
  });
  cardShell.appendChild(optionsBox);

  const feedbackSlot = document.createElement("div");
  feedbackSlot.id = "gate-feedback-slot";
  feedbackSlot.className = "decision-feedback-slot";
  cardShell.appendChild(feedbackSlot);
  panel.appendChild(cardShell);

  // same mount rule as the decision wheel: never inside a transformed overlay
  let mountTarget = container;
  if (container && container.id === "fire-module-overlay" && typeof document !== "undefined") {
    mountTarget = document.getElementById("ar-viewport") || document.body;
  }
  mountTarget.appendChild(panel);

  runDecisionGate(optionsBox, {
    checkpointId: gateId,
    buttons,
    feedbackSlot,
    isCorrect: (choice) => gateSeverity(key, scenario, choice) === null,
    severityOf: (choice) => gateSeverity(key, scenario, choice),
    explain: (choice) => gateExplanation(gateId, scenario, choice),
    successHtml: () => escapeHtml(tx(`${prefix}_correct`)),
    retryText: tx("gate_retry"),
    context: { fuel: scenario.fuel, airflow: scenario.airflow }
  }, ({ choice }) => {
    const btnNext = document.createElement("button");
    btnNext.type = "button";
    btnNext.id = "btn-gate-continue";
    btnNext.className = "btn-decision-proceed";
    btnNext.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.4rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
    btnNext.textContent = tx("gate_continue");
    btnNext.addEventListener("click", () => {
      if (typeof panel.remove === "function") panel.remove();
      if (typeof onDone === "function") onDone({ choice });
    });
    feedbackSlot.appendChild(btnNext);
  });

  return panel;
}
