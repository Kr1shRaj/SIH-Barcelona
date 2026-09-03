const { getConfig } = require("./config");
const { getLogger, logConfigWarnings, createChildLogger } = require("./logger");
const { initDatabase, closeDatabase } = require("./db/index");
const { createApp } = require("./app");

// start express server and hook routes
function startServer(options = {}) {
  const config = options.config || getConfig();
  const logger = options.logger || getLogger();
  const log = createChildLogger({ component: "server" });

  logConfigWarnings(config, log);

  const db = options.db || initDatabase(config.dbPath);
  const app = createApp({ db, config, logger });

  const server = app.listen(config.port, () => {
    log.info(
      {
        event: "server_listening",
        port: config.port,
        nodeEnv: config.nodeEnv,
        allowedOrigins: config.allowedOrigins
      },
      `SafeAR backend listening on port ${config.port}`
    );
  });

  // let sqlite finish and close cleanly instead of dying mid write
  function close() {
    return new Promise((resolve) => {
      server.close(() => {
        closeDatabase();
        log.info({ event: "server_closed" }, "Server stopped");
        resolve();
      });
    });
  }

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.once(signal, () => {
      log.info({ event: "signal_received", signal }, "Shutting down");
      close().then(() => process.exit(0));
    });
  });

  return { app, server, db, close };
}

// npm start has to actually start something. defining startServer and never
// calling it made the old stub exit 0 and look like success.
if (require.main === module) {
  startServer();
}

module.exports = { startServer };
