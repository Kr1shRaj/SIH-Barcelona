// build 3d realistic industrial fire entity matching SENAR benchmark
function buildFireEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "fire-graphic";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("data-raycast-target", "fire");
    entity.setAttribute("position", "0 0 0");
    entity.setAttribute("rotation", "0 0 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <!-- industrial metal waste bin fuel source with charred steel rim -->
    <a-cylinder id="fire-barrel" position="0 -0.40 0" radius="0.52" height="0.80" material="color: #1e293b; metalness: 0.7; roughness: 0.4"></a-cylinder>
    <a-torus id="fire-barrel-rim" position="0 0 0" rotation="90 0 0" radius="0.52" radius-tubular="0.025" material="color: #0f172a; metalness: 0.85"></a-torus>
    <a-cylinder id="fire-embers" position="0 -0.02 0" radius="0.48" height="0.06" material="color: #ff2200; emissive: #ff3300; emissiveIntensity: 1.8; shader: flat" animation="property: material.emissiveIntensity; to: 2.2; from: 1.4; dir: alternate; dur: 200; loop: true"></a-cylinder>

    <!-- dynamic flickering flame tongues (SENAR realistic fire look with radiant emissive glow) -->
    <a-cone id="fire-outer-cone" position="0 0.85 0" radius-bottom="0.56" radius-top="0.04" height="1.80" material="color: #ff3d00; shader: flat; opacity: 0.90; transparent: true" animation="property: scale; to: 1.08 1.18 1.08; from: 0.92 0.85 0.92; dir: alternate; dur: 220; loop: true; easing: easeInOutSine"></a-cone>
    <a-cone id="fire-inner-cone" position="0 0.60 0" radius-bottom="0.40" radius-top="0.02" height="1.30" material="color: #ffea00; shader: flat; opacity: 0.95; transparent: true" animation="property: scale; to: 1.15 1.25 1.15; from: 0.85 0.80 0.85; dir: alternate; dur: 170; loop: true; easing: easeInOutQuad"></a-cone>
    <a-cone id="fire-tongue-left" position="0.08 0.70 -0.04" rotation="8 40 -12" radius-bottom="0.36" radius-top="0.02" height="1.45" material="color: #ff6d00; shader: flat; opacity: 0.88; transparent: true" animation="property: rotation; to: 6 40 -16; from: 12 40 -8; dir: alternate; dur: 250; loop: true"></a-cone>
    <a-cone id="fire-tongue-right" position="-0.08 0.72 0.04" rotation="-10 -40 10" radius-bottom="0.34" radius-top="0.02" height="1.38" material="color: #ff9100; shader: flat; opacity: 0.88; transparent: true" animation="property: rotation; to: -14 -40 6; from: -6 -40 14; dir: alternate; dur: 190; loop: true"></a-cone>

    <!-- dynamic real-time fire point light casting flickering orange illumination -->
    <a-light id="fire-light" type="point" color="#ff7700" intensity="2.0" distance="5" position="0 0.8 0" animation="property: intensity; to: 2.6; from: 1.5; dir: alternate; dur: 140; loop: true"></a-light>

    <!-- rising smoke plume puffs drifting upward -->
    <a-sphere id="fire-smoke-1" position="0 1.6 0" radius="0.32" material="color: #334155; opacity: 0.35; transparent: true" animation="property: position; to: 0.08 2.4 0.04; dur: 1600; loop: true; easing: linear" animation__fade="property: material.opacity; to: 0; from: 0.35; dur: 1600; loop: true; easing: linear"></a-sphere>
    <a-sphere id="fire-smoke-2" position="-0.06 1.8 0" radius="0.38" material="color: #1e293b; opacity: 0.30; transparent: true" animation="property: position; to: -0.12 2.7 -0.04; dur: 2000; loop: true; easing: linear" animation__fade="property: material.opacity; to: 0; from: 0.30; dur: 2000; loop: true; easing: linear"></a-sphere>

    <!-- aim target base collision disc for gaze laser -->
    <a-cylinder id="fire-target-base" class="clickable aim-target" data-raycast-target="aim" position="0 0.05 0" radius="0.70" height="0.12" material="color: #ff1100; opacity: 0.0; transparent: true"></a-cylinder>
  `;

  // 3d aim reticle at the base of the fire container
  const aimReticle = document.createElement("a-ring");
  aimReticle.id = "aim-reticle";
  if (typeof aimReticle.setAttribute === "function") {
    aimReticle.setAttribute("class", "clickable aim-target");
    aimReticle.setAttribute("data-raycast-target", "aim");
    aimReticle.setAttribute("position", "0 0.12 0");
    aimReticle.setAttribute("rotation", "-90 0 0");
    aimReticle.setAttribute("radius-inner", "0.45");
    aimReticle.setAttribute("radius-outer", "0.78");
    aimReticle.setAttribute("material", "color: #ff3d00; emissive: #ff3d00; emissiveIntensity: 0.9; side: double");
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

  // extinguisher centered directly at (0, 0, 0) on Hiro marker with PBR composite detailing
  entity.innerHTML = `
    <!-- realistic crimson powder-coat cylinder with curved dome ends -->
    <a-cylinder id="ext-body" position="0 0 0" radius="0.38" height="1.30" material="color: #b91c1c; metalness: 0.35; roughness: 0.25"></a-cylinder>
    <a-sphere id="ext-top-dome" position="0 0.65 0" radius="0.38" scale="1 0.40 1" material="color: #b91c1c; metalness: 0.35; roughness: 0.25"></a-sphere>
    <a-sphere id="ext-bottom-dome" position="0 -0.65 0" radius="0.38" scale="1 0.30 1" material="color: #b91c1c; metalness: 0.35; roughness: 0.25"></a-sphere>
    <a-cylinder id="ext-base" position="0 -0.74 0" radius="0.41" height="0.14" material="color: #09090b; roughness: 0.85"></a-cylinder>

    <!-- industrial pass instruction decal plate on front cylinder body -->
    <a-plane id="ext-decal-plate" position="0 0 0.385" width="0.46" height="0.65" material="color: #ffffff; roughness: 0.3"></a-plane>
    <a-plane id="ext-decal-header" position="0 0.24 0.388" width="0.44" height="0.12" material="color: #1e3a8a; roughness: 0.25"></a-plane>
    <a-text position="0 0.24 0.390" value="ABC DRY CHEMICAL" align="center" scale="0.36 0.36 0.36" color="#ffffff"></a-text>
    <a-text position="0 0.08 0.390" value="1. PULL PIN\n2. AIM AT BASE\n3. SQUEEZE LEVER\n4. SWEEP HAZARD" align="center" scale="0.30 0.30 0.30" color="#0f172a"></a-text>

    <!-- brass valve block assembly -->
    <a-cylinder id="ext-neck" position="0 0.74 0" radius="0.12" height="0.16" material="color: #d97706; metalness: 0.85; roughness: 0.2"></a-cylinder>
    <a-cylinder id="ext-valve-block" position="0 0.84 0" radius="0.13" height="0.14" material="color: #d97706; metalness: 0.85; roughness: 0.2"></a-cylinder>

    <!-- operational pressure gauge dial on valve front -->
    <a-cylinder id="ext-gauge-bezel" position="0 0.80 0.15" rotation="90 0 0" radius="0.085" height="0.03" material="color: #d97706; metalness: 0.9; roughness: 0.15"></a-cylinder>
    <a-cylinder id="ext-gauge-face" position="0 0.80 0.168" rotation="90 0 0" radius="0.075" height="0.008" material="color: #ffffff; roughness: 0.2"></a-cylinder>
    <a-cylinder id="ext-gauge-green-zone" position="0 0.80 0.172" rotation="90 0 0" radius="0.05" height="0.009" theta-start="60" theta-length="60" material="color: #10b981; shader: flat"></a-cylinder>
    <a-box id="ext-gauge-needle" position="0 0.812 0.176" width="0.007" height="0.045" depth="0.004" rotation="0 0 -15" material="color: #ef4444; shader: flat"></a-box>

    <!-- flexible rubber discharge hose with chrome mounting bracket and horn -->
    <a-cylinder id="ext-hose-joint" position="-0.13 0.82 0" radius="0.045" height="0.09" rotation="0 0 90" material="color: #d97706; metalness: 0.8"></a-cylinder>
    <a-cylinder id="ext-hose" position="-0.32 0.35 0.18" radius="0.055" height="1.05" rotation="15 0 -25" material="color: #18181b; roughness: 0.9"></a-cylinder>
    <a-cone id="ext-nozzle" position="-0.46 -0.22 0.26" radius-bottom="0.11" radius-top="0.045" height="0.28" rotation="40 0 -40" material="color: #09090b; roughness: 0.7"></a-cone>
    <a-box id="ext-hose-bracket" position="-0.36 0.10 0.08" width="0.06" height="0.10" depth="0.08" material="color: #e2e8f0; metalness: 0.9; roughness: 0.2"></a-box>
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

  // generous invisible touch hit target for lever (65cm x 35cm x 35cm box)
  const handleHitArea = document.createElement("a-box");
  handleHitArea.id = "handle-hit-area";
  if (typeof handleHitArea.setAttribute === "function") {
    handleHitArea.setAttribute("class", "clickable");
    handleHitArea.setAttribute("data-raycast-target", "handle");
    handleHitArea.setAttribute("position", "0 0 0");
    handleHitArea.setAttribute("width", "0.65");
    handleHitArea.setAttribute("height", "0.35");
    handleHitArea.setAttribute("depth", "0.35");
    handleHitArea.setAttribute("material", "opacity: 0.0; transparent: true");
  } else {
    handleHitArea.className = "clickable";
  }
  handle.appendChild(handleHitArea);

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

  // breakable yellow plastic tamper seal securing pin to valve neck
  const tamperSeal = document.createElement("a-box");
  tamperSeal.id = "tamper-seal";
  if (typeof tamperSeal.setAttribute === "function") {
    tamperSeal.setAttribute("position", "0.03 0 0");
    tamperSeal.setAttribute("width", "0.05");
    tamperSeal.setAttribute("height", "0.20");
    tamperSeal.setAttribute("depth", "0.05");
    tamperSeal.setAttribute("material", "color: #eab308; emissive: #ca8a04; emissiveIntensity: 0.5");
  }

  // generous invisible touch hit target for pin (45cm radius sphere centered on ring)
  const pinHitArea = document.createElement("a-sphere");
  pinHitArea.id = "pin-hit-area";
  if (typeof pinHitArea.setAttribute === "function") {
    pinHitArea.setAttribute("class", "clickable");
    pinHitArea.setAttribute("data-raycast-target", "pin");
    pinHitArea.setAttribute("position", "0.20 0 0");
    pinHitArea.setAttribute("radius", "0.45");
    pinHitArea.setAttribute("material", "opacity: 0.0; transparent: true");
  } else {
    pinHitArea.className = "clickable";
  }

  pin.appendChild(pinShaft);
  pin.appendChild(pinRing);
  pin.appendChild(tamperSeal);
  pin.appendChild(pinHitArea);

  // looping holographic ghost pin demonstrating pull motion path (Scope AR benchmark)
  const phantomPin = document.createElement("a-entity");
  phantomPin.id = "phantom-ghost-pin";
  if (typeof phantomPin.setAttribute === "function") {
    phantomPin.setAttribute("position", "0.06 0.88 0.15");
    phantomPin.setAttribute("animation", "property: position; to: 0.52 0.88 0.15; from: 0.06 0.88 0.15; dur: 1200; loop: true; easing: easeOutQuad");
  }

  const phantomShaft = document.createElement("a-cylinder");
  phantomShaft.id = "phantom-shaft";
  if (typeof phantomShaft.setAttribute === "function") {
    phantomShaft.setAttribute("rotation", "90 0 0");
    phantomShaft.setAttribute("radius", "0.08");
    phantomShaft.setAttribute("height", "0.38");
    phantomShaft.setAttribute("material", "color: #00e5ff; emissive: #00e5ff; emissiveIntensity: 0.9; opacity: 0.45; transparent: true");
  }

  const phantomRing = document.createElement("a-torus");
  phantomRing.id = "phantom-ring";
  if (typeof phantomRing.setAttribute === "function") {
    phantomRing.setAttribute("position", "0.20 0 0");
    phantomRing.setAttribute("rotation", "0 90 0");
    phantomRing.setAttribute("radius", "0.16");
    phantomRing.setAttribute("radius-tubular", "0.032");
    phantomRing.setAttribute("material", "color: #00e5ff; emissive: #00e5ff; emissiveIntensity: 0.95; opacity: 0.55; transparent: true");
  }

  phantomPin.appendChild(phantomShaft);
  phantomPin.appendChild(phantomRing);

  // 3d dynamic guide arrow pointing directly at interactive pin
  const guideArrow = document.createElement("a-entity");
  guideArrow.id = "extinguisher-guide-arrow";
  if (typeof guideArrow.setAttribute === "function") {
    guideArrow.setAttribute("class", "clickable");
    guideArrow.setAttribute("data-raycast-target", "pin");
    guideArrow.setAttribute("position", "0.26 1.45 0.15");
    guideArrow.setAttribute("animation", "property: position; to: 0.26 1.15 0.15; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
  } else {
    guideArrow.className = "clickable";
  }

  const arrowCone = document.createElement("a-cone");
  arrowCone.id = "guide-arrow-cone";
  if (typeof arrowCone.setAttribute === "function") {
    arrowCone.setAttribute("class", "clickable");
    arrowCone.setAttribute("data-raycast-target", "pin");
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
    arrowShaft.setAttribute("class", "clickable");
    arrowShaft.setAttribute("data-raycast-target", "pin");
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

  // world-anchored 3d spatial step billboard (hidden by default to avoid visual clutter)
  const spatialBillboard = document.createElement("a-entity");
  spatialBillboard.id = "spatial-step-billboard";
  if (typeof spatialBillboard.setAttribute === "function") {
    spatialBillboard.setAttribute("position", "0.95 0.65 0.10");
    spatialBillboard.setAttribute("visible", "false");
  }

  spatialBillboard.innerHTML = `
    <a-box id="billboard-bg" position="0 0 0" width="0.95" height="0.65" depth="0.03" material="color: #0f172a; opacity: 0.88; roughness: 0.5"></a-box>
    <a-box id="billboard-border" position="0 0 0.018" width="0.97" height="0.67" depth="0.005" material="color: #00e5ff; opacity: 0.75; emissive: #00e5ff; emissiveIntensity: 0.4; wireframe: true"></a-box>
    <a-text id="billboard-step-badge" value="🔥 STEP 2 / 3 — PASS" align="center" position="0 0.22 0.035" scale="0.42 0.42 0.42" color="#f59e0b"></a-text>
    <a-text id="billboard-step-title" value="P — PULL PIN" align="center" position="0 0.10 0.035" scale="0.55 0.55 0.55" color="#ffffff"></a-text>
    <a-text id="billboard-step-desc" value="Tap pin or arrow,\nthen drag right." align="center" position="0 -0.04 0.035" scale="0.34 0.34 0.34" color="#94a3b8"></a-text>
    <a-box id="billboard-pill" position="0 -0.20 0.025" width="0.80" height="0.09" depth="0.01" material="color: #334155"></a-box>
    <a-text id="billboard-pill-text" value="⚪ AWAITING PIN SELECTION" align="center" position="0 -0.20 0.035" scale="0.32 0.32 0.32" color="#94a3b8"></a-text>
  `;

  // volumetric powder discharge cone (activated during squeeze & sweep)
  const powderSpray = document.createElement("a-cone");
  powderSpray.id = "powder-spray-cone";
  if (typeof powderSpray.setAttribute === "function") {
    powderSpray.setAttribute("position", "-0.75 -0.65 0.55");
    powderSpray.setAttribute("rotation", "45 -30 -35");
    powderSpray.setAttribute("radius-bottom", "0.65");
    powderSpray.setAttribute("radius-top", "0.05");
    powderSpray.setAttribute("height", "1.35");
    powderSpray.setAttribute("material", "color: #f8fafc; opacity: 0; transparent: true");
    powderSpray.setAttribute("visible", "false");
  }

  entity.appendChild(handle);
  entity.appendChild(pin);
  entity.appendChild(phantomPin);
  entity.appendChild(guideArrow);
  entity.appendChild(progressContainer);
  entity.appendChild(spatialBillboard);
  entity.appendChild(powderSpray);

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


