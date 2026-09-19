// The dashboard shows named workers, their mine, their scores and their
// certificates. Two things protect that: nobody sees it without the admin key,
// and nothing the API says is ever treated as markup.
//
// The second half is the one that bites quietly. Every render goes through
// innerHTML, so a worker name of `<img src=x onerror=...>` would execute in the
// dashboard's own origin — and because ?api= lets an operator point the page at
// any host, the JSON is not necessarily ours.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  esc,
  num,
  renderDashboard,
  renderAuthRequired,
  renderError,
  loadComplianceMetrics,
  fetchComplianceMetrics,
  getAdminKey,
  setAdminKey,
  clearAdminKey,
  ADMIN_KEY_STORAGE_KEY
} from "../js/dashboard.js";

// ---------------------------------------------------------------- test doubles

function makeSessionStorage() {
  let data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _all: () => data
  };
}

let session = makeSessionStorage();
globalThis.sessionStorage = session;
globalThis.localStorage = makeSessionStorage();

// loadComplianceMetrics only resolves a container when a document exists
globalThis.document = { getElementById: () => null };

function createMockContainer() {
  const listeners = new Map();
  const children = new Map();
  return {
    innerHTML: "",
    value: "",
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    fire(event, arg) {
      (listeners.get(event) || []).forEach((fn) => fn(arg || { preventDefault() {} }));
    },
    setAttribute() {},
    getAttribute() { return ""; },
    querySelector(selector) {
      const known = ["#retry-fetch-btn", "#refresh-dashboard-btn", "#roster-search",
        "#admin-key-form", "#admin-key-input", "#admin-key-submit"];
      if (known.indexOf(selector) !== -1) {
        if (!children.has(selector)) children.set(selector, createMockContainer());
        return children.get(selector);
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
}

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });

// a payload built entirely out of hostile values, the shape a malicious ?api= host
// would return
const XSS = "<img src=x onerror=alert(1)>";
const QUOTE_BREAK = '" onmouseover=alert(1) x="';

function hostileMetrics() {
  return {
    generatedAt: XSS,
    summary: {
      totalWorkers: XSS,
      fullyCompliantWorkers: XSS,
      partiallyCompliantWorkers: XSS,
      nonCompliantWorkers: XSS,
      complianceRate: XSS,
      certifiedWorkers: XSS,
      expiringSoonCertificates: XSS,
      expiredCertificates: 0,
      totalAttempts: 0
    },
    modules: [{
      moduleId: "fire-response", title: XSS, totalAttempts: XSS,
      uniqueWorkersPassed: XSS, completionRate: XSS, averageScore: XSS
    }],
    mines: [{ mineId: "M1", name: XSS, district: XSS, totalWorkers: XSS, compliantWorkers: XSS, complianceRate: XSS }],
    contractors: [{ contractorId: "C1", name: XSS, totalWorkers: XSS, compliantWorkers: XSS, complianceRate: XSS }],
    roster: [{
      workerId: QUOTE_BREAK, name: XSS, mineName: XSS, contractorName: XSS,
      overallStatus: "compliant",
      modules: { "fire-response": { passed: true, bestScore: XSS, attemptsCount: 1 } }
    }],
    attentionItems: [{ severity: "warning", workerId: XSS, workerName: XSS, message: XSS, mineName: XSS }],
    recentActivity: [{
      attemptId: "a1", workerId: XSS, workerName: XSS, moduleTitle: XSS,
      serverPercentage: XSS, serverPassed: true, completedAt: XSS, arTier: XSS
    }]
  };
}

// ---------------------------------------------------------------- the helpers

describe("escaping helpers", () => {
  it("1. turns a script-bearing tag into text", () => {
    assert.strictEqual(esc(XSS), "&lt;img src=x onerror=alert(1)&gt;");
  });

  it("2. escapes the quote that would break an attribute", () => {
    assert.ok(esc(QUOTE_BREAK).indexOf('"') === -1, "no raw double quote survives");
    assert.ok(esc("it's").indexOf("'") === -1, "no raw single quote survives");
  });

  it("3. escapes ampersands first, so entities are not double-decoded", () => {
    assert.strictEqual(esc("&lt;"), "&amp;lt;");
  });

  it("4. leaves ordinary names readable", () => {
    assert.strictEqual(esc("Budhan Murmu"), "Budhan Murmu");
    assert.strictEqual(esc("Jharia Coal Block A"), "Jharia Coal Block A");
  });

  it("5. renders an ampersand in a real module title correctly", () => {
    assert.strictEqual(esc("Fire & Explosion Response"), "Fire &amp; Explosion Response");
  });

  it("6. treats null and undefined as empty, never as the words", () => {
    assert.strictEqual(esc(null), "");
    assert.strictEqual(esc(undefined), "");
  });

  it("7. num() keeps real numbers and rejects everything else", () => {
    assert.strictEqual(num(95.5), 95.5);
    assert.strictEqual(num("42"), 42);
    assert.strictEqual(num(0), 0);
    assert.strictEqual(num(XSS), 0);
    assert.strictEqual(num(NaN), 0);
    assert.strictEqual(num(Infinity), 0);
    assert.strictEqual(num(undefined, 2), 2);
  });
});

// ---------------------------------------------------------------- rendering

describe("hostile API data cannot become markup", () => {
  it("8. no executable tag survives anywhere in the rendered dashboard", () => {
    const c = createMockContainer();
    renderDashboard(c, hostileMetrics());
    const html = c.innerHTML;

    // the words survive as visible text, which is correct and harmless. what must
    // not survive is a "<" that starts a tag, or a quote that ends an attribute.
    assert.ok(html.indexOf("<img") === -1, "no img tag may be constructed");
    assert.ok(html.indexOf("<script") === -1, "no script tag may be constructed");
    // the sharp invariant: the payload never appears verbatim, only escaped. the
    // words "onerror=" do survive inside the escaped text and inside a quoted
    // attribute value, which is inert. tests 9 and 11 prove the attributes hold.
    assert.ok(html.indexOf(XSS) === -1, "the raw payload never appears unescaped");
    assert.ok(html.indexOf("&lt;img src=x onerror=alert(1)&gt;") !== -1, "the payload shows as escaped text instead");
    assert.ok(html.indexOf(QUOTE_BREAK) === -1, "the quote-breaking payload never appears unescaped");
  });

  it("9. a quote cannot break out of data-search", () => {
    const c = createMockContainer();
    renderDashboard(c, hostileMetrics());
    const rows = c.innerHTML.match(/data-search="[^"]*"/g) || [];

    assert.ok(rows.length > 0, "the roster row is rendered");
    rows.forEach((attr) => {
      const inner = attr.slice('data-search="'.length, -1);
      // a raw quote is the only way out of a double quoted attribute
      assert.ok(inner.indexOf('"') === -1, "the attribute value contains no raw quote");
      assert.ok(inner.indexOf("&quot;") !== -1, "the quote is present but neutralised");
    });
  });

  it("10. hostile numeric fields render as inert numbers", () => {
    const c = createMockContainer();
    renderDashboard(c, hostileMetrics());
    const html = c.innerHTML;

    assert.ok(html.indexOf('<span class="kpi-value">0</span>') !== -1, "a junk worker count becomes 0");
    assert.ok(html.indexOf("NaN") === -1, "no NaN reaches the screen");
    assert.ok(html.indexOf("undefined") === -1, "no undefined reaches the screen");
  });

  it("11. every attribute in the output is still properly quoted", () => {
    const c = createMockContainer();
    renderDashboard(c, hostileMetrics());
    // an odd number of quotes on a tag means something broke out of an attribute
    const tags = c.innerHTML.match(/<[a-zA-Z][^>]*>/g) || [];
    tags.forEach((tag) => {
      const quotes = (tag.match(/"/g) || []).length;
      assert.strictEqual(quotes % 2, 0, `unbalanced quotes in: ${tag.slice(0, 90)}`);
    });
  });

  it("12. benign data still renders readably, escaping did not mangle it", () => {
    const c = createMockContainer();
    const clean = hostileMetrics();
    clean.roster[0] = {
      workerId: "WRK-0001", name: "Budhan Murmu",
      mineName: "Jharia Coal Block A", contractorName: "Jharkhand Mining Contractors Pvt Ltd",
      overallStatus: "compliant",
      modules: { "fire-response": { passed: true, bestScore: 95, attemptsCount: 1 } }
    };
    clean.summary.totalWorkers = 6;
    clean.modules[0] = { moduleId: "fire-response", title: "Fire & Explosion Response", totalAttempts: 3, uniqueWorkersPassed: 2, completionRate: 33.3, averageScore: 92.5 };

    renderDashboard(c, clean);
    const html = c.innerHTML;
    assert.ok(html.indexOf("Budhan Murmu") !== -1);
    assert.ok(html.indexOf("Jharia Coal Block A") !== -1);
    assert.ok(html.indexOf("WRK-0001") !== -1);
    assert.ok(html.indexOf("Fire &amp; Explosion Response") !== -1, "an ampersand shows as an entity, which renders as &");
    assert.ok(html.indexOf("95%") !== -1);
    assert.ok(html.indexOf('<span class="kpi-value">6</span>') !== -1);
  });

  it("13. the error state escapes its message too", () => {
    const c = createMockContainer();
    renderError(c, new Error(XSS), () => {});
    assert.ok(c.innerHTML.indexOf("<img src=x") === -1);
    assert.ok(c.innerHTML.indexOf("&lt;img") !== -1);
  });

  it("14. the auth prompt escapes its message too", () => {
    const c = createMockContainer();
    renderAuthRequired(c, { message: XSS, onSubmit() {} });
    assert.ok(c.innerHTML.indexOf("<img src=x") === -1);
    assert.ok(c.innerHTML.indexOf("&lt;img") !== -1);
  });
});

// ---------------------------------------------------------------- the key

describe("admin key handling", () => {
  beforeEach(() => {
    session = makeSessionStorage();
    globalThis.sessionStorage = session;
  });

  it("15. there is no key until somebody enters one", () => {
    assert.strictEqual(getAdminKey(), null);
  });

  it("16. a key is kept in sessionStorage and nowhere else", () => {
    setAdminKey("s3cret-key");
    assert.strictEqual(getAdminKey(), "s3cret-key");
    assert.strictEqual(globalThis.localStorage.getItem(ADMIN_KEY_STORAGE_KEY), null, "never local storage");
  });

  it("17. blank input is not accepted as a key", () => {
    assert.strictEqual(setAdminKey("   "), false);
    assert.strictEqual(setAdminKey(""), false);
    assert.strictEqual(getAdminKey(), null);
  });

  it("18. clearing forgets it", () => {
    setAdminKey("s3cret-key");
    clearAdminKey();
    assert.strictEqual(getAdminKey(), null);
  });

  it("19. survives sessionStorage being unavailable", () => {
    const saved = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      get() { throw new Error("blocked"); }, configurable: true
    });
    assert.doesNotThrow(() => getAdminKey());
    assert.strictEqual(getAdminKey(), null);
    assert.strictEqual(setAdminKey("x"), false);
    assert.doesNotThrow(() => clearAdminKey());
    Object.defineProperty(globalThis, "sessionStorage", { value: saved, configurable: true, writable: true });
  });

  it("20. the key is sent as a header, never in the url", async () => {
    setAdminKey("s3cret-key");
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), headers: (init && init.headers) || {} };
      return { ok: true, status: 200, json: async () => ({ summary: {} }) };
    };

    await fetchComplianceMetrics({ baseUrl: "http://localhost:3000" });
    assert.strictEqual(seen.headers["x-admin-key"], "s3cret-key");
    assert.ok(seen.url.indexOf("s3cret-key") === -1, "the key must never appear in the url");
    assert.ok(seen.url.indexOf("?") === -1, "no query parameters at all");
  });

  it("21. a 401 is reported as an auth failure, not a generic error", async () => {
    setAdminKey("wrong-key");
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

    await assert.rejects(
      () => fetchComplianceMetrics({ baseUrl: "http://localhost:3000" }),
      (err) => err.code === "unauthorized"
    );
  });
});

