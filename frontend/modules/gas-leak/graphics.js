// get three from global scope
function getTHREE() {
  if (typeof window !== "undefined" && window.THREE) return window.THREE;
  return null;
}

// scale model to real world size from bbox
function normalizeModelScale(model, targetLongestDim, fallbackScale) {
  const THREE = getTHREE();
  if (!model) return;
  if (THREE && typeof THREE.Box3 === "function" && typeof THREE.Vector3 === "function") {
    try {
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0 && Number.isFinite(maxDim)) {
        const s = targetLongestDim / maxDim;
        if (model.scale && typeof model.scale.set === "function") {
          model.scale.set(s, s, s);
        }
        return s;
      }
    } catch {
      // fallback if box math fails
    }
  }
  if (fallbackScale && model.scale && typeof model.scale.set === "function") {
    model.scale.set(fallbackScale, fallbackScale, fallbackScale);
    return fallbackScale;
  }
}

// build 3d gas hazard zone entity for a-frame marker anchor
function buildHazardZoneEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "gas-hazard-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("position", "0 0.25 0");
  }

  entity.innerHTML = `
    <!-- 1. ground hazard boundary: caution tapes bbox 14m -> target 0.6m, scale 0.043 -->
    <a-entity id="hazard-barrier-model" gltf-model="url(./assets/models/gas-leak/caution_tapes.glb)" position="0 0.1 0" scale="0.043 0.043 0.043" rotation="0 0 0"></a-entity>
    <!-- 2. warning placard sign: bbox 1.02m -> target 0.3m, scale 0.295 -->
    <a-entity id="hazard-warning-sign-model" gltf-model="url(./assets/models/gas-leak/warning_sign.glb)" position="0.45 0.15 0" scale="0.295 0.295 0.295" rotation="0 -20 0"></a-entity>
    <!-- 3. gas cloud indicator: bbox 5.99m -> target 0.5m, scale 0.084 -->
    <a-entity id="hazard-gas-cloud-model" gltf-model="url(./assets/models/gas-leak/fog_indicator.glb)" position="0 0.3 0" scale="0.084 0.084 0.084"></a-entity>
    <a-ring position="0 0.02 0" rotation="-90 0 0" radius-inner="0.55" radius-outer="0.65" material="color: #ef4444; opacity: 0.85"></a-ring>
    <a-cylinder position="0 0.18 0" radius="0.6" height="0.35" material="color: #f59e0b; opacity: 0.35; transparent: true; roughness: 0.5"></a-cylinder>
  `;

  // clear crude shapes when glb loads
  const removePlaceholders = () => {
    const ring = entity.querySelector ? entity.querySelector("a-ring") : null;
    const cyl = entity.querySelector ? entity.querySelector("a-cylinder") : null;
    if (ring && typeof ring.remove === "function") ring.remove();
    else if (ring && ring.parentNode) ring.parentNode.removeChild(ring);
    if (cyl && typeof cyl.remove === "function") cyl.remove();
    else if (cyl && cyl.parentNode) cyl.parentNode.removeChild(cyl);
  };

  ["#hazard-barrier-model", "#hazard-warning-sign-model", "#hazard-gas-cloud-model"].forEach((sel) => {
    const el = entity.querySelector ? entity.querySelector(sel) : null;
    if (el && typeof el.addEventListener === "function") {
      el.addEventListener("model-loaded", removePlaceholders, { once: true });
    }
  });

  return entity;
}

