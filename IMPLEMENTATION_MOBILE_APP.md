# SafeAR — Mobile Web App & Dashboard Implementation Architecture

**Document Version:** 1.0.0  
**Status:** Architectural Blueprint & Implementation Specification  
**Path:** `IMPLEMENTATION_MOBILE_APP.md`

---

## 1. Architecture Overview

The SafeAR Mobile Web Portal is implemented as a standalone, zero-dependency client-side application built with modern HTML5, Vanilla JavaScript (ES Modules), and custom CSS tokens adhering to modern industrial glassmorphism design principles.

```
┌────────────────────────────────────────────────────────┐
│                   SafeAR Entry Point                   │
│             (/dashboard/mobile/index.html)             │
│            Branded Login Window & Logo Hub             │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            ▼ (Role: Supervisor)             ▼ (Role: Worker)
┌───────────────────────────────┐ ┌───────────────────────────────┐
│     Supervisor Command        │ │     Worker Training Hub       │
│     Roster & Compliance       │ │     6 Mining Safety Modules   │
│   - Workers Under Incharge    │ │   - Fire & Explosion          │
│   - Pass/Fail Analytics       │ │   - Gas Leak & Toxic Air      │
│   - Expiring Certs / Alerts   │ │   - Roof Fall & Strata        │
│   - Refresher Assignments     │ │   - Inundation & Flooding     │
└───────────────────────────────┘ │   - Heavy Machinery & Haulage │
                                  │   - Blasting & Electrical     │
                                  └──────────────┬────────────────┘
                                                 │
                                                 ▼
                                  ┌───────────────────────────────┐
                                  │  Three-Stage Unlock Pipeline  │
                                  │  Stage 1: Prerequisites       │
                                  │  Stage 2: Solo AR Drill       │
                                  │  Stage 3: Group Incident Drill│
                                  └───────────────────────────────┘
```

---

## 2. Directory Structure & File Map

```
c:/project X/SIH/SIH-Barcelona/
├── REQUIREMENTS_MOBILE_APP.md        # Comprehensive requirements spec
├── IMPLEMENTATION_MOBILE_APP.md      # This architectural specification
├── dashboard/
│   ├── mobile/
│   │   ├── index.html                # Mobile portal HTML entry point
│   │   ├── css/
│   │   │   └── mobile.css            # Responsive mobile & tablet styles, animations
│   │   └── js/
│   │       ├── state.js              # State management & LocalStorage persistence
│   │       ├── auth.js               # Login window logic, role verification, personas
│   │       ├── supervisor.js         # Supervisor dashboard & worker roster views
│   │       ├── worker.js             # 6-module grid & stage progression engine
│   │       ├── stages.js             # Interactive 3-stage modal & drill simulators
│   │       └── mobile_app.js         # Main orchestrator / router
```

---

## 3. Data Models & Schemas

### 3.1 User & Supervisor Model
```javascript
export const CURRENT_USER_SCHEMA = {
  id: "SUP-JH-0412",
  name: "Vikram Singh",
  role: "supervisor", // "supervisor" | "worker"
  mineCode: "JH-DHANBAD-SEAM-07",
  designation: "Safety Overman — Shift A",
  assignedWorkersCount: 14
};
```

### 3.2 Worker Roster Record
```javascript
export const WORKER_RECORD_SCHEMA = {
  id: "WRK-9021",
  name: "Ramesh Mahato",
  role: "Face Operator",
  shift: "Shift A (Morning)",
  overallScore: 92,
  status: "certified", // "certified" | "in_training" | "at_risk"
  completedModules: 4,
  totalModules: 6,
  moduleBreakdown: {
    "fire-response": { status: "completed", score: 96, stage: 3 },
    "gas-leak": { status: "completed", score: 88, stage: 3 },
    "strata-hazard": { status: "in_progress", score: 74, stage: 2 },
    "inundation-hazard": { status: "locked", score: 0, stage: 0 },
    "machinery-hazard": { status: "completed", score: 94, stage: 3 },
    "blasting-hazard": { status: "completed", score: 90, stage: 3 }
  },
  lastActive: "2026-09-12T08:30:00Z",
  certExpiry: "2027-03-12"
};
```

