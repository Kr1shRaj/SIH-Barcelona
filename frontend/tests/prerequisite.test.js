// The prerequisite is the only thing standing between a worker and a graded module,
// so most of what is checked here is refusal: that loadModule says no, that the
// continue button stays dead, that a half-finished set does not count as finished.
//
// This is currently a one-item prototype. Only the fire extinguisher has a real
// photograph, so only the fire extinguisher is shown and only it gates completion.
// The other six keep their data and their locale strings and are checked to be
// inert — present, unreachable, and not counted.
//
// The render functions return markup strings rather than touching the DOM, which is
// what lets the screens be asserted on in node without a browser. The handful of
// tests that do need elements drive a small stub declared at the top of the file.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import {
  EQUIPMENT_CATALOG,
  ACTIVE_EQUIPMENT,
  REQUIRED_EQUIPMENT_IDS,
  STATUS_ACTIVE,
  STATUS_PENDING_ARTWORK,
  IMAGE_INSET,
  IMAGE_SPAN,
  EXPLODED_BODY_SCALE,
  CALLOUT_GUTTER,
  PART_PLATE,
  partAspect,
  partFrameAspect,
  fitInFrame,
  leaderEndX,
  explodeArrow,
  arrowPointAt,
  allEquipmentImages,
  explodableComponents,
  getEquipmentById,
  isEquipmentActive,
  getEquipmentForModule,
  requiredEquipmentForModule,
  MODULE_IDS,
  imagePointToStage,
  allEquipmentLocaleKeys,
  equipmentNameKey,
  componentLabelKey,
  componentDescKey
} from "../prerequisite/equipment-data.js";
import { renderArt, artPartIds } from "../prerequisite/equipment-art.js";
import {
  PREREQ_STORAGE_KEY,
  markEquipmentViewed,
  getViewedEquipment,
  getPrerequisiteProgress,
  isPrerequisiteComplete,
  getCompletedAt,
  recordStageResult,
  getStageProgress,
  isStage2Passed,
  resetPrerequisite
} from "../prerequisite/progress.js";
import { renderScreenHtml, renderCard, renderCardArt } from "../prerequisite/screen.js";
import {
  renderDetailHtml,
  renderStage,
  renderExplodeArrows,
  renderLeaderLines,
  renderCallouts,
  renderComponentList,
  renderPartPlate,
  renderPartFrame,
  renderSelectionPanel,
  explodeVector,
  neighbourId,
  neighbourComponentId,
  openEquipmentDetail,
  closeEquipmentDetail,
  isDetailOpen,
  isExploded,
  getPhase,
  getSelectedComponentId,
  getOpenEquipmentId,
  ZOOM_MS,
  SETTLE_MS,
  CALLOUT_FADE_MS,
  REASSEMBLE_MS,
  stageState,
  PHASE_ZOOM,
  PHASE_ASSEMBLED,
  PHASE_EXPLODING,
  PHASE_EXPLODED,
  PHASE_REASSEMBLING
} from "../prerequisite/detail.js";
import { narrationPath, requiredNarrationFiles, allNarrationFiles, probeNarration } from "../prerequisite/narration.js";
import { SAT_PENDING_KEYS, isTranslationPending, pendingKeysForLocale } from "../prerequisite/translation-status.js";
import { renderLanguageHtml, LANGUAGE_NATIVE_NAMES, BRAND_LOGO } from "../screens/language.js";
import { renderModulesHtml, TRAINING_MODULES } from "../screens/modules.js";
import { SCREEN_ORDER, nextScreen } from "../screens/router.js";
import {
  BRAND_LOGO as SPLASH_LOGO,
  BRAND_LOGO_SIZE,
  SPLASH_HOLD_MS,
  SPLASH_REDUCED_MS,
  splashTimings,
  renderSplashHtml,
  mountSplashScreen
} from "../screens/splash.js";
import { loadLocale, setLocale, clearLocales, t } from "../js/i18n.js";
import { setTierLoaders, loadModule, unloadModule } from "../js/module-loader.js";
import { getEffectiveWorkerId } from "../assessment/engine.js";

const FRONTEND = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const EXTINGUISHER = "fire_extinguisher";
const IMAGE_REL = "assets/images/fire-extinguisher.jpeg";

// the six parts this prototype set out to teach
const TARGET_COMPONENTS = [
  "pressure_gauge",
  "handle",
  "safety_pin",
  "valve_block",
  "hose",
  "nozzle"
];

// ---------- environment stubs ----------

let store = {};
const storage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
  setItem: (key, value) => { store[key] = String(value); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { store = {}; }
};
globalThis.localStorage = storage;

const _docListeners = {};
globalThis.window = {
  localStorage: storage,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: "" }
};

// A stub element with enough of a DOM for the modal to drive itself. The modal only
// ever looks things up by [data-role], [data-piece], [data-action], .eq-dialog and
// the focusable list, so that is all the query engine below understands — but it
// understands them properly, which is what lets the explode/reassemble cycle be
// tested for real rather than by reading the source.
function matchesSelector(el, selector) {
  return selector.split(",").map((part) => part.trim()).filter(Boolean).some((part) => {
    const attr = part.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/);
    if (attr) {
      const value = el.getAttribute(attr[1]);
      if (value === null) return false;
      return attr[2] === undefined || value === attr[2];
    }
    if (part.startsWith(".")) return ` ${el.className} `.includes(` ${part.slice(1)} `);
    return el.tagName === part;
  });
}

// pull the elements the modal queries out of a rendered string
function parseStubs(html) {
  const out = [];
  const tags = /<(button|div|span|svg|p|h4|img|ul|li)\b([^>]*)>/g;
  let tag;
  while ((tag = tags.exec(html))) {
    const el = makeEl(tag[1]);
    const attrs = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let attr;
    while ((attr = attrs.exec(tag[2]))) {
      const name = attr[1];
      const value = attr[2];
      if (name === "hidden") el.hidden = true;
      else if (name === "disabled") el.disabled = true;
      else if (name === "class") el.className = value || "";
      else if (value !== undefined) el.setAttribute(name, value);
    }
    out.push(el);
  }
  return out;
}

function makeEl(tag) {
  return {
    tagName: tag,
    id: "",
    className: "",
    hidden: false,
    disabled: false,
    // the modal reads a layout property to flush a display change before it animates
    offsetHeight: 0,
    attributes: {},
    children: [],
    listeners: {},
    _kids: [],
    _html: "",
    style: { setProperty() {} },
    classList: { add: () => {}, remove: () => {} },
    get innerHTML() { return this._html; },
    set innerHTML(value) {
      this._html = String(value);
      this._kids = parseStubs(this._html);
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
    contains() { return true; },
    closest(selector) { return matchesSelector(this, selector) ? this : null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return this._kids.filter((kid) => matchesSelector(kid, selector)); },
    focus() { this.focused = true; }
  };
}

// hand a synthetic click to whatever the modal bound to its root
function clickOn(root, target) {
  (root.listeners.click || []).slice().forEach((fn) => fn({ target }));
}

// let a real timer run, which is how the modal sequences its two views
function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// the two layers, as the markup ships them: is each one in the document at all
function layerState(html) {
  const opening = (role) => {
    const found = html.match(new RegExp(`<div[^>]*data-role="${role}"[^>]*>`));
    return found ? found[0] : null;
  };
  const callouts = opening("callouts");
  const pieces = opening("pieces");
  return {
    calloutsPresent: Boolean(callouts) && !/\shidden[\s>]/.test(callouts),
    partsPresent: Boolean(pieces) && !/\shidden[\s>]/.test(pieces)
  };
}

globalThis.document = {
  createElement: (tag) => makeEl(tag),
  // unloadModule sweeps the module overlays out by id; nothing is mounted here
  getElementById: () => null,
  body: makeEl("body"),
  addEventListener: (type, fn) => { (_docListeners[type] = _docListeners[type] || []).push(fn); },
  removeEventListener: (type, fn) => {
    if (!_docListeners[type]) return;
    _docListeners[type] = _docListeners[type].filter((entry) => entry !== fn);
  }
};

// fire a synthetic document-level key event at whatever the modal registered
function pressKey(key) {
  (_docListeners.keydown || []).slice().forEach((fn) => fn({ key }));
}

const WORKER = "worker_prereq_test";

// walk the whole active set, the way a worker who opened every card would
function completeAll(workerId = WORKER) {
  REQUIRED_EQUIPMENT_IDS.forEach((id) => markEquipmentViewed(workerId, id));
}

// the gate asks engine.js who is using the phone, not this file, so anything that
// exercises loadModule has to complete the set for that same worker
function completeForGate() {
  completeAll(getEffectiveWorkerId());
}

beforeEach(() => {
  store = {};
  closeEquipmentDetail();
});

// ---------- 0: the shape of this prototype ----------

describe("0. the shape of the live set", () => {
  it("0a. the four photographed items are live; the rest keep their data", () => {
    assert.deepStrictEqual(
      ACTIVE_EQUIPMENT.map((item) => item.id),
      [EXTINGUISHER, "multi_gas_detector", "scba", "safety_harness"]
    );
    assert.deepStrictEqual(REQUIRED_EQUIPMENT_IDS, ACTIVE_EQUIPMENT.map((item) => item.id));
    ACTIVE_EQUIPMENT.forEach((item) => assert.strictEqual(isEquipmentActive(item.id), true));
  });

  it("0b. the items still waiting on a photograph are kept, not deleted", () => {
    assert.strictEqual(EQUIPMENT_CATALOG.length, 7, "no equipment data may be thrown away");

    const pending = EQUIPMENT_CATALOG.filter((item) => item.status === STATUS_PENDING_ARTWORK);
    assert.deepStrictEqual(
      pending.map((item) => item.id).sort(),
      ["ppe_kit", "safety_helmet", "safety_shoes"],
      "these are still waiting on photographs — see CREDITS.md"
    );
    pending.forEach((item) => {
      assert.ok(item.components.length >= 4, `${item.id} lost its component data`);
      assert.strictEqual(isEquipmentActive(item.id), false);
      assert.ok(!item.image, `${item.id} is pending but already claims an image`);
    });
  });

  it("0c. a pending item cannot be viewed, so it cannot contribute to completion", () => {
    assert.strictEqual(markEquipmentViewed(WORKER, "safety_helmet"), false);
    assert.strictEqual(markEquipmentViewed(WORKER, "ppe_kit"), false);
    assert.deepStrictEqual(getViewedEquipment(WORKER), []);
    assert.strictEqual(isPrerequisiteComplete(WORKER), false);
  });

  it("0d. an item goes live by gaining a status and an image, nothing more", () => {
    ACTIVE_EQUIPMENT.forEach((live) => {
      assert.strictEqual(live.status, STATUS_ACTIVE);
      assert.ok(live.image, `${live.id}: an active item must carry its own artwork reference`);
      assert.ok(live.mask, `${live.id}: and the silhouette that keeps it off a white card`);
      assert.ok(Array.isArray(live.components) && live.components.length > 0);
    });
  });

  it("0d-i. the helmet is not part of the live set", () => {
    // it has a photograph in `2d images/`, but it is not in the prerequisite: the
    // set is the extinguisher for fire and three items for gas, and nothing else
    assert.ok(!REQUIRED_EQUIPMENT_IDS.includes("safety_helmet"));
    assert.strictEqual(REQUIRED_EQUIPMENT_IDS.length, 4);
    assert.strictEqual(isEquipmentActive("safety_helmet"), false);
    assert.strictEqual(getEquipmentById("safety_helmet").image, undefined);

    // and it moves neither gate
    ["fire-response", "gas-leak"].forEach((moduleId) => {
      assert.ok(!requiredEquipmentForModule(moduleId).includes("safety_helmet"), `${moduleId} still wants the helmet`);
    });

    const sw = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
    assert.ok(!sw.includes("safety-helmet"), "the helmet's assets are still precached");
    assert.ok(!fs.existsSync(path.join(FRONTEND, "assets/images/safety-helmet.jpg")), "a staged helmet image survives");
  });

  it("0e. every live photograph is square, which is what the stage assumes", () => {
    // the stage draws a photograph inside a square box, so a square source maps
    // one-to-one and an anchor measured on the photograph lands on the right pixel.
    // a letterboxed source would put every callout off the part it points at.
    ACTIVE_EQUIPMENT.forEach((item) => {
      assert.ok(item.size, `${item.id} has no recorded pixel size`);
      assert.strictEqual(
        item.size.w,
        item.size.h,
        `${item.id} is ${item.size.w}x${item.size.h}; crop it square or teach the stage to letterbox`
      );
    });
  });
});

// ---------- 1-3: the prerequisite comes first, and it is not optional ----------

describe("1-3. the prerequisite gates module entry", () => {
  it("1. sits between language selection and module selection in the flow", () => {
    assert.deepStrictEqual(SCREEN_ORDER, ["language", "prerequisite", "modules", "training"]);
    assert.strictEqual(nextScreen("language"), "prerequisite");
    assert.strictEqual(nextScreen("prerequisite"), "modules");
    assert.strictEqual(nextScreen("modules"), "training");
    assert.strictEqual(nextScreen("training"), null);
  });

  it("2. loadModule refuses fire-response when nothing has been viewed", async () => {
    setTierLoaders(2, async () => {}, null);
    await assert.rejects(() => loadModule("fire-response"), /equipment familiarization incomplete/);
  });

  it("3. loadModule refuses gas-leak too, and starts no assessment session", async () => {
    let sceneRan = false;
    setTierLoaders(2, async () => { sceneRan = true; }, null);

    await assert.rejects(() => loadModule("gas-leak"), /equipment familiarization incomplete/);
    assert.strictEqual(sceneRan, false, "the scene loader must never run behind a closed gate");
  });

  it("3b. the gate holds when localStorage is unreadable rather than failing open", async () => {
    const saved = globalThis.localStorage;
    // an android webview can throw on the property access itself, not just on use
    Object.defineProperty(globalThis, "localStorage", {
      get() { throw new Error("SecurityError: storage blocked"); },
      configurable: true
    });
    try {
      globalThis.window.localStorage = undefined;
      setTierLoaders(2, async () => {}, null);
      await assert.rejects(() => loadModule("fire-response"), /equipment familiarization incomplete/);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: saved, configurable: true, writable: true });
      globalThis.window.localStorage = saved;
    }
  });
});

// ---------- 4-6: what "complete" means, and that it survives ----------

describe("4-6. completion is the whole active set, and it persists", () => {
  it("4. an empty set is not complete", () => {
    const progress = getPrerequisiteProgress(WORKER);
    assert.strictEqual(progress.viewedCount, 0);
    assert.strictEqual(progress.requiredCount, REQUIRED_EQUIPMENT_IDS.length);
    assert.strictEqual(progress.complete, false);
    assert.strictEqual(progress.remaining.length, REQUIRED_EQUIPMENT_IDS.length);
    assert.strictEqual(isPrerequisiteComplete(WORKER), false);
  });

  it("4b. completion needs every required item, and arrives with the last one", () => {
    REQUIRED_EQUIPMENT_IDS.slice(0, -1).forEach((id) => markEquipmentViewed(WORKER, id));
    if (REQUIRED_EQUIPMENT_IDS.length > 1) {
      assert.strictEqual(isPrerequisiteComplete(WORKER), false, "a partial set must not complete");
    }

    markEquipmentViewed(WORKER, REQUIRED_EQUIPMENT_IDS[REQUIRED_EQUIPMENT_IDS.length - 1]);
    assert.strictEqual(isPrerequisiteComplete(WORKER), true);
  });

  it("4c. viewing the same item twice does not count twice", () => {
    markEquipmentViewed(WORKER, EXTINGUISHER);
    markEquipmentViewed(WORKER, EXTINGUISHER);
    assert.deepStrictEqual(getViewedEquipment(WORKER), [EXTINGUISHER]);
  });

  it("4d. an unknown equipment id is rejected, not stored", () => {
    assert.strictEqual(markEquipmentViewed(WORKER, "jetpack"), false);
    assert.deepStrictEqual(getViewedEquipment(WORKER), []);
  });

  it("5. completion unlocks both modules at the loader", async () => {
    completeForGate();
    const loaded = [];
    setTierLoaders(2, async (moduleId) => { loaded.push(moduleId); }, null);

    await loadModule("fire-response");
    unloadModule();
    await loadModule("gas-leak");
    unloadModule();

    assert.deepStrictEqual(loaded, ["fire-response", "gas-leak"]);
  });

  it("6. completion is written to localStorage and read back after a reload", () => {
    completeAll();
    assert.ok(store[PREREQ_STORAGE_KEY], "progress must be persisted under its own key");

    // a reload is just a fresh read of the same store
    const reparsed = JSON.parse(store[PREREQ_STORAGE_KEY]);
    assert.strictEqual(reparsed[WORKER].viewed.length, REQUIRED_EQUIPMENT_IDS.length);
    assert.ok(reparsed[WORKER].completedAt, "the finishing view must stamp completedAt");
    assert.strictEqual(isPrerequisiteComplete(WORKER), true);
  });

  it("6b. progress is per worker, so a shared phone does not let the next man skip", () => {
    completeAll("worker_a");
    assert.strictEqual(isPrerequisiteComplete("worker_a"), true);
    assert.strictEqual(isPrerequisiteComplete("worker_b"), false);

    resetPrerequisite("worker_a");
    assert.strictEqual(isPrerequisiteComplete("worker_a"), false);
  });

  it("6c. completedAt is stamped once and does not drift on later reads", () => {
    completeAll();
    const first = getCompletedAt(WORKER);
    markEquipmentViewed(WORKER, EXTINGUISHER);
    assert.strictEqual(getCompletedAt(WORKER), first);
  });

  it("6d. unreadable storage degrades to empty progress instead of throwing", () => {
    store[PREREQ_STORAGE_KEY] = "{ not json";
    assert.deepStrictEqual(getViewedEquipment(WORKER), []);
    assert.strictEqual(isPrerequisiteComplete(WORKER), false);
  });

  it("6e. a write into a full store reports failure rather than crashing the screen", () => {
    const saved = globalThis.window.localStorage;
    globalThis.window.localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {}
    };
    try {
      assert.strictEqual(markEquipmentViewed(WORKER, EXTINGUISHER), false);
    } finally {
      globalThis.window.localStorage = saved;
    }
  });
});

