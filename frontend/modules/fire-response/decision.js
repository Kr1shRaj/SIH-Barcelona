import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";

// stable decision checkpoint identifier
export const CP_DECISION_ID = "fire_explosion_decision";

// valid choices for emergency decision wheel
export const DECISION_CHOICES = Object.freeze({
  EVACUATE: "evacuate",
  EXTINGUISH: "extinguish",
  WAIT: "wait"
});

// explosive methane limit threshold percentage
export const METHANE_EXPLOSIVE_THRESHOLD = 5.0;

// generate random methane concentration reading between 0.5% and 9.5%
export function generateMethaneReading(randomFn = Math.random) {
  const val = 0.5 + randomFn() * 9.0;
  return Math.round(val * 10) / 10;
}

// check if decision matches safety rule for measured gas concentration
export function isCorrectDecision(reading, choice) {
  if (typeof reading !== "number" || isNaN(reading)) {
    return false;
  }
  if (choice === DECISION_CHOICES.WAIT) {
    return false;
  }
  if (reading >= METHANE_EXPLOSIVE_THRESHOLD) {
    return choice === DECISION_CHOICES.EVACUATE;
  }
  return choice === DECISION_CHOICES.EXTINGUISH;
}

// get feedback explanation for wrong choice based on methane reading
export function getDecisionExplanation(reading, choice) {
  const readVal = typeof reading === "number" ? reading.toFixed(1) : String(reading);
  if (choice === DECISION_CHOICES.WAIT) {
    return `The meter read ${readVal}% CH₄. When holding a live gas reading in an active fire emergency, waiting for a supervisor wastes critical seconds and risks lives.`;
  }
  if (reading >= METHANE_EXPLOSIVE_THRESHOLD && choice === DECISION_CHOICES.EXTINGUISH) {
    return `The meter read ${readVal}% CH₄ — above the 5.0% lower explosive limit (LEL). Never fight an incipient fire in an explosive atmosphere: evacuate immediately.`;
  }
  if (reading < METHANE_EXPLOSIVE_THRESHOLD && choice === DECISION_CHOICES.EVACUATE) {
    return `The meter read ${readVal}% CH₄ — below 5.0% explosive limit. With low gas levels, standard protocol requires attempting extinguisher PASS suppression before flame spreads, followed by evacuation.`;
  }
  return `Action "${choice}" is incorrect for methane concentration of ${readVal}%.`;
}

// polar coordinates helper converting dial angle to xy
function _polarToCartesian(cx, cy, radius, angleDegrees) {
  const rad = (angleDegrees - 90) * (Math.PI / 180);
  return {
    x: Math.round((cx + radius * Math.cos(rad)) * 10) / 10,
    y: Math.round((cy + radius * Math.sin(rad)) * 10) / 10
  };
}

// render svg path arc between two angles on circular scale
function _describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = _polarToCartesian(cx, cy, radius, startAngle);
  const end = _polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

