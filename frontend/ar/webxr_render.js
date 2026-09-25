// three.js mesh builders for tier 1 webxr rendering (no a-frame)
// uses window.THREE from already-loaded a-frame 1.3.0 bundle (r137)

// get THREE from global scope (a-frame bundles it)
function getTHREE() {
  if (typeof window !== "undefined" && window.THREE) return window.THREE;
  return null;
}

// seeded prng (mulberry32) so every vfx run replay same
function createSeededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const _vfxRand = createSeededRandom(0x5afea2);

// three sines at unrelated rates, no visible loop in flame flicker
function fireFlickerWave(tMs) {
  return 0.55 * Math.sin(tMs * 0.045) + 0.35 * Math.sin(tMs * 0.089) + 0.20 * Math.sin(tMs * 0.173);
}

const _texCache = new Map();

// draw into fresh canvas and wrap as texture, null when no canvas (tests, old webview)
function _canvasTexture(key, size, draw) {
  if (_texCache.has(key)) return _texCache.get(key);
  const THREE = getTHREE();
  if (!THREE || !THREE.CanvasTexture || typeof document === "undefined" || typeof document.createElement !== "function") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx) return null;
  canvas.width = size;
  canvas.height = size;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  _texCache.set(key, tex);
  return tex;
}

// soft round blob texture, stops = [[offset, css color], ...]
function _radialTexture(key, stops) {
  return _canvasTexture(key, 64, (ctx, n) => {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  });
}

const _TEX = {
  shadow: () => _radialTexture("shadow", [[0, "rgba(0,0,0,1)"], [0.55, "rgba(0,0,0,0.45)"], [1, "rgba(0,0,0,0)"]]),
  glow: () => _radialTexture("glow", [[0, "rgba(255,170,60,1)"], [0.35, "rgba(255,110,20,0.55)"], [1, "rgba(255,80,0,0)"]]),
  smoke: () => _radialTexture("smoke", [[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]]),
  powder: () => _radialTexture("powder", [[0, "rgba(226,232,240,1)"], [0.6, "rgba(203,213,225,0.5)"], [1, "rgba(203,213,225,0)"]]),
  green: () => _radialTexture("green", [[0, "rgba(160,255,200,1)"], [0.3, "rgba(0,230,118,0.6)"], [1, "rgba(0,230,118,0)"]]),
  red: () => _radialTexture("red", [[0, "rgba(255,220,220,1)"], [0.3, "rgba(239,68,68,0.8)"], [1, "rgba(239,68,68,0)"]])
};

