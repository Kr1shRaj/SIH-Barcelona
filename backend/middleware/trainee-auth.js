const { resolveSession } = require("../services/accounts");
const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "trainee-auth" });

// The bearer gate for trainee routes.
//
// Built on the same principle as admin-auth.js next door: every failure answers
// identically, so nobody can probe this endpoint to learn whether a worker id
// exists, whether their session is merely expired, or whether their account was
// disabled. The raw token is never logged, never echoed, and never compared with
// a plain string equality.
//
// On success the request carries req.trainee = { accountId, workerId, name }.
// That — and never the request body — is who the caller is.

function _bearerToken(req) {
  const header = req.headers && req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function _refuse(req, res, reason) {
  // the reason rides in the log for us, never in the response for them
  log.warn(
    { event: "trainee_auth_rejected", reason, method: req.method, path: req.path, requestId: req.id },
    "Trainee request rejected"
  );
  return res.status(401).json({
    error: {
      code: "unauthorized",
      message: "sign in to continue",
      requestId: req.id
    }
  });
}

// require a valid session
function requireTrainee(db) {
  if (!db) {
    throw new Error("requireTrainee needs a database instance");
  }

  return function traineeAuth(req, res, next) {
    const token = _bearerToken(req);
    if (!token) {
      return _refuse(req, res, "missing_bearer");
    }

    let session = null;
    try {
      session = resolveSession(db, token);
    } catch (err) {
      return next(err);
    }

    if (!session) {
      return _refuse(req, res, "unresolved_session");
    }

    req.trainee = session;
    return next();
  };
}

module.exports = { requireTrainee };
