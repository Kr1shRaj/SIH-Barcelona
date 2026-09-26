import { describe, it } from "node:test";
import assert from "node:assert";

// canvas + sprite capable three mock, so vfx layers actually build here
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Obj {
  constructor() {
    this.children = [];
    this.position = new V3();
    this.rotation = new V3();
    this.scale = new V3(1, 1, 1);
    this.visible = true;
    this.userData = {};
  }
  add(o) { this.children.push(o); }
  getObjectByName(name) {
    for (const c of this.children) {
      if (c.name === name) return c;
      const f = c.getObjectByName && c.getObjectByName(name);
      if (f) return f;
    }
    return null;
  }
}
class Mat {
  constructor(o = {}) {
    Object.assign(this, o);
    this.opacity = o.opacity ?? 1;
    this.color = { setRGB(r, g, b) { this.rgb = [r, g, b]; } };
  }
  clone() { return new Mat(this); }
}
class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m || new Mat(); } }
class Geo {}
class BufferGeometry { setAttribute(k, a) { this.attributes = { [k]: a }; } getAttribute(k) { return this.attributes[k]; } }
class BufferAttribute { constructor(array) { this.array = array; } }
class Tex { constructor() { this.repeat = new V3(); this.offset = new V3(); } }
class Obj3D { constructor() { this.position = new V3(); this.scale = new V3(1, 1, 1); this.matrix = null; } updateMatrix() { this.matrix = { p: { ...this.position }, s: { ...this.scale } }; } }
class PlaneGeo extends Geo { translate(x, y, z) { this.t = [x, y, z]; return this; } }
class ShaderMat extends Mat {}
class InstancedMesh extends Mesh {
  constructor(g, m, count) { super(g, m); this.count = count; this.matrices = []; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt(i, m) { this.matrices[i] = m; }
}

globalThis.document = {
  createElement(tag) {
    if (tag !== "canvas") return { style: {} };
    return {
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
          putImageData(img) { this.lastImage = img; }
        };
      }
    };
  }
};
globalThis.window = {
  THREE: {
    Group: Obj, Mesh, Sprite: Mesh, Points: Mesh,
    MeshBasicMaterial: Mat, MeshStandardMaterial: Mat, SpriteMaterial: Mat, PointsMaterial: Mat,
    PlaneGeometry: PlaneGeo, CircleGeometry: Geo, InstancedMesh, ShaderMaterial: ShaderMat, Object3D: Obj3D, ConeGeometry: Geo, CylinderGeometry: Geo,
    SphereGeometry: Geo, BoxGeometry: Geo, RingGeometry: Geo, TorusGeometry: Geo,
    BufferGeometry, BufferAttribute, CanvasTexture: Tex, PointLight: Obj,
    AdditiveBlending: 2, NormalBlending: 1, DoubleSide: 2, RepeatWrapping: 1000
  }
};

const {
  createSeededRandom, fireFlickerWave, calcSprayScaleZ, calcRouteStripLayout,
  createFireMesh, animateFireMesh, createAlarmStationMesh, animateAlarmStationMesh,
  triggerAlarmPullVisual, ALARM_PULL_PAYOFF_MS, createConfettiBurst, animateConfettiBurst,
  createRouteChevronStrip, layoutRouteChevronStrip, scrollRouteChevronStrip,
  createExtinguisherMesh, createFlameField, setFireAirflow, SMOKE_CEILING_M
} = await import("../ar/webxr_render.js");
const { renderGasGaugeSvg } = await import("../modules/fire-response/decision.js");
const { gasChirpFrequency, vibrate, playTone, startFireAudio, FIRE_BED_GAIN, NARRATION_DUCK } = await import("../js/sfx.js");

// run animateFireMesh for ms in 16ms frames
function run(group, ms) {
  for (let t = 0; t < ms; t += 16) animateFireMesh(group, 16);
}

