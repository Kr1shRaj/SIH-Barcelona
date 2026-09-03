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
});
