const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { Buffer } = require("node:buffer");
const request = require("supertest");
const { buildTestApp } = require("./helpers/app");
const { testKeys, otherKeys, samplePayload } = require("./fixtures/certs");
const { signCertificate } = require("../services/certs/signer");
const { canonicalize, buildQrPayload } = require("../services/certs/canonical");

let ctx = null;

const PASSED_ATTEMPT = "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51";
const FAILED_ATTEMPT = "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64";
const MISSING_ATTEMPT = "11111111-2222-4333-8444-555566667777";

const KEYS = testKeys();

function issue(attemptId) {
  return request(ctx.app).post("/api/certs/issue").send({ attemptId });
}
function verify(body) {
  return request(ctx.app).post("/api/certs/verify").send(body);
}

// put an attempt straight into the db so issuance has something to work from
function insertAttempt(attemptId, passed, percentage) {
  ctx.db
    .prepare(
      `INSERT INTO attempt (
         attempt_id, worker_id, module_id, module_version, contract_version,
         started_at, completed_at, duration_ms, status,
         server_total_score, server_max_score, server_percentage, server_passed,
         threshold_applied, client_percentage, client_passed, server_received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      attemptId, "WRK-0001", "fire-response", 1, "1.0",
      "2026-09-03T10:00:00.000Z", "2026-09-03T10:03:00.000Z", 180000, "completed",
      (percentage / 100) * 3, 3, percentage, passed ? 1 : 0,
      0.7, percentage, passed ? 1 : 0, "2026-09-03T10:05:00.000Z"
    );
}

describe("POST /api/certs/issue", () => {
  beforeEach(() => {
    ctx = buildTestApp();
    insertAttempt(PASSED_ATTEMPT, true, 91.67);
    insertAttempt(FAILED_ATTEMPT, false, 42);
  });
  afterEach(() => ctx.cleanup());

  describe("happy path", () => {
    it("issues a new certificate with 201", async () => {
      const res = await issue(PASSED_ATTEMPT);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.status, "issued");
      assert.match(res.body.certId, /^SAFEAR-[0-9A-F]{16}$/);
      assert.strictEqual(res.body.algo, "Ed25519");
      assert.ok(res.body.requestId);
    });

    it("returns a qr string and a rendered image the phone can cache", async () => {
      const res = await issue(PASSED_ATTEMPT);

      assert.strictEqual(res.body.qr.split(".").length, 2);
      assert.match(res.body.qrImage, /^data:image\/png;base64,/);
    });

    it("takes the score from the stored attempt, not the caller", async () => {
      const res = await issue(PASSED_ATTEMPT);
      assert.strictEqual(res.body.payload.s, 9167);
      assert.strictEqual(res.body.payload.w, "WRK-0001");
      assert.strictEqual(res.body.payload.m, "fire-response");
    });

    it("issues with no expiry while recert_months is unset", async () => {
      const res = await issue(PASSED_ATTEMPT);
      assert.strictEqual(res.body.payload.e, null);
    });

    it("persists the certificate row", async () => {
      const res = await issue(PASSED_ATTEMPT);
      const row = ctx.db.prepare("SELECT * FROM certificate WHERE cert_id = ?").get(res.body.certId);

      assert.ok(row);
      assert.strictEqual(row.attempt_id, PASSED_ATTEMPT);
      assert.strictEqual(row.key_id, KEYS.keyId);
    });

    it("issues a certificate that verifies straight away", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ qr: issued.body.qr });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.verdict, "valid");
    });
  });

  describe("duplicate issuance is idempotent", () => {
    it("returns 200 and the existing certificate on a retry", async () => {
      const first = await issue(PASSED_ATTEMPT);
      const second = await issue(PASSED_ATTEMPT);

      assert.strictEqual(second.status, 200);
      assert.strictEqual(second.body.status, "already_issued");
      assert.strictEqual(second.body.certId, first.body.certId);
    });

    it("hands back the same scannable qr on the retry", async () => {
      const first = await issue(PASSED_ATTEMPT);
      const second = await issue(PASSED_ATTEMPT);

      assert.strictEqual(second.body.qr, first.body.qr);
      assert.match(second.body.qrImage, /^data:image\/png;base64,/);
    });

    it("does not create a second certificate row", async () => {
      await issue(PASSED_ATTEMPT);
      await issue(PASSED_ATTEMPT);

      assert.strictEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n, 1);
    });

    it("the replayed certificate still verifies", async () => {
      await issue(PASSED_ATTEMPT);
      const second = await issue(PASSED_ATTEMPT);
      const res = await verify({ qr: second.body.qr });

      assert.strictEqual(res.body.verdict, "valid");
    });
  });

  describe("refusals", () => {
    it("404s an attempt that does not exist", async () => {
      const res = await issue(MISSING_ATTEMPT);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, "attempt_not_found");
      assert.ok(res.body.error.requestId);
    });

    it("422s an attempt that did not pass", async () => {
      const res = await issue(FAILED_ATTEMPT);
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, "attempt_not_passed");
    });

    it("stores nothing when it refuses a failed attempt", async () => {
      await issue(FAILED_ATTEMPT);
      assert.strictEqual(ctx.db.prepare("SELECT COUNT(*) AS n FROM certificate").get().n, 0);
    });

    it("400s a malformed attemptId", async () => {
      const res = await issue("not-a-uuid");
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "validation_failed");
    });

    it("400s a missing body", async () => {
      assert.strictEqual((await request(ctx.app).post("/api/certs/issue").send({})).status, 400);
    });
  });

  describe("the client cannot claim anything", () => {
    const forbidden = [
      ["workerId", { attemptId: PASSED_ATTEMPT, workerId: "WRK-9999" }],
      ["moduleId", { attemptId: PASSED_ATTEMPT, moduleId: "gas-leak" }],
      ["score", { attemptId: PASSED_ATTEMPT, score: 100 }],
      ["expiry", { attemptId: PASSED_ATTEMPT, expiresAt: "2099-01-01T00:00:00.000Z" }],
      ["certId", { attemptId: PASSED_ATTEMPT, certId: "SAFEAR-AAAAAAAAAAAAAAAA" }],
      ["signature", { attemptId: PASSED_ATTEMPT, signature: "forged" }]
    ];

    forbidden.forEach(([field, body]) => {
      it(`rejects a body that supplies ${field}`, async () => {
        const res = await request(ctx.app).post("/api/certs/issue").send(body);
        assert.strictEqual(res.status, 400, `${field} must not be accepted`);
      });
    });
  });
});

describe("POST /api/certs/verify", () => {
  beforeEach(() => {
    ctx = buildTestApp();
    insertAttempt(PASSED_ATTEMPT, true, 91.67);
  });
  afterEach(() => ctx.cleanup());

  describe("a genuine certificate", () => {
    it("verifies by qr with every check passing", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ qr: issued.body.qr });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.verdict, "valid");
      assert.strictEqual(res.body.reason, "ok");
      assert.strictEqual(res.body.mode, "qr");
      assert.deepStrictEqual(res.body.checks, {
        signature: "pass",
        payload: "pass",
        key: "pass",
        expiry: "none",
        record: "found",
        revocation: "active"
      });
    });

    it("verifies by certId and still runs the cryptography", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ certId: issued.body.certId });

      assert.strictEqual(res.body.verdict, "valid");
      assert.strictEqual(res.body.mode, "certId");
      assert.strictEqual(res.body.checks.signature, "pass", "a typed cert id must still be signature checked");
    });

    it("returns only the safe certificate fields", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ qr: issued.body.qr });

      assert.deepStrictEqual(Object.keys(res.body.certificate).sort(), [
        "algo", "certId", "expiresAt", "issuedAt", "keyId", "moduleId", "revoked", "score", "workerId"
      ]);
    });

    it("never leaks the attempt id, raw payload, signature or a rebuilt qr", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ certId: issued.body.certId });
      const body = JSON.stringify(res.body);

      assert.ok(!body.includes(PASSED_ATTEMPT), "attemptId must not leak");
      assert.ok(!body.includes("payload_json"), "raw payload column must not leak");
      assert.ok(res.body.qr === undefined, "a rebuilt qr must not be handed out");
      assert.ok(res.body.signature === undefined, "raw signature must not be handed out");
    });

    it("carries a request id", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      assert.ok((await verify({ qr: issued.body.qr })).body.requestId);
    });
  });

  describe("cryptographic validity", () => {
    it("rejects a tampered payload as bad_signature and returns no certificate", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const bent = Object.assign({}, issued.body.payload, { s: 10000 });
      const sig = issued.body.qr.split(".")[1];
      const forged = Buffer.from(JSON.stringify(bent, Object.keys(bent).sort())).toString("base64url") + "." + sig;

      const res = await verify({ qr: forged });

      assert.strictEqual(res.status, 200, "a forgery is a successful verification");
      assert.strictEqual(res.body.verdict, "invalid");
      assert.strictEqual(res.body.reason, "bad_signature");
      assert.strictEqual(res.body.checks.signature, "fail");
      assert.strictEqual(res.body.certificate, null, "nothing may be derived from untrusted bytes");
    });

    it("rejects a certificate signed by a foreign key", async () => {
      const impostor = otherKeys();
      const forged = signCertificate(samplePayload({ k: impostor.keyId }), impostor.privateKey);

      const res = await verify({ qr: forged.qr });
      assert.strictEqual(res.body.verdict, "invalid");
      assert.strictEqual(res.body.reason, "bad_signature");
      assert.strictEqual(res.body.certificate, null);
    });

    it("reports a malformed qr without claiming the signature failed", async () => {
      const res = await verify({ qr: "this-is-not-a-certificate" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.reason, "malformed");
      assert.strictEqual(res.body.checks.payload, "malformed");
      assert.strictEqual(res.body.checks.signature, "not_evaluated");
    });
  });

  describe("version and key checks", () => {
    it("flags an unknown payload version", async () => {
      const forged = signCertificate(samplePayload({ v: 99 }), KEYS.privateKey);
      const res = await verify({ qr: forged.qr });

      assert.strictEqual(res.body.reason, "unknown_version");
      assert.strictEqual(res.body.checks.signature, "pass");
      assert.strictEqual(res.body.checks.payload, "unknown_version");
    });

    it("flags a key id this server does not hold", async () => {
      const forged = signCertificate(samplePayload({ k: "someOtherKid" }), KEYS.privateKey);
      const res = await verify({ qr: forged.qr });

      assert.strictEqual(res.body.reason, "unknown_key");
      assert.strictEqual(res.body.checks.signature, "pass");
      assert.strictEqual(res.body.checks.key, "unknown");
    });
  });

  describe("online database existence", () => {
    it("rejects a perfectly signed certificate that was never issued here", async () => {
      // signed with the real key but absent from the database: a stolen key, or a
      // different deployment. offline verification cannot catch this one.
      const orphan = signCertificate(samplePayload(), KEYS.privateKey);
      const res = await verify({ qr: orphan.qr });

      assert.strictEqual(res.body.verdict, "invalid");
      assert.strictEqual(res.body.reason, "not_on_record");
      assert.strictEqual(res.body.checks.signature, "pass");
      assert.strictEqual(res.body.checks.record, "not_found");
    });

    it("reports not_on_record for an unknown certId", async () => {
      const res = await verify({ certId: "SAFEAR-FFFFFFFFFFFFFFFF" });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.reason, "not_on_record");
      assert.strictEqual(res.body.checks.record, "not_found");
      assert.strictEqual(res.body.certificate, null);
    });
  });

  describe("revocation", () => {
    it("rejects a revoked certificate", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      ctx.db.prepare("UPDATE certificate SET revoked = 1, revoked_at = ? WHERE cert_id = ?")
        .run("2026-09-03T13:00:00.000Z", issued.body.certId);

      const res = await verify({ qr: issued.body.qr });

      assert.strictEqual(res.body.verdict, "invalid");
      assert.strictEqual(res.body.reason, "revoked");
      assert.strictEqual(res.body.checks.revocation, "revoked");
      assert.strictEqual(res.body.checks.signature, "pass", "a revoked cert is still cryptographically sound");
      assert.strictEqual(res.body.certificate.revoked, true);
    });

    it("reports revocation as active for a live certificate", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ certId: issued.body.certId });
      assert.strictEqual(res.body.checks.revocation, "active");
    });
  });

  describe("expiry", () => {
    it("rejects an expired certificate but still identifies it", async () => {
      // module now carries a recertification period, so the certificate gets an expiry
      const expired = signCertificate(
        samplePayload({ e: Math.floor(Date.now() / 1000) - 3600 }),
        KEYS.privateKey
      );
      const res = await verify({ qr: expired.qr });

      assert.strictEqual(res.body.verdict, "invalid");
      assert.strictEqual(res.body.checks.expiry, "expired");
      assert.strictEqual(res.body.checks.signature, "pass");
    });

    it("reports expiry none while recert_months is unset", async () => {
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ qr: issued.body.qr });
      assert.strictEqual(res.body.checks.expiry, "none");
    });

    it("reports expiry valid for a dated certificate still in date", async () => {
      ctx.db.prepare("UPDATE module SET recert_months = 12 WHERE module_id = ?").run("fire-response");
      const issued = await issue(PASSED_ATTEMPT);
      const res = await verify({ qr: issued.body.qr });

      assert.strictEqual(res.body.checks.expiry, "valid");
      assert.strictEqual(res.body.verdict, "valid");
    });
  });

  describe("severity ordering", () => {
    it("reports revoked rather than expired when both are true", async () => {
      ctx.db.prepare("UPDATE module SET recert_months = 12 WHERE module_id = ?").run("fire-response");
      const issued = await issue(PASSED_ATTEMPT);
      ctx.db.prepare("UPDATE certificate SET revoked = 1 WHERE cert_id = ?").run(issued.body.certId);

      // re-sign the same cert id with an expiry in the past
      const stored = ctx.db.prepare("SELECT payload_json FROM certificate WHERE cert_id = ?").get(issued.body.certId);
      const payload = Object.assign(JSON.parse(stored.payload_json), { e: Math.floor(Date.now() / 1000) - 60 });
      const requeued = buildQrPayload(
        canonicalize(payload),
        signCertificate(payload, KEYS.privateKey).signature
      );

      const res = await verify({ qr: requeued });
      assert.strictEqual(res.body.reason, "revoked", "revocation outranks expiry");
      assert.strictEqual(res.body.checks.expiry, "expired");
    });
  });

  describe("malformed requests are the only 4xx", () => {
    it("400s when neither qr nor certId is supplied", async () => {
      const res = await verify({});
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "validation_failed");
    });

    it("400s when both are supplied", async () => {
      const res = await verify({ qr: "a.b", certId: "SAFEAR-FFFFFFFFFFFFFFFF" });
      assert.strictEqual(res.status, 400);
    });

    it("400s a certId that is not our format", async () => {
      assert.strictEqual((await verify({ certId: "nope" })).status, 400);
    });

    it("400s an unknown field", async () => {
      assert.strictEqual((await verify({ qr: "a.b", extra: true })).status, 400);
    });

    it("400s a qr over the 4096 character cap", async () => {
      assert.strictEqual((await verify({ qr: "a".repeat(5000) })).status, 400);
    });
  });
});
