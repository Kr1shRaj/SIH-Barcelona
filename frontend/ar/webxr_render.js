// three.js mesh builders for tier 1 webxr rendering (no a-frame)
// uses window.THREE from already-loaded a-frame 1.3.0 bundle (r137)

// get THREE from global scope (a-frame bundles it)
function getTHREE() {
  if (typeof window !== "undefined" && window.THREE) return window.THREE;
  return null;
}

// build placement reticle ring that sits on detected surfaces
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

// build fire barrel + flames + smoke as three.js group
function createFireMesh() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "fire-graphic";

  // floor scorch mark decal
  const scorchGeo = new THREE.CircleGeometry(0.85, 32);
  const scorchMat = new THREE.MeshBasicMaterial({
    color: 0x050505, transparent: true, opacity: 0.55
  });
  const scorch = new THREE.Mesh(scorchGeo, scorchMat);
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(0, 0.01, 0);
  scorch.name = "floor-scorch-decal";
  group.add(scorch);

  // corrugated industrial trash bin
  const barrelGeo = new THREE.CylinderGeometry(0.52, 0.44, 0.84, 24);
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x475569, metalness: 0.8, roughness: 0.35
  });
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  barrel.position.set(0, 0.42, 0);
  barrel.name = "fire-barrel";
  group.add(barrel);

  // corrugation reinforcement ribs
  [-0.15, 0.05, 0.25].forEach((offsetY, idx) => {
    const ribGeo = new THREE.TorusGeometry(0.46 + idx * 0.025, 0.018, 8, 32);
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85 });
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.rotation.x = Math.PI / 2;
    rib.position.set(0, 0.42 + offsetY, 0);
    group.add(rib);
  });

  // barrel rim
  const rimGeo = new THREE.TorusGeometry(0.53, 0.026, 8, 32);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 0.84, 0);
  rim.name = "fire-barrel-rim";
  group.add(rim);

  // charred trash heap
  const trashGeo = new THREE.DodecahedronGeometry(0.46);
  const trashMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.9 });
  const trash = new THREE.Mesh(trashGeo, trashMat);
  trash.position.set(0, 0.78, 0);
  trash.name = "fire-trash-heap";
  group.add(trash);

  // ember bed
  const emberGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.05, 24);
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
  const ember = new THREE.Mesh(emberGeo, emberMat);
  ember.position.set(0, 0.82, 0);
  ember.name = "fire-embers";
  group.add(ember);

  // outer flame cone
  const outerGeo = new THREE.ConeGeometry(0.56, 1.80, 16);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xff3d00, transparent: true, opacity: 0.90
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.position.set(0, 1.75, 0);
  outer.name = "fire-outer-cone";
  group.add(outer);

  // inner flame cone
  const innerGeo = new THREE.ConeGeometry(0.40, 1.30, 16);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffea00, transparent: true, opacity: 0.95
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.position.set(0, 1.45, 0);
  inner.name = "fire-inner-cone";
  group.add(inner);

  // tongue left
  const tongueGeoL = new THREE.ConeGeometry(0.36, 1.45, 12);
  const tongueMat = new THREE.MeshBasicMaterial({
    color: 0xff6d00, transparent: true, opacity: 0.88
  });
  const tongueL = new THREE.Mesh(tongueGeoL, tongueMat);
  tongueL.position.set(0.08, 1.55, -0.04);
  tongueL.rotation.set(0.14, 0.70, -0.21);
  tongueL.name = "fire-tongue-left";
  group.add(tongueL);

  // tongue right
  const tongueGeoR = new THREE.ConeGeometry(0.34, 1.38, 12);
  const tongueMatR = new THREE.MeshBasicMaterial({
    color: 0xff9100, transparent: true, opacity: 0.88
  });
  const tongueR = new THREE.Mesh(tongueGeoR, tongueMatR);
  tongueR.position.set(-0.08, 1.57, 0.04);
  tongueR.rotation.set(-0.17, -0.70, 0.17);
  tongueR.name = "fire-tongue-right";
  group.add(tongueR);

  // point light for fire illumination
  const fireLight = new THREE.PointLight(0xff7700, 2.0, 5);
  fireLight.position.set(0, 1.6, 0);
  fireLight.name = "fire-light";
  group.add(fireLight);

  // aim target (invisible cylinder for raycasting)
  const targetGeo = new THREE.CylinderGeometry(0.70, 0.70, 0.12, 16);
  const targetMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.0
  });
  const target = new THREE.Mesh(targetGeo, targetMat);
  target.position.set(0, 0.85, 0);
  target.name = "fire-target-base";
  target.userData.raycastTarget = "aim";
  group.add(target);

  // store animation state
  group.userData._animTime = 0;

  return group;
}

