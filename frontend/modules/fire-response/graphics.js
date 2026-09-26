import { t } from "../../js/i18n.js";
import { createFireMesh, animateFireMesh, setFireAirflow } from "../../ar/webxr_render.js";

// tier 2 wraps the exact three.js fire tier 1 renders as an a-frame component, so both
// tiers show the same flames, roof smoke, embers and steam. no-op without a-frame (tests)
function registerProceduralFire() {
  const A = typeof window !== "undefined" ? window.AFRAME : null;
  if (!A || typeof A.registerComponent !== "function" || (A.components && A.components["procedural-fire"])) return;
  A.registerComponent("procedural-fire", {
    schema: {
      airflow: { type: "string", default: "none" },
      progress: { type: "number", default: 0 }
    },
    init() {
      this.fire = createFireMesh();
      if (this.fire) this.el.setObject3D("mesh", this.fire);
    },
    update() {
      if (!this.fire) return;
      setFireAirflow(this.fire, this.data.airflow);
      this.fire.userData.extinguishProgress = this.data.progress;
    },
    tick(_time, deltaMs) {
      if (this.fire) animateFireMesh(this.fire, deltaMs);
    },
    remove() {
      this.el.removeObject3D("mesh");
      this.fire = null;
    }
  });
}

registerProceduralFire();

// tier 2 fire: the shared procedural fire, an aim target at its base, and the aim reticle.
// airflow comes from the run's scenario so smoke and embers drift the way gate 3 describes
function buildFireEntity(airflow = "none") {
  registerProceduralFire();
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

  const safeAirflow = ["intake_left", "intake_right"].includes(airflow) ? airflow : "none";
  entity.innerHTML = `
    <!-- flames, roof smoke, embers, scorch, glow, shadow and steam: the same builder tier 1 uses -->
    <a-entity id="procedural-fire" procedural-fire="airflow: ${safeAirflow}; progress: 0" position="0 -0.55 0" scale="0.55 0.55 0.55"></a-entity>

    <!-- generous aim target collision cylinder covering entire base -->
    <a-cylinder id="fire-target-base" class="clickable aim-target" data-raycast-target="aim" position="0 -0.20 0" radius="0.95" height="0.75" material="color: #febc04; opacity: 0.01; transparent: true"></a-cylinder>

    <!-- 3D visual target label at ground base -->
    <a-text id="aim-ground-label" value="${t("graphics.aim_flame_base", "👇 AIM AT BASE OF FLAMES")}" align="center" position="0 -0.62 0.50" rotation="-20 0 0" scale="0.50 0.50 0.50" color="#febc04" material="shader: flat"></a-text>
  `;

  // 3d neon green aim reticle facing user at the base of the fire container
  const aimReticle = document.createElement("a-ring");
  aimReticle.id = "aim-reticle";
  if (typeof aimReticle.setAttribute === "function") {
    aimReticle.setAttribute("class", "clickable aim-target");
    aimReticle.setAttribute("data-raycast-target", "aim");
    aimReticle.setAttribute("position", "0 -0.15 0");
    aimReticle.setAttribute("rotation", "-60 0 0");
    aimReticle.setAttribute("radius-inner", "0.45");
    aimReticle.setAttribute("radius-outer", "0.80");
    aimReticle.setAttribute("material", "color: #febc04; shader: flat; side: double; opacity: 0.9");
    aimReticle.setAttribute("animation", "property: scale; to: 1.15 1.15 1.15; from: 0.95 0.95 0.95; dir: alternate; dur: 500; loop: true; easing: easeInOutSine");
  } else {
    aimReticle.className = "clickable aim-target";
  }

  entity.appendChild(aimReticle);
  return entity;
}

