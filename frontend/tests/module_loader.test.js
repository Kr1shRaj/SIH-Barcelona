import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { setTierLoaders, loadModule, unloadModule } from "../js/module-loader.js";
import { registerCheckpoint, getRegisteredCheckpoints, clearCheckpoints } from "../ar/interactions.js";

// stub window for logger + interactions event dispatch
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    dispatchEvent: () => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

describe("Module lifecycle (module-loader.js)", () => {
  beforeEach(() => {
    clearCheckpoints();
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

  it("unloadModule clears checkpoints", () => {
    registerCheckpoint({ id: "active_cp", type: "select", onTrigger: () => {} });
    assert.strictEqual(getRegisteredCheckpoints().length, 1);

    unloadModule();

    assert.strictEqual(getRegisteredCheckpoints().length, 0);
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
