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

// build 3d fire extinguisher entity anchored to marker
function buildExtinguisherEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "extinguisher-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("position", "-0.45 0.25 0.1");
    entity.setAttribute("rotation", "0 25 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <a-cylinder id="ext-body" position="0 0.15 0" radius="0.09" height="0.36" material="color: #d32f2f; metalness: 0.3; roughness: 0.3"></a-cylinder>
    <a-cylinder id="ext-base" position="0 -0.03 0" radius="0.092" height="0.02" material="color: #1e293b"></a-cylinder>
    <a-cylinder id="ext-neck" position="0 0.34 0" radius="0.03" height="0.04" material="color: #0f172a"></a-cylinder>
    <a-box id="ext-handle" position="0.04 0.38 0" width="0.1" height="0.015" depth="0.03" rotation="0 0 -12" material="color: #334155"></a-box>
    <a-cylinder id="ext-hose" position="-0.07 0.25 0.05" radius="0.015" height="0.22" rotation="20 0 -35" material="color: #0f172a"></a-cylinder>
    <a-cone id="ext-nozzle" position="-0.12 0.16 0.08" radius-bottom="0.025" radius-top="0.01" height="0.06" rotation="45 0 -45" material="color: #1e293b"></a-cone>
  `;

  // pin sub-entity on extinguisher top
  const pin = document.createElement("a-cylinder");
  pin.id = "extinguisher-pin";
  if (typeof pin.setAttribute === "function") {
    pin.setAttribute("class", "clickable");
    pin.setAttribute("data-raycast-target", "pin");
    pin.setAttribute("position", "0.02 0.38 0.04");
    pin.setAttribute("rotation", "90 0 0");
    pin.setAttribute("radius", "0.018");
    pin.setAttribute("height", "0.07");
    pin.setAttribute("material", "color: #f59e0b; metalness: 0.8; roughness: 0.2");
  } else {
    pin.className = "clickable";
  }

  // 3d progress bar next to pin in marker space
  const progressContainer = document.createElement("a-entity");
  progressContainer.id = "extinguisher-pin-progress";
  if (typeof progressContainer.setAttribute === "function") {
    progressContainer.setAttribute("position", "0.12 0.44 0.04");
    progressContainer.setAttribute("rotation", "0 0 0");
  }

  const progressBg = document.createElement("a-box");
  progressBg.id = "pin-progress-bg";
  if (typeof progressBg.setAttribute === "function") {
    progressBg.setAttribute("width", "0.16");
    progressBg.setAttribute("height", "0.03");
    progressBg.setAttribute("depth", "0.01");
    progressBg.setAttribute("material", "color: #1e293b; opacity: 0.85");
  }

  const progressFill = document.createElement("a-box");
  progressFill.id = "pin-progress-fill";
  if (typeof progressFill.setAttribute === "function") {
    progressFill.setAttribute("position", "-0.075 0 0.005");
    progressFill.setAttribute("width", "0.15");
    progressFill.setAttribute("height", "0.024");
    progressFill.setAttribute("depth", "0.012");
    progressFill.setAttribute("scale", "0.01 1 1");
    progressFill.setAttribute("material", "color: #10b981; opacity: 0.95");
  }

  progressContainer.appendChild(progressBg);
  progressContainer.appendChild(progressFill);

  entity.appendChild(pin);
  entity.appendChild(progressContainer);

  return entity;
}

// aliases for backward compatibility
const buildFireGraphic = buildFireEntity;
const buildExitGraphic = buildExitEntity;
const buildExtinguisherGraphic = buildExtinguisherEntity;

export {
  buildFireEntity,
  buildExitEntity,
  buildExtinguisherEntity,
  buildFireGraphic,
  buildExitGraphic,
  buildExtinguisherGraphic
};