// animate fire flames (call each frame with delta)
function animateFireMesh(fireGroup, deltaMs) {
  if (!fireGroup || !fireGroup.userData) return;
  fireGroup.userData._animTime = (fireGroup.userData._animTime || 0) + deltaMs;
  const t = fireGroup.userData._animTime;

  const extProgress = typeof fireGroup.userData.extinguishProgress === "number"
    ? fireGroup.userData.extinguishProgress
    : 0;
  const flameFactor = Math.max(0.01, 1.0 - extProgress * 0.96);

  const outer = fireGroup.getObjectByName("fire-outer-cone");
  const inner = fireGroup.getObjectByName("fire-inner-cone");
  const tongueL = fireGroup.getObjectByName("fire-tongue-left");
  const tongueR = fireGroup.getObjectByName("fire-tongue-right");
  const light = fireGroup.getObjectByName("fire-light");
  const ember = fireGroup.getObjectByName("fire-embers");

  if (outer) {
    const s = (0.92 + 0.16 * Math.sin(t * 0.0285)) * flameFactor;
    const sy = (0.85 + 0.33 * Math.sin(t * 0.0285)) * flameFactor;
    outer.scale.set(s, sy, s);
  }
  if (inner) {
    const s = (0.85 + 0.30 * Math.sin(t * 0.037)) * flameFactor;
    const sy = (0.80 + 0.45 * Math.sin(t * 0.037)) * flameFactor;
    inner.scale.set(s, sy, s);
  }
  if (tongueL) {
    tongueL.rotation.z = -0.21 + 0.14 * Math.sin(t * 0.025);
    tongueL.scale.set(flameFactor, flameFactor, flameFactor);
  }
  if (tongueR) {
    tongueR.rotation.z = 0.17 - 0.14 * Math.sin(t * 0.033);
    tongueR.scale.set(flameFactor, flameFactor, flameFactor);
  }
  if (light) {
    light.intensity = (1.5 + 1.1 * Math.sin(t * 0.045)) * flameFactor;
  }
  if (ember && ember.material) {
    if (extProgress >= 0.95) {
      ember.material.color.setRGB(0.12, 0.16, 0.23);
    } else {
      const r = 0.27 + 0.13 * Math.sin(t * 0.031);
      ember.material.color.setRGB(1.0, r, 0.0);
    }
  }
}

// build fire extinguisher as three.js group
function createExtinguisherMesh() {
  const THREE = getTHREE();
  if (!THREE) return null;

  const group = new THREE.Group();
  group.name = "extinguisher-graphic";

  // main red cylinder body
  const bodyGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.30, 24);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.65, 0);
  body.name = "ext-body";
  group.add(body);

  // top dome
  const topGeo = new THREE.SphereGeometry(0.38, 16, 16);
  const topMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.scale.set(1, 0.40, 1);
  top.position.set(0, 1.30, 0);
  top.name = "ext-top-dome";
  group.add(top);

  // bottom dome
  const botGeo = new THREE.SphereGeometry(0.38, 16, 16);
  const botMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const bot = new THREE.Mesh(botGeo, botMat);
  bot.scale.set(1, 0.30, 1);
  bot.position.set(0, 0.0, 0);
  bot.name = "ext-bottom-dome";
  group.add(bot);

  // base ring
  const baseGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.14, 24);
  const baseMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, -0.07, 0);
  base.name = "ext-base";
  group.add(base);

  // valve block (brass)
  const valveGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.14, 16);
  const valveMat = new THREE.MeshStandardMaterial({
    color: 0xd97706, metalness: 0.85, roughness: 0.2
  });
  const valve = new THREE.Mesh(valveGeo, valveMat);
  valve.position.set(0, 1.49, 0);
  valve.name = "ext-valve-block";
  group.add(valve);

  // neck
  const neckGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 16);
  const neck = new THREE.Mesh(neckGeo, valveMat.clone());
  neck.position.set(0, 1.39, 0);
  neck.name = "ext-neck";
  group.add(neck);

  // handle lever
  const handleGeo = new THREE.BoxGeometry(0.45, 0.08, 0.12);
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x334155, metalness: 0.5, roughness: 0.3
  });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.set(0.15, 1.53, 0);
  handle.rotation.z = -0.21;
  handle.name = "extinguisher-handle";
  handle.userData.raycastTarget = "handle";
  group.add(handle);

  // safety pin (gold)
  const pinGroup = new THREE.Group();
  pinGroup.name = "extinguisher-pin";
  pinGroup.position.set(0.06, 1.53, 0.15);

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
  arrowGroup.position.set(0.26, 2.10, 0.15);

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

  // store animation state
  group.userData._animTime = 0;
  group.userData._pinPulled = false;

  return group;
}

// animate extinguisher guide arrow bounce (call each frame)
function animateExtinguisherMesh(extGroup, deltaMs) {
  if (!extGroup || !extGroup.userData) return;
  extGroup.userData._animTime = (extGroup.userData._animTime || 0) + deltaMs;
  const t = extGroup.userData._animTime;

  const arrow = extGroup.getObjectByName("extinguisher-guide-arrow");
  if (arrow && !extGroup.userData._pinPulled) {
    arrow.position.y = 2.10 + 0.15 * Math.sin(t * 0.008);
  }

  const ring = extGroup.getObjectByName("ext-pin-ring");
  if (ring && !extGroup.userData._pinPulled) {
    const s = 1.0 + 0.25 * Math.sin(t * 0.009);
    ring.scale.set(s, s, s);
  }
}

// compute fire spawn position 2m in front of placed extinguisher
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
  getTHREE,
  createPlacementReticle,
  createFireMesh,
  animateFireMesh,
  createExtinguisherMesh,
  animateExtinguisherMesh,
  calcFireOffsetPosition
};
