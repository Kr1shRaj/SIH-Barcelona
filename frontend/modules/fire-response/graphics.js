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
    entity.setAttribute("position", "-0.38 0.05 0.15");
    entity.setAttribute("rotation", "0 20 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <a-cylinder id="ext-body" position="0 0.28 0" radius="0.15" height="0.58" material="color: #d32f2f; metalness: 0.3; roughness: 0.3"></a-cylinder>
    <a-cylinder id="ext-base" position="0 -0.02 0" radius="0.155" height="0.04" material="color: #1e293b"></a-cylinder>
    <a-cylinder id="ext-neck" position="0 0.58 0" radius="0.045" height="0.06" material="color: #0f172a"></a-cylinder>
    <a-box id="ext-handle" position="0.06 0.62 0" width="0.16" height="0.025" depth="0.05" rotation="0 0 -12" material="color: #334155"></a-box>
    <a-cylinder id="ext-hose" position="-0.12 0.38 0.08" radius="0.025" height="0.35" rotation="20 0 -35" material="color: #0f172a"></a-cylinder>
    <a-cone id="ext-nozzle" position="-0.19 0.24 0.12" radius-bottom="0.04" radius-top="0.018" height="0.09" rotation="45 0 -45" material="color: #1e293b"></a-cone>
  `;

  // pin root sub-entity on extinguisher top
  const pin = document.createElement("a-entity");
  pin.id = "extinguisher-pin";
  if (typeof pin.setAttribute === "function") {
    pin.setAttribute("class", "clickable");
    pin.setAttribute("data-raycast-target", "pin");
    pin.setAttribute("position", "0.03 0.62 0.05");
  } else {
    pin.className = "clickable";
  }

  // visible pin shaft (golden metal)
  const pinShaft = document.createElement("a-cylinder");
  pinShaft.id = "ext-pin-shaft";
  if (typeof pinShaft.setAttribute === "function") {
    pinShaft.setAttribute("rotation", "90 0 0");
    pinShaft.setAttribute("radius", "0.028");
    pinShaft.setAttribute("height", "0.14");
    pinShaft.setAttribute("material", "color: #fbbf24; metalness: 0.8; roughness: 0.2");
  }

  // visible gold pull ring with gentle pulse animation affordance
  const pinRing = document.createElement("a-torus");
  pinRing.id = "ext-pin-ring";
  if (typeof pinRing.setAttribute === "function") {
    pinRing.setAttribute("position", "0.07 0 0");
    pinRing.setAttribute("rotation", "0 90 0");
    pinRing.setAttribute("radius", "0.055");
    pinRing.setAttribute("radius-tubular", "0.012");
    pinRing.setAttribute("material", "color: #fbbf24; metalness: 0.8; roughness: 0.2");
    pinRing.setAttribute("animation", "property: scale; to: 1.15 1.15 1.15; dir: alternate; dur: 900; loop: true; easing: easeInOutSine");
  }

  // generous invisible touch hit proxy (0.38m box ~ 100px touch target)
  const pinHitbox = document.createElement("a-box");
  pinHitbox.id = "pin-hitbox";
  if (typeof pinHitbox.setAttribute === "function") {
    pinHitbox.setAttribute("class", "clickable");
    pinHitbox.setAttribute("width", "0.38");
    pinHitbox.setAttribute("height", "0.38");
    pinHitbox.setAttribute("depth", "0.38");
    pinHitbox.setAttribute("material", "opacity: 0.0; transparent: true");
  }

  pin.appendChild(pinShaft);
  pin.appendChild(pinRing);
  pin.appendChild(pinHitbox);

  // 3d progress bar next to pin in marker space
  const progressContainer = document.createElement("a-entity");
  progressContainer.id = "extinguisher-pin-progress";
  if (typeof progressContainer.setAttribute === "function") {
    progressContainer.setAttribute("position", "0.22 0.72 0.06");
    progressContainer.setAttribute("rotation", "0 0 0");
  }

  const progressBg = document.createElement("a-box");
  progressBg.id = "pin-progress-bg";
  if (typeof progressBg.setAttribute === "function") {
    progressBg.setAttribute("width", "0.28");
    progressBg.setAttribute("height", "0.05");
    progressBg.setAttribute("depth", "0.015");
    progressBg.setAttribute("material", "color: #0f172a; opacity: 0.9");
  }

  const progressFill = document.createElement("a-box");
  progressFill.id = "pin-progress-fill";
  if (typeof progressFill.setAttribute === "function") {
    progressFill.setAttribute("position", "-0.135 0 0.008");
    progressFill.setAttribute("width", "0.27");
    progressFill.setAttribute("height", "0.04");
    progressFill.setAttribute("depth", "0.02");
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