// render original drawn gas gauge dial as standalone scalable svg string
export function renderGasGaugeSvg(reading, options = {}) {
  const size = options.size || 240;
  const clamped = Math.max(0, Math.min(10, typeof reading === "number" && !isNaN(reading) ? reading : 0));
  const cx = 120;
  const cy = 120;
  const r = 85;

  // scale spans from -120 deg (0%) to +120 deg (10%), 5% sits straight up at 0 deg
  const startAngle = -120;
  const midAngle = 0;
  const endAngle = 120;
  const needleAngle = startAngle + (clamped / 10) * (endAngle - startAngle);

  // green arc: 0% to 5% (safe / low gas)
  const greenArc = _describeArc(cx, cy, r, startAngle, midAngle);
  // red arc: 5% to 10% (explosive hazard zone)
  const redArc = _describeArc(cx, cy, r, midAngle, endAngle);

  // major and minor ticks
  let ticksHtml = "";
  for (let i = 0; i <= 10; i++) {
    const angle = startAngle + (i / 10) * 240;
    const p1 = _polarToCartesian(cx, cy, r - 2, angle);
    const p2 = _polarToCartesian(cx, cy, r - 12, angle);
    const textPos = _polarToCartesian(cx, cy, r - 23, angle);
    const isRed = i >= 5;
    const strokeColor = isRed ? "#ef4444" : "#10b981";
    ticksHtml += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" />`;
    ticksHtml += `<text x="${textPos.x}" y="${textPos.y + 4}" font-family="system-ui, sans-serif" font-size="10" font-weight="700" fill="${isRed ? "#f87171" : "#34d399"}" text-anchor="middle">${i}</text>`;

    if (i < 10) {
      const halfAngle = angle + 12;
      const h1 = _polarToCartesian(cx, cy, r - 2, halfAngle);
      const h2 = _polarToCartesian(cx, cy, r - 8, halfAngle);
      ticksHtml += `<line x1="${h1.x}" y1="${h1.y}" x2="${h2.x}" y2="${h2.y}" stroke="#64748b" stroke-width="1.2" />`;
    }
  }

  const isExplosive = clamped >= 5.0;
  const digitalBg = isExplosive ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)";
  const digitalBorder = isExplosive ? "#ef4444" : "#10b981";
  const digitalText = isExplosive ? "#fca5a5" : "#6ee7b7";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="${size}" height="${size}" class="gas-gauge-svg" role="img" aria-label="Methane gas meter reading ${clamped.toFixed(1)} percent">
      <defs>
        <radialGradient id="gauge-rim" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#334155" />
          <stop offset="85%" stop-color="#1e293b" />
          <stop offset="100%" stop-color="#0f172a" />
        </radialGradient>
        <linearGradient id="needle-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ff4d4d" />
          <stop offset="100%" stop-color="#b91c1c" />
        </linearGradient>
        <filter id="gauge-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.6" />
        </filter>
      </defs>

      <!-- outer industrial metallic bezel -->
      <circle cx="120" cy="120" r="114" fill="url(#gauge-rim)" stroke="#475569" stroke-width="4" filter="url(#gauge-shadow)" />
      <circle cx="120" cy="120" r="106" fill="#0f172a" stroke="#334155" stroke-width="1.5" />

      <!-- green safe / incipient zone arc (0% - 5%) -->
      <path d="${greenArc}" fill="none" stroke="#10b981" stroke-width="6.5" stroke-linecap="round" opacity="0.9" />
      <!-- red danger zone arc (5% - 10%) -->
      <path d="${redArc}" fill="none" stroke="#ef4444" stroke-width="6.5" stroke-linecap="round" opacity="0.9" />

      <!-- scale ticks and numbers -->
      ${ticksHtml}

      <!-- meter branding labels -->
      <text x="120" y="78" font-family="system-ui, sans-serif" font-size="11" font-weight="800" letter-spacing="1.2" fill="#94a3b8" text-anchor="middle">CH₄ METHANE</text>
      <text x="120" y="92" font-family="system-ui, sans-serif" font-size="8.5" font-weight="700" letter-spacing="0.8" fill="#64748b" text-anchor="middle">% CONCENTRATION</text>

      <!-- threshold marker warning label at 5% top center -->
      <text x="120" y="44" font-family="system-ui, sans-serif" font-size="7.5" font-weight="800" fill="#ef4444" text-anchor="middle">▲ 5% LEL</text>

      <!-- digital value box -->
      <rect x="75" y="148" width="90" height="24" rx="6" fill="${digitalBg}" stroke="${digitalBorder}" stroke-width="1.5" />
      <text x="120" y="164" font-family="monospace, monospace" font-size="13" font-weight="800" fill="${digitalText}" text-anchor="middle">${clamped.toFixed(1)}% VOL</text>

      <!-- animated/positioned needle -->
      <g transform="rotate(${needleAngle.toFixed(1)}, 120, 120)">
        <polygon points="117.5,120 119.2,28 120.8,28 122.5,120 121,138 119,138" fill="url(#needle-grad)" />
        <circle cx="120" cy="120" r="8" fill="#334155" stroke="#f8fafc" stroke-width="2" />
        <circle cx="120" cy="120" r="3" fill="#f59e0b" />
      </g>
    </svg>
  `;
}

// render full screen alert flash pulse overlay on module start
export function renderAlertFlash(container, { durationMs = 1800, onDone } = {}) {
  if (!container) return null;

  const existing = document.getElementById("fire-alert-overlay");
  if (existing && existing.remove) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "fire-alert-overlay";
  overlay.className = "fire-alert-flash-active";
  overlay.innerHTML = `
    <div class="fire-alert-content">
      <div class="fire-alert-icon">⚠️</div>
      <div class="fire-alert-title">FIRE &amp; EXPLOSION ALERT</div>
      <div class="fire-alert-subtitle">INCIDENT REPORTED IN MINE WORKINGS</div>
      <div class="fire-alert-desc">Inspect your personal methane gas monitor immediately before proceeding.</div>
      <div class="fire-alert-hint">Tap anywhere or waiting to assess gas meter...</div>
    </div>
  `;

  container.appendChild(overlay);

  let cleaned = false;
  const dismiss = () => {
    if (cleaned) return;
    cleaned = true;
    overlay.classList.add("fire-alert-fade-out");
    setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.remove();
      if (typeof onDone === "function") onDone();
    }, 250);
  };

  overlay.addEventListener("click", dismiss);
  const timer = setTimeout(dismiss, durationMs);

  return {
    element: overlay,
    dismiss: () => {
      if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
        window.clearTimeout(timer);
      }
      dismiss();
    }
  };
}

// render radial decision wheel dialogue around methane meter
export function renderDecisionWheel(container, { reading, onDecision, onWrongAttempt } = {}) {
  if (!container) return null;

  const readingVal = typeof reading === "number" && !isNaN(reading) ? reading : generateMethaneReading();
  const isExplosive = readingVal >= METHANE_EXPLOSIVE_THRESHOLD;

  const panel = document.createElement("div");
  panel.id = "fire-decision-panel";
  panel.className = "fire-decision-panel";

  const gaugeHtml = renderGasGaugeSvg(readingVal, { size: 210 });

  const cardShell = document.createElement("div");
  cardShell.className = "decision-card-shell";

  cardShell.innerHTML = `
    <div class="decision-header">
      <div class="decision-step-badge">⚠️ EXPLOSION HAZARD ASSESSMENT</div>
      <div class="decision-title">Methane Monitor: ${readingVal.toFixed(1)}% CH₄</div>
      <div class="decision-reading-status ${isExplosive ? "status-danger" : "status-warning"}">
        ${isExplosive ? "🚨 DANGER: AT/ABOVE 5% LOWER EXPLOSIVE LIMIT" : "⚠️ DETECTED: BELOW 5% (INCIPIENT RISK ZONE)"}
      </div>
    </div>
    <div class="decision-gauge-container">
      ${gaugeHtml}
    </div>
    <div class="decision-prompt">
      Select emergency protocol on the decision wheel:
    </div>
  `;

  const wheelWrapper = document.createElement("div");
  wheelWrapper.className = "decision-wheel-wrapper";
  wheelWrapper.id = "decision-wheel-wrapper";

  const cluster = document.createElement("div");
  cluster.className = "wheel-options-cluster";

  const optionDefs = [
    {
      id: "btn-decision-evacuate",
      choice: DECISION_CHOICES.EVACUATE,
      extraClass: "wheel-btn-evacuate",
      icon: "🚨",
      label: "Evacuate immediately",
      sub: "Run to nearest marked exit"
    },
    {
      id: "btn-decision-extinguish",
      choice: DECISION_CHOICES.EXTINGUISH,
      extraClass: "wheel-btn-extinguish",
      icon: "🧯",
      label: "Attempt to extinguish",
      sub: "Use PASS extinguisher drill"
    },
    {
      id: "btn-decision-wait",
      choice: DECISION_CHOICES.WAIT,
      extraClass: "wheel-btn-wait",
      icon: "⏳",
      label: "Wait for supervisor",
      sub: "Remain at location for orders"
    }
  ];

  const buttons = [];
  optionDefs.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = opt.id;
    btn.className = `wheel-btn ${opt.extraClass}`;
    btn.dataset.choice = opt.choice;
    btn.innerHTML = `
      <span class="wheel-btn-icon">${opt.icon}</span>
      <span class="wheel-btn-label">${opt.label}</span>
      <span class="wheel-btn-sub">${opt.sub}</span>
    `;
    cluster.appendChild(btn);
    buttons.push(btn);
  });
  wheelWrapper.appendChild(cluster);
  cardShell.appendChild(wheelWrapper);

  const feedbackSlot = document.createElement("div");
  feedbackSlot.id = "decision-feedback-slot";
  feedbackSlot.className = "decision-feedback-slot";
  cardShell.appendChild(feedbackSlot);

  panel.appendChild(cardShell);
  container.appendChild(panel);

  // register scored moment checkpoint
  registerCheckpoint({
    id: CP_DECISION_ID,
    type: "select",
    onTrigger: () => {}
  });

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const choice = btn.dataset.choice;
      const correct = isCorrectDecision(readingVal, choice);

      // fire checkpoint result event for tracking
      fireCheckpointResult(CP_DECISION_ID, correct, {
        choice,
        reading: readingVal,
        threshold: METHANE_EXPLOSIVE_THRESHOLD
      });

      if (correct) {
        btn.classList.add("wheel-btn-selected-correct");
        buttons.forEach((b) => (b.disabled = true));
        feedbackSlot.innerHTML = `
          <div class="decision-feedback decision-feedback-success">
            <div class="feedback-title">✔ CORRECT PROTOCOL CONFIRMED</div>
            <div class="feedback-desc">
              ${choice === DECISION_CHOICES.EVACUATE
                ? `Meter reading is ${readingVal.toFixed(1)}% (>= 5.0% LEL). Immediate evacuation is mandatory.`
                : `Meter reading is ${readingVal.toFixed(1)}% (< 5.0% LEL). Proceed to sound alarm and suppress with extinguisher.`
              }
            </div>
          </div>
        `;
        setTimeout(() => {
          if (typeof onDecision === "function") {
            onDecision({ choice, reading: readingVal, correct: true, panel });
          }
        }, 50);
      } else {
        // wrong choice blocks progress and displays explanation
        btn.classList.add("wheel-btn-selected-wrong");
        const explanation = getDecisionExplanation(readingVal, choice);
        feedbackSlot.innerHTML = `
          <div class="decision-feedback decision-feedback-error">
            <div class="feedback-title">✖ INCORRECT SAFETY ACTION</div>
            <div class="feedback-desc">${explanation}</div>
            <button type="button" id="btn-decision-retry" class="btn-decision-retry">
              🔄 Re-evaluate Meter &amp; Choose Action
            </button>
          </div>
        `;

        if (typeof onWrongAttempt === "function") {
          onWrongAttempt({ choice, reading: readingVal, correct: false });
        }

        const retryBtn = feedbackSlot.querySelector("#btn-decision-retry");
        if (retryBtn) {
          retryBtn.addEventListener("click", () => {
            btn.classList.remove("wheel-btn-selected-wrong");
            feedbackSlot.innerHTML = "";
          });
        }
      }
    });
  });

  return panel;
}
