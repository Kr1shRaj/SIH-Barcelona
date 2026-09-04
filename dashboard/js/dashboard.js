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
    // history, proxy logs and the backend access log
    if (adminKey) {
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

// render the marketing landing page that gates the admin dashboard.
// matches the SafeAR hero mockup: navbar, hero image, features, footer.
// the sign-in button opens a modal overlay for admin key entry.
function renderLandingPage(container, { onSignIn, message } = {}) {
  if (!container) return;

  // reset body padding so the landing page is truly full-bleed
  if (typeof document !== "undefined" && document.body) {
    document.body.style.padding = "0";
    document.body.style.background = "#0a0a0a";
  }

  container.innerHTML = `
    <div class="landing-page">
      <section class="landing-hero">
        <div class="hero-bg">
          <img src="./img/hero-bg.jpg" alt="Industrial safety training with fire extinguisher at a refinery" />
        </div>

        <nav class="landing-nav">
          <a href="#" class="nav-brand">
            <img src="./img/logo.png" alt="SafeAR Logo" class="nav-brand-logo" />
            <div class="nav-brand-text">
              <span class="nav-brand-name">Safe<span>AR</span></span>
              <span class="nav-brand-subtitle">सुरक्षित कर्मचारी, समृद्ध भारत</span>
            </div>
          </a>

          <ul class="nav-links">
            <li><a href="#" class="active">Home</a></li>
            <li><a href="#">About</a></li>
            <li><a href="#">Features</a></li>
            <li><a href="#">Impact</a></li>
            <li><a href="#">Contact</a></li>
          </ul>

          <div class="nav-right">
            <button id="landing-signin-btn" class="nav-signin-btn" type="button">Sign In →</button>
            <div class="nav-govt-badge">
              <div class="nav-govt-emblem">🏛️</div>
              <div class="nav-govt-text">For a Safer and Stronger India</div>
            </div>
          </div>
        </nav>

        <div class="hero-content">
          <div class="hero-eyebrow">Real Training. Real Impact</div>
          <h1 class="hero-heading">
            Hands-On<br>Safety Training<br>with <span class="highlight">AR</span>
          </h1>
          <div class="hero-tagline-row">
            <div class="hero-tagline-dash"></div>
            <div class="hero-tagline">सुरक्षा की तैयारी, बेहतर कल की जिम्मेदारी</div>
          </div>
          <button id="landing-cta-btn" class="hero-cta-btn" type="button">Get Started →</button>

          <div class="hero-features">
            <div class="feature-pill">
              <div class="feature-icon fire">🔥</div>
              <div class="feature-text">
                <div class="feature-title">Fire Safety</div>
                <div class="feature-desc">Use equipment with confidence</div>
              </div>
            </div>
            <div class="feature-pill">
              <div class="feature-icon gas">🛡️</div>
              <div class="feature-text">
                <div class="feature-title">Gas Leak Response</div>
                <div class="feature-desc">Identify risks and act quickly</div>
              </div>
            </div>
            <div class="feature-pill">
              <div class="feature-icon emergency">✅</div>
              <div class="feature-text">
                <div class="feature-title">Emergency Preparedness</div>
                <div class="feature-desc">Be ready for real situations</div>
              </div>
            </div>
          </div>
        </div>

        <footer class="landing-footer">
          <div class="footer-tagline">Skilled People. Safer Workplaces. A Stronger India.</div>
        </footer>
      </section>
    </div>
  `;

  // bind sign-in interactions
  if (typeof document !== "undefined") {
    const openSignIn = () => {
      // create modal overlay
      const overlay = document.createElement("div");
      overlay.className = "signin-overlay";
      overlay.id = "signin-overlay";
      overlay.innerHTML = `
        <div class="signin-card" style="position:relative;">
          <button class="signin-close-btn" id="signin-close" type="button">&times;</button>
          <div class="signin-logo-wrap">
            <img src="./img/logo.png" alt="SafeAR Logo" class="signin-modal-logo" />
          </div>
          <div class="signin-title">Admin Dashboard Access</div>
          <div class="signin-desc">${esc(message || "Enter your admin key to access the compliance dashboard.")}</div>
          <form class="signin-form" id="signin-form" autocomplete="off">
            <input
              type="password"
              class="signin-input"
              id="signin-key-input"
              placeholder="Enter admin key"
              aria-label="Admin key"
              autocomplete="off"
              spellcheck="false" />
            <button type="submit" class="signin-submit-btn" id="signin-submit">Unlock Dashboard</button>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = document.getElementById("signin-key-input");
      const form = document.getElementById("signin-form");
      const closeBtn = document.getElementById("signin-close");

      if (input) {
        setTimeout(() => input.focus(), 100);
      }

      const handleSubmit = (ev) => {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        const entered = input && typeof input.value === "string" ? input.value.trim() : "";
        if (entered.length === 0) return;
        if (input) input.value = "";
        // remove overlay
        const el = document.getElementById("signin-overlay");
        if (el) el.remove();
        // restore body padding for dashboard view
        if (document.body) {
          document.body.style.padding = "";
          document.body.style.background = "";
        }
        if (typeof onSignIn === "function") onSignIn(entered);
      };

      if (form) form.addEventListener("submit", handleSubmit);
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          const el = document.getElementById("signin-overlay");
          if (el) el.remove();
        });
      }

      // close on backdrop click
      overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) {
          overlay.remove();
        }
      });
    };

    const signinBtn = container.querySelector("#landing-signin-btn");
    const ctaBtn = container.querySelector("#landing-cta-btn");
    if (signinBtn) signinBtn.addEventListener("click", openSignIn);
    if (ctaBtn) ctaBtn.addEventListener("click", openSignIn);
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

  // show the landing page when there is no admin key yet
  if (!options.adminKey && !getAdminKey()) {
    renderLandingPage(container, { onSignIn: useKey });
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
      renderLandingPage(container, {
        onSignIn: useKey,
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
  formatTimestamp,
  fetchComplianceMetrics,
  renderLoading,
  renderError,
  renderEmpty,
  renderAuthRequired,
  renderLandingPage,
  renderDashboard,
  loadComplianceMetrics,
  getAdminKey,
  setAdminKey,
  clearAdminKey,
  esc,
  num,
  ADMIN_KEY_STORAGE_KEY
};
