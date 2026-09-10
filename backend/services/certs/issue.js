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
  MODULE_NOT_FOUND: "module_not_found",
  LEGACY_CONTRACT: "legacy_contract",
  ATTEMPT_NOT_GRADED: "attempt_not_graded"
});

// only a run graded by this server under Contract v2.0 can earn a certificate.
// v1.0 rows carry a score the client handed them, so they never qualify.
const CERTIFIABLE_CONTRACT_VERSIONS = new Set(["2.0"]);

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

  // a v1 run was scored from what the phone claimed. it can never become eligible.
  if (!CERTIFIABLE_CONTRACT_VERSIONS.has(attempt.contract_version)) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.LEGACY_CONTRACT,
      `attempt ${attemptId} is contract ${attempt.contract_version}, only ${Array.from(CERTIFIABLE_CONTRACT_VERSIONS).join(", ")} can certify`
    );
  }

  // one unconfigured checkpoint rule means nobody graded part of this run
  if (attempt.grading_status !== "graded") {
    throw new CertificateIssueError(
      ISSUE_ERRORS.ATTEMPT_NOT_GRADED,
      `attempt ${attemptId} is ${attempt.grading_status}, so it has no server grade to certify`
    );
  }

  // a failed run never earns a certificate, whatever the client thought
  if (attempt.server_passed !== 1) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.ATTEMPT_NOT_PASSED,
      `attempt ${attemptId} did not pass, server scored it ${attempt.server_percentage} percent`
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

  const insert = db.prepare(
    `INSERT INTO certificate
       (cert_id, worker_id, module_id, attempt_id, score, issued_at, expires_at,
        algo, key_id, signature, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // one run earns one certificate. the read and the write sit in the same
  // transaction so two callers cannot both find the row missing and both insert,
  // and UNIQUE(attempt_id) still stands behind it if a second process tries.
  const claim = db.transaction(() => {
    const existing = db.prepare("SELECT cert_id FROM certificate WHERE attempt_id = ?").get(attemptId);
    if (existing) {
      return existing.cert_id;
    }
    insert.run(
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
    return null;
  });

  let alreadyHeldBy = null;
  try {
    alreadyHeldBy = claim();
  } catch (err) {
    // lost the race to another process. the winner's certificate is the real one,
    // so answer with the same refusal a sequential caller would have got.
    if (err.code && String(err.code).startsWith("SQLITE_CONSTRAINT")) {
      const winner = db.prepare("SELECT cert_id FROM certificate WHERE attempt_id = ?").get(attemptId);
      throw new CertificateIssueError(
        ISSUE_ERRORS.ALREADY_ISSUED,
        `attempt ${attemptId} already holds certificate ${winner ? winner.cert_id : "issued by another writer"}`
      );
    }
    throw err;
  }

  if (alreadyHeldBy !== null) {
    throw new CertificateIssueError(
      ISSUE_ERRORS.ALREADY_ISSUED,
      `attempt ${attemptId} already holds certificate ${alreadyHeldBy}`
    );
  }

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
  CERTIFIABLE_CONTRACT_VERSIONS,
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
