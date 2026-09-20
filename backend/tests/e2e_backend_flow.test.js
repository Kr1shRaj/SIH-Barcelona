process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { Buffer } = require("node:buffer");
const request = require("supertest");
const { buildTestApp, measureSpatialCheckpoints, TEST_CONFIG, activateTestTrainee, asTrainee } = require("./helpers/app");
const { fireAttempt, gasAttempt, syncEnvelope } = require("./fixtures/attempts");

// one worker walks the whole backend once: manifest, attempt, grade, certificate,
// verification, replay, forgery, rejection, mixed batch, dashboard.
// every step below asserts against the state the previous step actually left.
describe("End to end backend flow", () => {
  let ctx = null;
  const WORKER = "WRK-0001";
  const SECOND_BATCH = "c0ffee00-1111-4222-8333-444455556666";
  const THIRD_BATCH = "d0d0caca-2222-4333-8444-555566667777";
  const BAD_ATTEMPT = "11111111-2222-4333-8444-555566667777";

  let attempt = null;
  let certId = null;
  let qr = null;

  let session = null;

  before(() => {
    ctx = buildTestApp();
    // the shipped seed leaves the two spatial checkpoints unmeasured on purpose,
    // so nothing can certify. give the manifest a measured angle for this run.
    measureSpatialCheckpoints(ctx.db);
    attempt = fireAttempt({ workerId: WORKER });
    // the worker signs in once, the way a device does, and every call below
    // carries that session
    session = activateTestTrainee(ctx.db, WORKER);
  });

  after(() => ctx.cleanup());

  it("1. serves module definitions without leaking scoring rules", async () => {
    const res = await request(ctx.app).get("/api/modules");

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body) && res.body.length === 3);

    const body = JSON.stringify(res.body);
    assert.ok(!body.includes("expected_value") && !body.includes("expectedValue"),
      "the answer key must never leave the server");
    assert.ok(!body.includes("sound_alarm_then_evacuate"), "no correct answer may appear in the manifest");

    const fire = res.body.find((m) => m.moduleId === "fire-response");
    assert.strictEqual(fire.version, 1, "module version must be deterministic");
    assert.ok(fire.requiredCheckpoints.length > 0);
  });

  it("2. accepts a valid attempt over /api/sync", async () => {
    const res = await request(ctx.app)
      .post("/api/sync")
      .set(asTrainee(session))
      .send(syncEnvelope([attempt], { workerId: WORKER }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.accepted, 1);
    assert.strictEqual(res.body.rejected, 0);
    assert.strictEqual(res.body.results[0].status, "accepted");
  });

  it("3. recomputes the score itself rather than taking the client's word", async () => {
    const row = ctx.db
      .prepare("SELECT server_percentage, server_passed, threshold_applied, grading_status, client_percentage FROM attempt WHERE attempt_id = ?")
      .get(attempt.attemptId);

    assert.strictEqual(row.server_percentage, 91.67);
    assert.strictEqual(row.threshold_applied, 0.7, "threshold comes from the module row");
    assert.strictEqual(row.grading_status, "graded");
    assert.strictEqual(row.client_percentage, attempt.clientClaimedPercentage,
      "the claim is kept as evidence, beside the server number");
  });

  it("4. marks the attempt passed and certificate eligible", async () => {
    const row = ctx.db.prepare("SELECT server_passed FROM attempt WHERE attempt_id = ?").get(attempt.attemptId);
    assert.strictEqual(row.server_passed, 1);
  });

  it("5. issues a certificate for that attempt", async () => {
    const res = await request(ctx.app).post("/api/certs/issue").set(asTrainee(session)).send({ attemptId: attempt.attemptId });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.status, "issued");
    assert.match(res.body.certId, /^SAFEAR-[0-9A-F]{16}$/);
    assert.strictEqual(res.body.algo, "Ed25519");
    assert.match(res.body.qrImage, /^data:image\/png;base64,/);

    certId = res.body.certId;
    qr = res.body.qr;
  });

  it("6. signs the server score, never the claimed one", async () => {
    const row = ctx.db.prepare("SELECT score, attempt_id, key_id FROM certificate WHERE cert_id = ?").get(certId);
    assert.strictEqual(row.score, 91.67);
    assert.strictEqual(row.attempt_id, attempt.attemptId);
    assert.ok(row.key_id, "the issuing key must be recorded for rotation");
  });

  it("7. verifies that certificate by its id", async () => {
    const res = await request(ctx.app).post("/api/certs/verify").send({ certId });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, "valid");
    assert.strictEqual(res.body.checks.signature, "pass");
    assert.strictEqual(res.body.checks.record, "found");
    assert.strictEqual(res.body.checks.revocation, "active");
  });

  it("8. verifies the same certificate from its scanned qr", async () => {
    const res = await request(ctx.app).post("/api/certs/verify").send({ qr });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, "valid");
    assert.strictEqual(res.body.certificate.certId, certId);
    assert.strictEqual(res.body.mode, "qr");
  });

  it("9. stores canonical bytes that still match the signature", async () => {
    const row = ctx.db.prepare("SELECT payload_json, signature FROM certificate WHERE cert_id = ?").get(certId);
    const rebuilt =
      Buffer.from(row.payload_json, "utf8").toString("base64url") + "." + row.signature;

    const res = await request(ctx.app).post("/api/certs/verify").send({ qr: rebuilt });
    assert.strictEqual(res.body.verdict, "valid", "stored bytes must reproduce the issued qr exactly");
  });

  it("10. treats a replayed attempt as a duplicate, not a second run", async () => {
    const res = await request(ctx.app)
      .post("/api/sync")
      .set(asTrainee(session))
      .send(syncEnvelope([attempt], { workerId: WORKER, batchId: SECOND_BATCH }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.duplicates, 1);
    assert.strictEqual(res.body.accepted, 0);

    const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM attempt WHERE attempt_id = ?").get(attempt.attemptId).n;
    assert.strictEqual(n, 1);
    const cps = ctx.db.prepare("SELECT COUNT(*) AS n FROM checkpoint_result WHERE attempt_id = ?").get(attempt.attemptId).n;
    assert.strictEqual(cps, 3, "a replay must not duplicate checkpoints either");
  });

  it("11. hands the same certificate back when issuance is retried", async () => {
    const res = await request(ctx.app).post("/api/certs/issue").set(asTrainee(session)).send({ attemptId: attempt.attemptId });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "already_issued");
    assert.strictEqual(res.body.certId, certId);

    const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM certificate WHERE attempt_id = ?").get(attempt.attemptId).n;
    assert.strictEqual(n, 1, "a retry must never mint a second certificate");
  });

  it("12. rejects a certificate whose payload was edited after signing", async () => {
    const [payloadPart, signaturePart] = qr.split(".");
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    payload.w = "WRK-9999";
    const forged = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + signaturePart;

    const res = await request(ctx.app).post("/api/certs/verify").send({ qr: forged });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verdict, "invalid");
    assert.strictEqual(res.body.checks.signature, "fail");
  });

  it("13. rejects an attempt that skipped a required checkpoint", async () => {
    const partial = fireAttempt({ workerId: WORKER, attemptId: BAD_ATTEMPT });
    partial.checkpoints.pop();

    const res = await request(ctx.app)
      .post("/api/sync")
      .set(asTrainee(session))
      .send(syncEnvelope([partial], { workerId: WORKER, batchId: THIRD_BATCH }));

    assert.strictEqual(res.status, 422, "a batch where nothing landed is not a success");
    assert.strictEqual(res.body.results[0].status, "rejected");
    assert.ok(res.body.results[0].issues.some((i) => i.code === "missing_required_checkpoint"));
    assert.ok(!ctx.db.prepare("SELECT 1 FROM attempt WHERE attempt_id = ?").get(BAD_ATTEMPT));
  });

  it("14. keeps the good half of a mixed batch and names the bad half", async () => {
    // one signed in worker per batch now, so both attempts are this worker's and
    // the bad one is bad for a reason the session cannot settle: an unknown module
    const good = gasAttempt({ workerId: WORKER });
    const bad = fireAttempt({ moduleId: "not-a-real-module", attemptId: BAD_ATTEMPT });

    const res = await request(ctx.app)
      .post("/api/sync")
      .set(asTrainee(session))
      .send(syncEnvelope([good, bad], { workerId: WORKER, batchId: "e1e1e1e1-3333-4444-8555-666677778888" }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.accepted, 1);
    assert.strictEqual(res.body.rejected, 1);

    const rejection = res.body.results.find((r) => r.status === "rejected");
    assert.strictEqual(rejection.reason, "unknown_module");
    assert.ok(rejection.message.includes("not-a-real-module"), "the rejection must say what was wrong");

    assert.ok(ctx.db.prepare("SELECT 1 FROM attempt WHERE attempt_id = ?").get(good.attemptId),
      "the valid attempt must survive its neighbour");
    assert.ok(!ctx.db.prepare("SELECT 1 FROM attempt WHERE attempt_id = ?").get(BAD_ATTEMPT));
  });

  it("15. refuses the dashboard without an admin key", async () => {
    const res = await request(ctx.app).get("/api/dashboard/compliance");
    assert.strictEqual(res.status, 401);
  });

  it("16. serves compliance data to an authenticated admin", async () => {
    const res = await request(ctx.app)
      .get("/api/dashboard/compliance")
      .set("x-admin-key", TEST_CONFIG.adminApiKey);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.roster));
    assert.ok(res.body.roster.length > 0);
    assert.strictEqual(res.body.summary.certifiedWorkers, 1);

    const worker = res.body.roster.find((w) => w.workerId === WORKER);
    assert.ok(worker, "the worker who trained must appear on the roster");
  });

  it("17. reports the same shape twice in a row", async () => {
    const call = () => request(ctx.app)
      .get("/api/dashboard/compliance")
      .set("x-admin-key", TEST_CONFIG.adminApiKey);

    const first = await call();
    const second = await call();

    // generatedAt moves, nothing else may
    delete first.body.generatedAt;
    delete second.body.generatedAt;
    assert.deepStrictEqual(first.body, second.body, "dashboard output must be deterministic");
  });

  it("18. leaves exactly one certificate behind for the whole run", () => {
    const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n;
    assert.strictEqual(n, 1);
  });
});
