// SafeAR Admin Compliance Dashboard Client
// Minimalist, mobile-first industrial compliance reporting

const ADMIN_KEY_STORAGE_KEY = "safear_admin_key";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
};

// escape everything the api hands us before it becomes markup. every attribute in
// this file is double quoted, so one helper covers text and attribute context both.
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// numbers are the only values allowed into markup unescaped, so prove it is one
function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// session storage only. the key dies with the tab, never reaches local storage,
// never reaches the url, and is never written into this file.
function _sessionStore() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
    if (typeof globalThis !== "undefined" && globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch (_e) {
    return null;
  }
  return null;
}

// read the admin key for this tab, null when nobody has entered one yet
function getAdminKey() {
  try {
    const store = _sessionStore();
    const key = store ? store.getItem(ADMIN_KEY_STORAGE_KEY) : null;
    return key && key.length > 0 ? key : null;
  } catch (_e) {
    return null;
  }
}

// keep the key for this tab only, and report whether it stuck
function setAdminKey(key) {
  if (typeof key !== "string" || key.trim().length === 0) return false;
  try {
    const store = _sessionStore();
    if (!store) return false;
    store.setItem(ADMIN_KEY_STORAGE_KEY, key.trim());
    return true;
  } catch (_e) {
    return false;
  }
}

// forget the key, used whenever the server says it is not good
function clearAdminKey() {
  try {
    const store = _sessionStore();
    if (store) store.removeItem(ADMIN_KEY_STORAGE_KEY);
  } catch (_e) {
    // nothing to forget
  }
}

// hosts that cannot carry data off this machine, so a key sent there is not leaked
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// the dev pairing: dashboard on 5174, backend on 3000 of the same host
const DEV_DASHBOARD_PORT = "5174";
const DEV_BACKEND_PORT = "3000";

// where this page is served from, null outside a browser
function _pageOrigin() {
  if (typeof window === "undefined" || !window.location) return null;
  const { protocol, hostname, port } = window.location;
  if (!protocol || !hostname) return null;
  return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
}

// the one backend the 5174 dev server is allowed to imply, same host every time
function _devBackendOrigin() {
  if (typeof window === "undefined" || !window.location) return null;
  const { protocol, hostname, port } = window.location;
  if (port !== DEV_DASHBOARD_PORT || !hostname) return null;
  return `${protocol}//${hostname}:${DEV_BACKEND_PORT}`;
}

