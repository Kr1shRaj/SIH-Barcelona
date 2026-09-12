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
    <!-- scba compressed breathing air cylinder -->
    <a-entity id="ppe-scba-model" gltf-model="url(./assets/models/gas-leak/scba_respirator.glb)" position="-0.3 0.15 0" scale="0.35 0.35 0.35" rotation="0 0 0"></a-entity>
    <!-- handheld atmospheric multi-gas detector -->
    <a-entity id="ppe-detector-model" gltf-model="url(./assets/models/gas-leak/multi_gas_detector.glb)" position="0 0.15 0" scale="0.3 0.3 0.3" rotation="0 0 0"></a-entity>
    <!-- safety harness fall arrest equipment pack -->
    <a-entity id="ppe-harness-model" gltf-model="url(./assets/models/gas-leak/safety_harness.glb)" position="0.3 0.15 0" scale="0.35 0.35 0.35" rotation="0 0 0"></a-entity>
  `;

  return entity;
}

export { buildHazardZoneEntity, buildPpeDisplayEntity };
