const crypto = require("node:crypto");
const { signCertificate } = require("./signer");
const { CERT_PAYLOAD_VERSION } = require("./canonical");
const { createChildLogger } = require("../../logger");

const log = createChildLogger({ component: "certs" });

// every reason issuance can be refused, one code each
const ISSUE_ERRORS = Object.freeze({
  ATTEMPT_NOT_FOUND: "attempt_not_found",
  ATTEMPT_NOT_PASSED: "attempt_not_passed",
  ALREADY_ISSUED: "already_issued",
  MODULE_NOT_FOUND: "module_not_found"
});

// refusing to issue is a normal outcome, not a crash, so it carries a code
class CertificateIssueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CertificateIssueError";
    this.code = code;
  }
}

// readable and typeable, someone may have to read this down a phone line
function generateCertId() {
  return `SAFEAR-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

// percentage carries two decimals, basis points keep it an integer so the
// canonical json never depends on float formatting
function toBasisPoints(percentage) {
  return Math.round(percentage * 100);
}

// add whole months in UTC. only called when the team has set recert_months.
function _addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

// expiry comes from module.recert_months and nowhere else. while that column is
// NULL the certificate simply has no expiry — we do not guess a Mines Act figure.
function computeExpiry(issuedAtMs, recertMonths) {
  if (recertMonths === null || recertMonths === undefined) {
    return null;
  }
  return Math.floor(_addMonths(new Date(issuedAtMs), recertMonths).getTime() / 1000);
}

// build the compact payload that actually gets signed
function buildCertificatePayload({ certId, keyId, attempt, recertMonths, issuedAtMs }) {
  return {
    v: CERT_PAYLOAD_VERSION,
    k: keyId,
    c: certId,
    w: attempt.worker_id,
    m: attempt.module_id,
    // server_percentage, never anything the phone claimed
    s: toBasisPoints(attempt.server_percentage),
    i: Math.floor(issuedAtMs / 1000),
    e: computeExpiry(issuedAtMs, recertMonths)
  };
}

// mint and store a certificate for one passed attempt.
// takes db as an argument, imports nothing from routes or express.
function issueCertificateForAttempt(db, { attemptId, keys, now, certId }) {
  const attempt = db.prepare("SELECT * FROM attempt WHERE attempt_id = ?").get(attemptId);
  if (!attempt) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.ATTEMPT_NOT_FOUND,
      `no attempt ${attemptId} on this server`
    );
  }

  // a failed run never earns a certificate, whatever the client thought
  if (attempt.server_passed !== 1) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.ATTEMPT_NOT_PASSED,
      `attempt ${attemptId} did not pass, server scored it ${attempt.server_percentage} percent`
    );
  }

  const existing = db.prepare("SELECT cert_id FROM certificate WHERE attempt_id = ?").get(attemptId);
  if (existing) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.ALREADY_ISSUED,
      `attempt ${attemptId} already holds certificate ${existing.cert_id}`
    );
  }

  const moduleRow = db.prepare("SELECT * FROM module WHERE module_id = ?").get(attempt.module_id);
  if (!moduleRow) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.MODULE_NOT_FOUND,
      `module ${attempt.module_id} is not on this server`
    );
  }

  const issuedAtMs = typeof now === "number" ? now : Date.now();
  const payload = buildCertificatePayload({
    certId: certId || generateCertId(),
    keyId: keys.keyId,
    attempt,
    recertMonths: moduleRow.recert_months,
    issuedAtMs
  });

  const signed = signCertificate(payload, keys.privateKey);

  db.prepare(
    `INSERT INTO certificate
       (cert_id, worker_id, module_id, attempt_id, score, issued_at, expires_at,
        algo, key_id, signature, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    payload.c,
    payload.w,
    payload.m,
    attemptId,
    attempt.server_percentage,
    new Date(issuedAtMs).toISOString(),
    payload.e === null ? null : new Date(payload.e * 1000).toISOString(),
    signed.algo,
    payload.k,
    signed.signature.toString("base64url"),
    signed.canonical.toString("utf8")
  );

  log.info(
    {
      event: "certificate_issued",
      certId: payload.c,
      attemptId,
      workerId: payload.w,
      moduleId: payload.m,
      algo: signed.algo,
      keyId: payload.k,
      noExpiry: payload.e === null
    },
    "Certificate issued"
  );

  return {
    certId: payload.c,
    payload,
    algo: signed.algo,
    keyId: payload.k,
    signature: signed.signature.toString("base64url"),
    qr: signed.qr
  };
}

// read one stored certificate, the online half of verification
function getCertificate(db, certId) {
  return db.prepare("SELECT * FROM certificate WHERE cert_id = ?").get(certId);
}

// the certificate an attempt already earned. lets a retrying phone get its cert back
// instead of a conflict it has no way to recover from.
function getCertificateByAttempt(db, attemptId) {
  return db.prepare("SELECT * FROM certificate WHERE attempt_id = ?").get(attemptId);
}

module.exports = {
  issueCertificateForAttempt,
  buildCertificatePayload,
  computeExpiry,
  toBasisPoints,
  generateCertId,
  getCertificate,
  getCertificateByAttempt,
  CertificateIssueError,
  ISSUE_ERRORS
};
