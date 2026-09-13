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
  CP_EXIT_ID, CP_EXTINGUISHER_ID, CP_EVACUATION_WEBXR_ID, EXIT_ANCHOR_ID
} from "./fire-response.js";
import { selectionSingle, aimDwell, spatialAlignment } from "../../assessment/observations.js";
import {
  renderAlertFlash,
  renderGasGaugeSvg,
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  renderDecisionWheel,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_EXPLOSIVE_THRESHOLD
} from "./decision.js";

const logger = createLogger("FireModuleWebXR");

// step tracking
let _currentStep = 0;
let _controller = null;
let _fireMesh = null;
let _extMesh = null;
let _frameHandler = null;
let _scanFrameHandler = null;
let _aimFrameHandler = null;
let _sweepFrameHandler = null;
let _placementScreenTap = null;
let _placementConfirmedHandler = null;
let _interactionState = null;

// hazard decision state
let _methaneReading = null;
let _decisionMade = null;
let _currentBranch = null;
let _alertStrobe = null;

// zoom state
let _zoomScale = 1.0;
const BASE_EXT_SCALE = 0.35;
const BASE_FIRE_SCALE = 0.35;
let _zoomControlsEl = null;
let _pinchStartDist = null;
let _pinchStartScale = 1.0;
let _touchZoomHandler = null;

// apply zoom scale to extinguisher and fire
function setZoomScaleWebXR(targetScale) {
  _zoomScale = Math.max(0.6, Math.min(2.5, targetScale));
  if (_extMesh) {
    const s = BASE_EXT_SCALE * _zoomScale;
    _extMesh.scale.set(s, s, s);
  }
  if (_fireMesh) {
    const s = BASE_FIRE_SCALE * _zoomScale;
    _fireMesh.scale.set(s, s, s);
  }
  return _zoomScale;
}

// read zoom scale
function getZoomScaleWebXR() {
  return _zoomScale;
}

