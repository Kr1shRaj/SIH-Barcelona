import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_LOCALE,
  getSupportedLocales,
  getLocale,
  setLocale,
  registerLocale,
  t,
  clearLocales
} from "../js/i18n.js";

describe("i18n Localization Foundation", () => {
  beforeEach(() => {
    clearLocales();
  });

  it("exposes supported locales and default active locale", () => {
    assert.deepStrictEqual(getSupportedLocales(), ["hi", "sat", "en"]);
    assert.strictEqual(getLocale(), DEFAULT_LOCALE);
  });

  it("sets active locale when valid and throws for unsupported", () => {
    assert.strictEqual(setLocale("en"), "en");
    assert.strictEqual(getLocale(), "en");

    assert.strictEqual(setLocale("sat"), "sat");
    assert.strictEqual(getLocale(), "sat");

    assert.throws(() => setLocale("es"), /unsupported locale/);
    assert.throws(() => setLocale(null), /locale must be a string/);
  });

  it("translates registered keys in active locale", () => {
    registerLocale("hi", {
      app: {
        title: "SafeAR — सुरक्षा प्रशिक्षण"
      }
    });

    setLocale("hi");
    assert.strictEqual(t("app.title"), "SafeAR — सुरक्षा प्रशिक्षण");
  });

  it("falls back to English when key is missing in active locale", () => {
    registerLocale("en", {
      modules: {
        fire_response: {
          step_exit: "Identify Emergency Exit"
        }
      }
    });

    setLocale("sat");
    assert.strictEqual(t("modules.fire_response.step_exit"), "Identify Emergency Exit");
  });

  it("returns default fallback if provided and key is absent in all dictionaries", () => {
    setLocale("hi");
    assert.strictEqual(t("nonexistent.key", {}, "Default Fallback Text"), "Default Fallback Text");
  });

  it("returns key itself when not found and no fallback given", () => {
    setLocale("hi");
    assert.strictEqual(t("missing.key"), "missing.key");
  });

  it("interpolates parameters in translation strings", () => {
    registerLocale("en", {
      greeting: "Hello, {name}! Your score is {score}."
    });

    setLocale("en");
    const result = t("greeting", { name: "Worker", score: 95 });
    assert.strictEqual(result, "Hello, Worker! Your score is 95.");
  });

  it("gracefully handles missing keys and empty inputs", () => {
    assert.strictEqual(t(null), "");
    assert.strictEqual(t(""), "");
  });

  it("ensures team drill keys exist across en, hi, and sat locales", async () => {
    const fs = await import("fs");
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const hi = JSON.parse(fs.readFileSync(new URL("../locales/hi.json", import.meta.url), "utf8"));
    const sat = JSON.parse(fs.readFileSync(new URL("../locales/sat.json", import.meta.url), "utf8"));

    const fireKeys = [
      "team_locked_title", "team_locked_desc", "team_room_required",
      "team_connecting", "team_join_failed", "team_backend_unconfigured",
      "team_state_rejected", "team_connection_error", "team_connection_lost",
      "team_peer_weak", "team_drill_aborted", "team_same_marker",
      "action_alarm", "action_ext", "action_evac", "peer_action_started",
      "peer_action_completed", "dist_away", "hud_dist_fire", "team_debrief_title",
      "team_passed", "team_failed", "team_your_role_score", "bd_completion",
      "bd_speed", "bd_errors", "team_btn_replay", "team_btn_exit",
      "team_marker_calibrated", "team_calibrate_notice", "team_self",
      "team_status_present", "team_status_waiting", "team_lobby_header",
      "team_ready_waiting", "team_ready", "team_tier1_error", "team_tier1_desc",
      "team_wifi_notice", "team_role", "team_wait", "team_unguided_prompt",
      "team_alarm_hint", "team_ext_hint", "team_evac_hint", "team_complete",
      "team_alarm_instr", "team_wait_alarm", "team_ext_instr", "team_wait_ext",
      "team_backup_instr", "team_wait_evac", "team_done"
    ];

    const modKeys = [
      "team_join_title", "room_code", "select_role", "role_alarm",
      "role_extinguisher", "role_backup", "role_extinguisher_operator",
      "role_backup_coordinator", "join_btn"
    ];

    for (const [code, dict] of [["en", en], ["hi", hi], ["sat", sat]]) {
      assert.ok(dict.fire, `missing fire in ${code}`);
      assert.ok(dict.modules?.fire_response, `missing modules.fire_response in ${code}`);

      for (const k of fireKeys) {
        assert.ok(dict.fire[k], `missing fire.${k} in ${code}`);
        assert.ok(dict.fire[k].length > 0, `empty fire.${k} in ${code}`);
      }

      for (const k of modKeys) {
        assert.ok(dict.modules.fire_response[k], `missing modules.fire_response.${k} in ${code}`);
        assert.ok(dict.modules.fire_response[k].length > 0, `empty modules.fire_response.${k} in ${code}`);
      }
    }
  });
});
