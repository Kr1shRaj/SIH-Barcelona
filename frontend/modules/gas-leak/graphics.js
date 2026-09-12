// get three from global scope
function getTHREE() {
  if (typeof window !== "undefined" && window.THREE) return window.THREE;
  return null;
}

// build 3d gas hazard zone entity for a-frame marker anchor
function buildHazardZoneEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "gas-hazard-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("position", "0 0.25 0");
  }

  entity.innerHTML = `
    <!-- real 3d low poly hazard perimeter barrier -->
    <a-entity id="hazard-barrier-model" gltf-model="url(./assets/models/gas-leak/hazard_zone.glb)" position="0 0.1 0" scale="0.6 0.6 0.6" rotation="0 0 0"></a-entity>
    <a-ring position="0 0.02 0" rotation="-90 0 0" radius-inner="0.55" radius-outer="0.65" material="color: #ef4444; opacity: 0.85"></a-ring>
    <a-cylinder position="0 0.18 0" radius="0.6" height="0.35" material="color: #f59e0b; opacity: 0.35; transparent: true; roughness: 0.5"></a-cylinder>
  `;

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
    <!-- dedicated 3d scba breathing apparatus -->
    <a-entity id="ppe-scba-model" position="-0.3 0 0">
      <a-cylinder position="0 0.22 0" radius="0.065" height="0.32" material="color: #eab308; roughness: 0.4"></a-cylinder>
      <a-sphere position="0 0.38 0" radius="0.065" material="color: #eab308"></a-sphere>
      <a-cylinder position="0 0.44 0" radius="0.025" height="0.05" material="color: #94a3b8; metalness: 0.8"></a-cylinder>
      <a-torus position="0.03 0.32 0" radius="0.05" radius-tubular="0.012" material="color: #1e293b"></a-torus>
    </a-entity>
    <!-- dedicated 3d multi-gas atmospheric detector -->
    <a-entity id="ppe-detector-model" position="0 0 0">
      <a-box position="0 0.22 0" width="0.12" height="0.22" depth="0.06" material="color: #f97316; roughness: 0.5"></a-box>
      <a-box position="0 0.25 0.032" width="0.09" height="0.08" depth="0.005" material="color: #064e3b; roughness: 0.2"></a-box>
      <a-cylinder position="0 0.14 0.032" radius="0.035" height="0.01" rotation="90 0 0" material="color: #1e293b; metalness: 0.6"></a-cylinder>
      <a-sphere position="0 0.34 0" radius="0.02" material="color: #ef4444"></a-sphere>
    </a-entity>
    <!-- dedicated 3d full body safety harness and lifeline -->
    <a-entity id="ppe-harness-model" position="0.3 0 0">
      <a-torus position="0 0.26 0" radius="0.09" radius-tubular="0.02" material="color: #84cc16"></a-torus>
      <a-box position="0 0.12 0" width="0.18" height="0.12" depth="0.05" material="color: #1e293b"></a-box>
      <a-torus position="0 0.33 -0.02" radius="0.035" radius-tubular="0.008" rotation="90 0 0" material="color: #cbd5e1; metalness: 0.9"></a-torus>
      <a-cylinder position="0 0.06 0" radius="0.015" height="0.12" material="color: #eab308"></a-cylinder>
    </a-entity>
  `;

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

  // load real glb hazard barrier if gltf loader present
  if (THREE.GLTFLoader) {
    try {
      const loader = new THREE.GLTFLoader();
      loader.load("./assets/models/gas-leak/hazard_zone.glb", (gltf) => {
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (model) {
          model.position.set(0, 0.1, 0);
          model.scale.set(0.6, 0.6, 0.6);
          group.add(model);
          if (typeof onLoaded === "function") onLoaded(group);
        }
      }, undefined, () => {
        // fallback cylinder already attached
      });
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
  scbaGroup.position.set(-0.3, 0.15, 0);
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
  harnessGroup.position.set(0.3, 0.15, 0);
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

  return group;
}

export {
  buildHazardZoneEntity,
  buildPpeDisplayEntity,
  createHazardZoneThreeMesh,
  createPpeThreeMesh
};