// build 3d ppe display entity for a-frame marker anchor
function buildPpeDisplayEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "gas-ppe-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("position", "0 0.3 0");
  }

  entity.innerHTML = `
    <!-- 4. dedicated 3d scba breathing apparatus: procedural bbox 0.472m -> target 0.5m, scale 1.06 -->
    <a-entity id="ppe-scba-model" position="-0.3 0 0">
      <a-entity gltf-model="url(./assets/models/gas-leak/scba_respirator.glb)" scale="1.06 1.06 1.06" rotation="0 90 0" position="0 0.05 0"></a-entity>
      <a-cylinder position="0 0.22 0" radius="0.065" height="0.32" material="color: #eab308; roughness: 0.4"></a-cylinder>
      <a-sphere position="0 0.38 0" radius="0.065" material="color: #eab308"></a-sphere>
      <a-cylinder position="0 0.44 0" radius="0.025" height="0.05" material="color: #94a3b8; metalness: 0.8"></a-cylinder>
    </a-entity>
    <!-- 5. dedicated 3d multi-gas atmospheric detector: bbox 0.542m -> target 0.15m, scale 0.277 -->
    <a-entity id="ppe-detector-model" position="0 0 0">
      <a-entity gltf-model="url(./assets/models/gas-leak/h2s_detector.glb)" scale="0.277 0.277 0.277" position="0 0.1 0"></a-entity>
      <a-box position="0 0.22 0" width="0.12" height="0.22" depth="0.06" material="color: #f97316; roughness: 0.5"></a-box>
      <a-box position="0 0.25 0.032" width="0.09" height="0.08" depth="0.005" material="color: #064e3b; roughness: 0.2"></a-box>
      <a-cylinder position="0 0.14 0.032" radius="0.035" height="0.01" rotation="90 0 0" material="color: #1e293b; metalness: 0.6"></a-cylinder>
      <a-sphere position="0 0.34 0" radius="0.02" material="color: #ef4444"></a-sphere>
    </a-entity>
    <!-- 6. dedicated 3d full body safety harness: bbox 0.436m -> target 0.6m, scale 1.38 -->
    <a-entity id="ppe-harness-model" position="0.3 0 0">
      <a-entity gltf-model="url(./assets/models/gas-leak/safety_harness.glb)" scale="1.38 1.38 1.38" position="0 0.1 0"></a-entity>
      <a-torus position="0 0.26 0" radius="0.09" radius-tubular="0.02" material="color: #84cc16"></a-torus>
      <a-box position="0 0.12 0" width="0.18" height="0.12" depth="0.05" material="color: #1e293b"></a-box>
      <a-torus position="0 0.33 -0.02" radius="0.035" radius-tubular="0.008" rotation="90 0 0" material="color: #cbd5e1; metalness: 0.9"></a-torus>
      <a-cylinder position="0 0.06 0" radius="0.015" height="0.12" material="color: #eab308"></a-cylinder>
    </a-entity>
  `;

  // clear crude shapes inside ppe items when model loads
  [
    { id: "#ppe-scba-model", fallbackSelectors: ["a-cylinder", "a-sphere"] },
    { id: "#ppe-detector-model", fallbackSelectors: ["a-box", "a-cylinder", "a-sphere"] },
    { id: "#ppe-harness-model", fallbackSelectors: ["a-torus", "a-box", "a-cylinder"] }
  ].forEach(({ id, fallbackSelectors }) => {
    const parent = entity.querySelector ? entity.querySelector(id) : null;
    if (parent) {
      const modelEl = parent.querySelector ? parent.querySelector("a-entity[gltf-model]") : null;
      if (modelEl && typeof modelEl.addEventListener === "function") {
        modelEl.addEventListener("model-loaded", () => {
          fallbackSelectors.forEach((sel) => {
            const list = parent.querySelectorAll ? parent.querySelectorAll(sel) : (parent.querySelector ? [parent.querySelector(sel)] : []);
            list.forEach((fb) => {
              if (fb && typeof fb.remove === "function") fb.remove();
              else if (fb && fb.parentNode) fb.parentNode.removeChild(fb);
            });
          });
        }, { once: true });
      }
    }
  });

  return entity;
}

// build three.js hazard zone mesh group for webxr tier 1
function createHazardZoneThreeMesh(onLoaded) {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "gas-hazard-graphic";

  // hazard ring perimeter on ground
  const ringGeo = new THREE.RingGeometry(0.55, 0.65, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0, 0.02, 0);
  group.add(ring);

  // warning zone cylinder
  const cylGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.35, 24);
  const cylMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.35,
    roughness: 0.5
  });
  const cyl = new THREE.Mesh(cylGeo, cylMat);
  cyl.position.set(0, 0.18, 0);
  group.add(cyl);

  // remove crude primitives once real GLB model arrives
  const clearPrimitives = () => {
    if (ring.parent) ring.parent.remove(ring);
    if (cyl.parent) cyl.parent.remove(cyl);
  };

  // load real glb hazard models if gltf loader present
  if (THREE.GLTFLoader) {
    try {
      const loader = new THREE.GLTFLoader();

      // 1. caution tapes or fallback barrier: bbox 14m -> target 0.6m
      loader.load("./assets/models/gas-leak/caution_tapes.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          clearPrimitives();
          normalizeModelScale(model, 0.6, 0.043);
          model.position.set(0, 0.1, 0);
          group.add(model);
          if (typeof onLoaded === "function") onLoaded(group);
        }
      }, undefined, () => {
        // fallback barrier if caution tapes not found: bbox 2m -> target 0.5m
        loader.load("./assets/models/gas-leak/hazard_zone.glb", (gltf) => {
          const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (model) {
            clearPrimitives();
            normalizeModelScale(model, 0.5, 0.25);
            model.position.set(0, 0.1, 0);
            group.add(model);
            if (typeof onLoaded === "function") onLoaded(group);
          }
        }, undefined, () => {});
      });

      // 2. warning placard sign: bbox 1.02m -> target 0.3m
      loader.load("./assets/models/gas-leak/warning_sign.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          clearPrimitives();
          normalizeModelScale(model, 0.3, 0.295);
          model.position.set(0.45, 0.15, 0);
          model.rotation.set(0, -0.35, 0);
          group.add(model);
          if (typeof onLoaded === "function") onLoaded(group);
        }
      }, undefined, () => {});

      // 3. gas fog cloud indicator: bbox 5.99m -> target 0.5m
      loader.load("./assets/models/gas-leak/fog_indicator.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          clearPrimitives();
          normalizeModelScale(model, 0.5, 0.084);
          model.position.set(0, 0.3, 0);
          group.add(model);
          if (typeof onLoaded === "function") onLoaded(group);
        }
      }, undefined, () => {});
    } catch {
      // ignore loader error
    }
  }

  return group;
}

