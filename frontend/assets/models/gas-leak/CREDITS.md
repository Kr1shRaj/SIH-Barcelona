# 3D Model Credits & Licensing — Gas Leak & Confined Space Module

All external 3D models used in SafeAR's Gas Leak & Confined Space Response module are licensed under open, permissive licenses (CC0 1.0 Public Domain or Creative Commons Attribution 4.0 International) suitable for mobile training and field deployment.

---

### 1. `hazard_zone.glb` / `caution_tapes.glb` (Ground Hazard-Boundary Marker)
- **Asset**: Caution Tapes / Construction Barrier
- **Source**: Sketchfab
- **Source URL**: https://sketchfab.com/3d-models/caution-tapes-a082d307df38402d8eaed443c2e42501
- **Author**: AMINE (https://sketchfab.com/amineloop)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL**: https://creativecommons.org/licenses/by/4.0/
- *Secondary Fallback Asset*: Kenney City Kit Roads (`construction-barrier.glb`), CC0 1.0 Universal

---

### 2. `warning_sign.glb` (Warning Placard / Sign)
- **Asset**: Warning Sign
- **Source**: Sketchfab
- **Source URL**: https://sketchfab.com/3d-models/warning-sign-6d49eaf6c7c44af0afe905817e3bc044
- **Author**: saurabh.buradkar7 (https://sketchfab.com/saurabh.buradkar7)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL**: https://creativecommons.org/licenses/by/4.0/

---

### 3. `fog_indicator.glb` (Gas Cloud / Atmosphere Indicator)
- **Asset**: Fog for your Sketchfab scenes
- **Source**: Sketchfab
- **Source URL**: https://sketchfab.com/3d-models/fog-for-your-sketchfab-scenes-6d12cb257c964f268e418381125ecf0d
- **Author**: PolyTigr (https://sketchfab.com/polytigr)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL**: https://creativecommons.org/licenses/by/4.0/

---

### 4. `scba_respirator.glb` (SCBA Breathing Apparatus)
- **Asset**: Self-Contained Breathing Apparatus (DGMS / IS 15322 / NIOSH 42 CFR 84 Compliant)
- **Source**: SafeAR Bespoke Industrial Safety Geometry (`scba_respirator.glb`)
- **Author**: SafeAR Core Engine
- **License**: CC0 1.0 Universal (Public Domain Dedication)
- **License URL**: https://creativecommons.org/publicdomain/zero/1.0/
- **Generator Script**: [generator/build_scba_respirator.py](generator/build_scba_respirator.py)
- **Specification**:
  - Yellow high-pressure air cylinder (`#ebb312`, 0.30 metalness) with rounded top cap
  - Black glass-reinforced nylon backplate frame (`#141419`, 0.85 roughness) with mounting bracket
  - Forged alloy steel valve, regulator connector, hose stub, and buckle clips (`#c7ccd4`, 0.92 metalness)
  - Black EPDM rubber face mask body with edge seal ring (`#0d0d12`, 0.90 roughness)
  - Clear polycarbonate visor window (`#d9e6eb`, 0.70 alpha, BLEND mode)
  - Yellow polyester shoulder harness straps and waist belt (`#d9a60d`, 0.70 roughness)
  - Red pressure gauge face (`#d92619`)
- **Format & Optimization**: 61.8 KB glTF Binary 2.0 with PBR Metallic-Roughness shading, 7 material groups, optimized for offline low-end mobile devices (₹8,000–12,000 budget hardware)

---

### 5. `h2s_detector.glb` (Multi-Gas / Atmospheric Detector)
- **Asset**: H2S Gas Detector
- **Source**: Sketchfab
- **Source URL**: https://sketchfab.com/3d-models/h2s-gas-detector-d5cdc80c35d5494cbc9fd10a27ad7a4b
- **Author**: Mclarkie (https://sketchfab.com/mclarkie)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL**: https://creativecommons.org/licenses/by/4.0/

---

### 6. `safety_harness.glb` (Industrial Full-Body Fall Arrest Harness)
- **Asset**: Industrial Full-Body Fall Arrest Harness (DGMS / IS 3521 / OSHA Compliant)
- **Source**: SafeAR Bespoke Industrial Safety Geometry (`safety_harness.glb`)
- **Author**: SafeAR Core Engine
- **License**: CC0 1.0 Universal (Public Domain Dedication)
- **License URL**: https://creativecommons.org/publicdomain/zero/1.0/
- **Generator Script**: [generator/build_safety_harness.py](generator/build_safety_harness.py)
- **Specification**:
  - High-visibility lime-green polyester shoulder webbing (`#84cc16`) with rear X-cross and sub-pelvic seat strap
  - High-visibility safety orange thigh/leg loops (`#f97316`) with vertical connecting risers
  - Ballistic black lumbar support belt (`#1e293b`) and dorsal diamond back-pad
  - Forged alloy steel hardware (`#cbd5e1`, 0.92 metalness): dorsal fall-arrest D-ring, bilateral work-positioning D-rings, quick-connect chest buckle, mating waist/leg buckles, and scaffold snap hook
  - Integrated fall-arrest shock absorber pack and silver retro-reflective safety stripes
- **Format & Optimization**: 43.8 KB glTF Binary 2.0 with PBR Metallic-Roughness shading, optimized for offline low-end mobile devices (₹8,000–12,000 budget hardware)



