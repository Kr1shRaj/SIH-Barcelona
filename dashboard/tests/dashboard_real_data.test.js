import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DASHBOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

globalThis.window = undefined;
globalThis.document = { getElementById: () => null };

const { renderDashboard, renderEmpty, renderError, renderAuthRequired } = await import("../js/dashboard.js");

function container() {
  return {
    innerHTML: "",
    _handlers: [],
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
}

// One payload, shaped exactly like GET /api/dashboard/compliance, with values that
// could only have come from a database: odd scores, a failed attempt, a worker who
// has not started, a certificate on one module and none on the other.
function ledger(overrides = {}) {
  return {
    generatedAt: "2026-09-19T17:41:40.000Z",
    summary: {
      totalWorkers: 3,
      fullyCompliantWorkers: 1,
      partiallyCompliantWorkers: 1,
      nonCompliantWorkers: 1,
      complianceRate: 33.3,
      certifiedWorkers: 1,
      totalAttempts: 4,
      expiringSoonCertificates: 0,
      expiredCertificates: 0,
      certificateSystemStatus: { isImplemented: true, algo: "Ed25519" }
    },
    modules: [
      { moduleId: "fire-response", title: "Fire & Explosion Response", passThreshold: 0.7, recertMonths: 12, totalAttempts: 3, uniqueWorkersAttempted: 2, uniqueWorkersPassed: 1, completionRate: 33.3, averageScore: 71.4 },
      { moduleId: "gas-leak", title: "Gas Leak & Confined Space Protocol", passThreshold: 0.7, recertMonths: null, totalAttempts: 1, uniqueWorkersAttempted: 1, uniqueWorkersPassed: 0, completionRate: 0, averageScore: 42.5 }
    ],
    mines: [{ mineId: "MINE-01", name: "Jharia Coal Block A", district: "Dhanbad", totalWorkers: 3, compliantWorkers: 1, complianceRate: 33.3 }],
    contractors: [{ contractorId: "CON-01", name: "Jharkhand Mining Contractors Pvt Ltd", totalWorkers: 3, compliantWorkers: 1, complianceRate: 33.3 }],
    roster: [
      {
        workerId: "WRK-0001", name: "Budhan Murmu", mineId: "MINE-01", mineName: "Jharia Coal Block A",
        contractorId: "CON-01", contractorName: "Jharkhand Mining Contractors Pvt Ltd",
        overallStatus: "compliant", passedModulesCount: 2, totalRequiredModules: 2,
        modules: {
          "fire-response": { moduleId: "fire-response", status: "certified", passed: true, attemptsCount: 2, bestScore: 87.74, lastCompletedAt: "2026-09-19T17:41:37.167Z", certId: "SAFEAR-6544E452A54B58BF", expiresAt: "2027-09-19T00:00:00.000Z" },
          "gas-leak": { moduleId: "gas-leak", status: "passed", passed: true, attemptsCount: 1, bestScore: 78.2, lastCompletedAt: "2026-09-18T10:00:00.000Z", certId: null, expiresAt: null }
        }
      },
      {
        workerId: "WRK-0002", name: "Sita Devi", mineId: "MINE-01", mineName: "Jharia Coal Block A",
        contractorId: "CON-01", contractorName: "Jharkhand Mining Contractors Pvt Ltd",
        overallStatus: "in_progress", passedModulesCount: 0, totalRequiredModules: 2,
        modules: {
          "fire-response": { moduleId: "fire-response", status: "failed", passed: false, attemptsCount: 1, bestScore: 42.5, lastCompletedAt: "2026-09-17T09:00:00.000Z", certId: null, expiresAt: null },
          "gas-leak": { moduleId: "gas-leak", status: "not_started", passed: false, attemptsCount: 0, bestScore: null, lastCompletedAt: null, certId: null, expiresAt: null }
        }
      },
      {
        workerId: "WRK-0003", name: "Ramesh Oraon", mineId: "MINE-01", mineName: "Jharia Coal Block A",
        contractorId: "CON-01", contractorName: "Jharkhand Mining Contractors Pvt Ltd",
        overallStatus: "non_compliant", passedModulesCount: 0, totalRequiredModules: 2,
        modules: {
          "fire-response": { moduleId: "fire-response", status: "not_started", passed: false, attemptsCount: 0, bestScore: null, lastCompletedAt: null, certId: null, expiresAt: null },
          "gas-leak": { moduleId: "gas-leak", status: "not_started", passed: false, attemptsCount: 0, bestScore: null, lastCompletedAt: null, certId: null, expiresAt: null }
        }
      }
    ],
    attentionItems: [{ type: "training_incomplete", severity: "warning", workerId: "WRK-0003", workerName: "Ramesh Oraon", mineName: "Jharia Coal Block A", message: "No modules completed yet" }],
    recentActivity: [
      { attemptId: "att-1", workerId: "WRK-0001", workerName: "Budhan Murmu", moduleId: "fire-response", moduleTitle: "Fire & Explosion Response", serverPercentage: 87.74, serverPassed: true, completedAt: "2026-09-19T17:41:37.167Z", arTier: 2, locale: "en" },
      { attemptId: "att-2", workerId: "WRK-0002", workerName: "Sita Devi", moduleId: "fire-response", moduleTitle: "Fire & Explosion Response", serverPercentage: 42.5, serverPassed: false, completedAt: "2026-09-17T09:00:00.000Z", arTier: 1, locale: "hi" }
    ],
    ...overrides
  };
}

function render(data) {
  const c = container();
  renderDashboard(c, data);
  return c.innerHTML;
}

describe("the admin dashboard shows the ledger, and only the ledger", () => {
  it("1. every figure on the page came from the payload", () => {
    const html = render(ledger());

    // workers, attempts, compliance rate, certifications — all as given
    assert.ok(html.includes(">3<"), "workforce total");
    assert.ok(html.includes(">4<"), "attempt count");
    assert.ok(html.includes("33.3%"), "compliance rate");
    assert.ok(html.includes("87.74%"), "a real score, decimals and all");
    assert.ok(html.includes("42.5%"), "including a failing one");
    assert.ok(html.includes("71.4%"), "and a module average");
  });

  it("2. no invented worker, module or certificate appears", () => {
    const html = render(ledger());

    // the names in the payload, and no others
    ["Budhan Murmu", "Sita Devi", "Ramesh Oraon"].forEach((name) => assert.ok(html.includes(name), `${name} missing`));
    ["John Doe", "Jane Smith", "Worker 1", "Lorem", "Sample", "Acme"].forEach((ghost) => {
      assert.ok(!html.includes(ghost), `${ghost} is not in the ledger and must not be on the page`);
    });

    // the one certificate that exists, and no second one
    assert.ok(html.includes("SAFEAR-6544E452A54B58BF"));
    assert.strictEqual((html.match(/SAFEAR-/g) || []).length, 1, "exactly one certificate row");
  });

  it("3. a worker who has not trained says so instead of showing a score", () => {
    const html = render(ledger());
    assert.ok(html.includes("Not started"), "an untrained module is named, not scored");
    // and no zero is invented for them
    assert.ok(!html.includes(">0%<"), "a missing score must not become 0%");
  });

  it("4. pass and fail come from the record, not from the score", () => {
    const html = render(ledger());
    assert.ok(html.includes("Passed"));
    assert.ok(html.includes("Failed"));
    assert.ok(html.includes("Compliant"));
    assert.ok(html.includes("In Progress"));
    assert.ok(html.includes("Non-Compliant"));
  });

  it("5. the module columns follow the backend's module list", () => {
    const html = render(ledger({
      modules: [{ moduleId: "height-safety", title: "Working At Height", passThreshold: 0.8, recertMonths: 6, totalAttempts: 0, uniqueWorkersAttempted: 0, uniqueWorkersPassed: 0, completionRate: 0, averageScore: null }]
    }));

    assert.ok(html.includes("Working At Height"), "a new module gets a column without a code change");
    assert.ok(!html.includes("Gas Leak &amp; Confined Space Protocol"), "a module the backend no longer reports disappears");
  });

  it("6. fields the compliance API does not carry are left blank, not guessed", () => {
    const html = render(ledger());

    // the certificate's issue date is not in this payload
    assert.ok(html.includes("Not carried by the compliance API"), "an absent field is marked as absent");
    // gas-leak has no recert period, so the cell is blank rather than "0 months"
    assert.ok(!html.includes("0 months"));
  });

  it("7. it survives nulls and missing arrays without crashing", () => {
    const sparse = {
      generatedAt: null,
      summary: { totalWorkers: 1, fullyCompliantWorkers: 0, partiallyCompliantWorkers: 0, nonCompliantWorkers: 1, complianceRate: 0, certifiedWorkers: 0, totalAttempts: 0, expiringSoonCertificates: 0, expiredCertificates: 0 },
      roster: [{ workerId: "WRK-9", name: "Lone Worker", mineName: "Unassigned", contractorName: "Unassigned", overallStatus: "non_compliant", modules: {} }]
    };

    let html = "";
    assert.doesNotThrow(() => { html = render(sparse); });
    assert.ok(html.includes("Lone Worker"));
    assert.ok(html.includes("No attempts recorded") || html.includes("No modules published"));
  });

  it("8. an empty ledger is an empty state, never a table of nobody", () => {
    const c = container();
    renderEmpty(c);
    assert.ok(c.innerHTML.includes("No Workers Registered"));

    const c2 = container();
    renderDashboard(c2, ledger({ summary: { ...ledger().summary, totalWorkers: 0 }, roster: [] }));
    assert.ok(c2.innerHTML.includes("No Workers Registered"), "zero workers renders the empty state");
  });

  it("9. an API failure is a stated error, not a blank page", () => {
    const c = container();
    renderError(c, new Error("Database offline"));
    assert.ok(c.innerHTML.includes("Compliance Data Unavailable"));
    assert.ok(c.innerHTML.includes("Database offline"));
    assert.ok(c.innerHTML.includes("Retry Connection"));
  });

  it("10. the sign-in never writes the key into the page", () => {
    const c = container();
    renderAuthRequired(c, { message: "That key was not accepted." });
    const html = c.innerHTML;

    assert.ok(html.includes("Sign In"));
    assert.ok(html.includes("That key was not accepted."));
    assert.ok(html.includes('type="password"'), "the key is never shown as it is typed");
    assert.ok(!/value=/.test(html), "and no value is ever pre-filled into the field");
  });

  it("11. the page carries no admin credential and no external dependency", () => {
    const source = fs.readFileSync(path.join(DASHBOARD, "js/dashboard.js"), "utf8");
    const css = fs.readFileSync(path.join(DASHBOARD, "css/dashboard.css"), "utf8");
    const html = fs.readFileSync(path.join(DASHBOARD, "admin.html"), "utf8");

    [source, css, html].forEach((text) => {
      assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr/.test(text), "no external dependency");
    });
    assert.ok(!source.includes("localStorage.setItem(ADMIN"), "the key never reaches localStorage");
    assert.ok(source.includes("sessionStorage"), "it stays in sessionStorage for the tab");
  });

  it("12. the dashboard is built on the trainee app's palette, not a blue template", () => {
    const css = fs.readFileSync(path.join(DASHBOARD, "css/dashboard.css"), "utf8");

    assert.ok(css.includes("--brand-yellow: #febc04"), "the logo's yellow");
    assert.ok(css.includes("--brand-navy: #01172e"), "the logo's navy");
    assert.ok(css.includes("--color-bg: #111315"), "the trainee app's graphite ground");

    // the blue dashboard palette this file used to carry
    ["#3b82f6", "#2563eb", "#0ea5e9", "#0b0f19", "#111827"].forEach((hex) => {
      assert.ok(!css.includes(hex), `${hex} is from the old blue template`);
    });
  });
});
