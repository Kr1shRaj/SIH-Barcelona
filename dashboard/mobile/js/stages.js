// SafeAR Mobile — 3-Stage Progressive Unlock Modal
// Interactive prerequisite checklist, solo drill simulator, and group incident drill

import { MODULE_CATALOG, loadState, getModuleProgress, completeStage } from "./state.js";

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

export function openStageModal(overlayEl, moduleId, { onClose }) {
  const mod = MODULE_CATALOG.find(m => m.id === moduleId);
  if (!mod) return;

  const state = loadState();
  const progress = getModuleProgress(state, moduleId);

  overlayEl.classList.add("active");
  renderStageContent(overlayEl, mod, progress, state, onClose);
}

function renderStageContent(overlayEl, mod, progress, state, onClose) {
  const currentStage = progress.stage; // 0 = none done, 1 = prereq done, 2 = solo done, 3 = all done

  // Stage tracker states
  const s1State = currentStage >= 1 ? "completed" : "active";
  const s2State = currentStage >= 2 ? "completed" : currentStage >= 1 ? "active" : "locked";
  const s3State = currentStage >= 3 ? "completed" : currentStage >= 2 ? "active" : "locked";

  const c1Done = currentStage >= 1 ? "stage-connector--done" : "";
  const c2Done = currentStage >= 2 ? "stage-connector--done" : "";

  const s1Dot = currentStage >= 1 ? "✓" : "1";
  const s2Dot = currentStage >= 2 ? "✓" : currentStage >= 1 ? "2" : "🔒";
  const s3Dot = currentStage >= 3 ? "✓" : currentStage >= 2 ? "3" : "🔒";

  overlayEl.innerHTML = `
    <div class="stage-sheet">
      <div class="stage-sheet-handle"></div>

      <!-- Header -->
      <div class="stage-header">
        <div class="stage-header-icon">${mod.icon}</div>
        <div class="stage-header-info">
          <div class="stage-header-title">${esc(mod.title)}</div>
          <div class="stage-header-sub">${esc(mod.subtitle)}</div>
        </div>
        <button class="stage-close-btn" id="stage-close" type="button">✕</button>
      </div>

      <!-- Stage Tracker -->
      <div class="stage-tracker">
        <div class="stage-step stage-step--${s1State}">
          <div class="stage-step-dot">${s1Dot}</div>
          <div class="stage-step-label">Prerequisites</div>
        </div>
        <div class="stage-connector ${c1Done}"></div>
        <div class="stage-step stage-step--${s2State}">
          <div class="stage-step-dot">${s2Dot}</div>
          <div class="stage-step-label">Solo AR Drill</div>
        </div>
        <div class="stage-connector ${c2Done}"></div>
        <div class="stage-step stage-step--${s3State}">
          <div class="stage-step-dot">${s3Dot}</div>
          <div class="stage-step-label">Group Drill</div>
        </div>
      </div>

      <!-- Stage Content -->
      <div class="stage-body" id="stage-body">
        ${renderAllStages(mod, progress, state)}
      </div>
    </div>
  `;

  // Close button
  overlayEl.querySelector("#stage-close").addEventListener("click", () => {
    overlayEl.classList.remove("active");
    onClose();
  });

  // Click overlay backdrop to close
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) {
      overlayEl.classList.remove("active");
      onClose();
    }
  });

  // Bind interactive elements
  bindStage1(overlayEl, mod, state, () => {
    const updated = completeStage(state, mod.id, 1, 100);
    const newProgress = getModuleProgress(updated, mod.id);
    renderStageContent(overlayEl, mod, newProgress, updated, onClose);
  });

  bindStage2(overlayEl, mod, state, (score) => {
    const updated = completeStage(state, mod.id, 2, score);
    const newProgress = getModuleProgress(updated, mod.id);
    renderStageContent(overlayEl, mod, newProgress, updated, onClose);
  });

  bindStage3(overlayEl, mod, state, () => {
    const updated = completeStage(state, mod.id, 3, 95);
    const newProgress = getModuleProgress(updated, mod.id);
    renderStageContent(overlayEl, mod, newProgress, updated, onClose);
  });
}

function renderAllStages(mod, progress, _state) {
  const stage = progress.stage;

  return `
    ${renderStage1Section(mod, stage)}
    ${renderStage2Section(mod, stage)}
    ${renderStage3Section(mod, stage)}
    ${stage >= 3 ? renderCertification(mod, progress) : ""}
  `;
}

