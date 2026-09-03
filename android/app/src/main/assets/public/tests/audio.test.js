import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  getAudioPath,
  getAudioStatus,
  playNarration,
  stopNarration,
  resetAudioState
} from "../js/audio.js";
import { setLocale } from "../js/i18n.js";

describe("Audio Narration Foundation", () => {
  beforeEach(() => {
    resetAudioState();
    setLocale("hi");
  });

  it("generates deterministic audio path from locale, module, and step key", () => {
    const firePathHi = getAudioPath("hi", "fire-response", "step_1_exit");
    assert.strictEqual(firePathHi, "./audio/hi/fire_response_step_1_exit.mp3");

    const gasPathSat = getAudioPath("sat", "gas-leak", "step_2_ppe");
    assert.strictEqual(gasPathSat, "./audio/sat/gas_leak_step_2_ppe.mp3");

    const customBase = getAudioPath("en", "fire-response", "step_3_evacuate", "/assets/audio");
    assert.strictEqual(customBase, "/assets/audio/en/fire_response_step_3_evacuate.mp3");
  });

  it("uses active locale when locale argument is omitted", () => {
    setLocale("sat");
    const path = getAudioPath(null, "gas-leak", "step_1_hazard");
    assert.strictEqual(path, "./audio/sat/gas_leak_step_1_hazard.mp3");
  });

  it("returns failure when moduleId or stepKey is missing", () => {
    const res1 = playNarration({ moduleId: null, stepKey: "step_1" });
    assert.strictEqual(res1.success, false);
    assert.strictEqual(res1.reason, "missing_args");

    const res2 = playNarration({ moduleId: "fire-response", stepKey: null });
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.reason, "missing_args");
  });

  it("sets narration status when playNarration is invoked", () => {
    const res = playNarration({ moduleId: "fire-response", stepKey: "step_1_exit", locale: "hi" });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.path, "./audio/hi/fire_response_step_1_exit.mp3");

    const status = getAudioStatus();
    assert.strictEqual(status.moduleId, "fire-response");
    assert.strictEqual(status.stepKey, "step_1_exit");
    assert.strictEqual(status.locale, "hi");
    assert.strictEqual(status.src, "./audio/hi/fire_response_step_1_exit.mp3");
  });

  it("resets audio status on stopNarration", () => {
    playNarration({ moduleId: "gas-leak", stepKey: "step_2_ppe", locale: "sat" });
    stopNarration();

    const status = getAudioStatus();
    assert.strictEqual(status.playing, false);
    assert.strictEqual(status.src, null);
    assert.strictEqual(status.moduleId, null);
  });
});
