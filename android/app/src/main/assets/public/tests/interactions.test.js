import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  registerCheckpoint,
  unregisterCheckpoint,
  fireCheckpointResult,
  clearCheckpoints,
  getRegisteredCheckpoints
} from "../ar/interactions.js";

// stub window for event dispatch in node test env
if (typeof globalThis.window === "undefined") {
  const events = {};
  globalThis.window = {
    dispatchEvent: (ev) => {
      const listeners = events[ev.type] || [];
      listeners.forEach((fn) => fn(ev));
    },
    addEventListener: (type, fn) => {
      if (!events[type]) events[type] = [];
      events[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!events[type]) return;
      events[type] = events[type].filter((f) => f !== fn);
    }
  };
}

describe("Interactions hook system", () => {
  beforeEach(() => {
    clearCheckpoints();
  });

  it("registers a checkpoint and appears in registry", () => {
    registerCheckpoint({ id: "test_aim_01", type: "aim", onTrigger: () => {} });
    const list = getRegisteredCheckpoints();
    assert.ok(list.some((c) => c.id === "test_aim_01" && c.type === "aim"));
  });

  it("throws if id missing on register", () => {
    assert.throws(
      () => registerCheckpoint({ type: "aim", onTrigger: () => {} }),
      /checkpoint id required/
    );
  });

  it("throws if onTrigger not a function", () => {
    assert.throws(
      () => registerCheckpoint({ id: "bad", type: "aim", onTrigger: "nope" }),
      /onTrigger must be a function/
    );
  });

  it("fires checkpoint and calls onTrigger with correct shape", () => {
    let captured = null;
    registerCheckpoint({
      id: "test_select_01",
      type: "select",
      onTrigger: (detail) => { captured = detail; }
    });

    fireCheckpointResult("test_select_01", true, { selected: "option_b" });

    assert.ok(captured !== null, "onTrigger should have been called");
    assert.strictEqual(captured.checkpointId, "test_select_01");
    assert.strictEqual(captured.type, "select");
    assert.strictEqual(captured.passed, true);
    assert.deepStrictEqual(captured.context, { selected: "option_b" });
    assert.ok(typeof captured.timestamp === "string", "timestamp must be a string");
  });

  it("emits safear:checkpoint CustomEvent with correct detail", () => {
    let eventDetail = null;
    window.addEventListener("safear:checkpoint", (ev) => {
      eventDetail = ev.detail;
    });

    registerCheckpoint({
      id: "test_proximity_01",
      type: "proximity",
      onTrigger: () => {}
    });

    fireCheckpointResult("test_proximity_01", false, { distance: 1.2 });

    assert.ok(eventDetail !== null, "event should have been dispatched");
    assert.strictEqual(eventDetail.checkpointId, "test_proximity_01");
    assert.strictEqual(eventDetail.type, "proximity");
    assert.strictEqual(eventDetail.passed, false);
    assert.deepStrictEqual(eventDetail.context, { distance: 1.2 });
  });

  it("warns and returns undefined for unknown checkpoint id", () => {
    const result = fireCheckpointResult("nonexistent_id", true, {});
    assert.strictEqual(result, undefined);
  });

  it("unregisters a checkpoint and it no longer appears", () => {
    registerCheckpoint({ id: "to_remove", type: "aim", onTrigger: () => {} });
    unregisterCheckpoint("to_remove");
    const list = getRegisteredCheckpoints();
    assert.ok(!list.some((c) => c.id === "to_remove"));
  });
});
