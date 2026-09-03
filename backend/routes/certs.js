const express = require("express");
const { Buffer } = require("node:buffer");
const { validateCertIssueRequest, validateCertVerifyRequest } = require("../models/cert");
const {
  issueCertificateForAttempt,
  getCertificate,
  getCertificateByAttempt,
  CertificateIssueError,
  ISSUE_ERRORS
} = require("../services/certs/issue");
const { verifyCertificateOffline, REASONS } = require("../services/certs/verifier");
const { renderCertificateQr } = require("../services/certs/signer");
const { buildQrPayload, fromBase64Url } = require("../services/certs/canonical");
const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "certs-api" });

// refusing to issue maps onto a status, one entry each
const ISSUE_STATUS = Object.freeze({
  [ISSUE_ERRORS.ATTEMPT_NOT_FOUND]: 404,
  [ISSUE_ERRORS.ATTEMPT_NOT_PASSED]: 422,
  [ISSUE_ERRORS.MODULE_NOT_FOUND]: 422
});

// only these leave the building. attempt_id, payload_json and the raw signature
// stay in, so a printed list of cert ids can never be turned back into working QRs.
function _safeCertificate(row) {
  return {
    certId: row.cert_id,
    workerId: row.worker_id,
    moduleId: row.module_id,
    score: row.score,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    algo: row.algo,
    keyId: row.key_id,
    revoked: row.revoked === 1
  };
}

// rebuild the scannable string from what we stored, so a typed cert id still gets
// a real signature check rather than a bare database lookup
function _qrFromRow(row) {
  return buildQrPayload(Buffer.from(row.payload_json, "utf8"), fromBase64Url(row.signature));
}

// nothing evaluated yet
function _freshChecks() {
  return {
    signature: "not_evaluated",
    payload: "not_evaluated",
    key: "not_evaluated",
    expiry: "not_evaluated",
    record: "not_checked",
    revocation: "unknown"
  };
}

// how bad each outcome is. the worst thing true about a certificate is the thing
// the person holding the scanner needs to hear first.
const REASON_SEVERITY = [
  REASONS.BAD_SIGNATURE,
  REASONS.MALFORMED,
  REASONS.UNKNOWN_VERSION,
  REASONS.UNKNOWN_KEY,
  "not_on_record",
  "revoked",
  REASONS.EXPIRED
];

function _worst(reasons) {
  for (const candidate of REASON_SEVERITY) {
    if (reasons.indexOf(candidate) !== -1) {
      return candidate;
    }
  }
  return REASONS.OK;
}

