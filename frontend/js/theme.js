// Which of the two themes the app is wearing.
//
// There is exactly one place that decides this and one place that records it. A
// screen never asks: it is styled against the tokens in css/style.css, and those
// are redefined wholesale by the data-theme attribute this module stamps on
// <html>. That is why adding a screen costs no theme work at all.
//
// The order of preference:
//   1. what this worker chose, kept in localStorage
//   2. what their phone asks for (prefers-color-scheme)
//   3. dark, which is what this product is for — a mine, and a camera feed
//
// Everything here works with no network. The preference is a single string in
// local storage, read synchronously, and the stylesheet is already on the device.
//
// The first stamp does NOT happen here. index.html carries a tiny inline copy of
// this decision so the attribute is on <html> before the first paint; if it were
// left to this module the worker would see a flash of the wrong theme while the
// module graph loaded. This file is the authority afterwards, and the two agree
// because they read the same key and the same rules.

const THEME_STORAGE_KEY = "safear_theme";
const THEMES = ["dark", "light"];
const DEFAULT_THEME = "dark";

// localStorage is not merely absent in some webviews, it throws on access
function _storage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch (_err) {
    return null;
  }
  return null;
}

function _root() {
  if (typeof document === "undefined") return null;
  return document.documentElement || null;
}

function isTheme(value) {
  return typeof value === "string" && THEMES.indexOf(value) !== -1;
}

// what this worker chose last time, or null if they never said
function readThemePreference() {
  const storage = _storage();
  if (!storage) return null;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch (_err) {
    return null;
  }
}

// what the phone asks for, or null when it does not say
function systemTheme() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch (_err) {
    return null;
  }
  return null;
}

// the theme that should be live right now, by the rules above
function resolveTheme() {
  const chosen = readThemePreference();
  if (chosen) return chosen;
  return systemTheme() || DEFAULT_THEME;
}

// what is on screen at this moment
function getTheme() {
  const root = _root();
  const stamped = root && typeof root.getAttribute === "function" ? root.getAttribute("data-theme") : null;
  return isTheme(stamped) ? stamped : resolveTheme();
}

// put a theme on screen. does not record a preference — see setTheme.
function applyTheme(theme) {
  const next = isTheme(theme) ? theme : DEFAULT_THEME;
  const root = _root();
  if (root && typeof root.setAttribute === "function") {
    root.setAttribute("data-theme", next);
  }

  // the android status bar reads this, so it follows the app rather than staying
  // on whatever the page was built with
  if (typeof document !== "undefined" && typeof document.querySelector === "function") {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && typeof meta.setAttribute === "function") {
      meta.setAttribute("content", next === "light" ? "#f4f5f7" : "#111315");
    }
  }
  return next;
}

// this worker's choice: apply it and remember it
function setTheme(theme) {
  const next = applyTheme(theme);
  const storage = _storage();
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, next);
    } catch (_err) {
      // a read-only storage still leaves the choice good for this session
    }
  }
  return next;
}

function toggleTheme() {
  return setTheme(getTheme() === "light" ? "dark" : "light");
}

// Put the resolved theme on screen at boot, and keep following the phone for as
// long as this worker has never chosen for themselves. Once they choose, their
// choice wins and the phone is ignored.
function initTheme() {
  const applied = applyTheme(resolveTheme());

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      const query = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => {
        if (readThemePreference()) return;
        applyTheme(systemTheme() || DEFAULT_THEME);
      };
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", onChange);
      } else if (typeof query.addListener === "function") {
        query.addListener(onChange);
      }
    } catch (_err) {
      // an environment without media query events simply keeps what it has
    }
  }

  return applied;
}

export {
  THEME_STORAGE_KEY,
  THEMES,
  DEFAULT_THEME,
  isTheme,
  readThemePreference,
  systemTheme,
  resolveTheme,
  getTheme,
  applyTheme,
  setTheme,
  toggleTheme,
  initTheme
};
