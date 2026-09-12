// What happens when the phone cannot write to storage at all.
//
// This is not a hypothetical. An Android WebView with site data disabled throws on
// the localStorage property access itself, and a full store throws on setItem. The
// rule under test is that a failure is reported honestly and never destroys a
// record: the UI must not claim a certificate is pending when nothing was saved,
// and a certificate the server has already minted must stay recoverable.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  requestCertificateForAttempt,
  queueEligibleCertificates,
  flushPendingCertificates,
  resolveCertificateState,
  getPendingCertificates,
  getCertificates,
  clearPendingCertificates,
  clearCertificates,
  PENDING_CERT_STORAGE_KEY
} from "../js/certificates.js";

const ATTEMPT = "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51";

// a store whose failure mode each test picks
function makeStorage() {
  let data = {};
  const s = {
    mode: "ok",
    getItem(k) {
      if (s.mode === "read_throws") throw new Error("storage blocked");
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) {
      if (s.mode === "write_throws" || s.mode === "quota") {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      data[k] = String(v);
    },
    removeItem(k) {
      if (s.mode === "write_throws") throw new Error("storage blocked");
      delete data[k];
    },
    _reset() { data = {}; s.mode = "ok"; }
  };
  return s;
}

const storage = makeStorage();
globalThis.localStorage = storage;

const passed = { attemptId: ATTEMPT, passed: true, moduleId: "fire-response", workerId: "WRK-0001" };

function issueResponse(certId) {
  return {
    ok: true,
    status: 201,
    json: async () => ({
      certId,
      status: "issued",
      qr: "payload.signature",
      qrImage: "data:image/png;base64,IMG",
      algo: "Ed25519",
      keyId: "abc123",
      payload: { c: certId, w: "WRK-0001", m: "fire-response" }
    })
  };
}

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });

describe("storage that refuses to write", () => {
  beforeEach(() => {
    storage._reset();
    clearPendingCertificates();
    clearCertificates();
  });

  it("1. requesting a certificate reports the failure instead of throwing", () => {
    storage.mode = "write_throws";
    let result;
    assert.doesNotThrow(() => { result = requestCertificateForAttempt(passed); });
    assert.strictEqual(result.queued, 0);
    assert.strictEqual(result.reason, "storage_failed");
  });

  it("2. a failed request leaves nothing pending, so nothing is falsely promised", () => {
    storage.mode = "write_throws";
    requestCertificateForAttempt(passed);
    storage.mode = "ok";
    assert.strictEqual(getPendingCertificates().length, 0);
  });

  it("3. the completion panel shows passed, never pending, when the write failed", () => {
    storage.mode = "write_throws";
    requestCertificateForAttempt(passed);
    storage.mode = "ok";
    const state = resolveCertificateState(ATTEMPT, passed).state;
    assert.strictEqual(state, "passed", "a worker must not be told a certificate is on its way");
  });

  it("4. queueEligibleCertificates reports zero queued when the write failed", () => {
    storage.mode = "write_throws";
    let result;
    assert.doesNotThrow(() => {
      result = queueEligibleCertificates({
        results: [{ attemptId: ATTEMPT, status: "accepted", certificateEligible: true }]
      });
    });
    assert.strictEqual(result.queued, 0);
    assert.strictEqual(result.skipped, 1);
  });

  it("5. reading through a store that throws degrades to empty, never throws", () => {
    storage.mode = "read_throws";
    assert.doesNotThrow(() => getPendingCertificates());
    assert.doesNotThrow(() => getCertificates());
    assert.deepStrictEqual(getPendingCertificates(), []);
    assert.doesNotThrow(() => resolveCertificateState(ATTEMPT, passed));
  });

  it("6. clearing through a hostile store does not throw", () => {
    storage.mode = "write_throws";
    assert.doesNotThrow(() => clearPendingCertificates());
    assert.doesNotThrow(() => clearCertificates());
  });
});

describe("storage that cannot be reached at all", () => {
  const saved = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: saved, configurable: true, writable: true });
  });

  it("7. survives localStorage throwing on the property access itself", () => {
    // the android webview case: touching the property raises before any method call
    Object.defineProperty(globalThis, "localStorage", {
      get() { throw new Error("access denied"); },
      configurable: true
    });
    assert.doesNotThrow(() => getPendingCertificates());
    assert.doesNotThrow(() => requestCertificateForAttempt(passed));
    assert.strictEqual(requestCertificateForAttempt(passed).reason, "storage_failed");
  });
});

describe("a certificate the server issued but the phone could not save", () => {
  beforeEach(() => {
    storage._reset();
    clearPendingCertificates();
    clearCertificates();
  });

  it("8. keeps the pending item instead of losing the certificate", async () => {
    requestCertificateForAttempt(passed);
    assert.strictEqual(getPendingCertificates().length, 1, "queued while storage was healthy");

    // storage fails exactly at the moment the certificate comes back
    globalThis.fetch = async () => issueResponse("SAFEAR-0123456789ABCDEF");
    storage.mode = "quota";

    const result = await flushPendingCertificates();
    storage.mode = "ok";

    assert.strictEqual(result.issued, 0, "nothing was stored, so nothing was issued locally");
    assert.strictEqual(result.dropped, 0, "a storage failure must never drop the record");
    assert.strictEqual(result.stillPending, 1, "the pending item survives for a retry");
    assert.strictEqual(result.results[0].outcome, "pending");
    assert.strictEqual(result.results[0].reason, "storage_failed");
  });

  it("9. recovers on a later flush once storage works again", async () => {
    requestCertificateForAttempt(passed);

    globalThis.fetch = async () => issueResponse("SAFEAR-0123456789ABCDEF");
    storage.mode = "quota";
    await flushPendingCertificates();
    assert.strictEqual(getCertificates().length, 0);

    // the server answers already_issued on the repeat, which settles it
    storage.mode = "ok";
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        certId: "SAFEAR-0123456789ABCDEF",
        status: "already_issued",
        qr: "payload.signature",
        qrImage: "data:image/png;base64,IMG",
        algo: "Ed25519",
        keyId: "abc123",
        payload: { c: "SAFEAR-0123456789ABCDEF", w: "WRK-0001", m: "fire-response" }
      })
    });

    const again = await flushPendingCertificates();
    assert.strictEqual(again.issued, 1, "the certificate is recovered, not lost");
    assert.strictEqual(again.stillPending, 0);
    assert.strictEqual(getCertificates()[0].certId, "SAFEAR-0123456789ABCDEF");
    assert.strictEqual(resolveCertificateState(ATTEMPT, passed).state, "issued");
  });

  it("10. a terminal 422 still drops the item, storage handling did not soften that", async () => {
    requestCertificateForAttempt(passed);
    globalThis.fetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "attempt_not_passed", message: "did not pass" } })
    });

    const result = await flushPendingCertificates();
    assert.strictEqual(result.dropped, 1);
    assert.strictEqual(result.stillPending, 0);
  });

  it("11. the pending key is untouched when a healthy write is not needed", () => {
    storage.mode = "ok";
    clearPendingCertificates();
    assert.strictEqual(globalThis.localStorage.getItem(PENDING_CERT_STORAGE_KEY), null);
  });
});
