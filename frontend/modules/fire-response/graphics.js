// build 3d fire entity for a-frame marker anchor
function buildFireEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "fire-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("data-raycast-target", "fire");
    entity.setAttribute("position", "0 0.3 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <a-cone position="0 0.35 0" radius-bottom="0.35" radius-top="0.04" height="0.8" material="color: #ff4500; opacity: 0.92; roughness: 0.4"></a-cone>
    <a-cone position="0 0.22 0" radius-bottom="0.22" radius-top="0.02" height="0.55" material="color: #ffeb3b; opacity: 0.95"></a-cone>
    <a-cylinder id="fire-target-base" position="0 0 0" radius="0.4" height="0.08" material="color: #ff1100; opacity: 0.75"></a-cylinder>
  `;

  return entity;
}

// build 3d exit sign entity for a-frame marker anchor
function buildExitEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "exit-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("position", "1.0 0.5 0");
  }

  entity.innerHTML = `
    <a-box position="0 0 0" width="0.7" height="0.45" depth="0.06" material="color: #00a651"></a-box>
    <a-triangle vertex-a="0.2 0 0.04" vertex-b="0.02 0.12 0.04" vertex-c="0.02 -0.12 0.04" material="color: #ffffff"></a-triangle>
  `;

  return entity;
}

// aliases for backward compatibility
const buildFireGraphic = buildFireEntity;
const buildExitGraphic = buildExitEntity;

export { buildFireEntity, buildExitEntity, buildFireGraphic, buildExitGraphic };

