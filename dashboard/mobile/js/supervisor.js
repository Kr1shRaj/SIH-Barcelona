// SafeAR Mobile — Supervisor Compliance Dashboard
// Workforce roster, KPIs, per-worker module breakdown

import { WORKER_ROSTER, MODULE_CATALOG } from "./state.js";

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function getStatusClass(status) {
  if (status === "certified") return "certified";
  if (status === "risk") return "risk";
  return "training";
}

function getStatusLabel(status) {
  if (status === "certified") return "Certified";
  if (status === "risk") return "High Risk";
  return "In Training";
}

function getScoreClass(score) {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function getInitials(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

export function renderSupervisor(container, { user, onLogout }) {
  const roster = WORKER_ROSTER;

  // Compute KPIs
  const totalWorkers = roster.length;
  const certified = roster.filter(w => w.status === "certified").length;
  const atRisk = roster.filter(w => w.status === "risk").length;
  const avgScore = Math.round(roster.reduce((s, w) => s + w.overallScore, 0) / totalWorkers);
  const expiringSoon = roster.filter(w => {
    if (!w.certExpiry) return false;
    const exp = new Date(w.certExpiry);
    const now = new Date();
    const diff = (exp - now) / (1000 * 60 * 60 * 24);
    return diff <= 90 && diff > 0;
  }).length;

  container.innerHTML = `
    <!-- Top Bar -->
    <div class="top-bar">
      <img src="../img/logo.png" alt="SafeAR" class="top-bar-logo">
      <div class="top-bar-title">
        ${esc(user.designation)}
        <span class="top-bar-subtitle">${esc(user.mineName)}</span>
      </div>
      <button class="logout-btn" id="sup-logout">Logout</button>
    </div>

    <div class="sup-content">
      <!-- KPI Cards -->
      <div class="kpi-row">
        <div class="kpi-card kpi-card--compliance">
          <div class="kpi-value">${avgScore}%</div>
          <div class="kpi-label">Team Compliance</div>
        </div>
        <div class="kpi-card kpi-card--certified">
          <div class="kpi-value">${certified}/${totalWorkers}</div>
          <div class="kpi-label">Fully Certified</div>
        </div>
        <div class="kpi-card kpi-card--expiring">
          <div class="kpi-value">${expiringSoon}</div>
          <div class="kpi-label">Expiring Soon</div>
        </div>
        <div class="kpi-card kpi-card--risk">
          <div class="kpi-value">${atRisk}</div>
          <div class="kpi-label">High Risk</div>
        </div>
      </div>

      <!-- Filters -->
      <div class="sup-section-header">
        <div class="sup-section-title">Workers Under Your Shift</div>
      </div>

      <div class="filter-row" id="filter-row">
        <button class="filter-pill active" data-filter="all">All (${totalWorkers})</button>
        <button class="filter-pill" data-filter="certified">Certified (${certified})</button>
        <button class="filter-pill" data-filter="training">In Training</button>
        <button class="filter-pill" data-filter="risk">High Risk (${atRisk})</button>
      </div>

      <input class="search-bar" id="search-bar" type="text" placeholder="Search worker name or ID...">

      <!-- Worker Roster -->
      <div class="roster-list" id="roster-list"></div>
    </div>
  `;

  // Render roster
  const rosterEl = container.querySelector("#roster-list");
  let activeFilter = "all";
  let searchTerm = "";

  function renderRoster() {
    const filtered = roster.filter(w => {
      if (activeFilter !== "all" && w.status !== activeFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q);
      }
      return true;
    });

    if (filtered.length === 0) {
      rosterEl.innerHTML = `
        <div style="text-align:center;padding:40px 0;color:var(--text-dim);">
          <div style="font-size:2rem;margin-bottom:8px;">🔍</div>
          <div style="font-size:0.88rem;">No workers found</div>
        </div>
      `;
      return;
    }

    rosterEl.innerHTML = filtered.map(w => {
      const cls = getStatusClass(w.status);
      const initials = getInitials(w.name);
      const scoreCls = getScoreClass(w.overallScore);
      const completedCount = Object.values(w.modules).filter(m => m.status === "completed").length;

      const moduleRows = MODULE_CATALOG.map(mod => {
        const m = w.modules[mod.id] || { stage: 0, score: 0, status: "locked" };
        let badgeCls, label;
        if (m.status === "completed") { badgeCls = "completed"; label = `${m.score}%`; }
        else if (m.status === "in_progress") { badgeCls = "progress"; label = `Stage ${m.stage}/3`; }
        else { badgeCls = "locked"; label = "Locked"; }
        return `
          <div class="module-score-row">
            <span class="module-score-icon">${mod.icon}</span>
            <span class="module-score-name">${esc(mod.title)}</span>
            <span class="module-score-badge module-score-badge--${badgeCls}">${label}</span>
          </div>
        `;
      }).join("");

      return `
        <div class="worker-card" data-worker-id="${esc(w.id)}">
          <div class="worker-card-header">
            <div class="worker-avatar worker-avatar--${cls}">${initials}</div>
            <div class="worker-info">
              <div class="worker-name">${esc(w.name)}</div>
              <div class="worker-role">${esc(w.id)} · ${esc(w.role)} · ${completedCount}/6 modules</div>
            </div>
            <div class="status-badge status-badge--${cls}">${getStatusLabel(w.status)}</div>
          </div>
          <div class="worker-score-row">
            <div class="score-track">
              <div class="score-fill score-fill--${scoreCls}" style="width:${w.overallScore}%"></div>
            </div>
            <span class="score-value">${w.overallScore}%</span>
          </div>
          <div class="worker-detail">
            <div class="module-scores">
              ${moduleRows}
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Expand/collapse
    rosterEl.querySelectorAll(".worker-card").forEach(card => {
      card.addEventListener("click", () => {
        card.classList.toggle("expanded");
      });
    });
  }

  renderRoster();

  // Filter pills
  container.querySelectorAll(".filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.filter;
      renderRoster();
    });
  });

  // Search
  container.querySelector("#search-bar").addEventListener("input", (e) => {
    searchTerm = e.target.value;
    renderRoster();
  });

  // Logout
  container.querySelector("#sup-logout").addEventListener("click", onLogout);
}
