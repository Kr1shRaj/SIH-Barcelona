// Where the backend lives, and how every caller finds it.
//
// The bug these guard against was quiet: relative /api/* paths resolved against the
// static file server, so nothing threw, nothing logged, and every request came back
// as a 404 page. The assertions below are mostly about which URL actually goes out
// on the wire, because that is the thing that was wrong.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  apiFetch,
  apiPost,
  resolveApiBase,
  API_BASE_STORAGE_KEY
} from "../js/api.js";
import { flushPendingCertificates, clearPendingCertificates, clearCertificates } from "../js/certificates.js";
import {
  syncQueuedAttempts,
  fetchModuleManifests,
  queueAttemptForSync,
  clearAttemptQueue
} from "../assessment/engine.js";

// ---------------------------------------------------------------- test doubles

function makeStorage() {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
    _dump: () => store
  };
}

// storage that throws on every touch, the locked-down webview case
const hostileStorage = {
  get getItem() { throw new Error("storage blocked"); },
  get setItem() { throw new Error("storage blocked"); }
};

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = makeStorage();
}

// records the url every call went to, so a test can assert the destination
function recordingFetch(record, response) {
  return async (url, init) => {
    record.push({ url: String(url), method: (init && init.method) || "GET" });
    return response || {
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    };
  };
}

const savedWindow = globalThis.window;
const savedFetch = globalThis.fetch;

// one store shared with globalThis, because certificates.js reads window.localStorage
// first and engine.js reaches for whichever it finds — two stores would let a test
// pass while the code under test looked somewhere else
function setWindow(props) {
  globalThis.window = Object.assign({ localStorage: globalThis.localStorage }, props);
  return globalThis.window;
}

afterEach(() => {
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  globalThis.fetch = savedFetch;
  globalThis.localStorage.clear();
});

// ---------------------------------------------------------------- the resolver

