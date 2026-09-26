// The bar every in-app screen wears: the mark, the screen's title, and the two
// controls a worker may need at any moment — the language they read in, and
// whether the screen is dark or light.
//
// THE TITLE IS CENTRED ON THE VIEWPORT. It is its own full-width block BELOW the
// row of controls, not a cell between them — so the mark on one side and the
// language selector on the other cannot shift it by a pixel however wide they
// grow. Centring it inside the control row was tried first and is what pushed the
// selector over the logo at 412px: the row's middle column is only as wide as
// what is left over, and "what is left over" changes with the locale name.
//
// Language changes do not reload the app and do not touch training state. The
// locale is set, the dictionary is loaded, the choice is written to the same key
// the first-run language screen uses, and the screen is asked to redraw itself.
// Progress lives in storage, not in the markup, so a redraw cannot lose it.

import { t, getLocale, setLocale, loadLocale, getSupportedLocales } from "../js/i18n.js";
import { getTheme, toggleTheme } from "../js/theme.js";
import { getWorkerId } from "../js/session.js";
import { createLogger } from "../js/logger.js";
import { LANGUAGE_NATIVE_NAMES, saveLocalePreference } from "./language.js";

const logger = createLogger("AppBar");

// the mark, at the size a bar wants rather than the size a splash wants
const BRAND_LOGO = "./assets/brand/safear-logo.png";

// what the bar announces when a worker signs out
const SIGN_OUT_EVENT = "safear:signed-out";

// the sign out control only exists for somebody who is signed in
function _isSignedIn() {
  return Boolean(getWorkerId());
}

function _esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The two controls. A native <select> on purpose: it is keyboard accessible, it
// reads correctly to a screen reader, it needs no javascript to open, and on a
// phone it opens the platform's own picker — which is the thing a worker in
// gloves can actually hit.
function renderAppBarControls(locale = getLocale(), theme = getTheme(), signedIn = _isSignedIn()) {
  const options = getSupportedLocales().map((code) => {
    const native = LANGUAGE_NATIVE_NAMES[code] || code.toUpperCase();
    return `<option value="${_esc(code)}"${code === locale ? " selected" : ""}>${_esc(native)}</option>`;
  }).join("");

  const nextTheme = theme === "light" ? "dark" : "light";
  const themeLabel = _esc(t(`app.theme_${nextTheme}`, {}, nextTheme === "light" ? "Switch to light mode" : "Switch to dark mode"));

  return `
    <label class="appbar__lang">
      <span class="eq-sr-only">${_esc(t("app.select_language", {}, "Select Language"))}</span>
      <select class="appbar__select" data-action="switch-language" aria-label="${_esc(t("app.select_language", {}, "Select Language"))}">
        ${options}
      </select>
    </label>
    <button type="button" class="appbar__icon-btn" data-action="toggle-theme"
      aria-label="${themeLabel}" title="${themeLabel}">
      <span class="appbar__icon" aria-hidden="true">${theme === "light" ? "&#9789;" : "&#9788;"}</span>
    </button>
    ${signedIn ? `<button type="button" class="appbar__icon-btn" data-action="sign-out"
      aria-label="${_esc(t("auth.sign_out", {}, "Sign out"))}" title="${_esc(t("auth.sign_out", {}, "Sign out"))}">
      <span class="appbar__icon" aria-hidden="true">&#8677;</span>
    </button>` : ""}
  `;
}

// One bar. `back` puts a control in the leading column; without it that column is
// empty and simply holds the title's share of the width.
function renderAppBar({ title, subtitle = "", back = null, titleId = "screen-title" } = {}) {
  const leading = back
    ? `<button type="button" class="appbar__icon-btn" data-action="${_esc(back.action)}" aria-label="${_esc(back.label)}">
         <span class="appbar__icon" aria-hidden="true">&#8592;</span>
       </button>`
    : "";

  return `
    <header class="appbar">
      <div class="appbar__row">
        <div class="appbar__side appbar__side--start">
          ${leading}
          <span class="appbar__brand">
            <img class="appbar__logo" src="${_esc(BRAND_LOGO)}" alt="SafeAR" width="471" height="112" />
          </span>
        </div>
        <div class="appbar__side appbar__side--end">${renderAppBarControls()}</div>
      </div>
      <div class="appbar__titles">
        <h1 class="appbar__title" id="${_esc(titleId)}">${title}</h1>
        ${subtitle ? `<p class="appbar__subtitle">${subtitle}</p>` : ""}
      </div>
    </header>
  `;
}

// Wire the bar inside `host`. `onLocaleChange` is what redraws the screen: the
// caller owns its own markup, so it decides how to come back.
function bindAppBar(host, { onLocaleChange } = {}) {
  if (!host || typeof host.addEventListener !== "function") return null;

  const onChange = async (event) => {
    const target = event && event.target;
    if (!target || typeof target.getAttribute !== "function") return;
    if (target.getAttribute("data-action") !== "switch-language") return;

    const next = target.value;
    if (!next || next === getLocale()) return;

    try {
      setLocale(next);
      await loadLocale(next);
      saveLocalePreference(next);
      logger.info({ event: "locale_switched_in_app", locale: next }, "Worker changed language mid-session");
    } catch (err) {
      logger.warn({ event: "locale_switch_failed", locale: next, error: err.message }, "Language switch failed");
      return;
    }

    // the screen redraws itself in the new language. nothing about training state
    // is held in the markup, so this cannot lose progress.
    if (typeof onLocaleChange === "function") onLocaleChange(next);
  };

  const onClick = (event) => {
    const raw = event && event.target;
    if (!raw || typeof raw.closest !== "function") return;
    const out = raw.closest('[data-action="sign-out"]');
    if (out) {
      // The queue is deliberately left alone: work a worker has already finished
      // is not thrown away because they handed the phone back.
      //
      // The bar does not own the app's markup, so it announces the sign out and
      // lets whoever mounted the flow decide where to go. No reload: the app can
      // change who it is showing without going back to the network, same as the
      // language switcher does.
      import("./auth.js").then(({ signOut }) => {
        signOut();
        host.dispatchEvent(new CustomEvent(SIGN_OUT_EVENT, { bubbles: true }));
      });
      return;
    }

    const trigger = raw.closest('[data-action="toggle-theme"]');
    if (!trigger) return;
    toggleTheme();
    // the bar redraws so the control shows the theme it would switch TO next
    const side = host.querySelector(".appbar__side--end");
    if (side) side.innerHTML = renderAppBarControls();
  };

  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);

  return {
    destroy() {
      host.removeEventListener("change", onChange);
      host.removeEventListener("click", onClick);
    }
  };
}

export { renderAppBar, renderAppBarControls, bindAppBar, BRAND_LOGO, SIGN_OUT_EVENT };
