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
// ============================================================================
// RENDER LAYER — SafeAR Admin / Operations
//
// The administrator's view of the same system the workers train in, so it is
// built from the trainee app's own tokens (css/dashboard.css) rather than a
// dashboard template: graphite ground, the logo's navy and safety yellow, and
// yellow spent only on what an administrator should look at next.
//
// Every number on this page comes from GET /api/dashboard/compliance. Nothing is
// seeded, sampled or assumed. Where the API does not carry a field, the cell says
// so instead of showing a plausible-looking guess — see UNAVAILABLE below.
// ============================================================================

// what the compliance payload does not carry, said once so every caller agrees
const UNAVAILABLE = '<span class="unavailable" title="Not carried by the compliance API">—</span>';

// the brand lockup, on the white plate the logo was drawn for
const BRAND_MARK = `
  <span class="brand-plate"><img src="./img/safear-logo.png" alt="SafeAR" width="471" height="112" /></span>
  <span class="brand-role">
    <span class="brand-role__name">Admin</span>
    <span class="brand-role__sub">Operations</span>
  </span>
`;

// a whole-screen state: loading, error, sign-in, empty ledger
function _stateScreen(inner) {
  return `
    <div class="state-screen">
      <div class="admin-brand" style="border:none;background:none;padding:0;">${BRAND_MARK}</div>
      <div class="state-card">${inner}</div>
    </div>
  `;
}

function renderLoading(container) {
  if (!container) return;
  container.innerHTML = _stateScreen(`
    <div class="state-title">Loading Compliance Ledger</div>
    <div class="state-desc">Reading worker assessments, module results and certification status from the backend.</div>
    <div class="meter" style="margin-top:1rem;"><div class="meter__fill" style="width:35%;"></div></div>
  `);
}

function renderError(container, error, onRetry) {
  if (!container) return;
  const msg = error && error.message ? error.message : "Backend unreachable";
  container.innerHTML = _stateScreen(`
    <div class="state-title">Compliance Data Unavailable</div>
    <div class="state-desc">${esc(msg)}. The ledger is served by the SafeAR backend — check that it is running and reachable.</div>
    <div class="state-form"><button id="retry-fetch-btn" class="btn btn--primary" type="button">Retry Connection</button></div>
  `);

  const btn = container.querySelector("#retry-fetch-btn");
  if (btn && typeof onRetry === "function") {
    btn.addEventListener("click", onRetry);
  }
}

// The admin sign-in. This replaced a full marketing landing page — hero image,
// Home/About/Features/Contact links that went nowhere, and a webfont pulled from
// a CDN — which was what an administrator met before they could see anything.
// An operations tool asks for the key and gets out of the way.
//
// The key is read from the form and handed straight to the caller. It is never
// written into the DOM, the URL or localStorage.
function renderAuthRequired(container, { onSubmit, message } = {}) {
  if (!container) return;
  container.innerHTML = _stateScreen(`
    <div class="state-title">Sign In</div>
    <div class="state-desc">${esc(message || "This ledger holds named worker records, scores and certificates. Enter the admin key to continue.")}</div>
    <form id="admin-key-form" class="state-form" autocomplete="off">
      <input type="password" id="admin-key-input" class="input" placeholder="Admin key"
        aria-label="Admin key" autocomplete="off" spellcheck="false">
      <button type="submit" id="admin-key-submit" class="btn btn--primary">Unlock Dashboard</button>
    </form>
    <p class="state-note">The key is kept for this browser tab only and is sent as a request header. It is never stored on this device or placed in the address bar.</p>
  `);

  const form = container.querySelector("#admin-key-form");
  const input = container.querySelector("#admin-key-input");
  if (form) {
    form.addEventListener("submit", (ev) => {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      const entered = input && typeof input.value === "string" ? input.value.trim() : "";
      if (entered.length === 0) return;
      if (input) input.value = "";
      if (typeof onSubmit === "function") onSubmit(entered);
    });
  }
  if (input && typeof input.focus === "function") {
    try { input.focus(); } catch (_e) { /* focus is a nicety, never a failure */ }
  }
}