// chevron arrow tile pointing up (+v), tiled along route strip
function _chevronTexture() {
  const THREE = getTHREE();
  const tex = _canvasTexture("chevron", 64, (ctx, n) => {
    ctx.clearRect(0, 0, n, n);
    ctx.strokeStyle = "rgba(0,230,118,1)";
    ctx.lineWidth = n * 0.14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(n * 0.18, n * 0.72);
    ctx.lineTo(n * 0.5, n * 0.32);
    ctx.lineTo(n * 0.82, n * 0.72);
    ctx.stroke();
  });
  if (tex && THREE && THREE.RepeatWrapping !== undefined) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

// tileable value noise, two octaves, seeded so every run looks the same.
// drives the flame alpha and the roof smoke. blank (not missing) where canvas has no pixel api
function _noiseTexture() {
  const THREE = getTHREE();
  const tex = _canvasTexture("noise", 128, (ctx, n) => {
    if (typeof ctx.createImageData !== "function") return;
    const rand = createSeededRandom(0xf1a3e);
    const octaves = [8, 16].map((cells, i) => ({
      cells,
      amp: i === 0 ? 0.65 : 0.35,
      grid: Array.from({ length: cells * cells }, () => rand())
    }));
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        octaves.forEach((o) => {
          const fx = (x / n) * o.cells;
          const fy = (y / n) * o.cells;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const sx = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0));
          const sy = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
          // wrap the lattice so the texture tiles without a seam
          const at = (i, j) => o.grid[(j % o.cells) * o.cells + (i % o.cells)];
          const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
          const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
          v += (top + (bottom - top) * sy) * o.amp;
        });
        const k = (y * n + x) * 4;
        const c = Math.round(v * 255);
        img.data[k] = c;
        img.data[k + 1] = c;
        img.data[k + 2] = c;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  if (tex && THREE && THREE.RepeatWrapping !== undefined) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

// ponytail: fixed tongue count, add a low tier (~12) if budget phones drop frames
const FLAME_TONGUES = 24;

// camera-facing quad per tongue, leaned downwind at the tips. webgl1 safe
const FLAME_VERT = `
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vPhase;
void main() {
  vUv = uv;
  vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sw = length(modelMatrix[0].xyz);
  float sx = length(instanceMatrix[0].xyz) * sw;
  float sy = length(instanceMatrix[1].xyz) * sw;
  vPhase = fract(instanceMatrix[3].x * 7.13 + instanceMatrix[3].z * 3.71);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  float h = uv.y;
  float sway = sin(uTime * 3.1 + vPhase * 6.2832) * 0.06 * h;
  vec3 lean = vec3(uWind.x, 0.0, uWind.y) * h * h * 0.45 * sy;
  vec3 world = base.xyz + right * (position.x + sway) * sx + vec3(0.0, position.y * sy, 0.0) + lean;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

// noise scrolls upward through a tongue mask; yellow-white base, orange body, deep red tips
const FLAME_FRAG = `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
varying float vPhase;
void main() {
  float h = vUv.y;
  float n = texture2D(uNoise, vec2(vUv.x * 0.8 + vPhase, h * 0.6 - uTime * 0.55)).r;
  float n2 = texture2D(uNoise, vec2(vUv.x * 1.6 - vPhase, h * 1.2 - uTime * 1.3)).r;
  float width = 0.5 - h * 0.32;
  float body = 1.0 - smoothstep(width * 0.35, width, abs(vUv.x - 0.5));
  float flame = body * (1.15 - h) + (n * 0.55 + n2 * 0.45) - 0.62;
  float a = smoothstep(0.0, 0.28, flame) * (1.0 - smoothstep(0.82, 1.0, h)) * uStrength;
  vec3 col = mix(vec3(1.0, 0.93, 0.62), vec3(1.0, 0.5, 0.1), smoothstep(0.05, 0.4, h));
  col = mix(col, vec3(0.62, 0.08, 0.02), smoothstep(0.4, 0.85, h));
  gl_FragColor = vec4(col * a, a);
}
`;

// many flame tongues in one draw call: a tall core and a ring of shorter tongues.
// null where the renderer has no instancing or shaders (tests, old webviews) — cones stay then
function createFlameField(count = FLAME_TONGUES) {
  const THREE = getTHREE();
  const noise = _noiseTexture();
  if (!THREE || !noise || !THREE.InstancedMesh || !THREE.ShaderMaterial || !THREE.Object3D || !THREE.PlaneGeometry) return null;
  const geo = new THREE.PlaneGeometry(0.5, 1.4, 1, 6);
  if (typeof geo.translate === "function") geo.translate(0, 0.7, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uWind: { value: { x: 0, y: 0 } },
      uNoise: { value: noise }
    },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "fire-flame-field";
  // vertices move in the shader, so the cpu bounds are wrong: never cull
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const core = i < 6;
    const a = _vfxRand() * Math.PI * 2;
    const r = _vfxRand() * (core ? 0.12 : 0.55);
    dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    dummy.scale.set(0.7 + _vfxRand() * 0.6, core ? 1.0 + _vfxRand() * 0.25 : 0.45 + _vfxRand() * 0.4, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return _noRaycast(mesh);
}

// ponytail: fixed roof height, calibrate per site or read a ceiling hit-test once webxr offers one
const SMOKE_CEILING_M = 2.4;
// how far the smoke layer creeps down while the fire burns, and how fast
const SMOKE_LAYER_DROP_M = 0.7;
const SMOKE_FILL_SEC = 60;
const SMOKE_DROP_SEC = 120;

// mine smoke does not rise forever: it hits the roof and spreads into a dark layer.
// two stacked sheets with noise alpha, invisible until the fire has burned a while
function createSmokeCeiling() {
  const THREE = getTHREE();
  const tex = _noiseTexture();
  if (!THREE || !tex || !THREE.PlaneGeometry) return null;
  const group = new THREE.Group();
  group.name = "fire-smoke-ceiling";
  [0, 1].forEach((layer) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({
      color: 0x15181c,
      alphaMap: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = layer * 1.3;
    mesh.position.y = -layer * 0.18;
    mesh.userData.layer = layer;
    group.add(_noRaycast(mesh));
  });
  return _noRaycast(group);
}

// thicken and lower the roof smoke with burn time, drift it downwind, thin it slowly once out
function updateSmokeCeiling(group, dtSec, burnSec, flameFactor, wind = { x: 0, z: 0 }, localPerMeter = 1) {
  if (!group) return;
  const fill = Math.min(1, burnSec / SMOKE_FILL_SEC);
  const drop = Math.min(1, burnSec / SMOKE_DROP_SEC);
  group.position.y = (SMOKE_CEILING_M - SMOKE_LAYER_DROP_M * drop) * localPerMeter;
  group.scale.set(localPerMeter, localPerMeter, localPerMeter);
  group.children.forEach((m) => {
    const target = 0.6 * fill * (m.userData.layer === 0 ? 1 : 0.7);
    m.material.opacity = flameFactor > 0.02 ? target : Math.max(0, m.material.opacity - dtSec * 0.05);
  });
  const tex = group.children[0] && group.children[0].material.alphaMap;
  if (tex && tex.offset) {
    tex.offset.x += wind.x * dtSec * 0.02;
    tex.offset.y += (wind.z * 0.02 + 0.004) * dtSec;
  }
}

// mine air pushes smoke, embers and flame tips downwind. in the fire's own frame +x is the
// worker's right at placement, so intake on the left blows toward +x
function setFireAirflow(fireGroup, airflow) {
  if (!fireGroup) return;
  let x = 0;
  if (airflow === "intake_left") x = 1;
  if (airflow === "intake_right") x = -1;
  fireGroup.userData.wind = { x, z: 0 };
}

// vfx never steal aim / tap raycasts
function _noRaycast(obj) {
  if (obj) obj.raycast = () => {};
  return obj;
}

// flat soft-textured quad lying on floor
function _floorDecal(name, tex, size, { opacity = 1, additive = false, y = 0.005 } = {}) {
  const THREE = getTHREE();
  if (!THREE || !tex || !THREE.PlaneGeometry) return null;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.name = name;
  return _noRaycast(mesh);
}

// soft dark blob under object so it sit on real floor
function createContactShadow(size = 1.0, opacity = 0.55) {
  return _floorDecal("contact-shadow", _TEX.shadow(), size, { opacity, y: 0.004 });
}

// camera-facing soft sprite
function _sprite(name, tex, color, { additive = false } = {}) {
  const THREE = getTHREE();
  if (!THREE || !tex || !THREE.Sprite || !THREE.SpriteMaterial) return null;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  }));
  sp.name = name;
  return _noRaycast(sp);
}

// group of n sprites, null if sprites not possible
function _spriteGroup(name, count, tex, color, opts) {
  const THREE = getTHREE();
  if (!THREE || !tex || !THREE.Sprite) return null;
  const group = new THREE.Group();
  group.name = name;
  for (let i = 0; i < count; i++) {
    const sp = _sprite(`${name}-${i}`, tex, color, opts);
    if (sp) group.add(sp);
  }
  return _noRaycast(group);
}

// start or restart one smoke puff at fire base
function _respawnSmoke(sp, staggered) {
  const d = sp.userData;
  d.life = 2.2 + _vfxRand() * 1.2;
  d.age = staggered ? _vfxRand() * d.life : 0;
  d.x0 = (_vfxRand() - 0.5) * 0.5;
  d.z0 = (_vfxRand() - 0.5) * 0.5;
  d.phase = _vfxRand() * Math.PI * 2;
  sp.visible = true;
}

// rising smoke column, 10 sprites
function createSmokeColumn(count = 10) {
  const group = _spriteGroup("fire-smoke", count, _TEX.smoke(), 0x2b3440);
  if (!group) return null;
  group.children.forEach((sp) => _respawnSmoke(sp, true));
  return group;
}

// move smoke puffs: rise ~0.5 m/s, drift, grow, fade; emit 0 = no new puffs
function updateSmokeColumn(group, dtSec, emit, localPerMeter = 1, wind = { x: 0, z: 0 }) {
  if (!group) return;
  group.children.forEach((sp) => {
    const d = sp.userData;
    d.age += dtSec;
    if (d.age >= d.life) {
      if (emit > 0.05) {
        _respawnSmoke(sp, false);
      } else {
        sp.visible = false;
        return;
      }
    }
    const k = d.age / d.life;
    const rise = 0.5 * localPerMeter * d.age;
    const drift = 0.12 * localPerMeter * k;
    // the column bends downwind as it rises
    const carry = 0.35 * rise;
    sp.position.set(d.x0 + Math.sin(d.age * 1.3 + d.phase) * drift + wind.x * carry, 1.3 + rise, d.z0 + Math.cos(d.age * 1.1 + d.phase) * drift + wind.z * carry);
    const sc = 0.8 + 1.7 * k;
    sp.scale.set(sc, sc, sc);
    if (sp.material) sp.material.opacity = 0.45 * Math.min(1, k * 4) * (1 - k) * emit;
  });
}

// swirling ember points, one draw call
function createEmbers(count = 48) {
  const THREE = getTHREE();
  if (!THREE || !THREE.Points || !THREE.BufferGeometry || !THREE.BufferAttribute || !THREE.PointsMaterial) return null;
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffa040,
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geo, mat);
  points.name = "fire-embers";
  points.userData.embers = Array.from({ length: count }, () => ({
    angle: _vfxRand() * Math.PI * 2,
    radius: 0.1 + _vfxRand() * 0.35,
    speed: 1.2 + _vfxRand() * 1.4,
    age: _vfxRand() * 1.6,
    life: 1.0 + _vfxRand() * 0.8
  }));
  return _noRaycast(points);
}

// rise + spiral embers, recycle at end of life; older embers are carried further downwind
function updateEmbers(points, dtSec, strength, wind = { x: 0, z: 0 }) {
  if (!points || !points.userData.embers) return;
  points.visible = strength > 0.05;
  if (!points.visible) return;
  const attr = points.geometry.getAttribute ? points.geometry.getAttribute("position") : points.geometry.attributes.position;
  const arr = attr.array;
  points.userData.embers.forEach((e, i) => {
    e.age += dtSec;
    if (e.age >= e.life) {
      e.age = 0;
      e.angle = _vfxRand() * Math.PI * 2;
    }
    e.angle += 2.2 * dtSec;
    const k = e.age / e.life;
    const rad = e.radius * (1 + k);
    arr[i * 3] = Math.cos(e.angle) * rad + wind.x * 0.8 * e.age;
    arr[i * 3 + 1] = 0.2 + e.speed * e.age;
    arr[i * 3 + 2] = Math.sin(e.angle) * rad + wind.z * 0.8 * e.age;
  });
  attr.needsUpdate = true;
  if (points.material) points.material.opacity = 0.9 * strength;
}


function createPlacementReticle() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const ring = new THREE.RingGeometry(0.12, 0.16, 32);
  ring.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85
  });
  const mesh = new THREE.Mesh(ring, mat);
  mesh.name = "placement-reticle";
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  return mesh;
}

// load glb 3d model with pivot fix and flush floor drop
function loadGLBModel(path, options = {}) {
  const THREE = getTHREE();
  if (!THREE || !THREE.GLTFLoader) {
    return Promise.reject(new Error("THREE or GLTFLoader not available"));
  }

  const {
    targetHeight = null,
    scale = 1.0,
    flushFloor = true,
    centerHorizontal = true,
    rotation = null,
    position = null,
    animOffsetSec = 0
  } = options;

  return new Promise((resolve, reject) => {
    const loader = new THREE.GLTFLoader();
    loader.load(
      path,
      (gltf) => {
        const root = gltf.scene || (gltf.scenes && gltf.scenes[0]) || gltf;
        const container = new THREE.Group();
        container.name = `${root.name || "model"}-container`;
        container.add(root);

        if (rotation) {
          if (rotation.x !== undefined) root.rotation.x = rotation.x;
          if (rotation.y !== undefined) root.rotation.y = rotation.y;
          if (rotation.z !== undefined) root.rotation.z = rotation.z;
        }

        if (typeof root.updateMatrixWorld === "function") {
          root.updateMatrixWorld(true);
        }

        if (THREE.Box3) {
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          box.getSize(size);

          let s = scale;
          if (targetHeight && size.y > 0) {
            s = (targetHeight / size.y) * scale;
          }
          root.scale.set(s, s, s);
          if (typeof root.updateMatrixWorld === "function") {
            root.updateMatrixWorld(true);
          }

          const scaledBox = new THREE.Box3().setFromObject(root);
          if (flushFloor) {
            root.position.y = (-scaledBox.min.y) || 0;
          }
          if (centerHorizontal) {
            root.position.x = (-((scaledBox.min.x + scaledBox.max.x) / 2)) || 0;
            root.position.z = (-((scaledBox.min.z + scaledBox.max.z) / 2)) || 0;
          }
        }

        if (position) {
          if (position.x !== undefined) container.position.x = position.x;
          if (position.y !== undefined) container.position.y = position.y;
          if (position.z !== undefined) container.position.z = position.z;
        }

        let mixer = null;
        if (gltf.animations && gltf.animations.length > 0 && THREE.AnimationMixer) {
          mixer = new THREE.AnimationMixer(root);
          gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.play();
          });
          if (animOffsetSec && typeof mixer.update === "function") {
            mixer.update(animOffsetSec);
          }
          container.userData.mixer = mixer;
        }

        container.userData.gltf = gltf;
        container.userData.model = root;
        resolve({ container, root, mixer, gltf });
      },
      undefined,
      (err) => reject(err)
    );
  });
}

// build corner fire cluster with varied flames and floor scorch
function createFireMesh() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "fire-graphic";
  group.userData.wind = { x: 0, z: 0 };

  // asymmetrical floor scorch mark decal spreading from corner
  const scorchGeo = new THREE.CircleGeometry(1.25, 32);
  const scorchMat = new THREE.MeshBasicMaterial({
    color: 0x050505, transparent: true, opacity: 0.65
  });
  const scorch = new THREE.Mesh(scorchGeo, scorchMat);
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(-0.15, 0.01, -0.15);
  scorch.scale.set(1.15, 0.95, 1.0);
  scorch.name = "floor-scorch-decal";
  group.add(scorch);

  // container for 3d animated fire gltf cluster flush on floor plane Y=0
  const flamesGroup = new THREE.Group();
  flamesGroup.name = "fire-flames-group";
  flamesGroup.position.set(0, 0, 0);
  group.add(flamesGroup);
  group.userData.flamesGroup = flamesGroup;

  // outer flame cone (procedural fallback flush on floor)
  const outerGeo = new THREE.ConeGeometry(0.56, 1.60, 16);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xff3d00, transparent: true, opacity: 0.90
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.position.set(0, 0.80, 0);
  outer.name = "fire-outer-cone";
  group.add(outer);

  // inner flame cone (procedural fallback flush on floor)
  const innerGeo = new THREE.ConeGeometry(0.40, 1.20, 16);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffea00, transparent: true, opacity: 0.95
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.position.set(0, 0.60, 0);
  inner.name = "fire-inner-cone";
  group.add(inner);

  // tongue left (procedural fallback)
  const tongueGeoL = new THREE.ConeGeometry(0.36, 1.15, 12);
  const tongueMatL = new THREE.MeshBasicMaterial({
    color: 0xff6d00, transparent: true, opacity: 0.88
  });
  const tongueL = new THREE.Mesh(tongueGeoL, tongueMatL);
  tongueL.position.set(-0.25, 0.58, 0.08);
  tongueL.rotation.set(0.14, 0.70, -0.21);
  tongueL.name = "fire-tongue-left";
  group.add(tongueL);

  // tongue right (procedural fallback)
  const tongueGeoR = new THREE.ConeGeometry(0.34, 1.10, 12);
  const tongueMatR = new THREE.MeshBasicMaterial({
    color: 0xff9100, transparent: true, opacity: 0.88
  });
  const tongueR = new THREE.Mesh(tongueGeoR, tongueMatR);
  tongueR.position.set(0.18, 0.55, -0.22);
  tongueR.rotation.set(-0.17, -0.70, 0.17);
  tongueR.name = "fire-tongue-right";
  group.add(tongueR);

  // point light for fire illumination
  const fireLight = new THREE.PointLight(0xff7700, 2.2, 5);
  fireLight.position.set(-0.1, 0.8, -0.1);
  fireLight.name = "fire-light";
  group.add(fireLight);

  // aim target (invisible cylinder for raycasting at base of fire cluster)
  const targetGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.25, 16);
  const targetMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.0
  });
  const target = new THREE.Mesh(targetGeo, targetMat);
  target.position.set(0, 0.12, 0);
  target.name = "fire-target-base";
  target.userData.raycastTarget = "aim";
  group.add(target);

  // one procedural flame field carries the fire, no model download; cones stay as fallback
  const flameField = createFlameField();
  if (flameField) {
    flamesGroup.add(flameField);
    [outer, inner, tongueL, tongueR].forEach((c) => { c.visible = false; });
  }

  // vfx layers (skipped quietly when canvas/sprites not available)
  const vfx = {
    shadow: createContactShadow(2.2, 0.45),
    glow: _floorDecal("fire-floor-glow", _TEX.glow(), 6.8, { opacity: 0.4, additive: true, y: 0.012 }),
    residue: _floorDecal("fire-powder-residue", _TEX.powder(), 2.8, { opacity: 0, y: 0.016 }),
    smoke: createSmokeColumn(10),
    embers: createEmbers(18),
    impact: _spriteGroup("fire-spray-impact", 3, _TEX.powder(), 0xffffff),
    ceiling: createSmokeCeiling(),
    steam: _spriteGroup("fire-steam", 5, _TEX.smoke(), 0xf1f5f9)
  };
  Object.values(vfx).forEach((obj) => { if (obj) group.add(obj); });
  if (vfx.impact) vfx.impact.visible = false;
  if (vfx.steam) vfx.steam.visible = false;
  group.userData.vfx = vfx;

  // store animation state
  group.userData._animTime = 0;

  return group;
}

// drive glow, smoke, embers, spray impact, residue, steam from fire state
function _updateFireVfx(fireGroup, deltaMs, flameFactor, extProgress, wave) {
  const vfx = fireGroup.userData.vfx;
  if (!vfx) return;
  const dtSec = Math.min(0.1, (deltaMs || 16) / 1000);
  const localPerMeter = 1 / ((fireGroup.scale && fireGroup.scale.x) || 1);
  const wind = fireGroup.userData.wind || { x: 0, z: 0 };
  // burn time drives the roof smoke: it only builds while flames are up
  if (flameFactor > 0.02) fireGroup.userData._burnMs = (fireGroup.userData._burnMs || 0) + (deltaMs || 16);
  updateSmokeCeiling(vfx.ceiling, dtSec, (fireGroup.userData._burnMs || 0) / 1000, flameFactor, wind, localPerMeter);

  if (vfx.glow && vfx.glow.material) {
    vfx.glow.material.opacity = Math.max(0, Math.min(1, 0.42 + 0.22 * wave)) * flameFactor;
    vfx.glow.visible = flameFactor > 0.02;
  }
  if (vfx.residue && vfx.residue.material) {
    vfx.residue.material.opacity = 0.65 * extProgress;
  }
  updateSmokeColumn(vfx.smoke, dtSec, flameFactor, localPerMeter, wind);
  updateEmbers(vfx.embers, dtSec, flameFactor, wind);

  // white splash where powder meet fire base, only while spraying
  if (vfx.impact) {
    const hitting = Boolean(fireGroup.userData.sprayHitting) && flameFactor > 0.02;
    vfx.impact.visible = hitting;
    if (hitting) {
      const t = fireGroup.userData._animTime || 0;
      vfx.impact.children.forEach((sp, i) => {
        const a = i * 2.1 + t * 0.004;
        sp.position.set(Math.cos(a) * 0.35, 0.35 + 0.15 * Math.sin(t * 0.011 + i), Math.sin(a) * 0.35);
        const sc = 1.0 + 0.45 * Math.sin(t * 0.02 + i * 1.7);
        sp.scale.set(sc, sc, sc);
        if (sp.material) sp.material.opacity = 0.55;
      });
    }
  }

  // one-shot steam burst when fire fully out, gone after 1.5s
  if (vfx.steam) {
    if (extProgress >= 0.98 && fireGroup.userData._steamMs === undefined) {
      fireGroup.userData._steamMs = 0;
      vfx.steam.visible = true;
    }
    if (fireGroup.userData._steamMs !== undefined && vfx.steam.visible) {
      fireGroup.userData._steamMs += deltaMs || 16;
      const k = Math.min(1, fireGroup.userData._steamMs / 1500);
      vfx.steam.children.forEach((sp, i) => {
        const a = (i / vfx.steam.children.length) * Math.PI * 2;
        const spread = 0.6 * k;
        sp.position.set(Math.cos(a) * spread, 0.4 + 1.6 * k, Math.sin(a) * spread);
        const sc = 1.0 + 2.2 * k;
        sp.scale.set(sc, sc, sc);
        if (sp.material) sp.material.opacity = 0.6 * (1 - k);
      });
      if (k >= 1) vfx.steam.visible = false;
    }
  }
}

// update fire flames, shader clock and every vfx layer
function animateFireMesh(fireGroup, deltaMs) {
  if (!fireGroup || !fireGroup.userData) return;
  fireGroup.userData._animTime = (fireGroup.userData._animTime || 0) + deltaMs;
  const t = fireGroup.userData._animTime;
  const extProgress = typeof fireGroup.userData.extinguishProgress === "number"
    ? fireGroup.userData.extinguishProgress
    : 0;
  const flameFactor = Math.max(0, 1.0 - extProgress * 1.0);
  const wave = fireFlickerWave(t);
  _updateFireVfx(fireGroup, deltaMs, flameFactor, extProgress, wave);

  // flame field shader clock, strength and world-space lean (the fire group may be turned)
  const field = fireGroup.getObjectByName("fire-flame-field");
  if (field && field.material && field.material.uniforms) {
    const u = field.material.uniforms;
    const wind = fireGroup.userData.wind || { x: 0, z: 0 };
    const ry = (fireGroup.rotation && fireGroup.rotation.y) || 0;
    u.uTime.value = t / 1000;
    u.uStrength.value = flameFactor;
    u.uWind.value = { x: Math.cos(ry) * wind.x + Math.sin(ry) * wind.z, y: -Math.sin(ry) * wind.x + Math.cos(ry) * wind.z };
  }

  // shrink the flame field (or its fallback) as the fire goes out
  const flamesGroup = fireGroup.userData.flamesGroup || fireGroup.getObjectByName("fire-flames-group");
  if (flamesGroup) {
    if (flameFactor <= 0.02) {
      flamesGroup.visible = false;
    } else {
      flamesGroup.visible = true;
      flamesGroup.scale.set(flameFactor, flameFactor, flameFactor);
    }
  }

  // update procedural cones if present
  const outer = fireGroup.getObjectByName("fire-outer-cone");
  const inner = fireGroup.getObjectByName("fire-inner-cone");
  const tongueL = fireGroup.getObjectByName("fire-tongue-left");
  const tongueR = fireGroup.getObjectByName("fire-tongue-right");
  const light = fireGroup.getObjectByName("fire-light");

  if (flameFactor <= 0.02) {
    if (outer) outer.visible = false;
    if (inner) inner.visible = false;
    if (tongueL) tongueL.visible = false;
    if (tongueR) tongueR.visible = false;
    if (light) light.intensity = 0;
    return;
  }

  const hasFlameField = Boolean(flamesGroup && flamesGroup.children && flamesGroup.children.length > 0);
  if (!hasFlameField) {
    if (outer) {
      outer.visible = true;
      const s = (0.92 + 0.16 * Math.sin(t * 0.0285)) * flameFactor;
      const sy = (0.85 + 0.33 * Math.sin(t * 0.0285)) * flameFactor;
      outer.scale.set(s, sy, s);
      outer.position.y = 0.80 * sy;
    }
    if (inner) {
      inner.visible = true;
      const s = (0.85 + 0.30 * Math.sin(t * 0.037)) * flameFactor;
      const sy = (0.80 + 0.45 * Math.sin(t * 0.037)) * flameFactor;
      inner.scale.set(s, sy, s);
      inner.position.y = 0.60 * sy;
    }
    if (tongueL) {
      tongueL.visible = true;
      tongueL.rotation.z = -0.21 + 0.14 * Math.sin(t * 0.025);
      tongueL.scale.set(flameFactor, flameFactor, flameFactor);
      tongueL.position.y = 0.58 * flameFactor;
    }
    if (tongueR) {
      tongueR.visible = true;
      tongueR.rotation.z = 0.17 - 0.14 * Math.sin(t * 0.033);
      tongueR.scale.set(flameFactor, flameFactor, flameFactor);
      tongueR.position.y = 0.55 * flameFactor;
    }
  }

  if (light) {
    light.intensity = Math.max(0, 1.6 + wave) * flameFactor;
  }
}

// build fire extinguisher as three.js group
function createExtinguisherMesh() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "extinguisher-graphic";

  // soft floor shadow under cylinder base
  const extShadow = createContactShadow(1.5, 0.55);
  if (extShadow) group.add(extShadow);

  // main red cylinder body
  const bodyGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.30, 24);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.79, 0);
  body.name = "ext-body";
  group.add(body);

  // top dome
  const topGeo = new THREE.SphereGeometry(0.38, 16, 16);
  const topMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.scale.set(1, 0.40, 1);
  top.position.set(0, 1.44, 0);
  top.name = "ext-top-dome";
  group.add(top);

  // bottom dome
  const botGeo = new THREE.SphereGeometry(0.38, 16, 16);
  const botMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const bot = new THREE.Mesh(botGeo, botMat);
  bot.scale.set(1, 0.30, 1);
  bot.position.set(0, 0.14, 0);
  bot.name = "ext-bottom-dome";
  group.add(bot);

  // base ring (rests flush on Y=0)
  const baseGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.14, 24);
  const baseMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.07, 0);
  base.name = "ext-base";
  group.add(base);

  // valve block (brass)
  const valveGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.14, 16);
  const valveMat = new THREE.MeshStandardMaterial({
    color: 0xd97706, metalness: 0.85, roughness: 0.2
  });
  const valve = new THREE.Mesh(valveGeo, valveMat);
  valve.position.set(0, 1.63, 0);
  valve.name = "ext-valve-block";
  group.add(valve);

  // neck
  const neckGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 16);
  const neck = new THREE.Mesh(neckGeo, valveMat.clone());
  neck.position.set(0, 1.53, 0);
  neck.name = "ext-neck";
  group.add(neck);

  // handle lever
  const handleGeo = new THREE.BoxGeometry(0.45, 0.08, 0.12);
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x334155, metalness: 0.5, roughness: 0.3
  });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.set(0.15, 1.67, 0);
  handle.rotation.z = -0.21;
  handle.name = "extinguisher-handle";
  handle.userData.raycastTarget = "handle";
  group.add(handle);

  // safety pin (gold)
  const pinGroup = new THREE.Group();
  pinGroup.name = "extinguisher-pin";
  pinGroup.position.set(0.06, 1.67, 0.15);

  const pinShaftGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.38, 12);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  const pinShaft = new THREE.Mesh(pinShaftGeo, pinMat);
  pinShaft.rotation.x = Math.PI / 2;
  pinShaft.name = "ext-pin-shaft";
  pinGroup.add(pinShaft);

  const ringGeo = new THREE.TorusGeometry(0.16, 0.032, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0.20, 0, 0);
  ring.rotation.y = Math.PI / 2;
  ring.name = "ext-pin-ring";
  ring.userData.raycastTarget = "pin";
  pinGroup.add(ring);

  pinGroup.userData.raycastTarget = "pin";
  group.add(pinGroup);

  // guide arrow pointing at pin
  const arrowGroup = new THREE.Group();
  arrowGroup.name = "extinguisher-guide-arrow";
  arrowGroup.position.set(0.26, 2.24, 0.15);

  const arrowConeGeo = new THREE.ConeGeometry(0.16, 0.36, 12);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide });
  const arrowCone = new THREE.Mesh(arrowConeGeo, arrowMat);
  arrowCone.position.set(0, -0.15, 0);
  arrowCone.rotation.x = Math.PI;
  arrowGroup.add(arrowCone);

  const arrowShaftGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8);
  const arrowShaft = new THREE.Mesh(arrowShaftGeo, arrowMat.clone());
  arrowShaft.position.set(0, 0.16, 0);
  arrowGroup.add(arrowShaft);

  group.add(arrowGroup);

  // discharge hose
  const hoseGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.70, 8);
  const hoseMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const hose = new THREE.Mesh(hoseGeo, hoseMat);
  hose.position.set(0.26, 1.29, -0.10);
  hose.rotation.set(0.35, 0, -0.42);
  hose.name = "ext-hose";
  group.add(hose);

  // discharge nozzle horn pointing toward fire (-Z)
  const nozzleGroup = new THREE.Group();
  nozzleGroup.name = "extinguisher-nozzle";
  nozzleGroup.position.set(0.40, 1.02, -0.28);
  nozzleGroup.rotation.set(-0.15, 0.10, 0);

  const hornGeo = new THREE.ConeGeometry(0.11, 0.34, 12);
  const hornMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
  const horn = new THREE.Mesh(hornGeo, hornMat);
  horn.rotation.x = -Math.PI / 2;
  horn.position.set(0, 0, -0.17);
  horn.name = "ext-nozzle-horn";
  nozzleGroup.add(horn);

  // attach white chemical powder spray at tip of horn
  const spray = createPowderSprayMesh();
  if (spray) {
    spray.position.set(0, 0, -0.34);
    nozzleGroup.add(spray);
  }
  group.add(nozzleGroup);

  // load realistic GLB extinguisher model if loader available
  if (THREE.GLTFLoader) {
    loadGLBModel("./assets/models/fire_extinguisher.glb", {
      targetHeight: 1.75,
      flushFloor: true,
      centerHorizontal: true
    }).then(({ container }) => {
      container.name = "extinguisher-glb-model";
      group.add(container);
      // hide procedural cylinder body parts
      const partsToHide = ["ext-body", "ext-top-dome", "ext-bottom-dome", "ext-base", "ext-valve-block", "ext-neck"];
      partsToHide.forEach((name) => {
        const obj = group.getObjectByName(name);
        if (obj) obj.visible = false;
      });
    }).catch(() => {
      // retain procedural body if load fails
    });
  }

  // store animation state
  group.userData._animTime = 0;
  group.userData._pinPulled = false;
  group.userData._discharging = false;

  return group;
}

// build white chemical powder gas spray stream
function createPowderSprayMesh() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const sprayGroup = new THREE.Group();
  sprayGroup.name = "powder-spray";
  sprayGroup.visible = false;

  // expanding white translucent plume cone
  const coneGeo = new THREE.ConeGeometry(0.55, 2.2, 16, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0, -1.1);
  cone.name = "powder-spray-cone";
  sprayGroup.add(cone);

  // dense inner core cone
  const coreGeo = new THREE.ConeGeometry(0.24, 1.6, 12, 1, true);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 0, -0.8);
  core.name = "powder-spray-core";
  sprayGroup.add(core);

  // individual high-speed powder particle puffs
  const puffGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const particles = [];
  for (let i = 0; i < 20; i++) {
    const puffMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    const puff = new THREE.Mesh(puffGeo, puffMat);
    puff.userData = {
      offsetZ: -(i * 0.11 + _vfxRand() * 0.08),
      speed: 2.2 + _vfxRand() * 1.5,
      spreadX: (_vfxRand() - 0.5) * 0.28,
      spreadY: (_vfxRand() - 0.5) * 0.28,
      baseScale: 0.8 + _vfxRand() * 0.6
    };
    puff.position.set(puff.userData.spreadX, puff.userData.spreadY, puff.userData.offsetZ);
    sprayGroup.add(puff);
    particles.push(puff);
  }
  sprayGroup.userData.particles = particles;
  sprayGroup.userData._animTime = 0;

  return sprayGroup;
}

// animate powder spray particles
function animatePowderSpray(sprayGroup, active, deltaMs) {
  if (!sprayGroup || !sprayGroup.userData) return;
  sprayGroup.visible = Boolean(active);
  if (!active) return;

  sprayGroup.userData._animTime = (sprayGroup.userData._animTime || 0) + deltaMs;
  const t = sprayGroup.userData._animTime;

  const cone = sprayGroup.getObjectByName("powder-spray-cone");
  if (cone && cone.material) {
    cone.material.opacity = 0.45 + 0.25 * Math.sin(t * 0.04);
    const s = 1.0 + 0.12 * Math.sin(t * 0.05);
    cone.scale.set(s, 1.0, s);
  }

  const core = sprayGroup.getObjectByName("powder-spray-core");
  if (core && core.material) {
    core.material.opacity = 0.70 + 0.20 * Math.sin(t * 0.06);
  }

  const particles = sprayGroup.userData.particles || [];
  const dt = Math.min(0.05, deltaMs / 1000);
  particles.forEach((p) => {
    p.position.z -= p.userData.speed * dt;
    const progress = Math.min(1.0, Math.abs(p.position.z) / 2.2);
    const s = p.userData.baseScale * (1.0 + progress * 2.8);
    p.scale.set(s, s, s);
    p.position.x = p.userData.spreadX * (1.0 + progress * 2.2);
    p.position.y = p.userData.spreadY * (1.0 + progress * 2.2);
    if (p.material) {
      p.material.opacity = Math.max(0, 0.85 * (1.0 - progress));
    }
    if (p.position.z < -2.2) {
      p.position.z = 0;
      p.position.x = (_vfxRand() - 0.5) * 0.05;
      p.position.y = (_vfxRand() - 0.5) * 0.05;
    }
  });
}

// point extinguisher nozzle and spray at fire base
function orientNozzleTowardTarget(nozzleGroup, extGroup, targetWorldPos) {
  if (!nozzleGroup || !targetWorldPos) return;
  const THREE = getTHREE();
  if (!THREE) return;

  let nx = nozzleGroup.position ? nozzleGroup.position.x : 0.40;
  let ny = nozzleGroup.position ? nozzleGroup.position.y : 1.02;
  let nz = nozzleGroup.position ? nozzleGroup.position.z : -0.28;

  if (extGroup) {
    const s = extGroup.scale ? extGroup.scale.x || 1 : 1;
    nx = (extGroup.position ? extGroup.position.x : 0) + nx * s;
    ny = (extGroup.position ? extGroup.position.y : 0) + ny * s;
    nz = (extGroup.position ? extGroup.position.z : 0) + nz * s;
  }

  const tx = typeof targetWorldPos.x === "number" ? targetWorldPos.x : 0;
  const ty = typeof targetWorldPos.y === "number" ? targetWorldPos.y : 0.12;
  const tz = typeof targetWorldPos.z === "number" ? targetWorldPos.z : -3.0;

  const dx = tx - nx;
  const dy = ty - ny;
  const dz = tz - nz;
  const dist = Math.hypot(dx, dy, dz) || 1;

  const dirX = dx / dist;
  const dirY = dy / dist;
  const dirZ = dz / dist;

  nozzleGroup.userData.aimDirection = { x: dirX, y: dirY, z: dirZ, dist };

  const yaw = Math.atan2(-dirX, -dirZ);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dirY)));

  if (nozzleGroup.rotation && typeof nozzleGroup.rotation.set === "function") {
    nozzleGroup.rotation.set(pitch, yaw, 0, "YXZ");
  } else if (nozzleGroup.rotation) {
    nozzleGroup.rotation.x = pitch;
    nozzleGroup.rotation.y = yaw;
    nozzleGroup.rotation.z = 0;
  }

  if (nozzleGroup.quaternion && typeof nozzleGroup.quaternion.setFromUnitVectors === "function" && THREE.Vector3) {
    const vForward = new THREE.Vector3(0, 0, -1);
    const vTarget = new THREE.Vector3(dirX, dirY, dirZ);
    if (extGroup && extGroup.quaternion && typeof extGroup.quaternion.clone === "function") {
      const qInv = extGroup.quaternion.clone();
      if (typeof qInv.invert === "function") {
        qInv.invert();
        vTarget.applyQuaternion(qInv);
        vTarget.normalize();
      }
    }
    nozzleGroup.quaternion.setFromUnitVectors(vForward, vTarget);
  }

  const spray = nozzleGroup.getObjectByName("powder-spray");
  if (spray && spray.scale) {
    spray.scale.set(1, 1, calcSprayScaleZ(dist, extGroup && extGroup.scale ? extGroup.scale.x : 1));
  }
}

// spray cone is 2.2 local units long inside scaled extinguisher; stretch so tip land on fire
function calcSprayScaleZ(worldDist, extScale = 1) {
  const localReach = worldDist / (extScale || 1);
  return Math.max(0.5, Math.min(8, localReach / 2.2));
}

// animate extinguisher parts and gas spray
function animateExtinguisherMesh(extGroup, deltaMs, discharging = false, targetWorldPos = null) {
  if (!extGroup || !extGroup.userData) return;
  extGroup.userData._animTime = (extGroup.userData._animTime || 0) + deltaMs;
  const t = extGroup.userData._animTime;

  const arrow = extGroup.getObjectByName("extinguisher-guide-arrow");
  if (arrow && !extGroup.userData._pinPulled) {
    arrow.position.y = 2.24 + 0.15 * Math.sin(t * 0.008);
  }

  const ring = extGroup.getObjectByName("ext-pin-ring");
  if (ring && !extGroup.userData._pinPulled) {
    const s = 1.0 + 0.25 * Math.sin(t * 0.009);
    ring.scale.set(s, s, s);
  }

  const target = targetWorldPos || extGroup.userData.targetWorldPos;
  const nozzle = extGroup.getObjectByName("extinguisher-nozzle");
  if (nozzle && target) {
    orientNozzleTowardTarget(nozzle, extGroup, target);
  }

  const spray = extGroup.getObjectByName("powder-spray");
  if (spray) {
    const isDischarging = discharging || Boolean(extGroup.userData._discharging);
    animatePowderSpray(spray, isDischarging, deltaMs);
  }
}

// build exit sign with running man glb model
function createExitSignMesh(options = {}) {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "exit-graphic";
  group.userData.raycastTarget = "exit";
  group.userData._animTime = 0;

  const targetHeight = options.targetHeight || 0.20;
  const initialPos = options.position || { x: 0, y: 1.8, z: -1.8 };
  group.position.set(initialPos.x, initialPos.y, initialPos.z);

  // procedural fallback geometry (green sign with border)
  const signGeo = new THREE.BoxGeometry(0.28, 0.18, 0.04);
  const signMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
  const signBox = new THREE.Mesh(signGeo, signMat);
  signBox.name = "exit-sign-fallback";
  group.add(signBox);

  // exit sign hit area for touch/raycasting
  const hitGeo = new THREE.BoxGeometry(0.40, 0.28, 0.20);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0 });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.name = "exit-hit-area";
  hitMesh.userData.raycastTarget = "exit";
  group.add(hitMesh);

  // load GLB model if loader available
  if (THREE.GLTFLoader) {
    loadGLBModel("./assets/models/low_poly_green_running_man_exit_sign.glb", {
      targetHeight,
      flushFloor: false,
      centerHorizontal: true
    }).then(({ container }) => {
      container.name = "exit-sign-model";
      group.add(container);
      if (signBox) signBox.visible = false;
    }).catch(() => {
      // retain procedural signBox on failure
    });
  }

  return group;
}

// float exit sign gently up and down
function animateExitSignMesh(exitGroup, deltaMs) {
  if (!exitGroup || !exitGroup.userData || exitGroup.userData.isLocked) return;
  exitGroup.userData._animTime = (exitGroup.userData._animTime || 0) + deltaMs;
  const t = exitGroup.userData._animTime;
  const basePosY = exitGroup.userData.basePosY !== undefined ? exitGroup.userData.basePosY : exitGroup.position.y;
  exitGroup.userData.basePosY = basePosY;
  exitGroup.position.y = basePosY + 0.03 * Math.sin(t * 0.003);
}

// build fire alarm station with notifier pull glb
function createAlarmStationMesh(options = {}) {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "fire-alarm-station";
  group.userData.raycastTarget = "alarm";
  group.userData._animTime = 0;

  const targetHeight = options.targetHeight || 0.15;
  const initialPos = options.position || { x: 0.8, y: 1.15, z: -1.2 };
  group.position.set(initialPos.x, initialPos.y, initialPos.z);

  // procedural fallback (red alarm box)
  const boxGeo = new THREE.BoxGeometry(0.12, 0.15, 0.06);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.name = "alarm-box-fallback";
  group.add(box);

  // pulsing red pull affordance ring
  const ringGeo = new THREE.RingGeometry(0.09, 0.13, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = "alarm-pulse-ring";
  ring.position.set(0, 0, 0.05);
  group.add(ring);

  // procedural t-bar handle (glb is one skinned mesh, no lever node to animate)
  const pullBar = new THREE.Group();
  pullBar.name = "alarm-pull-bar";
  pullBar.position.set(0, 0.012, 0.035);
  const barMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.014, 0.014),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
  );
  barMesh.position.set(0, -0.012, 0);
  pullBar.add(barMesh);
  group.add(pullBar);

  // red in-world strobe above station, lit only after pull
  const strobe = _sprite("alarm-strobe", _TEX.red(), 0xffffff, { additive: true });
  if (strobe) {
    strobe.position.set(0, 0.16, 0.02);
    strobe.scale.set(0.22, 0.22, 0.22);
    strobe.visible = false;
    group.add(strobe);
  }

  // touch hit box
  const hitGeo = new THREE.BoxGeometry(0.24, 0.26, 0.18);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0 });
  const hit = new THREE.Mesh(hitGeo, hitMat);
  hit.name = "alarm-hit-box";
  hit.userData.raycastTarget = "alarm";
  group.add(hit);

  // load GLB model if loader available
  if (THREE.GLTFLoader) {
    loadGLBModel("./assets/models/notifier_rsg_t-bar_fire_alarm_pull_station.glb", {
      targetHeight,
      flushFloor: false,
      centerHorizontal: true
    }).then(({ container }) => {
      container.name = "alarm-model";
      group.add(container);
      if (box) box.visible = false;
    }).catch(() => {
      // retain procedural box on failure
    });
  }

  return group;
}

// how long alarm pull payoff (lever, green ring, strobe, siren) run
const ALARM_PULL_PAYOFF_MS = 1000;

// start pull payoff: lever drop, ring turn green, strobe flash
function triggerAlarmPullVisual(alarmGroup) {
  if (!alarmGroup || !alarmGroup.userData) return;
  alarmGroup.userData.pullMs = 0;
  const ring = alarmGroup.getObjectByName("alarm-pulse-ring");
  if (ring && ring.material && ring.material.color) {
    if (typeof ring.material.color.setHex === "function") ring.material.color.setHex(0x10b981);
    else if (typeof ring.material.color.setRGB === "function") ring.material.color.setRGB(0.06, 0.73, 0.51);
  }
}

// pulse red alarm pull circle ring
function animateAlarmStationMesh(alarmGroup, deltaMs) {
  if (!alarmGroup || !alarmGroup.userData) return;
  alarmGroup.userData._animTime = (alarmGroup.userData._animTime || 0) + deltaMs;
  const t = alarmGroup.userData._animTime;

  // payoff phase after pull
  if (typeof alarmGroup.userData.pullMs === "number") {
    alarmGroup.userData.pullMs += deltaMs || 16;
    const pm = alarmGroup.userData.pullMs;
    const bar = alarmGroup.getObjectByName("alarm-pull-bar");
    // ~20 deg down and out over 200ms; strobe under 3 flashes/s (photosensitivity)
    if (bar && bar.rotation) bar.rotation.x = -0.35 * Math.min(1, pm / 200);
    const strobe = alarmGroup.getObjectByName("alarm-strobe");
    if (strobe) {
      strobe.visible = pm < ALARM_PULL_PAYOFF_MS;
      if (strobe.material) strobe.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(pm * 0.0085));
    }
    const pulseRing = alarmGroup.getObjectByName("alarm-pulse-ring");
    if (pulseRing) {
      const s = 1.0 + 0.35 * Math.abs(Math.sin(pm * 0.0085));
      pulseRing.scale.set(s, s, s);
    }
    return;
  }

  const ring = alarmGroup.getObjectByName("alarm-pulse-ring");
  if (ring) {
    const s = 1.0 + 0.25 * Math.sin(t * 0.006);
    ring.scale.set(s, s, s);
    if (ring.material) {
      ring.material.opacity = 0.5 + 0.35 * Math.sin(t * 0.006);
    }
  }
}

// chevron repeat spacing along route, meters
const CHEVRON_SPACING_M = 0.55;

// route strip math: start gap from feet, length, centre, yaw so -z of strip point at exit
function calcRouteStripLayout(from, to, startGapM = 0.8) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const full = Math.hypot(dx, dz);
  const length = full - startGapM;
  if (!(length > 0.3)) return null;
  const ux = dx / full;
  const uz = dz / full;
  const sx = from.x + ux * startGapM;
  const sz = from.z + uz * startGapM;
  return {
    length,
    center: { x: sx + ux * length / 2, z: sz + uz * length / 2 },
    yaw: Math.atan2(-ux, -uz)
  };
}

// flat green chevron strip on floor, one quad, texture scroll toward exit
function createRouteChevronStrip() {
  const THREE = getTHREE();
  const tex = _chevronTexture();
  if (!THREE || !tex || !THREE.PlaneGeometry) return null;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = "evac-route-chevrons";
  mesh.visible = false;
  return _noRaycast(mesh);
}

// place strip between viewer feet and exit floor point
function layoutRouteChevronStrip(strip, from, to, floorY, widthM = 0.45) {
  if (!strip) return null;
  const lay = calcRouteStripLayout(from, to);
  if (!lay) {
    strip.visible = false;
    return null;
  }
  strip.visible = true;
  strip.position.set(lay.center.x, floorY + 0.01, lay.center.z);
  strip.rotation.set(-Math.PI / 2, lay.yaw, 0, "YXZ");
  strip.scale.set(widthM, lay.length, 1);
  const tex = strip.material && strip.material.map;
  if (tex && tex.repeat) tex.repeat.set(1, lay.length / CHEVRON_SPACING_M);
  return lay;
}

// scroll chevrons forward toward exit
function scrollRouteChevronStrip(strip, deltaMs) {
  const tex = strip && strip.material && strip.material.map;
  if (!tex || !tex.offset) return;
  tex.offset.y = (tex.offset.y - ((deltaMs || 16) / 1000) * 1.1) % 1;
}

// green halo + light pillar behind exit sign, hidden until route locked
function createExitBeacon() {
  const THREE = getTHREE();
  if (!THREE) return null;
  const group = new THREE.Group();
  group.name = "exit-beacon";
  group.visible = false;
  const halo = _sprite("exit-beacon-halo", _TEX.green(), 0xffffff, { additive: true });
  if (halo) {
    halo.position.set(0, 0, -0.03);
    halo.scale.set(0.6, 0.6, 0.6);
    group.add(halo);
  }
  if (THREE.CylinderGeometry) {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    pillar.name = "exit-beacon-pillar";
    pillar.position.set(0, 0.72, -0.03);
    group.add(_noRaycast(pillar));
  }
  return _noRaycast(group);
}

// halo grow with distance so sign stay findable, gentle pulse
function animateExitBeacon(beacon, deltaMs, distM = 2) {
  if (!beacon || !beacon.userData) return;
  beacon.userData._animTime = (beacon.userData._animTime || 0) + (deltaMs || 16);
  const t = beacon.userData._animTime;
  const halo = beacon.getObjectByName("exit-beacon-halo");
  if (halo) {
    const s = Math.max(0.6, Math.min(2.2, 0.45 + distM * 0.2)) * (1 + 0.08 * Math.sin(t * 0.004));
    halo.scale.set(s, s, s);
    if (halo.material) halo.material.opacity = 0.75;
  }
  const pillar = beacon.getObjectByName("exit-beacon-pillar");
  if (pillar && pillar.material) pillar.material.opacity = 0.22 + 0.12 * Math.sin(t * 0.003);
}

// ~30 small spark quads bursting up then falling
function createConfettiBurst(count = 30) {
  const THREE = getTHREE();
  if (!THREE || !THREE.PlaneGeometry) return null;
  const colors = [0x00e676, 0xfacc15, 0x38bdf8, 0xff6a00, 0xf8fafc];
  const group = new THREE.Group();
  group.name = "confetti-burst";
  const geo = new THREE.PlaneGeometry(0.035, 0.035);
  for (let i = 0; i < count; i++) {
    const piece = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false
    }));
    const a = _vfxRand() * Math.PI * 2;
    const sp = 0.4 + _vfxRand() * 0.9;
    piece.userData.vel = { x: Math.cos(a) * sp, y: 1.6 + _vfxRand() * 1.4, z: Math.sin(a) * sp };
    piece.userData.spin = (_vfxRand() - 0.5) * 12;
    group.add(_noRaycast(piece));
  }
  group.userData.ageMs = 0;
  group.userData.lifeMs = 1500;
  return _noRaycast(group);
}

// step confetti physics; false once burst finished
function animateConfettiBurst(group, deltaMs) {
  if (!group || !group.userData) return false;
  const dt = Math.min(0.05, (deltaMs || 16) / 1000);
  group.userData.ageMs += deltaMs || 16;
  const k = group.userData.ageMs / group.userData.lifeMs;
  group.children.forEach((p) => {
    const v = p.userData.vel;
    v.y -= 4.5 * dt;
    p.position.set(p.position.x + v.x * dt, p.position.y + v.y * dt, p.position.z + v.z * dt);
    if (p.rotation) {
      p.rotation.x += p.userData.spin * dt;
      p.rotation.y += p.userData.spin * 0.7 * dt;
    }
    if (p.material) p.material.opacity = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
  });
  return k < 1;
}

// drop fire two meters in front of worker
function calcFireOffsetPosition(placedPosition, placedQuaternion) {
  const THREE = getTHREE();
  if (!THREE || !placedPosition) return null;

  const forward = new THREE.Vector3(0, 0, -1);
  if (placedQuaternion) {
    forward.applyQuaternion(placedQuaternion);
  }
  // flatten to horizontal plane (keep Y=0 offset)
  forward.y = 0;
  forward.normalize();

  const firePos = new THREE.Vector3(
    placedPosition.x + forward.x * 2.0,
    placedPosition.y,
    placedPosition.z + forward.z * 2.0
  );
  return firePos;
}

export {
  createSeededRandom,
  fireFlickerWave,
  createContactShadow,
  createSmokeColumn,
  updateSmokeColumn,
  createEmbers,
  updateEmbers,
  createFlameField,
  createSmokeCeiling,
  updateSmokeCeiling,
  setFireAirflow,
  SMOKE_CEILING_M,
  calcSprayScaleZ,
  ALARM_PULL_PAYOFF_MS,
  triggerAlarmPullVisual,
  calcRouteStripLayout,
  createRouteChevronStrip,
  layoutRouteChevronStrip,
  scrollRouteChevronStrip,
  createExitBeacon,
  animateExitBeacon,
  createConfettiBurst,
  animateConfettiBurst,
  getTHREE,
  loadGLBModel,
  createPlacementReticle,
  createFireMesh,
  animateFireMesh,
  createExtinguisherMesh,
  animateExtinguisherMesh,
  orientNozzleTowardTarget,
  createPowderSprayMesh,
  animatePowderSpray,
  createExitSignMesh,
  animateExitSignMesh,
  createAlarmStationMesh,
  animateAlarmStationMesh,
  calcFireOffsetPosition
};
