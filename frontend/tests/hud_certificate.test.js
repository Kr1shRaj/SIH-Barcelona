import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const FRONTEND = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

// the colours this product does not use. they are named here so the sweep is a
// test rather than a thing somebody has to remember to run.
const BANNED = ["#38bdf8", "#0ea5e9", "#3b82f6", "#00e676", "#ff6a00", "#00e5ff", "#ff9100"];

const TRAINEE_UI = [
  "js/app.js",
  "js/certificate-panel.js",
  "ar/marker.js",
  "modules/fire-response/fire-response.js",
  // the tier-1 webxr variant renders its own HUD. it was missed the first time,
  // which is exactly why this list is a test and not a memory
  "modules/fire-response/webxr_fire_module.js",
  "modules/fire-response/graphics.js",
  "modules/gas-leak/gas-leak.js",
  "css/style.css",
  "css/prerequisite.css"
];

describe("25. the AR HUD, the assessment panels and the certificate are one product", () => {
  it("25a. no banned colour survives anywhere a worker can see it", () => {
    // The one exemption, and it is scenery rather than UI: the 3D flame in the
    // fire module is painted #ff9100 because it is a flame. Every other use of
    // that orange was HUD chrome and is gone. Nothing else is exempt.
    const SCENERY = { "modules/fire-response/graphics.js": ["#ff9100"] };

    const offenders = [];
    TRAINEE_UI.forEach((file) => {
      const text = read(file);
      const allowed = SCENERY[file] || [];
      BANNED.forEach((hex) => {
        if (allowed.includes(hex)) return;
        if (text.toLowerCase().includes(hex)) offenders.push(`${file} -> ${hex}`);
      });
    });
    assert.deepStrictEqual(offenders, [], "these are the old HUD and certificate palettes");
  });

  it("25b. the checkpoint panels use shared classes, not a style string each", () => {
    ["modules/fire-response/fire-response.js", "modules/fire-response/webxr_fire_module.js",
      "modules/gas-leak/gas-leak.js"].forEach((file) => {
      const src = read(file);

      // the six repeated patterns are now classes
      ["hud-eyebrow", "hud-title", "hud-instruction"].forEach((cls) => {
        assert.ok(src.includes(`class="${cls}"`), `${file} should use .${cls}`);
      });

      // and the per-checkpoint inline typography is gone
      assert.ok(!/style="font-size:1\.15rem;font-weight:bold/.test(src), `${file} still inlines a title`);
      assert.ok(!/style="font-size:0\.95rem;font-weight:bold;color:#/.test(src), `${file} still inlines an eyebrow`);
    });
  });

  it("25c. the HUD classes exist, and spend colour by meaning", () => {
    const css = read("css/style.css");
    ["hud-panel", "hud-eyebrow", "hud-title", "hud-instruction", "hud-meter", "hud-btn", "hud-chip", "hud-badge"]
      .forEach((cls) => assert.ok(css.includes(`.${cls}`), `.${cls} must exist`));

    const btn = css.slice(css.indexOf(".hud-btn {"), css.indexOf(".hud-btn--quiet"));
    assert.match(btn, /background:\s*var\(--brand-yellow\)/, "the primary action is the brand colour");
    assert.match(btn, /color:\s*var\(--brand-navy\)/, "and navy sits on it");

    // success and failure are the only other colours the HUD may carry
    assert.ok(css.includes(".hud-status--done") && css.includes(".hud-status--fail"));
    assert.ok(css.includes(".hud-meter__fill--done"));
  });

  it("25d. nothing in the HUD glows, pulses or gradients", () => {
    const css = read("css/style.css");
    const hud = css.slice(css.indexOf("/* ---------- field instrument"), css.indexOf("/* ---------- completion and certificate"));
    assert.ok(hud.length > 500, "the hud layer must exist");

    assert.ok(!/linear-gradient|radial-gradient/.test(hud), "no gradients");

    // every shadow is either the shared elevation token or an inset ring. an
    // OUTER coloured shadow is a glow, and that is what this forbids — an inset
    // ring is how a selected chip thickens its border without moving anything.
    const shadows = [...hud.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    shadows.forEach((shadow) => {
      const ok = shadow.startsWith("var(--shadow") || shadow.includes("inset") || /rgba\(0, 0, 0/.test(shadow);
      assert.ok(ok, `this reads as a glow: ${shadow}`);
    });
    assert.ok(!/animation/.test(hud), "nothing animates on its own");
    assert.ok(hud.includes("prefers-reduced-motion"), "and motion is dropped on request");
  });

  it("25e. the runtime state changes no longer paint in cyan", () => {
    const fire = read("modules/fire-response/fire-response.js");
    const mutations = [...fire.matchAll(/statusBadge\.style\.\w+\s*=\s*"([^"]*)"/g)].map((m) => m[1]);

    mutations.forEach((value) => {
      BANNED.forEach((hex) => assert.ok(!value.toLowerCase().includes(hex), `a state still paints ${hex}`));
      assert.ok(!value.includes("gradient"), "a state still paints a gradient");
    });
  });
});

describe("26. the certificate panel shows the credential, and its state", () => {
  let panel = null;
  let certificates = null;

  // the smallest DOM the panel needs
  function installDom() {
    const make = (tag) => {
      const node = {
        tagName: tag, className: "", id: "", type: "", textContent: "", src: "", alt: "",
        children: [], style: {},
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {},
        set innerHTML(v) { if (v === "") this.children = []; },
        get innerHTML() { return ""; }
      };
      return node;
    };
    globalThis.document = { createElement: make, getElementById: () => null };
    return make;
  }

  function html(node) {
    // flatten the built tree into something assertable
    const parts = [`<${node.tagName} class="${node.className}">${node.textContent}`];
    node.children.forEach((c) => parts.push(html(c)));
    return parts.join("");
  }

  beforeEach(async () => {
    installDom();
    globalThis.localStorage = {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); }
    };
    panel = await import(`../js/certificate-panel.js?fresh=${Math.random()}`);
    certificates = await import(`../js/certificates.js?fresh=${Math.random()}`);
    certificates.clearCertificates();
    certificates.clearPendingCertificates();
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  const overlay = () => {
    const node = { children: [], appendChild(c) { this.children.push(c); return c; },
      set innerHTML(v) { if (v === "") this.children = []; }, get innerHTML() { return ""; } };
    return node;
  };

  it("26a. a passed attempt shows the outcome and the server's own score", () => {
    const o = overlay();
    const state = panel.renderCompletionPanel(o, { evaluated: { attemptId: "att-1", percentage: 87.74, passed: true } });

    const markup = html(o.children[0]);
    assert.ok(markup.includes("cert-outcome--pass"), "a pass is green, not red");
    assert.ok(markup.includes("87.74%"), "the score is the evaluated one, unrounded and uninvented");
    assert.ok(markup.includes("cert-score__value"));
    assert.notStrictEqual(state, "failed");
  });

  it("26b. a failed attempt says so, and offers no certificate", () => {
    const o = overlay();
    const state = panel.renderCompletionPanel(o, { evaluated: { attemptId: "att-2", percentage: 41.2, passed: false } });

    const markup = html(o.children[0]);
    assert.strictEqual(state, "failed");
    assert.ok(markup.includes("cert-outcome--fail"));
    assert.ok(markup.includes("cert-state--failed"));
    assert.ok(!markup.includes("cert-card"), "a failed run must show no credential");
    assert.ok(!markup.includes("btn-view-certificate"));
  });

  it("26c. the four states are visually distinct, and none of them is a dashed box", () => {
    const css = read("css/style.css");
    ["cert-state--pending", "cert-state--waiting", "cert-state--failed", "cert-card"]
      .forEach((cls) => assert.ok(css.includes(`.${cls}`), `.${cls} must be its own state`));

    // comments stripped first: the rule below explains why there is no dashed box,
    // and the word in that sentence is not a dashed box
    const cert = css.slice(css.indexOf("/* ---------- completion and certificate")).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/dashed|dotted/.test(cert), "the pending state must not read as unfinished UI");
  });

  it("26d. the QR keeps a white ground and nothing behind it", () => {
    const css = read("css/style.css");
    const qr = css.slice(css.indexOf(".cert-qr {"), css.indexOf(".cert-card__hint"));

    assert.match(qr, /background:\s*#ffffff/, "a QR on a dark panel must keep its white quiet zone");
    assert.ok(!/gradient|box-shadow|backdrop/.test(qr), "nothing decorative may sit behind it");
    assert.match(qr, /width:\s*190px/, "and it stays big enough to scan");
  });

  it("26e. the panel follows the theme rather than painting its own colours", () => {
    const src = read("js/certificate-panel.js");
    const hexes = [...src.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0]);
    assert.deepStrictEqual(hexes, [], "every colour must come from a class");

    const css = read("css/style.css");
    const cert = css.slice(css.indexOf(".cert-panel {"), css.indexOf(".cert-qr {"));
    assert.ok(!/#[0-9a-fA-F]{6}/.test(cert), "the certificate surfaces must use tokens, so both themes work");
  });

  it("26f. every string it shows already exists in all three locales", async () => {
    const src = read("js/certificate-panel.js");
    const keys = [...src.matchAll(/[^a-zA-Z]t\("([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 0);

    ["en", "hi", "sat"].forEach((locale) => {
      const dict = JSON.parse(read(`locales/${locale}.json`));
      keys.forEach((key) => {
        const value = key.split(".").reduce((node, part) => node && node[part], dict);
        assert.ok(value, `${key} is missing from ${locale} — no new key may be invented here`);
      });
    });
  });

  it("26g. the AR header centres the product name between equal side columns", () => {
    const css = read("css/style.css");
    const bar = css.slice(css.indexOf(".header-bar {"), css.indexOf(".header-bar__side {"));
    // zero-min tracks, so the tier chip cannot widen its own column and push the
    // title off centre — which it did by 35px on a 375px phone
    assert.match(bar, /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);

    const app = read("js/app.js");
    assert.ok(app.includes('class="header-bar__side header-bar__side--start"'));
    assert.ok(app.includes('class="header-bar__side header-bar__side--end"'));
  });
});
