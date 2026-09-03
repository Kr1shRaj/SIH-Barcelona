// Certificate infrastructure: pending queue, issuance flush, local certificate store.
//
// A certificate can only be minted from an attempt the server already holds, because
// POST /api/certs/issue takes an attemptId and 404s when the attempt is not on record.
// So issuance always trails a successful sync, never runs alongside it.
//
// The settle rule is the same one that fixed the mixed batch sync bug: a pending item
// is only cleared when the server has definitively settled it. Guessing is what
// destroys a worker record.

import { apiPost } from "./api.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Certificates");

const PENDING_CERT_STORAGE_KEY = "safear_pending_certificates";
const CERTIFICATE_STORAGE_KEY = "safear_certificates";

// sync verdicts that mean the attempt is on record and can be certified
const SETTLED_SYNC_STATUSES = ["accepted", "duplicate"];

// issue outcomes that mean the certificate now exists.
// already_issued is a success: the phone lost the first answer and asked again.
const SETTLED_ISSUE_STATUSES = ["issued", "already_issued"];

// issue failures that will never succeed however many times we ask.
// 422 is attempt_not_passed, 400 is a malformed request. both are terminal.
const TERMINAL_ISSUE_HTTP = [400, 422];

function _getStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function _readList(key) {
  const storage = _getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function _writeList(key, list) {
  const storage = _getStorage();
  if (storage) {
    storage.setItem(key, JSON.stringify(list));
  }
  return list;
}

function getPendingCertificates() {
  return _readList(PENDING_CERT_STORAGE_KEY);
}

function getCertificates() {
  return _readList(CERTIFICATE_STORAGE_KEY);
}

function getPendingCertificate(attemptId) {
  return getPendingCertificates().find((entry) => entry.attemptId === attemptId) || null;
}

function getCertificateByAttemptId(attemptId) {
  return getCertificates().find((cert) => cert.attemptId === attemptId) || null;
}

function getCertificateByCertId(certId) {
  return getCertificates().find((cert) => cert.certId === certId) || null;
}

function clearPendingCertificates() {
  const storage = _getStorage();
  if (storage) storage.removeItem(PENDING_CERT_STORAGE_KEY);
  return [];
}

function clearCertificates() {
  const storage = _getStorage();
  if (storage) storage.removeItem(CERTIFICATE_STORAGE_KEY);
  return [];
}

// drop one pending item by attempt id
function _removePending(attemptId) {
  const remaining = getPendingCertificates().filter((entry) => entry.attemptId !== attemptId);
  return _writeList(PENDING_CERT_STORAGE_KEY, remaining);
}

// leave the item queued but remember why the last try failed
function _markPendingError(attemptId, error) {
  const updated = getPendingCertificates().map((entry) => {
    if (entry.attemptId !== attemptId) return entry;
    return Object.assign({}, entry, {
      lastError: error ? error.code : "unknown",
      lastMessage: error && error.message ? error.message : "",
      lastAttemptAt: new Date().toISOString()
    });
  });
  return _writeList(PENDING_CERT_STORAGE_KEY, updated);
}

// keep the fields worth carrying.
// qr is the signed credential, the thing a verifier actually checks.
// qrImage is only the picture of it, kept so the worker can see the certificate
// offline. the frontend has no bundler and no QR encoder, so without this there
// is no way to draw the code from the qr string alone. about 9KB per cert.
function _storeCertificate(body, pendingEntry) {
  const certificate = {
    certId: body.certId,
    attemptId: pendingEntry.attemptId,
    workerId: body.payload && body.payload.w ? body.payload.w : pendingEntry.workerId,
    moduleId: body.payload && body.payload.m ? body.payload.m : pendingEntry.moduleId,
    payload: body.payload,
    qr: body.qr,
    qrImage: body.qrImage || null,
    algo: body.algo,
    keyId: body.keyId,
    status: body.status,
    storedAt: new Date().toISOString()
  };

  const existing = getCertificates().filter((cert) => cert.attemptId !== certificate.attemptId);
  existing.push(certificate);
  _writeList(CERTIFICATE_STORAGE_KEY, existing);
  return certificate;
}

// pull the per attempt verdicts out of whatever the caller passed.
// accepts the syncQueuedAttempts return value or a raw backend body.
function _resultsFrom(syncResponse) {
  if (!syncResponse || typeof syncResponse !== "object") return null;
  if (syncResponse.data && Array.isArray(syncResponse.data.results)) return syncResponse.data.results;
  if (Array.isArray(syncResponse.results)) return syncResponse.results;
  return null;
}

// turn a sync response into pending certificate work.
// eligibility comes from the server field certificateEligible and nothing else,
// so the frontend never invents a second opinion about who passed.
function queueEligibleCertificates(syncResponse) {
  const results = _resultsFrom(syncResponse);
  if (!results) {
    // no results array means we cannot tell who is eligible. queue nothing rather
    // than guess. the attempts themselves are untouched, so nothing is lost.
    return { queued: 0, skipped: 0, results: 0 };
  }

  const pending = getPendingCertificates();
  const byAttemptId = new Map(pending.map((entry) => [entry.attemptId, entry]));
  let queued = 0;
  let skipped = 0;

  results.forEach((result) => {
    if (!result || typeof result.attemptId !== "string") {
      skipped += 1;
      return;
    }

    const settled = SETTLED_SYNC_STATUSES.indexOf(result.status) !== -1;
    if (!settled || result.certificateEligible !== true) {
      skipped += 1;
      return;
    }

    // never queue twice for one attempt, and never re-queue one already certified
    if (byAttemptId.has(result.attemptId) || getCertificateByAttemptId(result.attemptId)) {
      skipped += 1;
      return;
    }

    const entry = {
      attemptId: result.attemptId,
      moduleId: result.moduleId || null,
      workerId: result.workerId || null,
      queuedAt: new Date().toISOString(),
      lastError: null
    };
    byAttemptId.set(result.attemptId, entry);
    pending.push(entry);
    queued += 1;
  });

  if (queued > 0) {
    _writeList(PENDING_CERT_STORAGE_KEY, pending);
    logger.info({ event: "certificates_queued", queued }, "Certificates queued for issuance");
  }

  return { queued, skipped, results: results.length };
}

// A finished attempt asks the server for its certificate.
//
// This exists because finishAssessmentSession fires its own background sync and
// throws the response away. By the time any UI can look, the attempt is gone from
// the queue and certificateEligible went with it, so queueEligibleCertificates has
// nothing to work from and the certificate would never be requested at all.
//
// evaluated.passed is only the TRIGGER to ask. The server stays the authority:
// flushPendingCertificates sends attemptId and nothing else, and a 422
// attempt_not_passed drops the pending item permanently. A locally optimistic
// client cannot talk the server into minting anything.
function requestCertificateForAttempt(evaluated) {
  if (!evaluated || typeof evaluated.attemptId !== "string") {
    return { queued: 0, reason: "no_attempt" };
  }
  if (evaluated.passed !== true) {
    return { queued: 0, reason: "not_passed_locally" };
  }
  if (getCertificateByAttemptId(evaluated.attemptId)) {
    return { queued: 0, reason: "already_certified" };
  }
  if (getPendingCertificate(evaluated.attemptId)) {
    return { queued: 0, reason: "already_pending" };
  }

  const pending = getPendingCertificates();
  pending.push({
    attemptId: evaluated.attemptId,
    moduleId: evaluated.moduleId || null,
    workerId: evaluated.workerId || null,
    queuedAt: new Date().toISOString(),
    lastError: null
  });
  _writeList(PENDING_CERT_STORAGE_KEY, pending);
  logger.info({ event: "certificate_requested", attemptId: evaluated.attemptId }, "Certificate requested for finished attempt");

  return { queued: 1, reason: "queued" };
}

// which of the four completion states an attempt is in right now.
// pure lookup against local storage, so it answers instantly and works offline.
function resolveCertificateState(attemptId, evaluated) {
  const passed = evaluated ? evaluated.passed === true : false;

  if (!passed) {
    return { state: "failed", certificate: null, pending: null };
  }

  const certificate = getCertificateByAttemptId(attemptId);
  if (certificate) {
    return { state: "issued", certificate, pending: null };
  }

  const pending = getPendingCertificate(attemptId);
  if (pending) {
    return { state: "pending", certificate: null, pending };
  }

  return { state: "passed", certificate: null, pending: null };
}

// ask the server to mint every pending certificate, one request at a time.
// there is no batch issue endpoint, and a realistic queue holds one or two items.
async function flushPendingCertificates(options = {}) {
  const pending = getPendingCertificates();
  if (pending.length === 0) {
    return { issued: 0, dropped: 0, stillPending: 0, results: [] };
  }

  const baseUrl = options.baseUrl || "";
  const results = [];
  let issued = 0;
  let dropped = 0;

  for (const entry of pending) {
    const response = await apiPost("/api/certs/issue", { attemptId: entry.attemptId }, { baseUrl });

    // 201 issued and 200 already_issued both mean the certificate exists now
    if (response.ok && response.data && response.data.certId
      && SETTLED_ISSUE_STATUSES.indexOf(response.data.status) !== -1) {
      const certificate = _storeCertificate(response.data, entry);
      _removePending(entry.attemptId);
      issued += 1;
      results.push({ attemptId: entry.attemptId, outcome: "issued", certId: certificate.certId, status: response.data.status });
      logger.info(
        { event: "certificate_issued", certId: certificate.certId, attemptId: entry.attemptId, status: response.data.status },
        "Certificate stored"
      );
      continue;
    }

    // a 2xx we cannot read is not proof of anything. keep the item.
    if (response.ok) {
      _markPendingError(entry.attemptId, { code: "malformed_response", message: "issue response missing certId or status" });
      results.push({ attemptId: entry.attemptId, outcome: "pending", reason: "malformed_response" });
      continue;
    }

    // 400 and 422 will never succeed, so stop asking
    if (TERMINAL_ISSUE_HTTP.indexOf(response.status) !== -1) {
      _removePending(entry.attemptId);
      dropped += 1;
      results.push({
        attemptId: entry.attemptId,
        outcome: "dropped",
        status: response.status,
        reason: response.error ? response.error.code : "terminal"
      });
      logger.warn(
        { event: "certificate_dropped", attemptId: entry.attemptId, status: response.status, reason: response.error ? response.error.code : "terminal" },
        "Certificate issuance refused permanently"
      );
      continue;
    }

    // 404 means the attempt has not landed yet, 5xx and network mean try again.
    // all of them keep the pending item.
    _markPendingError(entry.attemptId, response.error);
    results.push({
      attemptId: entry.attemptId,
      outcome: "pending",
      status: response.status,
      reason: response.error ? response.error.code : "unknown"
    });
  }

  const stillPending = getPendingCertificates().length;
  logger.info({ event: "certificate_flush_done", issued, dropped, stillPending }, "Certificate flush complete");

  return { issued, dropped, stillPending, results };
}

export {
  queueEligibleCertificates,
  requestCertificateForAttempt,
  resolveCertificateState,
  flushPendingCertificates,
  getCertificateByAttemptId,
  getCertificateByCertId,
  getPendingCertificate,
  getPendingCertificates,
  getCertificates,
  clearPendingCertificates,
  clearCertificates,
  PENDING_CERT_STORAGE_KEY,
  CERTIFICATE_STORAGE_KEY,
  SETTLED_SYNC_STATUSES,
  SETTLED_ISSUE_STATUSES,
  TERMINAL_ISSUE_HTTP
};