// kept as the name the auth flow calls, so signing in has one entry point
function renderLandingPage(container, { onSignIn, message } = {}) {
  renderAuthRequired(container, { onSubmit: onSignIn, message });
}

function renderEmpty(container) {
  if (!container) return;
  container.innerHTML = _stateScreen(`
    <div class="state-title">No Workers Registered</div>
    <div class="state-desc">The backend answered, and its worker registry is empty. Nothing is shown here until real workers and attempts exist in the database.</div>
  `);
}

// ---------------------------------------------------------------- formatting

function _pct(value) {
  return value === null || value === undefined ? UNAVAILABLE : `${num(value)}%`;
}

function _outcomeBadge(passed) {
  return passed
    ? '<span class="badge badge--pass">Passed</span>'
    : '<span class="badge badge--fail">Failed</span>';
}

// one worker's standing on one module, as the ledger actually knows it
function _moduleCell(mod) {
  if (!mod || !mod.attemptsCount) {
    return '<span class="badge badge--none"><span class="dot dot--none"></span>Not started</span>';
  }
  const score = mod.bestScore === null || mod.bestScore === undefined ? UNAVAILABLE : `${num(mod.bestScore)}%`;
  if (mod.passed) {
    return `<span class="badge badge--pass"><span class="dot dot--pass"></span>${score}</span>`;
  }
  return `<span class="badge badge--fail"><span class="dot dot--fail"></span>${score}</span>`;
}

function _overallBadge(status) {
  if (status === "compliant") return '<span class="badge badge--pass">Compliant</span>';
  if (status === "in_progress") return '<span class="badge badge--progress">In Progress</span>';
  return '<span class="badge badge--none">Non-Compliant</span>';
}

function _emptyRow(colspan, title, detail) {
  return `<tr><td colspan="${colspan}"><div class="empty"><strong>${esc(title)}</strong>${esc(detail)}</div></td></tr>`;
}

// ---------------------------------------------------------------- sections

