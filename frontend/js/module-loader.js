import { createLogger } from "./logger.js";
import { clearCheckpoints } from "../ar/interactions.js";
import {
  startAssessmentSession,
  abortAssessmentSession,
  getActiveSession,
  bindAssessmentSessionListeners,
  getEffectiveWorkerId
} from "../assessment/engine.js";
import { isPrerequisiteComplete, isStage2Passed } from "../prerequisite/progress.js";

const logger = createLogger("ModuleLoader");

// holds the ar tier content-loader fns set by boot, one of each pair may be null
let _sceneLoaders = {
  tier: null,       // 1 or 2
  loadScene: null,  // (moduleId, tierHandle) => void  — throws "not implemented" until Kaamil's content lands
  tierHandle: null  // sessionData (tier1) or trackingState (tier2) — whatever the tier init returned
};

// currently active module ID or null when idle
let _activeModule = null;

// get active module id
function getActiveModule() {
  return _activeModule;
}

// call once after tier init so loader knows which path to use
function setTierLoaders(tier, loadSceneFn, tierHandle) {
  _sceneLoaders = { tier, loadScene: loadSceneFn, tierHandle };
  logger.info({ event: "tier_loaders_set", tier }, "Module loader wired to AR tier");
}

// load named module: force unload any active module, flush checkpoints, then hand off to tier scene loader
async function loadModule(moduleId, options = {}) {
  if (!moduleId || typeof moduleId !== "string") {
    throw new Error("moduleId required");
  }

  // the real gate. the module screen disables its own buttons too, but that is
  // decoration — a worker must not reach a graded module without having been shown
  // the equipment, whatever route they took to get here.
  // an android webview with site data blocked throws on the localStorage property
  // itself. no worker id means no proof anyone read the equipment, so the gate shuts.
  let workerId = null;
  try {
    workerId = getEffectiveWorkerId();
  } catch (err) {
    logger.warn({ event: "worker_id_unavailable", moduleId, error: err.message }, "Cannot identify worker, gate stays shut");
  }

  // the gate is per module: this module's own equipment, not everyone else's
  if (!isPrerequisiteComplete(workerId, moduleId)) {
    logger.warn({ event: "module_blocked_prerequisite", moduleId, workerId }, "Module blocked, equipment familiarization not done");
    throw new Error("equipment familiarization incomplete — finish the prerequisite before starting a module");
  }

  if (options.team === true && !isStage2Passed(workerId, "fire-response")) {
    logger.warn({ event: "team_drill_blocked_stage", moduleId, workerId }, "Team drill blocked, solo stage not passed");
    throw new Error("solo fire drill must pass at 80 percent before team drill");
  }

  // force unload previous module if already active to prevent overlapping state
  if (_activeModule) {
    logger.info({ event: "module_pre_unload", previousModule: _activeModule }, "Unloading active module before loading new one");
    unloadModule();
  }

  logger.info({ event: "module_load_start", moduleId }, "Loading module");

  // wipe any leftover checkpoints from prior module
  clearCheckpoints();

  if (!_sceneLoaders.loadScene) {
    if (getActiveSession()) {
      abortAssessmentSession();
    }
    throw new Error("no tier loader set — call setTierLoaders after boot");
  }

  // bind checkpoint listener and initialize assessment session for this module run
  bindAssessmentSessionListeners();
  startAssessmentSession({ moduleId });

  _activeModule = moduleId;

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("safear:module_loaded", { detail: { moduleId } }));
  }

  try {
    await _sceneLoaders.loadScene(moduleId, _sceneLoaders.tierHandle, options);
    logger.info({ event: "module_load_done", moduleId }, "Module loaded");
  } catch (err) {
    // if loading failed or threw not-implemented, reset active module and assessment state
    _activeModule = null;
    if (getActiveSession()) {
      abortAssessmentSession();
    }
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("safear:module_unloaded", { detail: { moduleId } }));
    }
    throw err;
  }
}

// unload current module: flush checkpoints, remove DOM overlays, notify listeners, and reset active state
function unloadModule() {
  const previous = _activeModule;
  _activeModule = null;
  clearCheckpoints();

  // abort incomplete assessment session if closed without finishing
  if (getActiveSession()) {
    abortAssessmentSession();
  }

  if (typeof document !== "undefined") {
    ["fire-module-overlay", "gas-module-overlay"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && typeof el.remove === "function") el.remove();
    });
  }

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("safear:module_unloaded", { detail: { moduleId: previous } }));
  }

  logger.info({ event: "module_unloaded", previousModule: previous }, "Module unloaded");
}

export { setTierLoaders, loadModule, unloadModule, getActiveModule };
