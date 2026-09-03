import { createLogger } from "../../js/logger.js";
import { registerCheckpoint, fireCheckpointResult } from "../../ar/interactions.js";
import { unloadModule } from "../../js/module-loader.js";
import { t } from "../../js/i18n.js";
import {
  createFireMesh, animateFireMesh,
  createExtinguisherMesh, animateExtinguisherMesh,
  calcFireOffsetPosition
} from "../../ar/webxr_render.js";
import {
  calcDragDistance, isPinPullComplete,
  calcRaycastAimAccuracy,
  evaluateGazeAimProgress,
  isSqueezeComplete, calcMotionSweepCoverage, isSweepComplete,
  AIM_PASS_THRESHOLD, FIRE_BASE_MAX_DISTANCE_3D,
  CP_EXIT_ID, CP_EXTINGUISHER_ID, CP_EVACUATION_ID
} from "./fire-response.js";

const logger = createLogger("FireModuleWebXR");

// step tracking
let _currentStep = 0;
let _controller = null;
let _fireMesh = null;
let _extMesh = null;
let _frameHandler = null;
let _aimFrameHandler = null;
let _sweepFrameHandler = null;
let _placementScreenTap = null;
let _placementConfirmedHandler = null;
let _interactionState = null;

// read active step number
function getCurrentStepWebXR() {
  return _currentStep;
}

