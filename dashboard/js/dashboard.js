// SafeAR Admin Compliance Dashboard Client
// Minimalist, mobile-first industrial compliance reporting

// determine backend api base url
function getApiBaseUrl() {
  if (typeof window !== "undefined" && window.location) {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get("api");
    if (fromParam) return fromParam.replace(/\/+$/, "");

    // dev server port 5174 -> backend port 3000
    if (window.location.port === "5174") {
      return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
  }
  return "";
}

// format iso timestamp for human reading
function formatTimestamp(isoStr) {
  if (!isoStr) return "Never";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_e) {
    return isoStr;
  }
}

// fetch compliance metrics from backend
async function fetchComplianceMetrics({ baseUrl = getApiBaseUrl(), timeoutMs = 8000 } = {}) {
  const fetchHandle = (typeof window !== "undefined" && window.fetch)
    ? window.fetch
    : (typeof globalThis !== "undefined" ? globalThis.fetch : null);

  if (!fetchHandle) {
    throw new Error("fetch API unavailable in this environment");
  }

  const AbortCtrl = (typeof window !== "undefined" && window.AbortController) || (typeof globalThis !== "undefined" ? globalThis.AbortController : null);
  const controller = AbortCtrl ? new AbortCtrl() : null;
  const timer = (controller && typeof setTimeout === "function")
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const url = `${baseUrl}/api/dashboard/compliance`;
    const res = await fetchHandle(url, {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: "application/json" }
    });

    if (timer && typeof clearTimeout === "function") clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data || typeof data !== "object" || !data.summary) {
      throw new Error("Malformed compliance metrics response");
    }

    return data;
  } catch (err) {
    if (timer && typeof clearTimeout === "function") clearTimeout(timer);
    throw err;
  }
}

// render loading state
function renderLoading(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div class="brand-title">🛡️ SafeAR <span class="brand-badge">Compliance</span></div>
      </header>
      <div class="state-card">
        <div class="state-icon">⏳</div>
        <div class="state-title">Loading Compliance Ledger</div>
        <div class="state-desc">Querying worker assessments, mine registries, and certification status...</div>
      </div>
    </div>
  `;
}

// render error or offline state
function renderError(container, error, onRetry) {
  if (!container) return;
  const msg = error && error.message ? error.message : "Backend unreachable";
  container.innerHTML = `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div class="brand-title">🛡️ SafeAR <span class="brand-badge">Compliance</span></div>
      </header>
      <div class="state-card">
        <div class="state-icon">⚠️</div>
        <div class="state-title">Compliance Data Unavailable</div>
        <div class="state-desc">${msg}. Ensure the SafeAR backend server is running on port 3000.</div>
        <button id="retry-fetch-btn" class="refresh-btn" style="margin-top:0.75rem;">🔄 Retry Connection</button>
      </div>
    </div>
  `;

  const btn = container.querySelector("#retry-fetch-btn");
  if (btn && typeof onRetry === "function") {
    btn.addEventListener("click", onRetry);
  }
}

// render empty state when 0 workers exist
function renderEmpty(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div class="brand-title">🛡️ SafeAR <span class="brand-badge">Compliance</span></div>
      </header>
      <div class="state-card">
        <div class="state-icon">📋</div>
        <div class="state-title">No Workers Registered</div>
        <div class="state-desc">The database contains zero worker records. Seed the database or enroll workers to view compliance metrics.</div>
      </div>
    </div>
  `;
}

