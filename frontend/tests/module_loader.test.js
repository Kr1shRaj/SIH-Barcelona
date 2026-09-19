import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { setTierLoaders, loadModule, unloadModule, getActiveModule } from "../js/module-loader.js";
import { registerCheckpoint, getRegisteredCheckpoints, clearCheckpoints } from "../ar/interactions.js";
import { getEffectiveWorkerId } from "../assessment/engine.js";
import { REQUIRED_EQUIPMENT_IDS } from "../prerequisite/equipment-data.js";
import { markEquipmentViewed } from "../prerequisite/progress.js";

// stub window for logger + interactions event dispatch
const _dispatchedEvents = [];

// loadModule now refuses a module until the worker has been through equipment
// familiarization, and that progress lives in localStorage. node has none, so the
// tests supply one and walk the set in beforeEach — the gate itself is exercised in
// prerequisite.test.js, which is where it belongs.
let _store = {};
const _storage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null),
  setItem: (key, value) => { _store[key] = String(value); },
  removeItem: (key) => { delete _store[key]; },
  clear: () => { _store = {}; }
};
globalThis.localStorage = _storage;

globalThis.window = {
  localStorage: _storage,
  dispatchEvent: (ev) => {
    _dispatchedEvents.push(ev);
  },
  addEventListener: () => {},
  removeEventListener: () => {}
};

// mark every required item as seen, the way a worker who read them all would
function completePrerequisite() {
  const workerId = getEffectiveWorkerId();
  REQUIRED_EQUIPMENT_IDS.forEach((id) => markEquipmentViewed(workerId, id));
}

describe("Module lifecycle (module-loader.js)", () => {
  beforeEach(() => {
    unloadModule();
    clearCheckpoints();
    _dispatchedEvents.length = 0;
    _store = {};
    completePrerequisite();
  });

  it("loadModule refuses every module until the prerequisite is complete", async () => {
    _store = {};
    setTierLoaders(2, async () => {}, null);

    await assert.rejects(() => loadModule("fire-response"), /equipment familiarization incomplete/);
    assert.strictEqual(getActiveModule(), null, "a blocked module must not become active");

    completePrerequisite();
    await loadModule("fire-response");
    assert.strictEqual(getActiveModule(), "fire-response");
  });

  it("loadModule clears prior checkpoints before attempting load", async () => {
    // seed a leftover checkpoint from a previous module
    registerCheckpoint({ id: "leftover_cp", type: "aim", onTrigger: () => {} });
    assert.strictEqual(getRegisteredCheckpoints().length, 1, "should have 1 before load");

    // stub loader that resolves immediately (does not throw)
    setTierLoaders(2, async () => {}, null);

    await loadModule("gas-leak");

    // loader should have flushed checkpoints before calling the scene fn
    assert.strictEqual(getRegisteredCheckpoints().length, 0, "checkpoints must be cleared after load");
  });

  it("unloadModule clears checkpoints and resets active module", () => {
    registerCheckpoint({ id: "active_cp", type: "select", onTrigger: () => {} });
    assert.strictEqual(getRegisteredCheckpoints().length, 1);

    unloadModule();

    assert.strictEqual(getRegisteredCheckpoints().length, 0);
    assert.strictEqual(getActiveModule(), null);
  });

  it("loadModule sets active module and emits safear:module_loaded event", async () => {
    setTierLoaders(2, async () => {}, null);

    await loadModule("fire-response");

    assert.strictEqual(getActiveModule(), "fire-response");
    const loadedEv = _dispatchedEvents.find((e) => e.type === "safear:module_loaded");
    assert.ok(loadedEv, "safear:module_loaded must be dispatched");
    assert.strictEqual(loadedEv.detail.moduleId, "fire-response");
  });

  it("unloadModule emits safear:module_unloaded event", async () => {
    setTierLoaders(2, async () => {}, null);
    await loadModule("fire-response");

    unloadModule();

    assert.strictEqual(getActiveModule(), null);
    const unloadedEv = _dispatchedEvents.find((e) => e.type === "safear:module_unloaded");
    assert.ok(unloadedEv, "safear:module_unloaded must be dispatched");
    assert.strictEqual(unloadedEv.detail.moduleId, "fire-response");
  });

  it("attempting to load a second module while one is active force-unloads previous module", async () => {
    const loadedOrder = [];
    setTierLoaders(2, async (moduleId) => {
      loadedOrder.push(moduleId);
    }, null);

    // load first module
    await loadModule("fire-response");
    assert.strictEqual(getActiveModule(), "fire-response");

    // load second module without manual unload
    await loadModule("gas-leak");
    assert.strictEqual(getActiveModule(), "gas-leak");
    assert.deepStrictEqual(loadedOrder, ["fire-response", "gas-leak"]);

    // verify unloaded event was fired for fire-response before gas-leak loaded
    const unloadedIdx = _dispatchedEvents.findIndex((e) => e.type === "safear:module_unloaded" && e.detail.moduleId === "fire-response");
    const gasLoadedIdx = _dispatchedEvents.findIndex((e) => e.type === "safear:module_loaded" && e.detail.moduleId === "gas-leak");
    assert.ok(unloadedIdx !== -1, "unloaded event must fire for first module");
    assert.ok(gasLoadedIdx !== -1, "loaded event must fire for second module");
    assert.ok(unloadedIdx < gasLoadedIdx, "first module must unload before second module loads");
  });

  it("throws if moduleId is missing", async () => {
    setTierLoaders(2, async () => {}, null);
    await assert.rejects(
      () => loadModule(""),
      /moduleId required/
    );
  });

  it("throws if no tier loader has been set", async () => {
    // force a null state
    setTierLoaders(null, null, null);
    await assert.rejects(
      () => loadModule("fire-response"),
      /no tier loader set/
    );
  });

  it("propagates not-implemented throw from scene loader stub", async () => {
    // simulate the real webxr.js / marker.js stubs that throw "not implemented"
    setTierLoaders(1, async () => { throw new Error("not implemented"); }, null);

    await assert.rejects(
      () => loadModule("fire-response"),
      /not implemented/
    );
    assert.strictEqual(getActiveModule(), null);
  });

  it("checkpoints registered AFTER loadModule call are not cleared by the same load", async () => {
    // loadModule clears first, then calls scene fn; scene fn registers its own checkpoints
    setTierLoaders(2, async () => {
      registerCheckpoint({ id: "module_cp", type: "proximity", onTrigger: () => {} });
    }, null);

    await loadModule("fire-response");

    const list = getRegisteredCheckpoints();
    assert.ok(list.some((c) => c.id === "module_cp"), "module checkpoint should survive the load");
  });
});