describe("resolveApiBase", () => {
  beforeEach(() => {
    delete globalThis.window;
    globalThis.localStorage.clear();
  });

  it("1. falls back to same origin when there is no window at all", () => {
    // this is the node case, and it is what keeps every existing suite passing
    assert.strictEqual(resolveApiBase(), "");
  });

  it("2. falls back to same origin when window has no location", () => {
    setWindow({});
    assert.strictEqual(resolveApiBase(), "");
  });

  it("3. survives a location stripped down to a search string", () => {
    // engine.test.js builds exactly this shape, so it must not throw
    setWindow({ location: { search: "?workerId=WRK-0004" } });
    assert.strictEqual(resolveApiBase(), "");
  });

  it("4. maps the frontend dev port to the backend port on the same host", () => {
    setWindow({ location: { protocol: "http:", hostname: "localhost", port: "5173", search: "" } });
    assert.strictEqual(resolveApiBase(), "http://localhost:3000");
  });

  it("5. reads the host off location rather than naming one", () => {
    // a phone loading the dev server over the lan must find the backend on the same
    // machine. no developer address is ever written into the source.
    setWindow({ location: { protocol: "http:", hostname: "192.168.1.5", port: "5173", search: "" } });
    assert.strictEqual(resolveApiBase(), "http://192.168.1.5:3000");
  });

  it("6. keeps https when the dev server is served over https", () => {
    setWindow({ location: { protocol: "https:", hostname: "safear.local", port: "5173", search: "" } });
    assert.strictEqual(resolveApiBase(), "https://safear.local:3000");
  });

  it("7. leaves any other port alone", () => {
    setWindow({ location: { protocol: "http:", hostname: "localhost", port: "8080", search: "" } });
    assert.strictEqual(resolveApiBase(), "");
  });

  it("8. takes ?api= and remembers it", () => {
    const win = setWindow({
      location: { protocol: "http:", hostname: "localhost", port: "5173", search: "?api=http://10.0.0.9:3000" },
      URLSearchParams: globalThis.URLSearchParams
    });
    assert.strictEqual(resolveApiBase(), "http://10.0.0.9:3000");
    assert.strictEqual(win.localStorage.getItem(API_BASE_STORAGE_KEY), "http://10.0.0.9:3000");
  });

  it("9. uses the remembered base on a later load with no query param", () => {
    const storage = makeStorage();
    storage.setItem(API_BASE_STORAGE_KEY, "http://10.0.0.9:3000");
    globalThis.window = { localStorage: storage, location: { protocol: "http:", hostname: "localhost", port: "", search: "" } };
    assert.strictEqual(resolveApiBase(), "http://10.0.0.9:3000");
  });

  it("10. lets a fresh ?api= override what was remembered", () => {
    const storage = makeStorage();
    storage.setItem(API_BASE_STORAGE_KEY, "http://old:3000");
    globalThis.window = {
      localStorage: storage,
      location: { protocol: "http:", hostname: "localhost", port: "", search: "?api=http://new:3000" },
      URLSearchParams: globalThis.URLSearchParams
    };
    assert.strictEqual(resolveApiBase(), "http://new:3000");
    assert.strictEqual(storage.getItem(API_BASE_STORAGE_KEY), "http://new:3000");
  });

  it("11. uses window.SAFEAR_API_BASE when nothing more specific is set", () => {
    setWindow({
      SAFEAR_API_BASE: "http://192.168.1.5:3000",
      location: { protocol: "https:", hostname: "localhost", port: "", search: "" }
    });
    assert.strictEqual(resolveApiBase(), "http://192.168.1.5:3000");
  });

  it("12. ignores the empty default that config.js ships with", () => {
    setWindow({ SAFEAR_API_BASE: "", location: { protocol: "http:", hostname: "localhost", port: "5173", search: "" } });
    assert.strictEqual(resolveApiBase(), "http://localhost:3000");
  });

  it("13. honours the full precedence chain", () => {
    const storage = makeStorage();
    storage.setItem(API_BASE_STORAGE_KEY, "http://stored:3000");
    globalThis.window = {
      localStorage: storage,
      SAFEAR_API_BASE: "http://config:3000",
      location: { protocol: "http:", hostname: "localhost", port: "5173", search: "?api=http://query:3000" },
      URLSearchParams: globalThis.URLSearchParams
    };
    assert.strictEqual(resolveApiBase(), "http://query:3000", "query param wins");

    globalThis.window.location.search = "";
    assert.strictEqual(resolveApiBase(), "http://query:3000", "then storage, now holding the persisted param");

    storage.clear();
    assert.strictEqual(resolveApiBase(), "http://config:3000", "then the build config");

    delete globalThis.window.SAFEAR_API_BASE;
    assert.strictEqual(resolveApiBase(), "http://localhost:3000", "then the dev heuristic");

    globalThis.window.location.port = "9999";
    assert.strictEqual(resolveApiBase(), "", "then same origin");
  });

  it("14. strips trailing slashes so paths never double up", () => {
    setWindow({ SAFEAR_API_BASE: "http://host:3000///", location: { search: "" } });
    assert.strictEqual(resolveApiBase(), "http://host:3000");
  });

  it("15. rejects a non-http scheme rather than trusting it", () => {
    // ?api= is attacker-reachable, so anything that is not http(s) is dropped and
    // the next source in the chain answers instead
    setWindow({
      location: { protocol: "http:", hostname: "localhost", port: "5173", search: "?api=javascript:alert(1)" },
      URLSearchParams: globalThis.URLSearchParams
    });
    assert.strictEqual(resolveApiBase(), "http://localhost:3000");
  });

  it("16. rejects a value that is not a url at all", () => {
    setWindow({ SAFEAR_API_BASE: "not a url", location: { search: "" } });
    assert.strictEqual(resolveApiBase(), "");
  });

  it("17. treats a capacitor-shaped origin with no config as offline, not a crash", () => {
    // https://localhost with no port is what the android webview serves. there is no
    // backend behind it, so the honest answer is "" and the offline path takes over.
    setWindow({ location: { protocol: "https:", hostname: "localhost", port: "", search: "" } });
    assert.doesNotThrow(() => resolveApiBase());
    assert.strictEqual(resolveApiBase(), "");
  });

  it("18. survives storage that throws on every access", () => {
    globalThis.window = {
      localStorage: hostileStorage,
      location: { protocol: "http:", hostname: "localhost", port: "5173", search: "" }
    };
    assert.doesNotThrow(() => resolveApiBase());
    assert.strictEqual(resolveApiBase(), "http://localhost:3000");
  });

  it("19. resolves at call time, not at import time", () => {
    setWindow({ location: { protocol: "http:", hostname: "localhost", port: "5173", search: "" } });
    assert.strictEqual(resolveApiBase(), "http://localhost:3000");
    globalThis.window.location.hostname = "10.1.2.3";
    assert.strictEqual(resolveApiBase(), "http://10.1.2.3:3000");
  });
});

