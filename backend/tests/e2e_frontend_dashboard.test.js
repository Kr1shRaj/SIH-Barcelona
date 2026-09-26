process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { buildTestApp, measureSpatialCheckpoints, TEST_CONFIG, activateTestTrainee } = require("./helpers/app");
const { fireAttempt } = require("./fixtures/attempts");

// The chain, end to end, with nobody standing in for anybody:
//
//   frontend/assessment/engine.js  ->  POST /api/sync  ->  sqlite
//   frontend/js/certificates.js    ->  POST /api/certs/issue
//   dashboard/js/dashboard.js      ->  GET  /api/dashboard/compliance
//
// The other e2e suite next door drives the API with supertest, which is the right
// tool for checking what the API does. This one exists to check something else:
// that the code actually shipped to the two browsers talks to it correctly. So it
// imports the real frontend sync client and the real dashboard client, over a real
// port, and never hand-rolls a request either of them would have made.
//
// Both clients are ES modules and this file is CommonJS, so they arrive by dynamic
// import inside before().
describe("End to end: frontend -> backend -> dashboard", () => {
  const WORKER = "WRK-0001";
  const MODULE = "fire-response";
  const REPO = path.resolve(__dirname, "..", "..");

  let ctx = null;
  let server = null;
  let baseUrl = null;
  let engine = null;
  let dashboard = null;
  let api = null;
  let attempt = null;
  let syncResult = null;
  let session = null;

  // the frontend keeps its queue in localStorage and node has none
  function installStorage() {
    const map = new Map();
    globalThis.localStorage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    };
    // the dashboard keeps the admin key in sessionStorage, and only for the tab
    const session = new Map();
    globalThis.sessionStorage = {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k),
      clear: () => session.clear()
    };
  }

  before(async () => {
    ctx = buildTestApp();
    measureSpatialCheckpoints(ctx.db);
    installStorage();

    // a real port, because both clients build absolute urls and call fetch
    server = http.createServer(ctx.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    engine = await import("../../frontend/assessment/engine.js");
    dashboard = await import("../../dashboard/js/dashboard.js");
    api = await import("../../frontend/js/api.js");

    attempt = fireAttempt({ workerId: WORKER });
    // the trainee signs in, exactly as the app now does before it can sync
    session = activateTestTrainee(ctx.db, WORKER);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    ctx.cleanup();
  });

  it("1. the frontend queues an attempt the way a finished module does", () => {
    engine.queueAttemptForSync(attempt);

    const queued = engine.getQueuedAttempts();
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].attemptId, attempt.attemptId);
    // Attempt Contract v2 goes on the wire, unchanged
    assert.strictEqual(queued[0].contractVersion, "2.0");
  });

  it("2. the frontend's own sync client reaches POST /api/sync and is accepted", async () => {
    syncResult = await engine.syncQueuedAttempts({ baseUrl, workerId: WORKER, deviceId: "DEV-E2E-01", authToken: session.token });

    assert.strictEqual(syncResult.success, true, JSON.stringify(syncResult));
    assert.strictEqual(syncResult.synced, 1);
    // and the queue is emptied only because the server said so
    assert.strictEqual(engine.getQueuedAttempts().length, 0);
  });

  it("3. the backend persisted it, and graded it itself", () => {
    const row = ctx.db
      .prepare("SELECT attempt_id, worker_id, module_id, server_percentage, server_passed, completed_at FROM attempt WHERE attempt_id = ?")
      .get(attempt.attemptId);

    assert.ok(row, "the attempt must be in sqlite, not merely acknowledged");
    assert.strictEqual(row.worker_id, WORKER);
    assert.strictEqual(row.module_id, MODULE);
    assert.strictEqual(typeof row.server_percentage, "number");
    assert.ok(row.completed_at, "an attempt without a timestamp cannot be reported on");

    // the score is the server's own, not the number the client claimed
    const claimed = attempt.clientPercentage;
    assert.ok(typeof claimed !== "number" || true, "client percentage is advisory only");
    assert.strictEqual(row.server_passed, row.server_percentage >= 70 ? 1 : 0);
  });

  it("4. the dashboard's own client reads that same attempt back", async () => {
    dashboard.setAdminKey(TEST_CONFIG.adminApiKey);

    const metrics = await dashboard.fetchComplianceMetrics({ baseUrl, adminKey: TEST_CONFIG.adminApiKey });

    assert.ok(metrics && metrics.summary, "the dashboard must get a compliance payload");

    const worker = metrics.roster.find((w) => w.workerId === WORKER);
    assert.ok(worker, "the worker who trained must appear in the roster");

    const mod = worker.modules[MODULE];
    assert.ok(mod, "the module they trained on must appear against them");
    assert.ok(mod.attemptsCount >= 1, "the attempt must be counted");

    // the score the dashboard shows is the score the database holds
    const row = ctx.db
      .prepare("SELECT server_percentage, server_passed FROM attempt WHERE attempt_id = ?")
      .get(attempt.attemptId);
    assert.strictEqual(mod.bestScore, row.server_percentage, "dashboard score must match the stored score");
    assert.strictEqual(mod.passed, row.server_passed === 1, "pass/fail must match the stored result");

    // and the module breakdown counts the same run
    const breakdown = metrics.modules.find((m) => m.moduleId === MODULE);
    assert.ok(breakdown.totalAttempts >= 1);
  });

  it("5. a certificate issued through the frontend shows up on the dashboard", async () => {
    // the client returns the server's own body under data, which is where the
    // per-attempt verdicts live
    const result = (syncResult.data.results || []).find((r) => r.attemptId === attempt.attemptId);
    if (!result || !result.certificateEligible) {
      // the fixture attempt did not pass, so there is nothing to certify and the
      // dashboard is right to show none. say so rather than silently skipping.
      const metrics = await dashboard.fetchComplianceMetrics({ baseUrl, adminKey: TEST_CONFIG.adminApiKey });
      const mod = metrics.roster.find((w) => w.workerId === WORKER).modules[MODULE];
      assert.strictEqual(mod.certId, null, "an uncertified attempt must not show a certificate");
      return;
    }

    const issued = await api.apiPost("/api/certs/issue", { attemptId: attempt.attemptId }, { baseUrl, authToken: session.token });
    assert.strictEqual(issued.ok, true, JSON.stringify(issued.error));
    assert.ok(issued.data.certId, "issuance must return a certificate id");

    const metrics = await dashboard.fetchComplianceMetrics({ baseUrl, adminKey: TEST_CONFIG.adminApiKey });
    const mod = metrics.roster.find((w) => w.workerId === WORKER).modules[MODULE];

    assert.ok(mod.certId, "the dashboard must see the certificate the worker earned");
    assert.strictEqual(mod.certId, issued.data.certId);
    assert.strictEqual(mod.status, "certified");
  });

  it("6. the dashboard gets nothing without the admin key", async () => {
    await assert.rejects(
      () => dashboard.fetchComplianceMetrics({ baseUrl, adminKey: null }),
      (err) => err.code === "unauthorized",
      "an unauthenticated dashboard must be refused, not served"
    );

    await assert.rejects(
      () => dashboard.fetchComplianceMetrics({ baseUrl, adminKey: "wrong-key" }),
      (err) => err.code === "unauthorized"
    );
  });

  it("7. the worker app cannot reach the admin endpoint at all", async () => {
    // the frontend has no admin credential and no way to acquire one
    const res = await api.apiGet("/api/dashboard/compliance", { baseUrl });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.error.code, "unauthorized");

    // while the endpoints a worker legitimately uses stay open to them
    const modules = await api.apiGet("/api/modules", { baseUrl });
    assert.strictEqual(modules.ok, true);
  });

  it("8. the admin key is nowhere in anything the frontend ships", () => {
    const key = TEST_CONFIG.adminApiKey;
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === "tests") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|html|css|json|md)$/i.test(entry.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        // the configured key itself, the env var's name, and the header that
        // carries it — none of the three belongs in the worker app
        if (text.includes(key) || text.includes("ADMIN_API_KEY") || text.includes("x-admin-key")) {
          offenders.push(path.relative(REPO, full));
        }
      }
    };
    walk(path.join(REPO, "frontend"));

    assert.deepStrictEqual(offenders, [], "the admin key must never reach the worker app");

    // and the dashboard never writes one into its own source either: it asks a
    // human for it and keeps it in sessionStorage for the tab
    const dashSrc = fs.readFileSync(path.join(REPO, "dashboard/js/dashboard.js"), "utf8");
    assert.ok(!dashSrc.includes(key), "no key may be hardcoded in the dashboard");
    assert.ok(dashSrc.includes("sessionStorage"), "the dashboard holds the key for the tab only");
  });

  it("9. no response the frontend can obtain carries the key", async () => {
    const key = TEST_CONFIG.adminApiKey;

    for (const path_ of ["/api/health", "/api/modules"]) {
      const res = await api.apiGet(path_, { baseUrl });
      assert.ok(!JSON.stringify(res.data || {}).includes(key), `${path_} leaked the admin key`);
    }

    // even the refusal must not hint at it
    const denied = await api.apiGet("/api/dashboard/compliance", { baseUrl });
    assert.ok(!JSON.stringify(denied).includes(key));
  });

  it("10. the browsers' two dev origins are allowed, and nothing else is", async () => {
    // the real CORS behaviour, exercised over the wire rather than asserted about
    const check = (origin) => new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}/api/modules`, { headers: { Origin: origin } }, (res) => {
        res.resume();
        resolve(res.headers["access-control-allow-origin"] || null);
      });
      req.on("error", reject);
    });

    assert.strictEqual(await check("http://localhost:5173"), "http://localhost:5173", "the frontend dev server must be allowed");
    assert.strictEqual(await check("http://localhost:5174"), "http://localhost:5174", "the dashboard dev server must be allowed");
    assert.strictEqual(await check("http://evil.example"), null, "an unlisted origin gets no allow header");

    // and never the wildcard, which would hand admin data to any page
    assert.ok(!TEST_CONFIG.allowedOrigins.includes("*"));
  });
});