// build three.js ppe mesh group for webxr tier 1
function createPpeThreeMesh() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "gas-ppe-graphic";

  // scba cylinder group (left)
  const scbaGroup = new THREE.Group();
  scbaGroup.position.set(-0.35, 0.15, 0);
  const tankGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.32, 16);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4 });
  const tank = new THREE.Mesh(tankGeo, tankMat);
  tank.position.set(0, 0.16, 0);
  scbaGroup.add(tank);

  const valveGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.05, 12);
  const valveMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
  const valve = new THREE.Mesh(valveGeo, valveMat);
  valve.position.set(0, 0.34, 0);
  scbaGroup.add(valve);
  group.add(scbaGroup);

  // multi-gas detector group (center)
  const detGroup = new THREE.Group();
  detGroup.position.set(0, 0.15, 0);
  const bodyGeo = new THREE.BoxGeometry(0.12, 0.22, 0.06);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.11, 0);
  detGroup.add(body);

  const lcdGeo = new THREE.BoxGeometry(0.09, 0.08, 0.005);
  const lcdMat = new THREE.MeshBasicMaterial({ color: 0x064e3b });
  const lcd = new THREE.Mesh(lcdGeo, lcdMat);
  lcd.position.set(0, 0.14, 0.032);
  detGroup.add(lcd);
  group.add(detGroup);

  // safety harness group (right)
  const harnessGroup = new THREE.Group();
  harnessGroup.position.set(0.35, 0.15, 0);
  const torusGeo = new THREE.TorusGeometry(0.09, 0.02, 12, 24);
  const torusMat = new THREE.MeshStandardMaterial({ color: 0x84cc16 });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.position.set(0, 0.16, 0);
  harnessGroup.add(torus);

  const dRingGeo = new THREE.TorusGeometry(0.035, 0.008, 8, 16);
  const dRingMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9 });
  const dRing = new THREE.Mesh(dRingGeo, dRingMat);
  dRing.position.set(0, 0.23, -0.02);
  harnessGroup.add(dRing);
  group.add(harnessGroup);

  // load real glb ppe models if gltf loader present
  if (THREE.GLTFLoader) {
    try {
      const loader = new THREE.GLTFLoader();

      // 4. scba respirator model: procedural bbox 0.472m -> target 0.5m
      loader.load("./assets/models/gas-leak/scba_respirator.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          model.position.set(0, 0.05, 0);
          normalizeModelScale(model, 0.5, 1.06);
          model.rotation.set(0, Math.PI / 2, 0);
          scbaGroup.clear ? scbaGroup.clear() : (scbaGroup.children = []);
          scbaGroup.add(model);
        }
      }, undefined, () => {});

      // 5. multi-gas detector model: bbox 0.542m -> target 0.15m
      loader.load("./assets/models/gas-leak/h2s_detector.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          model.position.set(0, 0.08, 0);
          normalizeModelScale(model, 0.15, 0.277);
          detGroup.clear ? detGroup.clear() : (detGroup.children = []);
          detGroup.add(model);
        }
      }, undefined, () => {});

      // 6. safety harness model: bbox 0.436m -> target 0.6m
      loader.load("./assets/models/gas-leak/safety_harness.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          model.position.set(0, 0.08, 0);
          normalizeModelScale(model, 0.6, 1.38);
          harnessGroup.clear ? harnessGroup.clear() : (harnessGroup.children = []);
          harnessGroup.add(model);
        }
      }, undefined, () => {});
    } catch {
      // fallback meshes already attached
    }
  }

  return group;
}

export {
  buildHazardZoneEntity,
  buildPpeDisplayEntity,
  createHazardZoneThreeMesh,
  createPpeThreeMesh,
  normalizeModelScale
};