// ---------- 7-9: cards, popup navigation and closing ----------

describe("7-9. cards, popup navigation and closing", () => {
  it("7. the grid shows the active set and nothing else", () => {
    const html = renderScreenHtml(getPrerequisiteProgress(WORKER));

    assert.ok(html.includes(`data-equipment-card="${EXTINGUISHER}"`), "no card for the extinguisher");
    assert.ok(
      html.includes(`data-action="open" data-equipment-id="${EXTINGUISHER}"`),
      "the extinguisher card does not open the extinguisher"
    );

    EQUIPMENT_CATALOG
      .filter((item) => item.status === STATUS_PENDING_ARTWORK)
      .forEach((item) => {
        assert.ok(!html.includes(`data-equipment-card="${item.id}"`), `${item.id} is pending but still on screen`);
      });
  });

  it("7b. a viewed card is marked, an unviewed one is not", () => {
    const item = getEquipmentById(EXTINGUISHER);
    assert.ok(!renderCard(item, []).includes("eq-card--viewed"));
    assert.ok(renderCard(item, [EXTINGUISHER]).includes("eq-card--viewed"));
  });

  it("7c. opening a card records exactly that item as viewed", () => {
    const viewed = [];
    openEquipmentDetail({
      equipmentId: EXTINGUISHER,
      container: makeEl("div"),
      onViewed: (id) => viewed.push(id)
    });
    assert.deepStrictEqual(viewed, [EXTINGUISHER]);
    assert.strictEqual(getOpenEquipmentId(), EXTINGUISHER);
  });

  it("7d. an unknown equipment id opens nothing", () => {
    assert.strictEqual(openEquipmentDetail({ equipmentId: "jetpack", container: makeEl("div") }), null);
    assert.strictEqual(isDetailOpen(), false);
  });

  it("8. prev/next walk the active set and stop at both ends", () => {
    const first = ACTIVE_EQUIPMENT[0].id;
    const last = ACTIVE_EQUIPMENT[ACTIVE_EQUIPMENT.length - 1].id;

    assert.strictEqual(neighbourId(first, "prev"), null);
    assert.strictEqual(neighbourId(last, "next"), null);
    assert.strictEqual(neighbourId(first, "next"), ACTIVE_EQUIPMENT[1].id);

    // a pending item is not reachable by stepping either
    assert.strictEqual(neighbourId("safety_helmet", "next"), null);
  });

  it("8b. the first item has no previous control and the last one finishes the set", () => {
    const first = renderDetailHtml(ACTIVE_EQUIPMENT[0].id);
    assert.match(first, /data-action="prev" disabled/);
    assert.ok(first.includes('data-action="next"'), "there is somewhere to go from the first item");

    const last = renderDetailHtml(ACTIVE_EQUIPMENT[ACTIVE_EQUIPMENT.length - 1].id);
    assert.ok(!/data-action="prev" disabled/.test(last), "the last item can step back");
    assert.ok(last.includes('data-action="done"'), "the last item must finish the set");
    assert.ok(!last.includes('data-action="next"'), "there is nothing after the last item");
  });

  it("8c. the position counter counts the active set, not the whole catalog", () => {
    setLocale("en");
    const html = renderDetailHtml(EXTINGUISHER);
    const position = html.match(/data-role="position">([^<]+)</);

    assert.ok(position, "the modal must show a position");
    assert.ok(
      position[1].includes(String(ACTIVE_EQUIPMENT.length)),
      `position "${position[1].trim()}" should count ${ACTIVE_EQUIPMENT.length} active item(s)`
    );
  });

  it("9. escape closes the modal and fires onClose once", () => {
    let closes = 0;
    openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div"), onClose: () => { closes += 1; } });
    assert.strictEqual(isDetailOpen(), true);

    pressKey("Escape");

    assert.strictEqual(isDetailOpen(), false);
    assert.strictEqual(getOpenEquipmentId(), null);
    assert.strictEqual(closes, 1);
  });

  it("9b. closing twice is harmless", () => {
    openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    closeEquipmentDetail();
    closeEquipmentDetail();
    assert.strictEqual(isDetailOpen(), false);
  });

  it("9c. the dialog carries modal semantics and a labelled close control", () => {
    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('aria-labelledby="eq-dialog-title"'));
    assert.match(html, /data-action="close" aria-label="[^"]+"/);
    assert.ok(html.includes('class="eq-scrim"'), "a modal needs a scrim behind it");
  });

  it("9d. arrow keys walk the set and stop at its ends", () => {
    const [first, second] = ACTIVE_EQUIPMENT.map((item) => item.id);

    openEquipmentDetail({ equipmentId: first, container: makeEl("div") });
    pressKey("ArrowLeft");
    assert.strictEqual(getOpenEquipmentId(), first, "there is nothing before the first item");

    pressKey("ArrowRight");
    assert.strictEqual(getOpenEquipmentId(), second, "the arrows walk the set while assembled");

    pressKey("ArrowLeft");
    assert.strictEqual(getOpenEquipmentId(), first);
    closeEquipmentDetail();
  });
});

// ---------- 10: the photograph and its callouts ----------

