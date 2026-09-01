import { createLogger } from "./logger.js";
import { clearCheckpoints } from "../ar/interactions.js";

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
async function loadModule(moduleId) {
  if (!moduleId || typeof moduleId !== "string") {
    throw new Error("moduleId required");
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
    throw new Error("no tier loader set — call setTierLoaders after boot");
  }

  _activeModule = moduleId;

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("safear:module_loaded", { detail: { moduleId } }));
  }

  try {
    await _sceneLoaders.loadScene(moduleId, _sceneLoaders.tierHandle);
    logger.info({ event: "module_load_done", moduleId }, "Module loaded");
  } catch (err) {
    // if loading failed or threw not-implemented, reset active module state
    _activeModule = null;
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
