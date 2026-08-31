// log structured json events for mobile app
function createLogger(contextName = "SafeAR") {
  function log(level, data, message = "") {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      context: contextName,
      message,
      ...data
    };
    // structured output
    if (level === "error") {
      window.dispatchEvent(new CustomEvent("safear:log", { detail: payload }));
    } else {
      window.dispatchEvent(new CustomEvent("safear:log", { detail: payload }));
    }
    return payload;
  }

  return {
    info: (data, msg) => log("info", data, msg),
    warn: (data, msg) => log("warn", data, msg),
    error: (data, msg) => log("error", data, msg),
    debug: (data, msg) => log("debug", data, msg)
  };
}

const defaultLogger = createLogger("AR");

export { createLogger, defaultLogger };