// create floating zoom in/out controls
function _setupZoomControls() {
  if (_zoomControlsEl || typeof document === "undefined") return;
  const zoomDiv = document.createElement("div");
  zoomDiv.id = "safear-zoom-controls";
  zoomDiv.style.cssText = "position:fixed;top:64px;right:16px;z-index:150;display:flex;flex-direction:column;gap:6px;pointer-events:auto;";

  const btnIn = document.createElement("button");
  btnIn.id = "btn-zoom-in";
  btnIn.title = "Zoom In";
  btnIn.style.cssText = "background:transparent !important;border:none !important;outline:none !important;box-shadow:none !important;color:#fff;font-size:1.5rem;font-weight:bold;cursor:pointer;padding:6px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);line-height:1;";
  btnIn.textContent = "🔍 +";
  btnIn.addEventListener("click", () => setZoomScaleWebXR(_zoomScale + 0.2));

  const btnOut = document.createElement("button");
  btnOut.id = "btn-zoom-out";
  btnOut.title = "Zoom Out";
  btnOut.style.cssText = "background:transparent !important;border:none !important;outline:none !important;box-shadow:none !important;color:#fff;font-size:1.5rem;font-weight:bold;cursor:pointer;padding:6px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);line-height:1;";
  btnOut.textContent = "🔍 −";
  btnOut.addEventListener("click", () => setZoomScaleWebXR(_zoomScale - 0.2));

  zoomDiv.appendChild(btnIn);
  zoomDiv.appendChild(btnOut);
  document.body.appendChild(zoomDiv);
  _zoomControlsEl = zoomDiv;

  if (typeof window !== "undefined") {
    _touchZoomHandler = {
      start: (e) => {
        if (e.touches && e.touches.length === 2) {
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          _pinchStartDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
          _pinchStartScale = _zoomScale;
        }
      },
      move: (e) => {
        if (e.touches && e.touches.length === 2 && _pinchStartDist) {
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          const currentDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
          if (_pinchStartDist > 10) {
            const factor = currentDist / _pinchStartDist;
            setZoomScaleWebXR(_pinchStartScale * factor);
          }
        }
      },
      end: (e) => {
        if (!e.touches || e.touches.length < 2) {
          _pinchStartDist = null;
        }
      }
    };
    window.addEventListener("touchstart", _touchZoomHandler.start, { passive: true });
    window.addEventListener("touchmove", _touchZoomHandler.move, { passive: true });
    window.addEventListener("touchend", _touchZoomHandler.end, { passive: true });
  }
}

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
  if (_scanFrameHandler && _controller) {
    _controller.offFrame(_scanFrameHandler);
    _scanFrameHandler = null;
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
    window.removeEventListener("pointerdown", _placementScreenTap);
    _placementScreenTap = null;
  }
  if (_placementConfirmedHandler && typeof window !== "undefined") {
    window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    _placementConfirmedHandler = null;
  }
  if (_zoomControlsEl && _zoomControlsEl.parentNode) {
    _zoomControlsEl.parentNode.removeChild(_zoomControlsEl);
    _zoomControlsEl = null;
  }
  if (_touchZoomHandler && typeof window !== "undefined") {
    window.removeEventListener("touchstart", _touchZoomHandler.start);
    window.removeEventListener("touchmove", _touchZoomHandler.move);
    window.removeEventListener("touchend", _touchZoomHandler.end);
    _touchZoomHandler = null;
  }
  _zoomScale = 1.0;
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

  if (_alertStrobe && typeof _alertStrobe.dismiss === "function") {
    _alertStrobe.dismiss();
    _alertStrobe = null;
  }
  _methaneReading = null;
  _decisionMade = null;
  _currentBranch = null;

  if (typeof document !== "undefined") {
    const decPanel = document.getElementById("fire-decision-panel");
    if (decPanel && decPanel.parentNode) decPanel.parentNode.removeChild(decPanel);
    const alertEl = document.getElementById("fire-alert-overlay");
    if (alertEl && alertEl.parentNode) alertEl.parentNode.removeChild(alertEl);
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
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${badge}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${title}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${desc}</div>
  `;
  const btnNext = document.createElement("button");
  btnNext.id = "btn-step-next";
  btnNext.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#ff6a00;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btnNext.textContent = buttonText || "Next ➜";
  btnNext.addEventListener("click", (e) => {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    onNext();
  });
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

    // spawn extinguisher hidden until surface detected or placed
    if (!_extMesh && _controller) {
      _extMesh = createExtinguisherMesh();
      if (_extMesh) {
        _extMesh.visible = false;
        const s = BASE_EXT_SCALE * _zoomScale;
        _extMesh.scale.set(s, s, s);
        _controller.addToScene(_extMesh);
      }
    }

    // preview extinguisher sitting on detected surface while scanning
    if (_controller && typeof _controller.onFrame === "function") {
      _scanFrameHandler = () => {
        if (placed) return;
        if (_controller._lastHitPose && _controller.state === "surface_found") {
          const hp = _controller._lastHitPose.transform.position;
          if (_extMesh) {
            _extMesh.visible = true;
            _extMesh.position.set(hp.x, hp.y, hp.z);
          }
          const statusEl = document.getElementById("placement-status-text");
          if (statusEl && !statusEl.dataset.surfaceFound) {
            statusEl.dataset.surfaceFound = "true";
            statusEl.style.color = "#00e676";
            statusEl.textContent = t("fire.surface_found", "Surface detected! Tap button or floor to place extinguisher.");
          }
        } else if (_extMesh && !placed) {
          _extMesh.visible = false;
        }
      };
      _controller.onFrame(_scanFrameHandler);
    }

    overlay.innerHTML = `
      <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_badge", "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)")}</div>
      <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_title", "Place Extinguisher on Ground")}</div>
      <div id="placement-status-text" style="margin:0.35rem 0 0.6rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_desc", "Point your tablet at the floor or table. Tap the green button below (or tap anywhere on screen) to place the extinguisher.")}</div>
      <button id="btn-place-extinguisher" style="display:block;width:100%;max-width:340px;padding:12px 0;border:none !important;outline:none !important;background:transparent !important;box-shadow:none !important;color:#00e676;font-size:1.05rem;font-weight:bold;cursor:pointer;margin:0.5rem 0;pointer-events:auto !important;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.place_btn", "🎯 TAP TO PLACE EXTINGUISHER ON FLOOR")}</button>
    `;

    let placed = false;
    let sessionSelectHandler = null;

    // placement execution function
    const doPlace = (pos, viewerQuat) => {
      if (placed) return;
      placed = true;

      if (_scanFrameHandler && _controller && typeof _controller.offFrame === "function") {
        _controller.offFrame(_scanFrameHandler);
        _scanFrameHandler = null;
      }

      if (_placementScreenTap && typeof window !== "undefined") {
        window.removeEventListener("click", _placementScreenTap);
        window.removeEventListener("pointerdown", _placementScreenTap);
        _placementScreenTap = null;
      }
      if (sessionSelectHandler && _controller && _controller.session && typeof _controller.session.removeEventListener === "function") {
        _controller.session.removeEventListener("select", sessionSelectHandler);
        sessionSelectHandler = null;
      }
      if (_placementConfirmedHandler && typeof window !== "undefined") {
        window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
        _placementConfirmedHandler = null;
      }

      const finalPos = pos || { x: 0, y: -0.45, z: -1.20 };
      logger.info({ event: "extinguisher_placed", position: finalPos }, "Extinguisher placed on surface");

      // position extinguisher flush at placed spot
      if (!_extMesh && _controller) {
        _extMesh = createExtinguisherMesh();
        if (_extMesh) _controller.addToScene(_extMesh);
      }
      if (_extMesh) {
        _extMesh.visible = true;
        _extMesh.position.set(finalPos.x, finalPos.y, finalPos.z);
        const s = BASE_EXT_SCALE * _zoomScale;
        _extMesh.scale.set(s, s, s);
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
        const s = BASE_FIRE_SCALE * _zoomScale;
        _fireMesh.scale.set(s, s, s);
        _controller.addToScene(_fireMesh);
      }

      // setup zoom controls now that objects are anchored in scene
      _setupZoomControls();

      // start animation frame handler
      _frameHandler = ({ deltaMs }) => {
        if (_fireMesh) animateFireMesh(_fireMesh, deltaMs);
        if (_extMesh) animateExtinguisherMesh(_extMesh, deltaMs);
      };
      if (_controller) _controller.onFrame(_frameHandler);

      // fire checkpoint and advance
      // tier 1 has no anchored exit sign yet, so there is no angle to measure.
      // report that honestly — the server refuses to certify an unmeasured checkpoint.
      fireCheckpointResult(
        CP_EXIT_ID,
        true,
        { method: "webxr_surface_placement", measured: false },
        spatialAlignment({
          anchorId: EXIT_ANCHOR_ID,
          angularErrorRad: null,
          dwellMs: 0,
          frameCount: 0,
          trackingSource: "webxr_pose"
        })
      );

      if (overlay) {
        overlay.innerHTML = `
          <div style="font-size:1.05rem;font-weight:bold;color:#00e676;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">✔ Extinguisher Placed on Ground!</div>
          <div style="margin:0.4rem 0 0.6rem 0;font-size:0.92rem;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">The 3D fire extinguisher is anchored to the surface. Tap below to begin PASS training.</div>
          <button id="btn-proceed-step2" style="margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#00e676;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">✔ Begin PASS Training ➜</button>
        `;
        const btnProceed = overlay.querySelector("#btn-proceed-step2");
        if (btnProceed) {
          btnProceed.addEventListener("click", () => {
            _setupStep2WebXR(container);
          });
        }
      }
    };

    const btnPlace = overlay.querySelector("#btn-place-extinguisher");

    const triggerPlacement = (e) => {
      if (e) {
        if (typeof e.preventDefault === "function") e.preventDefault();
        if (typeof e.stopPropagation === "function") e.stopPropagation();
      }
      if (placed) return;

      if (btnPlace) {
        btnPlace.style.opacity = "0.7";
        btnPlace.disabled = true;
      }

      let currentPos = null;
      let viewerQuat = null;

      if (_controller) {
        if (typeof _controller.confirmPlacement === "function") {
          _controller.confirmPlacement();
        }
        currentPos = _controller._placedTransform || (_controller._lastHitPose && {
          x: _controller._lastHitPose.transform.position.x,
          y: _controller._lastHitPose.transform.position.y,
          z: _controller._lastHitPose.transform.position.z
        });
        viewerQuat = _controller._viewerQuaternionAtPlacement || (_controller._lastViewerPose && {
          x: _controller._lastViewerPose.transform.orientation.x,
          y: _controller._lastViewerPose.transform.orientation.y,
          z: _controller._lastViewerPose.transform.orientation.z,
          w: _controller._lastViewerPose.transform.orientation.w
        });
      }

      doPlace(currentPos || { x: 0, y: -0.45, z: -1.20 }, viewerQuat);
    };

    // 1. Hook up action button with click, pointerdown, and touchstart
    if (btnPlace) {
      btnPlace.addEventListener("click", triggerPlacement);
      btnPlace.addEventListener("pointerdown", triggerPlacement);
      btnPlace.addEventListener("touchstart", triggerPlacement, { passive: false });
    }

    // 2. Hook up screen tap fallback with delay to prevent previous button click bubbling
    setTimeout(() => {
      if (placed) return;
      _placementScreenTap = (e) => {
        triggerPlacement(e);
      };
      window.addEventListener("click", _placementScreenTap, { once: true });
      window.addEventListener("pointerdown", _placementScreenTap, { once: true });
    }, 150);

    // 3. Listen for WebXR session select event directly
    if (_controller && _controller.session && typeof _controller.session.addEventListener === "function") {
      sessionSelectHandler = () => {
        triggerPlacement();
      };
      _controller.session.addEventListener("select", sessionSelectHandler, { once: true });
    }

    // 4. Listen for placement confirmation from controller
    _placementConfirmedHandler = (e) => {
      const { position, viewerQuaternion } = (e && e.detail) || {};
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
      _triggerHazardDecisionPhase(container, overlay, () => {
        showPlacementScreen();
      });
    }
  }

  renderCurrentSubscreen();
}

// strobe emergency flash then show gas gauge wheel
function _triggerHazardDecisionPhase(container, overlay, onExtinguishProceed) {
  if (overlay) overlay.innerHTML = "";

  const onAlertDone = () => {
    _showDecisionWheelStep(container, overlay, onExtinguishProceed);
  };

  _alertStrobe = renderAlertFlash(container, {
    durationMs: 1500,
    onDone: onAlertDone
  });

  if (!_alertStrobe) {
    onAlertDone();
  }
}

// show svg gas gauge and decision buttons
function _showDecisionWheelStep(container, overlay, onExtinguishProceed) {
  if (overlay) overlay.innerHTML = "";

  if (_methaneReading === null || typeof _methaneReading !== "number") {
    _methaneReading = generateMethaneReading();
  }

  renderDecisionWheel(overlay, {
    reading: _methaneReading,
    onDecision: ({ choice, reading }) => {
      _decisionMade = choice;
      _currentBranch = choice === DECISION_CHOICES.EVACUATE ? "evacuate" : "suppress";

      const feedbackSlot = overlay.querySelector ? overlay.querySelector("#decision-feedback-slot") : document.getElementById("decision-feedback-slot");

      if (choice === DECISION_CHOICES.EXTINGUISH) {
        const btnProceed = document.createElement("button");
        btnProceed.id = "btn-decision-proceed";
        btnProceed.className = "btn-decision-proceed";
        btnProceed.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.4rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 12px rgba(16,185,129,0.4);";
        btnProceed.textContent = "✔ Proceed to Extinguisher Placement ➜";
        btnProceed.addEventListener("click", () => {
          const decPanel = document.getElementById("fire-decision-panel");
          if (decPanel && decPanel.remove) decPanel.remove();
          onExtinguishProceed();
        });
        if (feedbackSlot && feedbackSlot.appendChild) feedbackSlot.appendChild(btnProceed);
      } else if (choice === DECISION_CHOICES.EVACUATE) {
        const btnProceed = document.createElement("button");
        btnProceed.id = "btn-decision-proceed";
        btnProceed.className = "btn-decision-proceed";
        btnProceed.style.cssText = "margin-top:0.8rem;padding:0.8rem 1.4rem;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;box-shadow:0 0 12px rgba(239,68,68,0.4);";
        btnProceed.textContent = "🚨 Confirm Evacuation Order ➜";
        btnProceed.addEventListener("click", () => {
          const decPanel = document.getElementById("fire-decision-panel");
          if (decPanel && decPanel.remove) decPanel.remove();
          _showEvacuateConfirmation(container, overlay, reading);
        });
        if (feedbackSlot && feedbackSlot.appendChild) feedbackSlot.appendChild(btnProceed);
      }
    }
  });
}

// show branch a evacuation message
function _showEvacuateConfirmation(container, overlay, reading) {
  if (!overlay) return;
  const isHigh = reading >= METHANE_EXPLOSIVE_THRESHOLD;
  overlay.innerHTML = `
    <div id="fire-hud-card" class="fire-hud-card">
      <div class="hud-badge">🚨 BRANCH A — IMMEDIATE EVACUATION</div>
      <div class="hud-title">${isHigh ? "CRITICAL METHANE LEVEL (>= 5.0%)" : "PRECAUTIONARY EVACUATION"}</div>
      <div class="hud-desc">${isHigh ? "Atmosphere is explosive. Fire suppression is strictly forbidden under mining regulations. Follow emergency route immediately." : "Evacuation selected. Move promptly along marked emergency path to the nearest safe surface exit."}</div>
    </div>
  `;
  const btn = document.createElement("button");
  btn.id = "btn-exit-found";
  btn.style.cssText = "margin-top:0.6rem;padding:0.8rem 1.5rem;background:#00e676;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:bold;display:block;width:100%;";
  btn.textContent = "✔ Confirm Evacuation Route";
  btn.addEventListener("click", () => {
    fireCheckpointResult(
      CP_EXIT_ID,
      true,
      { method: "branch_a_evacuate", measured: false, reading },
      spatialAlignment({
        anchorId: EXIT_ANCHOR_ID,
        angularErrorRad: null,
        dwellMs: 0,
        frameCount: 0,
        trackingSource: "webxr_pose"
      })
    );
    fireCheckpointResult(
      CP_EVACUATION_WEBXR_ID,
      true,
      { selected: "sound_alarm_then_evacuate", branch: "evacuate", reading },
      typeof selectionSingle === "function" ? selectionSingle("sound_alarm_then_evacuate") : null
    );
    _showCompletionWebXR(overlay, container, true);
  });
  overlay.appendChild(btn);
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

// pin pull phase: tap or swipe to pull pin
function _showPinPhase(overlay, container) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_pull_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (1/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_pull_title", "P — Pull the Pin")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_pull_desc", "Tap anywhere to select the pin, then swipe right to pull it out.")}</div>
  `;
  const btn = document.createElement("button");
  btn.id = "btn-webxr-pin-pull";
  btn.style.cssText = "padding:0.75rem 0;background:transparent !important;color:#00e5ff;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btn.textContent = t("fire.pass_pull_badge_btn", "👉 SWIPE RIGHT OR TAP TO PULL PIN");

  let pinPulled = false;
  const _cleanPinListeners = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("touchstart", onScreenTouchStart);
      window.removeEventListener("touchend", onScreenTouchEnd);
      window.removeEventListener("mousedown", onScreenTouchStart);
      window.removeEventListener("mouseup", onScreenTouchEnd);
    }
  };

  const doPull = () => {
    if (pinPulled) return;
    pinPulled = true;
    _cleanPinListeners();
    _onPinPulled(overlay, container);
  };

  let dragStart = null;
  btn.addEventListener("click", () => doPull());
  btn.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    if (touch) dragStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  btn.addEventListener("touchend", (e) => {
    const touch = e.changedTouches ? e.changedTouches[0] : null;
    if (touch && dragStart) {
      const dx = touch.clientX - dragStart.x;
      const dist = calcDragDistance(dragStart, { x: touch.clientX, y: touch.clientY });
      if (dx > 25 || dist < 20 || isPinPullComplete(dist)) {
        doPull();
        return;
      }
    }
    doPull();
  });
  btn.addEventListener("mousedown", (e) => {
    dragStart = { x: e.clientX, y: e.clientY };
  });
  btn.addEventListener("mouseup", (e) => {
    if (dragStart) {
      const dx = e.clientX - dragStart.x;
      const dist = calcDragDistance(dragStart, { x: e.clientX, y: e.clientY });
      if (dx > 25 || dist < 20 || isPinPullComplete(dist)) {
        doPull();
        return;
      }
    }
    doPull();
  });

  // screen swipe / tap detection on window
  let windowTouchStart = null;
  const onScreenTouchStart = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    if (touch) {
      windowTouchStart = { x: touch.clientX, y: touch.clientY };
    }
  };
  const onScreenTouchEnd = (e) => {
    const touch = e.changedTouches ? e.changedTouches[0] : (e.clientX ? e : null);
    if (touch && windowTouchStart) {
      const dx = touch.clientX - windowTouchStart.x;
      const dist = calcDragDistance(windowTouchStart, { x: touch.clientX, y: touch.clientY });
      if (dx > 25 || dist < 20) {
        doPull();
      }
    }
    windowTouchStart = null;
  };

  if (typeof window !== "undefined") {
    window.addEventListener("touchstart", onScreenTouchStart, { passive: true });
    window.addEventListener("touchend", onScreenTouchEnd, { passive: true });
    window.addEventListener("mousedown", onScreenTouchStart);
    window.addEventListener("mouseup", onScreenTouchEnd);
  }

  overlay.appendChild(btn);
}

