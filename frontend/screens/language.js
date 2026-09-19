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

// The supplied SafeAR logo, trimmed to its own ink so the clear space around it is
// the stylesheet's to set. The untouched original is beside it as
// safear-logo-source.png — see assets/brand/README.md. Same file the loading screen
// uses, so there is one logo in the product and not two.
const BRAND_LOGO = "./assets/brand/safear-logo.png";
const BRAND_LOGO_SIZE = { width: 471, height: 112 };

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

  // the logo is drawn in navy on white, so it keeps the white surface it was drawn
  // for rather than being recoloured or keyed out — see splash.js for the why
  const brand = BRAND_LOGO
    ? `<span class="lang-brand__plate">
         <img class="lang-brand__logo" src="${_esc(BRAND_LOGO)}" alt="${_esc(t("app.title", {}, "SafeAR"))}"
           width="${BRAND_LOGO_SIZE.width}" height="${BRAND_LOGO_SIZE.height}" decoding="async" />
       </span>`
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
  BRAND_LOGO_SIZE,
  LANGUAGE_NATIVE_NAMES,
  LANGUAGE_ROMAN_NAMES,
  LANGUAGE_STORAGE_KEY,
  saveLocalePreference,
  readLocalePreference,
  renderLanguageHtml,
  mountLanguageScreen
};
