// The admin key opens the whole workforce ledger: every worker's name, mine,
// contractor, scores and certificates. ?api= is the one input an attacker can
// choose — a link is enough — so the rule is that the key rides only an origin we
// picked ourselves.
//
// These tests drive the real resolver and the real fetch path. The assertion that
// matters is always the same one: what did the outgoing request actually carry.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  isTrustedApiOrigin,
  getApiBaseUrl,
  fetchComplianceMetrics,
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

globalThis.sessionStorage = makeSessionStorage();
globalThis.localStorage = makeSessionStorage();

const savedWindow = globalThis.window;
const savedFetch = globalThis.fetch;

// stand the page up on a given url so location-derived trust can be exercised
function servePageAt({ protocol = "http:", hostname = "localhost", port = "5174", search = "" } = {}) {
  globalThis.window = {
    location: { protocol, hostname, port, search },
    sessionStorage: globalThis.sessionStorage,
    URLSearchParams
  };
  return globalThis.window;
}

// capture exactly what went out on the wire
function recordFetch(record) {
  return async (url, init) => {
    record.push({ url: String(url), headers: (init && init.headers) || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ summary: { totalWorkers: 0 }, roster: [] })
    };
  };
}

afterEach(() => {
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  globalThis.fetch = savedFetch;
  clearAdminKey();
});

const KEY = "s3cret-admin-key";

// ---------------------------------------------------------------- the decision

describe("which api origins are trusted", () => {
  beforeEach(() => { delete globalThis.window; });

  it("1. trusts the empty base, which means same origin", () => {
    assert.strictEqual(isTrustedApiOrigin(""), true);
    assert.strictEqual(isTrustedApiOrigin("   "), true);
  });

  it("2. trusts this page's own origin exactly", () => {
    servePageAt({ hostname: "safear.example", port: "", protocol: "https:" });
    assert.strictEqual(isTrustedApiOrigin("https://safear.example"), true);
  });

  it("3. refuses a different scheme on the same host", () => {
    // a downgrade to http is a different origin and a MITM opportunity
    servePageAt({ hostname: "safear.example", port: "", protocol: "https:" });
    assert.strictEqual(isTrustedApiOrigin("http://safear.example"), false);
  });

  it("4. refuses a different port on the same host outside the dev pairing", () => {
    servePageAt({ hostname: "safear.example", port: "", protocol: "https:" });
    assert.strictEqual(isTrustedApiOrigin("https://safear.example:8443"), false);
  });

  it("5. trusts the 5174 -> 3000 dev backend on the same host", () => {
    servePageAt({ hostname: "192.168.1.50", port: "5174" });
    assert.strictEqual(isTrustedApiOrigin("http://192.168.1.50:3000"), true);
  });

  it("6. refuses port 3000 on a DIFFERENT host", () => {
    servePageAt({ hostname: "192.168.1.50", port: "5174" });
    assert.strictEqual(isTrustedApiOrigin("http://192.168.1.99:3000"), false);
  });

  it("7. trusts loopback, which cannot carry data off the machine", () => {
    servePageAt({ hostname: "localhost", port: "5174" });
    ["http://localhost:3000", "http://127.0.0.1:3100", "http://localhost:9999"].forEach((origin) => {
      assert.strictEqual(isTrustedApiOrigin(origin), true, `${origin} should be trusted`);
    });
  });

  it("8. refuses hostnames that merely look like ours", () => {
    // the reason origins are compared whole and never by substring
    servePageAt({ hostname: "safear.example", port: "", protocol: "https:" });
    [
      "https://safear.example.attacker.tld",
      "https://notsafear.example",
      "https://safear.example.evil.co/api",
      "https://attacker.tld/?x=safear.example"
    ].forEach((origin) => {
      assert.strictEqual(isTrustedApiOrigin(origin), false, `${origin} must not pass`);
    });
  });

  it("9. refuses hostnames that merely look like localhost", () => {
    servePageAt({ hostname: "localhost", port: "5174" });
    [
      "http://localhost.attacker.tld",
      "http://notlocalhost",
      "http://127.0.0.1.attacker.tld"
    ].forEach((origin) => {
      assert.strictEqual(isTrustedApiOrigin(origin), false, `${origin} must not pass`);
    });
  });

  it("10. refuses non-web schemes and unparseable junk", () => {
    servePageAt({ hostname: "localhost", port: "5174" });
    ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url", "//attacker.tld"]
      .forEach((v) => assert.strictEqual(isTrustedApiOrigin(v), false, `${v} must not pass`));
  });

  it("11. treats a trailing slash as the same origin", () => {
    servePageAt({ hostname: "localhost", port: "5174" });
    assert.strictEqual(isTrustedApiOrigin("http://localhost:3000/"), true);
    assert.strictEqual(isTrustedApiOrigin("http://localhost:3000///"), true);
  });
});

