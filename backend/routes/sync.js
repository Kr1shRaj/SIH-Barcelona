const express = require("express");
const { validateSyncPayload } = require("../models/sync");
const { checkAgainstManifest } = require("../models/attempt");
const { ValidationError, REFERENTIAL, makeIssue } = require("../models/errors");
const { getModule, getCheckpointDefinitions } = require("../services/modules");
const { ingestAttempt, recordSyncBatch } = require("../services/attempts");
const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "sync" });

// shape one rejected attempt the same way every time
function _rejection(attemptId, code, message, issues) {
  return {
    attemptId,
    status: "rejected",
    reason: code,
    message,
    issues: issues || []
  };
}

// build sync route for offline worker logs
function createSyncRouter({ db }) {
  const router = express.Router();

  router.post("/", (req, res, next) => {
    let envelope;

    // layer 1. a malformed envelope or attempt sinks the whole batch with a 400,
    // because the client cannot fix half a broken payload.
    try {
      envelope = validateSyncPayload(req.body, { now: Date.now() });
    } catch (err) {
      return next(err);
    }

    const receivedAt = new Date().toISOString();

    try {
      recordSyncBatch(db, {
        batchId: envelope.batchId,
        workerId: envelope.workerId,
        deviceId: envelope.deviceId,
        receivedAt,
        attemptCount: envelope.attempts.length
      });
    } catch (err) {
      // an unknown worker on the envelope trips the foreign key, answer it cleanly
      if (err.code && String(err.code).startsWith("SQLITE_CONSTRAINT")) {
        return next(
          new ValidationError(REFERENTIAL, [
            makeIssue("workerId", "unknown_worker", `worker "${envelope.workerId}" is not registered on this server`)
          ])
        );
      }
      return next(err);
    }

    const results = [];

    envelope.attempts.forEach((attempt) => {
      // layer 2. from here on every failure is per attempt, so one bad record
      // never stops a good one in the same batch from landing.
      const worker = db.prepare("SELECT worker_id FROM worker WHERE worker_id = ?").get(attempt.workerId);
      if (!worker) {
        results.push(
          _rejection(attempt.attemptId, "unknown_worker", `worker "${attempt.workerId}" is not registered on this server`)
        );
        return;
      }

      const moduleRow = getModule(db, attempt.moduleId);
      if (!moduleRow) {
        results.push(
          _rejection(attempt.attemptId, "unknown_module", `module "${attempt.moduleId}" is not on this server`)
        );
        return;
      }

      const definitions = getCheckpointDefinitions(db, attempt.moduleId);

      try {
        checkAgainstManifest(attempt, definitions);
      } catch (err) {
        if (err instanceof ValidationError) {
          results.push(_rejection(attempt.attemptId, "contract_violation", err.message, err.issues));
          return;
        }
        throw err;
      }

      try {
        const outcome = ingestAttempt(db, {
          attempt,
          definitions,
          moduleRow,
          batchId: envelope.batchId,
          receivedAt
        });
        results.push({ attemptId: attempt.attemptId, ...outcome });
      } catch (err) {
        if (err.code && String(err.code).startsWith("SQLITE_CONSTRAINT")) {
          results.push(_rejection(attempt.attemptId, "constraint_violation", "the server could not store this attempt"));
          return;
        }
        throw err;
      }
    });

    const accepted = results.filter((r) => r.status === "accepted").length;
    const duplicates = results.filter((r) => r.status === "duplicate").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    log.info(
      {
        event: "sync_batch_ingested",
        batchId: envelope.batchId,
        received: results.length,
        accepted,
        duplicates,
        rejected
      },
      "Sync batch processed"
    );

    // nothing landed at all, so tell the client the batch failed semantically.
    // a mixed batch still answers 200 because the good attempts were stored.
    const status = accepted === 0 && duplicates === 0 && rejected > 0 ? 422 : 200;

    return res.status(status).json({
      batchId: envelope.batchId,
      receivedAt,
      received: results.length,
      accepted,
      duplicates,
      rejected,
      results
    });
  });

  return router;
}

module.exports = { createSyncRouter };