// ── Stage 1: Prerequisites ──
function renderStage1Section(mod, currentStage) {
  const isCompleted = currentStage >= 1;

  if (isCompleted) {
    return `
      <div class="stage-section">
        <div class="stage-section-title">
          <span style="color:var(--emerald)">✓</span> Stage 1: Prerequisites — Completed
        </div>
        <div class="stage-section-desc">Safety fundamentals verified successfully.</div>
      </div>
    `;
  }

  return `
    <div class="stage-section" id="stage1-section">
      <div class="stage-section-title">📋 Stage 1: Prerequisites</div>
      <div class="stage-section-desc">Complete the safety checklist and pass the verification quiz to unlock the AR drill.</div>

      <div class="checklist" id="stage1-checklist">
        ${mod.prereqs.map((p, i) => `
          <div class="checklist-item" data-index="${i}">
            <div class="checklist-check"></div>
            <span>${esc(p)}</span>
          </div>
        `).join("")}
      </div>

      ${mod.quiz ? `
        <div class="quiz-card" id="stage1-quiz" style="margin-top:16px;">
          <div class="quiz-question">${esc(mod.quiz.question)}</div>
          <div class="quiz-options">
            ${mod.quiz.options.map((opt, i) => `
              <button class="quiz-option" data-index="${i}" type="button">${esc(opt)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <button class="stage-action-btn stage-action-btn--disabled" id="stage1-complete" type="button" disabled>
        Complete all items to unlock →
      </button>
    </div>
  `;
}

// ── Stage 2: Solo AR Drill ──
function renderStage2Section(mod, currentStage) {
  const isCompleted = currentStage >= 2;
  const isLocked = currentStage < 1;

  if (isCompleted) {
    return `
      <div class="stage-section">
        <div class="stage-section-title">
          <span style="color:var(--emerald)">✓</span> Stage 2: Solo AR Drill — Completed
        </div>
        <div class="stage-section-desc">Individual practical drill passed with a qualifying score.</div>
      </div>
    `;
  }

  if (isLocked) {
    return `
      <div class="stage-section stage-section--locked">
        <div class="stage-section-title"><span class="lock-badge">🔒</span> Stage 2: Solo AR Drill</div>
        <div class="stage-section-desc">Complete Stage 1 prerequisites to unlock this AR practical drill.</div>
        <button class="stage-action-btn stage-action-btn--disabled" disabled>Locked — Complete Prerequisites First</button>
      </div>
    `;
  }

  return `
    <div class="stage-section" id="stage2-section">
      <div class="stage-section-title">🎯 Stage 2: Solo AR Drill</div>
      <div class="stage-section-desc">${esc(mod.drillDesc)}</div>

      <div class="drill-preview">
        <div class="drill-preview-reticle"></div>
        <div class="drill-preview-label">AR Drill Simulation Preview</div>
      </div>

      <div class="score-gauge" id="stage2-gauge" style="display:none;">
        <div class="gauge-circle">
          <svg viewBox="0 0 36 36">
            <circle class="gauge-bg" cx="18" cy="18" r="15.5"></circle>
            <circle class="gauge-fill" cx="18" cy="18" r="15.5"
              stroke="var(--emerald)" stroke-dasharray="97.4" stroke-dashoffset="97.4" id="gauge-fill-circle">
            </circle>
          </svg>
          <div class="gauge-text" id="gauge-text">0%</div>
        </div>
        <div class="gauge-label" id="gauge-label">Scoring…</div>
      </div>

      <button class="stage-action-btn stage-action-btn--primary" id="stage2-start" type="button">
        🚀 Start Solo AR Drill
      </button>
    </div>
  `;
}

// ── Stage 3: Group Drill ──
function renderStage3Section(mod, currentStage) {
  const isCompleted = currentStage >= 3;
  const isLocked = currentStage < 2;

  if (isCompleted) {
    return `
      <div class="stage-section">
        <div class="stage-section-title">
          <span style="color:var(--emerald)">✓</span> Stage 3: Collaborative Group Drill — Completed
        </div>
        <div class="stage-section-desc">Multi-worker incident scenario resolved successfully.</div>
      </div>
    `;
  }

  if (isLocked) {
    return `
      <div class="stage-section stage-section--locked">
        <div class="stage-section-title"><span class="lock-badge">🔒</span> Stage 3: Group Incident Drill</div>
        <div class="stage-section-desc">Complete Stage 2 solo drill to unlock the team collaboration scenario.</div>
        <button class="stage-action-btn stage-action-btn--disabled" disabled>Locked — Complete Solo Drill First</button>
      </div>
    `;
  }

  const roles = mod.roles || [];
  return `
    <div class="stage-section" id="stage3-section">
      <div class="stage-section-title">👥 Stage 3: Collaborative Incident Drill</div>
      <div class="stage-section-desc">Assign your role in the emergency response team. Each worker handles a different critical task.</div>

      <div class="role-cards" id="stage3-roles">
        ${roles.map((r, i) => `
          <div class="role-card" data-index="${i}">
            <div class="role-card-icon">${r.icon}</div>
            <div class="role-card-info">
              <div class="role-card-title">${esc(r.title)}</div>
              <div class="role-card-desc">${esc(r.desc)}</div>
            </div>
          </div>
        `).join("")}
      </div>

      <button class="stage-action-btn stage-action-btn--disabled" id="stage3-start" type="button" disabled>
        Select your role to begin →
      </button>
    </div>
  `;
}

// ── Certification ──
function renderCertification(mod, progress) {
  return `
    <div class="stage-section">
      <div class="cert-celebration">
        <div class="cert-celebration-icon">🏆</div>
        <div class="cert-celebration-title">Module Certified!</div>
        <div class="cert-celebration-sub">${esc(mod.title)} — All 3 stages completed with ${progress.score}% score</div>
      </div>
      <button class="stage-action-btn stage-action-btn--success" id="cert-close-btn" type="button">
        ✓ Return to Training Hub
      </button>
    </div>
  `;
}

// ── Stage 1 Interactivity ──
function bindStage1(overlayEl, mod, state, onComplete) {
  const checklist = overlayEl.querySelector("#stage1-checklist");
  const quiz = overlayEl.querySelector("#stage1-quiz");
  const completeBtn = overlayEl.querySelector("#stage1-complete");
  if (!checklist || !completeBtn) return;

  const totalItems = mod.prereqs.length;
  let checkedItems = new Set();
  let quizCorrect = false;

  function updateButton() {
    const allChecked = checkedItems.size === totalItems;
    const ready = allChecked && (mod.quiz ? quizCorrect : true);
    if (ready) {
      completeBtn.disabled = false;
      completeBtn.classList.remove("stage-action-btn--disabled");
      completeBtn.classList.add("stage-action-btn--primary");
      completeBtn.textContent = "✓ Complete Prerequisites & Unlock Stage 2 →";
    } else {
      completeBtn.disabled = true;
      completeBtn.classList.add("stage-action-btn--disabled");
      completeBtn.classList.remove("stage-action-btn--primary");
      const remaining = totalItems - checkedItems.size;
      if (!allChecked) {
        completeBtn.textContent = `${remaining} item${remaining > 1 ? "s" : ""} remaining…`;
      } else {
        completeBtn.textContent = "Answer the quiz correctly to proceed →";
      }
    }
  }

  // Checklist toggles
  checklist.querySelectorAll(".checklist-item").forEach(item => {
    item.addEventListener("click", () => {
      const idx = item.dataset.index;
      if (checkedItems.has(idx)) {
        checkedItems.delete(idx);
        item.classList.remove("checked");
        item.querySelector(".checklist-check").textContent = "";
      } else {
        checkedItems.add(idx);
        item.classList.add("checked");
        item.querySelector(".checklist-check").textContent = "✓";
      }
      updateButton();
    });
  });

  // Quiz
  if (quiz && mod.quiz) {
    quiz.querySelectorAll(".quiz-option").forEach(opt => {
      opt.addEventListener("click", () => {
        const idx = parseInt(opt.dataset.index);
        quiz.querySelectorAll(".quiz-option").forEach(o => {
          o.classList.remove("selected", "correct", "incorrect");
          o.disabled = true;
        });
        if (idx === mod.quiz.correct) {
          opt.classList.add("correct");
          quizCorrect = true;
        } else {
          opt.classList.add("incorrect");
          // Highlight the correct one
          quiz.querySelector(`.quiz-option[data-index="${mod.quiz.correct}"]`).classList.add("correct");
          quizCorrect = false;
        }
        updateButton();
        // Re-enable after a delay for retry
        if (!quizCorrect) {
          setTimeout(() => {
            quiz.querySelectorAll(".quiz-option").forEach(o => {
              o.disabled = false;
              o.classList.remove("selected", "correct", "incorrect");
            });
          }, 1500);
        }
      });
    });
  } else {
    quizCorrect = true; // no quiz means auto-pass
  }

  completeBtn.addEventListener("click", () => {
    if (!completeBtn.disabled) {
      onComplete();
    }
  });

  updateButton();
}

// ── Stage 2 Interactivity (Simulated Drill) ──
function bindStage2(overlayEl, mod, state, onComplete) {
  const startBtn = overlayEl.querySelector("#stage2-start");
  if (!startBtn) return;

  startBtn.addEventListener("click", () => {
    startBtn.disabled = true;
    startBtn.textContent = "⏱ Drill in progress…";
    startBtn.classList.remove("stage-action-btn--primary");
    startBtn.classList.add("stage-action-btn--disabled");

    const gaugeWrap = overlayEl.querySelector("#stage2-gauge");
    const gaugeFill = overlayEl.querySelector("#gauge-fill-circle");
    const gaugeText = overlayEl.querySelector("#gauge-text");
    const gaugeLabel = overlayEl.querySelector("#gauge-label");
    const drillPreview = overlayEl.querySelector(".drill-preview");

    // Simulate drill progress
    if (gaugeWrap) gaugeWrap.style.display = "flex";
    if (drillPreview) drillPreview.style.borderColor = "var(--cyan)";

    const finalScore = 85 + Math.floor(Math.random() * 13); // 85-97
    let currentScore = 0;
    const steps = 30;
    const interval = 60; // ms per step

    const timer = setInterval(() => {
      currentScore += Math.ceil(finalScore / steps);
      if (currentScore >= finalScore) {
        currentScore = finalScore;
        clearInterval(timer);

        // Show result
        if (gaugeLabel) gaugeLabel.textContent = currentScore >= 80 ? "Passed! ✓" : "Below threshold";
        if (gaugeFill) gaugeFill.style.stroke = currentScore >= 80 ? "var(--emerald)" : "var(--crimson)";

        startBtn.textContent = "✓ Complete Drill & Unlock Stage 3 →";
        startBtn.classList.remove("stage-action-btn--disabled");
        startBtn.classList.add("stage-action-btn--success");
        startBtn.disabled = false;

        // Replace click handler
        const newBtn = startBtn.cloneNode(true);
        startBtn.parentNode.replaceChild(newBtn, startBtn);
        newBtn.addEventListener("click", () => onComplete(finalScore));
      }

      // Update gauge
      const circumference = 97.4; // 2 * PI * 15.5
      const offset = circumference - (currentScore / 100) * circumference;
      if (gaugeFill) gaugeFill.style.strokeDashoffset = offset;
      if (gaugeText) gaugeText.textContent = `${currentScore}%`;
    }, interval);
  });
}

// ── Stage 3 Interactivity (Group Drill) ──
function bindStage3(overlayEl, mod, state, onComplete) {
  const rolesEl = overlayEl.querySelector("#stage3-roles");
  const startBtn = overlayEl.querySelector("#stage3-start");
  if (!rolesEl || !startBtn) return;

  let selectedRole = null;

  rolesEl.querySelectorAll(".role-card").forEach(card => {
    card.addEventListener("click", () => {
      rolesEl.querySelectorAll(".role-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedRole = card.dataset.index;

      startBtn.disabled = false;
      startBtn.classList.remove("stage-action-btn--disabled");
      startBtn.classList.add("stage-action-btn--primary");
      const roleName = mod.roles[selectedRole]?.title || "Selected Role";
      startBtn.textContent = `🚀 Begin Drill as ${roleName} →`;
    });
  });

  startBtn.addEventListener("click", () => {
    if (startBtn.disabled || selectedRole === null) return;

    startBtn.disabled = true;
    startBtn.textContent = "⏱ Team drill in progress…";
    startBtn.classList.remove("stage-action-btn--primary");
    startBtn.classList.add("stage-action-btn--disabled");

    // Simulate group drill
    setTimeout(() => {
      startBtn.textContent = "✓ Incident Resolved — Complete Module →";
      startBtn.classList.remove("stage-action-btn--disabled");
      startBtn.classList.add("stage-action-btn--success");
      startBtn.disabled = false;

      const newBtn = startBtn.cloneNode(true);
      startBtn.parentNode.replaceChild(newBtn, startBtn);
      newBtn.addEventListener("click", () => onComplete());
    }, 2500);
  });

  // Cert close button (if module already completed)
  const certCloseBtn = overlayEl.querySelector("#cert-close-btn");
  if (certCloseBtn) {
    certCloseBtn.addEventListener("click", () => {
      overlayEl.classList.remove("active");
    });
  }
}

export function closeStageModal(overlayEl) {
  overlayEl.classList.remove("active");
}
