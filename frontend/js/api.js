// Shared HTTP helper for talking to the SafeAR backend.
//
// An http status is data, not an exception. A 422 is the server deciding something
// and the caller has to act on that decision, so apiFetch never throws on a status
// code. Only a genuine transport failure is exceptional, and even that comes back
// as a value carrying networkError: true.

const DEFAULT_TIMEOUT_MS = 8000;

// browser globals resolve at call time, never at module load, so a test can swap
// them in after import. same convention the assessment engine already uses.
function _fetchHandle() {
  if (typeof window !== "undefined" && window.fetch) return window.fetch;
  if (typeof globalThis !== "undefined" && globalThis.fetch) return globalThis.fetch;
  return null;
}

function _abortControllerCtor() {
  if (typeof window !== "undefined" && window.AbortController) return window.AbortController;
  if (typeof globalThis !== "undefined" && globalThis.AbortController) return globalThis.AbortController;
  return null;
}

function _timers() {
  const set = (typeof window !== "undefined" && window.setTimeout)
    || (typeof globalThis !== "undefined" ? globalThis.setTimeout : null);
  const clear = (typeof window !== "undefined" && window.clearTimeout)
    || (typeof globalThis !== "undefined" ? globalThis.clearTimeout : null);
  return { set, clear };
}

// the backend answers every failure with { error: { code, message, requestId } }.
// keep that shape when it is there, invent a usable one when it is not.
function _normalizeHttpError(status, data) {
  if (data && data.error && typeof data.error === "object") {
    return {
      code: data.error.code || "http_error",
      message: data.error.message || `HTTP ${status}`,
      requestId: data.error.requestId,
      networkError: false
    };
  }
  return { code: "http_error", message: `HTTP ${status}`, networkError: false };
}

// one request. always resolves to { ok, status, data, error }.
// status 0 plus error.networkError means the request never reached the server.
async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const baseUrl = options.baseUrl || "";
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  const fetchHandle = _fetchHandle();
  if (!fetchHandle) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: { code: "no_fetch", message: "no fetch implementation available", networkError: true }
    };
  }

  const AbortCtrl = _abortControllerCtor();
  const { set: setTimer, clear: clearTimer } = _timers();
  const controller = AbortCtrl ? new AbortCtrl() : null;
  const timer = (controller && setTimer) ? setTimer(() => controller.abort(), timeoutMs) : null;

  const init = {
    method,
    headers: Object.assign({}, options.headers),
    signal: controller ? controller.signal : undefined
  };

  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetchHandle(`${baseUrl}${path}`, init);
    if (timer && clearTimer) clearTimer(timer);

    // a body that is not json is not fatal, the status still tells us plenty
    let data = null;
    try {
      data = await res.json();
    } catch (_err) {
      data = null;
    }

    if (res.ok) {
      return { ok: true, status: res.status, data, error: null };
    }
    return { ok: false, status: res.status, data, error: _normalizeHttpError(res.status, data) };
  } catch (err) {
    if (timer && clearTimer) clearTimer(timer);
    const aborted = err && (err.name === "AbortError" || /abort/i.test(err.message || ""));
    return {
      ok: false,
      status: 0,
      data: null,
      error: {
        code: aborted ? "timeout" : "network_error",
        message: err && err.message ? err.message : "request failed",
        networkError: true
      }
    };
  }
}

// small conveniences so callers do not repeat the method every time
function apiGet(path, options = {}) {
  return apiFetch(path, Object.assign({}, options, { method: "GET" }));
}

function apiPost(path, body, options = {}) {
  return apiFetch(path, Object.assign({}, options, { method: "POST", body }));
}

export { apiFetch, apiGet, apiPost, DEFAULT_TIMEOUT_MS };