describe("fire vfx math", () => {
  it("seeded random replays the same sequence", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = [a(), a(), a()];
    assert.deepStrictEqual(seqA, [b(), b(), b()]);
    assert.ok(seqA.every((v) => v >= 0 && v < 1));
  });

  it("flicker wave stays bounded and does not repeat on the single-sine period", () => {
    for (let t = 0; t < 20000; t += 37) assert.ok(Math.abs(fireFlickerWave(t)) <= 1.1 + 1e-9);
    const period = (2 * Math.PI) / 0.045;
    assert.ok(Math.abs(fireFlickerWave(1000) - fireFlickerWave(1000 + period)) > 0.05);
  });

  it("spray stretches from world distance through extinguisher scale", () => {
    // 1.2m to fire, extinguisher scaled 0.35: needs 3.43 local units of a 2.2 cone
    assert.ok(Math.abs(calcSprayScaleZ(1.2, 0.35) - 1.2 / 0.35 / 2.2) < 1e-9);
    assert.strictEqual(calcSprayScaleZ(0.1, 1), 0.5);
    assert.strictEqual(calcSprayScaleZ(100, 0.35), 8);
  });

  it("route strip starts 0.8m from feet and points at the exit", () => {
    const lay = calcRouteStripLayout({ x: 0, z: 0 }, { x: 0, z: -5 });
    assert.ok(Math.abs(lay.length - 4.2) < 1e-9);
    assert.ok(Math.abs(lay.center.z - -2.9) < 1e-9);
    assert.ok(Math.abs(lay.yaw) < 1e-9, "facing -z needs no yaw");
    assert.strictEqual(calcRouteStripLayout({ x: 0, z: 0 }, { x: 0, z: -1 }), null, "too close for a route");
  });

  it("chirp pitch climbs with gas reading", () => {
    assert.ok(gasChirpFrequency(7) > gasChirpFrequency(2));
    assert.strictEqual(gasChirpFrequency(50), gasChirpFrequency(10));
  });

  it("sound and haptics are silent no-ops without browser apis", () => {
    assert.strictEqual(playTone({ freq: 440 }), false);
    assert.strictEqual(vibrate(10), false);
  });
});