// pin pulled — animate pin out, advance to aim
function _onPinPulled(overlay, container) {
  if (_interactionState) _interactionState.phase = "aim";

  // animate pin removal on 3D mesh
  if (_extMesh && _extMesh.userData) {
    const pin = _extMesh.getObjectByName("extinguisher-pin");
    if (pin) pin.visible = false;
    const arrow = _extMesh.getObjectByName("extinguisher-guide-arrow");
    if (arrow) arrow.visible = false;
    const ring = _extMesh.getObjectByName("ext-pin-ring");
    if (ring) ring.visible = false;
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
  let aimFrames = 0;

  overlay.innerHTML = `
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_aim_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (2/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_aim_title", "A — Aim at Base of Fire")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_aim_desc", "Point your device directly at the base of the fire. Hold steady for 0.8 seconds.")}</div>
    <div id="aim-progress-bar" style="width:100%;max-width:320px;height:8px;background:rgba(30,41,59,0.7);border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="aim-progress-fill" style="width:0%;height:100%;background:#00e676;transition:width 0.1s;"></div>
    </div>
  `;

  // raycaster for aim detection against fire mesh
  const THREE = typeof window !== "undefined" && window.THREE;
  if (!THREE || !_fireMesh || !_controller) {
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
        aimFrames = 0;
      }
      aimStartMs += deltaMs;
      aimFrames += 1;

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
        _onAimComplete(overlay, container, accuracy, hitDistance, aimFrames, aimStartMs);
      }
    } else {
      aimActive = false;
      aimStartMs = 0;
      aimFrames = 0;
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
  btn.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#00e676;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
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
// hitDistanceM is null unless a real raycast produced it. the fallback button
// measures nothing, and the server scores a null distance zero.
function _onAimComplete(overlay, container, accuracy, hitDistanceM = null, frameCount = 0, dwellMs = 0) {
  if (_interactionState) {
    _interactionState.phase = "squeeze";
    _interactionState.aimAccuracy = accuracy;
    _interactionState.aimHitDistanceM = hitDistanceM;
    _interactionState.aimFrameCount = frameCount;
    _interactionState.aimDwellMs = dwellMs;
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
    <div style="font-size:0.95rem;font-weight:bold;color:#ff6a00;letter-spacing:0.5px;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_squeeze_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (3/4)")}</div>
    <div style="font-size:1.15rem;font-weight:bold;margin:0.25rem 0 0.4rem 0;color:#fff;text-shadow:0 1px 4px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_squeeze_title", "S — Squeeze the Handle")}</div>
    <div style="margin:0.35rem 0 0.8rem 0;font-size:0.92rem;line-height:1.45;color:#f1f5f9;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">${t("fire.pass_squeeze_desc", "Press and hold the button below for 1.5 seconds to discharge the extinguisher.")}</div>
    <div id="squeeze-progress-bar" style="width:100%;max-width:320px;height:8px;background:rgba(30,41,59,0.7);border-radius:4px;overflow:hidden;margin-top:0.5rem;">
      <div id="squeeze-progress-fill" style="width:0%;height:100%;background:#f59e0b;transition:width 0.05s;"></div>
    </div>
  `;

  const btn = document.createElement("button");
  btn.id = "btn-webxr-squeeze";
  btn.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#f59e0b;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:1.05rem;cursor:pointer;font-weight:bold;display:block;width:100%;max-width:320px;text-align:left;user-select:none;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btn.textContent = t("fire.pass_squeeze_btn", "👇 HOLD TO SQUEEZE (1.5s)");

  const startHold = () => {
    if (_extMesh && _extMesh.userData) {
      _extMesh.userData._discharging = true;
    }
    squeezeStart = Date.now();
    squeezeTimer = setInterval(() => {
      const elapsed = Date.now() - squeezeStart;
      const progress = Math.min(1, elapsed / 1500);
      const fill = document.getElementById("squeeze-progress-fill");
      if (fill) fill.style.width = `${Math.round(progress * 100)}%`;

      if (isSqueezeComplete(elapsed, 1500)) {
        clearInterval(squeezeTimer);
        squeezeTimer = null;
        if (_extMesh && _extMesh.userData) {
          _extMesh.userData._discharging = false;
        }
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
    if (_extMesh && _extMesh.userData) {
      _extMesh.userData._discharging = false;
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
    <div class="fire-hud-card">
      <div class="hud-badge">${t("fire.pass_sweep_badge", "🔥 STEP 2 / 3 — PASS TECHNIQUE (4/4)")}</div>
      <div class="hud-title">${t("fire.pass_sweep_title", "S — Sweep Side to Side")}</div>
      <div class="hud-desc">${t("fire.pass_sweep_desc", "Move your device left and right to sweep the fire base. Cover at least 75% of the fire width.")}</div>
      <div id="sweep-progress-bar" style="width:100%;height:8px;background:rgba(30,41,59,0.7);border-radius:4px;overflow:hidden;margin-top:0.5rem;">
        <div id="sweep-progress-fill" style="width:0%;height:100%;background:#06b6d4;transition:width 0.1s;"></div>
      </div>
    </div>
  `;

  const sweepSamples = [];

  // discharge white gas particles during sweeping
  if (_extMesh && _extMesh.userData) {
    _extMesh.userData._discharging = true;
  }

  let touchSweepHandler = null;
  const cleanupSweepTouch = () => {
    if (touchSweepHandler && typeof window !== "undefined") {
      window.removeEventListener("touchmove", touchSweepHandler);
      window.removeEventListener("pointermove", touchSweepHandler);
      touchSweepHandler = null;
    }
  };

  const processSweep = () => {
    const coverage = calcMotionSweepCoverage(sweepSamples);
    if (_fireMesh && _fireMesh.userData) {
      _fireMesh.userData.extinguishProgress = coverage;
    }
    const fill = document.getElementById("sweep-progress-fill");
    if (fill) fill.style.width = `${Math.round(coverage * 100)}%`;

    if (isSweepComplete(coverage)) {
      if (_controller && _sweepFrameHandler) {
        _controller.offFrame(_sweepFrameHandler);
        _sweepFrameHandler = null;
      }
      cleanupSweepTouch();
      if (_extMesh && _extMesh.userData) {
        _extMesh.userData._discharging = false;
      }
      if (_fireMesh && _fireMesh.userData) {
        _fireMesh.userData.extinguishProgress = 1.0;
      }
      logger.info({ event: "webxr_sweep_complete", coverage, sampleCount: sweepSamples.length }, "Sweep done (WebXR)");

      const passed = aimAccuracy >= AIM_PASS_THRESHOLD;
      fireCheckpointResult(
        CP_EXTINGUISHER_ID,
        passed,
        {
          method: "webxr_pass_technique",
          accuracy: aimAccuracy,
          sweepCoverage: coverage,
          target: passed ? "base" : "missed",
          tier: 1
        },
        aimDwell({
          hitDistanceM: _interactionState ? _interactionState.aimHitDistanceM : null,
          dwellMs: _interactionState ? _interactionState.aimDwellMs : 0,
          sweepCoverage: coverage,
          frameCount: _interactionState ? _interactionState.aimFrameCount : 0,
          trackingSource: "webxr_pose"
        })
      );

      _setupStep3WebXR(container, passed);
    }
  };

  // 1. WebXR camera pose tracking combining 6DOF translation and yaw rotation
  const THREE = typeof window !== "undefined" && window.THREE;
  let prevYaw = null;
  let accumYaw = 0;

  _sweepFrameHandler = ({ pose }) => {
    if (!pose || !pose.transform) return;
    const cameraX = pose.transform.position.x;

    let yawDelta = 0;
    if (THREE && pose.transform.orientation) {
      const q = new THREE.Quaternion(
        pose.transform.orientation.x,
        pose.transform.orientation.y,
        pose.transform.orientation.z,
        pose.transform.orientation.w
      );
      const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
      if (prevYaw !== null) {
        let diff = euler.y - prevYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        accumYaw += diff;
      }
      prevYaw = euler.y;
      yawDelta = accumYaw * 0.45;
    }

    const combinedSample = cameraX + yawDelta;
    sweepSamples.push(combinedSample);
    processSweep();
  };

  if (_controller) {
    _controller.onFrame(_sweepFrameHandler);
  }

  // 2. Touch screen sweep fallback
  if (typeof window !== "undefined") {
    touchSweepHandler = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      if (!touch) return;
      const screenSpan = ((touch.clientX / window.innerWidth) - 0.5) * 0.6;
      sweepSamples.push(screenSpan);
      processSweep();
    };
    window.addEventListener("touchmove", touchSweepHandler, { passive: true });
    window.addEventListener("pointermove", touchSweepHandler, { passive: true });
  }

  // fallback skip button
  const btn = document.createElement("button");
  btn.id = "btn-webxr-sweep-skip";
  btn.style.cssText = "margin-top:0.8rem;padding:0.5rem 0;background:transparent !important;color:#94a3b8;border:none !important;outline:none !important;box-shadow:none !important;border-radius:0;font-size:0.85rem;cursor:pointer;display:block;width:100%;max-width:320px;text-align:left;text-shadow:0 1px 3px #000;";
  btn.textContent = "Skip (if motion not detected)";
  btn.addEventListener("click", () => {
    if (_controller && _sweepFrameHandler) {
      _controller.offFrame(_sweepFrameHandler);
      _sweepFrameHandler = null;
    }
    cleanupSweepTouch();
    if (_extMesh && _extMesh.userData) {
      _extMesh.userData._discharging = false;
    }
    if (_fireMesh && _fireMesh.userData) {
      _fireMesh.userData.extinguishProgress = 1.0;
    }
    const passed = aimAccuracy >= AIM_PASS_THRESHOLD;
    // the sweep was skipped, so no coverage was observed. null, not 1.0.
    fireCheckpointResult(
      CP_EXTINGUISHER_ID,
      passed,
      {
        method: "webxr_pass_technique_skip_sweep",
        accuracy: aimAccuracy,
        sweepCoverage: 1.0,
        target: passed ? "base" : "missed",
        tier: 1
      },
      aimDwell({
        hitDistanceM: _interactionState ? _interactionState.aimHitDistanceM : null,
        dwellMs: _interactionState ? _interactionState.aimDwellMs : 0,
        sweepCoverage: null,
        frameCount: _interactionState ? _interactionState.aimFrameCount : 0,
        trackingSource: "webxr_pose"
      })
    );
    _setupStep3WebXR(container, passed);
  });
  overlay.appendChild(btn);
}