// build 3d exit sign entity using glb model
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

  // low poly green running man exit sign 3D model replacing primitive geometry
  entity.innerHTML = `
    <a-entity id="exit-model" gltf-model="./assets/models/low_poly_green_running_man_exit_sign.glb" position="0 0 0" rotation="0 0 0" scale="0.5 0.5 0.5"></a-entity>
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

  // realistic 3D extinguisher model replacing primitive cylinder body
  entity.innerHTML = `
    <a-entity id="extinguisher-model" gltf-model="./assets/models/fire_extinguisher.glb" position="0 -0.20 0" rotation="0 0 0" scale="1.8 1.8 1.8"></a-entity>
    <!-- equipment inspection components -->
    <a-entity id="ext-valve-block" visible="false"></a-entity>
    <a-entity id="ext-gauge-face" visible="false"></a-entity>
    <a-entity id="ext-hose" visible="false"></a-entity>
    <a-entity id="ext-nozzle" visible="false"></a-entity>
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

  // generous touch hit target for lever
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

  // visible pin shaft
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
    pinRing.setAttribute("material", "color: #fbbf24; shader: flat");
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
    tamperSeal.setAttribute("material", "color: #eab308; shader: flat");
  }

  // generous touch hit target for pin
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

  // looping holographic ghost pin demonstrating pull motion path
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
    phantomShaft.setAttribute("material", "color: #febc04; shader: flat; opacity: 0.45; transparent: true");
  }

  const phantomRing = document.createElement("a-torus");
  phantomRing.id = "phantom-ring";
  if (typeof phantomRing.setAttribute === "function") {
    phantomRing.setAttribute("position", "0.20 0 0");
    phantomRing.setAttribute("rotation", "0 90 0");
    phantomRing.setAttribute("radius", "0.16");
    phantomRing.setAttribute("radius-tubular", "0.032");
    phantomRing.setAttribute("material", "color: #febc04; shader: flat; opacity: 0.55; transparent: true");
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
    arrowCone.setAttribute("material", "color: #facc15; shader: flat; side: double");
  }

  const arrowShaft = document.createElement("a-cylinder");
  arrowShaft.id = "guide-arrow-shaft";
  if (typeof arrowShaft.setAttribute === "function") {
    arrowShaft.setAttribute("class", "clickable");
    arrowShaft.setAttribute("data-raycast-target", "pin");
    arrowShaft.setAttribute("position", "0 0.16 0");
    arrowShaft.setAttribute("radius", "0.06");
    arrowShaft.setAttribute("height", "0.32");
    arrowShaft.setAttribute("material", "color: #facc15; shader: flat; side: double");
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

  // world-anchored 3d spatial step billboard
  const spatialBillboard = document.createElement("a-entity");
  spatialBillboard.id = "spatial-step-billboard";
  if (typeof spatialBillboard.setAttribute === "function") {
    spatialBillboard.setAttribute("position", "0.95 0.65 0.10");
    spatialBillboard.setAttribute("visible", "false");
  }

  spatialBillboard.innerHTML = `
    <a-box id="billboard-bg" position="0 0 0" width="0.95" height="0.65" depth="0.03" material="color: #0f172a; opacity: 0.88; roughness: 0.5"></a-box>
    <a-box id="billboard-border" position="0 0 0.018" width="0.97" height="0.67" depth="0.005" material="color: #febc04; opacity: 0.75; shader: flat; wireframe: true"></a-box>
    <a-text id="billboard-step-badge" value="🔥 STEP 2 / 3 — PASS" align="center" position="0 0.22 0.035" scale="0.42 0.42 0.42" color="#f59e0b"></a-text>
    <a-text id="billboard-step-title" value="P — PULL PIN" align="center" position="0 0.10 0.035" scale="0.55 0.55 0.55" color="#ffffff"></a-text>
    <a-text id="billboard-step-desc" value="Tap pin or arrow,\nthen drag right." align="center" position="0 -0.04 0.035" scale="0.34 0.34 0.34" color="#94a3b8"></a-text>
    <a-box id="billboard-pill" position="0 -0.20 0.025" width="0.80" height="0.09" depth="0.01" material="color: #334155"></a-box>
    <a-text id="billboard-pill-text" value="⚪ AWAITING PIN SELECTION" align="center" position="0 -0.20 0.035" scale="0.32 0.32 0.32" color="#94a3b8"></a-text>
  `;

  // volumetric powder discharge cone & particle clouds (activated during squeeze & sweep)
  const powderSpray = document.createElement("a-entity");
  powderSpray.id = "powder-spray-cone";
  if (typeof powderSpray.setAttribute === "function") {
    powderSpray.setAttribute("position", "-0.75 -0.65 0.55");
    powderSpray.setAttribute("rotation", "45 -30 -35");
    powderSpray.setAttribute("visible", "false");
  }
  powderSpray.innerHTML = `
    <a-cone id="powder-core-cone" position="0 0 0" radius-bottom="0.65" radius-top="0.06" height="1.45" material="color: #ffffff; opacity: 0.78; transparent: true; shader: flat"></a-cone>
    <a-sphere id="powder-puff-1" position="0 0.35 0.05" radius="0.16" material="color: #f8fafc; opacity: 0.70; transparent: true; shader: flat" animation="property: scale; to: 1.4 1.4 1.4; dir: alternate; dur: 180; loop: true"></a-sphere>
    <a-sphere id="powder-puff-2" position="-0.12 -0.25 -0.05" radius="0.22" material="color: #f1f5f9; opacity: 0.65; transparent: true; shader: flat" animation="property: scale; to: 1.3 1.3 1.3; dir: alternate; dur: 220; loop: true"></a-sphere>
    <a-sphere id="powder-puff-3" position="0.14 -0.55 0.08" radius="0.30" material="color: #e2e8f0; opacity: 0.60; transparent: true; shader: flat" animation="property: scale; to: 1.35 1.35 1.35; dir: alternate; dur: 200; loop: true"></a-sphere>
    <a-sphere id="powder-puff-4" position="-0.08 -0.85 -0.02" radius="0.38" material="color: #cbd5e1; opacity: 0.55; transparent: true; shader: flat" animation="property: scale; to: 1.4 1.4 1.4; dir: alternate; dur: 240; loop: true"></a-sphere>
  `;

  entity.appendChild(handle);
  entity.appendChild(pin);
  entity.appendChild(phantomPin);
  entity.appendChild(guideArrow);
  entity.appendChild(progressContainer);
  entity.appendChild(spatialBillboard);
  entity.appendChild(powderSpray);

  return entity;
}