// ---------------------------------------------------------------- the resolver

describe("getApiBaseUrl refuses a hostile ?api=", () => {
  it("12. drops an attacker origin and falls back to the dev backend", () => {
    servePageAt({ port: "5174", search: "?api=https://attacker.example" });
    assert.strictEqual(getApiBaseUrl(), "http://localhost:3000");
  });

  it("13. drops an attacker origin and falls back to same origin off the dev port", () => {
    servePageAt({ hostname: "safear.example", port: "", protocol: "https:", search: "?api=https://attacker.example" });
    assert.strictEqual(getApiBaseUrl(), "");
  });

  it("14. still honours a trusted ?api= for development", () => {
    servePageAt({ port: "5174", search: "?api=http://localhost:3100" });
    assert.strictEqual(getApiBaseUrl(), "http://localhost:3100");
  });

  it("15. keeps the 5174 -> 3000 mapping when no ?api= is given", () => {
    servePageAt({ port: "5174" });
    assert.strictEqual(getApiBaseUrl(), "http://localhost:3000");
  });

  it("16. returns same origin when there is no window at all", () => {
    delete globalThis.window;
    assert.strictEqual(getApiBaseUrl(), "");
  });
});

// -------------------------------------------------------- what goes on the wire

describe("the admin key never reaches an untrusted origin", () => {
  beforeEach(() => {
    globalThis.sessionStorage = makeSessionStorage();
  });

  // the two the audit called out by name
  const HOSTILE = ["https://attacker.example", "http://evil.local:3000"];

  HOSTILE.forEach((origin, index) => {
    it(`${17 + index}. ?api=${origin} never receives x-admin-key`, async () => {
      servePageAt({ port: "5174", search: `?api=${origin}` });
      setAdminKey(KEY);

      const calls = [];
      globalThis.fetch = recordFetch(calls);
      globalThis.window.fetch = globalThis.fetch;

      await fetchComplianceMetrics();

      // the strong property: the hostile origin is not contacted at all, so there
      // is no request for it to read a key out of
      const toHostile = calls.filter((c) => c.url.startsWith(origin));
      assert.deepStrictEqual(toHostile, [], `${origin} must receive no request whatsoever`);
      assert.ok(
        calls.every((c) => JSON.stringify(c).indexOf(KEY) === -1 || !c.url.startsWith(origin)),
        "the key must never travel to the hostile origin"
      );

      // and the dashboard still works, against the backend it should have used
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, "http://localhost:3000/api/dashboard/compliance");
      assert.strictEqual(calls[0].headers["x-admin-key"], KEY, "the safe fallback still authenticates");
    });
  });

  it("19. strips the key even if an untrusted baseUrl is passed directly", () => {
    // getApiBaseUrl already refuses this, so this proves the second guard at the
    // point the header is attached
    servePageAt({ port: "5174" });
    setAdminKey(KEY);

    const calls = [];
    globalThis.fetch = recordFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    return fetchComplianceMetrics({ baseUrl: "https://attacker.example" }).then(() => {
      assert.strictEqual(calls[0].headers["x-admin-key"], undefined, "the key must not be attached");
    });
  });

  it("20. same-origin requests still receive the key", async () => {
    servePageAt({ hostname: "safear.example", port: "", protocol: "https:" });
    setAdminKey(KEY);

    const calls = [];
    globalThis.fetch = recordFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await fetchComplianceMetrics();

    assert.strictEqual(calls[0].url, "/api/dashboard/compliance", "same origin means a relative path");
    assert.strictEqual(calls[0].headers["x-admin-key"], KEY);
  });

  it("21. the approved 5174 -> 3000 development mapping still receives the key", async () => {
    servePageAt({ port: "5174" });
    setAdminKey(KEY);

    const calls = [];
    globalThis.fetch = recordFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await fetchComplianceMetrics();

    assert.strictEqual(calls[0].url, "http://localhost:3000/api/dashboard/compliance");
    assert.strictEqual(calls[0].headers["x-admin-key"], KEY);
  });

  it("22. a trusted loopback ?api= still receives the key", async () => {
    servePageAt({ port: "5174", search: "?api=http://127.0.0.1:3100" });
    setAdminKey(KEY);

    const calls = [];
    globalThis.fetch = recordFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await fetchComplianceMetrics();

    assert.strictEqual(calls[0].url, "http://127.0.0.1:3100/api/dashboard/compliance");
    assert.strictEqual(calls[0].headers["x-admin-key"], KEY);
  });

  it("23. the key is never written into the url or a query parameter", async () => {
    servePageAt({ port: "5174" });
    setAdminKey(KEY);

    const calls = [];
    globalThis.fetch = recordFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await fetchComplianceMetrics();

    assert.ok(calls[0].url.indexOf(KEY) === -1, "the key must never appear in the url");
    assert.ok(calls[0].url.indexOf("?") === -1, "no query string at all");
  });
});