describe("the load flow", () => {
  beforeEach(() => {
    session = makeSessionStorage();
    globalThis.sessionStorage = session;
  });

  it("22. asks for a key before making any request at all", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };

    const c = createMockContainer();
    await loadComplianceMetrics(c);

    assert.strictEqual(called, false, "an unauthenticated visitor triggers no request");
    // the landing page is shown instead of a bare auth prompt
    assert.ok(c.innerHTML.indexOf("Sign In") !== -1 || c.innerHTML.indexOf("Hands-On") !== -1, "landing page rendered");
  });

  it("23. a correct key loads the dashboard", async () => {
    setAdminKey("s3cret-key");
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        generatedAt: "2026-09-03T10:00:00.000Z",
        summary: { totalWorkers: 6, fullyCompliantWorkers: 2, partiallyCompliantWorkers: 1, nonCompliantWorkers: 3, complianceRate: 33.3, certifiedWorkers: 1, expiringSoonCertificates: 0 },
        modules: [], mines: [], contractors: [],
        roster: [{ workerId: "WRK-0001", name: "Budhan Murmu", mineName: "M", contractorName: "C", overallStatus: "compliant", modules: {} }],
        attentionItems: [], recentActivity: []
      })
    });

    const c = createMockContainer();
    await loadComplianceMetrics(c);
    assert.ok(c.innerHTML.indexOf("Budhan Murmu") !== -1, "the roster rendered");
    assert.ok(c.innerHTML.indexOf("Admin Key Required") === -1);
  });

  it("24. a rejected key is discarded and the prompt returns", async () => {
    setAdminKey("wrong-key");
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

    const c = createMockContainer();
    await loadComplianceMetrics(c);

    assert.strictEqual(getAdminKey(), null, "a rejected key must not be kept");
    // the landing page re-renders on rejection
    assert.ok(c.innerHTML.indexOf("Sign In") !== -1 || c.innerHTML.indexOf("Hands-On") !== -1, "landing page re-rendered after rejection");
  });

  it("25. the rejected key never appears in the rendered prompt", async () => {
    setAdminKey("s3cret-key-abc");
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

    const c = createMockContainer();
    await loadComplianceMetrics(c);
    assert.ok(c.innerHTML.indexOf("s3cret-key-abc") === -1, "the key must never be written into the dom");
  });

  it("26. a non-auth failure still shows the ordinary error state", async () => {
    setAdminKey("s3cret-key");
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

    const c = createMockContainer();
    await loadComplianceMetrics(c);
    assert.ok(c.innerHTML.indexOf("Compliance Data Unavailable") !== -1);
    assert.strictEqual(getAdminKey(), "s3cret-key", "a 500 is not the key's fault, so keep it");
  });

  it("27. entering a key stores it and retries", async () => {
    let sentKey = null;
    globalThis.fetch = async (url, init) => {
      sentKey = init.headers["x-admin-key"];
      return { ok: true, status: 200, json: async () => ({ summary: { totalWorkers: 0 }, roster: [] }) };
    };

    // the landing page passes the key through onSignIn callback,
    // so we test the renderAuthRequired path directly instead
    const c = createMockContainer();
    renderAuthRequired(c, {
      onSubmit: async (entered) => {
        setAdminKey(entered);
        await loadComplianceMetrics(c);
      }
    });

    const input = c.querySelector("#admin-key-input");
    const form = c.querySelector("#admin-key-form");
    input.value = "typed-key";
    await form.fire("submit", { preventDefault() {} });

    assert.strictEqual(getAdminKey(), "typed-key", "kept for the rest of the session");
    assert.strictEqual(sentKey, "typed-key", "and used on the retry");
  });

  it("28. the key persists across reloads within the same session", async () => {
    setAdminKey("s3cret-key");
    const keys = [];
    globalThis.fetch = async (url, init) => {
      keys.push(init.headers["x-admin-key"]);
      return { ok: true, status: 200, json: async () => ({ summary: { totalWorkers: 0 }, roster: [] }) };
    };

    await loadComplianceMetrics(createMockContainer());
    await loadComplianceMetrics(createMockContainer());
    assert.deepStrictEqual(keys, ["s3cret-key", "s3cret-key"], "no re-prompt inside one session");
  });
});
