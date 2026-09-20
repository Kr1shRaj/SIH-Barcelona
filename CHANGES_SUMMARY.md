# Code Changes Summary & Exact References

This document records all modifications made to the codebase for the Gas-Leak AR Module rebuild across all files, with exact file paths, line numbers, and diff explanations.

---

## Table of Contents
1. [`frontend/modules/gas-leak/gas-leak.js`](#1-frontendmodulesgas-leakgas-leakjs)
2. [`frontend/modules/gas-leak/graphics.js`](#2-frontendmodulesgas-leakgraphicsjs)
3. [`frontend/tests/gas_leak.test.js`](#3-frontendtestsgas_leaktestjs)
4. [`frontend/assets/models/gas-leak/CREDITS.md`](#4-frontendassetsmodelsgas-leakcreditsmd)
5. [`frontend/sw.js`](#5-frontendswjs)
6. [`frontend/tests/service_worker.test.js`](#6-frontendtestsservice_workertestjs)
7. [`frontend/locales/en.json`](#7-frontendlocalesenjson)
8. [`frontend/locales/hi.json`](#8-frontendlocaleshijson)
9. [`frontend/locales/sat.json`](#9-frontendlocalessatjson)
10. [`eslint.config.mjs`](#10-eslintconfigmjs)

---

## 1. [`frontend/modules/gas-leak/gas-leak.js`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js)

### Changes Overview
- Replaced static Three.js scene coordinates with dynamic WebXR placement via `controller.getPlacedTransform()` and `safear:placement_confirmed` event listener.
- Implemented 15-second inactivity hint timer (`HINT_TIMEOUT_MS = 15000`) that triggers educational hints upon stalling and sets `hintShown: true` in checkpoint context.
- Converted teach phase to render AR models immediately alongside narration and educational text.
- Added defensive teardown for hint timers, placement handlers, and transform coordinates in `cleanupGasLeakModule()`.
- Exported `HINT_TIMEOUT_MS`.

### Line References & Diff

#### [gas-leak.js:L54-L89](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L54-L89)
**Added Placement and Hint Timer State & Functions:**
```javascript
// placement tracking for webxr tier 1
let _placedTransform = null;
let _placementConfirmedHandler = null;

// inactivity hint timer duration (15s default, adjustable constant)
const HINT_TIMEOUT_MS = 15000;
let _hintTimer = null;
let _hintShown = false;

// start inactivity timer to show hint on stall
function _startHintTimer(overlay, hintText) {
  _clearHintTimer();
  _hintShown = false;
  _hintTimer = setTimeout(() => {
    _hintShown = true;
    if (overlay) {
      let hintEl = overlay.querySelector ? overlay.querySelector("#gas-step-hint") : null;
      if (!hintEl) {
        hintEl = document.createElement("div");
        hintEl.id = "gas-step-hint";
        hintEl.style.cssText = "margin-top:0.6rem;padding:0.6rem 0.8rem;background:rgba(245,158,11,0.15);border-left:3px solid #f59e0b;border-radius:4px;font-size:0.85rem;color:#fcd34d;line-height:1.4;";
        overlay.appendChild(hintEl);
      }
      hintEl.textContent = hintText;
    }
  }, HINT_TIMEOUT_MS);
}

// clear running hint timer
function _clearHintTimer() {
  if (_hintTimer) {
    clearTimeout(_hintTimer);
    _hintTimer = null;
  }
}
```

#### [gas-leak.js:L93-L123](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L93-L123)
**Added Helper Placement Functions:**
```javascript
// position hazard three mesh at placed transform
function _positionHazardZoneThreeMesh() {
  if (!_currentTierInfo || _currentTierInfo.tier !== 1 || !_currentTierInfo.controller) return;
  if (_threeHazardMesh) {
    _currentTierInfo.controller.removeFromScene(_threeHazardMesh);
    _threeHazardMesh = null;
  }
  _threeHazardMesh = createHazardZoneThreeMesh();
  if (_threeHazardMesh) {
    const pos = (_placedTransform && _placedTransform.position) || { x: 0, y: -0.2, z: -1.0 };
    _threeHazardMesh.position.set(pos.x, pos.y, pos.z);
    _currentTierInfo.controller.addToScene(_threeHazardMesh);
  }
}

// position ppe three mesh offset from placed transform
function _positionPpeThreeMesh() {
  if (!_currentTierInfo || _currentTierInfo.tier !== 1 || !_currentTierInfo.controller) return;
  if (_threePpeMesh) {
    _currentTierInfo.controller.removeFromScene(_threePpeMesh);
    _threePpeMesh = null;
  }
  _threePpeMesh = createPpeThreeMesh();
  if (_threePpeMesh) {
    const pos = (_placedTransform && _placedTransform.position)
      ? { x: _placedTransform.position.x + 0.5, y: _placedTransform.position.y, z: _placedTransform.position.z }
      : { x: 0.5, y: -0.2, z: -0.9 };
    _threePpeMesh.position.set(pos.x, pos.y, pos.z);
    _currentTierInfo.controller.addToScene(_threePpeMesh);
  }
}
```

#### [gas-leak.js:L171-L255](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L171-L255)
**Refactored `_renderHazardZoneGraphic` and `_renderPpeGraphic`:**
- Queries `controller.getPlacedTransform()`.
- Binds listener for `safear:placement_confirmed` event.
- Offsets PPE mesh 0.5m to the right of placed hazard coordinates.

#### [gas-leak.js:L412-L442](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L412-L442)
**Updated `_startTeachPhase`:**
- Calls `_renderHazardZoneGraphic(container)` immediately upon step 1 start.
- Calls `_renderPpeGraphic(container)` upon step 2 transition.

#### [gas-leak.js:L511-L685](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L511-L685)
**Updated Test Actions `_setupTestAction1`, `_setupTestAction2`, `_setupTestAction3`:**
- Starts `_startHintTimer(overlay, hintText)` when test screen renders.
- Clears timer via `_clearHintTimer()` upon user action.
- Adds `hintShown: true` to checkpoint `context` when `_hintShown` is true.

#### [gas-leak.js:L688-L742](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L688-L742)
**Updated `cleanupGasLeakModule`:**
```javascript
  _clearHintTimer();
  _hintShown = false;
  if (_placementConfirmedHandler && typeof window !== "undefined") {
    window.removeEventListener("safear:placement_confirmed", _placementConfirmedHandler);
    _placementConfirmedHandler = null;
  }
  _placedTransform = null;
```

#### [gas-leak.js:L828-L831](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/gas-leak.js#L828-L831)
**Exported `HINT_TIMEOUT_MS`:**
```javascript
export {
  ...
  HINT_TIMEOUT_MS
};
```

---

## 2. [`frontend/modules/gas-leak/graphics.js`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js)

### Changes Overview
- Added `normalizeModelScale` helper function using `THREE.Box3` to scale models to realistic real-world sizes based on measured bounding boxes.
- Fixed double-rendered geometry in Tier-1 Three.js scene: `createHazardZoneThreeMesh` removes crude ring and cylinder primitive fallbacks once any GLB resolves.
- Fixed double-rendered geometry in Tier-2 A-Frame entities: `buildHazardZoneEntity` and `buildPpeDisplayEntity` remove primitive fallback elements when `model-loaded` fires on the model entity.
- Scaled all 6 models with documented bounding boxes.

### Line References & Diff

#### [graphics.js:L8-L34](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js#L8-L34)
**Added `normalizeModelScale` Helper:**
```javascript
// scale model to real world size from bbox
function normalizeModelScale(model, targetLongestDim, fallbackScale) {
  const THREE = getTHREE();
  if (!model) return;
  if (THREE && typeof THREE.Box3 === "function" && typeof THREE.Vector3 === "function") {
    try {
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0 && Number.isFinite(maxDim)) {
        const s = targetLongestDim / maxDim;
        if (model.scale && typeof model.scale.set === "function") {
          model.scale.set(s, s, s);
        }
        return s;
      }
    } catch {
      // fallback if box math fails
    }
  }
  if (fallbackScale && model.scale && typeof model.scale.set === "function") {
    model.scale.set(fallbackScale, fallbackScale, fallbackScale);
    return fallbackScale;
  }
}
```

#### [graphics.js:L42-L71](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js#L42-L71)
**A-Frame Hazard Zone Normalization & Placeholder Removal:**
- Caution tapes scaled to `0.043`, warning sign to `0.295`, fog indicator to `0.084`.
- Added `removePlaceholders()` listening for `model-loaded` to remove `a-ring` and `a-cylinder`.

#### [graphics.js:L81-L131](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js#L81-L131)
**A-Frame PPE Display Normalization & Placeholder Removal:**
- SCBA scaled to `1.06`, H2S detector to `0.277`, safety harness to `1.38`.
- Added listeners on `#ppe-scba-model`, `#ppe-detector-model`, and `#ppe-harness-model` to strip fallback shapes when GLTF models load.

#### [graphics.js:L134-L231](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js#L134-L231)
**Three.js `createHazardZoneThreeMesh` Updates:**
- Added `clearPrimitives()` to remove `ring` and `cyl`.
- Applied `normalizeModelScale` on all hazard models (`caution_tapes.glb`, `hazard_zone.glb`, `warning_sign.glb`, `fog_indicator.glb`).

#### [graphics.js:L234-L333](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js#L234-L333)
**Three.js `createPpeThreeMesh` Updates:**
- Applied `normalizeModelScale` on `scba_respirator.glb` (0.5m target, scale ~1.06), `h2s_detector.glb` (0.15m target, scale ~0.277), and `safety_harness.glb` (0.6m target, scale ~1.38).

#### [graphics.js:L335-L341](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/modules/gas-leak/graphics.js#L335-L341)
**Exported `normalizeModelScale`:**
```javascript
export {
  buildHazardZoneEntity,
  buildPpeDisplayEntity,
  createHazardZoneThreeMesh,
  createPpeThreeMesh,
  normalizeModelScale
};
```

---

## 3. [`frontend/tests/gas_leak.test.js`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/tests/gas_leak.test.js)

### Changes Overview
- Extended test coverage from 17 to 23 tests (all passing).
- Added `mock` from `"node:test"`.
- Enhanced DOM stub `_makeEl` with `querySelectorAll` and tag-based queries.
- Added tests for immediate AR rendering in guided walkthrough, dynamic WebXR placement derivation, primitive placeholder removal on load resolution, hint timer firing and clearing, and scale normalization.

### Line References & Diff

#### [gas_leak.test.js:L1-L63](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/tests/gas_leak.test.js#L1-L63)
- `import { describe, it, beforeEach, mock } from "node:test";`
- Added `querySelectorAll` to `_makeEl` and assigned `tagName` in `document.createElement`.

#### [gas_leak.test.js:L88-L106](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/tests/gas_leak.test.js#L88-L106)
- Imported `HINT_TIMEOUT_MS` from `gas-leak.js`.
- Imported `createHazardZoneThreeMesh`, `buildHazardZoneEntity`, and `normalizeModelScale` from `graphics.js`.

#### [gas_leak.test.js:L457-L717](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/tests/gas_leak.test.js#L457-L717)
**Added New Test Cases:**
- `AR content renders immediately in guided session (before test phase)`: Verifies `#gas-hazard-graphic` is in DOM in step 1, and `#gas-ppe-graphic` in step 2 before test phase.
- `tier 1 webxr derives mesh positions dynamically from placed transform and placement_confirmed`: Verifies controller placement at (1.2, -0.4, -2.5) and update via `safear:placement_confirmed` to (2.0, -0.3, -1.8).
- `primitive placeholders are removed once mocked .glb load resolves`: Verifies ring and cylinder are detached from parent group when GLTF loader callback triggers.
- `buildHazardZoneEntity creates entity and structure`: Verifies markup and element ID.
- `hint timer: no hint before threshold, hint shown after 15s, context records hintShown`: Uses `mock.timers` to assert no hint at 14.9s, hint rendered at 15.0s, and `hintShown: true` recorded in `safear:checkpoint` context.
- `hint timer cleared immediately on fast checkpoint action and on cleanup`: Asserts fast response at 5s does not flag `hintShown`, and timer is cleared during `cleanupGasLeakModule`.
- `normalizeModelScale scales model to target longest dimension from bounding box`: Verifies bounding box calculation `target / maxDim`.

---

## 4. [`frontend/assets/models/gas-leak/CREDITS.md`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/assets/models/gas-leak/CREDITS.md)

### Changes Overview
- Replaced Trimble 3D Warehouse entry with SafeAR procedural model generator provenance and CC0 1.0 license.
- Documented full physical specifications and dimensions for `scba_respirator.glb` and `safety_harness.glb`.
- Added proper Sketchfab attribution and CC BY 4.0 licenses for `caution_tapes.glb`, `warning_sign.glb`, `fog_indicator.glb`, and `h2s_detector.glb`.

### Line References

- **[CREDITS.md:L7-L35](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/assets/models/gas-leak/CREDITS.md#L7-L35)**: Caution tapes, warning sign, and fog indicator entries (AMINE, saurabh.buradkar7, PolyTigr - CC BY 4.0).
- **[CREDITS.md:L38-L53](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/assets/models/gas-leak/CREDITS.md#L38-L53)**: SCBA respirator entry: SafeAR procedural geometry (DGMS / IS 15322 / NIOSH compliant), CC0 1.0, 61.8 KB binary glTF, PBR materials.
- **[CREDITS.md:L56-L64](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/assets/models/gas-leak/CREDITS.md#L56-L64)**: H2S gas detector entry (Mclarkie - CC BY 4.0).
- **[CREDITS.md:L66-L79](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/assets/models/gas-leak/CREDITS.md#L66-L79)**: Safety harness entry: SafeAR procedural geometry (DGMS / IS 3521 / OSHA compliant), CC0 1.0, 43.8 KB binary glTF.

---

## 5. [`frontend/sw.js`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/sw.js)

### Changes Overview
- Bumped offline cache version from `safear-offline-v6` to `safear-offline-v10`.
- Added new gas leak 3D models to `STATIC_ASSETS` precache array.

### Line References

- **[sw.js:L5](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/sw.js#L5)**:
  ```javascript
  const CACHE_NAME = "safear-offline-v10";
  ```
- **[sw.js:L45-L51](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/sw.js#L45-L51)**:
  ```javascript
  "./assets/models/gas-leak/caution_tapes.glb",
  "./assets/models/gas-leak/fog_indicator.glb",
  "./assets/models/gas-leak/h2s_detector.glb",
  "./assets/models/gas-leak/hazard_zone.glb",
  "./assets/models/gas-leak/safety_harness.glb",
  "./assets/models/gas-leak/scba_respirator.glb",
  "./assets/models/gas-leak/warning_sign.glb",
  ```

---

## 6. [`frontend/tests/service_worker.test.js`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/tests/service_worker.test.js)

### Changes Overview
- Updated expected cache version and SHA-256 asset graph fingerprint to align with `sw.js`.

### Line References

- **[service_worker.test.js:L292-L293](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/tests/service_worker.test.js#L292-L293)**:
  ```javascript
  const ASSET_GRAPH_FINGERPRINT = "1cba305d452a34db";
  const EXPECTED_CACHE_NAME = "safear-offline-v10";
  ```

---

## 7. [`frontend/locales/en.json`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/locales/en.json)

### Line References

- **[en.json:L169-L171](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/locales/en.json#L169-L171)**:
  ```json
  "step1_hint": "Hint: Low oxygen (<19.5%) and toxic gases (H₂S, methane) trap in confined pits. Verify hazard boundary before entry.",
  "step2_hint": "Hint: Only SCBA provides clean breathable air in toxic or low-oxygen atmospheres. Cloth or dust masks offer zero protection.",
  "step3_hint": "Hint: The standby buddy must remain outside with a continuous lifeline. Never enter to attempt unequipped rescue."
  ```

---

## 8. [`frontend/locales/hi.json`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/locales/hi.json)

### Line References

- **[hi.json:L169-L171](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/locales/hi.json#L169-L171)**:
  ```json
  "step1_hint": "संकेत: कम ऑक्सीजन (<19.5%) और जहरीली गैसें (H₂S, मीथेन) गड्ढों में फंस जाती हैं। प्रवेश से पहले खतरे की सीमा की जांच करें।",
  "step2_hint": "संकेत: केवल SCBA ही जहरीले या कम ऑक्सीजन वाले वातावरण में सांस लेने योग्य हवा देता है। कपड़े का मास्क कोई सुरक्षा नहीं देता।",
  "step3_hint": "संकेत: सुरक्षा साथी को लगातार लाइफलाइन के साथ बाहर ही रहना चाहिए। बिना सुरक्षा उपकरण के बचाव का प्रयास न करें।"
  ```

---

## 9. [`frontend/locales/sat.json`](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/locales/sat.json)

### Line References

- **[sat.json:L137-L139](file:///home/kaamil/projects/SIH/SIH-Barcelona/frontend/locales/sat.json#L137-L139)**:
  ```json
  "step1_hint": "ᱫᱤᱥᱟᱹ: ᱠᱚᱢ ᱚᱠᱥᱤᱡᱮᱱ (<19.5%) ᱟᱨ ᱵᱤᱥ ᱜᱮᱥ (H₂S, ᱢᱤᱛᱷᱮᱱ) ᱠᱷᱟᱫᱟᱱ ᱨᱮ ᱛᱟᱦᱮᱸᱱᱟ ᱾ ᱵᱚᱞᱚᱱ ᱢᱟᱲᱟᱝ ᱵᱚᱛᱚᱨ ᱥᱤᱢᱟᱹ ᱧᱮᱞ ᱢᱮ ᱾",
  "step2_hint": "ᱫᱤᱥᱟᱹ: ᱠᱷᱟᱹᱞᱤ SCBA ᱜᱮ ᱵᱤᱥ ᱜᱮᱥ ᱨᱮ ᱥᱟᱦᱮᱫ ᱮᱢᱚᱜᱼᱟ ᱾ ᱞᱩᱜᱽᱲᱤ ᱢᱟᱥᱠ ᱪᱮᱫ ᱨᱩᱠᱷᱤᱭᱟᱹ ᱦᱚᱸ ᱵᱟᱝ ᱮᱢᱚᱜᱼᱟ ᱾",
  "step3_hint": "ᱫᱤᱥᱟᱹ: ᱜᱟᱛᱮ ᱫᱚ ᱵᱟᱦᱨᱮ ᱨᱮ ᱞᱟᱭᱤᱯᱷᱞᱟᱭᱤᱱ ᱥᱟᱶ ᱛᱟᱦᱮᱸᱱ ᱞᱟᱹᱠᱛᱤ ᱾ ᱵᱤᱱᱟᱹ ᱥᱟᱯᱟᱯ ᱛᱮ ᱵᱟᱧᱪᱟᱣ ᱞᱟᱹᱜᱤᱫ ᱟᱞᱚᱢ ᱵᱚᱞᱚᱱᱟ ᱾"
  ```

---

## 10. [`eslint.config.mjs`](file:///home/kaamil/projects/SIH/SIH-Barcelona/eslint.config.mjs)

### Line References

- **[eslint.config.mjs:L22](file:///home/kaamil/projects/SIH/SIH-Barcelona/eslint.config.mjs#L22)**:
  Added `clearTimeout: "readonly"` to `frontend/**/*.js` globals to resolve ESLint `no-undef` error:
  ```javascript
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  ```
