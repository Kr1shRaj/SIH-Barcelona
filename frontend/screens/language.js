import { t, setLocale, loadLocale, getLocale, getSupportedLocales } from "../js/i18n.js";
import { createLogger } from "../js/logger.js";

const logger = createLogger("LanguageScreen");

// a language is written in its own script, so these are not translated strings —
// they read the same whichever locale is active, which is the point: a worker has to
// recognise their language before they can read anything else on the screen
const LANGUAGE_NATIVE_NAMES = {
  en: "English",
  hi: "हिन्दी",
  sat: "ᱥᱟᱱᱛᱟᱲᱤ"
};

// latin transliteration under each name, for a worker who reads neither script well
const LANGUAGE_ROMAN_NAMES = {
  en: "English",
  hi: "Hindi",
  sat: "Santali"
};

const LANGUAGE_STORAGE_KEY = "safear_locale";

// Where the SafeAR logo goes, when there is one.
//
// There is no logo asset in this repository — no svg, no png, no icon, no web
// manifest, and no existing logo component anywhere in frontend/ or dashboard/. The
// only SafeAR wordmarks that exist are printed onto the supplied equipment
// photographs, and cutting one out of a jpeg is not a brand asset. So rather than
// draw a stand-in mark, the header shows the product name beside the shield the
// screen already used.
//
// Point this at a file — "./assets/brand/safear-logo.svg", say — and the header uses
// it instead, at the size and spacing the stylesheet already reserves. Add the file
// to STATIC_ASSETS in sw.js at the same time so it is on the phone underground.
const BRAND_LOGO = null;

// escape anything that reaches innerHTML
function _esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// get localStorage, or null when it is missing or throws on access
function _getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch (_err) {
    return null;
  }
  return null;
}

// remember the choice so the worker is not asked again on every launch
function saveLocalePreference(locale) {
  const storage = _getStorage();
  if (!storage) return false;
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, locale);
    return true;
  } catch (_err) {
    return false;
  }
}

// the locale this phone last chose, or null
function readLocalePreference() {
  const storage = _getStorage();
  if (!storage) return null;
  try {
    const stored = storage.getItem(LANGUAGE_STORAGE_KEY);
    return getSupportedLocales().includes(stored) ? stored : null;
  } catch (_err) {
    return null;
  }
}

// the language picker, one big target per language
function renderLanguageHtml(activeLocale) {
  const buttons = getSupportedLocales().map((locale) => {
    const selected = locale === activeLocale;
    return `
      <li class="lang-option">
        <button type="button" class="lang-btn${selected ? " lang-btn--active" : ""}"
          data-action="pick-language" data-locale="${_esc(locale)}"
          lang="${_esc(locale)}" aria-pressed="${selected ? "true" : "false"}">
          <span class="lang-btn__native">${_esc(LANGUAGE_NATIVE_NAMES[locale] || locale)}</span>
          <span class="lang-btn__roman">${_esc(LANGUAGE_ROMAN_NAMES[locale] || locale)}</span>
        </button>
      </li>`;
  }).join("");

  const brand = BRAND_LOGO
    ? `<img class="lang-brand__logo" src="${_esc(BRAND_LOGO)}" alt="${_esc(t("app.title", {}, "SafeAR"))}" />`
    : `<span class="lang-brand__mark" aria-hidden="true">&#128737;</span>
       <span class="lang-brand__name">SafeAR</span>`;

  return `
    <section class="lang-screen" aria-labelledby="lang-title">
      <header class="lang-brand">${brand}</header>
      <h1 class="lang-screen__title" id="lang-title">${_esc(t("app.select_language", {}, "Select Language"))}</h1>
      <p class="lang-screen__hint">${_esc(t("app.select_language_hint", {}, "Choose your preferred language"))}</p>
      <ul class="lang-list">${buttons}</ul>
    </section>
  `;
}

// draw the picker and wire it. picking a language loads its dictionary, then moves on.
function mountLanguageScreen({ container, onPicked } = {}) {
  if (typeof document === "undefined" || !container) return null;

  container.innerHTML = renderLanguageHtml(getLocale());

  const onClick = async (event) => {
    const raw = event && event.target;
    if (!raw || typeof raw.closest !== "function") return;

    const trigger = raw.closest('[data-action="pick-language"]');
    if (!trigger || typeof trigger.getAttribute !== "function") return;

    const locale = trigger.getAttribute("data-locale");
    if (!locale) return;

    try {
      setLocale(locale);
      await loadLocale(locale);
      saveLocalePreference(locale);
      logger.info({ event: "locale_selected", locale }, "Worker picked a language");
    } catch (err) {
      logger.warn({ event: "locale_select_failed", locale, error: err.message }, "Locale select failed");
      return;
    }

    if (typeof onPicked === "function") onPicked(locale);
  };

  if (typeof container.addEventListener === "function") {
    container.addEventListener("click", onClick);
  }

  return { rerender: () => { container.innerHTML = renderLanguageHtml(getLocale()); } };
}

export {
  BRAND_LOGO,
  LANGUAGE_NATIVE_NAMES,
  LANGUAGE_ROMAN_NAMES,
  LANGUAGE_STORAGE_KEY,
  saveLocalePreference,
  readLocalePreference,
  renderLanguageHtml,
  mountLanguageScreen
};
