import { getAudioPath } from "../js/audio.js";
import { ACTIVE_EQUIPMENT, EQUIPMENT_CATALOG } from "./equipment-data.js";

// narration wiring for the equipment step.
//
// No equipment clips are recorded yet. Nothing here invents one: there is no list of
// "available" files to keep in sync, the code just asks for the path and believes the
// answer. Drop a real mp3 at the path this resolves and the button lights up on its
// own — the UI never has to be edited to notice.
//
// A missing clip is shown as missing. It is never quietly swapped for another
// locale's recording: a worker who chose Santali and hears Hindi has been told the
// app speaks their language when it does not.

const NARRATION_MODULE_ID = "equipment";

// where the clip for one item in one locale must live
function narrationPath(locale, equipmentId, basePath = "./audio") {
  return getAudioPath(locale, NARRATION_MODULE_ID, equipmentId, basePath);
}

// every clip needed right now, one row per locale per ACTIVE item. equipment still
// waiting on artwork is not in the flow, so recording its narration would be work
// against a screen nobody can reach yet — it joins this list when it goes active.
function requiredNarrationFiles(locales = ["en", "hi", "sat"], equipment = ACTIVE_EQUIPMENT) {
  const rows = [];
  locales.forEach((locale) => {
    equipment.forEach((item) => {
      rows.push({
        locale,
        equipmentId: item.id,
        narrationKey: `${NARRATION_MODULE_ID}_${item.id}`,
        path: narrationPath(locale, item.id)
      });
    });
  });
  return rows;
}

// ask the network/cache whether a clip is actually there.
// offline this answers from the service worker cache, which is the honest answer:
// a clip that is not cached cannot play underground either.
async function probeNarration(path, fetchFn) {
  const fetcher = fetchFn
    || (typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch.bind(window) : null)
    || (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);

  if (!fetcher) return false;

  try {
    const res = await fetcher(path, { method: "HEAD" });
    return Boolean(res && res.ok);
  } catch (_err) {
    return false;
  }
}

// resolve one item's narration for the active locale
async function resolveNarration(locale, equipmentId, fetchFn) {
  const path = narrationPath(locale, equipmentId);
  const available = await probeNarration(path, fetchFn);
  return { locale, equipmentId, path, available };
}

// the same rows for every item in the catalog, active or not, for planning
function allNarrationFiles(locales = ["en", "hi", "sat"]) {
  return requiredNarrationFiles(locales, EQUIPMENT_CATALOG);
}

export {
  NARRATION_MODULE_ID,
  narrationPath,
  requiredNarrationFiles,
  allNarrationFiles,
  probeNarration,
  resolveNarration
};
