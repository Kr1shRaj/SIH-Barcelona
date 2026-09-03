// build 3d gas hazard zone entity for a-frame marker anchor
function buildHazardZoneEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "gas-hazard-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("position", "0 0.25 0");
  }

  entity.innerHTML = `
    <a-cylinder position="0 0.15 0" radius="0.6" height="0.35" material="color: #f59e0b; opacity: 0.4; transparent: true; roughness: 0.5"></a-cylinder>
    <a-ring position="0 0.02 0" rotation="-90 0 0" radius-inner="0.55" radius-outer="0.65" material="color: #ef4444; opacity: 0.85"></a-ring>
    <a-box position="0 0.45 0" width="0.3" height="0.3" depth="0.05" material="color: #f59e0b"></a-box>
    <a-sphere position="0 0.65 0" radius="0.16" material="color: #84cc16; opacity: 0.5; transparent: true"></a-sphere>
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
    <a-cylinder position="-0.2 0.2 0" radius="0.07" height="0.35" material="color: #3b82f6"></a-cylinder>
    <a-box position="0.18 0.2 0" width="0.14" height="0.18" depth="0.08" material="color: #eab308"></a-box>
    <a-torus position="0 0.38 0" radius="0.12" radius-tubular="0.02" material="color: #ef4444"></a-torus>
  `;

  return entity;
}

export { buildHazardZoneEntity, buildPpeDisplayEntity };
