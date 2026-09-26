const express = require("express");
const { z } = require("zod");
const { activateAccount, login, revokeSession } = require("../services/accounts");
const { requireTrainee } = require("../middleware/trainee-auth");
const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "auth-routes" });

// Trainee authentication.
//
// What leaves this router: a session token, an expiry, a worker id and a display
// name. What never leaves it: a PIN, a PIN hash, an activation code, a code hash,
// a token fingerprint. What never reaches the log: any of the same.
//
// Failures are deliberately uniform. "invalid_credentials" covers an unknown
// worker, a worker with no account, a wrong PIN and a disabled account, and each
// costs the same time, so the response cannot be used to enumerate the roster.

const workerIdSchema = z.string().trim().min(1).max(64);
const pinSchema = z.string().min(1).max(128);

const loginSchema = z.object({
  workerId: workerIdSchema,
  pin: pinSchema,
  deviceId: z.string().trim().min(1).max(64).optional()
}).strict();

const activateSchema = z.object({
  workerId: workerIdSchema,
  code: z.string().trim().min(1).max(64),
  pin: pinSchema,
  deviceId: z.string().trim().min(1).max(64).optional()
}).strict();

// the PIN policy failures a worker is allowed to see, because they describe the
// caller's own new PIN and nobody else's account
const PIN_POLICY_MESSAGES = Object.freeze({
  pin_required: "choose a PIN",
  pin_digits_only: "a PIN is digits only",
  pin_too_short: "a PIN must be at least 6 digits",
  pin_too_common: "that PIN is too easy to guess, choose another",
  pin_too_simple: "that PIN is too simple, choose another"
});

function _badRequest(res, requestId, message) {
  return res.status(400).json({ error: { code: "validation_failed", message, requestId } });
}

// one shape for every successful sign in
function _session(res, result) {
  return res.json({
    token: result.token,
    expiresAt: result.expiresAt,
    workerId: result.workerId,
    name: result.name
  });
}

function createAuthRouter({ db }) {
  if (!db) {
    throw new Error("createAuthRouter requires a database instance");
  }

  const router = express.Router();

  // activate: roster worker + one-time code + a new PIN
  router.post("/activate", (req, res, next) => {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) {
      return _badRequest(res, req.id, "workerId, code and pin are required");
    }

    try {
      const result = activateAccount(db, { ...parsed.data, deviceId: parsed.data.deviceId });
      log.info(
        { event: "trainee_activated", workerId: result.workerId, requestId: req.id },
        "Trainee account activated"
      );
      return _session(res, result);
    } catch (err) {
      if (PIN_POLICY_MESSAGES[err.code]) {
        return res.status(400).json({
          error: { code: err.code, message: PIN_POLICY_MESSAGES[err.code], requestId: req.id }
        });
      }
      if (err.code === "too_many_attempts") {
        return res.status(429).json({
          error: {
            code: "too_many_attempts",
            message: "too many attempts, wait and try again",
            retryAfterSeconds: err.retryAfterSeconds,
            requestId: req.id
          }
        });
      }
      if (err.code === "activation_failed") {
        log.warn({ event: "trainee_activation_rejected", requestId: req.id }, "Activation rejected");
        return res.status(401).json({
          error: {
            code: "activation_failed",
            message: "that activation code is not valid for this worker",
            requestId: req.id
          }
        });
      }
      return next(err);
    }
  });

  // login: worker id + PIN
  router.post("/login", (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return _badRequest(res, req.id, "workerId and pin are required");
    }

    try {
      const result = login(db, parsed.data);
      log.info({ event: "trainee_login", workerId: result.workerId, requestId: req.id }, "Trainee signed in");
      return _session(res, result);
    } catch (err) {
      if (err.code === "too_many_attempts") {
        return res.status(429).json({
          error: {
            code: "too_many_attempts",
            message: "too many attempts, wait and try again",
            retryAfterSeconds: err.retryAfterSeconds,
            requestId: req.id
          }
        });
      }
      if (err.code === "invalid_credentials") {
        log.warn({ event: "trainee_login_rejected", requestId: req.id }, "Trainee sign in rejected");
        return res.status(401).json({
          error: { code: "invalid_credentials", message: "worker ID or PIN is not correct", requestId: req.id }
        });
      }
      return next(err);
    }
  });

  // who am i. the device asks this at startup to find out whether its stored
  // token is still good.
  router.get("/me", requireTrainee(db), (req, res) => {
    res.json({
      workerId: req.trainee.workerId,
      name: req.trainee.name,
      expiresAt: req.trainee.expiresAt
    });
  });

  // logout revokes this token server side, immediately
  router.post("/logout", requireTrainee(db), (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    revokeSession(db, token);
    log.info({ event: "trainee_logout", workerId: req.trainee.workerId, requestId: req.id }, "Trainee signed out");
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter };
