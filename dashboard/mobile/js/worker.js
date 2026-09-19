// SafeAR Mobile — Worker Training Hub
// 6-module mining safety grid with progress rings

import { MODULE_CATALOG, loadState, getModuleProgress } from "./state.js";

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

// SVG progress ring — circumference for r=12 ≈ 75.4
const RING_CIRCUMFERENCE = 2 * Math.PI * 12;

function progressRingSVG(percent, color) {
  const offset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE;
  return `
    <svg viewBox="0 0 32 32">
      <circle class="progress-ring-bg" cx="16" cy="16" r="12"></circle>
      <circle class="progress-ring-fill" cx="16" cy="16" r="12"
        stroke="${color}" stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${offset}">
      </circle>
    </svg>
  `;
}

function getModuleStatusChip(progress) {
  if (progress.status === "completed") return `<span class="module-status-chip module-status-chip--certified">✓ Certified</span>`;
  if (progress.stage > 0) return `<span class="module-status-chip module-status-chip--progress">Stage ${progress.stage}/3</span>`;
  return `<span class="module-status-chip module-status-chip--ready">Ready</span>`;
}

export function renderWorkerHub(container, { user, onLogout, onOpenModule }) {
  const state = loadState();

  // Calculate overall progress
  const totalModules = MODULE_CATALOG.length;
  const completedModules = MODULE_CATALOG.filter(m => {
    const p = getModuleProgress(state, m.id);
    return p.status === "completed";
  }).length;

  // Total stages completed across all modules
  const totalStages = MODULE_CATALOG.reduce((sum, m) => {
    const p = getModuleProgress(state, m.id);
    return sum + Math.min(p.stage, 3);
  }, 0);
  const totalPossibleStages = totalModules * 3;
  const stagePercent = Math.round((totalStages / totalPossibleStages) * 100);

  const initials = user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  container.innerHTML = `
    <!-- Top Bar -->
    <div class="top-bar">
      <img src="../img/logo.png" alt="SafeAR" class="top-bar-logo">
      <div class="top-bar-title">
        SafeAR Training
        <span class="top-bar-subtitle">Mine Safety Modules</span>
      </div>
      <button class="logout-btn" id="worker-logout">Logout</button>
    </div>

    <div class="worker-content">
      <!-- Worker Profile Chip -->
      <div class="worker-profile-chip">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-info">
          <div class="profile-name">${esc(user.name)}</div>
          <div class="profile-designation">${esc(user.id)} · ${esc(user.designation)}</div>
          <div class="profile-progress">
            <div class="profile-progress-track">
              <div class="profile-progress-fill" style="width:${stagePercent}%"></div>
            </div>
            <span class="profile-progress-text">${completedModules}/${totalModules} modules</span>
          </div>
        </div>
      </div>

      <!-- Module Grid -->
      <div class="section-title">Safety Training Modules</div>
      <div class="module-grid" id="module-grid">
        ${MODULE_CATALOG.map(mod => {
          const progress = getModuleProgress(state, mod.id);
          const stagePercent = Math.round((Math.min(progress.stage, 3) / 3) * 100);
          let progressLabel;
          if (progress.status === "completed") {
            progressLabel = `${progress.score}% Score`;
          } else if (progress.stage > 0) {
            progressLabel = `Stage ${progress.stage} of 3`;
          } else {
            progressLabel = "Not started";
          }

          return `
            <div class="module-card" data-module="${mod.id}" role="button" tabindex="0">
              ${getModuleStatusChip(progress)}
              <div class="module-card-icon">${mod.icon}</div>
              <div class="module-card-title">${esc(mod.title)}</div>
              <div class="module-card-subtitle">${esc(mod.subtitle)}</div>
              <div class="module-progress-wrap">
                <div class="progress-ring">
                  ${progressRingSVG(stagePercent, mod.color)}
                </div>
                <span class="module-progress-label">${progressLabel}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  // Module card click handlers
  container.querySelectorAll(".module-card").forEach(card => {
    card.addEventListener("click", () => {
      const moduleId = card.dataset.module;
      onOpenModule(moduleId);
    });
  });

  // Logout
  container.querySelector("#worker-logout").addEventListener("click", onLogout);
}
