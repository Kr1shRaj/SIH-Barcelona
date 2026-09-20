import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const FRONTEND = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const readFile = (rel) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

// a localStorage that behaves, and one that throws, because a webview does both
function installStorage({ throwing = false } = {}) {
  const map = new Map();
  globalThis.localStorage = throwing
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} }
    : {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k)
    };
  return map;
}

// the smallest <html> that theme.js needs
function installDocument({ prefersLight = false } = {}) {
  const attrs = new Map();
  globalThis.document = {
    documentElement: {
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null)
    },
    querySelector: () => null
  };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    matchMedia: (query) => ({
      matches: query.includes("light") ? prefersLight : !prefersLight,
      addEventListener() {},
      removeEventListener() {}
    })
  };
  return attrs;
}

describe("23. dark and light are one system, not two stylesheets", () => {
  let theme = null;

  beforeEach(async () => {
    installStorage();
    installDocument();
    theme = await import(`../js/theme.js?fresh=${Math.random()}`);
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it("23a. a worker's choice is remembered, and beats the phone", async () => {
    const attrs = installDocument({ prefersLight: true });
    theme.setTheme("dark");

    assert.strictEqual(attrs.get("data-theme"), "dark", "the choice is on screen");
    assert.strictEqual(theme.readThemePreference(), "dark", "and it is recorded");
    // the phone asks for light; the worker asked for dark, and the worker wins
    assert.strictEqual(theme.resolveTheme(), "dark");
  });

  it("23b. with no choice recorded, the phone decides", async () => {
    installDocument({ prefersLight: true });
    assert.strictEqual(theme.readThemePreference(), null);
    assert.strictEqual(theme.resolveTheme(), "light");

    installDocument({ prefersLight: false });
    assert.strictEqual(theme.resolveTheme(), "dark");
  });

  it("23c. with neither, it is dark — this app is used underground", () => {
    globalThis.window = { matchMedia: undefined };
    assert.strictEqual(theme.resolveTheme(), theme.DEFAULT_THEME);
    assert.strictEqual(theme.DEFAULT_THEME, "dark");
  });

  it("23d. toggling moves between exactly the two themes", () => {
    theme.setTheme("dark");
    assert.strictEqual(theme.toggleTheme(), "light");
    assert.strictEqual(theme.toggleTheme(), "dark");
    assert.deepStrictEqual(theme.THEMES, ["dark", "light"]);
  });

  it("23e. a junk or absent preference never reaches the page", () => {
    const store = installStorage();
    store.set("safear_theme", "hot-pink");
    assert.strictEqual(theme.readThemePreference(), null, "an unknown theme is not a theme");
    assert.strictEqual(theme.applyTheme("hot-pink"), "dark", "and applying one falls back");
  });

  it("23f. a storage that throws does not take the app down", () => {
    installStorage({ throwing: true });
    const attrs = installDocument();
    assert.doesNotThrow(() => theme.setTheme("light"));
    assert.strictEqual(attrs.get("data-theme"), "light", "the theme still applies for this session");
    assert.strictEqual(theme.readThemePreference(), null);
  });

  it("23g. the theme is stamped before the first paint, not after", () => {
    const html = readFile("index.html");
    const head = html.slice(0, html.indexOf("</head>"));

    assert.ok(head.includes('setAttribute("data-theme"'), "the boot script must stamp the theme");
    assert.ok(head.indexOf("data-theme") < head.indexOf("css/style.css"),
      "and it must do so before the stylesheet, or the wrong theme paints first");
    assert.ok(head.includes("safear_theme"), "reading the same key js/theme.js writes");
  });

  it("23h. every colour a screen uses is defined in both themes", () => {
    const css = readFile("css/style.css");
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf('[data-theme="light"] {'));
    const light = css.slice(css.indexOf('[data-theme="light"] {'), css.indexOf("* {"));

    const names = [...dark.matchAll(/(--color-[a-z-]+|--photo-[a-z-]+|--shadow-[a-z-]+):/g)].map((m) => m[1]);
    assert.ok(names.length >= 10, "the dark theme must actually define the palette");

    names.forEach((name) => {
      assert.ok(light.includes(name + ":"), `${name} has no light-theme value, so light would inherit dark's`);
    });
  });

  it("23i. no screen hardcodes a colour the theme cannot reach", () => {
    // a literal hex inside a component rule is a colour one of the two themes
    // cannot change, which is how a light theme ends up with dark text on dark
    const css = readFile("css/prerequisite.css");
    const body = css.slice(css.indexOf("/* ---------- shared controls"), css.indexOf("/* ---------- equipment art palette"));
    const literals = [...body.matchAll(/:\s*(#[0-9a-fA-F]{3,8})\b/g)].map((m) => m[1]);

    assert.deepStrictEqual(literals, [], "these colours cannot follow the theme");
  });

  it("23j. the app boots the theme once, centrally, not per screen", () => {
    const app = readFile("js/app.js");
    assert.ok(app.includes("initTheme()"), "the app must initialise the theme");

    // no screen may set the theme attribute for itself
    ["screens/language.js", "screens/modules.js", "prerequisite/screen.js", "prerequisite/detail.js"].forEach((file) => {
      assert.ok(!readFile(file).includes("data-theme"), `${file} must not do its own theming`);
    });
  });
});

describe("24. the bar: a title that is centred, and controls that work mid-session", () => {
  let appbar = null;

  beforeEach(async () => {
    installStorage();
    installDocument();
    appbar = await import(`../screens/appbar.js?fresh=${Math.random()}`);
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it("24a. the title sits between two equal columns, so it is centred on the viewport", () => {
    const html = appbar.renderAppBar({ title: "Equipment Familiarization", subtitle: "Learn the equipment" });

    assert.ok(html.includes('class="appbar__side appbar__side--start"'));
    assert.ok(html.includes('class="appbar__side appbar__side--end"'));

    const css = readFile("css/prerequisite.css");

    // the title is its own full-width block below the controls, so nothing in the
    // row can shift it — this is the property that actually keeps it centred
    const titles = css.slice(css.indexOf(".appbar__titles {"), css.indexOf(".appbar__title {"));
    assert.match(titles, /text-align:\s*center/);

    const row = css.slice(css.indexOf(".appbar__row {"), css.indexOf(".appbar__side {"));
    assert.ok(!/position:\s*absolute/.test(row), "no absolute positioning props up the centring");

    // the title markup is not a cell inside the control row
    assert.ok(html.indexOf('class="appbar__titles"') > html.indexOf('class="appbar__row"'),
      "the title block must sit below the row, not inside it");
  });

  it("24b. it carries the real logo, the language selector and the theme control", () => {
    const html = appbar.renderAppBar({ title: "Choose Your Training" });

    assert.ok(html.includes("./assets/brand/safear-logo.png"), "the same mark as the splash");
    assert.ok(html.includes('data-action="switch-language"'));
    assert.ok(html.includes('data-action="toggle-theme"'));
    assert.match(html, /<select[^>]*aria-label="[^"]+"/, "the selector must be labelled");
    assert.match(html, /<button[^>]*data-action="toggle-theme"[^>]*aria-label="[^"]+"/, "so must the toggle");
  });

  it("24c. the languages offered are the ones the app actually has", async () => {
    const { getSupportedLocales } = await import("../js/i18n.js");
    const html = appbar.renderAppBarControls("en");

    getSupportedLocales().forEach((code) => {
      assert.ok(html.includes(`value="${code}"`), `${code} must be offered`);
    });
    assert.ok(html.includes('value="en" selected'), "the live locale is the selected one");
    // and nothing beyond what is implemented
    const offered = [...html.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(offered.sort(), getSupportedLocales().sort());
  });

  it("24d. a back control only appears when a screen asks for one", () => {
    const plain = appbar.renderAppBar({ title: "Equipment" });
    assert.ok(!plain.includes("data-action=\"back-to-equipment\""));

    const withBack = appbar.renderAppBar({ title: "Training", back: { action: "back-to-equipment", label: "Equipment" } });
    assert.ok(withBack.includes('data-action="back-to-equipment"'));
    assert.match(withBack, /<button[^>]*aria-label="Equipment"/);
  });

  it("24e. both in-app screens wear the bar, and neither keeps its own title", () => {
    const prereq = readFile("prerequisite/screen.js");
    const modules = readFile("screens/modules.js");

    [prereq, modules].forEach((src) => {
      assert.ok(src.includes("renderAppBar({"), "the screen must render the bar");
      assert.ok(src.includes("bindAppBar("), "and bind its controls");
    });

    // the old left-aligned headings are gone, not merely restyled
    assert.ok(!prereq.includes('class="eq-screen__title"'));
    assert.ok(!modules.includes('class="mod-screen__title"'));
  });

  it("24f. changing language redraws the screen instead of reloading the app", () => {
    const src = readFile("screens/appbar.js");

    assert.ok(src.includes("setLocale(next)"), "the locale is set through the existing system");
    assert.ok(src.includes("await loadLocale(next)"), "its dictionary is loaded");
    assert.ok(src.includes("saveLocalePreference(next)"), "and the choice persists under the existing key");
    assert.ok(src.includes("onLocaleChange"), "the screen redraws itself");

    assert.ok(!/location\.reload|window\.location/.test(src), "a language change must never reload the app");

    // both screens redraw from storage, so a redraw cannot lose progress
    assert.ok(readFile("prerequisite/screen.js").includes("onLocaleChange: () => paint()"));
    assert.ok(readFile("screens/modules.js").includes("onLocaleChange: () => paint()"));
  });

  it("24g. the in-app switcher and the first-run screen share one locale state", () => {
    const bar = readFile("screens/appbar.js");
    // both import from the same places rather than keeping a second copy
    assert.ok(bar.includes('from "../js/i18n.js"'));
    assert.ok(bar.includes('saveLocalePreference'), "the same persistence the language screen uses");
    assert.ok(bar.includes('from "./language.js"'), "and the same native names");
  });

  it("24h. the controls are reachable by keyboard and big enough for a gloved hand", () => {
    const css = readFile("css/prerequisite.css");
    const btn = css.slice(css.indexOf(".appbar__icon-btn {"), css.indexOf(".appbar__icon {"));
    const select = css.slice(css.indexOf(".appbar__select {"), css.indexOf(".appbar__select:focus-visible"));

    assert.match(btn, /min-height:\s*var\(--eq-tap\)/, "48px minimum");
    assert.match(select, /min-height:\s*var\(--eq-tap\)/);
    assert.ok(css.includes(".appbar__select:focus-visible"), "the selector must show focus");
    assert.ok(css.includes(".appbar__icon-btn:focus-visible"), "so must the toggle");
  });

  it("24i. the bar and the theme module ship offline", () => {
    const sw = readFile("sw.js");
    assert.ok(sw.includes('"./screens/appbar.js"'));
    assert.ok(sw.includes('"./js/theme.js"'));
    // and neither reaches for the network
    ["screens/appbar.js", "js/theme.js"].forEach((file) => {
      assert.ok(!/https?:\/\//.test(readFile(file).replace(/\/\/[^\n]*/g, "")), `${file} must not call out`);
    });
  });
});
