// SafeAR Mobile — State Management & Data Store
// Offline-first localStorage persistence for training progress

// ── Module Catalog ──
export const MODULE_CATALOG = [
  {
    id: "fire-response",
    title: "Fire & Explosion Response",
    subtitle: "आग एवं विस्फोट नियंत्रण",
    icon: "🔥",
    color: "#ef4444",
    colorVar: "crimson",
    description: "Underground coal seam fire containment, PASS extinguisher drill, and smoke-clearance evacuation.",
    prereqs: [
      "Identify fire tetrahedron elements (Heat, Fuel, Oxygen, Chain Reaction)",
      "Match extinguisher types: CO₂ for electrical, DCP for Class B/C",
      "Recognize emergency warning horn patterns"
    ],
    quiz: {
      question: "A methane pocket ignites near a coal face. What is your FIRST action?",
      options: [
        "Run towards the nearest exit immediately",
        "Alert others and activate the emergency alarm",
        "Attempt to fight the fire with a DCP extinguisher",
        "Wait for the supervisor's instruction"
      ],
      correct: 1
    },
    drillDesc: "P.A.S.S. Technique — Pull, Aim, Squeeze, Sweep the extinguisher at the fire base.",
    roles: [
      { id: "responder", icon: "🧯", title: "First Responder", desc: "Deploy DCP extinguisher at fire base using PASS technique" },
      { id: "scout", icon: "🚪", title: "Exit Path Scout", desc: "Verify return airway is clear, guide crew to fresh air base" },
      { id: "comms", icon: "📡", title: "Comms & Alert Officer", desc: "Sound evacuation alarm, relay status to pithead control room" }
    ]
  },
  {
    id: "gas-leak",
    title: "Gas Leak & Confined Space",
    subtitle: "गैस रिसाव एवं संकीर्ण स्थान सुरक्षा",
    icon: "☣️",
    color: "#f59e0b",
    colorVar: "amber",
    description: "Multi-gas detector calibration, methane/CO toxicity identification, and SCSR donning.",
    prereqs: [
      "Identify dangerous gas thresholds: CH₄ > 1.25%, CO > 50ppm, O₂ < 19.5%",
      "Verify multi-gas detector bump test and calibration date",
      "Demonstrate SCSR (Self-Contained Self-Rescuer) seal check"
    ],
    quiz: {
      question: "Your multi-gas detector shows CH₄ at 1.8% and O₂ at 18.2%. What action is required?",
      options: [
        "Continue work but increase ventilation",
        "Immediately withdraw to fresh air base and report",
        "Switch off the detector — it is malfunctioning",
        "Open a window for fresh air"
      ],
      correct: 1
    },
    drillDesc: "Don the SCSR within 30 seconds, verify seal, navigate to fresh air base.",
    roles: [
      { id: "detector", icon: "📟", title: "Gas Monitor Operator", desc: "Read multi-gas detector, confirm threshold breach, log readings" },
      { id: "rescuer", icon: "🫁", title: "Self-Rescue Leader", desc: "Distribute & verify SCSR donning for all present workers" },
      { id: "evacuator", icon: "🏃", title: "Evacuation Marshal", desc: "Lead group along return airway to fresh air base" }
    ]
  },
  {
    id: "strata-hazard",
    title: "Roof Fall & Strata Control",
    subtitle: "छत धंसने एवं संस्तर नियंत्रण",
    icon: "🪨",
    color: "#8b5cf6",
    colorVar: "violet",
    description: "Strata sounding test (tapping), rock bolt inspection, tell-tale crack monitoring, and safe withdrawal zones.",
    prereqs: [
      "Perform strata sounding test: identify hollow vs solid tap responses",
      "Inspect rock bolt torque with calibrated wrench — minimum 150 Nm",
      "Read tell-tale displacement gauges (red zone > 5mm = danger)"
    ],
    quiz: {
      question: "During strata sounding, you hear a hollow drumming sound overhead. This indicates:",
      options: [
        "The roof is solid and stable",
        "A potential void or loose slab above — immediate danger",
        "Normal vibration from nearby blasting",
        "Water accumulation above the panel"
      ],
      correct: 1
    },
    drillDesc: "Tap-test the roof at 1m intervals, identify weak zones, install temporary props.",
    roles: [
      { id: "sounder", icon: "🔨", title: "Strata Inspector", desc: "Perform systematic sounding test across the panel roof" },
      { id: "support", icon: "🏗️", title: "Support Installer", desc: "Deploy hydraulic props at identified weak zones" },
      { id: "reporter", icon: "📋", title: "Hazard Logger", desc: "Mark dangerous zones on mine plan, notify shift incharge" }
    ]
  },
  {
    id: "inundation-hazard",
    title: "Inundation & Flooding",
    subtitle: "जलभराव एवं बाढ़ से बचाव",
    icon: "🌊",
    color: "#3b82f6",
    colorVar: "blue",
    description: "Water barrier integrity, old-workings breakthrough alarms, bulkhead door seals, and high-ground escape routes.",
    prereqs: [
      "Identify signs of old-workings breakthrough: discoloured water, unusual seepage",
      "Verify bulkhead door seal integrity and water-tightness",
      "Know your district's designated high-ground assembly point"
    ],
    quiz: {
      question: "You notice rusty, foul-smelling water seeping from a recently exposed coal face. This likely indicates:",
      options: [
        "Normal groundwater infiltration",
        "Possible breach into abandoned flooded workings — extreme danger",
        "Condensation from ventilation ducts",
        "A broken water supply pipe"
      ],
      correct: 1
    },
    drillDesc: "Seal the bulkhead door, activate the flood alarm, retreat to high-ground assembly point.",
    roles: [
      { id: "observer", icon: "👁️", title: "Water Watch", desc: "Monitor seepage rate, report colour and volume changes" },
      { id: "sealer", icon: "🚧", title: "Bulkhead Operator", desc: "Close and seal the emergency bulkhead door" },
      { id: "guide", icon: "🗺️", title: "Escape Route Guide", desc: "Lead personnel to designated high-ground assembly point" }
    ]
  },
  {
    id: "machinery-hazard",
    title: "Haulage & Heavy Machinery",
    subtitle: "परिवहन एवं भारी मशीनरी सुरक्षा",
    icon: "🚜",
    color: "#10b981",
    colorVar: "emerald",
    description: "HEMM blind-spot awareness, conveyor belt pull-cord trip switches, and Lockout/Tagout (LOTO) isolation.",
    prereqs: [
      "Identify HEMM blind-spot danger zones from the operator's perspective",
      "Locate and test conveyor belt pull-cord emergency trip switches",
      "Demonstrate proper Lockout-Tagout (LOTO) padlock isolation procedure"
    ],
    quiz: {
      question: "Before performing maintenance on a conveyor belt, the FIRST step in the LOTO procedure is:",
      options: [
        "Inform your supervisor and wait",
        "Isolate the energy source and apply your personal padlock",
        "Start working quickly before the belt restarts",
        "Check if anyone else is using the belt"
      ],
      correct: 1
    },
    drillDesc: "Identify blind spots, activate pull-cord trip, perform LOTO isolation on equipment.",
    roles: [
      { id: "spotter", icon: "🔭", title: "Blind-Spot Spotter", desc: "Stand in safe position and signal HEMM operator during reversing" },
      { id: "isolator", icon: "🔒", title: "LOTO Executor", desc: "Isolate power, apply padlock, verify zero-energy state" },
      { id: "verifier", icon: "✅", title: "Safety Verifier", desc: "Confirm isolation, attempt machine start (must fail), authorize work" }
    ]
  },
  {
    id: "blasting-hazard",
    title: "Electrical & Blasting Safety",
    subtitle: "विद्युत एवं विस्फोटक सुरक्षा",
    icon: "⚡",
    color: "#ec4899",
    colorVar: "pink",
    description: "Flameproof switchgear inspection, misfire detection, blast perimeter clearance siren, and post-blast toxic fume clearing.",
    prereqs: [
      "Inspect flameproof enclosure: verify all bolts tightened, no flame gaps",
      "Know the statutory waiting time after a blast before re-entry (minimum 30 min)",
      "Identify siren patterns: 3 short = clear area, 1 long = all clear"
    ],
    quiz: {
      question: "After a blast, the re-entry wait period is primarily for:",
      options: [
        "Allowing the rock to settle completely",
        "Dissipation of toxic fumes (NOₓ, CO) and ventilation clearance",
        "Cooling down the explosive residue",
        "Giving workers a break"
      ],
      correct: 1
    },
    drillDesc: "Clear the blast perimeter, verify siren signals, wait and verify fume clearance before re-entry.",
    roles: [
      { id: "blaster", icon: "💣", title: "Shot-Firer", desc: "Verify connections, sound clearance siren, initiate blast sequence" },
      { id: "sentry", icon: "🛑", title: "Perimeter Sentry", desc: "Guard all access routes, prevent premature re-entry" },
      { id: "monitor", icon: "🌬️", title: "Fume Monitor", desc: "Test air quality post-blast, authorize re-entry only when safe" }
    ]
  }
];

