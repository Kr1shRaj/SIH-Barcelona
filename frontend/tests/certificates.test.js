// Certificate infrastructure tests.
//
// The settle rule mirrors the sync queue fix: a pending certificate is only cleared
// when the server has definitively settled it. 201 and 200 already_issued settle it,
// 400 and 422 kill it permanently, and everything else leaves it queued for later.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  queueEligibleCertificates,
  flushPendingCertificates,
  getCertificateByAttemptId,
  getPendingCertificate,
  getPendingCertificates,
  getCertificates,
  clearPendingCertificates,
  clearCertificates,
  CERTIFICATE_STORAGE_KEY
} from "../js/certificates.js";

// mock local storage for the node test runner
if (typeof globalThis.localStorage === "undefined") {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

const ATTEMPT_A = "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51";
const ATTEMPT_B = "7c04b118-2ea9-4f36-b8d2-91a7e3c05d64";

// a /api/sync response body carrying one result per entry
function syncResponse(entries) {
  return {
    success: true,
    status: 200,
    data: {
      batchId: "b71e0c93-4a2f-4d55-8e10-6f3c9d2a7b48",
      receivedAt: new Date().toISOString(),
      received: entries.length,
      accepted: entries.filter((e) => e.status === "accepted").length,
      duplicates: entries.filter((e) => e.status === "duplicate").length,
      rejected: entries.filter((e) => e.status === "rejected").length,
      results: entries
    }
  };
}

function acceptedEligible(attemptId) {
  return { attemptId, status: "accepted", serverPercentage: 91.67, serverPassed: true, certificateEligible: true };
}
function acceptedIneligible(attemptId) {
  return { attemptId, status: "accepted", serverPercentage: 42, serverPassed: false, certificateEligible: false };
}
function rejected(attemptId) {
  return { attemptId, status: "rejected", reason: "unknown_worker", message: "not registered" };
}

// a successful POST /api/certs/issue body, exactly the backend shape
function issueBody(attemptId, status) {
  return {
    certId: "SAFEAR-97FA4417AE0E48E4",
    status,
    payload: { v: 1, k: "V5WoSvuQCY48", c: "SAFEAR-97FA4417AE0E48E4", w: "WRK-0001", m: "fire-response", s: 9167, i: 1788436800, e: null },
    qr: "eyJjIjoiU0FGRUFSLTk3RkE0NDE3QUUwRTQ4RTUifQ.3n8KdSignatureBytesHere",
    qrImage: "data:image/png;base64," + "A".repeat(8000),
    algo: "Ed25519",
    keyId: "V5WoSvuQCY48",
    requestId: "req-1"
  };
}

// stub globalThis.fetch, recording every call
function stubFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    return responder(calls.length, url, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function withFetch(responder, fn) {
  const stub = stubFetch(responder);
  try {
    return await fn(stub);
  } finally {
    stub.restore();
  }
}

describe("Certificate infrastructure", () => {
  beforeEach(() => {
    clearPendingCertificates();
    clearCertificates();
  });

  describe("eligibility and queueing", () => {
    it("1. an eligible accepted attempt creates exactly one pending entry", () => {
      const result = queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      assert.strictEqual(result.queued, 1);
      assert.strictEqual(getPendingCertificates().length, 1);
      assert.strictEqual(getPendingCertificates()[0].attemptId, ATTEMPT_A);
    });

    it("2. an eligible duplicate attempt also queues, the server holds it either way", () => {
      const entry = { attemptId: ATTEMPT_A, status: "duplicate", serverPassed: true, certificateEligible: true };
      queueEligibleCertificates(syncResponse([entry]));

      assert.strictEqual(getPendingCertificates().length, 1);
    });

    it("3. an ineligible attempt creates none", () => {
      const result = queueEligibleCertificates(syncResponse([acceptedIneligible(ATTEMPT_A)]));

      assert.strictEqual(result.queued, 0);
      assert.strictEqual(result.skipped, 1);
      assert.strictEqual(getPendingCertificates().length, 0);
    });

    it("4. a failed attempt creates none, eligibility comes from the server alone", () => {
      const failed = { attemptId: ATTEMPT_A, status: "accepted", serverPassed: false, certificateEligible: false };
      queueEligibleCertificates(syncResponse([failed]));

      assert.strictEqual(getPendingCertificates().length, 0);
    });

    it("5. a rejected attempt creates none", () => {
      queueEligibleCertificates(syncResponse([rejected(ATTEMPT_A)]));
      assert.strictEqual(getPendingCertificates().length, 0);
    });

    it("6. the same attemptId twice does not create a duplicate pending entry", () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      assert.strictEqual(getPendingCertificates().length, 1, "one attempt earns one certificate");
    });

    it("7. a mixed batch queues only the eligible ones", () => {
      queueEligibleCertificates(
        syncResponse([acceptedEligible(ATTEMPT_A), acceptedIneligible(ATTEMPT_B), rejected("11111111-2222-4333-8444-555566667777")])
      );

      const pendingIds = getPendingCertificates().map((p) => p.attemptId);
      assert.deepStrictEqual(pendingIds, [ATTEMPT_A]);
    });
  });

  describe("issuance settles the pending item", () => {
    it("8. a 201 issued response stores the certificate and clears pending", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(201, issueBody(ATTEMPT_A, "issued")),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 1);
      assert.strictEqual(result.stillPending, 0);
      assert.strictEqual(getPendingCertificates().length, 0);
      assert.strictEqual(getCertificates().length, 1);
    });

    it("9. a 200 already_issued response settles exactly like a 201", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(200, issueBody(ATTEMPT_A, "already_issued")),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 1, "a retry that finds an existing cert is a success");
      assert.strictEqual(getPendingCertificates().length, 0);
      assert.strictEqual(getCertificateByAttemptId(ATTEMPT_A).status, "already_issued");
    });

    it("10. the issue request sends only the attemptId", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const stub = stubFetch(() => jsonResponse(201, issueBody(ATTEMPT_A, "issued")));
      try {
        await flushPendingCertificates();
        assert.strictEqual(stub.calls.length, 1);
        assert.match(stub.calls[0].url, /\/api\/certs\/issue$/);
        assert.deepStrictEqual(stub.calls[0].body, { attemptId: ATTEMPT_A });
      } finally {
        stub.restore();
      }
    });
  });

  describe("retryable failures retain pending", () => {
    it("11. a 404 retains pending, the attempt may not have committed yet", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(404, { error: { code: "attempt_not_found", message: "no attempt" } }),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 0);
      assert.strictEqual(result.dropped, 0);
      assert.strictEqual(getPendingCertificates().length, 1);
      assert.strictEqual(getPendingCertificate(ATTEMPT_A).lastError, "attempt_not_found");
    });

    it("12. a 500 retains pending", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(500, { error: { code: "internal_error", message: "boom" } }),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.dropped, 0);
      assert.strictEqual(getPendingCertificates().length, 1);
    });

    it("13. a network failure retains pending", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => { throw new Error("Failed to fetch (offline)"); },
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 0);
      assert.strictEqual(result.dropped, 0);
      assert.strictEqual(getPendingCertificates().length, 1);
      assert.strictEqual(getPendingCertificate(ATTEMPT_A).lastError, "network_error");
      assert.strictEqual(getCertificates().length, 0);
    });
  });

  describe("terminal failures remove pending", () => {
    it("14. a 422 attempt_not_passed removes pending, it will never succeed", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(422, { error: { code: "attempt_not_passed", message: "did not pass" } }),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.dropped, 1);
      assert.strictEqual(getPendingCertificates().length, 0);
      assert.strictEqual(getCertificates().length, 0, "no certificate is stored for a refusal");
    });

    it("15. a 400 validation_failed removes pending", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(400, { error: { code: "validation_failed", message: "bad body" } }),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.dropped, 1);
      assert.strictEqual(getPendingCertificates().length, 0);
    });
  });

  describe("what gets stored", () => {
    it("16. the qr string is stored", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));
      await withFetch(() => jsonResponse(201, issueBody(ATTEMPT_A, "issued")), () => flushPendingCertificates());

      const cert = getCertificateByAttemptId(ATTEMPT_A);
      assert.strictEqual(cert.qr, issueBody(ATTEMPT_A, "issued").qr);
      assert.strictEqual(cert.algo, "Ed25519");
      assert.strictEqual(cert.keyId, "V5WoSvuQCY48");
      assert.ok(cert.payload);
    });

    it("17. qrImage is NOT stored, it is ~9KB against a 5MB budget", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));
      await withFetch(() => jsonResponse(201, issueBody(ATTEMPT_A, "issued")), () => flushPendingCertificates());

      const cert = getCertificateByAttemptId(ATTEMPT_A);
      assert.ok(!("qrImage" in cert), "qrImage must not be persisted");

      // and it must not have leaked into the raw stored blob either
      const raw = globalThis.localStorage.getItem(CERTIFICATE_STORAGE_KEY);
      assert.ok(!raw.includes("data:image/png"), "no data url in storage");
      assert.ok(raw.length < 2000, `stored blob was ${raw.length} chars, qrImage likely leaked`);
    });

    it("18. the certificate is retrievable by attemptId", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));
      await withFetch(() => jsonResponse(201, issueBody(ATTEMPT_A, "issued")), () => flushPendingCertificates());

      const cert = getCertificateByAttemptId(ATTEMPT_A);
      assert.ok(cert);
      assert.strictEqual(cert.attemptId, ATTEMPT_A);
      assert.strictEqual(cert.certId, "SAFEAR-97FA4417AE0E48E4");
      assert.strictEqual(getCertificateByAttemptId("no-such-attempt"), null);
    });

    it("19. an already certified attempt is never re-queued", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));
      await withFetch(() => jsonResponse(201, issueBody(ATTEMPT_A, "issued")), () => flushPendingCertificates());

      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));
      assert.strictEqual(getPendingCertificates().length, 0, "it already has a certificate");
    });
  });

  describe("ordering: attempts sync before certificate issuance", () => {
    it("20. flushing before queueing issues nothing and makes no request", async () => {
      // proves the dependency is real: with no sync result there is no pending work
      const stub = stubFetch(() => jsonResponse(201, issueBody(ATTEMPT_A, "issued")));
      try {
        const result = await flushPendingCertificates();
        assert.strictEqual(result.issued, 0);
        assert.strictEqual(stub.calls.length, 0, "nothing to issue before a sync has landed");
      } finally {
        stub.restore();
      }
    });

    it("21. app.js runs sync first and certificate flush second on boot and reconnect", () => {
      // the wiring lives in app.js, which cannot be booted here because it drives the
      // AR stack, so assert the call chain at the source level instead.
      const appSource = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

      assert.match(appSource, /syncAttemptsThenCertificates/, "app.js must use the ordered helper");

      const helper = appSource.slice(appSource.indexOf("function syncAttemptsThenCertificates"));
      const syncPos = helper.indexOf("syncQueuedAttempts");
      const queuePos = helper.indexOf("queueEligibleCertificates");
      const flushPos = helper.indexOf("flushPendingCertificates");

      assert.ok(syncPos !== -1 && queuePos !== -1 && flushPos !== -1, "all three steps present");
      assert.ok(syncPos < queuePos, "attempts sync before certificates are queued");
      assert.ok(queuePos < flushPos, "certificates are queued before they are flushed");

      // both entry points use it: boot and the online listener
      const uses = appSource.match(/syncAttemptsThenCertificates\(\)/g) || [];
      assert.strictEqual(uses.length, 2, "boot and online reconnect both use the ordered helper");
    });
  });

  describe("malformed responses cause no data loss", () => {
    it("22. a sync response with no results[] queues nothing and loses nothing", () => {
      const result = queueEligibleCertificates({ success: true, status: 200, data: { batchId: "x", accepted: 1 } });

      assert.strictEqual(result.queued, 0);
      assert.strictEqual(getPendingCertificates().length, 0);
    });

    it("23. a null or junk sync response is handled without throwing", () => {
      assert.doesNotThrow(() => queueEligibleCertificates(null));
      assert.doesNotThrow(() => queueEligibleCertificates(undefined));
      assert.doesNotThrow(() => queueEligibleCertificates("nope"));
      assert.strictEqual(getPendingCertificates().length, 0);
    });

    it("24. a 200 issue response missing certId retains pending", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(200, { status: "issued" }),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 0);
      assert.strictEqual(getPendingCertificates().length, 1, "a 2xx we cannot read is not proof of anything");
      assert.strictEqual(getPendingCertificate(ATTEMPT_A).lastError, "malformed_response");
      assert.strictEqual(getCertificates().length, 0);
    });

    it("25. a 200 issue response with an unknown status retains pending", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A)]));

      const result = await withFetch(
        () => jsonResponse(200, { certId: "SAFEAR-1", status: "something_else" }),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 0);
      assert.strictEqual(getPendingCertificates().length, 1);
    });
  });

  describe("serial issuance across several pending items", () => {
    it("26. settles each item independently in one flush", async () => {
      queueEligibleCertificates(syncResponse([acceptedEligible(ATTEMPT_A), acceptedEligible(ATTEMPT_B)]));
      assert.strictEqual(getPendingCertificates().length, 2);

      // first issues, second 404s and must survive
      const result = await withFetch(
        (callNumber) => (callNumber === 1
          ? jsonResponse(201, issueBody(ATTEMPT_A, "issued"))
          : jsonResponse(404, { error: { code: "attempt_not_found", message: "not yet" } })),
        () => flushPendingCertificates()
      );

      assert.strictEqual(result.issued, 1);
      assert.strictEqual(result.stillPending, 1);
      assert.strictEqual(getPendingCertificates()[0].attemptId, ATTEMPT_B);
      assert.ok(getCertificateByAttemptId(ATTEMPT_A));
      assert.strictEqual(getCertificateByAttemptId(ATTEMPT_B), null);
    });
  });
});
