const { ValidationError, STRUCTURAL, REFERENTIAL } = require("../models/errors");
const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "http" });

// nothing matched a route, say so in the same envelope as every other error
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `no route for ${req.method} ${req.path}`,
      requestId: req.id
    }
  });
}

// single place that turns a thrown thing into a response.
// stack traces stay in the log and never reach the client.
function errorHandler(err, req, res, _next) {
  const requestId = req.id;

  if (err instanceof ValidationError) {
    const status = err.kind === REFERENTIAL ? 422 : 400;
    const code = err.kind === REFERENTIAL ? "contract_violation" : "validation_failed";

    log.info(
      { event: "request_rejected", kind: err.kind, status, requestId, issueCount: err.issues.length },
      err.message
    );

    return res.status(status).json({
      error: { code, message: err.message, requestId },
      issues: err.issues
    });
  }

  // express.json rejects a body over the limit before any handler sees it
  if (err.type === "entity.too.large") {
    log.warn({ event: "payload_too_large", requestId, limit: err.limit }, "Request body over the limit");
    return res.status(413).json({
      error: { code: "payload_too_large", message: "request body is too large", requestId }
    });
  }

  // body-parser throws a SyntaxError carrying the raw body when json is malformed
  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, "body")) {
    log.info({ event: "malformed_json", requestId }, "Request body was not valid JSON");
    return res.status(400).json({
      error: { code: "malformed_json", message: "request body is not valid JSON", requestId }
    });
  }

  if (err.code && String(err.code).startsWith("SQLITE_")) {
    // log the sqlite code, never leak sql or a file path to the caller
    log.error({ event: "database_error", requestId, sqliteCode: err.code, err }, "Database rejected the write");
    return res.status(500).json({
      error: { code: "database_error", message: "the server could not store this request", requestId }
    });
  }

  log.error({ event: "unhandled_error", requestId, err }, "Unhandled error");
  return res.status(500).json({
    error: { code: "internal_error", message: "something went wrong on the server", requestId }
  });
}

module.exports = { notFoundHandler, errorHandler, STRUCTURAL, REFERENTIAL };