function _overviewSection(data) {
  const { summary, recentActivity = [], attentionItems = [] } = data;

  // There is deliberately no "pass rate" card. The only attempts this payload
  // carries are the ten most recent, so a rate computed here would describe that
  // sample and be read as describing every attempt. The compliance rate below is
  // the backend's own figure over the whole ledger, which is the honest one.

  const kpis = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Workforce Total</span>
        <span class="kpi-value">${num(summary.totalWorkers)}</span>
        <span class="kpi-subtext">Registered mine workers</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Training Attempts</span>
        <span class="kpi-value">${num(summary.totalAttempts)}</span>
        <span class="kpi-subtext">Graded and stored by the backend</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Fully Compliant</span>
        <span class="kpi-value success">${num(summary.fullyCompliantWorkers)}</span>
        <span class="kpi-subtext">${num(summary.partiallyCompliantWorkers)} in progress, ${num(summary.nonCompliantWorkers)} pending</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Compliance Rate</span>
        <span class="kpi-value accent">${num(summary.complianceRate)}%</span>
        <span class="kpi-subtext">Passed every required module</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Certifications</span>
        <span class="kpi-value ${summary.certifiedWorkers > 0 ? "success" : "warning"}">${num(summary.certifiedWorkers)}</span>
        <span class="kpi-subtext">${num(summary.expiringSoonCertificates)} expiring soon, ${num(summary.expiredCertificates)} expired</span>
      </div>
    </div>
  `;

  const attention = `
    <div class="panel">
      <div class="panel__head"><span>Needs Attention</span><span class="section-count">${attentionItems.length} items</span></div>
      ${attentionItems.length === 0
        ? '<div class="empty"><strong>Nothing outstanding</strong>The backend reports no expiring certificates or stalled workers.</div>'
        : `<div class="table-responsive">
            <table class="data-table data-table--stack">
              <thead><tr><th>Worker</th><th>Issue</th><th>Site</th></tr></thead>
              <tbody>
                ${attentionItems.map((item) => `
                  <tr>
                    <td data-label="Worker">
                      <span class="dot ${item.severity === "danger" ? "dot--fail" : "dot--none"}"></span>
                      ${esc(item.workerName || item.workerId || "")}
                      ${item.workerId ? `<span class="cell-id">${esc(item.workerId)}</span>` : ""}
                    </td>
                    <td data-label="Issue">${esc(item.message || "")}</td>
                    <td data-label="Site">${item.mineName ? esc(item.mineName) : UNAVAILABLE}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`}
    </div>
  `;

  const activity = `
    <div class="panel">
      <div class="panel__head">
        <span>Latest Assessment Activity</span>
        <span class="section-count">${recentActivity.length} of ${num(summary.totalAttempts)} attempts</span>
      </div>
      <div class="table-responsive">
        <table class="data-table data-table--stack">
          <thead><tr><th>Completed</th><th>Worker</th><th>Module</th><th>Score</th><th>Outcome</th></tr></thead>
          <tbody>
            ${recentActivity.length === 0
              ? _emptyRow(5, "No attempts yet", "Attempts appear here as soon as a worker syncs one from the trainee app.")
              : recentActivity.map((a) => `
                <tr>
                  <td data-label="Completed" class="num">${esc(formatTimestamp(a.completedAt))}</td>
                  <td data-label="Worker">${esc(a.workerName || a.workerId)} <span class="cell-id">${esc(a.workerId)}</span></td>
                  <td data-label="Module">${esc(a.moduleTitle || a.moduleId)}</td>
                  <td data-label="Score" class="num">${_pct(a.serverPercentage)}</td>
                  <td data-label="Outcome">${_outcomeBadge(a.serverPassed)}</td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  return kpis + `<div class="panel-row">${attention}${activity}</div>`;
}

function _workersSection(data) {
  const { roster = [], modules = [] } = data;

  // the module columns are the modules the backend reports, not two names typed
  // in here — adding a third module to the catalogue adds a column by itself
  const moduleCols = modules.map((m) => `<th>${esc(m.title)}</th>`).join("");

  const rows = roster.map((w) => {
    const cells = modules.map((m) => `<td data-label="${esc(m.title)}">${_moduleCell(w.modules ? w.modules[m.moduleId] : null)}</td>`).join("");
    const haystack = `${w.workerId} ${w.name} ${w.mineName} ${w.contractorName}`.toLowerCase();
    return `
      <tr class="roster-row" data-search="${esc(haystack)}">
        <td data-label="Worker"><strong>${esc(w.name)}</strong> <span class="cell-id">${esc(w.workerId)}</span></td>
        <td data-label="Mine">${esc(w.mineName)}</td>
        <td data-label="Contractor">${esc(w.contractorName)}</td>
        ${cells}
        <td data-label="Status">${_overallBadge(w.overallStatus)}</td>
      </tr>`;
  }).join("");

  return `
    <div class="panel">
      <div class="panel__head">
        <span>Worker Records</span>
        <input type="text" id="roster-search" class="input" style="max-width:18rem;"
          placeholder="Filter by worker, mine or contractor" aria-label="Filter workers">
      </div>
      <div class="table-responsive">
        <table class="data-table data-table--stack" id="roster-table">
          <thead><tr><th>Worker</th><th>Mine</th><th>Contractor</th>${moduleCols}<th>Status</th></tr></thead>
          <tbody id="roster-tbody">
            ${roster.length === 0
              ? _emptyRow(4 + modules.length, "No workers registered", "The backend's worker registry is empty.")
              : rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function _trainingSection(data) {
  const { modules = [], summary } = data;

  const cards = modules.map((m) => {
    const rate = num(m.completionRate);
    return `
      <div class="kpi-card">
        <span class="kpi-label">${esc(m.title)}</span>
        <span class="kpi-value">${m.averageScore === null || m.averageScore === undefined ? UNAVAILABLE : `${num(m.averageScore)}%`}</span>
        <span class="kpi-subtext">Average score across ${num(m.totalAttempts)} attempts</span>
        <div class="meter" style="margin-top:0.6rem;"><div class="meter__fill ${rate >= 70 ? "is-high" : ""}" style="width:${Math.min(100, rate)}%;"></div></div>
        <span class="kpi-subtext">${num(m.uniqueWorkersPassed)} of ${num(summary.totalWorkers)} workers passed · ${rate}%</span>
      </div>`;
  }).join("");

  return `
    ${modules.length === 0
      ? '<div class="panel"><div class="empty"><strong>No modules published</strong>The backend reports no training modules.</div></div>'
      : `<div class="kpi-grid">${cards}</div>`}
    <div class="panel">
      <div class="panel__head"><span>Module Detail</span><span class="section-count">${modules.length} modules</span></div>
      <div class="table-responsive">
        <table class="data-table data-table--stack">
          <thead><tr><th>Module</th><th>Pass Mark</th><th>Attempts</th><th>Attempted</th><th>Passed</th><th>Average</th><th>Recert</th></tr></thead>
          <tbody>
            ${modules.length === 0
              ? _emptyRow(7, "No modules published", "Nothing to report yet.")
              : modules.map((m) => `
                <tr>
                  <td data-label="Module"><strong>${esc(m.title)}</strong> <span class="cell-id">${esc(m.moduleId)}</span></td>
                  <td data-label="Pass Mark" class="num">${m.passThreshold === null || m.passThreshold === undefined ? UNAVAILABLE : `${Math.round(num(m.passThreshold) * 100)}%`}</td>
                  <td data-label="Attempts" class="num">${num(m.totalAttempts)}</td>
                  <td data-label="Attempted" class="num">${num(m.uniqueWorkersAttempted)}</td>
                  <td data-label="Passed" class="num">${num(m.uniqueWorkersPassed)}</td>
                  <td data-label="Average" class="num">${m.averageScore === null || m.averageScore === undefined ? UNAVAILABLE : `${num(m.averageScore)}%`}</td>
                  <td data-label="Recert" class="num">${m.recertMonths ? `${num(m.recertMonths)} months` : UNAVAILABLE}</td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function _assessmentsSection(data) {
  const { recentActivity = [], summary } = data;
  const shown = recentActivity.length;
  const total = num(summary.totalAttempts);

  return `
    ${shown < total
      ? `<div class="notice"><span>The compliance endpoint returns the ${shown} most recent attempts. ${total - shown} older ${total - shown === 1 ? "attempt is" : "attempts are"} counted in the totals but not listed here — a paged attempts API would be needed to show them.</span></div>`
      : ""}
    <div class="panel">
      <div class="panel__head"><span>Assessment Attempts</span><span class="section-count">${shown} shown · ${total} recorded</span></div>
      <div class="table-responsive">
        <table class="data-table data-table--stack">
          <thead><tr><th>Completed</th><th>Worker</th><th>Module</th><th>Score</th><th>Outcome</th><th>AR Mode</th><th>Language</th></tr></thead>
          <tbody>
            ${shown === 0
              ? _emptyRow(7, "No attempts recorded", "An attempt appears here once a worker finishes a module and the app syncs it.")
              : recentActivity.map((a) => `
                <tr>
                  <td data-label="Completed" class="num">${esc(formatTimestamp(a.completedAt))}</td>
                  <td data-label="Worker">${esc(a.workerName || a.workerId)} <span class="cell-id">${esc(a.workerId)}</span></td>
                  <td data-label="Module">${esc(a.moduleTitle || a.moduleId)}</td>
                  <td data-label="Score" class="num">${_pct(a.serverPercentage)}</td>
                  <td data-label="Outcome">${_outcomeBadge(a.serverPassed)}</td>
                  <td data-label="AR Mode" class="num">${a.arTier ? `Tier ${num(a.arTier)}` : UNAVAILABLE}</td>
                  <td data-label="Language">${a.locale ? esc(String(a.locale).toUpperCase()) : UNAVAILABLE}</td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// every certificate the ledger knows about, assembled from the roster the API
// already returns. the issue date and the signed score are not in this payload,
// so those columns say so rather than borrowing the attempt's numbers.
function _certificatesSection(data) {
  const { roster = [], modules = [], summary } = data;

  const rows = [];
  roster.forEach((w) => {
    modules.forEach((m) => {
      const mod = w.modules ? w.modules[m.moduleId] : null;
      if (!mod || !mod.certId) return;
      rows.push(`
        <tr>
          <td data-label="Certificate" class="cell-mono">${esc(mod.certId)}</td>
          <td data-label="Worker">${esc(w.name)} <span class="cell-id">${esc(w.workerId)}</span></td>
          <td data-label="Module">${esc(m.title)}</td>
          <td data-label="Best Score" class="num">${mod.bestScore === null || mod.bestScore === undefined ? UNAVAILABLE : `${num(mod.bestScore)}%`}</td>
          <td data-label="Issued" class="num">${UNAVAILABLE}</td>
          <td data-label="Expires" class="num">${mod.expiresAt ? esc(formatTimestamp(mod.expiresAt)) : UNAVAILABLE}</td>
        </tr>`);
    });
  });

  return `
    <div class="notice"><span>Certificates are signed ${esc(summary.certificateSystemStatus && summary.certificateSystemStatus.algo ? summary.certificateSystemStatus.algo : "")} credentials issued by the backend. The compliance endpoint carries each certificate's id and expiry; the issue date and the signed score are not part of this payload, so those cells are left blank rather than filled with the attempt's figures.</span></div>
    <div class="panel">
      <div class="panel__head"><span>Issued Certificates</span><span class="section-count">${rows.length} issued · ${num(summary.certifiedWorkers)} workers certified</span></div>
      <div class="table-responsive">
        <table class="data-table data-table--stack">
          <thead><tr><th>Certificate ID</th><th>Worker</th><th>Module</th><th>Best Score</th><th>Issued</th><th>Expires</th></tr></thead>
          <tbody>
            ${rows.length === 0
              ? _emptyRow(6, "No certificates issued", "A certificate appears here once a worker passes a module and the app requests issuance.")
              : rows.join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function _complianceSection(data) {
  const { mines = [], contractors = [], summary } = data;

  const table = (title, rows, cols, body) => `
    <div class="panel">
      <div class="panel__head"><span>${esc(title)}</span><span class="section-count">${rows} ${rows === 1 ? "record" : "records"}</span></div>
      <div class="table-responsive">
        <table class="data-table data-table--stack">
          <thead><tr>${cols}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;

  const mineBody = mines.length === 0
    ? _emptyRow(4, "No sites registered", "The backend reports no mines.")
    : mines.map((m) => `
      <tr>
        <td data-label="Mine"><strong>${esc(m.name)}</strong></td>
        <td data-label="District">${esc(m.district || "")}</td>
        <td data-label="Workforce" class="num">${num(m.totalWorkers)}</td>
        <td data-label="Compliance" class="num">${num(m.compliantWorkers)} of ${num(m.totalWorkers)} · ${num(m.complianceRate)}%</td>
      </tr>`).join("");

  const contractorBody = contractors.length === 0
    ? _emptyRow(4, "No contractors registered", "The backend reports no contractors.")
    : contractors.map((c) => `
      <tr>
        <td data-label="Contractor"><strong>${esc(c.name)}</strong></td>
        <td data-label="Workers" class="num">${num(c.totalWorkers)}</td>
        <td data-label="Compliant" class="num">${num(c.compliantWorkers)}</td>
        <td data-label="Rate" class="num">${num(c.complianceRate)}%</td>
      </tr>`).join("");

  return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Overall Compliance</span>
        <span class="kpi-value accent">${num(summary.complianceRate)}%</span>
        <span class="kpi-subtext">${num(summary.fullyCompliantWorkers)} of ${num(summary.totalWorkers)} workers passed every required module</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Certificates Expiring</span>
        <span class="kpi-value">${num(summary.expiringSoonCertificates)}</span>
        <span class="kpi-subtext">Within 30 days</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Certificates Expired</span>
        <span class="kpi-value">${num(summary.expiredCertificates)}</span>
        <span class="kpi-subtext">Need recertification</span>
      </div>
    </div>
    ${table("Compliance by Site", mines.length, "<th>Mine</th><th>District</th><th>Workforce</th><th>Compliant</th>", mineBody)}
    ${table("Compliance by Contractor", contractors.length, "<th>Contractor</th><th>Workers</th><th>Compliant</th><th>Rate</th>", contractorBody)}
  `;
}

// ---------------------------------------------------------------- shell

const SECTIONS = [
  { id: "overview", label: "Overview", build: _overviewSection, count: () => null },
  { id: "workers", label: "Workers", build: _workersSection, count: (d) => (d.roster || []).length },
  { id: "training", label: "Training", build: _trainingSection, count: (d) => (d.modules || []).length },
  { id: "assessments", label: "Assessments", build: _assessmentsSection, count: (d) => num(d.summary.totalAttempts) },
  { id: "certificates", label: "Certificates", build: _certificatesSection, count: (d) => num(d.summary.certifiedWorkers) },
  { id: "compliance", label: "Compliance", build: _complianceSection, count: (d) => (d.mines || []).length }
];

function renderDashboard(container, data, { onRefresh } = {}) {
  if (!container || !data) return;

  const summary = data.summary || {};
  const roster = data.roster || [];

  // an empty registry is a state, not a table of nobody
  if (num(summary.totalWorkers) === 0 && roster.length === 0) {
    renderEmpty(container);
    return;
  }

  const safe = {
    summary,
    roster,
    modules: data.modules || [],
    mines: data.mines || [],
    contractors: data.contractors || [],
    attentionItems: data.attentionItems || [],
    recentActivity: data.recentActivity || []
  };

  const nav = SECTIONS.map((section, index) => {
    const count = section.count(safe);
    return `
      <button type="button" class="nav-item" data-section="${section.id}"${index === 0 ? ' aria-current="page"' : ""}>
        <span>${section.label}</span>
        ${count === null ? "" : `<span class="nav-item__count">${count}</span>`}
      </button>`;
  }).join("");

  const panels = SECTIONS.map((section, index) => `
    <section class="admin-section" data-panel="${section.id}"${index === 0 ? "" : " hidden"} aria-label="${section.label}">
      <div class="section-head"><h2>${section.label}</h2></div>
      ${section.build(safe)}
    </section>`).join("");

  container.innerHTML = `
    <div class="admin-shell">
      <div class="admin-brand">${BRAND_MARK}</div>
      <header class="admin-header">
        <div class="admin-header__title">
          <h1>Compliance Ledger</h1>
          <span class="admin-header__meta">Last synced ${esc(formatTimestamp(data.generatedAt))} · live from the SafeAR backend</span>
        </div>
        <div class="admin-header__actions">
          <button id="refresh-btn" class="btn btn--primary" type="button">Refresh</button>
        </div>
      </header>
      <nav class="admin-nav" aria-label="Dashboard sections">${nav}</nav>
      <main class="admin-main">${panels}</main>
    </div>
  `;

  const refreshBtn = container.querySelector("#refresh-btn");
  if (refreshBtn && typeof onRefresh === "function") {
    refreshBtn.addEventListener("click", onRefresh);
  }

  // section switching is a class change, not a page load: the ledger was fetched
  // once and every section is a view of that same payload
  const navButtons = Array.prototype.slice.call(container.querySelectorAll("[data-section]"));
  const panelNodes = Array.prototype.slice.call(container.querySelectorAll("[data-panel]"));
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-section");
      navButtons.forEach((b) => b.removeAttribute("aria-current"));
      button.setAttribute("aria-current", "page");
      panelNodes.forEach((panel) => {
        panel.hidden = panel.getAttribute("data-panel") !== target;
      });
    });
  });

  // filter the worker table in place
  const search = container.querySelector("#roster-search");
  if (search) {
    search.addEventListener("input", () => {
      const term = String(search.value || "").toLowerCase().trim();
      Array.prototype.slice.call(container.querySelectorAll(".roster-row")).forEach((row) => {
        const hay = row.getAttribute("data-search") || "";
        row.hidden = term !== "" && hay.indexOf(term) === -1;
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
  isTrustedApiOrigin,
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