// step 3: evacuation route selection (pure DOM, same as tier 2)
function _setupStep3WebXR(container, _step2Passed) {
  _currentStep = 3;
  logger.info({ event: "webxr_fire_step_start", step: 3 }, "Evacuation (WebXR)");

  registerCheckpoint({
    id: CP_EVACUATION_WEBXR_ID,
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
    <div class="fire-hud-card">
      <div class="hud-badge">${t("fire.evac_badge_3", "🔥 STEP 3 / 3 — EVACUATION ROUTE")}</div>
      <div class="hud-title">${t("fire.evac_title_3", "Choose Safest Evacuation Path")}</div>
      <div class="hud-desc">${t("fire.evac_desc_3", "After using the extinguisher, you must evacuate. Select the safest option:")}</div>
      <div id="webxr-evac-options" style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.4rem;width:100%;"></div>
    </div>
  `;

  const wrapper = overlay.querySelector("#webxr-evac-options") || overlay;

  const onSelect = (id, correct) => {
    fireCheckpointResult(
      CP_EVACUATION_WEBXR_ID,
      correct,
      { selected: id, correct: CORRECT, tier: 1 },
      selectionSingle(id)
    );
    const allPassed = Boolean(_step2Passed && correct);
    _showCompletionWebXR(overlay, container, allPassed);
  };

  options.forEach(({ id, label }) => {
    const btn = document.createElement("button");
    btn.id = `evacuation-opt-${id}`;
    btn.dataset.optionId = id;
    btn.style.cssText = [
      "padding:0.65rem 0", "border-radius:0",
      "border:none !important", "outline:none !important", "background:transparent !important",
      "color:#ff9800", "cursor:pointer", "font-size:0.92rem",
      "font-weight:600", "line-height:1.3", "box-shadow:none !important",
      "text-align:left", "text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95)"
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
    <div style="font-size:1.15rem;font-weight:bold;color:${passed ? "#00e676" : "#ff1744"};margin-bottom:0.5rem;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">
      ${passed ? t("cert.passed", "✔ Module Complete — All Steps Passed") : t("cert.review_needed", "✖ Module Complete — Review Needed")}
    </div>
    <div style="font-size:0.92rem;color:#f1f5f9;margin-bottom:0.8rem;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);">
      ${passed ? t("fire.complete_pass_desc", "Excellent work! You completed the PASS fire extinguisher technique correctly.") : t("fire.complete_fail_desc", "Some steps need improvement. Review the PASS technique and try again.")}
    </div>
  `;

  const btnExit = document.createElement("button");
  btnExit.id = "btn-exit-module";
  btnExit.style.cssText = "margin-top:0.6rem;padding:0.75rem 0;background:transparent !important;color:#ff6a00;border:none !important;outline:none !important;box-shadow:none !important;font-size:1.05rem;cursor:pointer;font-weight:bold;text-align:left;text-shadow:0 1px 3px #000, 0 2px 8px rgba(0,0,0,0.95);";
  btnExit.textContent = t("app.exit_module", "✖ Exit Module");
  btnExit.addEventListener("click", () => {
    cleanupWebXRFireModule();
    unloadModule();
  });
  overlay.appendChild(btnExit);

  logger.info({ event: "webxr_fire_module_complete", passed }, "Fire module complete (WebXR)");
}

// entry point for tier 1 webxr fire module
function startFireModuleWebXR(container, controller, options = {}) {
  _currentStep = 0;
  _controller = controller;
  logger.info({ event: "webxr_fire_module_start" }, "Fire module starting (WebXR Tier 1)");

  cleanupWebXRFireModule();
  _controller = controller;

  if (options && typeof options.reading === "number" && !isNaN(options.reading)) {
    _methaneReading = options.reading;
  } else {
    _methaneReading = generateMethaneReading();
  }

  _createOverlay(container, "<div>Loading Fire & Explosion Response (WebXR)...</div>");
  _setupStep1WebXR(container);
}

// read methane gas concentration
function getMethaneReadingWebXR() {
  return _methaneReading;
}

// set methane gas concentration for testing
function setMethaneReadingWebXR(val) {
  _methaneReading = typeof val === "number" && !isNaN(val) ? val : 0;
}

// get active scenario branch
function getActiveBranchWebXR() {
  return _currentBranch;
}

// read trainee decision
function getDecisionMadeWebXR() {
  return _decisionMade;
}

export {
  startFireModuleWebXR,
  cleanupWebXRFireModule,
  getCurrentStepWebXR,
  setZoomScaleWebXR,
  getZoomScaleWebXR,
  getMethaneReadingWebXR,
  setMethaneReadingWebXR,
  getActiveBranchWebXR,
  getDecisionMadeWebXR,
  renderDecisionWheel,
  renderAlertFlash,
  renderGasGaugeSvg,
  generateMethaneReading,
  isCorrectDecision,
  getDecisionExplanation,
  CP_DECISION_ID,
  DECISION_CHOICES,
  METHANE_EXPLOSIVE_THRESHOLD
};
