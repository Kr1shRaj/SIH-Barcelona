// build 3d fire entity for a-frame marker anchor
function buildFireEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "fire-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("data-raycast-target", "fire");
    entity.setAttribute("position", "0.45 0 -0.10");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <a-cone id="fire-outer-cone" position="0 0.75 0" radius-bottom="0.55" radius-top="0.08" height="1.50" material="color: #ff4500; opacity: 0.92; roughness: 0.4"></a-cone>
    <a-cone id="fire-inner-cone" position="0 0.50 0" radius-bottom="0.38" radius-top="0.04" height="1.05" material="color: #ffeb3b; opacity: 0.95"></a-cone>
    <a-cylinder id="fire-target-base" position="0 0.05 0" radius="0.58" height="0.10" material="color: #ff1100; opacity: 0.85"></a-cylinder>
  `;

  // 3d aim reticle at the base of the fire
  const aimReticle = document.createElement("a-ring");
  aimReticle.id = "aim-reticle";
  if (typeof aimReticle.setAttribute === "function") {
    aimReticle.setAttribute("class", "clickable");
    aimReticle.setAttribute("data-raycast-target", "aim");
    aimReticle.setAttribute("position", "0 0.12 0");
    aimReticle.setAttribute("rotation", "-90 0 0");
    aimReticle.setAttribute("radius-inner", "0.32");
    aimReticle.setAttribute("radius-outer", "0.60");
    aimReticle.setAttribute("material", "color: #ff3d00; emissive: #ff3d00; emissiveIntensity: 0.8; side: double");
    aimReticle.setAttribute("animation", "property: scale; to: 1.15 1.15 1.15; dir: alternate; dur: 600; loop: true; easing: easeInOutSine");
  } else {
    aimReticle.className = "clickable";
  }

  entity.appendChild(aimReticle);
  return entity;
}

// build 3d exit sign entity for a-frame marker anchor
function buildExitEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "exit-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("position", "0.45 0.4 0");
    entity.setAttribute("rotation", "0 -15 0");
    entity.setAttribute("animation", "property: scale; to: 1.08 1.08 1.08; dir: alternate; dur: 800; loop: true; easing: easeInOutSine");
  } else {
    entity.className = "clickable";
  }

  // standard ISO green emergency exit board with unmistakable white directional arrow silhouette
  entity.innerHTML = `
    <a-box id="exit-board" position="0 0 0" width="0.75" height="0.38" depth="0.04" material="color: #00873d; emissive: #005a28; emissiveIntensity: 0.35"></a-box>
    <a-box id="exit-arrow-shaft" position="-0.09 0 0.025" width="0.28" height="0.10" depth="0.01" material="color: #ffffff; emissive: #ffffff; emissiveIntensity: 0.3"></a-box>
    <a-triangle id="exit-arrow-head" vertex-a="0.24 0 0.025" vertex-b="0.05 0.13 0.025" vertex-c="0.05 -0.13 0.025" material="color: #ffffff; emissive: #ffffff; emissiveIntensity: 0.3"></a-triangle>
  `;

  return entity;
}

// build 3d fire extinguisher entity anchored to marker
function buildExtinguisherEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "extinguisher-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("position", "-0.70 0 0.25");
    entity.setAttribute("rotation", "0 25 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <a-cylinder id="ext-body" position="0 0.55 0" radius="0.28" height="1.10" material="color: #d32f2f; metalness: 0.3; roughness: 0.3"></a-cylinder>
    <a-cylinder id="ext-base" position="0 -0.04 0" radius="0.29" height="0.08" material="color: #1e293b"></a-cylinder>
    <a-cylinder id="ext-neck" position="0 1.15 0" radius="0.08" height="0.10" material="color: #0f172a"></a-cylinder>
    <a-cylinder id="ext-hose" position="-0.22 0.70 0.15" radius="0.04" height="0.65" rotation="20 0 -35" material="color: #0f172a"></a-cylinder>
    <a-cone id="ext-nozzle" position="-0.34 0.45 0.22" radius-bottom="0.07" radius-top="0.03" height="0.18" rotation="45 0 -45" material="color: #1e293b"></a-cone>
  `;

  // 3d operating handle lever on top of extinguisher
  const handle = document.createElement("a-box");
  handle.id = "extinguisher-handle";
  if (typeof handle.setAttribute === "function") {
    handle.setAttribute("class", "clickable");
    handle.setAttribute("data-raycast-target", "handle");
    handle.setAttribute("position", "0.12 1.22 0");
    handle.setAttribute("width", "0.30");
    handle.setAttribute("height", "0.05");
    handle.setAttribute("depth", "0.08");
    handle.setAttribute("rotation", "0 0 -12");
    handle.setAttribute("material", "color: #334155; metalness: 0.5; roughness: 0.3");
  } else {
    handle.className = "clickable";
  }

  // pin root sub-entity on extinguisher top
  const pin = document.createElement("a-entity");
  pin.id = "extinguisher-pin";
  if (typeof pin.setAttribute === "function") {
    pin.setAttribute("class", "clickable");
    pin.setAttribute("data-raycast-target", "pin");
    pin.setAttribute("position", "0.05 1.22 0.10");
  } else {
    pin.className = "clickable";
  }

  // visible pin shaft (golden metal)
  const pinShaft = document.createElement("a-cylinder");
  pinShaft.id = "ext-pin-shaft";
  if (typeof pinShaft.setAttribute === "function") {
    pinShaft.setAttribute("rotation", "90 0 0");
    pinShaft.setAttribute("radius", "0.055");
    pinShaft.setAttribute("height", "0.26");
    pinShaft.setAttribute("material", "color: #fbbf24; metalness: 0.8; roughness: 0.2");
  }

  // visible gold pull ring with gentle pulse animation affordance
  const pinRing = document.createElement("a-torus");
  pinRing.id = "ext-pin-ring";
  if (typeof pinRing.setAttribute === "function") {
    pinRing.setAttribute("position", "0.14 0 0");
    pinRing.setAttribute("rotation", "0 90 0");
    pinRing.setAttribute("radius", "0.11");
    pinRing.setAttribute("radius-tubular", "0.022");
    pinRing.setAttribute("material", "color: #fbbf24; emissive: #f59e0b; emissiveIntensity: 0.7; metalness: 0.6; roughness: 0.2");
    pinRing.setAttribute("animation", "property: scale; to: 1.25 1.25 1.25; dir: alternate; dur: 700; loop: true; easing: easeInOutSine");
  }

  // generous invisible touch hit proxy (0.75m box ~ dominant touch target)
  const pinHitbox = document.createElement("a-box");
  pinHitbox.id = "pin-hitbox";
  if (typeof pinHitbox.setAttribute === "function") {
    pinHitbox.setAttribute("class", "clickable");
    pinHitbox.setAttribute("width", "0.75");
    pinHitbox.setAttribute("height", "0.75");
    pinHitbox.setAttribute("depth", "0.75");
    pinHitbox.setAttribute("material", "opacity: 0.0; transparent: true");
  }

  pin.appendChild(pinShaft);
  pin.appendChild(pinRing);
  pin.appendChild(pinHitbox);

  // 3d progress bar next to pin in marker space
  const progressContainer = document.createElement("a-entity");
  progressContainer.id = "extinguisher-pin-progress";
  if (typeof progressContainer.setAttribute === "function") {
    progressContainer.setAttribute("position", "0.35 1.45 0.12");
    progressContainer.setAttribute("rotation", "0 0 0");
  }

  const progressBg = document.createElement("a-box");
  progressBg.id = "pin-progress-bg";
  if (typeof progressBg.setAttribute === "function") {
    progressBg.setAttribute("width", "0.55");
    progressBg.setAttribute("height", "0.09");
    progressBg.setAttribute("depth", "0.03");
    progressBg.setAttribute("material", "color: #0f172a; opacity: 0.9");
  }

  const progressFill = document.createElement("a-box");
  progressFill.id = "pin-progress-fill";
  if (typeof progressFill.setAttribute === "function") {
    progressFill.setAttribute("position", "-0.265 0 0.016");
    progressFill.setAttribute("width", "0.53");
    progressFill.setAttribute("height", "0.08");
    progressFill.setAttribute("depth", "0.035");
    progressFill.setAttribute("scale", "0.01 1 1");
    progressFill.setAttribute("material", "color: #10b981; opacity: 0.95");
  }

  progressContainer.appendChild(progressBg);
  progressContainer.appendChild(progressFill);

  entity.appendChild(handle);
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