describe("fire vfx scene", () => {
  it("fire gets shadow, glow, residue, smoke, embers, impact and steam layers that ignore raycasts", () => {
    const fire = createFireMesh();
    const { vfx } = fire.userData;
    for (const k of ["shadow", "glow", "residue", "smoke", "embers", "impact", "steam", "ceiling"]) {
      assert.ok(vfx[k], `missing ${k}`);
      assert.strictEqual(typeof vfx[k].raycast, "function", `${k} must opt out of raycasts`);
    }
  });

  it("smoke and glow die down as the fire is put out; residue builds up", () => {
    const fire = createFireMesh();
    fire.scale.set(0.35, 0.35, 0.35);
    const { vfx } = fire.userData;
    run(fire, 500);
    const liveSmoke = Math.max(...vfx.smoke.children.map((s) => s.material.opacity));
    assert.ok(liveSmoke > 0, "burning fire smokes");
    assert.ok(vfx.glow.material.opacity > 0);

    fire.userData.extinguishProgress = 0.5;
    run(fire, 16);
    assert.ok(Math.abs(vfx.residue.material.opacity - 0.325) < 1e-9);

    fire.userData.extinguishProgress = 1;
    run(fire, 4000);
    assert.ok(vfx.smoke.children.every((s) => !s.visible || s.material.opacity === 0), "no smoke after fire is out");
    assert.strictEqual(vfx.glow.material.opacity, 0);
  });

  it("steam bursts once at full extinguish and clears after 1.5s", () => {
    const fire = createFireMesh();
    fire.userData.extinguishProgress = 1;
    run(fire, 32);
    assert.strictEqual(fire.userData.vfx.steam.visible, true);
    run(fire, 1600);
    assert.strictEqual(fire.userData.vfx.steam.visible, false);
  });

  it("spray impact splash shows only while powder is hitting a live fire", () => {
    const fire = createFireMesh();
    run(fire, 16);
    assert.strictEqual(fire.userData.vfx.impact.visible, false);
    fire.userData.sprayHitting = true;
    run(fire, 16);
    assert.strictEqual(fire.userData.vfx.impact.visible, true);
  });

  it("one instanced flame field carries the fire: no glb, core plus ring of tongues, never culled", () => {
    const field = createFlameField();
    assert.strictEqual(field.name, "fire-flame-field");
    assert.strictEqual(field.count, 24);
    assert.strictEqual(field.matrices.length, 24);
    assert.strictEqual(field.instanceMatrix.needsUpdate, true);
    assert.strictEqual(field.frustumCulled, false, "billboards move in the shader");
    assert.strictEqual(typeof field.raycast, "function", "flames never steal the aim ray");
    const heights = field.matrices.map((m) => m.s.y);
    assert.ok(Math.min(...heights.slice(0, 6)) > Math.max(...heights.slice(6)), "core tongues stand taller than the ring");
    const u = field.material.uniforms;
    assert.ok(u.uNoise.value, "flames sample the seeded noise texture");
    assert.match(field.material.fragmentShader, /texture2D\(uNoise/);
  });

  it("the fire mesh uses the flame field and hides the fallback cones", () => {
    const fire = createFireMesh();
    assert.ok(fire.getObjectByName("fire-flame-field"));
    assert.strictEqual(fire.getObjectByName("fire-outer-cone").visible, false);
  });

  it("flames burn out with extinguish progress and lean downwind in world space", () => {
    const fire = createFireMesh();
    setFireAirflow(fire, "intake_left");
    run(fire, 100);
    const u = fire.getObjectByName("fire-flame-field").material.uniforms;
    assert.ok(u.uTime.value > 0, "shader clock runs");
    assert.strictEqual(u.uStrength.value, 1);
    assert.ok(Math.abs(u.uWind.value.x - 1) < 1e-9, "intake on the left blows toward +x");

    // a fire turned half round leans the other way in the world
    fire.rotation.y = Math.PI;
    run(fire, 16);
    assert.ok(Math.abs(u.uWind.value.x + 1) < 1e-9);

    fire.userData.extinguishProgress = 1;
    run(fire, 16);
    assert.strictEqual(u.uStrength.value, 0);
  });

  it("roof smoke is invisible at first, thickens and creeps down while the fire burns, lingers after", () => {
    const fire = createFireMesh();
    const ceiling = fire.userData.vfx.ceiling;
    run(fire, 16);
    assert.ok(ceiling.children.every((m) => m.material.opacity < 0.01), "no roof smoke the moment it starts");
    const startY = ceiling.position.y;
    assert.ok(Math.abs(startY - SMOKE_CEILING_M) < 0.01, "layer starts at the roof");

    run(fire, 60000);
    const thick = ceiling.children[0].material.opacity;
    assert.ok(thick > 0.5, "a minute of burning fills the roof");
    assert.ok(ceiling.position.y < startY, "and the layer has crept down");

    fire.userData.extinguishProgress = 1;
    run(fire, 2000);
    const after = ceiling.children[0].material.opacity;
    assert.ok(after > 0 && after < thick, "smoke thins slowly after the fire is out, it does not vanish");
  });

  it("embers are carried downwind as they age", () => {
    const calm = createFireMesh();
    const windy = createFireMesh();
    setFireAirflow(windy, "intake_left");
    run(calm, 800);
    run(windy, 800);
    const meanX = (f) => {
      const arr = f.userData.vfx.embers.geometry.getAttribute("position").array;
      let sum = 0;
      for (let i = 0; i < arr.length; i += 3) sum += arr[i];
      return sum / (arr.length / 3);
    };
    assert.ok(meanX(windy) > meanX(calm) + 0.1, "embers drift toward +x with fresh air from the left");
  });

  it("extinguisher carries a contact shadow", () => {
    assert.ok(createExtinguisherMesh().getObjectByName("contact-shadow"));
  });

  it("alarm pull drops lever ~20 deg, strobes for the payoff window, turns ring green", () => {
    const alarm = createAlarmStationMesh();
    triggerAlarmPullVisual(alarm);
    for (let t = 0; t < 250; t += 16) animateAlarmStationMesh(alarm, 16);
    assert.ok(Math.abs(alarm.getObjectByName("alarm-pull-bar").rotation.x - -0.35) < 1e-9);
    assert.strictEqual(alarm.getObjectByName("alarm-strobe").visible, true);
    assert.ok(alarm.getObjectByName("alarm-pulse-ring").material.color.rgb, "ring recoloured");
    for (let t = 0; t < ALARM_PULL_PAYOFF_MS; t += 16) animateAlarmStationMesh(alarm, 16);
    assert.strictEqual(alarm.getObjectByName("alarm-strobe").visible, false);
  });

  it("route strip lays out and scrolls toward the exit", () => {
    const strip = createRouteChevronStrip();
    const lay = layoutRouteChevronStrip(strip, { x: 0, z: 0 }, { x: 0, z: -4 }, 0);
    assert.ok(lay && strip.visible);
    assert.ok(Math.abs(strip.scale.y - 3.2) < 1e-9);
    const before = strip.material.map.offset.y;
    scrollRouteChevronStrip(strip, 100);
    assert.ok(strip.material.map.offset.y < before);
  });

  it("confetti burst finishes and reports done", () => {
    const burst = createConfettiBurst(30);
    assert.strictEqual(burst.children.length, 30);
    assert.strictEqual(animateConfettiBurst(burst, 16), true);
    let alive = true;
    for (let t = 0; t < 2000 && alive; t += 16) alive = animateConfettiBurst(burst, 16);
    assert.strictEqual(alive, false);
  });
});

describe("gas gauge motion", () => {
  it("needle sweeps from zero while final angle stays in the markup; active arc glows", () => {
    // 0-5% dial over 240 deg: 1.8% sits at -33.6 deg, so the sweep starts 86.4 deg back at 0%
    const high = renderGasGaugeSvg(1.8);
    assert.ok(high.includes("gauge-needle-sweep"));
    assert.ok(high.includes("--needle-from:-86.4deg"), "sweep starts at 0% position");
    assert.ok(high.includes("gauge-arc-danger-pulse"), "danger arc pulses at or above the 1.25% withdrawal limit");
    const low = renderGasGaugeSvg(0.6);
    assert.ok(!low.includes("gauge-arc-danger-pulse"));
    assert.strictEqual((low.match(/url\(#gauge-arc-glow\)/g) || []).length, 1, "only the active arc glows");
  });
});

describe("fire soundscape", () => {
  // just enough web audio to build the graph and read the levels it asks for
  function fakeAudio() {
    const param = () => ({ value: 0, target: null, setTargetAtTime(v) { this.target = v; }, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = (extra = {}) => ({ connect() {}, ...extra });
    const made = { sources: [], filters: [], gains: [] };
    class Ctx {
      constructor() { this.sampleRate = 8000; this.currentTime = 0; this.state = "running"; this.destination = node(); }
      createBuffer(ch, len) { const data = new Float32Array(len); return { getChannelData: () => data, data }; }
      createBufferSource() { const s = node({ start() { this.started = true; }, stop() { this.stopped = true; } }); made.sources.push(s); return s; }
      createBiquadFilter() { const f = node({ frequency: param(), Q: param() }); made.filters.push(f); return f; }
      createGain() { const g = node({ gain: param() }); made.gains.push(g); return g; }
      createOscillator() { return node({ frequency: param(), start() {}, stop() {} }); }
    }
    return { Ctx, made };
  }

  it("builds roar, hiss and crackle from seeded noise, ducks to a quarter under narration, and stops clean", () => {
    const listeners = {};
    const { Ctx, made } = fakeAudio();
    globalThis.window.AudioContext = Ctx;
    globalThis.window.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
    globalThis.window.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); };
    const say = (playing) => (listeners["safear:narration"] || []).forEach((fn) => fn({ detail: { playing } }));

    const fire = startFireAudio();
    try {
      assert.ok(fire, "a fire bed starts when web audio exists");
      assert.deepStrictEqual(made.filters.map((f) => f.type), ["lowpass", "highpass", "bandpass"]);
      assert.ok(made.sources.every((src) => src.loop && src.started), "three looping noise voices");

      // the first gain made is the master bus every voice feeds
      const bus = made.gains[0];
      assert.strictEqual(bus.gain.target, FIRE_BED_GAIN, "full blaze, nobody talking");
      say(true);
      assert.strictEqual(fire.isDucked(), true);
      assert.ok(Math.abs(bus.gain.target - FIRE_BED_GAIN * NARRATION_DUCK) < 1e-12, "narration ducks the fire to a quarter");
      assert.strictEqual(NARRATION_DUCK, 0.25);
      say(false);
      assert.strictEqual(bus.gain.target, FIRE_BED_GAIN, "and it comes back when the narrator stops");
      fire.setIntensity(0.5);
      assert.strictEqual(bus.gain.target, FIRE_BED_GAIN * 0.5, "quieter as the fire shrinks");
    } finally {
      fire && fire.stop();
    }
    assert.ok(made.sources.every((src) => src.stopped), "stop frees every voice");
    assert.strictEqual((listeners["safear:narration"] || []).length, 0, "and stops listening for narration");
  });
});
