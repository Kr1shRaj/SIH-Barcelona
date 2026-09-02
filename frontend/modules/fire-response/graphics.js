// build 3d fire entity for a-frame marker anchor
function buildFireEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "fire-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("data-raycast-target", "fire");
    entity.setAttribute("position", "0 0 0");
    entity.setAttribute("rotation", "-90 0 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <a-cone id="fire-outer-cone" position="0 1.10 0" radius-bottom="0.80" radius-top="0.10" height="2.20" material="color: #ff4500; opacity: 0.92; roughness: 0.4"></a-cone>
    <a-cone id="fire-inner-cone" position="0 0.75 0" radius-bottom="0.55" radius-top="0.05" height="1.50" material="color: #ffeb3b; opacity: 0.95"></a-cone>
    <a-cylinder id="fire-target-base" class="clickable aim-target" data-raycast-target="aim" position="0 0.08 0" radius="0.85" height="0.15" material="color: #ff1100; opacity: 0.85"></a-cylinder>
  `;

  // 3d aim reticle at the base of the fire
  const aimReticle = document.createElement("a-ring");
  aimReticle.id = "aim-reticle";
  if (typeof aimReticle.setAttribute === "function") {
    aimReticle.setAttribute("class", "clickable aim-target");
    aimReticle.setAttribute("data-raycast-target", "aim");
    aimReticle.setAttribute("position", "0 0.16 0");
    aimReticle.setAttribute("rotation", "-90 0 0");
    aimReticle.setAttribute("radius-inner", "0.45");
    aimReticle.setAttribute("radius-outer", "0.88");
    aimReticle.setAttribute("material", "color: #ff3d00; emissive: #ff3d00; emissiveIntensity: 0.8; side: double");
    aimReticle.setAttribute("animation", "property: scale; to: 1.15 1.15 1.15; dir: alternate; dur: 600; loop: true; easing: easeInOutSine");
  } else {
    aimReticle.className = "clickable aim-target";
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
    entity.setAttribute("position", "0 0.5 0");
    entity.setAttribute("rotation", "0 -15 0");
    entity.setAttribute("animation", "property: scale; to: 1.08 1.08 1.08; dir: alternate; dur: 800; loop: true; easing: easeInOutSine");
  } else {
    entity.className = "clickable";
  }

  // standard ISO green emergency exit board with unmistakable white directional arrow silhouette
  entity.innerHTML = `
    <a-box id="exit-board" position="0 0 0" width="1.10" height="0.55" depth="0.06" material="color: #00873d; emissive: #005a28; emissiveIntensity: 0.35"></a-box>
    <a-box id="exit-arrow-shaft" position="-0.13 0 0.035" width="0.42" height="0.15" depth="0.01" material="color: #ffffff; emissive: #ffffff; emissiveIntensity: 0.3"></a-box>
    <a-triangle id="exit-arrow-head" vertex-a="0.36 0 0.035" vertex-b="0.08 0.20 0.035" vertex-c="0.08 -0.20 0.035" material="color: #ffffff; emissive: #ffffff; emissiveIntensity: 0.3"></a-triangle>
  `;

  return entity;
}

// build 3d fire extinguisher entity anchored to marker
function buildExtinguisherEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "extinguisher-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("position", "0 0 0");
    // -90 deg on X aligns extinguisher upright on marker with valve at top and base at bottom
    entity.setAttribute("rotation", "-90 0 0");
  } else {
    entity.className = "clickable";
  }

  // extinguisher centered directly at (0, 0, 0) on Hiro marker
  entity.innerHTML = `
    <a-cylinder id="ext-body" position="0 0 0" radius="0.38" height="1.40" material="color: #dc2626; metalness: 0.3; roughness: 0.3"></a-cylinder>
    <a-cylinder id="ext-base" position="0 -0.72 0" radius="0.40" height="0.12" material="color: #0f172a"></a-cylinder>
    <a-cylinder id="ext-neck" position="0 0.76 0" radius="0.12" height="0.14" material="color: #1e293b"></a-cylinder>
    <a-cylinder id="ext-hose" position="-0.30 0.15 0.20" radius="0.06" height="0.95" rotation="20 0 -35" material="color: #0f172a"></a-cylinder>
    <a-cone id="ext-nozzle" position="-0.45 -0.20 0.30" radius-bottom="0.10" radius-top="0.04" height="0.26" rotation="45 0 -45" material="color: #1e293b"></a-cone>
  `;

  // 3d operating handle lever on top of extinguisher
  const handle = document.createElement("a-box");
  handle.id = "extinguisher-handle";
  if (typeof handle.setAttribute === "function") {
    handle.setAttribute("class", "clickable");
    handle.setAttribute("data-raycast-target", "handle");
    handle.setAttribute("position", "0.15 0.88 0");
    handle.setAttribute("width", "0.45");
    handle.setAttribute("height", "0.08");
    handle.setAttribute("depth", "0.12");
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
    pin.setAttribute("position", "0.06 0.88 0.15");
  } else {
    pin.className = "clickable";
  }

  // visible pin shaft (golden metal)
  const pinShaft = document.createElement("a-cylinder");
  pinShaft.id = "ext-pin-shaft";
  if (typeof pinShaft.setAttribute === "function") {
    pinShaft.setAttribute("class", "clickable");
    pinShaft.setAttribute("data-raycast-target", "pin");
    pinShaft.setAttribute("rotation", "90 0 0");
    pinShaft.setAttribute("radius", "0.08");
    pinShaft.setAttribute("height", "0.38");
    pinShaft.setAttribute("material", "color: #fbbf24; metalness: 0.8; roughness: 0.2");
  } else {
    pinShaft.className = "clickable";
  }

  // visible gold pull ring with gentle pulse animation affordance
  const pinRing = document.createElement("a-torus");
  pinRing.id = "ext-pin-ring";
  if (typeof pinRing.setAttribute === "function") {
    pinRing.setAttribute("class", "clickable");
    pinRing.setAttribute("data-raycast-target", "pin");
    pinRing.setAttribute("position", "0.20 0 0");
    pinRing.setAttribute("rotation", "0 90 0");
    pinRing.setAttribute("radius", "0.16");
    pinRing.setAttribute("radius-tubular", "0.032");
    pinRing.setAttribute("material", "color: #fbbf24; emissive: #f59e0b; emissiveIntensity: 0.7; metalness: 0.6; roughness: 0.2");
    pinRing.setAttribute("animation", "property: scale; to: 1.25 1.25 1.25; dir: alternate; dur: 700; loop: true; easing: easeInOutSine");
  } else {
    pinRing.className = "clickable";
  }

  pin.appendChild(pinShaft);
  pin.appendChild(pinRing);

  // 3d dynamic guide arrow pointing directly at interactive pin
  const guideArrow = document.createElement("a-entity");
  guideArrow.id = "extinguisher-guide-arrow";
  if (typeof guideArrow.setAttribute === "function") {
    guideArrow.setAttribute("position", "0.26 1.45 0.15");
    guideArrow.setAttribute("animation", "property: position; to: 0.26 1.15 0.15; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
  }

  const arrowCone = document.createElement("a-cone");
  arrowCone.id = "guide-arrow-cone";
  if (typeof arrowCone.setAttribute === "function") {
    arrowCone.setAttribute("position", "0 -0.15 0");
    arrowCone.setAttribute("radius-bottom", "0.16");
    arrowCone.setAttribute("radius-top", "0.01");
    arrowCone.setAttribute("height", "0.36");
    arrowCone.setAttribute("rotation", "180 0 0");
    arrowCone.setAttribute("material", "color: #facc15; emissive: #facc15; emissiveIntensity: 1.0; side: double");
  }

  const arrowShaft = document.createElement("a-cylinder");
  arrowShaft.id = "guide-arrow-shaft";
  if (typeof arrowShaft.setAttribute === "function") {
    arrowShaft.setAttribute("position", "0 0.16 0");
    arrowShaft.setAttribute("radius", "0.06");
    arrowShaft.setAttribute("height", "0.32");
    arrowShaft.setAttribute("material", "color: #facc15; emissive: #facc15; emissiveIntensity: 0.9; side: double");
  }

  const arrowText = document.createElement("a-text");
  arrowText.id = "guide-arrow-text";
  if (typeof arrowText.setAttribute === "function") {
    arrowText.setAttribute("value", "TAP PIN");
    arrowText.setAttribute("align", "center");
    arrowText.setAttribute("position", "0 0.48 0");
    arrowText.setAttribute("scale", "1.0 1.0 1.0");
    arrowText.setAttribute("color", "#facc15");
    arrowText.setAttribute("material", "shader: flat; side: double");
  }

  guideArrow.appendChild(arrowCone);
  guideArrow.appendChild(arrowShaft);
  guideArrow.appendChild(arrowText);

  // 3d progress bar next to pin in marker space
  const progressContainer = document.createElement("a-entity");
  progressContainer.id = "extinguisher-pin-progress";
  if (typeof progressContainer.setAttribute === "function") {
    progressContainer.setAttribute("position", "0.50 1.05 0.18");
    progressContainer.setAttribute("rotation", "0 0 0");
  }

  const progressBg = document.createElement("a-box");
  progressBg.id = "pin-progress-bg";
  if (typeof progressBg.setAttribute === "function") {
    progressBg.setAttribute("width", "0.80");
    progressBg.setAttribute("height", "0.14");
    progressBg.setAttribute("depth", "0.04");
    progressBg.setAttribute("material", "color: #0f172a; opacity: 0.9");
  }

  const progressFill = document.createElement("a-box");
  progressFill.id = "pin-progress-fill";
  if (typeof progressFill.setAttribute === "function") {
    progressFill.setAttribute("position", "-0.385 0 0.022");
    progressFill.setAttribute("width", "0.77");
    progressFill.setAttribute("height", "0.12");
    progressFill.setAttribute("depth", "0.05");
    progressFill.setAttribute("scale", "0.01 1 1");
    progressFill.setAttribute("material", "color: #10b981; opacity: 0.95");
  }

  progressContainer.appendChild(progressBg);
  progressContainer.appendChild(progressFill);

  entity.appendChild(handle);
  entity.appendChild(pin);
  entity.appendChild(guideArrow);
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


