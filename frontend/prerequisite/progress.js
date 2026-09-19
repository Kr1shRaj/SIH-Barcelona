import { REQUIRED_EQUIPMENT_IDS, MODULE_IDS, requiredEquipmentForModule } from "./equipment-data.js";

// which equipment a worker has already opened, kept on the phone.
//
// Keyed by worker, not by device: a mine phone is shared, and a device-wide flag
// would let the second worker skip what only the first one ever saw.
//
// Every storage touch is wrapped. On an android webview reaching for localStorage
// can itself throw, not just using it, so a bare try around setItem is not enough.

const PREREQ_STORAGE_KEY = "safear_prerequisite_progress";

// get localStorage, or null when it is missing or throws on access
function _getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (_err) {
    return null;
  }
  return null;
}

// normalise a worker id so an empty one cannot collide with a real one
function _workerKey(workerId) {
  if (!workerId || typeof workerId !== "string") return "unknown_worker";
  const clean = workerId.trim();
  return clean.length > 0 ? clean : "unknown_worker";
}

// read the whole progress map, always an object even when storage is broken
function _readAll() {
  const storage = _getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(PREREQ_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_err) {
    return {};
  }
}

// write the whole progress map, false when it could not be stored
function _writeAll(map) {
  const storage = _getStorage();
  if (!storage) return false;
  try {
    storage.setItem(PREREQ_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch (_err) {
    return false;
  }
}

// equipment ids this worker has opened
function getViewedEquipment(workerId) {
  const record = _readAll()[_workerKey(workerId)];
  if (!record || !Array.isArray(record.viewed)) return [];
  return record.viewed.filter((id) => REQUIRED_EQUIPMENT_IDS.includes(id));
}

// record that this worker opened one equipment detail view
function markEquipmentViewed(workerId, equipmentId) {
  if (!REQUIRED_EQUIPMENT_IDS.includes(equipmentId)) return false;

  const key = _workerKey(workerId);
  const map = _readAll();
  const record = map[key] && typeof map[key] === "object" ? map[key] : {};
  const viewed = Array.isArray(record.viewed) ? record.viewed.slice() : [];

  if (!viewed.includes(equipmentId)) {
    viewed.push(equipmentId);
  }

  const complete = REQUIRED_EQUIPMENT_IDS.every((id) => viewed.includes(id));
  map[key] = {
    viewed,
    // stamped once, on the view that finished the set
    completedAt: complete ? (record.completedAt || new Date().toISOString()) : null
  };

  return _writeAll(map);
}

// How far through the set this worker is. With a moduleId it answers for that
// module's own equipment; without one, for everything a worker is expected to read.
function getPrerequisiteProgress(workerId, moduleId) {
  const viewed = getViewedEquipment(workerId);
  const required = requiredEquipmentForModule(moduleId);

  // which modules this worker could start right now. the familiarization screen
  // lets them move on as soon as one is ready, which is what it did when the
  // extinguisher was the only equipment there was.
  const readyModules = MODULE_IDS.filter((id) =>
    requiredEquipmentForModule(id).every((equipmentId) => viewed.includes(equipmentId)));

  return {
    viewed,
    viewedCount: viewed.filter((id) => required.includes(id)).length,
    requiredCount: required.length,
    required,
    remaining: required.filter((id) => !viewed.includes(id)),
    complete: required.every((id) => viewed.includes(id)),
    readyModules,
    anyModuleReady: readyModules.length > 0
  };
}

// true only when every item this module needs has been opened by this worker
function isPrerequisiteComplete(workerId, moduleId) {
  return getPrerequisiteProgress(workerId, moduleId).complete;
}

// when the worker finished the set, or null
function getCompletedAt(workerId) {
  const record = _readAll()[_workerKey(workerId)];
  return record && record.completedAt ? record.completedAt : null;
}

// wipe one worker's progress, leaving every other worker on the phone alone
function resetPrerequisite(workerId) {
  const map = _readAll();
  delete map[_workerKey(workerId)];
  return _writeAll(map);
}

export {
  PREREQ_STORAGE_KEY,
  getViewedEquipment,
  markEquipmentViewed,
  getPrerequisiteProgress,
  isPrerequisiteComplete,
  getCompletedAt,
  resetPrerequisite
};