// ------------------------------------------------------------- what goes out

describe("every caller reaches the resolved backend", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    clearAttemptQueue();
    clearPendingCertificates();
    clearCertificates();
    setWindow({ location: { protocol: "http:", hostname: "localhost", port: "5173", search: "" } });
  });

  it("20. apiFetch prefixes the resolved base", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await apiFetch("/api/health");
    assert.strictEqual(calls[0].url, "http://localhost:3000/api/health");
  });

  it("21. an explicit baseUrl still overrides the resolver", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await apiFetch("/api/health", { baseUrl: "http://pinned:9000" });
    assert.strictEqual(calls[0].url, "http://pinned:9000/api/health");
  });

  it("22. an explicit empty baseUrl is honoured as same origin", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await apiFetch("/api/health", { baseUrl: "" });
    assert.strictEqual(calls[0].url, "/api/health");
  });

  it("23. module manifest fetch goes to the backend", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls, { ok: false, status: 500, json: async () => ({}) });
    globalThis.window.fetch = globalThis.fetch;

    await fetchModuleManifests();
    assert.strictEqual(calls[0].url, "http://localhost:3000/api/modules");
  });

  it("24. attempt sync goes to the backend", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls, {
      ok: true,
      status: 200,
      json: async () => ({ results: [] })
    });
    globalThis.window.fetch = globalThis.fetch;

    queueAttemptForSync({
      contractVersion: "1.0",
      attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
      workerId: "WRK-0001",
      moduleId: "fire-response",
      checkpoints: []
    });
    await syncQueuedAttempts();

    assert.strictEqual(calls[0].url, "http://localhost:3000/api/sync");
    assert.strictEqual(calls[0].method, "POST");
  });

  it("25. certificate issuance goes to the backend", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls, {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "attempt_not_found", message: "not yet" } })
    });
    globalThis.window.fetch = globalThis.fetch;

    globalThis.localStorage.setItem("safear_pending_certificates", JSON.stringify([{
      attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
      moduleId: "fire-response",
      workerId: "WRK-0001",
      queuedAt: new Date().toISOString(),
      lastError: null
    }]));

    await flushPendingCertificates();
    assert.strictEqual(calls[0].url, "http://localhost:3000/api/certs/issue");
    assert.strictEqual(calls[0].method, "POST");
  });

  it("26. a 404 from a misconfigured base still keeps the pending item", async () => {
    // the failure mode that hid the original bug: nothing must be discarded just
    // because the request went somewhere useless
    globalThis.fetch = recordingFetch([], {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found", message: "no" } })
    });
    globalThis.window.fetch = globalThis.fetch;

    globalThis.localStorage.setItem("safear_pending_certificates", JSON.stringify([{
      attemptId: "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51",
      moduleId: "fire-response",
      workerId: "WRK-0001",
      queuedAt: new Date().toISOString(),
      lastError: null
    }]));

    const result = await flushPendingCertificates();
    assert.strictEqual(result.issued, 0);
    assert.strictEqual(result.dropped, 0);
    assert.strictEqual(result.stillPending, 1);
  });

  it("27. apiPost carries the resolved base too", async () => {
    const calls = [];
    globalThis.fetch = recordingFetch(calls);
    globalThis.window.fetch = globalThis.fetch;

    await apiPost("/api/certs/verify", { certId: "SAFEAR-0123456789ABCDEF" });
    assert.strictEqual(calls[0].url, "http://localhost:3000/api/certs/verify");
  });
});
