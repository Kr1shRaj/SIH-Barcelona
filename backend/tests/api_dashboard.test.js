const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");

let ctx = null;

describe("GET /api/dashboard/compliance", () => {
  before(() => {
    ctx = buildTestApp();
  });
  after(() => ctx.cleanup());

  it("serves compliance summary on /api/dashboard/compliance and /api/dashboard", async () => {
    const res1 = await request(ctx.app).get("/api/dashboard/compliance");
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(typeof res1.body.summary, "object");
    assert.strictEqual(res1.body.summary.totalWorkers, 6);

    const res2 = await request(ctx.app).get("/api/dashboard");
    assert.strictEqual(res2.status, 200);
    assert.deepStrictEqual(res1.body.summary, res2.body.summary);
  });

  it("accurately reports initial seed state with zero attempts", async () => {
    const res = await request(ctx.app).get("/api/dashboard/compliance");
    const { summary, modules, mines, contractors, roster } = res.body;

    assert.strictEqual(summary.totalWorkers, 6);
    assert.strictEqual(summary.fullyCompliantWorkers, 0);
    assert.strictEqual(summary.partiallyCompliantWorkers, 0);
    assert.strictEqual(summary.nonCompliantWorkers, 6);
    assert.strictEqual(summary.complianceRate, 0);
    assert.strictEqual(summary.certifiedWorkers, 0);
    assert.strictEqual(summary.totalAttempts, 0);
    assert.strictEqual(summary.certificateSystemStatus.isImplemented, false);

    assert.strictEqual(modules.length, 2);
    assert.strictEqual(mines.length, 2);
    assert.strictEqual(contractors.length, 2);
    assert.strictEqual(roster.length, 6);

    // check each worker starts as non_compliant
    roster.forEach((w) => {
      assert.strictEqual(w.overallStatus, "non_compliant");
      assert.strictEqual(w.passedModulesCount, 0);
      assert.strictEqual(w.modules["fire-response"].status, "not_started");
      assert.strictEqual(w.modules["gas-leak"].status, "not_started");
    });
  });

  it("recalculates compliance when an attempt is ingested into the database", async () => {
    const db = ctx.db;
    const now = new Date().toISOString();

    // insert sync_batch
    db.prepare(`
      INSERT INTO sync_batch (batch_id, worker_id, device_id, received_at, attempt_count)
      VALUES ('batch-test-1', 'WRK-0001', 'dev-1', ?, 1)
    `).run(now);

    // insert attempt for WRK-0001 passing fire-response
    db.prepare(`
      INSERT INTO attempt (
        attempt_id, worker_id, module_id, module_version, contract_version,
        engine_version, device_id, ar_tier, locale,
        started_at, completed_at, duration_ms, status,
        server_total_score, server_max_score, server_percentage, server_passed,
        threshold_applied, client_percentage, client_passed, client_claim_mismatch,
        sync_batch_id, server_received_at
      ) VALUES (
        'att-dash-1', 'WRK-0001', 'fire-response', 1, '1.0',
        '1.0.0', 'dev-1', 2, 'hi',
        ?, ?, 45000, 'completed',
        2.85, 3.0, 95.0, 1,
        0.7, 95.0, 1, 0,
        'batch-test-1', ?
      )
    `).run(now, now, now);

    const res = await request(ctx.app).get("/api/dashboard/compliance");
    const { summary, modules, roster } = res.body;

    assert.strictEqual(summary.totalAttempts, 1);
    assert.strictEqual(summary.partiallyCompliantWorkers, 1);
    assert.strictEqual(summary.fullyCompliantWorkers, 0);

    const w1 = roster.find((w) => w.workerId === "WRK-0001");
    assert.strictEqual(w1.overallStatus, "in_progress");
    assert.strictEqual(w1.passedModulesCount, 1);
    assert.strictEqual(w1.modules["fire-response"].passed, true);
    assert.strictEqual(w1.modules["fire-response"].bestScore, 95.0);

    const fireMod = modules.find((m) => m.moduleId === "fire-response");
    assert.strictEqual(fireMod.totalAttempts, 1);
    assert.strictEqual(fireMod.uniqueWorkersPassed, 1);
    assert.strictEqual(fireMod.averageScore, 95.0);

    // now pass second module (gas-leak) for WRK-0001
    db.prepare(`
      INSERT INTO attempt (
        attempt_id, worker_id, module_id, module_version, contract_version,
        engine_version, device_id, ar_tier, locale,
        started_at, completed_at, duration_ms, status,
        server_total_score, server_max_score, server_percentage, server_passed,
        threshold_applied, client_percentage, client_passed, client_claim_mismatch,
        sync_batch_id, server_received_at
      ) VALUES (
        'att-dash-2', 'WRK-0001', 'gas-leak', 1, '1.0',
        '1.0.0', 'dev-1', 2, 'hi',
        ?, ?, 50000, 'completed',
        3.0, 3.0, 100.0, 1,
        0.7, 100.0, 1, 0,
        'batch-test-1', ?
      )
    `).run(now, now, now);

    const res2 = await request(ctx.app).get("/api/dashboard/compliance");
    assert.strictEqual(res2.body.summary.fullyCompliantWorkers, 1);
    assert.strictEqual(res2.body.summary.partiallyCompliantWorkers, 0);
    // 1 / 6 = 16.7%
    assert.strictEqual(res2.body.summary.complianceRate, 16.7);

    // MINE-JH-001 has 3 workers (WRK-0001, WRK-0002, WRK-0003), 1 compliant = 33.3%
    const mine1 = res2.body.mines.find((m) => m.mineId === "MINE-JH-001");
    assert.strictEqual(mine1.compliantWorkers, 1);
    assert.strictEqual(mine1.complianceRate, 33.3);
  });

  it("handles certificate records correctly when present", async () => {
    const db = ctx.db;
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO certificate (
        cert_id, worker_id, module_id, attempt_id, score, issued_at, expires_at,
        algo, key_id, signature, payload_json, revoked
      ) VALUES (
        'cert-test-1', 'WRK-0001', 'fire-response', 'att-dash-1', 95.0,
        ?, ?, 'Ed25519', 'testkey', 'sig-test', '{}', 0
      )
    `).run(pastDate, pastDate);

    const res = await request(ctx.app).get("/api/dashboard/compliance");
    assert.strictEqual(res.body.summary.certifiedWorkers, 1);
    assert.strictEqual(res.body.summary.expiredCertificates, 1);

    const expiredAttention = res.body.attentionItems.find((item) => item.type === "cert_expired");
    assert.ok(expiredAttention, "Should flag expired certificate in attention items");
  });
});
