import { allEquipmentLocaleKeys } from "./equipment-data.js";

// which of this feature's strings are still waiting on a human Santali translation.
//
// Ol Chiki has no settled vocabulary for most of this equipment — there is no agreed
// term for a multi-gas detector or a dorsal D-ring — and guessing one would put a
// word in a worker's language that no worker uses. So none of it is machine-written.
// The keys below are deliberately absent from sat.json; t() falls back, and the UI
// marks what it is showing as untranslated rather than passing it off as Santali.
//
// The pairing is enforced from both ends by the prerequisite tests: a key here must
// not exist in sat.json, and a new key must not appear in neither place. Land a real
// translation, delete the key here, and the test tells you if you missed one.

// prerequisite chrome, over and above the equipment content itself
const PREREQUISITE_UI_KEYS = [
  "app.select_language_hint",
  "prerequisite.title",
  "prerequisite.subtitle",
  "prerequisite.progress",
  "prerequisite.card_open_hint",
  "prerequisite.card_viewed",
  "prerequisite.badge_fire",
  "prerequisite.badge_gas",
  "prerequisite.badge_both",
  "prerequisite.complete_title",
  "prerequisite.complete_desc",
  "prerequisite.locked_notice",
  "prerequisite.detail_components",
  "prerequisite.btn_listen",
  "prerequisite.audio_unavailable",
  "prerequisite.btn_prev",
  "prerequisite.btn_next",
  "prerequisite.btn_done",
  "prerequisite.btn_close",
  "prerequisite.translation_pending",
  "prerequisite.item_position",
  "prerequisite.btn_reassemble",
  "prerequisite.explode_hint",
  "prerequisite.tap_to_dismantle",
  "modules.select_title",
  "modules.select_subtitle",
  "modules.locked"
];

// a language's own name is written the same in every locale, so it is not a
// translation and is not pending. same for the continue control, which already
// has a team-approved santali string in the locale file.
const SAT_PENDING_KEYS = new Set([
  ...allEquipmentLocaleKeys(),
  ...PREREQUISITE_UI_KEYS
]);

// true when this locale has no approved translation for this key yet
function isTranslationPending(locale, key) {
  return locale === "sat" && SAT_PENDING_KEYS.has(key);
}

// every key awaiting translation, sorted, for the manifest and the tests
function pendingKeysForLocale(locale) {
  if (locale !== "sat") return [];
  return [...SAT_PENDING_KEYS].sort();
}

export {
  PREREQUISITE_UI_KEYS,
  SAT_PENDING_KEYS,
  isTranslationPending,
  pendingKeysForLocale
};