// strip trailing slashes so "http://h:3000/" and "http://h:3000" compare equal
function _normalizeBase(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

// The single trust decision for the admin key. Everything that sends the key asks
// this and nothing else, because ?api= is attacker-reachable: a crafted link on an
// authenticated dashboard would otherwise hand x-admin-key, and with it every
// worker's name, mine, scores and certificates, to whatever host the link names.
//
// Origins are compared whole, parsed by URL. No substring or startsWith matching —
// "https://safear.example.attacker.tld" must never pass for "safear.example".
function isTrustedApiOrigin(candidate) {
  const base = _normalizeBase(candidate);

  // "" is same origin, which is the default and always ours
  if (base === "") return true;

  let parsed;
  try {
    parsed = new URL(base);
  } catch (_e) {
    return false;
  }

  // only real web schemes, never javascript: or data:
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // exactly this page's origin, scheme and port included
  const pageOrigin = _pageOrigin();
  if (pageOrigin && parsed.origin === pageOrigin) return true;

  // the 5174 -> 3000 dev pairing, derived from location so the host is never
  // attacker supplied
  const devOrigin = _devBackendOrigin();
  if (devOrigin && parsed.origin === devOrigin) return true;

  // a loopback address reaches only this machine, so it cannot exfiltrate. this is
  // what keeps ?api=http://localhost:3100 usable while developing.
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return true;

  return false;
}

// determine backend api base url
function getApiBaseUrl() {
  if (typeof window !== "undefined" && window.location) {
    const params = new URLSearchParams(window.location.search);
    const fromParam = _normalizeBase(params.get("api"));

    // an untrusted ?api= is dropped, never persisted, and we fall through to the
    // backend this page would have used anyway
    if (fromParam && isTrustedApiOrigin(fromParam)) {
      return fromParam;
    }

    // dev server port 5174 -> backend port 3000
    const devOrigin = _devBackendOrigin();
    if (devOrigin) return devOrigin;
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
async function fetchComplianceMetrics({ baseUrl = getApiBaseUrl(), timeoutMs = 8000, adminKey = getAdminKey() } = {}) {
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
    const headers = { Accept: "application/json" };

    // the key travels in a header, never in the url, so it stays out of browser
    // history, proxy logs and the backend access log.
    //
    // the trust check is repeated here on purpose. getApiBaseUrl already refuses an
    // untrusted ?api=, but this is the line that actually attaches the credential,
    // so it is the line that must be impossible to get wrong however baseUrl arrived.
    if (adminKey && isTrustedApiOrigin(baseUrl)) {
      headers["x-admin-key"] = adminKey;
    }

    const res = await fetchHandle(url, {
      signal: controller ? controller.signal : undefined,
      headers
    });

    if (timer && typeof clearTimeout === "function") clearTimeout(timer);

    // 401 is not a generic failure. the caller has to re-prompt, so mark it.
    if (res.status === 401) {
      const authErr = new Error("Admin key missing or not accepted");
      authErr.code = "unauthorized";
      throw authErr;
    }

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
        <div class="state-desc">${esc(msg)}. Ensure the SafeAR backend server is running on port 3000.</div>
        <button id="retry-fetch-btn" class="refresh-btn" style="margin-top:0.75rem;">🔄 Retry Connection</button>
      </div>
    </div>
  `;

  const btn = container.querySelector("#retry-fetch-btn");
  if (btn && typeof onRetry === "function") {
    btn.addEventListener("click", onRetry);
  }
}

// ask for the admin key. same state-card shell as every other non-data view.
function renderAuthRequired(container, { onSubmit, message } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div class="brand-title">🛡️ SafeAR <span class="brand-badge">Compliance</span></div>
      </header>
      <div class="state-card">
        <div class="state-icon">🔒</div>
        <div class="state-title">Admin Key Required</div>
        <div class="state-desc">${esc(message || "This ledger holds worker records. Enter the admin key to continue.")}</div>
        <form id="admin-key-form" autocomplete="off" style="margin-top:0.9rem;display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:center;">
          <input
            type="password"
            id="admin-key-input"
            class="filter-input"
            placeholder="Admin key"
            aria-label="Admin key"
            autocomplete="off"
            spellcheck="false">
          <button type="submit" id="admin-key-submit" class="refresh-btn">Unlock</button>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector("#admin-key-form");
  const input = container.querySelector("#admin-key-input");
  const submit = container.querySelector("#admin-key-submit");

  // the value is read straight out of the field and handed on. it is never logged,
  // never put in the dom, and never added to the url.
  const hand = (ev) => {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    const entered = input && typeof input.value === "string" ? input.value.trim() : "";
    if (entered.length === 0) return;
    if (input) input.value = "";
    if (typeof onSubmit === "function") onSubmit(entered);
  };

  if (form && typeof form.addEventListener === "function") form.addEventListener("submit", hand);
  if (submit && typeof submit.addEventListener === "function") submit.addEventListener("click", hand);
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
        <span class="kpi-value">${num(summary.totalWorkers)}</span>
        <span class="kpi-subtext">Registered mine workers</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Fully Compliant</span>
        <span class="kpi-value success">${num(summary.fullyCompliantWorkers)}</span>
        <span class="kpi-subtext">Passed all required modules</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Compliance Rate</span>
        <span class="kpi-value accent">${num(summary.complianceRate)}%</span>
        <span class="kpi-subtext">${num(summary.partiallyCompliantWorkers)} in progress, ${num(summary.nonCompliantWorkers)} pending</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Certifications</span>
        <span class="kpi-value ${summary.certifiedWorkers > 0 ? "success" : "warning"}">${num(summary.certifiedWorkers)}</span>
        <span class="kpi-subtext">${num(summary.expiringSoonCertificates)} expiring soon</span>
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
          const rate = num(m.completionRate);
          const isHigh = rate >= 70;
          return `
            <div class="module-card">
              <div class="module-card-header">
                <span class="module-card-title">${esc(m.title)}</span>
                <span class="status-badge ${isHigh ? "status-compliant" : "status-progress"}">${rate}% Pass</span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill ${isHigh ? "high" : ""}" style="width: ${Math.min(100, rate)}%;"></div>
              </div>
              <div class="module-stats-row">
                <span>Unique Passed: <strong>${num(m.uniqueWorkersPassed)} / ${num(summary.totalWorkers)}</strong></span>
                <span>Total Attempts: <strong>${num(m.totalAttempts)}</strong></span>
                <span>Avg Score: <strong>${m.averageScore !== null && m.averageScore !== undefined ? num(m.averageScore) + "%" : "N/A"}</strong></span>
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
                  return `<span class="status-badge status-compliant">✔ ${num(mod.bestScore || 100)}%</span>`;
                }
                if (mod.attemptsCount > 0) {
                  return `<span class="status-badge status-noncompliant">✖ Failed (${num(mod.bestScore || 0)}%)</span>`;
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
                <tr class="roster-row" data-search="${esc(String(w.workerId) + " " + String(w.name) + " " + String(w.mineName) + " " + String(w.contractorName)).toLowerCase()}">
                  <td data-label="Worker"><strong>${esc(w.name)}</strong> <span style="font-size:0.75rem;color:var(--color-text-dim);">(${esc(w.workerId)})</span></td>
                  <td data-label="Mine">${esc(w.mineName)}</td>
                  <td data-label="Contractor">${esc(w.contractorName)}</td>
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
                  <td data-label="Mine"><strong>${esc(m.name)}</strong></td>
                  <td data-label="District">${esc(m.district)}</td>
                  <td data-label="Workforce">${num(m.totalWorkers)} workers</td>
                  <td data-label="Compliance">
                    <span class="status-badge ${m.complianceRate >= 50 ? "status-compliant" : "status-progress"}">${num(m.complianceRate)}%</span>
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
                  <td data-label="Contractor"><strong>${esc(c.name)}</strong></td>
                  <td data-label="Workforce">${num(c.totalWorkers)}</td>
                  <td data-label="Compliant">${num(c.compliantWorkers)}</td>
                  <td data-label="Rate">
                    <span class="status-badge ${c.complianceRate >= 50 ? "status-compliant" : "status-progress"}">${num(c.complianceRate)}%</span>
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
            <span><strong>${esc(item.workerName)}</strong> (${esc(item.workerId)}) — ${esc(item.message)}</span>
            <span class="attention-meta">${esc(item.mineName || "")}</span>
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
                <td data-label="Timestamp">${esc(formatTimestamp(act.completedAt))}</td>
                <td data-label="Worker"><strong>${esc(act.workerName)}</strong></td>
                <td data-label="Module">${esc(act.moduleTitle)}</td>
                <td data-label="Score">${num(act.serverPercentage)}%</td>
                <td data-label="Outcome">
                  <span class="status-badge ${act.serverPassed ? "status-compliant" : "status-noncompliant"}">
                    ${act.serverPassed ? "Passed" : "Failed"}
                  </span>
                </td>
                <td data-label="AR Mode">Tier ${num(act.arTier || 2, 2)}</td>
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
          <span>Last Synced: <strong>${esc(formatTimestamp(generatedAt))}</strong></span>
        </div>
      </header>

      <div class="notice-banner notice-info">
        <strong>ℹ Compliance Note:</strong> Training pass marks and checkpoint evidence are authoritatively logged in SQLite. Certificates are signed with Ed25519 and issued as verifiable QR credentials.
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

  const reload = () => loadComplianceMetrics(container, options);

  // whoever enters a key gets it kept for this tab, then we retry straight away
  const useKey = (entered) => {
    setAdminKey(entered);
    return loadComplianceMetrics(container, options);
  };

  // nothing is fetched before there is a key to send, so an unauthenticated
  // visitor is asked rather than shown a failed request
  if (!options.adminKey && !getAdminKey()) {
    renderAuthRequired(container, { onSubmit: useKey });
    return;
  }

  renderLoading(container);

  try {
    const data = await fetchComplianceMetrics(options);
    renderDashboard(container, data, { onRefresh: reload });
  } catch (err) {
    // a rejected key is worthless, so drop it and ask again rather than looping
    if (err && err.code === "unauthorized") {
      clearAdminKey();
      renderAuthRequired(container, {
        onSubmit: useKey,
        message: "That key was not accepted. Check it and try again."
      });
      return;
    }
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
  isTrustedApiOrigin,
  formatTimestamp,
  fetchComplianceMetrics,
  renderLoading,
  renderError,
  renderEmpty,
  renderAuthRequired,
  renderDashboard,
  loadComplianceMetrics,
  getAdminKey,
  setAdminKey,
  clearAdminKey,
  esc,
  num,
  ADMIN_KEY_STORAGE_KEY
};
