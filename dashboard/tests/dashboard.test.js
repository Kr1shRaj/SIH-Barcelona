import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatTimestamp,
  fetchComplianceMetrics,
  renderLoading,
  renderError,
  renderEmpty,
  renderDashboard
} from "../js/dashboard.js";

// helper to create mock dom element
function createMockContainer() {
  const listeners = new Map();
  const attributes = new Map();
  const children = new Map();
  return {
    innerHTML: "",
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    dispatchEvent(event) {
      const fns = listeners.get(event) || [];
      fns.forEach((fn) => fn({ target: this }));
    },
    setAttribute(k, v) { attributes.set(k, v); },
    getAttribute(k) { return attributes.get(k) || ""; },
    querySelector(selector) {
      if (selector === "#retry-fetch-btn" || selector === "#refresh-dashboard-btn" || selector === "#roster-search") {
        if (!children.has(selector)) {
          children.set(selector, createMockContainer());
        }
        return children.get(selector);
      }
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

const SAMPLE_METRICS = {
  generatedAt: "2026-09-03T10:00:00.000Z",
  summary: {
    totalWorkers: 6,
    fullyCompliantWorkers: 2,
    partiallyCompliantWorkers: 1,
    nonCompliantWorkers: 3,
    complianceRate: 33.3,
    certifiedWorkers: 0,
    totalAttempts: 5,
    expiringSoonCertificates: 0,
    expiredCertificates: 0,
    certificateSystemStatus: { isImplemented: false }
  },
  modules: [
    {
      moduleId: "fire-response",
      title: "Fire & Explosion Response",
      totalAttempts: 3,
      uniqueWorkersPassed: 2,
      completionRate: 33.3,
      averageScore: 92.5
    },
    {
      moduleId: "gas-leak",
      title: "Gas Leak & Confined Space Protocol",
      totalAttempts: 2,
      uniqueWorkersPassed: 2,
      completionRate: 33.3,
      averageScore: 95.0
    }
  ],
  mines: [
    { mineId: "MINE-JH-001", name: "Jharia Coal Block A", district: "Dhanbad", totalWorkers: 3, compliantWorkers: 1, complianceRate: 33.3 }
  ],
  contractors: [
    { contractorId: "CON-001", name: "Jharkhand Mining Contractors Pvt Ltd", totalWorkers: 3, compliantWorkers: 1, complianceRate: 33.3 }
  ],
  roster: [
    {
      workerId: "WRK-0001",
      name: "Budhan Murmu",
      mineName: "Jharia Coal Block A",
      contractorName: "Jharkhand Mining Contractors Pvt Ltd",
      overallStatus: "compliant",
      modules: {
        "fire-response": { passed: true, bestScore: 95.0, attemptsCount: 1 },
        "gas-leak": { passed: true, bestScore: 90.0, attemptsCount: 1 }
      }
    }
  ],
  attentionItems: [
    { type: "training_incomplete", severity: "warning", workerId: "WRK-0002", workerName: "Sita Devi", message: "No modules completed yet" }
  ],
  recentActivity: [
    {
      attemptId: "att-1",
      workerId: "WRK-0001",
      workerName: "Budhan Murmu",
      moduleTitle: "Fire & Explosion Response",
      serverPercentage: 95.0,
      serverPassed: true,
      completedAt: "2026-09-03T09:45:00.000Z",
      arTier: 2
    }
  ]
};

describe("Admin Compliance Dashboard Client", () => {
  it("formatTimestamp produces expected outputs", () => {
    assert.strictEqual(formatTimestamp(null), "Never");
    assert.strictEqual(formatTimestamp(""), "Never");
    const formatted = formatTimestamp("2026-09-03T10:00:00.000Z");
    assert.ok(formatted.includes("2026") || formatted.includes("Sep") || formatted.includes("9/3"));
  });

  it("renderLoading injects loading state markup", () => {
    const container = createMockContainer();
    renderLoading(container);
    assert.ok(container.innerHTML.includes("Loading Compliance Ledger"));
    assert.ok(container.innerHTML.includes("state-card"));
  });

  it("renderError injects error state markup and handles retry callback", () => {
    const container = createMockContainer();
    let retried = false;
    renderError(container, new Error("Database offline"), () => {
      retried = true;
    });

    const btn = container.querySelector("#retry-fetch-btn");
    btn.dispatchEvent("click");
    assert.strictEqual(retried, true);
    assert.ok(container.innerHTML.includes("Compliance Data Unavailable"));
    assert.ok(container.innerHTML.includes("Database offline"));
    assert.ok(container.innerHTML.includes("Retry Connection"));
  });

  it("renderEmpty injects empty workforce notice", () => {
    const container = createMockContainer();
    renderEmpty(container);
    assert.ok(container.innerHTML.includes("No Workers Registered"));
  });

  it("renderDashboard displays all KPIs, modules, and roster records", () => {
    const container = createMockContainer();
    renderDashboard(container, SAMPLE_METRICS);

    const html = container.innerHTML;
    // KPI checks
    assert.ok(html.includes("Workforce Total"));
    assert.ok(html.includes(">6<"));
    assert.ok(html.includes("Fully Compliant"));
    assert.ok(html.includes(">2<"));
    assert.ok(html.includes("33.3%"));

    // Module checks
    assert.ok(html.includes("Fire &amp; Explosion Response") || html.includes("Fire & Explosion Response"));
    assert.ok(html.includes("Gas Leak &amp; Confined Space Protocol") || html.includes("Gas Leak & Confined Space Protocol"));

    // Roster checks
    assert.ok(html.includes("Budhan Murmu"));
    assert.ok(html.includes("WRK-0001"));
    assert.ok(html.includes("Compliant"));

    // Attention checks
    assert.ok(html.includes("Sita Devi"));
    assert.ok(html.includes("No modules completed yet"));

    // Recent activity checks
    assert.ok(html.includes("Recent Assessment Sync Activity"));
  });

  it("fetchComplianceMetrics retrieves data or throws on failure", async () => {
    // mock globalThis.fetch
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => SAMPLE_METRICS
    });

    const data = await fetchComplianceMetrics({ baseUrl: "http://localhost:3000" });
    assert.strictEqual(data.summary.totalWorkers, 6);

    // test server error 500
    globalThis.fetch = async () => ({
      ok: false,
      status: 500
    });

    await assert.rejects(
      () => fetchComplianceMetrics({ baseUrl: "http://localhost:3000" }),
      /Server returned HTTP 500/
    );

    // restore
    globalThis.fetch = originalFetch;
  });
});