// build 3d fire alarm pull station entity
function buildFireAlarmEntity() {
  const entity = document.createElement("a-entity");
  entity.id = "fire-alarm-station";
  if (typeof entity.setAttribute === "function") {
    entity.setAttribute("class", "clickable");
    entity.setAttribute("data-raycast-target", "alarm");
    entity.setAttribute("position", "0 0 0");
    entity.setAttribute("rotation", "0 0 0");
  } else {
    entity.className = "clickable";
  }

  entity.innerHTML = `
    <!-- 3D pull station model -->
    <a-entity id="fire-alarm-model" gltf-model="./assets/models/notifier_rsg_t-bar_fire_alarm_pull_station.glb" position="0 0 0" scale="0.08 0.08 0.08"></a-entity>
    <!-- generous touch hit box -->
    <a-box id="fire-alarm-hit-box" class="clickable" data-raycast-target="alarm" position="0 0 0" width="0.6" height="0.8" depth="0.3" material="opacity: 0.0; transparent: true"></a-box>
    <!-- pulsing pull affordance ring -->
    <a-ring id="fire-alarm-pulse" position="0 0 0.16" radius-inner="0.25" radius-outer="0.35" material="color: #ef4444; shader: flat; side: double; opacity: 0.8" animation="property: scale; to: 1.3 1.3 1.3; from: 0.9 0.9 0.9; dir: alternate; dur: 600; loop: true; easing: easeInOutSine"></a-ring>
    <a-text id="fire-alarm-label" value="${t("graphics.pull_alarm", "PULL ALARM")}" align="center" position="0 0.55 0.1" scale="0.45 0.45 0.45" color="#ef4444" material="shader: flat"></a-text>
  `;

  return entity;
}