// render primary dashboard view
function renderDashboard(container, data, { onRefresh } = {}) {
  if (!container || !data) return;

  const { summary, modules = [], mines = [], contractors = [], roster = [], attentionItems = [], recentActivity = [], generatedAt } = data;

  if (summary.totalWorkers === 0 && roster.length === 0) {
    renderEmpty(container);
    return;
  }

  // 1. KPI cards markup
  const kpiMarkup = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Workforce Total</span>
        <span class="kpi-value">${summary.totalWorkers}</span>
        <span class="kpi-subtext">Registered mine workers</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Fully Compliant</span>
        <span class="kpi-value success">${summary.fullyCompliantWorkers}</span>
        <span class="kpi-subtext">Passed all required modules</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Compliance Rate</span>
        <span class="kpi-value accent">${summary.complianceRate}%</span>
        <span class="kpi-subtext">${summary.partiallyCompliantWorkers} in progress, ${summary.nonCompliantWorkers} pending</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Certifications</span>
        <span class="kpi-value ${summary.certifiedWorkers > 0 ? "success" : "warning"}">${summary.certifiedWorkers}</span>
        <span class="kpi-subtext">${summary.expiringSoonCertificates} expiring soon</span>
      </div>
    </div>
  `;

  // 2. Training Modules Breakdown markup
  const modulesMarkup = `
    <section class="dashboard-section">
      <div class="section-title">
        <span>Training Modules Performance</span>
        <span class="section-count">${modules.length} Modules</span>
      </div>
      <div class="module-grid">
        ${modules.map((m) => {
          const rate = m.completionRate || 0;
          const isHigh = rate >= 70;
          return `
            <div class="module-card">
              <div class="module-card-header">
                <span class="module-card-title">${m.title}</span>
                <span class="status-badge ${isHigh ? "status-compliant" : "status-progress"}">${rate}% Pass</span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill ${isHigh ? "high" : ""}" style="width: ${Math.min(100, rate)}%;"></div>
              </div>
              <div class="module-stats-row">
                <span>Unique Passed: <strong>${m.uniqueWorkersPassed} / ${summary.totalWorkers}</strong></span>
                <span>Total Attempts: <strong>${m.totalAttempts}</strong></span>
                <span>Avg Score: <strong>${m.averageScore !== null ? m.averageScore + "%" : "N/A"}</strong></span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;

  // 3. Worker Roster Table markup
  const rosterMarkup = `
    <section class="dashboard-section">
      <div class="section-title">
        <span>Worker Compliance Roster</span>
        <div class="filter-row">
          <input type="text" id="roster-search" class="filter-input" placeholder="Filter by worker, mine, contractor..." aria-label="Filter workers">
        </div>
      </div>
      <div class="table-responsive">
        <table class="compliance-table mobile-cards" id="roster-table">
          <thead>
            <tr>
              <th>Worker ID & Name</th>
              <th>Assigned Mine</th>
              <th>Contractor</th>
              <th>Fire Response</th>
              <th>Gas Leak Protocol</th>
              <th>Overall Status</th>
            </tr>
          </thead>
          <tbody id="roster-tbody">
            ${roster.map((w) => {
              const fire = w.modules["fire-response"] || {};
              const gas = w.modules["gas-leak"] || {};

              const renderModPill = (mod) => {
                if (mod.passed) {
                  return `<span class="status-badge status-compliant">✔ ${mod.bestScore || 100}%</span>`;
                }
                if (mod.attemptsCount > 0) {
                  return `<span class="status-badge status-noncompliant">✖ Failed (${mod.bestScore || 0}%)</span>`;
                }
                return `<span class="status-badge status-neutral">— None</span>`;
              };

              let statusBadge = '<span class="status-badge status-noncompliant">Non-Compliant</span>';
              if (w.overallStatus === "compliant") {
                statusBadge = '<span class="status-badge status-compliant">✔ Compliant</span>';
              } else if (w.overallStatus === "in_progress") {
                statusBadge = '<span class="status-badge status-progress">⏳ In Progress</span>';
              }

              return `
                <tr class="roster-row" data-search="${(w.workerId + " " + w.name + " " + w.mineName + " " + w.contractorName).toLowerCase()}">
                  <td data-label="Worker"><strong>${w.name}</strong> <span style="font-size:0.75rem;color:var(--color-text-dim);">(${w.workerId})</span></td>
                  <td data-label="Mine">${w.mineName}</td>
                  <td data-label="Contractor">${w.contractorName}</td>
                  <td data-label="Fire Response">${renderModPill(fire)}</td>
                  <td data-label="Gas Protocol">${renderModPill(gas)}</td>
                  <td data-label="Status">${statusBadge}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  // 4. Sector & Attention Split Section
  const sectorMarkup = `
    <div class="two-col-grid">
      <!-- Mine Compliance -->
      <section class="dashboard-section">
        <div class="section-title">
          <span>Mine Operations</span>
          <span class="section-count">${mines.length} Sites</span>
        </div>
        <div class="table-responsive">
          <table class="compliance-table mobile-cards">
            <thead>
              <tr>
                <th>Mine Name</th>
                <th>District</th>
                <th>Workforce</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              ${mines.map((m) => `
                <tr>
                  <td data-label="Mine"><strong>${m.name}</strong></td>
                  <td data-label="District">${m.district}</td>
                  <td data-label="Workforce">${m.totalWorkers} workers</td>
                  <td data-label="Compliance">
                    <span class="status-badge ${m.complianceRate >= 50 ? "status-compliant" : "status-progress"}">${m.complianceRate}%</span>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Contractor Compliance -->
      <section class="dashboard-section">
        <div class="section-title">
          <span>Contractor Compliance</span>
          <span class="section-count">${contractors.length} Contractors</span>
        </div>
        <div class="table-responsive">
          <table class="compliance-table mobile-cards">
            <thead>
              <tr>
                <th>Contractor</th>
                <th>Assigned Workers</th>
                <th>Compliant</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              ${contractors.map((c) => `
                <tr>
                  <td data-label="Contractor"><strong>${c.name}</strong></td>
                  <td data-label="Workforce">${c.totalWorkers}</td>
                  <td data-label="Compliant">${c.compliantWorkers}</td>
                  <td data-label="Rate">
                    <span class="status-badge ${c.complianceRate >= 50 ? "status-compliant" : "status-progress"}">${c.complianceRate}%</span>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  // 5. Attention Items List
  const attentionMarkup = attentionItems.length > 0 ? `
    <section class="dashboard-section">
      <div class="section-title">
        <span>Attention & Incomplete Training</span>
        <span class="section-count" style="color:var(--color-warning);">${attentionItems.length} Actions</span>
      </div>
      <div class="attention-list">
        ${attentionItems.map((item) => `
          <div class="attention-item ${item.severity === "danger" ? "danger" : ""}">
            <span><strong>${item.workerName}</strong> (${item.workerId}) — ${item.message}</span>
            <span class="attention-meta">${item.mineName || ""}</span>
          </div>
        `).join("")}
      </div>
    </section>
  ` : "";

  // 6. Recent Sync Activity
  const recentMarkup = recentActivity.length > 0 ? `
    <section class="dashboard-section">
      <div class="section-title">
        <span>Recent Assessment Sync Activity</span>
        <span class="section-count">${recentActivity.length} Recent</span>
      </div>
      <div class="table-responsive">
        <table class="compliance-table mobile-cards">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Worker</th>
              <th>Module</th>
              <th>Score</th>
              <th>Outcome</th>
              <th>AR Mode</th>
            </tr>
          </thead>
          <tbody>
            ${recentActivity.map((act) => `
              <tr>
                <td data-label="Timestamp">${formatTimestamp(act.completedAt)}</td>
                <td data-label="Worker"><strong>${act.workerName}</strong></td>
                <td data-label="Module">${act.moduleTitle}</td>
                <td data-label="Score">${act.serverPercentage}%</td>
                <td data-label="Outcome">
                  <span class="status-badge ${act.serverPassed ? "status-compliant" : "status-noncompliant"}">
                    ${act.serverPassed ? "Passed" : "Failed"}
                  </span>
                </td>
                <td data-label="AR Mode">Tier ${act.arTier || 2}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  ` : "";

  // assemble full dashboard
  container.innerHTML = `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div class="header-brand">
          <div class="brand-title">🛡️ SafeAR <span class="brand-badge">Compliance</span></div>
          <button id="refresh-dashboard-btn" class="refresh-btn" aria-label="Refresh compliance metrics">🔄 Refresh</button>
        </div>
        <div class="header-meta">
          <span>DGMS Industrial Safety Audit Ledger</span>
          <span>Last Synced: <strong>${formatTimestamp(generatedAt)}</strong></span>
        </div>
      </header>

      <div class="notice-banner notice-info">
        <strong>ℹ Compliance Note:</strong> Training pass marks and checkpoint evidence are authoritatively logged in SQLite. Certificate cryptographic QR issuance is pending backend signing key rollout.
      </div>

      ${kpiMarkup}
      ${modulesMarkup}
      ${rosterMarkup}
      ${sectorMarkup}
      ${attentionMarkup}
      ${recentMarkup}
    </div>
  `;

  // attach refresh listener
  const refreshBtn = container.querySelector("#refresh-dashboard-btn");
  if (refreshBtn && typeof onRefresh === "function") {
    refreshBtn.addEventListener("click", onRefresh);
  }

  // attach roster search filter
  const searchInput = container.querySelector("#roster-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = (e.target.value || "").toLowerCase().trim();
      const rows = container.querySelectorAll(".roster-row");
      rows.forEach((row) => {
        const text = row.getAttribute("data-search") || "";
        row.style.display = text.includes(q) ? "" : "none";
      });
    });
  }
}

// controller function to initialize and mount dashboard
async function loadComplianceMetrics(containerId = "dashboard-app", options = {}) {
  const container = typeof document !== "undefined"
    ? (typeof containerId === "string" ? document.getElementById(containerId) : containerId)
    : null;

  if (!container) return;

  renderLoading(container);

  const reload = () => loadComplianceMetrics(container, options);

  try {
    const data = await fetchComplianceMetrics(options);
    renderDashboard(container, data, { onRefresh: reload });
  } catch (err) {
    renderError(container, err, reload);
  }
}

// auto-boot in browser
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadComplianceMetrics());
  } else {
    loadComplianceMetrics();
  }
}

export {
  getApiBaseUrl,
  formatTimestamp,
  fetchComplianceMetrics,
  renderLoading,
  renderError,
  renderEmpty,
  renderDashboard,
  loadComplianceMetrics
};