### 3.3 Module & 3-Stage Progress Definition
```javascript
export const MODULE_CATALOG = [
  {
    id: "fire-response",
    title: "Fire & Explosion Response",
    subtitle: "आग एवं विस्फोट नियंत्रण",
    icon: "🔥",
    color: "#ef4444",
    description: "Underground coal seam fire containment, PASS extinguisher drill, and smoke-clearance evacuation.",
    stages: {
      1: {
        id: "prereq",
        title: "Stage 1: Prerequisites",
        subtitle: "Safety fundamentals, fire tetrahedron & extinguisher types",
        requirements: ["PPE Inspection", "Extinguisher Type Matching", "Warning Horn Recognition"]
      },
      2: {
        id: "solo-ar",
        title: "Stage 2: Solo AR Drill",
        subtitle: "One-on-one virtual practical: P.A.S.S. technique & sweep angle",
        minPassingScore: 80
      },
      3: {
        id: "group-drill",
        title: "Stage 3: Collaborative Incident Drill",
        subtitle: "Multi-worker simulation: Extinguisher runner, exit scout, and ventilation door seal team",
        roles: ["Worker A: Extinguisher Deployment", "Worker B: Exit Path Scout", "Worker C: Airway Seal & Alert"]
      }
    }
  },
  {
    id: "gas-leak",
    title: "Gas Leak & Confined Space",
    subtitle: "गैस रिसाव एवं संकीर्ण स्थान सुरक्षा",
    icon: "☣️",
    color: "#f59e0b",
    description: "Multi-gas detector calibration, methane/CO toxicity identification, and self-contained self-rescuer (SCSR) donning.",
    stages: { /* 3 stages */ }
  },
  {
    id: "strata-hazard",
    title: "Roof Fall & Strata Control",
    subtitle: "छत धंसने एवं संस्तर नियंत्रण",
    icon: "🪨",
    color: "#8b5cf6",
    description: "Strata sounding test (tapping), rock bolt inspection, tell-tale crack monitoring, and safe withdrawal zones.",
    stages: { /* 3 stages */ }
  },
  {
    id: "inundation-hazard",
    title: "Inundation & Flooding",
    subtitle: "जलभराव एवं बाढ़ से बचाव",
    icon: "🌊",
    color: "#0284c7",
    description: "Water barrier integrity, old-workings breakthrough alarms, bulkhead door seals, and high-ground escape routes.",
    stages: { /* 3 stages */ }
  },
  {
    id: "machinery-hazard",
    title: "Haulage & Heavy Machinery",
    subtitle: "परिवहन एवं भारी मशीनरी सुरक्षा",
    icon: "🚜",
    color: "#10b981",
    description: "Continuous miner blind-spot awareness, conveyor belt pull-cord trip switches, and Lockout/Tagout (LOTO) isolation.",
    stages: { /* 3 stages */ }
  },
  {
    id: "blasting-hazard",
    title: "Electrical & Blasting Safety",
    subtitle: "विद्युत एवं विस्फोटक सुरक्षा",
    icon: "⚡",
    color: "#ec4899",
    description: "Flameproof switchgear, misfire detection, blast perimeter clearance siren, and post-blast toxic fume clearing.",
    stages: { /* 3 stages */ }
  }
];
```

---

## 4. UI/UX Design System Specifications

### 4.1 Color Palette
- **Canvas / Background:** Deep Mine Slate `#090d16` to `#0d1527`
- **Surface Elevation:** Translucent Obsidian `rgba(17, 24, 39, 0.75)` with `backdrop-filter: blur(16px)`
- **Borders & Dividers:** `rgba(255, 255, 255, 0.08)` to `rgba(255, 255, 255, 0.16)`
- **Industrial Safety Gold / Amber:** `#f59e0b` / `#d97706`
- **Emergency Crimson:** `#ef4444` / `#dc2626`
- **Safety Cyan / Holographic:** `#00e5ff` / `#0284c7`
- **Compliance Emerald:** `#10b981` / `#059669`

### 4.2 Typography & Sizing
- **Font Stack:** System UI / Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto
- **Header:** Bold, optical tracking `-0.02em`
- **Touch Target Minimum:** 48px × 48px to accommodate glove-friendly or mobile thumb usage.

---

## 5. Implementation Details

### 5.1 Progression & Unlocking Engine
1. Progress is initialized in `state.js`. If a worker has not completed Stage 1, Stage 2 and Stage 3 are marked `disabled: true` and display a prominent lock badge (`🔒 Locked`).
2. When the user launches Stage 1 in `stages.js`, an interactive prerequisite checklist & test modal is displayed.
3. Upon successfully submitting the prerequisites:
   - Stage 1 is marked `completed: true`.
   - Stage 2 unlocks automatically with a celebratory fluid animation.
4. Launching Stage 2 presents the Solo AR simulation interactive simulator. Completing it with a passing score unlocks Stage 3.
5. In Stage 3, the multi-worker team scenario simulates role-based tasks (e.g., Extinguisher runner, Exit scout, Ventilation isolation). Completing it awards full module certification.

### 5.2 Supervisor Monitoring Engine
1. Supervisor view renders automatically on choosing the Supervisor profile or entering supervisor credentials.
2. Summary statistics calculate real-time completion percentages and flag workers with expired certifications or low test scores.
3. Supervisor can filter workers by status (`All`, `Certified`, `Pending Drills`, `High Risk`) and search by worker name or employee ID.
4. Clicking any worker card expands their individual scorecard across all six safety domains.

---

## 6. Verification & Quality Assurance

- Functional test scripts validating stage transition logic (Stage 1 -> Stage 2 -> Stage 3 lock state).
- Role routing verification (Supervisor credentials -> Supervisor dashboard; Worker credentials -> Worker hub).
- Responsiveness verification across 375px (iPhone), 412px (Android), 768px (Tablet), and desktop viewports.
