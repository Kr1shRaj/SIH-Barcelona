import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, "..");

// mock document for a-frame DOM entity generation
const _elements = {};
function _makeEl(tag) {
  const el = {
    tag,
    id: "",
    className: "",
    attributes: {},
    children: [],
    innerHTML: "",
    setAttribute(key, val) {
      this.attributes[key] = val;
      if (key === "id") this.id = val;
      if (key === "class") this.className = val;
    },
    getAttribute(key) {
      return this.attributes[key];
    },
    appendChild(child) {
      this.children.push(child);
      if (child && child.id) _elements[child.id] = child;
    },
    querySelector(sel) {
      if (sel.startsWith("#")) {
        const id = sel.slice(1);
        if (this.id === id) return this;
        for (const c of this.children) {
          if (c.id === id) return c;
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    }
  };
  return el;
}

globalThis.document = {
  createElement(tag) {
    return _makeEl(tag);
  },
  getElementById(id) {
    return _elements[id] || null;
  }
};

import {
  buildFireEntity,
  buildExitEntity,
  buildExtinguisherEntity,
  buildFireClusterEntity,
  buildFireAlarmEntity
} from "../modules/fire-response/graphics.js";

describe("Phase 2 — 3D Asset Integration & Clustered Fire", () => {
  it("verifies all required GLB asset files exist on disk", () => {
    const requiredModels = [
      "animated_fire.glb",
      "fire_extinguisher.glb",
      "low_poly_green_running_man_exit_sign.glb",
      "notifier_rsg_t-bar_fire_alarm_pull_station.glb"
    ];

    for (const modelName of requiredModels) {
      const fullPath = path.join(FRONTEND_DIR, "assets", "models", modelName);
      assert.ok(fs.existsSync(fullPath), `Asset must exist: ${modelName}`);
      const stats = fs.statSync(fullPath);
      assert.ok(stats.size > 10000, `Asset ${modelName} must have valid non-trivial size`);
    }
  });

  it("confirms electrical breaker panel model exists but is unused in fire flow", () => {
    const breakerPath = path.join(FRONTEND_DIR, "..", "3D_MODELS", "electrical_breaker_panel_box__lp_model.glb");
    assert.ok(fs.existsSync(breakerPath), "Breaker model exists in 3D_MODELS");
    // verify graphics.js does not load breaker box
    const graphicsCode = fs.readFileSync(path.join(FRONTEND_DIR, "modules", "fire-response", "graphics.js"), "utf8");
    assert.ok(!graphicsCode.includes("electrical_breaker_panel_box"), "Breaker box is unused in fire flow");
  });

  it("buildFireClusterEntity creates 5 varied animated fire instances", () => {
    const cluster = buildFireClusterEntity();
    assert.strictEqual(cluster.id, "fire-cluster");
    assert.ok(cluster.innerHTML.includes("animated_fire.glb"), "Cluster must use animated_fire.glb");
    assert.ok(cluster.innerHTML.includes("fire-instance-1"));
    assert.ok(cluster.innerHTML.includes("fire-instance-5"));
    // check rotation variation
    assert.ok(cluster.innerHTML.includes('rotation="0 0 0"'));
    assert.ok(cluster.innerHTML.includes('rotation="0 45 0"'));
    assert.ok(cluster.innerHTML.includes('rotation="0 110 0"'));
    assert.ok(cluster.innerHTML.includes('rotation="0 230 0"'));
    assert.ok(cluster.innerHTML.includes('rotation="0 160 0"'));
    // check scale variation
    assert.ok(cluster.innerHTML.includes('scale="1 1 1"') || cluster.innerHTML.includes('scale="1.0 1.0 1.0"'));
    assert.ok(cluster.innerHTML.includes("0.85"));
    assert.ok(cluster.innerHTML.includes("1.25"));
  });

  it("buildFireEntity attaches fire cluster, scorch decal, embers and reticle", () => {
    const fire = buildFireEntity();
    assert.strictEqual(fire.id, "fire-graphic");
    assert.strictEqual(fire.getAttribute("data-raycast-target"), "fire");
    assert.ok(fire.innerHTML.includes("floor-scorch-decal"), "Floor scorch decal must exist");
    assert.ok(fire.innerHTML.includes("fire-target-base"), "Aim collision cylinder must exist");
    assert.ok(fire.innerHTML.includes("fire-embers"), "Embers must exist");
    // aim reticle child must be attached
    const aimReticle = fire.children.find((c) => c.id === "aim-reticle");
    assert.ok(aimReticle, "Aim reticle must be appended as child");
    assert.strictEqual(aimReticle.getAttribute("data-raycast-target"), "aim");
  });

  it("buildExitEntity uses low poly green running man exit sign glb", () => {
    const exit = buildExitEntity();
    assert.strictEqual(exit.id, "exit-graphic");
    assert.ok(exit.innerHTML.includes("low_poly_green_running_man_exit_sign.glb"), "Exit entity must load GLB model");
    assert.ok(!exit.innerHTML.includes("exit-board"), "Primitive box exit-board replaced with GLB");
  });

  it("buildExtinguisherEntity uses 3D extinguisher glb while preserving interactive targets", () => {
    const ext = buildExtinguisherEntity();
    assert.strictEqual(ext.id, "extinguisher-graphic");
    assert.ok(ext.innerHTML.includes("fire_extinguisher.glb"), "Extinguisher must load GLB model");
    assert.ok(!ext.innerHTML.includes("ext-body"), "Primitive cylinder ext-body replaced with GLB");

    // verify interactive children remain attached
    const pin = ext.children.find((c) => c.id === "extinguisher-pin");
    assert.ok(pin, "extinguisher-pin child must be attached");
    assert.strictEqual(pin.getAttribute("data-raycast-target"), "pin");

    const handle = ext.children.find((c) => c.id === "extinguisher-handle");
    assert.ok(handle, "extinguisher-handle child must be attached");
    assert.strictEqual(handle.getAttribute("data-raycast-target"), "handle");

    const guideArrow = ext.children.find((c) => c.id === "extinguisher-guide-arrow");
    assert.ok(guideArrow, "extinguisher-guide-arrow child must be attached");

    const progress = ext.children.find((c) => c.id === "extinguisher-pin-progress");
    assert.ok(progress, "extinguisher-pin-progress child must be attached");
  });

  it("buildFireAlarmEntity creates pull station with 3D model and touch hit box", () => {
    const alarm = buildFireAlarmEntity();
    assert.strictEqual(alarm.id, "fire-alarm-station");
    assert.strictEqual(alarm.getAttribute("data-raycast-target"), "alarm");
    assert.ok(alarm.innerHTML.includes("notifier_rsg_t-bar_fire_alarm_pull_station.glb"), "Alarm must load GLB model");
    assert.ok(alarm.innerHTML.includes("fire-alarm-hit-box"), "Touch hit box must exist");
  });
});
