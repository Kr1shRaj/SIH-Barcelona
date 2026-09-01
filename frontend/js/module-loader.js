import { createLogger } from "./logger.js";
import { clearCheckpoints } from "../ar/interactions.js";

const logger = createLogger("ModuleLoader");

// holds the ar tier content-loader fns set by boot, one of each pair may be null
let _sceneLoaders = {
  tier: null,       // 1 or 2
  loadScene: null,  // (moduleId, tierHandle) => void  — throws "not implemented" until Kaamil's content lands
  tierHandle: null  // sessionData (tier1) or trackingState (tier2) — whatever the tier init returned
};

// call once after tier init so loader knows which path to use
function setTierLoaders(tier, loadSceneFn, tierHandle) {
  _sceneLoaders = { tier, loadScene: loadSceneFn, tierHandle };
  logger.info({ event: "tier_loaders_set", tier }, "Module loader wired to AR tier");
}

// load named module: flush checkpoints then hand off to tier scene loader
async function loadModule(moduleId) {
  if (!moduleId || typeof moduleId !== "string") {
    throw new Error("moduleId required");
  }

  logger.info({ event: "module_load_start", moduleId }, "Loading module");

  // wipe any leftover checkpoints from prior module
  clearCheckpoints();

  if (!_sceneLoaders.loadScene) {
    throw new Error("no tier loader set — call setTierLoaders after boot");
  }

  // will throw "not implemented" until Kaamil's content lands — that's expected
  await _sceneLoaders.loadScene(moduleId, _sceneLoaders.tierHandle);

  logger.info({ event: "module_load_done", moduleId }, "Module loaded");
}

// unload current module: flush checkpoints and log
function unloadModule() {
  clearCheckpoints();
  logger.info({ event: "module_unloaded" }, "Module unloaded");
}

export { setTierLoaders, loadModule, unloadModule };
