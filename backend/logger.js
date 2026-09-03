const pino = require("pino");

// secrets that must never land in a log line
const REDACT_PATHS = [
  "certPrivateKey",
  "certSigningSecret",
  "adminApiKey",
  "secret",
  "*.certPrivateKey",
  "*.certSigningSecret",
  "*.adminApiKey",
  "*.secret",
  "req.headers.authorization",
  'req.headers["x-admin-key"]'
];

let _logger = null;

// build root pino logger, pretty only when human watching in dev
function createRootLogger(env) {
  const raw = env || process.env;
  const options = {
    level: raw.LOG_LEVEL || "info",
    base: { app: "safear-backend" },
    redact: { paths: REDACT_PATHS, remove: true }
  };

  if ((raw.NODE_ENV || "development") === "development") {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" }
      }
    });
  }

  return pino(options);
}

// lazy singleton root logger
function getLogger() {
  if (!_logger) {
    _logger = createRootLogger(process.env);
  }
  return _logger;
}

// tag logs with a component name so route and service lines stay tellable apart
function createChildLogger(bindings) {
  return getLogger().child(bindings || {});
}

// spit config warnings once at boot so placeholder secrets do not slip by
function logConfigWarnings(config, log) {
  const target = log || getLogger();
  (config.warnings || []).forEach((warning) => {
    target.warn({ event: "config_warning" }, warning);
  });
}

// drop cached logger, tests only
function resetLogger() {
  _logger = null;
}

module.exports = {
  createRootLogger,
  getLogger,
  createChildLogger,
  logConfigWarnings,
  resetLogger,
  REDACT_PATHS
};