describe("10. the supplied photograph and its callouts", () => {
  const item = getEquipmentById(EXTINGUISHER);

  it("10. the extinguisher uses the supplied photograph, not a drawing", () => {
    assert.strictEqual(item.image, `./${IMAGE_REL}`);

    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(html.includes(`src="./${IMAGE_REL}"`), "the modal must show the supplied image");
    assert.ok(html.includes('class="eq-photo"'));
    assert.ok(!html.includes('class="eq-stage__art"'), "the drawn fallback must not render for a photographed item");
  });

  it("10a. the photograph is really on disk and is a jpeg", () => {
    const onDisk = path.join(FRONTEND, IMAGE_REL);
    assert.ok(fs.existsSync(onDisk), "the equipment photograph is missing from the repo");
    assert.strictEqual(fs.readFileSync(onDisk).subarray(0, 3).toString("hex"), "ffd8ff", "the file is not a jpeg");
  });

  it("10b. the card thumbnail uses the photograph too", () => {
    const art = renderCardArt(item);
    assert.ok(art.includes(`src="./${IMAGE_REL}"`));
    assert.ok(art.includes("eq-card__photo"));
    assert.ok(!art.includes("<svg"), "the card must not fall back to the drawing");
  });

  it("10c. exactly the six target components are called out", () => {
    const ids = item.components.map((component) => component.id).sort();
    assert.deepStrictEqual(ids, [...TARGET_COMPONENTS].sort());
  });

  it("10d. every component gets a callout, a leader line and an anchor dot", () => {
    const callouts = renderCallouts(item);
    const leaders = renderLeaderLines(item);

    item.components.forEach((component) => {
      assert.ok(callouts.includes(`data-callout="${component.id}"`), `no callout for ${component.id}`);
      assert.ok(leaders.includes(`data-leader="${component.id}"`), `no leader line for ${component.id}`);
    });
    assert.strictEqual([...leaders.matchAll(/eq-leader__anchor/g)].length, item.components.length);
  });

  it("10e. every anchor lands ON the photograph, not in a label gutter", () => {
    // the photo is inset inside the stage; an anchor outside that box would be a
    // leader line pointing at empty space
    const min = IMAGE_INSET;
    const max = IMAGE_INSET + IMAGE_SPAN;

    item.components.forEach((component) => {
      const { x, y } = component.anchor;
      assert.ok(x >= min && x <= max, `${component.id} anchor x=${x} is off the photograph (${min}-${max})`);
      assert.ok(y >= min && y <= max, `${component.id} anchor y=${y} is off the photograph (${min}-${max})`);
    });
  });

  it("10f. every label is pinned to a stage edge, clear of the equipment", () => {
    const min = IMAGE_INSET;
    const max = IMAGE_INSET + IMAGE_SPAN;

    item.components.forEach((component) => {
      const { x } = component.label;
      assert.ok(x < min || x > max, `${component.id} label x=${x} sits on top of the photograph (${min}-${max})`);
      assert.ok(x >= 0 && x <= 100, `${component.id} label x=${x} is off the stage entirely`);
      // the box grows inward from its edge and is capped at the gutter, so the
      // furthest it can reach is edge + gutter — never past the middle
      const inset = component.side === "left" ? x : 100 - x;
      assert.ok(inset + CALLOUT_GUTTER < 50, `${component.id} label can reach the middle of the stage`);
    });
  });

  it("10f-i. a callout box is anchored to its own edge, so it cannot be clipped", () => {
    // the old box was centred on its x and could hang off the side of a 375px phone
    const html = renderCallouts(item);
    assert.ok(!/transform:\s*translate\(-50%, -50%\)/.test(html));

    item.components.forEach((component) => {
      const edge = component.side === "left" ? "left" : "right";
      const inset = component.side === "left" ? component.label.x : 100 - component.label.x;
      assert.ok(
        html.includes(`${edge}:${inset}%`),
        `${component.id} is not pinned to the ${edge} edge`
      );
    });

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const block = css.slice(css.indexOf(".eq-callout {"), css.indexOf(".eq-callout__index"));
    assert.ok(block.includes(`max-width: ${CALLOUT_GUTTER}%`), "the label box must be capped at the gutter");
  });

  it("10f-ii. a leader line stops at the label box rather than running under it", () => {
    const leaders = renderLeaderLines(item);
    item.components.forEach((component) => {
      const end = leaderEndX(component.side);
      assert.ok(
        leaders.includes(`data-leader="${component.id}" x1="${component.anchor.x}" y1="${component.anchor.y}" x2="${end}"`),
        `${component.id} leader does not stop at the gutter`
      );
      assert.ok(end > 0 && end < 100);
    });
    assert.strictEqual(leaderEndX("left"), CALLOUT_GUTTER);
    assert.strictEqual(leaderEndX("right"), 100 - CALLOUT_GUTTER);
  });

  it("10g. nothing loops: the old floating/bobbing animation is gone", () => {
    // the equipment used to drift up and down forever. it now sits still and only
    // moves when a worker asks it to.
    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(!html.includes("eq-bob"), "the bob class is still being rendered");

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.ok(!css.includes("eq-bob"), "the bob styles are still in the stylesheet");
    assert.ok(!/@keyframes\s+eq-bob/.test(css), "a bob keyframe survives");

    // no animation anywhere may loop forever
    assert.ok(!/animation:[^;]*infinite/.test(css), "something still animates infinitely");
    assert.ok(!/\balternate\b/.test(css), "an alternating loop survives");

    // and the whole feature's javascript is free of it, not just the visible rule
    ["detail.js", "screen.js", "equipment-data.js", "equipment-art.js"].forEach((file) => {
      const src = fs.readFileSync(path.join(FRONTEND, "prerequisite", file), "utf8");
      assert.ok(!/eq-bob|\bbob\b/.test(src), `${file} still mentions the bob`);
    });
  });

  it("10h. the drawn fallback still renders for an item with no photograph", () => {
    const html = renderStage(getEquipmentById("safety_helmet"));
    assert.ok(html.includes('class="eq-stage__art"'), "a pending item still renders its drawing");
    assert.ok(!html.includes("eq-bob"));
  });

  it("10n. the photograph sits on the dark background, not on a white rectangle", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");

    // the old light plate behind the photograph is gone outright
    assert.ok(!css.includes(".eq-plate"), "the white image plate is still in the stylesheet");
    assert.ok(!renderDetailHtml(EXTINGUISHER).includes("eq-plate"));

    // and nothing paints a solid backing behind either the photo or the card thumb
    const object = css.slice(css.indexOf(".eq-object {"), css.indexOf(".eq-object:focus-visible"));
    assert.ok(/background:\s*none/.test(object), "the equipment must not sit on a filled box");
    assert.ok(!/background:\s*#fff/i.test(object));

    const card = css.slice(css.indexOf(".eq-card__photo {"), css.indexOf(".eq-stage__art,"));
    assert.ok(!/background:\s*#fff/i.test(card), "the card thumbnail still has a white tile");
  });

  it("10o. the white background is removed by masking, never by editing the photo", () => {
    const item2 = getEquipmentById(EXTINGUISHER);
    assert.ok(item2.mask, "the assembled photograph has no silhouette mask");

    // the photograph itself is still the untouched jpeg
    assert.match(item2.image, /\.jpe?g$/);
    assert.match(item2.mask, /\.mask\.png$/);

    const html = renderDetailHtml(EXTINGUISHER);
    // The url must sit on the element. Routed through a custom property, a relative
    // url resolves against the stylesheet's own folder — /css/assets/... — which
    // 404s and takes the whole photograph with it. That shipped once; hence this.
    assert.ok(html.includes(`mask-image:url(&quot;${item2.mask}&quot;)`), "the mask is not applied");
    assert.ok(html.includes(`-webkit-mask-image:url(&quot;${item2.mask}&quot;)`), "an older android webview needs the prefix");
    assert.ok(!html.includes("--eq-mask"), "a relative mask url must not go through a custom property");

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.ok(!css.includes("var(--eq-mask"), "the stylesheet must not resolve the mask url");
    assert.match(css, /-webkit-mask-size:\s*100% 100%/);
    assert.match(css, /\n\s*mask-size:\s*100% 100%/);

    // Every masked element carries its own url, and it has to be the IMG: mask-size
    // is 100% of the element it sits on, so a mask on the wrapper would be scaled to
    // the wrapper and paint the wrong region of the silhouette. That shipped once too.
    [
      renderCardArt(item2),
      renderPartFrame(item2.components[0].part, ""),
      renderDetailHtml(EXTINGUISHER)
    ].forEach((markup) => {
      const masked = [...markup.matchAll(/<[a-z]+[^>]*mask-image:url\(&quot;[^&]+&quot;\)[^>]*>/g)].map((m) => m[0]);
      assert.ok(masked.length > 0, "nothing is masked");
      masked.forEach((tag) => {
        assert.ok(tag.startsWith("<img"), `the mask is on a wrapper, not on the image: ${tag.slice(0, 60)}`);
      });
    });
  });

  it("10p. every mask is a real png on disk, the same size as the photo it masks", () => {
    const png = (rel) => {
      const buf = fs.readFileSync(path.join(FRONTEND, rel.replace(/^\.\//, "")));
      assert.strictEqual(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${rel} is not a png`);
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    };

    const sources = [getEquipmentById(EXTINGUISHER), ...explodableComponents(EXTINGUISHER).map((c) => c.part)];
    sources.forEach((source) => {
      const size = png(source.mask);
      assert.deepStrictEqual(
        size,
        { w: source.size.w, h: source.size.h },
        `${source.mask} is ${size.w}x${size.h}, but masks ${source.size.w}x${source.size.h}`
      );
    });
  });

  it("10i. anchors and labels stay inside the stage so nothing is clipped off-screen", () => {
    EQUIPMENT_CATALOG.forEach((entry) => {
      entry.components.forEach((component) => {
        ["anchor", "label"].forEach((which) => {
          const point = component[which];
          assert.ok(point.x >= 0 && point.x <= 100, `${entry.id}.${component.id} ${which}.x out of range`);
          assert.ok(point.y >= 0 && point.y <= 100, `${entry.id}.${component.id} ${which}.y out of range`);
        });
      });
    });
  });

  it("10j. imagePointToStage maps a point measured on the photo into stage space", () => {
    assert.deepStrictEqual(imagePointToStage(0, 0), { x: IMAGE_INSET, y: IMAGE_INSET });
    assert.deepStrictEqual(imagePointToStage(100, 100), { x: IMAGE_INSET + IMAGE_SPAN, y: IMAGE_INSET + IMAGE_SPAN });
    assert.deepStrictEqual(imagePointToStage(50, 50), { x: IMAGE_INSET + IMAGE_SPAN / 2, y: IMAGE_INSET + IMAGE_SPAN / 2 });
  });

  it("10k. the part names still match the ones the AR scene uses", () => {
    const graphics = fs.readFileSync(path.join(FRONTEND, "modules/fire-response/graphics.js"), "utf8");
    const ids = item.components.map((component) => component.id);

    assert.ok(ids.includes("pressure_gauge") && /ext-gauge-face/.test(graphics));
    assert.ok(ids.includes("handle") && /extinguisher-handle/.test(graphics));
    assert.ok(ids.includes("safety_pin") && /extinguisher-pin/.test(graphics));
    assert.ok(ids.includes("hose") && /id="ext-hose"/.test(graphics));
    assert.ok(ids.includes("nozzle") && /ext-nozzle/.test(graphics));
    assert.ok(ids.includes("valve_block") && /ext-valve-block/.test(graphics));
  });

  it("10l. the component list carries an explanation row per callout", () => {
    const list = renderComponentList(item);
    item.components.forEach((component) => {
      assert.ok(list.includes(`data-part-row="${component.id}"`));
    });
  });

  it("10m. pending items still have drawings, so activating one is not a blank screen", () => {
    EQUIPMENT_CATALOG
      .filter((entry) => entry.status === STATUS_PENDING_ARTWORK)
      .forEach((entry) => {
        const drawn = artPartIds(entry.art);
        assert.ok(renderArt(entry.art).trim().length > 0, `${entry.id} has no art`);
        entry.components.forEach((component) => {
          assert.ok(drawn.includes(component.id), `${entry.id}: "${component.id}" points at nothing`);
        });
      });
    assert.strictEqual(renderArt("nonexistent"), "");
  });
});

// ---------- 11: localization, and the fallback that must not go unnoticed ----------

describe("11. localization across all three locales", () => {
  beforeEach(async () => {
    clearLocales();
    await Promise.all([loadLocale("en"), loadLocale("hi"), loadLocale("sat")]);
  });

  it("11. english and hindi carry every equipment string, pending items included", () => {
    const keys = allEquipmentLocaleKeys();
    // 7 items x (name + purpose) plus 30 components x (label + desc). the detector's
    // belt clip went when it turned out not to be visible in the supplied render,
    // and the button row it does show took its place.
    assert.strictEqual(keys.length, 74);

    ["en", "hi"].forEach((locale) => {
      setLocale(locale);
      keys.forEach((key) => {
        const value = t(key, {}, "");
        assert.ok(value && value !== key, `${locale} is missing ${key}`);
      });
    });
  });

  it("11a. the six extinguisher callouts read properly in english and hindi", () => {
    ["en", "hi"].forEach((locale) => {
      setLocale(locale);
      TARGET_COMPONENTS.forEach((componentId) => {
        const label = t(componentLabelKey(EXTINGUISHER, componentId), {}, "");
        const desc = t(componentDescKey(EXTINGUISHER, componentId), {}, "");
        assert.ok(label.length > 0, `${locale} has no label for ${componentId}`);
        assert.ok(desc.length > 0, `${locale} has no description for ${componentId}`);
      });
    });
  });

  it("11b. hindi is really hindi, not english sitting in the hindi file", () => {
    const en = JSON.parse(fs.readFileSync(path.join(FRONTEND, "locales/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(FRONTEND, "locales/hi.json"), "utf8"));
    const resolve = (obj, key) => key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj);

    const leaked = allEquipmentLocaleKeys().filter((key) => resolve(en, key) === resolve(hi, key));
    assert.deepStrictEqual(leaked, [], `hindi still shows english for: ${leaked.join(", ")}`);
  });

  it("11c. no santali string is faked — every pending key is absent from sat.json", () => {
    const sat = JSON.parse(fs.readFileSync(path.join(FRONTEND, "locales/sat.json"), "utf8"));
    const resolve = (obj, key) => key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj);

    const invented = [...SAT_PENDING_KEYS].filter((key) => resolve(sat, key) !== undefined);
    assert.deepStrictEqual(
      invented,
      [],
      `these keys are listed as awaiting translation but sat.json already answers them: ${invented.join(", ")}`
    );
  });

  it("11d. fallback leakage is detected: a key in neither place fails this test", () => {
    const sat = JSON.parse(fs.readFileSync(path.join(FRONTEND, "locales/sat.json"), "utf8"));
    const resolve = (obj, key) => key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj);

    const unaccounted = allEquipmentLocaleKeys().filter(
      (key) => resolve(sat, key) === undefined && !SAT_PENDING_KEYS.has(key)
    );
    assert.deepStrictEqual(
      unaccounted,
      [],
      `these strings fall back to english with nobody tracking it: ${unaccounted.join(", ")}`
    );
  });

  it("11e. the ui says so when it is showing an untranslated string", () => {
    setLocale("sat");
    assert.ok(
      renderDetailHtml(EXTINGUISHER).includes('data-translation-pending="true"'),
      "santali must be marked as pending, not passed off as translated"
    );

    setLocale("hi");
    assert.ok(
      !renderDetailHtml(EXTINGUISHER).includes('data-translation-pending="true"'),
      "hindi is translated, nothing to flag"
    );
  });

  it("11f. isTranslationPending only ever flags santali", () => {
    const key = equipmentNameKey(EXTINGUISHER);
    assert.strictEqual(isTranslationPending("sat", key), true);
    assert.strictEqual(isTranslationPending("hi", key), false);
    assert.strictEqual(isTranslationPending("en", key), false);
    assert.deepStrictEqual(pendingKeysForLocale("en"), []);
  });

  it("11g. the santali manifest on disk matches the pending list in code", () => {
    const manifest = fs.readFileSync(path.join(FRONTEND, "locales/SANTALI_TRANSLATION_MANIFEST.md"), "utf8");
    pendingKeysForLocale("sat").forEach((key) => {
      assert.ok(manifest.includes(`\`${key}\``), `${key} is pending but missing from the translation manifest`);
    });
  });

  it("11h. every prerequisite string reaches the ui through a locale key", () => {
    setLocale("en");
    const screen = renderScreenHtml(getPrerequisiteProgress(WORKER));
    assert.ok(screen.includes(t("prerequisite.title", {}, "")));
    assert.ok(screen.includes(t("prerequisite.subtitle", {}, "")));

    const modules = renderModulesHtml(false);
    assert.ok(modules.includes(t("modules.select_title", {}, "")));
    assert.ok(modules.includes(t("modules.locked", {}, "")));
  });

  it("11i. the photograph carries alt text from the locale, not a filename", () => {
    setLocale("en");
    const alt = renderDetailHtml(EXTINGUISHER).match(/class="eq-photo" src="[^"]+" alt="([^"]*)"/);
    assert.ok(alt, "the photograph must carry an alt attribute");
    assert.strictEqual(alt[1], t(equipmentNameKey(EXTINGUISHER), {}, ""));
  });
});

// ---------- 12: audio references ----------

describe("12. narration references resolve without inventing files", () => {
  it("12. the extinguisher resolves to one path per locale, in the existing scheme", () => {
    assert.strictEqual(narrationPath("en", EXTINGUISHER), "./audio/en/equipment_fire_extinguisher.mp3");
    assert.strictEqual(narrationPath("hi", EXTINGUISHER), "./audio/hi/equipment_fire_extinguisher.mp3");
    assert.strictEqual(narrationPath("sat", EXTINGUISHER), "./audio/sat/equipment_fire_extinguisher.mp3");
  });

  it("12b. only the active set needs recording now, the whole catalog is tracked separately", () => {
    const now = requiredNarrationFiles();
    assert.strictEqual(now.length, REQUIRED_EQUIPMENT_IDS.length * 3);
    assert.deepStrictEqual(
      [...new Set(now.map((row) => row.equipmentId))].sort(),
      [...REQUIRED_EQUIPMENT_IDS].sort(),
      "every live item needs its own recording, in every locale"
    );

    const eventually = allNarrationFiles();
    assert.strictEqual(eventually.length, EQUIPMENT_CATALOG.length * 3);
    assert.strictEqual(new Set(eventually.map((row) => row.path)).size, eventually.length, "paths must be unique");
  });

  it("12c. none of those files exist yet, and none were faked to look like they do", () => {
    const present = allNarrationFiles()
      .map((row) => row.path.replace(/^\.\//, ""))
      .filter((rel) => fs.existsSync(path.join(FRONTEND, rel)));

    assert.deepStrictEqual(present, [], `recordings appeared without the manifest being updated: ${present.join(", ")}`);
  });

  it("12d. a missing recording probes false rather than throwing", async () => {
    assert.strictEqual(await probeNarration("./audio/en/x.mp3", async () => { throw new Error("offline"); }), false);
    assert.strictEqual(await probeNarration("./audio/en/x.mp3", async () => ({ ok: false })), false);
    assert.strictEqual(await probeNarration("./audio/en/x.mp3", async () => ({ ok: true })), true);
  });

  it("12e. the recording manifest lists the files needed now and forbids substitutes", () => {
    const manifest = fs.readFileSync(path.join(FRONTEND, "audio/RECORDING_MANIFEST.md"), "utf8");
    requiredNarrationFiles().forEach((row) => {
      const filename = row.path.split("/").pop();
      assert.ok(manifest.includes(filename), `${filename} missing from RECORDING_MANIFEST.md`);
    });
    assert.match(manifest, /Do not copy the English clip/i);
  });

  it("12f. the detail view offers a listen control that starts disabled", () => {
    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(html.includes('data-action="listen"'));
    assert.ok(html.includes('data-role="audio-note"'));
    assert.match(html, /data-action="listen" disabled/, "no recording exists, so the control must not look usable");
  });
});

// ---------- 13: offline ----------

describe("13. the prerequisite is on the phone", () => {
  const SW_SOURCE = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
  const INDEX_HTML = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");

  it("13. every prerequisite module is precached", () => {
    [
      "./screens/router.js",
      "./screens/language.js",
      "./screens/modules.js",
      "./prerequisite/equipment-data.js",
      "./prerequisite/equipment-art.js",
      "./prerequisite/progress.js",
      "./prerequisite/narration.js",
      "./prerequisite/translation-status.js",
      "./prerequisite/screen.js",
      "./prerequisite/detail.js"
    ].forEach((asset) => {
      assert.ok(SW_SOURCE.includes(`"${asset}"`), `${asset} is not in STATIC_ASSETS`);
    });
  });

  it("13a. the equipment photograph is precached, so it renders underground", () => {
    assert.ok(
      SW_SOURCE.includes(`"./${IMAGE_REL}"`),
      "the photograph must be in STATIC_ASSETS or the modal is blank offline"
    );
  });

  it("13b. the prerequisite stylesheet is linked and precached", () => {
    assert.ok(INDEX_HTML.includes('href="./css/prerequisite.css"'));
    assert.ok(SW_SOURCE.includes('"./css/prerequisite.css"'));
  });

  it("13c. no equipment audio is precached, because none of it exists", () => {
    assert.ok(!SW_SOURCE.includes("equipment_"), "an equipment clip is precached but not recorded");
  });

  it("13d. every image the ui references is local and precached, never remote", () => {
    EQUIPMENT_CATALOG.forEach((entry) => {
      if (!entry.image) return;
      assert.ok(!/^(https?:)?\/\//i.test(entry.image), `${entry.id} pulls its image from the network`);
      assert.ok(entry.image.startsWith("./"), `${entry.id} image path must be relative`);
      assert.ok(fs.existsSync(path.join(FRONTEND, entry.image.replace(/^\.\//, ""))), `${entry.id} image is not on disk`);
      assert.ok(SW_SOURCE.includes(`"${entry.image}"`), `${entry.id} image is not precached`);
    });
  });

  it("13e. the drawn fallbacks still pull no external file", () => {
    EQUIPMENT_CATALOG.forEach((entry) => {
      assert.ok(!/<image|xlink:href|url\(/.test(renderArt(entry.art)), `${entry.id} art pulls an external file`);
    });
  });
});

// ---------- 14-15: the existing modules still work ----------

describe("14-15. the existing training modules are unchanged behind the gate", () => {
  it("14. fire-response still loads, unloads and reloads once the set is read", async () => {
    completeForGate();
    const calls = [];
    setTierLoaders(2, async (moduleId) => { calls.push(moduleId); }, null);

    await loadModule("fire-response");
    unloadModule();
    await loadModule("fire-response");
    unloadModule();

    assert.deepStrictEqual(calls, ["fire-response", "fire-response"]);
  });

  it("15. gas-leak still loads, and a scene failure still propagates", async () => {
    completeForGate();
    setTierLoaders(2, async () => {}, null);
    await loadModule("gas-leak");
    unloadModule();

    setTierLoaders(2, async () => { throw new Error("not implemented"); }, null);
    await assert.rejects(() => loadModule("gas-leak"), /not implemented/);
  });

  it("15b. the gate is the only new reason loadModule can refuse", async () => {
    completeForGate();
    setTierLoaders(2, async () => {}, null);
    await assert.rejects(() => loadModule(""), /moduleId required/);
  });
});

// ---------- language and module selection screens ----------

describe("language selection", () => {
  it("offers all three languages, each written in its own script", () => {
    const html = renderLanguageHtml("hi");
    ["en", "hi", "sat"].forEach((locale) => {
      assert.ok(html.includes(`data-locale="${locale}"`), `${locale} is not offered`);
      assert.ok(html.includes(LANGUAGE_NATIVE_NAMES[locale]), `${locale} is not shown in its own script`);
    });
  });

  it("marks the active language and nothing else", () => {
    const pressed = [...renderLanguageHtml("sat").matchAll(/data-locale="([a-z]+)"[^>]*aria-pressed="true"/g)].map((m) => m[1]);
    assert.deepStrictEqual(pressed, ["sat"]);
  });

  it("shows ol chiki for santali rather than a latin transliteration alone", () => {
    assert.strictEqual(LANGUAGE_NATIVE_NAMES.sat, "ᱥᱟᱱᱛᱟᱲᱤ");
  });

  it("leads with the product before it asks the question", () => {
    setLocale("en");
    const html = renderLanguageHtml("en");

    const brandAt = html.indexOf("lang-brand");
    const titleAt = html.indexOf("lang-screen__title");
    const hintAt = html.indexOf("lang-screen__hint");
    const listAt = html.indexOf("lang-list");

    assert.ok(brandAt !== -1, "the screen must carry the product's identity");
    assert.ok(brandAt < titleAt, "the brand belongs above the heading");
    assert.ok(titleAt < hintAt, "the heading comes before its subtitle");
    assert.ok(hintAt < listAt, "and the languages come last");

    assert.ok(html.includes(t("app.select_language", {}, "")));
    assert.ok(html.includes(t("app.select_language_hint", {}, "")));
  });

  it("uses a real logo when there is one, and says so in the source when there is not", () => {
    // The repository has no logo asset — no svg, png, icon, manifest or component.
    // Rather than draw a stand-in mark, the header shows the product name; dropping
    // a file in and pointing BRAND_LOGO at it is the whole change.
    const src = fs.readFileSync(path.join(FRONTEND, "screens/language.js"), "utf8");
    assert.match(src, /const BRAND_LOGO = /, "there must be one place the logo is configured");

    const html = renderLanguageHtml("en");
    if (BRAND_LOGO) {
      assert.ok(html.includes(`src="${BRAND_LOGO}"`), "the configured logo must actually render");
      assert.ok(html.includes("lang-brand__logo"));
      assert.match(html, /<img class="lang-brand__logo"[^>]*alt="[^"]+"/, "a logo needs an accessible name");
      const sw = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
      assert.ok(sw.includes(`"${BRAND_LOGO}"`), "the logo must be on the phone underground");
    } else {
      assert.ok(html.includes("lang-brand__name"), "with no asset, the product name stands in");
      assert.ok(!html.includes("lang-brand__logo"), "nothing may claim to be a logo when there is none");
    }
  });

  it("keeps every language reachable, pressable and labelled in its own script", () => {
    setLocale("en");
    const html = renderLanguageHtml("hi");

    // real buttons, not divs, and each one says which language it is written in
    const buttons = [...html.matchAll(/<button[^>]*class="lang-btn[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.strictEqual(buttons.length, 3);
    buttons.forEach((button) => {
      assert.ok(button.includes('type="button"'));
      assert.match(button, /aria-pressed="(true|false)"/);
      assert.match(button, /lang="[a-z]+"/, "a screen reader needs to switch voice per card");
      assert.match(button, /data-locale="[a-z]+"/);
    });
  });

  it("the cards are comfortable to hit and do not stretch into banners", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const block = css.slice(css.indexOf(".lang-btn {"), css.indexOf("@media (hover: hover)"));

    // 4.5rem is 72px, comfortably past the 48px minimum
    const minHeight = block.match(/min-height:\s*([\d.]+)rem/);
    assert.ok(minHeight && Number(minHeight[1]) * 16 >= 48, "a language card must stay a comfortable target");

    const screen = css.slice(css.indexOf(".lang-screen {"), css.indexOf(".lang-brand {"));
    assert.match(screen, /max-width:\s*var\(--lang-width\)/, "the content must be bounded on a desktop");
    assert.match(screen, /--lang-width:\s*26rem/);

    // the name dominates, the latin label is secondary
    const native = css.slice(css.indexOf(".lang-btn__native {"), css.indexOf(".lang-btn__roman {"));
    const roman = css.slice(css.indexOf(".lang-btn__roman {"));
    assert.match(native, /font-weight:\s*700/);
    assert.match(native, /clamp\(1\.25rem/, "the language name scales with the viewport");
    assert.match(roman, /color:\s*var\(--color-text-muted\)/);
  });

  it("nothing on this screen loops, and reduced motion drops the lift", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const block = css.slice(css.indexOf(".lang-btn {"), css.indexOf(".lang-btn__native {"));
    assert.ok(!/animation/.test(block), "a language card must not animate on its own");

    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.ok(reduced.includes(".lang-btn"), "the hover lift must be dropped for reduced motion");
    assert.match(reduced, /\.lang-btn:hover,[\s\S]{0,60}transform: none/);
  });
});

describe("module selection", () => {
  it("disables both modules while the prerequisite is unfinished", () => {
    const html = renderModulesHtml(false);
    TRAINING_MODULES.forEach((module) => {
      assert.ok(html.includes(`data-module-id="${module.id}"`), `${module.id} card missing`);
    });
    assert.strictEqual([...html.matchAll(/disabled aria-disabled="true"/g)].length, TRAINING_MODULES.length);
    assert.ok(html.includes('data-role="locked-notice"'));
  });

  it("enables them once it is finished, and drops the locked notice", () => {
    const html = renderModulesHtml(true);
    assert.ok(!html.includes("disabled aria-disabled"));
    assert.ok(!html.includes('data-role="locked-notice"'));
  });

  it("lists only the equipment a module actually teaches today", () => {
    assert.deepStrictEqual(getEquipmentForModule("fire-response").map((e) => e.id), [EXTINGUISHER]);
    assert.deepStrictEqual(
      getEquipmentForModule("gas-leak").map((e) => e.id),
      ["multi_gas_detector", "scba", "safety_harness"]
    );
  });

  it("keeps the shared helmet once in the catalog, for when it is activated", () => {
    // it is worn in both modules, so it appears once and names both — and while it
    // is pending it gates neither
    const helmet = getEquipmentById("safety_helmet");
    assert.deepStrictEqual(helmet.modules, ["fire-response", "gas-leak"]);
    assert.strictEqual(EQUIPMENT_CATALOG.filter((item) => item.id === "safety_helmet").length, 1);
    assert.ok(!requiredEquipmentForModule("fire-response").includes("safety_helmet"));
    assert.ok(!requiredEquipmentForModule("gas-leak").includes("safety_helmet"));
  });
});

// ---------- the screen itself ----------

describe("the familiarization screen reflects progress", () => {
  it("keeps start training dead until the set is done", () => {
    const locked = renderScreenHtml(getPrerequisiteProgress(WORKER));
    assert.match(locked, /data-action="continue" disabled/);
    assert.ok(locked.includes('data-role="locked"'));

    completeAll();
    const unlocked = renderScreenHtml(getPrerequisiteProgress(WORKER));
    assert.ok(!/data-action="continue" disabled/.test(unlocked));
    assert.ok(unlocked.includes('data-role="complete"'));
  });

  it("reports the count against the active set", () => {
    markEquipmentViewed(WORKER, EXTINGUISHER);
    const html = renderScreenHtml(getPrerequisiteProgress(WORKER));
    assert.ok(html.includes('aria-valuenow="1"'));
    assert.ok(html.includes(`aria-valuemax="${REQUIRED_EQUIPMENT_IDS.length}"`));
  });

  it("gives every component a label key and a description key", () => {
    EQUIPMENT_CATALOG.forEach((item) => {
      item.components.forEach((component) => {
        assert.match(componentLabelKey(item.id, component.id), /^equipment\..+\.components\..+\.label$/);
        assert.match(componentDescKey(item.id, component.id), /^equipment\..+\.components\..+\.desc$/);
      });
    });
  });
});

// ---------- the 2D exploded view ----------

describe("16. tapping the extinguisher takes it apart", () => {
  const item = getEquipmentById(EXTINGUISHER);

  it("16a. every one of the six components has its own component photograph", () => {
    const withParts = explodableComponents(EXTINGUISHER).map((c) => c.id).sort();
    assert.deepStrictEqual(withParts, [...TARGET_COMPONENTS].sort());
  });

  it("16b. component close-ups are real photographs, never cut from the assembled shot", () => {
    // lifting a part out of the assembled photo would expose geometry the camera
    // never saw. each close-up is its own file.
    item.components.forEach((component) => {
      assert.ok(component.part.image, `${component.id} has no component photograph`);
      assert.notStrictEqual(
        component.part.image,
        item.image,
        `${component.id} is being cropped out of the assembled photograph`
      );
    });
  });

  it("16c. every component image and mask exists on disk and is precached", () => {
    const sw = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
    const images = allEquipmentImages();
    assert.ok(images.some((rel) => rel.endsWith(".mask.png")), "the masks must be in the asset graph");

    images.forEach((rel) => {
      assert.ok(fs.existsSync(path.join(FRONTEND, rel.replace(/^\.\//, ""))), `${rel} is not on disk`);
      assert.ok(sw.includes(`"${rel}"`), `${rel} is not in STATIC_ASSETS`);
      assert.ok(!/^(https?:)?\/\//i.test(rel), `${rel} is remote`);
    });
  });

  it("16d. crops stay inside their source image", () => {
    item.components.forEach(({ id, part }) => {
      const { x, y, w, h } = part.crop;
      assert.ok(w > 0 && h > 0, `${id} has an empty crop`);
      assert.ok(x >= 0 && y >= 0, `${id} crop starts off-image`);
      assert.ok(x + w <= 100.01, `${id} crop runs past the right edge`);
      assert.ok(y + h <= 100.01, `${id} crop runs past the bottom edge`);
    });
  });

  it("16e. the crop frame scales and offsets the source correctly", () => {
    // a 25%-wide crop must blow the image up to 400% and shift it by -x/w
    const html = renderPartFrame({ image: "./x.jpg", crop: { x: 25, y: 10, w: 25, h: 50 } }, "");
    assert.ok(html.includes("width:400%"), "crop width maths is wrong");
    assert.ok(html.includes("height:200%"), "crop height maths is wrong");
    assert.ok(html.includes("left:-100%"), "crop x offset is wrong");
    assert.ok(html.includes("top:-20%"), "crop y offset is wrong");
  });

  it("16e-i. a component is fitted to its real proportions, never stretched", () => {
    // a crop's shape comes from the region it frames out of a real photograph, and
    // squeezing that into the frame's shape would make the part lie about itself
    const hose = item.components.find((c) => c.id === "hose");
    assert.ok(Math.abs(partAspect(hose.part) - (96 * 428) / (50 * 500)) < 0.001);
    assert.ok(Math.abs(partFrameAspect() - 1.4) < 0.001);

    const wide = fitInFrame(2.8, 1.4);
    assert.deepStrictEqual(wide, { w: 100, h: 50 }, "a wide part fills the width and loses height");
    const tall = fitInFrame(0.7, 1.4);
    assert.deepStrictEqual(tall, { w: 50, h: 100 }, "a tall part fills the height and loses width");
    assert.deepStrictEqual(fitInFrame(1.4, 1.4), { w: 100, h: 100 });

    item.components.forEach(({ id, part }) => {
      const fit = fitInFrame(partAspect(part), partFrameAspect());
      assert.ok(fit.w > 0 && fit.w <= 100, `${id} frame width out of range`);
      assert.ok(fit.h > 0 && fit.h <= 100, `${id} frame height out of range`);
      // whichever way round it is, one side fills the frame exactly
      assert.ok(fit.w === 100 || fit.h === 100, `${id} does not fill its frame in either direction`);
    });
  });

  it("16f. the view opens zoomed on the equipment, with no explore button anywhere", () => {
    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(html.includes(`data-phase="${PHASE_ZOOM}"`), "the view must open on the zoom");
    assert.ok(html.includes('data-exploded="false"'));

    // the equipment itself is the way in
    assert.match(html, /class="eq-object"[^>]*data-action="explode"/s);

    // and there is no separate control, in the markup, the stylesheet or the locales
    assert.ok(!html.includes("Explore parts"), "the explore button is still rendered");
    assert.ok(!html.includes("eq-btn--explore"));

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.ok(!css.includes("eq-btn--explore"), "the explore button style survives");

    ["en", "hi"].forEach((locale) => {
      const json = JSON.parse(fs.readFileSync(path.join(FRONTEND, `locales/${locale}.json`), "utf8"));
      assert.strictEqual(json.prerequisite.btn_explore_parts, undefined, `${locale} still carries the explore string`);
    });
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    assert.ok(!src.includes("btn_explore_parts"));
  });

  it("16f-i. the dismantling happens on its own, without a second tap", () => {
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    // zoom, hold, come apart — scheduled at open time, not waiting on an event
    assert.match(src, /after\(ZOOM_MS \+ SETTLE_MS, explode\)/);
    assert.ok(ZOOM_MS >= 500 && ZOOM_MS <= 700, "the zoom must be 500-700ms");
    assert.ok(SETTLE_MS > 0, "the equipment must hold still before it comes apart");

    // a tab that is off screen gets no animation frames, so the sequence cannot be
    // driven by requestAnimationFrame alone or it stalls at thumbnail size
    assert.match(src, /if \(raf\) raf\(\(\) => raf\(startZoom\)\);[\s\S]*?after\(80, startZoom\);/);
  });

  it("16g. exploded state shows six plates, a reassemble control and a prompt", () => {
    const html = renderDetailHtml(EXTINGUISHER, { phase: PHASE_EXPLODED });
    assert.ok(html.includes(`data-phase="${PHASE_EXPLODED}"`));
    assert.ok(html.includes('data-exploded="true"'));
    assert.ok(html.includes('data-action="reassemble"'), "there must be a way back");

    TARGET_COMPONENTS.forEach((id) => {
      assert.ok(html.includes(`data-piece="${id}"`), `no plate for ${id}`);
    });
    assert.strictEqual([...html.matchAll(/data-action="select-part"/g)].length, 6);
    assert.ok(html.includes("eq-selection--empty"), "an unselected exploded view prompts the worker");
  });

  it("16g-i. the callouts are off while the unit is apart, so nothing clutters it", () => {
    const apart = renderDetailHtml(EXTINGUISHER, { phase: PHASE_EXPLODED });
    assert.ok(apart.includes('data-callouts="off"'), "callouts must be off in the exploded view");

    // they come back with the assembled state a worker reassembles into
    const back = renderDetailHtml(EXTINGUISHER, { phase: PHASE_ASSEMBLED, callouts: true });
    assert.ok(back.includes('data-callouts="on"'));

    // and the reassemble control goes away once there is nothing to reassemble. a
    // display value beats the hidden attribute, so the stylesheet has to say so.
    assert.match(back, /data-role="controls" hidden/);
    const css2 = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.match(css2, /\.eq-stage__controls\[hidden\] \{\s*display: none;/);

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.match(css, /\[data-callouts="off"\][^{]*\.eq-callout\s*\{[^}]*opacity:\s*0/s);
  });

  it("16h. selecting a component marks it, dims the others and explains it", () => {
    setLocale("en");
    const html = renderDetailHtml(EXTINGUISHER, { phase: PHASE_EXPLODED, selected: "safety_pin" });

    assert.match(html, /data-piece="safety_pin"[^>]*aria-pressed="true"/s);
    assert.ok(html.includes("eq-piece--on"), "the chosen part is not emphasised");
    assert.strictEqual([...html.matchAll(/eq-piece--dim/g)].length, 5, "the other five must step back");

    assert.ok(html.includes('data-selected="safety_pin"'));
    assert.ok(html.includes(t(componentLabelKey(EXTINGUISHER, "safety_pin"), {}, "")));
    assert.ok(html.includes(t(componentDescKey(EXTINGUISHER, "safety_pin"), {}, "")));
  });

  it("16h-i. the chosen part is lifted by a glow, not by a box around it", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const on = css.slice(css.indexOf(".eq-piece--on::before"), css.indexOf(".eq-piece:focus-visible"));
    assert.ok(on.includes("radial-gradient"), "the highlight must follow the part, not rectangle it");
    assert.ok(on.includes("drop-shadow"), "the selected part needs a rim to lift it off the background");
    assert.match(css, /\[data-parts="out"\] \.eq-piece--on \{[^}]*scale\(1\.08\)/s);
  });

  it("16i. selecting a different component swaps the explanation", () => {
    setLocale("en");
    const pin = renderSelectionPanel(item, "safety_pin");
    const hose = renderSelectionPanel(item, "hose");

    assert.ok(pin.includes(t(componentDescKey(EXTINGUISHER, "safety_pin"), {}, "")));
    assert.ok(hose.includes(t(componentDescKey(EXTINGUISHER, "hose"), {}, "")));
    assert.notStrictEqual(pin, hose);
    assert.ok(!hose.includes('data-selected="safety_pin"'));
  });

  it("16j. the explanation reuses the existing locale keys, inventing nothing", () => {
    setLocale("en");
    const html = renderSelectionPanel(item, "pressure_gauge");
    const expected = t(componentDescKey(EXTINGUISHER, "pressure_gauge"), {}, "");
    assert.ok(expected.length > 0);
    assert.ok(html.includes(expected), "the panel must show the existing description verbatim");
  });

  it("16k. plates carry an accessible name and a real button role", () => {
    setLocale("en");
    const html = renderPartPlate(item, item.components[0], 0, null);
    assert.ok(html.startsWith("<button"), "a plate must be a real button, not a div");
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes("eq-sr-only"), "a plate needs a text name for a screen reader");
    assert.ok(html.includes('aria-pressed="false"'));
  });

  it("16k-i. the equipment itself is a real button with a name that says what it does", () => {
    setLocale("en");
    const html = renderDetailHtml(EXTINGUISHER);
    const label = html.match(/class="eq-object"[^>]*aria-label="([^"]*)"/s);
    assert.ok(label, "the equipment must be reachable as a control");
    assert.ok(label[1].includes(t(equipmentNameKey(EXTINGUISHER), {}, "")), "it must name the equipment");
    assert.ok(label[1].includes(t("prerequisite.tap_to_dismantle", {}, "")), "it must say what tapping does");
  });

  it("16l. every plate sits inside the stage, at its own place in the two columns", () => {
    const halfW = PART_PLATE.width / 2;
    const halfH = PART_PLATE.height / 2;

    item.components.forEach(({ id, part }) => {
      assert.ok(part.explode.x - halfW >= 0, `${id} plate runs off the left of the stage`);
      assert.ok(part.explode.x + halfW <= 100, `${id} plate runs off the right of the stage`);
      assert.ok(part.explode.y - halfH >= 0, `${id} plate runs off the top of the stage`);
      assert.ok(part.explode.y + halfH <= 100, `${id} plate runs off the bottom of the stage`);
      // and on the side it is called out on, so a part lands where it came from
      const left = part.explode.x < 50;
      assert.strictEqual(left, component_side(id) === "left", `${id} explodes to the wrong side`);
    });

    function component_side(id) {
      return item.components.find((c) => c.id === id).side;
    }
  });

  it("16l-i. no two plates overlap, and none of them covers the body", () => {
    const boxes = item.components.map(({ id, part }) => ({
      id,
      x1: part.explode.x - PART_PLATE.width / 2,
      x2: part.explode.x + PART_PLATE.width / 2,
      y1: part.explode.y - PART_PLATE.height / 2,
      y2: part.explode.y + PART_PLATE.height / 2
    }));

    boxes.forEach((a, i) => {
      boxes.slice(i + 1).forEach((b) => {
        const overlaps = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
        assert.ok(!overlaps, `${a.id} and ${b.id} overlap in the exploded view`);
      });
    });

    // the shrunken body keeps the middle of the stage to itself
    const half = (IMAGE_SPAN * EXPLODED_BODY_SCALE) / 2;
    boxes.forEach((box) => {
      const clearsX = box.x2 <= 50 - half || box.x1 >= 50 + half;
      const clearsY = box.y2 <= 50 - half || box.y1 >= 50 + half;
      assert.ok(clearsX || clearsY, `${box.id} sits on top of the body`);
    });
  });

  it("16m. plates travel outward from the middle, in their own units", () => {
    // the pull-back vector points at the stage centre, so nothing needs measuring
    item.components.forEach(({ id, part }) => {
      const { tx, ty } = explodeVector(part.explode);
      const towardCentreX = 50 - part.explode.x;
      const towardCentreY = 50 - part.explode.y;
      if (Math.abs(towardCentreX) > 1) {
        assert.ok(Math.sign(tx) === Math.sign(towardCentreX), `${id} x vector points the wrong way`);
      }
      if (Math.abs(towardCentreY) > 1) {
        assert.ok(Math.sign(ty) === Math.sign(towardCentreY), `${id} y vector points the wrong way`);
      }
      assert.ok(Math.hypot(tx, ty) <= 71, `${id} travels further than one plate width`);
    });
  });

  it("16m-i. the plates come apart in a stagger, one after another", () => {
    setLocale("en");
    const delays = item.components.map((component, index) => {
      const html = renderPartPlate(item, component, index, null);
      const found = html.match(/--eq-delay:(\d+)ms/);
      assert.ok(found, `${component.id} has no entrance delay`);
      return Number(found[1]);
    });

    assert.strictEqual(delays[0], 0, "the first part must not wait");
    delays.slice(1).forEach((delay, i) => {
      const gap = delay - delays[i];
      assert.ok(gap >= 50 && gap <= 80, `the stagger between plates is ${gap}ms, not 50-80ms`);
    });
  });

  it("16n. the body shrinks rather than vanishing, so it stays the reference", () => {
    assert.ok(EXPLODED_BODY_SCALE > 0.3 && EXPLODED_BODY_SCALE < 1);
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.match(css, /\[data-phase="exploded"\] \.eq-object \{[^}]*scale\(var\(--eq-body-scale/s);
    assert.ok(renderDetailHtml(EXTINGUISHER).includes(`--eq-body-scale:${EXPLODED_BODY_SCALE}`));
  });

  it("16n-i. the zoom is one transform on the equipment, measured from the card", () => {
    const FALLBACK_ZOOM_SCALE_MAX = Number(
      renderDetailHtml(EXTINGUISHER).match(/--eq-zoom-scale:([\d.]+)/)[1]
    );
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const zoom = css.slice(css.indexOf('.eq-stage[data-phase="zoom"] .eq-object'));
    const block = zoom.slice(0, zoom.indexOf("}"));
    assert.ok(block.includes("translate(var(--eq-zoom-x"), "the zoom must start from the card's position");
    assert.ok(block.includes("scale(var(--eq-zoom-scale"), "the zoom must start at the card's size");
    assert.ok(!/\b(width|height|top|left)\s*:/.test(block), "the zoom must not animate layout");

    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    assert.ok(src.includes("getBoundingClientRect"), "the card has to be measured for the zoom to fly from it");
    assert.match(src, /--eq-zoom-scale/);

    // The zoom may only ever grow. Measuring the equipment's own box to work out
    // where it is going feeds its own transform back in, and it opened at nearly 5x
    // and shrank — so the destination comes from the stage, and the scale is capped.
    assert.match(src, /scale: \+Math\.min\(1, Math\.max\(0\.08, from\.width \/ size\)\)/);
    assert.ok(!/_zoomFrom\(stage, object,/.test(src), "the object's own transformed box must not size the zoom");
    assert.ok(FALLBACK_ZOOM_SCALE_MAX < 1, "even the fallback must start smaller than full size");
  });

  it("16o. movement is transform and opacity only, never layout", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");

    // a selector can be declared in more than one place; check every block of it
    const blocksFor = (selector) => {
      const out = [];
      for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
        out.push(css.slice(at, css.indexOf("}", at)));
      }
      return out;
    };

    [".eq-piece {", ".eq-object {"].forEach((selector) => {
      const transitions = blocksFor(selector)
        .flatMap((block) => [...block.matchAll(/transition:\s*([^;]+);/gs)].map((m) => m[1]));
      assert.ok(transitions.length > 0, `${selector} must animate`);
      transitions.forEach((decl) => {
        assert.ok(!/\b(width|height|top|left|margin)\b/.test(decl), `${selector} transitions layout: ${decl}`);
      });
    });
  });

  it("16p. reduced motion keeps the state change but drops the travel", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    assert.ok(at !== -1, "there must be a reduced-motion block");
    const block = css.slice(at);
    assert.ok(block.includes(".eq-piece"), "plates must be covered by reduced motion");
    assert.ok(block.includes(".eq-object"), "the zoom must be covered by reduced motion");
    assert.ok(block.includes("transition-delay: 0ms"), "the stagger must be dropped");
    assert.ok(block.includes("animation: none"), "the entrance animation must be dropped");
    assert.match(block, /\[data-phase="zoom"\] \.eq-object \{[\s\S]*?transform: none/, "the zoom must not travel");
    // but the exploded body keeps its size: without it the plates lie on the body
    assert.match(block, /\[data-phase="exploded"\] \.eq-object \{\s*transform: scale\(var\(--eq-body-scale/);

    // and the view opens already apart rather than animating into it
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    assert.match(src, /prefers-reduced-motion: reduce/);
    assert.match(src, /const startPhase = reduced \? PHASE_EXPLODED : PHASE_ZOOM/);
    assert.match(src, /if \(!reduced\) \{/, "the opening sequence must be skipped entirely");
  });

  it("16q. arrow keys walk the parts and wrap", () => {
    const ids = TARGET_COMPONENTS;
    const first = item.components[0].id;
    const last = item.components[item.components.length - 1].id;

    assert.strictEqual(neighbourComponentId(EXTINGUISHER, null, "next"), first);
    assert.strictEqual(neighbourComponentId(EXTINGUISHER, last, "next"), first, "next must wrap");
    assert.strictEqual(neighbourComponentId(EXTINGUISHER, first, "prev"), last, "prev must wrap");
    assert.ok(ids.includes(neighbourComponentId(EXTINGUISHER, first, "next")));
  });

  it("16r. the live view opens on the zoom, comes apart, and closes", () => {
    openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    assert.strictEqual(getPhase(), PHASE_ZOOM, "it must start on the zoom, not already apart");
    assert.strictEqual(isExploded(), false);
    assert.strictEqual(getSelectedComponentId(), null);

    pressKey("ArrowLeft");
    assert.strictEqual(getOpenEquipmentId(), EXTINGUISHER, "there is nothing before the first item");

    closeEquipmentDetail();
    assert.strictEqual(isDetailOpen(), false);
    assert.strictEqual(getPhase(), null);
  });

  it("16s. escape puts it back together before it closes the modal", () => {
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    // the behaviour is a deliberate two-step: apart -> assembled -> closed
    assert.match(src, /phase === PHASE_EXPLODED \|\| phase === PHASE_EXPLODING\) \{\s*reassemble\(\);/);
    // and reassembling is what brings the callouts back
    assert.match(src, /setPhase\(PHASE_ASSEMBLED, \{ callouts: true \}\)/);
  });

  it("16s-i. tapping outside the equipment closes the view", () => {
    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(html.includes('data-role="scrim"'), "there must be something to tap outside");
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    assert.match(src, /action === "close" \|\| action === "done" \|\| action === "scrim"/);
  });

  it("16t. the modal traps tab and keeps a dialog label", () => {
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    assert.ok(src.includes("_trapTab"), "there must be a focus trap");
    assert.match(src, /event\.key === "Tab"/);
    assert.ok(src.includes("!el.hidden"), "a hidden control must not be a tab stop");

    const html = renderDetailHtml(EXTINGUISHER);
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('aria-labelledby="eq-dialog-title"'));
    assert.ok(html.includes('tabindex="-1"'));
  });

  it("16u. the scrim is dimmed and blurred", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const block = css.slice(css.indexOf(".eq-scrim {"), css.indexOf(".eq-dialog {"));
    assert.ok(block.includes("backdrop-filter"), "the scrim should blur what is behind it");
    assert.ok(block.includes("var(--eq-scrim)"), "the scrim should dim what is behind it");
  });

  it("16v. plates and controls meet the 48px tap minimum", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const pieceBlock = css.slice(css.indexOf(".eq-piece {"), css.indexOf(".eq-piece::before"));
    assert.ok(pieceBlock.includes("min-width: 48px"), "a plate can shrink below a fingertip");
    assert.ok(pieceBlock.includes("min-height: 48px"));
    assert.match(css, /\.eq-btn\s*\{[^}]*min-height:\s*var\(--eq-tap\)/);

    // on the narrowest phone this has to run on, a plate is well past 48px anyway
    const stagePx = 375 - 32;
    assert.ok((PART_PLATE.width / 100) * stagePx >= 48, "a plate is narrower than a fingertip at 375px");
    assert.ok((PART_PLATE.height / 100) * stagePx >= 48, "a plate is shorter than a fingertip at 375px");
  });

  it("16w. nothing in the exploded view can leave a 375px viewport", () => {
    // the stage is square and never wider than the dialog, so staying inside the
    // stage is the same thing as staying on the phone
    const parts = [
      ...item.components.map(({ id, part }) => ({
        id,
        x1: part.explode.x - PART_PLATE.width / 2,
        x2: part.explode.x + PART_PLATE.width / 2
      })),
      { id: "body", x1: 50 - (IMAGE_SPAN * EXPLODED_BODY_SCALE) / 2, x2: 50 + (IMAGE_SPAN * EXPLODED_BODY_SCALE) / 2 }
    ];

    parts.forEach(({ id, x1, x2 }) => {
      assert.ok(x1 >= 0, `${id} hangs off the left of the screen`);
      assert.ok(x2 <= 100, `${id} hangs off the right of the screen`);
    });

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.match(css, /#app\.screen-mode \{[^}]*overflow-x:\s*hidden/s, "the screen must never scroll sideways");
  });
});


// ---------- 17: the two views are never up at the same time ----------

// A worker pressed Reassemble and got both views at once: the six exploded plates
// still lying around the reassembled extinguisher, every component named twice —
// "4 Valve Block" from the plate and "4 Valve Block" from the callout. The two were
// only ever crossfaded, and the plates were never taken out of the document, so in
// the assembled state they stayed clickable, focusable and in the accessibility
// tree. Tabbing onto one of those invisible buttons and pressing it threw the whole
// view apart again.
describe("17. the assembled view and the exploded view are never both up", () => {
  const item = getEquipmentById(EXTINGUISHER);
  const PHASES = [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_EXPLODING, PHASE_EXPLODED, PHASE_REASSEMBLING];

  it("17a. no phase puts both layers in the document, whatever the callout flag", () => {
    // this is the invariant the whole state model exists to hold
    PHASES.forEach((phase) => {
      [false, true].forEach((callouts) => {
        const view = stageState(phase, callouts);
        assert.ok(
          view.calloutsHidden || view.partsHidden,
          `${phase} (callouts=${callouts}) has both the callouts and the plates in the document`
        );
      });
    });
  });

  it("17b. and no phase paints both, nor lets both be touched", () => {
    PHASES.forEach((phase) => {
      [false, true].forEach((callouts) => {
        const view = stageState(phase, callouts);
        assert.ok(!(view.callouts && view.parts), `${phase} paints both views`);
        // the plates are only ever buttons in the one state that is about them
        if (view.interactive) {
          assert.ok(view.calloutsHidden, `${phase} leaves the callouts up while the plates are live`);
        }
      });
    });
    assert.strictEqual(stageState(PHASE_EXPLODED).interactive, true);
    [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_EXPLODING, PHASE_REASSEMBLING].forEach((phase) => {
      assert.strictEqual(stageState(phase).interactive, false, `${phase} must not accept part taps`);
    });
  });

  it("17c. an unknown phase falls back to showing neither, not both", () => {
    const view = stageState("nonsense", true);
    assert.ok(view.calloutsHidden && view.partsHidden);
  });

  it("17d. the markup carries hidden, not just a transparent layer", () => {
    const apart = layerState(renderDetailHtml(EXTINGUISHER, { phase: PHASE_EXPLODED }));
    assert.strictEqual(apart.partsPresent, true, "the plates must be in the document when apart");
    assert.strictEqual(apart.calloutsPresent, false, "the callouts must be OUT of the document when apart");

    const back = layerState(renderDetailHtml(EXTINGUISHER, { phase: PHASE_ASSEMBLED, callouts: true }));
    assert.strictEqual(back.calloutsPresent, true, "the callouts must come back");
    assert.strictEqual(back.partsPresent, false, "the plates must be OUT of the document once assembled");

    // and hidden has to actually mean display:none for a positioned layer
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.match(css, /\.eq-callouts\[hidden\],\s*\n\s*\.eq-pieces\[hidden\] \{\s*display: none;/);
  });

  it("17e. exactly one representation of each component, in every phase", () => {
    PHASES.forEach((phase) => {
      [false, true].forEach((callouts) => {
        const html = renderDetailHtml(EXTINGUISHER, { phase, callouts });
        const layers = layerState(html);
        const shown = (layers.calloutsPresent ? 1 : 0) + (layers.partsPresent ? 1 : 0);
        assert.ok(shown <= 1, `${phase} (callouts=${callouts}) shows ${shown} copies of every component`);

        item.components.forEach((component) => {
          // both layers are keyed per component, so counting the keys counts the copies
          assert.strictEqual(
            [...html.matchAll(new RegExp(`data-callout="${component.id}"`, "g"))].length,
            1,
            `${component.id} is not rendered exactly once in the callout layer`
          );
          assert.strictEqual(
            [...html.matchAll(new RegExp(`data-piece="${component.id}"`, "g"))].length,
            1,
            `${component.id} is not rendered exactly once in the plate layer`
          );
        });
      });
    });
  });

  it("17f. a plate is only a button while the exploded view is the live one", () => {
    const apart = renderDetailHtml(EXTINGUISHER, { phase: PHASE_EXPLODED });
    assert.ok(!/data-action="select-part"[^>]*disabled/.test(apart), "a live plate must not be disabled");

    [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_EXPLODING, PHASE_REASSEMBLING].forEach((phase) => {
      const html = renderDetailHtml(EXTINGUISHER, { phase, callouts: true });
      const plates = [...html.matchAll(/<button[^>]*data-piece="[^"]+"[^>]*>/g)].map((m) => m[0]);
      assert.strictEqual(plates.length, 6);
      plates.forEach((plate) => {
        assert.ok(/\sdisabled/.test(plate), `${phase} leaves a plate reachable: ${plate.slice(0, 70)}`);
      });
    });
  });

  it("17g. explode, then reassemble, leaves nothing of the exploded view behind", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    const callouts = () => root.querySelector('[data-role="callouts"]');
    const pieces = () => root.querySelector('[data-role="pieces"]');
    const plates = () => root.querySelectorAll("[data-piece]");

    // 1-2. reach the exploded state
    clickOn(root, root.querySelector('[data-role="object"]'));
    assert.strictEqual(getPhase(), PHASE_EXPLODED);

    // 3. the assembled callouts are gone
    assert.strictEqual(callouts().hidden, true, "the callouts are still in the document while apart");
    // 4. the exploded components are there and live
    assert.strictEqual(pieces().hidden, false);
    assert.strictEqual(plates().length, 6);
    plates().forEach((plate) => assert.strictEqual(plate.disabled, false, "a plate is not usable while apart"));

    // 5. press reassemble
    clickOn(root, root.querySelector('[data-role="reassemble"]'));
    assert.strictEqual(getPhase(), PHASE_REASSEMBLING);
    // the plates stop being controls the moment the journey home starts
    plates().forEach((plate) => assert.strictEqual(plate.disabled, true, "a plate is still live while leaving"));
    assert.strictEqual(getSelectedComponentId(), null, "the selection must be cleared");

    await settle(REASSEMBLE_MS + 60);

    // 6-8. the exploded view is out of the document, out of reach
    assert.strictEqual(getPhase(), PHASE_ASSEMBLED);
    assert.strictEqual(pieces().hidden, true, "the plates are still in the document after reassembling");
    plates().forEach((plate) => assert.strictEqual(plate.disabled, true));

    // 9-10. and the assembled view is back, whole
    assert.strictEqual(callouts().hidden, false, "the callouts did not come back");
    const stage = root.querySelector('[data-role="stage"]');
    assert.strictEqual(stage.getAttribute("data-callouts"), "on");
    assert.strictEqual(stage.getAttribute("data-parts"), "in");
    assert.strictEqual(stage.getAttribute("data-exploded"), "false");
    assert.strictEqual(root.querySelector('[data-role="object"]').getAttribute("data-action"), "explode");

    // 11-12. one representation of each component, so no number appears twice
    const selection = root.querySelector('[data-role="selection"]');
    assert.strictEqual(selection.hidden, true, "the exploded explanation is still on screen");
    assert.strictEqual(selection.innerHTML, "", "the exploded explanation still has words in it");
    assert.strictEqual(root.querySelector('[data-role="controls"]').hidden, true);

    closeEquipmentDetail();
  });

  it("17h. three full cycles leave the same clean assembled state every time", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    const stage = () => root.querySelector('[data-role="stage"]');
    const callouts = () => root.querySelector('[data-role="callouts"]');
    const pieces = () => root.querySelector('[data-role="pieces"]');

    for (let cycle = 1; cycle <= 3; cycle++) {
      clickOn(root, root.querySelector('[data-role="object"]'));

      // after the first cycle the callouts are up, so the hand-off goes through
      // exploding: they leave before the plates arrive, never side by side
      if (getPhase() === PHASE_EXPLODING) {
        assert.strictEqual(pieces().hidden, true, `cycle ${cycle}: plates arrived before the callouts left`);
        assert.strictEqual(callouts().hidden, false);
        await settle(CALLOUT_FADE_MS + 60);
      }

      assert.strictEqual(getPhase(), PHASE_EXPLODED, `cycle ${cycle}: did not come apart`);
      assert.strictEqual(callouts().hidden, true, `cycle ${cycle}: callouts survived the explode`);
      assert.strictEqual(pieces().hidden, false);

      // pick a part, so there is selection state to clean up as well
      clickOn(root, root.querySelector('[data-piece="hose"]'));
      assert.strictEqual(getSelectedComponentId(), "hose");

      clickOn(root, root.querySelector('[data-role="reassemble"]'));
      await settle(REASSEMBLE_MS + 60);

      assert.strictEqual(getPhase(), PHASE_ASSEMBLED, `cycle ${cycle}: did not settle`);
      assert.strictEqual(pieces().hidden, true, `cycle ${cycle}: plates left behind`);
      assert.strictEqual(callouts().hidden, false, `cycle ${cycle}: callouts did not return`);
      assert.strictEqual(getSelectedComponentId(), null, `cycle ${cycle}: a selection survived`);
      assert.strictEqual(stage().getAttribute("data-parts"), "in");
      assert.strictEqual(stage().getAttribute("data-callouts"), "on");
      root.querySelectorAll("[data-piece]").forEach((plate) => {
        assert.strictEqual(plate.disabled, true, `cycle ${cycle}: a plate stayed live`);
      });
    }

    closeEquipmentDetail();
  });

  it("17i. hammering the two controls cannot leave both views up", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    const object = () => root.querySelector('[data-role="object"]');
    const reassemble = () => root.querySelector('[data-role="reassemble"]');
    const check = (when) => {
      const callouts = root.querySelector('[data-role="callouts"]');
      const pieces = root.querySelector('[data-role="pieces"]');
      assert.ok(callouts.hidden || pieces.hidden, `${when}: both views are in the document at once`);
    };

    // straight back and forth with no time to finish anything
    for (let i = 0; i < 6; i++) {
      clickOn(root, object());
      check(`explode ${i}`);
      clickOn(root, reassemble());
      check(`reassemble ${i}`);
    }

    // and interrupting each transition part way through
    clickOn(root, object());
    await settle(CALLOUT_FADE_MS / 2);
    clickOn(root, reassemble());
    check("interrupted explode");
    await settle(REASSEMBLE_MS / 2);
    clickOn(root, object());
    check("interrupted reassembly");

    await settle(CALLOUT_FADE_MS + REASSEMBLE_MS + 120);
    check("after everything has settled");

    // whatever it settled on, it is one whole state and not half of two
    const phase = getPhase();
    assert.ok([PHASE_ASSEMBLED, PHASE_EXPLODED].includes(phase), `settled mid-transition on ${phase}`);
    const view = stageState(phase, phase === PHASE_ASSEMBLED);
    assert.strictEqual(root.querySelector('[data-role="pieces"]').hidden, view.partsHidden);
    assert.strictEqual(root.querySelector('[data-role="callouts"]').hidden, view.calloutsHidden);

    closeEquipmentDetail();
  });

  it("17j. a tap on a plate that is not live is ignored rather than re-exploding", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    clickOn(root, root.querySelector('[data-role="object"]'));
    clickOn(root, root.querySelector('[data-role="reassemble"]'));
    await settle(REASSEMBLE_MS + 60);
    assert.strictEqual(getPhase(), PHASE_ASSEMBLED);

    // this is the bug: a stray tap or tab onto a plate left over from the exploded
    // view used to force the phase straight back to exploded
    clickOn(root, root.querySelector('[data-piece="nozzle"]'));
    assert.strictEqual(getPhase(), PHASE_ASSEMBLED, "an invisible plate threw the view apart");
    assert.strictEqual(getSelectedComponentId(), null);
    assert.strictEqual(root.querySelector('[data-role="pieces"]').hidden, true);

    closeEquipmentDetail();
  });

  it("17k. the zoom leaves nothing of either view behind when it lands", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    assert.strictEqual(getPhase(), PHASE_ZOOM);

    // nothing but the equipment is on screen while it is flying in
    assert.strictEqual(root.querySelector('[data-role="callouts"]').hidden, true);
    assert.strictEqual(root.querySelector('[data-role="pieces"]').hidden, true);

    // and it comes apart on its own, into one state
    await settle(ZOOM_MS + SETTLE_MS + 120);
    assert.strictEqual(getPhase(), PHASE_EXPLODED);
    assert.strictEqual(root.querySelector('[data-role="callouts"]').hidden, true);
    assert.strictEqual(root.querySelector('[data-role="pieces"]').hidden, false);

    closeEquipmentDetail();
  });

  it("17l. escape walks back one state at a time and settles clean", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    clickOn(root, root.querySelector('[data-role="object"]'));
    assert.strictEqual(getPhase(), PHASE_EXPLODED);

    pressKey("Escape");
    assert.strictEqual(getPhase(), PHASE_REASSEMBLING, "escape must put it back together first");
    await settle(REASSEMBLE_MS + 60);
    assert.strictEqual(getPhase(), PHASE_ASSEMBLED);
    assert.strictEqual(root.querySelector('[data-role="pieces"]').hidden, true);
    assert.strictEqual(root.querySelector('[data-role="callouts"]').hidden, false);

    pressKey("Escape");
    assert.strictEqual(isDetailOpen(), false, "a second escape must close it");
  });

  it("17m. closing part way through a transition does not leave a timer running", async () => {
    const root = openEquipmentDetail({ equipmentId: EXTINGUISHER, container: makeEl("div") });
    clickOn(root, root.querySelector('[data-role="object"]'));
    clickOn(root, root.querySelector('[data-role="reassemble"]'));
    closeEquipmentDetail();

    await settle(REASSEMBLE_MS + 120);
    assert.strictEqual(isDetailOpen(), false);
    assert.strictEqual(getPhase(), null, "a timer from a closed view wrote to the state");
  });
});


// ---------- 18: the gas leak / confined space set ----------

// The gas equipment is the same feature as the extinguisher with different data in
// it: one catalog, one renderer, one state model. So most of what matters here is
// that every live item behaves identically, which is what this checks — and then the
// handful of things that are specific to the gas set.
describe("18. the gas leak and confined space equipment", () => {
  const GAS = ["multi_gas_detector", "scba", "safety_harness"];

  it("18a. all three gas items are live and gate the gas module", () => {
    GAS.forEach((id) => {
      const item = getEquipmentById(id);
      assert.strictEqual(item.status, STATUS_ACTIVE, `${id} is not live`);
      assert.deepStrictEqual(item.modules, ["gas-leak"]);
    });
    assert.deepStrictEqual(requiredEquipmentForModule("gas-leak"), GAS);
  });

  it("18b. the gas module waits for its own kit, and the fire module for its own", () => {
    // reading one module's equipment must not open the other module's door
    assert.deepStrictEqual(requiredEquipmentForModule("fire-response"), [EXTINGUISHER]);

    markEquipmentViewed(WORKER, EXTINGUISHER);
    assert.strictEqual(isPrerequisiteComplete(WORKER, "fire-response"), true, "the extinguisher opens the fire module");
    assert.strictEqual(isPrerequisiteComplete(WORKER, "gas-leak"), false, "and does nothing for the gas module");

    GAS.slice(0, 2).forEach((id) => markEquipmentViewed(WORKER, id));
    assert.strictEqual(isPrerequisiteComplete(WORKER, "gas-leak"), false, "two of the three is not enough");

    markEquipmentViewed(WORKER, GAS[2]);
    assert.strictEqual(isPrerequisiteComplete(WORKER, "gas-leak"), true);
    assert.strictEqual(isPrerequisiteComplete(WORKER), true, "and now the whole set is done");
  });

  it("18c. an unknown module id is refused rather than waved through", () => {
    completeAll();
    assert.deepStrictEqual(requiredEquipmentForModule("not-a-module"), REQUIRED_EQUIPMENT_IDS);
    assert.deepStrictEqual(requiredEquipmentForModule(null), REQUIRED_EQUIPMENT_IDS);
    // with nothing viewed at all, no module id of any kind opens
    resetPrerequisite(WORKER);
    assert.strictEqual(isPrerequisiteComplete(WORKER, "gas-leak"), false);
    assert.strictEqual(isPrerequisiteComplete(WORKER, "not-a-module"), false);
  });

  it("18d. the module screen locks each module on its own equipment", () => {
    setLocale("en");
    const onlyFire = renderModulesHtml({ "fire-response": true, "gas-leak": false });
    assert.match(onlyFire, /data-module-id="fire-response"[^>]*>/);
    assert.ok(!/data-module-id="fire-response"[^>]*disabled/.test(onlyFire), "fire must be startable");
    assert.match(onlyFire, /data-module-id="gas-leak"[\s\S]{0,80}?disabled/, "gas must still be locked");
    assert.ok(onlyFire.includes("mod-card--locked"), "and look locked");

    const both = renderModulesHtml({ "fire-response": true, "gas-leak": true });
    assert.ok(!both.includes("disabled"), "nothing is locked once both sets are read");
    assert.ok(!both.includes('data-role="locked-notice"'));
  });

  it("18d-i. team drill stays locked before an 80 percent solo pass", () => {
    const html = renderModulesHtml({ "fire-response": true, "gas-leak": true, "fire-response-team": false });
    assert.match(html, /data-action="start-team-drill"[^>]*disabled/);
    assert.ok(html.includes(t("modules.team_drill_locked", {}, "")));
  });

  it("18d-ii. team drill opens after an 80 percent solo pass", () => {
    recordStageResult(WORKER, "fire-response", 2, 0.8);
    assert.strictEqual(isStage2Passed(WORKER, "fire-response"), true);
    const html = renderModulesHtml({ "fire-response": true, "gas-leak": true, "fire-response-team": true });
    assert.match(html, /data-action="start-team-drill"/);
    assert.ok(!html.match(/data-action="start-team-drill"[^>]*disabled/));
  });

  it("18e. every gas card shows its photograph, its name and its viewed state", () => {
    setLocale("en");
    const screen = renderScreenHtml(getPrerequisiteProgress(WORKER));
    GAS.forEach((id) => {
      const item = getEquipmentById(id);
      assert.ok(screen.includes(`data-equipment-card="${id}"`), `no card for ${id}`);
      assert.ok(screen.includes(`src="${item.image}"`), `${id}'s card does not show its photograph`);
      // the renderer escapes what it puts in the markup, so compare like for like
      const name = t(equipmentNameKey(id), {}, "").replace(/&/g, "&amp;");
      assert.ok(screen.includes(name), `${id}'s card does not name it`);
    });
    assert.ok(screen.includes('data-role="state"'), "a card reports whether it has been viewed");

    completeAll();
    const done = renderScreenHtml(getPrerequisiteProgress(WORKER));
    assert.ok(done.includes("eq-card--viewed"), "a viewed card says so");
  });

  it("18f. each gas item opens on its complete assembled photograph, never on parts", () => {
    GAS.forEach((id) => {
      const item = getEquipmentById(id);
      const html = renderDetailHtml(id);

      // the whole item, the way it is actually put together
      assert.ok(html.includes(`class="eq-photo" src="${item.image}"`), `${id} does not open on its photograph`);
      assert.ok(html.includes(`data-phase="${PHASE_ZOOM}"`), `${id} does not open on the zoom`);
      assert.ok(!html.includes("eq-stage__art"), `${id} fell back to the drawing`);

      // and the component plates are not in the document yet
      assert.strictEqual(layerState(html).partsPresent, false, `${id} opens with its parts already out`);
    });
  });

  it("18g. no gas item sits on a white rectangle; each is masked to its own outline", () => {
    GAS.forEach((id) => {
      const item = getEquipmentById(id);
      assert.ok(item.mask, `${id} has no silhouette mask`);
      const html = renderDetailHtml(id);
      assert.ok(html.includes(`mask-image:url(&quot;${item.mask}&quot;)`), `${id} is not masked`);
      assert.ok(!html.includes("eq-plate"), `${id} is on a plate`);
    });
  });

  it("18h. components are the ones the photographs actually show", () => {
    // four per item, each with a real close-up cropped from the item's own photograph
    GAS.forEach((id) => {
      const item = getEquipmentById(id);
      assert.strictEqual(item.components.length, 4, `${id} teaches the wrong number of parts`);
      item.components.forEach((component) => {
        assert.ok(component.part && component.part.image, `${id}.${component.id} has no close-up`);
        assert.strictEqual(
          component.part.image,
          item.image,
          `${id}.${component.id} comes from a different photograph than the assembled view`
        );
      });
      assert.strictEqual(explodableComponents(id).length, 4);
    });

    // and nothing was invented to pad a list: the detector's belt clip is on the back
    // of the device, which the supplied render does not show, so it is not here
    const detector = getEquipmentById("multi_gas_detector").components.map((c) => c.id);
    assert.ok(!detector.includes("belt_clip"), "a part no photograph shows must not be taught");
    assert.deepStrictEqual(detector, ["display_screen", "sensor_intake", "alarm_indicator", "control_buttons"]);
  });

  it("18i. every gas component reads from the existing locale keys", () => {
    ["en", "hi"].forEach((locale) => {
      setLocale(locale);
      GAS.forEach((id) => {
        getEquipmentById(id).components.forEach((component) => {
          const label = t(componentLabelKey(id, component.id), {}, "");
          const desc = t(componentDescKey(id, component.id), {}, "");
          assert.ok(label.length > 0, `${locale} has no label for ${id}.${component.id}`);
          assert.ok(desc.length > 0, `${locale} has no description for ${id}.${component.id}`);
        });
      });
    });

    // the explanation panel shows those strings verbatim, inventing nothing
    setLocale("en");
    const item = getEquipmentById("scba");
    const panel = renderSelectionPanel(item, "air_cylinder");
    assert.ok(panel.includes(t(componentDescKey("scba", "air_cylinder"), {}, "")));
  });
});

// ---------- 19: every live item behaves the same way ----------

// The extinguisher's interaction was built and fixed in suites 16 and 17. Everything
// live has to behave identically or the gas equipment is a second implementation
// wearing the same clothes, which is the thing this was asked not to be.
describe("19. every live item behaves identically", () => {
  ACTIVE_EQUIPMENT.forEach((item) => {
    const id = item.id;

    it(`19a. ${id}: opens zoomed, comes apart on its own, and has no explore button`, () => {
      const html = renderDetailHtml(id);
      assert.ok(html.includes(`data-phase="${PHASE_ZOOM}"`));
      assert.match(html, /class="eq-object"[^>]*data-action="explode"/s);
      assert.ok(!html.includes("Explore parts"), "the explore button is back");
      assert.ok(!html.includes("eq-btn--explore"));

      const apart = renderDetailHtml(id, { phase: PHASE_EXPLODED });
      assert.ok(apart.includes('data-action="reassemble"'), "there must be a way back");
      item.components.forEach((component) => {
        assert.ok(apart.includes(`data-piece="${component.id}"`), `no plate for ${component.id}`);
      });
    });

    it(`19b. ${id}: the two views are never in the document together`, () => {
      [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_EXPLODING, PHASE_EXPLODED, PHASE_REASSEMBLING].forEach((phase) => {
        [false, true].forEach((callouts) => {
          const layers = layerState(renderDetailHtml(id, { phase, callouts }));
          assert.ok(
            !(layers.calloutsPresent && layers.partsPresent),
            `${id} shows both views in ${phase}`
          );
        });
      });
    });

    it(`19c. ${id}: a plate is only a control while the exploded view is live`, () => {
      const live = renderDetailHtml(id, { phase: PHASE_EXPLODED });
      assert.ok(!/data-action="select-part"[^>]*disabled/.test(live), "a live plate must not be disabled");

      [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_REASSEMBLING].forEach((phase) => {
        const html = renderDetailHtml(id, { phase, callouts: true });
        const plates = [...html.matchAll(/<button[^>]*data-piece="[^"]+"[^>]*>/g)].map((m) => m[0]);
        assert.strictEqual(plates.length, item.components.length);
        plates.forEach((plate) => assert.ok(/\sdisabled/.test(plate), `${id} leaves a plate reachable in ${phase}`));
      });
    });

    it(`19d. ${id}: selecting a part marks it, dims the rest and explains it`, () => {
      setLocale("en");
      const target = item.components[1].id;
      const html = renderDetailHtml(id, { phase: PHASE_EXPLODED, selected: target });

      assert.match(html, new RegExp(`data-piece="${target}"[^>]*aria-pressed="true"`, "s"));
      assert.ok(html.includes("eq-piece--on"));
      assert.strictEqual(
        [...html.matchAll(/eq-piece--dim/g)].length,
        item.components.length - 1,
        `${id}: the other parts must step back`
      );
      assert.ok(html.includes(t(componentDescKey(id, target), {}, "")));
    });

    it(`19e. ${id}: every anchor is on the photograph and every label clear of it`, () => {
      const min = IMAGE_INSET;
      const max = IMAGE_INSET + IMAGE_SPAN;
      item.components.forEach((component) => {
        const { x, y } = component.anchor;
        assert.ok(x >= min && x <= max, `${id}.${component.id} anchor x=${x} is off the photograph`);
        assert.ok(y >= min && y <= max, `${id}.${component.id} anchor y=${y} is off the photograph`);

        const inset = component.side === "left" ? component.label.x : 100 - component.label.x;
        assert.ok(inset + CALLOUT_GUTTER < 50, `${id}.${component.id} label can reach the middle`);
      });
    });

    it(`19f. ${id}: crops stay inside the photograph and are never stretched`, () => {
      item.components.forEach(({ id: cid, part }) => {
        const { x, y, w, h } = part.crop;
        assert.ok(w > 0 && h > 0, `${id}.${cid} has an empty crop`);
        assert.ok(x >= 0 && y >= 0 && x + w <= 100.01 && y + h <= 100.01, `${id}.${cid} crop leaves the image`);

        const fit = fitInFrame(partAspect(part), partFrameAspect());
        assert.ok(fit.w === 100 || fit.h === 100, `${id}.${cid} does not fill its frame either way`);
        assert.ok(fit.w > 0 && fit.w <= 100 && fit.h > 0 && fit.h <= 100);
      });
    });

    it(`19g. ${id}: nothing overlaps or leaves the stage when it comes apart`, () => {
      const boxes = item.components.map(({ id: cid, part }) => ({
        id: cid,
        x1: part.explode.x - PART_PLATE.width / 2,
        x2: part.explode.x + PART_PLATE.width / 2,
        y1: part.explode.y - PART_PLATE.height / 2,
        y2: part.explode.y + PART_PLATE.height / 2
      }));

      boxes.forEach((box) => {
        assert.ok(box.x1 >= 0 && box.x2 <= 100, `${id}.${box.id} leaves the stage sideways`);
        assert.ok(box.y1 >= 0 && box.y2 <= 100, `${id}.${box.id} leaves the stage vertically`);
      });

      boxes.forEach((a, i) => {
        boxes.slice(i + 1).forEach((b) => {
          const overlaps = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
          assert.ok(!overlaps, `${id}: ${a.id} and ${b.id} overlap`);
        });
      });

      // and the shrunken body keeps the middle to itself
      const half = (IMAGE_SPAN * EXPLODED_BODY_SCALE) / 2;
      boxes.forEach((box) => {
        const clearsX = box.x2 <= 50 - half || box.x1 >= 50 + half;
        const clearsY = box.y2 <= 50 - half || box.y1 >= 50 + half;
        assert.ok(clearsX || clearsY, `${id}: ${box.id} sits on the body`);
      });
    });

    it(`19h. ${id}: comes apart and goes back together leaving nothing behind`, async () => {
      const root = openEquipmentDetail({ equipmentId: id, container: makeEl("div") });
      const callouts = () => root.querySelector('[data-role="callouts"]');
      const pieces = () => root.querySelector('[data-role="pieces"]');

      // two full cycles, because a stale plate only shows up on the way back
      for (let cycle = 1; cycle <= 2; cycle++) {
        clickOn(root, root.querySelector('[data-role="object"]'));
        if (getPhase() === PHASE_EXPLODING) await settle(CALLOUT_FADE_MS + 60);

        assert.strictEqual(getPhase(), PHASE_EXPLODED, `${id} cycle ${cycle}: did not come apart`);
        assert.strictEqual(callouts().hidden, true, `${id} cycle ${cycle}: callouts survived`);
        assert.strictEqual(pieces().hidden, false);
        assert.strictEqual(root.querySelectorAll("[data-piece]").length, item.components.length);

        clickOn(root, root.querySelector(`[data-piece="${item.components[0].id}"]`));
        assert.strictEqual(getSelectedComponentId(), item.components[0].id);

        clickOn(root, root.querySelector('[data-role="reassemble"]'));
        await settle(REASSEMBLE_MS + 60);

        assert.strictEqual(getPhase(), PHASE_ASSEMBLED, `${id} cycle ${cycle}: did not settle`);
        assert.strictEqual(pieces().hidden, true, `${id} cycle ${cycle}: plates left behind`);
        assert.strictEqual(callouts().hidden, false, `${id} cycle ${cycle}: callouts did not return`);
        assert.strictEqual(getSelectedComponentId(), null, `${id} cycle ${cycle}: a selection survived`);
        root.querySelectorAll("[data-piece]").forEach((plate) => {
          assert.strictEqual(plate.disabled, true, `${id} cycle ${cycle}: a plate stayed live`);
        });
      }

      closeEquipmentDetail();
    });

    it(`19i. ${id}: exactly one visible representation of each component`, () => {
      [PHASE_ASSEMBLED, PHASE_EXPLODED].forEach((phase) => {
        const html = renderDetailHtml(id, { phase, callouts: phase === PHASE_ASSEMBLED });
        const layers = layerState(html);
        assert.strictEqual(
          (layers.calloutsPresent ? 1 : 0) + (layers.partsPresent ? 1 : 0),
          1,
          `${id} shows the wrong number of views in ${phase}`
        );
        item.components.forEach((component) => {
          assert.strictEqual([...html.matchAll(new RegExp(`data-callout="${component.id}"`, "g"))].length, 1);
          assert.strictEqual([...html.matchAll(new RegExp(`data-piece="${component.id}"`, "g"))].length, 1);
        });
      });
    });

    it(`19j. ${id}: its photograph and mask are on disk and precached`, () => {
      const sw = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
      [item.image, item.mask].forEach((rel) => {
        assert.ok(fs.existsSync(path.join(FRONTEND, rel.replace(/^\.\//, ""))), `${rel} is not on disk`);
        assert.ok(sw.includes(`"${rel}"`), `${rel} is not precached`);
        assert.ok(!/^(https?:)?\/\//i.test(rel), `${rel} is remote`);
      });
    });

    it(`19k. ${id}: fits a 375px phone with nothing outside the viewport`, () => {
      // the stage is square and never wider than the dialog, so staying inside the
      // stage is the same thing as staying on the narrowest phone this runs on
      [375, 390, 412].forEach((width) => {
        const stagePx = width - 32;
        assert.ok((PART_PLATE.width / 100) * stagePx >= 48, `a plate is under a fingertip at ${width}px`);
        assert.ok((PART_PLATE.height / 100) * stagePx >= 48, `a plate is under a fingertip at ${width}px`);
      });

      item.components.forEach(({ id: cid, part }) => {
        assert.ok(part.explode.x - PART_PLATE.width / 2 >= 0, `${id}.${cid} hangs off the left`);
        assert.ok(part.explode.x + PART_PLATE.width / 2 <= 100, `${id}.${cid} hangs off the right`);
      });
    });
  });

  it("19l. reduced motion opens straight into the settled state for everything", () => {
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    assert.match(src, /prefers-reduced-motion: reduce/);
    assert.match(src, /const startPhase = reduced \? PHASE_EXPLODED : PHASE_ZOOM/);
    assert.match(src, /if \(!reduced\) \{/);

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.ok(block.includes("transition-delay: 0ms"));
    assert.ok(block.includes("animation: none"));
  });

  it("19m. nothing loops, for any item", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.ok(!css.includes("eq-bob"));
    assert.ok(!/animation:[^;]*infinite/.test(css));
    assert.ok(!/\balternate\b/.test(css));
    ACTIVE_EQUIPMENT.forEach((item) => {
      assert.ok(!renderDetailHtml(item.id).includes("eq-bob"), `${item.id} renders a bob`);
    });
  });

  it("19n. the extinguisher is untouched by any of this", () => {
    // its photograph, its six parts and its own gate are exactly what they were
    const fire = getEquipmentById(EXTINGUISHER);
    assert.strictEqual(fire.image, "./assets/images/fire-extinguisher.jpeg");
    assert.deepStrictEqual(
      fire.components.map((c) => c.id),
      ["handle", "safety_pin", "pressure_gauge", "valve_block", "hose", "nozzle"]
    );
    assert.deepStrictEqual(requiredEquipmentForModule("fire-response"), [EXTINGUISHER]);
    assert.deepStrictEqual(MODULE_IDS, ["fire-response", "gas-leak"]);

    resetPrerequisite(WORKER);
    markEquipmentViewed(WORKER, EXTINGUISHER);
    assert.strictEqual(isPrerequisiteComplete(WORKER, "fire-response"), true);
  });
});

describe("20. the exploded view says where each part came from", () => {
  const fire = () => getEquipmentById(EXTINGUISHER);
  const arrows = () => fire().components.map((component) => ({ id: component.id, arrow: explodeArrow(component) }));
  const sample = (arrow, from = 0) => {
    const points = [];
    for (let i = 0; i <= 80; i += 1) {
      const t = i / 80;
      if (t >= from) points.push(arrowPointAt(arrow, t));
    }
    return points.concat(from === 0 ? arrow.head : arrow.head);
  };

  // where each plate's photograph and name actually sit, in stage units
  const plateBoxes = () => fire().components.map((component) => {
    const { part } = component;
    const fit = fitInFrame(partAspect(part), partFrameAspect());
    const top = part.explode.y - PART_PLATE.height / 2;
    const halfW = (PART_PLATE.width * fit.w) / 200;
    const halfH = (PART_PLATE.frameHeight * fit.h) / 200;
    const frameMid = top + PART_PLATE.frameHeight / 2;
    return {
      id: component.id,
      image: { x0: part.explode.x - halfW, x1: part.explode.x + halfW, y0: frameMid - halfH, y1: frameMid + halfH },
      // the name can be as wide as the plate
      label: {
        x0: part.explode.x - PART_PLATE.width / 2,
        x1: part.explode.x + PART_PLATE.width / 2,
        y0: top + PART_PLATE.frameHeight,
        y1: top + PART_PLATE.height
      }
    };
  });
  const inside = (p, box) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;

  it("20a. every extinguisher part has an arrow, and no other item does", () => {
    assert.strictEqual(fire().explodeArrows, true);
    arrows().forEach(({ id, arrow }) => assert.ok(arrow, `${id} has no arrow`));
    assert.strictEqual((renderExplodeArrows(fire()).match(/class="eq-arrow"/g) || []).length, 6);

    // the gas set is left exactly as it was
    ["multi_gas_detector", "scba", "safety_harness"].forEach((id) => {
      assert.strictEqual(renderExplodeArrows(getEquipmentById(id)), "");
      assert.ok(!renderStage(getEquipmentById(id), { phase: PHASE_EXPLODED }).includes("eq-arrow"));
    });
  });

  it("20b. each arrow starts on the part's own place on the shrunken body", () => {
    arrows().forEach(({ id, arrow }) => {
      const component = fire().components.find((c) => c.id === id);
      const expected = {
        x: 50 + (component.anchor.x - 50) * EXPLODED_BODY_SCALE,
        y: 50 + (component.anchor.y - 50) * EXPLODED_BODY_SCALE
      };
      assert.ok(Math.abs(arrow.origin.x - expected.x) < 0.01 && Math.abs(arrow.origin.y - expected.y) < 0.01, `${id} starts in the wrong place`);
      assert.ok(Math.hypot(arrow.start.x - arrow.origin.x, arrow.start.y - arrow.origin.y) < 2, `${id} starts too far from its part`);
    });
  });

  it("20c. each arrow points at its own plate and stops short of the photograph", () => {
    const boxes = plateBoxes();
    arrows().forEach(({ id, arrow }) => {
      const component = fire().components.find((c) => c.id === id);
      const own = boxes.find((b) => b.id === id);
      // it travels toward the plate
      const before = Math.hypot(component.part.explode.x - arrow.start.x, component.part.explode.y - arrow.start.y);
      const after = Math.hypot(component.part.explode.x - arrow.tip.x, component.part.explode.y - arrow.tip.y);
      assert.ok(after < before, `${id} points away from its plate`);
      // the tip is level with the photograph and just outside its inner edge
      assert.ok(arrow.tip.y > own.image.y0 && arrow.tip.y < own.image.y1, `${id} tip is not level with its part`);
      const gap = component.part.explode.x > 50 ? own.image.x0 - arrow.tip.x : arrow.tip.x - own.image.x1;
      assert.ok(gap > 1 && gap < 3, `${id} tip is ${gap} from its photograph`);
    });
  });

  it("20d. no arrow runs under a photograph, a name, or off the stage", () => {
    const boxes = plateBoxes();
    arrows().forEach(({ id, arrow }) => {
      sample(arrow).forEach((p) => {
        assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, `${id} leaves the stage`);
        boxes.forEach((box) => {
          assert.ok(!inside(p, box.image), `${id} crosses the ${box.id} photograph`);
          assert.ok(!inside(p, box.label), `${id} crosses the ${box.id} name`);
        });
      });
    });
  });

  it("20e. arrows never cross or crowd each other once they leave the body", () => {
    const all = arrows();
    for (let a = 0; a < all.length; a += 1) {
      for (let b = a + 1; b < all.length; b += 1) {
        let closest = Infinity;
        sample(all[a].arrow, 0.15).forEach((p) => sample(all[b].arrow, 0.15).forEach((q) => {
          closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y));
        }));
        assert.ok(closest > 2, `${all[a].id} and ${all[b].id} come within ${closest.toFixed(2)}`);
      }
    }
  });

  it("20e-i. the four parts on the valve head leave on clearly different headings", () => {
    const head = ["valve_block", "handle", "safety_pin", "pressure_gauge"];
    const exits = head.map((id) => fire().components.find((c) => c.id === id).arrow.exit);
    // ordered round the head, and never closer than 35 degrees to a neighbour
    for (let i = 1; i < exits.length; i += 1) {
      assert.ok(exits[i] - exits[i - 1] >= 35, `${head[i - 1]} and ${head[i]} leave too close together`);
    }
    // so a few units out the lines are already apart, not one bundle
    const at = (id, d) => {
      const arrow = explodeArrow(fire().components.find((c) => c.id === id));
      let length = 0;
      let last = arrowPointAt(arrow, 0);
      for (let i = 1; i <= 400; i += 1) {
        const p = arrowPointAt(arrow, i / 400);
        length += Math.hypot(p.x - last.x, p.y - last.y);
        last = p;
        if (length >= d) return p;
      }
      return last;
    };
    for (let i = 0; i < head.length; i += 1) {
      for (let j = i + 1; j < head.length; j += 1) {
        const p = at(head[i], 3);
        const q = at(head[j], 3);
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 4, `${head[i]} and ${head[j]} are still bundled 3 units out`);
      }
    }
  });

  it("20e-ii. the hose arrow is long enough to read as a movement", () => {
    const arrow = explodeArrow(fire().components.find((c) => c.id === "hose"));
    let length = 0;
    let last = arrowPointAt(arrow, 0);
    for (let i = 1; i <= 200; i += 1) {
      const p = arrowPointAt(arrow, i / 200);
      length += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
    }
    // 14 stage units is about 48px on a 375px phone; a straight run was 8
    assert.ok(length >= 14, `the hose arrow is only ${length.toFixed(1)} units`);
  });

  it("20e-iii. the gauge leaves the head down and to the right, off the shoulder", () => {
    const gauge = fire().components.find((c) => c.id === "pressure_gauge");
    // measured on the silhouette mask: this heading clears the head in under two
    // units, where a straight run to the plate lay along the cylinder for about six
    assert.ok(gauge.arrow.exit > 10 && gauge.arrow.exit < 40);
    const arrow = explodeArrow(gauge);
    const bodyRight = 50 + (100 - IMAGE_INSET - 50) * EXPLODED_BODY_SCALE;
    // well before it is level with the cylinder's middle, it is out past the body
    const p = arrowPointAt(arrow, 0.3);
    assert.ok(p.x > 57 && p.x < bodyRight + 10, `the gauge arrow is at ${p.x.toFixed(1)} a third of the way down`);
  });

  it("20f. the geometry is in stage units, so it holds at every width", () => {
    // nothing in the arrow layer is in pixels: one viewBox, shared with the plates
    const html = renderExplodeArrows(fire());
    assert.match(html, /<svg class="eq-arrows"[^>]*viewBox="0 0 100 100"/);
    assert.ok(!/px/.test(html), "an arrow must not carry pixel geometry");
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const block = css.slice(css.indexOf(".eq-arrows {"), css.indexOf("/* a plate that is leaving, or gone"));
    const width = block.match(/stroke-width:\s*([\d.]+);/);
    // about 1.1px on a 342px stage and 1.2px on a 384px one: a hairline, not a ui arrow
    assert.ok(width && Number(width[1]) <= 0.4, "the arrow stroke must stay thin");
    assert.ok(!/drop-shadow|glow|box-shadow/.test(block), "an arrow must not glow");
    assert.ok(!/animation/.test(block), "an arrow must not loop or bounce");
  });

  it("20g. arrows belong to the exploded view only", () => {
    [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_EXPLODING].forEach((phase) => {
      const html = renderStage(fire(), { phase, callouts: true });
      // the arrows live inside the plate layer, which is not in the document here
      assert.match(html, /<div class="eq-pieces" data-role="pieces" hidden><svg class="eq-arrows"/, `${phase} shows arrows`);
    });
    const exploded = renderStage(fire(), { phase: PHASE_EXPLODED });
    assert.match(exploded, /<div class="eq-pieces" data-role="pieces"><svg class="eq-arrows"/);
    assert.match(exploded, /<svg class="eq-arrows"[^>]*aria-hidden="true"/, "arrows are decoration to a screen reader");
  });

  it("20h. the chosen part's arrow comes forward and the rest step back", () => {
    const none = renderExplodeArrows(fire());
    assert.ok(!none.includes("eq-arrow--on") && !none.includes("eq-arrow--dim"));

    const html = renderStage(fire(), { phase: PHASE_EXPLODED, selected: "hose" });
    assert.match(html, /class="eq-arrow eq-arrow--on" data-arrow="hose"/);
    assert.strictEqual((html.match(/eq-arrow--dim/g) || []).length, 5);

    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    const on = Number(css.match(/\.eq-arrow--on \{\s*opacity:\s*([\d.]+)/)[1]);
    const dim = Number(css.match(/\.eq-arrow--dim \{\s*opacity:\s*([\d.]+)/)[1]);
    const rest = Number(css.match(/\[data-parts="out"\] \.eq-arrow \{\s*opacity:\s*([\d.]+)/)[1]);
    assert.ok(dim < rest && rest < on, "selection must re-rank the arrows");
  });

  it("20i. the arrows draw out with the plates and wind back in", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8");
    assert.match(css, /\.eq-arrow__line \{[^}]*stroke-dashoffset: 1;[^}]*transition: stroke-dashoffset 440ms/);
    assert.match(css, /\[data-parts="out"\] \.eq-arrow__line \{\s*stroke-dashoffset: 0;/);
    // the draw is one dash as long as the whole path, so a drawn line is solid
    assert.match(renderExplodeArrows(fire()), /<path class="eq-arrow__line"[^>]*pathLength="1"/);

    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduced, /\.eq-arrow__line \{\s*stroke-dasharray: none;\s*stroke-dashoffset: 0;\s*transition: none;/);
    assert.ok(reduced.includes(".eq-arrow,"), "arrows must only fade under reduced motion");
  });

  it("20j. the live DOM keeps the arrow state in step with the selection", () => {
    const src = fs.readFileSync(path.join(FRONTEND, "prerequisite/detail.js"), "utf8");
    const apply = src.slice(src.indexOf("function _applyState"), src.indexOf("function openEquipmentDetail"));
    assert.ok(apply.includes('[data-arrow="${component.id}"]'));
    assert.ok(apply.includes("eq-arrow--on") && apply.includes("eq-arrow--dim"));
  });
});

describe("21. no dotted or dashed lines in the familiarization UI", () => {
  it("21a. no dotted or dashed border, outline or underline anywhere in the stylesheet", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\b(dotted|dashed)\b/.test(css), "a dotted or dashed line is still in prerequisite.css");
  });

  it("21b. the only dash pattern is the arrow draw, which is solid once drawn", () => {
    const css = fs.readFileSync(path.join(FRONTEND, "css/prerequisite.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const patterns = [...css.matchAll(/stroke-dasharray:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.deepStrictEqual([...new Set(patterns)].sort(), ["1 1", "none"]);
    const leader = css.slice(css.indexOf(".eq-leader {"), css.indexOf(".eq-leader__anchor"));
    assert.ok(!leader.includes("dasharray"), "the assembled leader lines must be solid");
  });

  it("21c. no rendered markup carries a dashed style", () => {
    const fire = getEquipmentById(EXTINGUISHER);
    [PHASE_ZOOM, PHASE_ASSEMBLED, PHASE_EXPLODED].forEach((phase) => {
      const html = renderDetailHtml(fire.id, { phase, callouts: phase === PHASE_ASSEMBLED });
      assert.ok(!/dashed|dotted|stroke-dasharray/.test(html), `${phase} renders a dashed line`);
    });
    assert.ok(!/dashed|dotted/.test(renderSelectionPanel(fire, null)));
  });
});

describe("22. the loading screen, and the logo it carries", () => {
  const BRAND_DIR = path.join(FRONTEND, "assets/brand");
  const readCss = (file) => fs.readFileSync(path.join(FRONTEND, "css", file), "utf8");

  // width and height out of a png's IHDR, so the test reads the real file rather
  // than trusting a number written next to it
  const pngSize = (file) => {
    const head = fs.readFileSync(file).subarray(0, 24);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  };

  it("22a. the supplied logo ships untouched, and what renders is a crop of it", () => {
    const source = path.join(BRAND_DIR, "safear-logo-source.png");
    const derived = path.join(BRAND_DIR, "safear-logo.png");
    assert.ok(fs.existsSync(source), "the supplied logo must be kept as the source of truth");
    assert.ok(fs.existsSync(derived), "the app needs a rendered logo");

    // the supplied file, exactly as it arrived
    assert.deepStrictEqual(pngSize(source), { width: 512, height: 156 });

    // the derived one is the same image with its white margin cropped off: smaller
    // in both directions, and the ink's own proportions kept to within a percent
    const cut = pngSize(derived);
    assert.deepStrictEqual(cut, BRAND_LOGO_SIZE, "BRAND_LOGO_SIZE must match the file on disk");
    assert.ok(cut.width < 512 && cut.height < 156, "the derived asset must be a crop, never an upscale");
    assert.ok(Math.abs(cut.width / cut.height - 471 / 112) < 0.01);
  });

  it("22b. one logo in the product, and no stand-in for it anywhere", () => {
    assert.strictEqual(SPLASH_LOGO, "./assets/brand/safear-logo.png");
    assert.strictEqual(BRAND_LOGO, SPLASH_LOGO, "the two screens must render the same file");

    const html = renderSplashHtml() + renderLanguageHtml("en");
    // the shield emoji the screens used before the real logo existed
    assert.ok(!html.includes("128737"), "the emoji shield must not stand in for the logo");
    assert.ok(!html.includes("lang-brand__name"), "the product name must not stand in for the logo");

    // never stretched: a width is set in css, the height follows the file
    const css = readCss("prerequisite.css");
    const logoRules = [
      css.slice(css.indexOf(".splash__logo {"), css.indexOf(".splash__tagline {")),
      css.slice(css.indexOf(".lang-brand__logo {"), css.indexOf(".lang-brand__mark {"))
    ];
    logoRules.forEach((rule) => {
      assert.match(rule, /height: auto/, "the logo must keep its own proportions");
      assert.ok(!/object-fit|transform: scale|height:\s*[0-9]/.test(rule), "the logo must not be scaled or cropped by css");
    });
  });

  it("22c. the loading screen renders the mark, a tagline and honest progress", () => {
    setLocale("en");
    const html = renderSplashHtml();

    assert.match(html, /<img class="splash__logo"[^>]*src="\.\/assets\/brand\/safear-logo\.png"/);
    assert.match(html, /<img class="splash__logo"[^>]*alt="[^"]+"/, "the mark needs an accessible name");
    // the box is reserved before the file lands, so the screen does not jump
    assert.match(html, /width="471" height="112"/);

    assert.ok(html.includes(t("app.tagline", {}, "")), "the tagline must be a translated string");
    assert.ok(html.includes(t("app.splash_loading", {}, "")));
    assert.ok(html.includes("splash__fill"), "there must be a progress treatment");
    assert.ok(!/spinner|spin/.test(html));
  });

  it("22d. it holds for about two and a half seconds, and less when motion is reduced", () => {
    assert.ok(SPLASH_HOLD_MS >= 2000 && SPLASH_HOLD_MS <= 3000, "the hold must be 2-3 seconds");

    const normal = splashTimings(false);
    const reduced = splashTimings(true);
    assert.strictEqual(normal.hold, SPLASH_HOLD_MS);
    assert.strictEqual(reduced.hold, SPLASH_REDUCED_MS);
    assert.ok(reduced.hold < normal.hold, "reduced motion must not mean a longer wait");
    assert.strictEqual(reduced.exit, 0, "there is no fade to wait for when nothing fades");
  });

  it("22e. the app starts even if the timers never fire", () => {
    // node has no window, which is also what a phone looks like if setTimeout is
    // gone: the handover must still happen, exactly once
    let started = 0;
    const container = { innerHTML: "", querySelector: () => null };
    const handle = mountSplashScreen({ container, onDone: () => { started += 1; } });

    assert.strictEqual(started, 1, "the first screen must be reached");
    handle.finish();
    assert.strictEqual(started, 1, "and reached only once");
  });

  it("22f. the loading screen is not a step in the flow", () => {
    // the worker's journey is unchanged: the loading screen is what the app shows
    // while it comes up, so it gates nothing and cannot be navigated to
    assert.deepStrictEqual(SCREEN_ORDER, ["language", "prerequisite", "modules", "training"]);

    const src = fs.readFileSync(path.join(FRONTEND, "js/app.js"), "utf8");
    const flow = src.slice(src.indexOf("function startScreenFlow"));
    assert.ok(flow.includes("mountSplashScreen"), "the flow must open on the loading screen");
    assert.match(flow, /onDone: \(\) => resolve\(showScreen\("language"\)\)/, "and hand over to the screen it always did");
  });

  it("22g. nothing on the loading screen loops, and reduced motion stops it moving", () => {
    const css = readCss("prerequisite.css");
    const block = css.slice(css.indexOf(".splash {"), css.indexOf("/* ---------- language picker"));

    assert.ok(!/infinite|alternate/.test(block), "the loading screen must not loop");
    assert.ok(!/@keyframes/.test(block), "its entrance is a class, so reduced motion can switch it off");
    assert.match(block, /env\(safe-area-inset-top/, "it must clear the status bar");
    assert.match(block, /env\(safe-area-inset-bottom/, "and the gesture bar");

    const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
    [".splash", ".splash__plate", ".splash__tagline", ".splash__fill"].forEach((selector) => {
      assert.ok(reduced.includes(selector), `${selector} must be covered by reduced motion`);
    });
    assert.match(reduced, /transition: none/);
  });

  it("22h. the palette comes from the logo, and the blue-slate one is gone", () => {
    const style = readCss("style.css");
    const tokens = style.slice(style.indexOf(":root {"), style.indexOf("* {"));

    // the two values sampled out of the supplied file
    assert.match(tokens, /--brand-navy: #01172e;/);
    assert.match(tokens, /--brand-yellow: #febc04;/);
    assert.match(tokens, /--color-primary: var\(--brand-yellow\);/, "yellow is the action colour");
    assert.match(tokens, /--color-on-primary: var\(--brand-navy\);/, "and navy is what sits on it");

    // the ground is neutral: no channel may lean blue the way #0f172a did
    const ground = tokens.match(/--color-bg: #([0-9a-f]{6});/)[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(ground.slice(i, i + 2), 16));
    assert.ok(b - r <= 6 && b - g <= 6, `the ground still leans blue: #${ground}`);

    // and the old palette is not still hiding in the UI. the equipment illustrations
    // further down prerequisite.css are excluded on purpose: those hexes are paint
    // for drawn objects — a black rubber strap, a dark vent — not chrome.
    const screens = readCss("prerequisite.css");
    const all = style + screens.slice(0, screens.indexOf("/* ---------- equipment art palette"));
    ["#0f172a", "#1e293b", "#f59e0b", "#94a3b8", "#33445e", "#263449"].forEach((hex) => {
      assert.ok(!all.includes(hex), `${hex} is left over from the blue-slate palette`);
    });
  });

  it("22i. the screens share one palette instead of keeping a second one", () => {
    const css = readCss("prerequisite.css");
    const tokens = css.slice(css.indexOf(":root {"), css.indexOf("#app.screen-mode"));
    assert.match(tokens, /--eq-surface-raised: var\(--color-surface-raised\);/);
    assert.match(tokens, /--eq-line: var\(--color-line\);/);
  });

  it("22j. the new strings are translated where they can be, and flagged where they cannot", () => {
    ["app.tagline", "app.splash_loading"].forEach((key) => {
      ["en", "hi"].forEach((locale) => {
        const dict = JSON.parse(fs.readFileSync(path.join(FRONTEND, `locales/${locale}.json`), "utf8"));
        const value = key.split(".").reduce((node, part) => node && node[part], dict);
        assert.ok(value && value.trim().length > 0, `${key} is missing from ${locale}`);
      });
      // santali has neither yet, so both are declared pending rather than shown as
      // santali. the manifest test next door checks the file on disk agrees.
      assert.ok(SAT_PENDING_KEYS.has(key), `${key} must be tracked as pending for santali`);
      assert.strictEqual(isTranslationPending("sat", key), true);
    });

    const en = JSON.parse(fs.readFileSync(path.join(FRONTEND, "locales/en.json"), "utf8"));
    assert.ok(en.app.tagline.length <= 40, "the tagline must stay short enough to read at a glance");
  });

  it("22k. the logo is on the phone underground, and the source file is not shipped", () => {
    const sw = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
    assert.ok(sw.includes(`"${SPLASH_LOGO}"`), "the rendered logo must be precached");
    assert.ok(sw.includes('"./screens/splash.js"'), "so must the screen that draws it");
    assert.ok(!sw.includes("safear-logo-source.png"), "the source file is not something a phone needs");
  });
});

describe("23. recordStageResult keeps best score and never un-passes", () => {
  beforeEach(() => {
    resetPrerequisite(WORKER);
  });

  // pass 85% then retake 60% stays at 85%
  it("23a. retake with lower score keeps old best", () => {
    recordStageResult(WORKER, "fire-response", 2, 0.85);
    const first = getStageProgress(WORKER, "fire-response", 2);
    assert.strictEqual(first.score, 0.85);
    assert.strictEqual(first.passed, true);
    const firstAt = first.completedAt;
    assert.ok(firstAt, "first pass has a completedAt");

    recordStageResult(WORKER, "fire-response", 2, 0.60);
    const second = getStageProgress(WORKER, "fire-response", 2);
    assert.strictEqual(second.score, 0.85, "score must not drop");
    assert.strictEqual(second.passed, true, "must stay passed");
    assert.strictEqual(second.completedAt, firstAt, "completedAt of first pass preserved");
    assert.strictEqual(isStage2Passed(WORKER, "fire-response"), true);
  });

  // pass 50% then retake 90% updates to 90%
  it("23b. retake with higher score updates to new best", () => {
    recordStageResult(WORKER, "fire-response", 2, 0.50);
    const first = getStageProgress(WORKER, "fire-response", 2);
    assert.strictEqual(first.score, 0.50);
    assert.strictEqual(first.passed, false);
    assert.strictEqual(first.completedAt, null, "failing attempt has no completedAt");

    recordStageResult(WORKER, "fire-response", 2, 0.90);
    const second = getStageProgress(WORKER, "fire-response", 2);
    assert.strictEqual(second.score, 0.90, "score updates to higher value");
    assert.strictEqual(second.passed, true);
    assert.ok(second.completedAt, "passing attempt now has completedAt");
  });

  // once passed never reverts even with zero
  it("23c. once passed stays passed even with score 0", () => {
    recordStageResult(WORKER, "fire-response", 2, 0.85);
    recordStageResult(WORKER, "fire-response", 2, 0.0);
    const result = getStageProgress(WORKER, "fire-response", 2);
    assert.strictEqual(result.score, 0.85);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(isStage2Passed(WORKER, "fire-response"), true);
  });

  // different modules keep independent scores
  it("23d. different modules keep independent best scores", () => {
    recordStageResult(WORKER, "fire-response", 2, 0.90);
    recordStageResult(WORKER, "gas-leak", 2, 0.70);
    recordStageResult(WORKER, "fire-response", 2, 0.60);

    const fire = getStageProgress(WORKER, "fire-response", 2);
    const gas = getStageProgress(WORKER, "gas-leak", 2);
    assert.strictEqual(fire.score, 0.90, "fire keeps its own best");
    assert.strictEqual(gas.score, 0.70, "gas keeps its own best");
  });
});

