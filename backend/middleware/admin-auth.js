const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");
const { createChildLogger } = require("../logger");

const log = createChildLogger({ component: "admin-auth" });

// compare two secrets without leaking length or content through timing
function _sameSecret(supplied, configured) {
  if (typeof supplied !== "string" || typeof configured !== "string") {
    return false;
  }
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(configured, "utf8");
  // timingSafeEqual throws on mismatched lengths, so answer that case first
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

// build the x-admin-key gate for the admin routes, closed when no key is configured
function requireAdminKey(config) {
  const configured = config && typeof config.adminApiKey === "string" ? config.adminApiKey.trim() : "";

  return function adminAuth(req, res, next) {
    // a missing key must never read as "everyone matches". an unconfigured server
    // refuses admin traffic rather than serving the whole workforce roster.
    if (configured === "") {
      log.error(
        { event: "admin_auth_unconfigured", requestId: req.id },
        "ADMIN_API_KEY is not configured, refusing admin request"
      );
      return res.status(401).json({
        error: {
          code: "unauthorized",
          message: "admin access is not configured on this server",
          requestId: req.id
        }
      });
    }

    const supplied = req.headers["x-admin-key"];
    if (!_sameSecret(typeof supplied === "string" ? supplied : "", configured)) {
      // missing and wrong answer the same way, so nobody can probe for a valid key.
      // the key is never read into the log line, and the logger redacts the header.
      log.warn(
        { event: "admin_auth_rejected", method: req.method, path: req.path, requestId: req.id },
        "Admin request rejected"
      );
      return res.status(401).json({
        error: {
          code: "unauthorized",
          message: "missing or invalid x-admin-key",
          requestId: req.id
        }
      });
    }

    return next();
  };
}

module.exports = { requireAdminKey };
