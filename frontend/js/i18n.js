const SUPPORTED_LOCALES = ["hi", "sat", "en"];
const DEFAULT_LOCALE = "hi";
const FALLBACK_LOCALE = "en";

let _activeLocale = DEFAULT_LOCALE;
const _translations = {
  hi: {},
  sat: {},
  en: {}
};

// get list of supported locale codes
function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

// get currently active locale code
function getLocale() {
  return _activeLocale;
}

// set active locale if supported
function setLocale(locale) {
  if (!locale || typeof locale !== "string") {
    throw new Error("locale must be a string");
  }
  const clean = locale.toLowerCase().trim();
  if (!SUPPORTED_LOCALES.includes(clean)) {
    throw new Error(`unsupported locale "${locale}", must be one of: ${SUPPORTED_LOCALES.join(", ")}`);
  }
  _activeLocale = clean;
  return _activeLocale;
}

// register dictionary for given locale
function registerLocale(locale, dictionary) {
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`cannot register unknown locale "${locale}"`);
  }
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
    throw new Error("dictionary must be an object");
  }
  _translations[locale] = { ..._translations[locale], ...dictionary };
}

// load locale json file from filesystem or network
async function loadLocale(locale = _activeLocale, basePath = "./locales") {
  const targetLocale = locale || _activeLocale || DEFAULT_LOCALE;
  if (!targetLocale || !SUPPORTED_LOCALES.includes(targetLocale)) {
    throw new Error(`unsupported locale "${targetLocale}"`);
  }

  const fetchFn = (typeof window !== "undefined" && typeof window.fetch === "function")
    ? window.fetch
    : (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch : null);

  if (fetchFn) {
    try {
      const res = await fetchFn(`${basePath}/${targetLocale}.json`);
      if (res && res.ok) {
        const data = await res.json();
        registerLocale(targetLocale, data);
        return data;
      }
    } catch (_err) {
      // fallback to filesystem in node if fetch failed or relative url rejected
    }
  }

  const gProcess = typeof globalThis !== "undefined" && globalThis.process ? globalThis.process : null;
  if (gProcess && gProcess.versions && gProcess.versions.node) {
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const p1 = resolve(gProcess.cwd(), basePath, `${targetLocale}.json`);
      const cleanRel = basePath.replace(/^\.\//, "");
      const p2 = resolve(gProcess.cwd(), "frontend", cleanRel, `${targetLocale}.json`);
      const filePath = existsSync(p1) ? p1 : (existsSync(p2) ? p2 : null);
      if (filePath) {
        const raw = readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        registerLocale(targetLocale, data);
        return data;
      }
    } catch (_err) {
      // fallback to pre-registered data
    }
  }

  return _translations[targetLocale] || {};
}

// resolve dot separated path inside nested object
function _resolveNestedKey(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === "string" ? current : undefined;
}

// interpolate named parameters in translation string
function _interpolate(text, params) {
  if (!params || typeof params !== "object") return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

// translate key into active locale with fallback
function t(key, params = {}, defaultFallback = "") {
  if (!key || typeof key !== "string") return "";

  let fallback = defaultFallback;
  let interpolations = params;
  if (typeof params === "string") {
    fallback = params;
    interpolations = {};
  }

  // 1. search in active locale
  let translated = _resolveNestedKey(_translations[_activeLocale], key);

  // 2. search in fallback locale
  if (translated === undefined && _activeLocale !== FALLBACK_LOCALE) {
    translated = _resolveNestedKey(_translations[FALLBACK_LOCALE], key);
  }

  // 3. search in default locale (hi)
  if (translated === undefined && _activeLocale !== DEFAULT_LOCALE && FALLBACK_LOCALE !== DEFAULT_LOCALE) {
    translated = _resolveNestedKey(_translations[DEFAULT_LOCALE], key);
  }

  if (translated !== undefined) {
    return _interpolate(translated, interpolations);
  }

  if (fallback && typeof fallback === "string") {
    return _interpolate(fallback, interpolations);
  }

  return key;
}

// reset all registered locale dictionaries
function clearLocales() {
  _activeLocale = DEFAULT_LOCALE;
  SUPPORTED_LOCALES.forEach((loc) => {
    _translations[loc] = {};
  });
}

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  getSupportedLocales,
  getLocale,
  setLocale,
  registerLocale,
  loadLocale,
  t,
  clearLocales
};
