import { createLogger } from "../js/logger.js";

const logger = createLogger("Interactions");

// registry: id -> checkpoint definition
const _registry = new Map();

// register a named checkpoint, overwrite if same id
function registerCheckpoint({ id, type, onTrigger }) {
  if (!id || typeof id !== "string") {
    throw new Error("checkpoint id required");
  }
  if (!type || typeof type !== "string") {
    throw new Error("checkpoint type required");
  }
  if (typeof onTrigger !== "function") {
    throw new Error("onTrigger must be a function");
  }

  _registry.set(id, { id, type, onTrigger });
  logger.info({ event: "checkpoint_registered", id, type }, "Checkpoint registered");
}

// unregister checkpoint by id, no-op if missing
function unregisterCheckpoint(id) {
  _registry.delete(id);
  logger.info({ event: "checkpoint_unregistered", id }, "Checkpoint removed");
}

// emit checkpoint result event — this is the contract Kaamil and the assessment engine consume
// event shape on window: CustomEvent "safear:checkpoint"
// detail: {
//   checkpointId: string,
//   type: string,         -- "aim" | "select" | "proximity" | ...
//   passed: boolean,
//   context: object,      -- arbitrary key/values from the trigger (selected option, pose, etc.)
//   timestamp: string     -- ISO 8601
// }
function fireCheckpointResult(checkpointId, passed, context = {}) {
  const entry = _registry.get(checkpointId);
  if (!entry) {
    logger.warn({ event: "checkpoint_fire_unknown", checkpointId }, "Unknown checkpoint — register first");
    return;
  }

  const detail = {
    checkpointId,
    type: entry.type,
    passed: Boolean(passed),
    context,
    timestamp: new Date().toISOString()
  };

  // call module-supplied callback first
  try {
    entry.onTrigger(detail);
  } catch (err) {
    logger.error({ event: "checkpoint_trigger_error", checkpointId, err: err.message }, "onTrigger threw");
  }

  // emit for assessment engine / any listener
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("safear:checkpoint", { detail, bubbles: false }));
  }

  logger.info(detail, "Checkpoint fired");
  return detail;
}

// clear all registered checkpoints — useful between module loads
function clearCheckpoints() {
  _registry.clear();
  logger.info({ event: "checkpoints_cleared" }, "All checkpoints removed");
}

// read-only snapshot of registry for testing / debugging
function getRegisteredCheckpoints() {
  return Array.from(_registry.values()).map(({ id, type }) => ({ id, type }));
}

export {
  registerCheckpoint,
  unregisterCheckpoint,
  fireCheckpointResult,
  clearCheckpoints,
  getRegisteredCheckpoints
};