// clean up all webxr fire module state
function cleanupWebXRFireModule() {
  if (_frameHandler && _controller) {
    _controller.offFrame(_frameHandler);
    _frameHandler = null;
  }
  if (_aimFrameHandler && _controller) {
    _controller.offFrame(_aimFrameHandler);
    _aimFrameHandler = null;
  }
  if (_sweepFrameHandler && _controller) {
    _controller.offFrame(_sweepFrameHandler);
    _sweepFrameHandler = null;
  }
  if (_placementScreenTap && typeof window !== "undefined") {
    window.removeEventListener("click", _placementScreenTap);
    _placementScreenTap = null;
  }
  if (_placementConfirmedHandler && typeof window !== "undefined") {
    window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    _placementConfirmedHandler = null;
  }
  if (_fireMesh && _controller) {
    _controller.removeFromScene(_fireMesh);
    _fireMesh = null;
  }
  if (_extMesh && _controller) {
    _controller.removeFromScene(_extMesh);
    _extMesh = null;
  }
  _interactionState = null;
  _currentStep = 0;

  if (typeof document !== "undefined") {
    const overlay = document.getElementById("fire-module-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
}

// inject dom overlay panel
function _createOverlay(container, html) {
  const panel = document.createElement("div");
  panel.id = "fire-module-overlay";
  panel.style.cssText = [
    "position:fixed", "bottom:0", "left:0", "right:0",
    "background:transparent", "color:#fff",
    "font-family:sans-serif", "padding:1.2rem",
    "z-index:100", "pointer-events:auto"
  ].join(";");
  panel.innerHTML = html;
  if (container && container.appendChild) {
    container.appendChild(panel);
  }
  return panel;
}

// render subscreen with educational text
function _renderSubscreen(overlay, { badge, title, desc, buttonText, onNext }) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${badge}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${title}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${desc}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.4rem;padding:0.75rem 1.4rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", onNext);
  overlay.appendChild(btnNext);
}

// step 1: exit identification (same dom overlay as tier 2)
function _setupStep1WebXR(container) {
  _currentStep = 1;
  logger.info({ event: "webxr_fire_step_start", step: 1 }, "Exit identification (WebXR)");

  registerCheckpoint({
    id: CP_EXIT_ID,
    type: "proximity",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Exit CP (WebXR)");
    }
  });

  const overlay = document.getElementById("fire-module-overlay");

  const screens = [
    {
      badge: t("fire.exit_badge_1", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (1/4)"),
      title: t("fire.exit_title_1", "Why Identifying Exits Matters"),
      desc: t("fire.exit_desc_1", "In a fire emergency, heavy smoke reduces visibility to zero in under 30 seconds. Panic causes confusion — knowing your exit routes beforehand saves critical seconds."),
      buttonText: t("fire.exit_next_1", "Next: Primary & Backup Exits ➜")
    },
    {
      badge: t("fire.exit_badge_2", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (2/4)"),
      title: t("fire.exit_title_2", "Primary vs. Backup Route"),
      desc: t("fire.exit_desc_2", "Never rely on a single exit path. If flames or smoke block your primary route, you must immediately pivot to your pre-identified secondary emergency path."),
      buttonText: t("fire.exit_next_2", "Next: Elevators Danger ➜")
    },
    {
      badge: t("fire.exit_badge_3", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (3/4)"),
      title: t("fire.exit_title_3", "Never Use Elevators in a Fire"),
      desc: t("fire.exit_desc_3", "Elevator shafts act as natural chimneys drawing superheated toxic gases. Power failure can strand the car between burning floors. Always use designated fire stairwells."),
      buttonText: t("fire.exit_next_3", "Next: Place Extinguisher ➜")
    }
  ];

  function showPlacementScreen() {
    if (!overlay) return;

    // spawn 3D extinguisher immediately so trainee sees it right away
    if (!_extMesh && _controller) {
      _extMesh = createExtinguisherMesh();
      if (_extMesh) {
        _extMesh.position.set(0, -0.42, -1.05);
        _extMesh.scale.set(0.35, 0.35, 0.35);
        _controller.addToScene(_extMesh);
      }
    }

    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${t("fire.place_badge", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)")}</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${t("fire.place_title", "Place Extinguisher on Ground")}</div>
      <div id="placement-status-text" style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${t("fire.place_desc", "Point your tablet at the floor or table. Tap the green button below (or tap anywhere on screen) to place the extinguisher.")}</div>
      <button id="btn-place-extinguisher" style="display:block;width:100%;max-width:340px;padding:14px 20px;border-radius:10px;border:2px solid #00e676;background:#0f172a;color:#00e676;font-size:1rem;font-weight:bold;cursor:pointer;margin:0.5rem 0;box-shadow:0 0 15px rgba(0,230,118,0.35);pointer-events:auto !important;text-align:center;">${t("fire.place_btn", "🎯 TAP TO PLACE EXTINGUISHER ON FLOOR")}</button>
    `;

    let placed = false;

    // placement execution function
    const doPlace = (pos, viewerQuat) => {
      if (placed) return;
      placed = true;

      if (_placementScreenTap && typeof window !== "undefined") {
        window.removeEventListener("click", _placementScreenTap);
        _placementScreenTap = null;
      }
      if (_placementConfirmedHandler && typeof window !== "undefined") {
        window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
        _placementConfirmedHandler = null;
      }

      const finalPos = pos || { x: 0, y: -0.45, z: -1.20 };
      logger.info({ event: "extinguisher_placed", position: finalPos }, "Extinguisher placed on surface");

      // position extinguisher at placed spot
      if (!_extMesh && _controller) {
        _extMesh = createExtinguisherMesh();
        if (_extMesh) _controller.addToScene(_extMesh);
      }
      if (_extMesh) {
        _extMesh.position.set(finalPos.x, finalPos.y, finalPos.z);
        _extMesh.scale.set(0.35, 0.35, 0.35);
      }

      // spawn fire 1.8m in front
      const THREE = typeof window !== "undefined" && window.THREE;
      let firePos;
      if (THREE && viewerQuat) {
        const q = new THREE.Quaternion(viewerQuat.x, viewerQuat.y, viewerQuat.z, viewerQuat.w);
        const p = new THREE.Vector3(finalPos.x, finalPos.y, finalPos.z);
        firePos = calcFireOffsetPosition(p, q);
      }
      if (!firePos) {
        firePos = { x: finalPos.x, y: finalPos.y, z: finalPos.z - 1.8 };
      }

      _fireMesh = createFireMesh();
      if (_fireMesh && _controller) {
        _fireMesh.position.set(firePos.x, firePos.y, firePos.z);
        _fireMesh.scale.set(0.35, 0.35, 0.35);
        _controller.addToScene(_fireMesh);
      }

      // start animation frame handler
      _frameHandler = ({ deltaMs }) => {
        if (_fireMesh) animateFireMesh(_fireMesh, deltaMs);
        if (_extMesh) animateExtinguisherMesh(_extMesh, deltaMs);
      };
      if (_controller) _controller.onFrame(_frameHandler);

      // fire checkpoint and advance
      fireCheckpointResult(CP_EXIT_ID, true, { method: "webxr_surface_placement" });

      if (overlay) {
        overlay.innerHTML = `
          <div style="font-size:1.05rem;font-weight:bold;color:#00e676;">✔ Extinguisher Placed on Ground!</div>
          <div style="margin:0.4rem 0 0.6rem 0;font-size:0.92rem;color:#f1f5f9;">The 3D fire extinguisher is anchored to the surface. Tap below to begin PASS training.</div>
          <button id="btn-proceed-step2" style="margin-top:0.4rem;padding:0.85rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;">✔ Begin PASS Training ➜</button>
        `;
        const btnProceed = overlay.querySelector("#btn-proceed-step2");
        if (btnProceed) {
          btnProceed.addEventListener("click", () => {
            _setupStep2WebXR(container);
          });
        }
      }
    };

    // 1. Hook up action button
    const btnPlace = overlay.querySelector("#btn-place-extinguisher");
    if (btnPlace) {
      btnPlace.addEventListener("click", () => {
        if (_controller && typeof _controller.confirmPlacement === "function") {
          _controller.confirmPlacement();
        } else {
          doPlace({ x: 0, y: -0.45, z: -1.20 });
        }
      });
    }

    // 2. Hook up screen tap fallback
    _placementScreenTap = () => {
      if (!placed) {
        if (_controller && typeof _controller.confirmPlacement === "function") {
          _controller.confirmPlacement();
        } else {
          doPlace({ x: 0, y: -0.45, z: -1.20 });
        }
      }
    };
    window.addEventListener("click", _placementScreenTap, { once: true });

    // 3. Listen for placement confirmation from controller
    _placementConfirmedHandler = (e) => {
      const { position, viewerQuaternion } = e.detail;
      doPlace(position, viewerQuaternion);
    };
    window.addEventListener("safear:placement_confirmed", _placementConfirmedHandler, { once: true });
  }

  let subIndex = 0;
  function renderCurrentSubscreen() {
    if (subIndex < screens.length) {
      _renderSubscreen(overlay, {
        ...screens[subIndex],
        onNext: () => {
          subIndex++;
          renderCurrentSubscreen();
        }
      });
    } else {
      showPlacementScreen();
    }
  }

  renderCurrentSubscreen();
}

// step 2: PASS technique interactions against world-space entities
function _setupStep2WebXR(container) {
  _currentStep = 2;
  logger.info({ event: "webxr_fire_step_start", step: 2 }, "PASS technique (WebXR)");

  registerCheckpoint({
    id: CP_EXTINGUISHER_ID,
    type: "aim",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Aim CP (WebXR)");
    }
  });

  _interactionState = {
    phase: "pin",     // pin -> aim -> squeeze -> sweep
    pinSelected: false,
    pinDragStart: null,
    aimStartMs: 0,
    aimInTarget: false,
    squeezeStartMs: 0,
    squeezing: false,
    sweepSamples: [],
    sweepStarted: false
  };

  const overlay = document.getElementById("fire-module-overlay");

  // show pin pull UI
  _showPinPhase(overlay, container);
}

// pin pull phase: tap to select pin, drag to pull
function _showPinPhase(overlay, container) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${t("fire.pass_pull_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (1/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${t("fire.pass_pull_title", "P — Pull the Pin")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${t("fire.pass_pull_desc", "Tap anywhere to select the pin, then swipe right to pull it out.")}</div>
  `;
  const btn = document.createElement("button");
  btn.id = "btn-webxr-pin-pull";
  btn.style.cssText = "padding:0.8rem 1.5rem;background:#00b8d4;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btn.textContent = t("fire.pass_pull_badge_btn", "👉 SWIPE RIGHT OR TAP TO PULL PIN");

  let dragStart = null;

  btn.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    if (touch) dragStart = { x: touch.clientX, y: touch.clientY };
  });
  btn.addEventListener("mousedown", (e) => {
    dragStart = { x: e.clientX, y: e.clientY };
  });

  const checkPull = (endPos) => {
    if (!dragStart) {
      // simple tap — treat as pull
      _onPinPulled(overlay, container);
      return;
    }
    const dist = calcDragDistance(dragStart, endPos);
    if (isPinPullComplete(dist)) {
      _onPinPulled(overlay, container);
    }
    dragStart = null;
  };

  btn.addEventListener("touchend", (e) => {
    const touch = e.changedTouches[0];
    if (touch) checkPull({ x: touch.clientX, y: touch.clientY });
    else _onPinPulled(overlay, container);
  });
  btn.addEventListener("mouseup", (e) => {
    checkPull({ x: e.clientX, y: e.clientY });
  });

  overlay.appendChild(btn);
}

// pin pulled — animate pin out, advance to aim
function _onPinPulled(overlay, container) {
  if (_interactionState) _interactionState.phase = "aim";

  // animate pin removal on 3D mesh
  if (_extMesh && _extMesh.userData) {
    const pin = _extMesh.getObjectByName("extinguisher-pin");
    if (pin) pin.visible = false;
    _extMesh.userData._pinPulled = true;
  }

  logger.info({ event: "webxr_pin_pulled" }, "Pin pulled (WebXR)");
  _showAimPhase(overlay, container);
}

// aim phase: point device at fire base, hold steady
function _showAimPhase(overlay, container) {
  if (!overlay) return;

  let aimStartMs = 0;
  let aimActive = false;

  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${t("fire.pass_aim_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (2/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${t("fire.pass_aim_title", "A — Aim at Base of Fire")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${t("fire.pass_aim_desc", "Point your device directly at the base of the fire. Hold steady for 0.8 seconds.")}</div>
    <div id="aim-progress-bar" style="width:100%;max-width:320px;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="aim-progress-fill" style="width:0%;height:100%;background:#00e676;transition:width 0.1s;"></div>
    </div>
  `;

  // raycaster for aim detection against fire mesh
  const THREE = typeof window !== "undefined" && window.THREE;
  if (!THREE || !_fireMesh || !_controller) {
    // fallback: skip to button-based aim
    _showAimFallback(overlay, container);
    return;
  }

  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);

  // add frame callback for aim tracking
  _aimFrameHandler = ({ deltaMs }) => {
    if (!_fireMesh || !_controller) return;

    const camera = _controller.getCamera();
    if (!camera) return;

    // cast ray from camera center
    raycaster.setFromCamera(screenCenter, camera);
    const intersects = raycaster.intersectObject(_fireMesh, true);

    const targetBase = _fireMesh.getObjectByName("fire-target-base");
    let hitDistance = null;

    if (intersects.length > 0) {
      // compute distance to fire base center in world space
      const hitPoint = intersects[0].point;
      const baseWorldPos = new THREE.Vector3();
      if (targetBase) {
        targetBase.getWorldPosition(baseWorldPos);
      } else {
        baseWorldPos.copy(_fireMesh.position);
        baseWorldPos.y += 0.85 * _fireMesh.scale.y;
      }
      hitDistance = hitPoint.distanceTo(baseWorldPos);
    }

    if (hitDistance !== null && hitDistance < FIRE_BASE_MAX_DISTANCE_3D * _fireMesh.scale.x * 2) {
      if (!aimActive) {
        aimActive = true;
        aimStartMs = 0;
      }
      aimStartMs += deltaMs;

      const { progress, isComplete } = evaluateGazeAimProgress(true, aimStartMs, 800);
      const fill = document.getElementById("aim-progress-fill");
      if (fill) fill.style.width = `${Math.round(progress * 100)}%`;

      if (isComplete) {
        if (_controller && _aimFrameHandler) {
          _controller.offFrame(_aimFrameHandler);
          _aimFrameHandler = null;
        }
        const accuracy = calcRaycastAimAccuracy(hitDistance, FIRE_BASE_MAX_DISTANCE_3D);
        logger.info({ event: "webxr_aim_complete", accuracy, hitDistance }, "Aim complete (WebXR)");
        _onAimComplete(overlay, container, accuracy);
      }
    } else {
      aimActive = false;
      aimStartMs = 0;
      const fill = document.getElementById("aim-progress-fill");
      if (fill) fill.style.width = "0%";
    }
  };

  _controller.onFrame(_aimFrameHandler);
}

// fallback aim (no raycaster available — button-based)
function _showAimFallback(overlay, container) {
  if (!overlay) return;
  const btn = document.createElement("button");
  btn.id = "btn-webxr-aim-confirm";
  btn.style.cssText = "margin-top:0.6rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;";
  btn.textContent = t("fire.pass_aim_btn", "🎯 I'm aiming at the base");
  btn.addEventListener("click", () => {
    if (_controller && _aimFrameHandler) {
      _controller.offFrame(_aimFrameHandler);
      _aimFrameHandler = null;
    }
    _onAimComplete(overlay, container, 0.85);
  });
  overlay.appendChild(btn);
}

// aim done — advance to squeeze
function _onAimComplete(overlay, container, accuracy) {
  if (_interactionState) {
    _interactionState.phase = "squeeze";
    _interactionState.aimAccuracy = accuracy;
  }
  logger.info({ event: "webxr_aim_done", accuracy }, "Aim phase done (WebXR)");
  _showSqueezePhase(overlay, container, accuracy);
}

// squeeze phase: tap and hold lever
function _showSqueezePhase(overlay, container, aimAccuracy) {
  if (!overlay) return;

  let squeezeTimer = null;
  let squeezeStart = null;

  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${t("fire.pass_squeeze_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (3/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${t("fire.pass_squeeze_title", "S — Squeeze the Handle")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${t("fire.pass_squeeze_desc", "Press and hold the button below for 1.5 seconds to discharge the extinguisher.")}</div>
    <div id="squeeze-progress-bar" style="width:100%;max-width:320px;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="squeeze-progress-fill" style="width:0%;height:100%;background:#f59e0b;transition:width 0.05s;"></div>
    </div>
  `;

  const btn = document.createElement("button");
  btn.id = "btn-webxr-squeeze";
  btn.style.cssText = "margin-top:0.8rem;padding:0.9rem 1.5rem;background:#f59e0b;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;user-select:none;";
  btn.textContent = t("fire.pass_squeeze_btn", "👇 HOLD TO SQUEEZE (1.5s)");

  const startHold = () => {
    squeezeStart = Date.now();
    squeezeTimer = setInterval(() => {
      const elapsed = Date.now() - squeezeStart;
      const progress = Math.min(1, elapsed / 1500);
      const fill = document.getElementById("squeeze-progress-fill");
      if (fill) fill.style.width = `${Math.round(progress * 100)}%`;

      if (isSqueezeComplete(elapsed, 1500)) {
        clearInterval(squeezeTimer);
        squeezeTimer = null;
        logger.info({ event: "webxr_squeeze_complete", elapsed }, "Squeeze done (WebXR)");
        _onSqueezeComplete(overlay, container, aimAccuracy);
      }
    }, 50);
  };

  const cancelHold = () => {
    if (squeezeTimer) {
      clearInterval(squeezeTimer);
      squeezeTimer = null;
    }
    const fill = document.getElementById("squeeze-progress-fill");
    if (fill) fill.style.width = "0%";
  };

  btn.addEventListener("mousedown", startHold);
  btn.addEventListener("touchstart", (e) => { e.preventDefault(); startHold(); });
  btn.addEventListener("mouseup", cancelHold);
  btn.addEventListener("mouseleave", cancelHold);
  btn.addEventListener("touchend", cancelHold);
  btn.addEventListener("touchcancel", cancelHold);

  overlay.appendChild(btn);
}

// squeeze done — advance to sweep
function _onSqueezeComplete(overlay, container, aimAccuracy) {
  if (_interactionState) _interactionState.phase = "sweep";
  _showSweepPhase(overlay, container, aimAccuracy);
}

// sweep phase: move device side to side
function _showSweepPhase(overlay, container, aimAccuracy) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${t("fire.pass_sweep_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (4/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${t("fire.pass_sweep_title", "S — Sweep Side to Side")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${t("fire.pass_sweep_desc", "Move your device left and right to sweep the fire base. Cover at least 75% of the fire width.")}</div>
    <div id="sweep-progress-bar" style="width:100%;max-width:320px;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="sweep-progress-fill" style="width:0%;height:100%;background:#06b6d4;transition:width 0.1s;"></div>
    </div>
  `;

  const sweepSamples = [];

  // use webxr camera pose x-position for sweep tracking (real 6DOF motion)
  _sweepFrameHandler = ({ pose }) => {
    if (!pose || !pose.transform) return;
    const cameraX = pose.transform.position.x;
    sweepSamples.push(cameraX);

    const coverage = calcMotionSweepCoverage(sweepSamples);
    const fill = document.getElementById("sweep-progress-fill");
    if (fill) fill.style.width = `${Math.round(coverage * 100)}%`;

    if (isSweepComplete(coverage)) {
      if (_controller && _sweepFrameHandler) {
        _controller.offFrame(_sweepFrameHandler);
        _sweepFrameHandler = null;
      }
      logger.info({ event: "webxr_sweep_complete", coverage, sampleCount: sweepSamples.length }, "Sweep done (WebXR)");

      // fire step 2 checkpoint with aim accuracy
      const passed = aimAccuracy >= AIM_PASS_THRESHOLD;
      fireCheckpointResult(CP_EXTINGUISHER_ID, passed, {
        method: "webxr_pass_technique",
        accuracy: aimAccuracy,
        sweepCoverage: coverage,
        target: passed ? "base" : "missed",
        tier: 1
      });

      _setupStep3WebXR(container, passed);
    }
  };

  if (_controller) {
    _controller.onFrame(_sweepFrameHandler);
  }

  // fallback button in case motion tracking isn't working
  const btn = document.createElement("button");
  btn.id = "btn-webxr-sweep-skip";
  btn.style.cssText = "margin-top:1rem;padding:0.6rem 1rem;background:#334155;color:#94a3b8;border:1px solid #475569;border-radius:8px;font-size:0.85rem;cursor:pointer;display:block;width:100%;max-width:320px;";
  btn.textContent = "Skip (if motion not detected)";
  btn.addEventListener("click", () => {
    if (_controller && _sweepFrameHandler) {
      _controller.offFrame(_sweepFrameHandler);
      _sweepFrameHandler = null;
    }
    const passed = aimAccuracy >= AIM_PASS_THRESHOLD;
    fireCheckpointResult(CP_EXTINGUISHER_ID, passed, {
      method: "webxr_pass_technique_skip_sweep",
      accuracy: aimAccuracy,
      sweepCoverage: 1.0,
      target: passed ? "base" : "missed",
      tier: 1
    });
    _setupStep3WebXR(container, passed);
  });
  overlay.appendChild(btn);
}

// step 3: evacuation route selection (pure DOM, same as tier 2)
function _setupStep3WebXR(container, _step2Passed) {
  _currentStep = 3;
  logger.info({ event: "webxr_fire_step_start", step: 3 }, "Evacuation (WebXR)");

  registerCheckpoint({
    id: CP_EVACUATION_ID,
    type: "select",
    onTrigger: (detail) => {
      logger.info({ event: "checkpoint_cb", id: detail.checkpointId, passed: detail.passed }, "Evac CP (WebXR)");
    }
  });

  const overlay = document.getElementById("fire-module-overlay");
  if (!overlay) return;

  const CORRECT = "wind_based_upwind";
  const options = [
    { id: "wind_based_upwind", label: "Evacuate upwind (away from smoke direction)" },
    { id: "nearest_door", label: "Run to the nearest door immediately" },
    { id: "elevator", label: "Take the elevator to exit floor" },
    { id: "shelter_in_place", label: "Stay in place and wait for rescue" }
  ];

  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;">${t("fire.evac_badge_3", "🔥 STEP 3 / 3 — EVACUATION ROUTE")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;">${t("fire.evac_title_3", "Choose Safest Evacuation Path")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;">${t("fire.evac_desc_3", "After using the extinguisher, you must evacuate. Select the safest option:")}</div>
  `;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem;";

  const onSelect = (id, correct) => {
    fireCheckpointResult(CP_EVACUATION_ID, correct, {
      selectedOption: id,
      correctOption: CORRECT,
      tier: 1
    });
    const allPassed = Boolean(_step2Passed && correct);
    _showCompletionWebXR(overlay, container, allPassed);
  };

  options.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.id = `evacuation-opt-${id}`;
    btn.dataset.optionId = id;
    btn.style.cssText = [
      "padding:0.7rem 0.5rem", "border-radius:8px",
      "border:2px solid #ff6a00", "background:#1a0a00",
      "color:#fff", "cursor:pointer", "font-size:0.9rem"
    ].join(";");
    btn.textContent = label;
    btn.addEventListener("click", () => onSelect(id, id === CORRECT));
    wrapper.appendChild(btn);
  });

  overlay.appendChild(wrapper);
}

// completion screen
function _showCompletionWebXR(overlay, container, passed) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:1.15rem;font-weight:bold;color:${passed ? "#00e676" : "#ff1744"};margin-bottom:0.5rem;">
      ${passed ? t("cert.passed", "✔ Module Complete — All Steps Passed") : t("cert.review_needed", "✖ Module Complete — Review Needed")}
    </div>
    <div style="font-size:0.92rem;color:#f1f5f9;margin-bottom:0.8rem;">
      ${passed ? t("fire.complete_pass_desc", "Excellent work! You completed the PASS fire extinguisher technique correctly.") : t("fire.complete_fail_desc", "Some steps need improvement. Review the PASS technique and try again.")}
    </div>
  `;

  const btnExit = document.createElement("button");
  btnExit.id = "btn-exit-module";
  btnExit.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.5rem;background:#ff6a00;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;";
  btnExit.textContent = t("app.exit_module", "✖ Exit Module");
  btnExit.addEventListener("click", () => {
    cleanupWebXRFireModule();
    unloadModule();
  });
  overlay.appendChild(btnExit);

  logger.info({ event: "webxr_fire_module_complete", passed }, "Fire module complete (WebXR)");
}

// entry point for tier 1 webxr fire module
function startFireModuleWebXR(container, controller) {
  _currentStep = 0;
  _controller = controller;
  logger.info({ event: "webxr_fire_module_start" }, "Fire module starting (WebXR Tier 1)");

  cleanupWebXRFireModule();
  _controller = controller;

  _createOverlay(container, "<div>Loading Fire & Explosion Response (WebXR)...</div>");
  _setupStep1WebXR(container);
}

export {
  startFireModuleWebXR,
  cleanupWebXRFireModule,
  getCurrentStepWebXR
};