// ── Supervisor & Worker Personas ──
export const SUPERVISOR_PERSONA = {
  id: "SUP-JH-0412",
  name: "Vikram Singh",
  role: "supervisor",
  designation: "Safety Overman — Shift A",
  mineCode: "JH-DHANBAD-SEAM-07",
  mineName: "Jharkhand Coal Seam #7, Dhanbad",
  shift: "Shift A (06:00 – 14:00)"
};

export const WORKER_PERSONA = {
  id: "WRK-9021",
  name: "Ramesh Mahato",
  role: "worker",
  designation: "Face Operator / Loader",
  mineCode: "JH-DHANBAD-SEAM-07",
  shift: "Shift A (06:00 – 14:00)"
};

// ── Mock Worker Roster (for Supervisor) ──
export const WORKER_ROSTER = [
  {
    id: "WRK-9021", name: "Ramesh Mahato", role: "Face Operator",
    shift: "Shift A", overallScore: 92, status: "certified",
    modules: {
      "fire-response": { stage: 3, score: 96, status: "completed" },
      "gas-leak": { stage: 3, score: 88, status: "completed" },
      "strata-hazard": { stage: 2, score: 74, status: "in_progress" },
      "inundation-hazard": { stage: 0, score: 0, status: "locked" },
      "machinery-hazard": { stage: 3, score: 94, status: "completed" },
      "blasting-hazard": { stage: 3, score: 90, status: "completed" }
    },
    lastActive: "2026-09-12", certExpiry: "2027-03-12"
  },
  {
    id: "WRK-9034", name: "Sunil Oraon", role: "Timberman",
    shift: "Shift A", overallScore: 78, status: "training",
    modules: {
      "fire-response": { stage: 3, score: 85, status: "completed" },
      "gas-leak": { stage: 2, score: 70, status: "in_progress" },
      "strata-hazard": { stage: 1, score: 60, status: "in_progress" },
      "inundation-hazard": { stage: 0, score: 0, status: "locked" },
      "machinery-hazard": { stage: 3, score: 82, status: "completed" },
      "blasting-hazard": { stage: 1, score: 55, status: "in_progress" }
    },
    lastActive: "2026-09-11", certExpiry: "2027-01-15"
  },
  {
    id: "WRK-9047", name: "Dinesh Kumar Soren", role: "Loader Operator",
    shift: "Shift A", overallScore: 95, status: "certified",
    modules: {
      "fire-response": { stage: 3, score: 98, status: "completed" },
      "gas-leak": { stage: 3, score: 94, status: "completed" },
      "strata-hazard": { stage: 3, score: 91, status: "completed" },
      "inundation-hazard": { stage: 3, score: 96, status: "completed" },
      "machinery-hazard": { stage: 3, score: 92, status: "completed" },
      "blasting-hazard": { stage: 3, score: 97, status: "completed" }
    },
    lastActive: "2026-09-13", certExpiry: "2027-06-01"
  },
  {
    id: "WRK-9052", name: "Birsa Munda", role: "Shot-Firer Helper",
    shift: "Shift A", overallScore: 42, status: "risk",
    modules: {
      "fire-response": { stage: 1, score: 45, status: "in_progress" },
      "gas-leak": { stage: 0, score: 0, status: "locked" },
      "strata-hazard": { stage: 0, score: 0, status: "locked" },
      "inundation-hazard": { stage: 0, score: 0, status: "locked" },
      "machinery-hazard": { stage: 1, score: 38, status: "in_progress" },
      "blasting-hazard": { stage: 0, score: 0, status: "locked" }
    },
    lastActive: "2026-09-08", certExpiry: "2026-10-01"
  },
  {
    id: "WRK-9063", name: "Lakhi Hansda", role: "Ventilation Attendant",
    shift: "Shift A", overallScore: 87, status: "certified",
    modules: {
      "fire-response": { stage: 3, score: 90, status: "completed" },
      "gas-leak": { stage: 3, score: 92, status: "completed" },
      "strata-hazard": { stage: 3, score: 84, status: "completed" },
      "inundation-hazard": { stage: 2, score: 76, status: "in_progress" },
      "machinery-hazard": { stage: 3, score: 88, status: "completed" },
      "blasting-hazard": { stage: 3, score: 86, status: "completed" }
    },
    lastActive: "2026-09-13", certExpiry: "2027-04-20"
  },
  {
    id: "WRK-9078", name: "Mangal Singh Baraik", role: "Pumpman",
    shift: "Shift A", overallScore: 68, status: "training",
    modules: {
      "fire-response": { stage: 3, score: 80, status: "completed" },
      "gas-leak": { stage: 2, score: 72, status: "in_progress" },
      "strata-hazard": { stage: 1, score: 50, status: "in_progress" },
      "inundation-hazard": { stage: 3, score: 85, status: "completed" },
      "machinery-hazard": { stage: 1, score: 44, status: "in_progress" },
      "blasting-hazard": { stage: 0, score: 0, status: "locked" }
    },
    lastActive: "2026-09-10", certExpiry: "2027-02-28"
  }
];

// ── State Keys ──
const STORAGE_KEY = "safear_mobile_state";

// ── State API ──
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_e) { /* corrupt storage, start fresh */ }
  return getDefaultWorkerState();
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_e) { /* storage full or unavailable */ }
}

export function getDefaultWorkerState() {
  const modules = {};
  for (const mod of MODULE_CATALOG) {
    modules[mod.id] = { stage: 0, score: 0, status: "ready" };
  }
  return { modules };
}

export function getModuleProgress(state, moduleId) {
  return state.modules[moduleId] || { stage: 0, score: 0, status: "ready" };
}

export function completeStage(state, moduleId, stageNum, score) {
  const progress = state.modules[moduleId] || { stage: 0, score: 0, status: "ready" };
  if (stageNum > progress.stage) {
    progress.stage = stageNum;
  }
  if (score !== undefined && score > progress.score) {
    progress.score = score;
  }
  if (progress.stage >= 3) {
    progress.status = "completed";
  } else if (progress.stage > 0) {
    progress.status = "in_progress";
  }
  state.modules[moduleId] = progress;
  saveState(state);
  return state;
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  return getDefaultWorkerState();
}