// build flat grounded marker avatar with ring shadow heading wedge and eye height text
function buildPeerAvatarEntity(role) {
  const entity = document.createElement("a-entity");
  const color = role === "alarm" ? "#ef4444" : role === "extinguisher_operator" ? "#3b82f6" : "#10b981";
  const roleName = t(`modules.fire_response.role_${role}`, {}, role.replace("_", " ").toUpperCase());

  // ground shadow disc
  const shadow = document.createElement("a-circle");
  shadow.setAttribute("class", "peer-avatar-shadow");
  shadow.setAttribute("radius", "0.4");
  shadow.setAttribute("rotation", "-90 0 0");
  shadow.setAttribute("position", "0 0.005 0");
  shadow.setAttribute("color", "#000000");
  shadow.setAttribute("opacity", "0.3");
  shadow.setAttribute("material", "shader: flat; transparent: true;");

  // flat grounded role-colored ring on floor plane
  const ring = document.createElement("a-ring");
  ring.setAttribute("class", "peer-avatar-ground-ring");
  ring.setAttribute("radius-inner", "0.22");
  ring.setAttribute("radius-outer", "0.32");
  ring.setAttribute("rotation", "-90 0 0");
  ring.setAttribute("position", "0 0.01 0");
  ring.setAttribute("color", color);
  ring.setAttribute("opacity", "0.85");
  ring.setAttribute("material", "shader: flat; side: double;");

  // flat grounded center disc
  const disc = document.createElement("a-circle");
  disc.setAttribute("class", "peer-avatar-ground-disc");
  disc.setAttribute("radius", "0.22");
  disc.setAttribute("rotation", "-90 0 0");
  disc.setAttribute("position", "0 0.01 0");
  disc.setAttribute("color", color);
  disc.setAttribute("opacity", "0.35");
  disc.setAttribute("material", "shader: flat; side: double;");

  // heading indicator triangle pointing gaze direction forward
  const heading = document.createElement("a-triangle");
  heading.setAttribute("class", "peer-avatar-heading");
  heading.setAttribute("vertex-a", "0 0.015 -0.42");
  heading.setAttribute("vertex-b", "-0.12 0.015 -0.28");
  heading.setAttribute("vertex-c", "0.12 0.015 -0.28");
  heading.setAttribute("rotation", "-90 0 0");
  heading.setAttribute("color", "#ffffff");
  heading.setAttribute("opacity", "0.9");
  heading.setAttribute("material", "shader: flat; side: double;");

  // text label at eye height
  const text = document.createElement("a-text");
  text.setAttribute("class", "peer-avatar-label");
  text.setAttribute("value", roleName);
  text.setAttribute("align", "center");
  text.setAttribute("position", "0 1.6 0");
  text.setAttribute("scale", "0.5 0.5 0.5");
  text.setAttribute("color", "#ffffff");
  text.setAttribute("side", "double");

  entity.appendChild(shadow);
  entity.appendChild(ring);
  entity.appendChild(disc);
  entity.appendChild(heading);
  entity.appendChild(text);

  return entity;
}

// aliases for backward compatibility
const buildFireGraphic = buildFireEntity;
const buildExitGraphic = buildExitEntity;
const buildExtinguisherGraphic = buildExtinguisherEntity;
const buildFireAlarmGraphic = buildFireAlarmEntity;

export {
  buildFireEntity,
  buildExitEntity,
  buildExtinguisherEntity,
  registerProceduralFire,
  buildFireAlarmEntity,
  buildFireGraphic,
  buildExitGraphic,
  buildExtinguisherGraphic,
  buildFireAlarmGraphic,
  buildPeerAvatarEntity
};
