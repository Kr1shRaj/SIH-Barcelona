const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const pinoHttp = require("pino-http");
const { getLogger } = require("./logger");
const { notFoundHandler, errorHandler } = require("./middleware/error");
const { createModulesRouter } = require("./routes/modules");
const { createSyncRouter } = require("./routes/sync");
const { createDashboardRouter } = require("./routes/dashboard");

// only echo an origin we were told about, no wildcard anywhere
function _buildCorsOptions(allowedOrigins) {
  return {
    origin(origin, callback) {
      // curl, native http clients and same origin requests send no Origin header
      if (!origin) {
        return callback(null, true);
      }
      return callback(null, allowedOrigins.indexOf(origin) !== -1);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-admin-key"],
    credentials: false,
    maxAge: 600
  };
}

// build the express app without binding a port, so supertest can drive it
function createApp({ db, config, logger }) {
  const app = express();
  const rootLogger = logger || getLogger();

  app.disable("x-powered-by");

  // every request gets an id, and it rides along into error responses
  app.use(
    pinoHttp({
      logger: rootLogger,
      genReqId(req, res) {
        const existing = req.headers["x-request-id"];
        const id = existing || crypto.randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      customLogLevel(req, res, err) {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      }
    })
  );

  app.use(cors(_buildCorsOptions(config.allowedOrigins)));
  app.use(express.json({ limit: config.bodyLimit }));

  // liveness plus a real database probe, a health check that skips the db is theatre
  app.get("/api/health", (req, res) => {
    try {
      db.prepare("SELECT 1 AS ok").get();
    } catch (err) {
      req.log.error({ event: "health_db_down", err }, "Health probe could not reach the database");
      return res.status(503).json({
        ok: false,
        db: "down",
        ts: new Date().toISOString(),
        requestId: req.id
      });
    }

    return res.json({
      ok: true,
      db: "up",
      ts: new Date().toISOString(),
      requestId: req.id
    });
  });

  app.use("/api/modules", createModulesRouter({ db }));
  app.use("/api/sync", createSyncRouter({ db }));
  app.use("/api/dashboard", createDashboardRouter({ db }));

  // certs router stays unmounted on purpose. its factory still
  // throws not implemented, and mounting it would kill the server at boot.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