describe("a hostile ?api= cannot persist", () => {
  beforeEach(() => {
    globalThis.sessionStorage = makeSessionStorage();
    globalThis.localStorage = makeSessionStorage();
  });

  it("24. a rejected origin is written to no storage", () => {
    servePageAt({ port: "5174", search: "?api=https://attacker.example" });
    setAdminKey(KEY);

    getApiBaseUrl();

    const session = JSON.stringify(globalThis.sessionStorage._all());
    const local = JSON.stringify(globalThis.localStorage._all());
    assert.ok(session.indexOf("attacker.example") === -1, "hostile origin must not reach sessionStorage");
    assert.ok(local.indexOf("attacker.example") === -1, "hostile origin must not reach localStorage");
    assert.ok(local.indexOf(KEY) === -1, "the admin key must never reach localStorage");
  });

  it("25. a later load with no ?api= is unaffected by an earlier hostile one", async () => {
    // first visit carries the hostile link
    servePageAt({ port: "5174", search: "?api=https://attacker.example" });
    setAdminKey(KEY);
    getApiBaseUrl();

    // second visit, clean url, must resolve to the normal dev backend
    servePageAt({ port: "5174", search: "" });
    assert.strictEqual(getApiBaseUrl(), "http://localhost:3000");

    const calls = [];
    globalThis.fetch = recordFetch(calls);
    globalThis.window.fetch = globalThis.fetch;
    await fetchComplianceMetrics();

    assert.strictEqual(calls[0].url, "http://localhost:3000/api/dashboard/compliance");
    assert.strictEqual(calls[0].headers["x-admin-key"], KEY, "the legitimate request still works");
  });

  it("26. the admin key still lives only in sessionStorage", () => {
    servePageAt({ port: "5174" });
    setAdminKey(KEY);
    assert.strictEqual(globalThis.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY), KEY);
    assert.strictEqual(globalThis.localStorage.getItem(ADMIN_KEY_STORAGE_KEY), null);
  });
});