// build cert routes for issue and verify
function createCertRouter({ db, keys }) {
  if (!keys) {
    throw new Error("cert router needs signing keys — pass keys into createApp");
  }

  const router = express.Router();

  // ---------------------------------------------------------------- issue
  // the body carries an attempt id and nothing else. worker, module, score and
  // expiry all come off the stored attempt, so a caller cannot claim a mark.
  router.post("/issue", async (req, res, next) => {
    let body;
    try {
      body = validateCertIssueRequest(req.body);
    } catch (err) {
      return next(err);
    }

    try {
      const cert = issueCertificateForAttempt(db, { attemptId: body.attemptId, keys });
      const qrImage = await renderCertificateQr(cert.qr);

      log.info(
        { event: "cert_issue", certId: cert.certId, attemptId: body.attemptId, result: "issued", requestId: req.id },
        "Certificate issued"
      );

      return res.status(201).json({
        certId: cert.certId,
        status: "issued",
        payload: cert.payload,
        qr: cert.qr,
        qrImage,
        algo: cert.algo,
        keyId: cert.keyId,
        requestId: req.id
      });
    } catch (err) {
      if (!(err instanceof CertificateIssueError)) {
        return next(err);
      }

      // a phone that lost the first response retries and gets its certificate back.
      // a 409 would strand it, because there is no endpoint to fetch the cert from.
      if (err.code === ISSUE_ERRORS.ALREADY_ISSUED) {
        const row = getCertificateByAttempt(db, body.attemptId);
        const qr = _qrFromRow(row);
        const qrImage = await renderCertificateQr(qr);

        log.info(
          {
            event: "cert_issue",
            certId: row.cert_id,
            attemptId: body.attemptId,
            result: "already_issued",
            requestId: req.id
          },
          "Certificate already issued, returning the existing one"
        );

        return res.status(200).json({
          certId: row.cert_id,
          status: "already_issued",
          payload: JSON.parse(row.payload_json),
          qr,
          qrImage,
          algo: row.algo,
          keyId: row.key_id,
          requestId: req.id
        });
      }

      const status = ISSUE_STATUS[err.code] || 422;
      log.warn(
        { event: "cert_issue", attemptId: body.attemptId, result: err.code, status, requestId: req.id },
        "Certificate issuance refused"
      );

      return res.status(status).json({
        error: { code: err.code, message: err.message, requestId: req.id }
      });
    }
  });

  // --------------------------------------------------------------- verify
  // a forged certificate is a successful verification, so anything well formed
  // answers 200 and puts the verdict in the body. only a bad request is 4xx.
  router.post("/verify", (req, res, next) => {
    let body;
    try {
      body = validateCertVerifyRequest(req.body);
    } catch (err) {
      return next(err);
    }

    const checks = _freshChecks();
    const mode = body.qr ? "qr" : "certId";
    let qr = body.qr;
    let row = null;

    try {
      // typed cert id: fetch the stored bytes, then verify them like any other scan
      if (mode === "certId") {
        row = getCertificate(db, body.certId);
        if (!row) {
          checks.record = "not_found";
          log.info(
            { event: "cert_verify", certId: body.certId, mode, result: "not_on_record", requestId: req.id },
            "Certificate verification failed"
          );
          return res.status(200).json({
            verdict: "invalid",
            reason: "not_on_record",
            mode,
            checks,
            certificate: null,
            requestId: req.id
          });
        }
        qr = _qrFromRow(row);
      }

      const result = verifyCertificateOffline(qr, keys.publicKey, {
        now: Date.now(),
        expectedKeyId: keys.keyId
      });

      const reasons = [];

      // 1. cryptographic validity. nothing below is trustworthy until this passes.
      if (result.reason === REASONS.MALFORMED) {
        checks.payload = "malformed";
        reasons.push(REASONS.MALFORMED);
      } else if (result.reason === REASONS.BAD_SIGNATURE) {
        checks.signature = "fail";
        reasons.push(REASONS.BAD_SIGNATURE);
      } else {
        checks.signature = "pass";
        checks.payload = "pass";
      }

      // 2 and 3. version and key, only meaningful once the signature held
      if (checks.signature === "pass") {
        checks.key = result.reason === REASONS.UNKNOWN_KEY ? "unknown" : "pass";
        if (result.reason === REASONS.UNKNOWN_KEY) {
          reasons.push(REASONS.UNKNOWN_KEY);
        }
        if (result.reason === REASONS.UNKNOWN_VERSION) {
          checks.payload = "unknown_version";
          reasons.push(REASONS.UNKNOWN_VERSION);
        }
      }

      const payload = result.payload || null;

      // 4 and 5. the online half. offline verification cannot see either of these.
      if (payload) {
        checks.expiry = result.reason === REASONS.EXPIRED ? "expired" : payload.e ? "valid" : "none";
        if (result.reason === REASONS.EXPIRED) {
          reasons.push(REASONS.EXPIRED);
        }

        row = row || getCertificate(db, payload.c);
        if (row) {
          checks.record = "found";
          checks.revocation = row.revoked === 1 ? "revoked" : "active";
          if (row.revoked === 1) {
            reasons.push("revoked");
          }
        } else {
          // signature is perfect but we never issued it. a stolen key, or another
          // deployment. this is the check only the online path can make.
          checks.record = "not_found";
          reasons.push("not_on_record");
        }
      }

      const reason = _worst(reasons);
      const verdict = reason === REASONS.OK ? "valid" : "invalid";

      log.info(
        {
          event: "cert_verify",
          certId: payload ? payload.c : null,
          mode,
          verdict,
          result: reason,
          requestId: req.id
        },
        "Certificate verified"
      );

      return res.status(200).json({
        verdict,
        reason,
        mode,
        checks,
        // nothing derived from bytes whose signature we could not trust
        certificate: row && checks.signature === "pass" ? _safeCertificate(row) : null,
        requestId: req.id
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createCertRouter };
