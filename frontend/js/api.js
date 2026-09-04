// Shared HTTP helper for talking to the SafeAR backend.
//
// An http status is data, not an exception. A 422 is the server deciding something
// and the caller has to act on that decision, so apiFetch never throws on a status
// code. Only a genuine transport failure is exceptional, and even that comes back
// as a value carrying networkError: true.
//
// This file also owns where the backend IS. Every API caller in the frontend takes
// its base url from resolveApiBase() here and nowhere else, because the old answer
// — a relative path against whatever origin served the page — silently pointed the
// whole app at the static file server and 404'd every call.

const DEFAULT_TIMEOUT_MS = 8000;

const API_BASE_STORAGE_KEY = "safear_api_base";

// npm run dev:frontend serves on 5173, the backend defaults to 3000. this pair is
// the only guess the resolver makes, and it reads the host off location rather than
// naming one, so a phone loading 192.168.x.x:5173 finds 192.168.x.x:3000 by itself.
const DEV_FRONTEND_PORT = "5173";
const DEV_BACKEND_PORT = "3000";

function _window() {
  return (typeof window !== "undefined" && window) ? window : null;
}

// localStorage is not merely absent in some webviews, it throws on access
function _storage() {
  try {
    const win = _window();
    if (win && win.localStorage) return win.localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch (_err) {
    return null;
  }
  return null;
}

// an api base is an address, never a credential. only http and https are accepted,
// so a crafted ?api=javascript:... cannot become an injection point, and a trailing
// slash is trimmed so the caller's leading-slash path never doubles it.
function _normalizeBase(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_err) {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const stripped = trimmed.replace(/\/+$/, "");
  return stripped === "" ? null : stripped;
}

// ?api=http://host:3000 — the demo override. persisted immediately, because the
// worker cannot retype it and a reload would otherwise throw it away.
function _fromQueryParam() {
  const win = _window();
  if (!win || !win.location || typeof win.location.search !== "string") return null;

  try {
    const URLParamsCtor = win.URLSearchParams
      || (typeof globalThis !== "undefined" ? globalThis.URLSearchParams : null);
    if (!URLParamsCtor) return null;
    return _normalizeBase(new URLParamsCtor(win.location.search).get("api"));
  } catch (_err) {
    return null;
  }
}

function _fromStorage() {
  const storage = _storage();
  if (!storage) return null;
  try {
    return _normalizeBase(storage.getItem(API_BASE_STORAGE_KEY));
  } catch (_err) {
    return null;
  }
}

// set by frontend/config.js, which capacitor copies into the apk. this is the only
// way an installed android build can learn a lan backend address.
function _fromGlobalConfig() {
  const win = _window();
  if (win && typeof win.SAFEAR_API_BASE === "string") {
    return _normalizeBase(win.SAFEAR_API_BASE);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.SAFEAR_API_BASE === "string") {
    return _normalizeBase(globalThis.SAFEAR_API_BASE);
  }
  return null;
}

// the zero-config dev case: served from the frontend dev port, so the backend is
// the same host on the backend port
function _fromDevServer() {
  const win = _window();
  if (!win || !win.location) return null;

  const { protocol, hostname, port } = win.location;
  if (port !== DEV_FRONTEND_PORT) return null;
  if (typeof hostname !== "string" || hostname === "") return null;

  const scheme = (protocol === "https:" || protocol === "http:") ? protocol : "http:";
  return `${scheme}//${hostname}:${DEV_BACKEND_PORT}`;
}

// where the backend lives, decided fresh on every call so a test can swap window
// and so a ?api= typed mid-session takes effect without a reload.
//
// "" means same origin, which is right in exactly two places: node, and a future
// where the backend serves the frontend itself. under capacitor it means no backend
// was configured, and the app stays in its offline path rather than inventing one.
function resolveApiBase() {
  const fromQuery = _fromQueryParam();
  if (fromQuery !== null) {
    const storage = _storage();
    if (storage) {
      try {
        storage.setItem(API_BASE_STORAGE_KEY, fromQuery);
      } catch (_err) {
        // a read-only storage still leaves the value good for this session
      }
    }
    return fromQuery;
  }

  const fromStorage = _fromStorage();
  if (fromStorage !== null) return fromStorage;

  const fromConfig = _fromGlobalConfig();
  if (fromConfig !== null) return fromConfig;

  const fromDevServer = _fromDevServer();
  if (fromDevServer !== null) return fromDevServer;

  return "";
}

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
  // an explicit string wins, including a deliberate "". only an absent option asks
  // the resolver, so a caller can always pin the base it wants.
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : resolveApiBase();
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

export {
  apiFetch,
  apiGet,
  apiPost,
  resolveApiBase,
  DEFAULT_TIMEOUT_MS,
  API_BASE_STORAGE_KEY
};
