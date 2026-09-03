// SafeAR localization engine (Hindi, Santali, English fallback)
let _currentLocale = "en";

// locale catalog containing UI strings for Hindi, Santali, and English
const _catalog = {
  en: {
    app: {
      tier1_ready: "AR Tier 1 Ready (WebXR)",
      tier1_ready_desc: "Real-world surface tracking supported on your tablet. Tap below to start AR:",
      start_ar_session: "🚀 START AR SESSION (WEBXR)",
      launch_module_direct: "Or tap a module to launch directly:",
      tier1_active: "AR Tier 1 Active (WebXR)",
      tier1_active_desc: "Point at a flat surface and tap to place the extinguisher.",
      tier2_active: "AR Tier 2 Active (Hiro Marker)",
      tier2_active_desc: "Point camera at Hiro marker. Pick a module to begin.",
      fire_btn: "🔥 Fire Response",
      gas_btn: "☣️ Gas Leak",
      webxr_diag: "🔍 WebXR Diagnostic:",
      device_not_supported: "Device Not Supported"
    },
    marker: {
      camera_denied: "Camera Permission Denied",
      camera_denied_desc: "SafeAR requires live camera access to detect the Hiro safety marker.",
      camera_how_to: "How to enable camera in Chrome:",
      camera_step1: "Tap the 🔒 lock / tune icon in the top-left address bar.",
      camera_step2: "Tap Permissions ➔ Camera.",
      camera_step3: "Select Allow.",
      camera_step4: "Tap Reload & Enable below.",
      reload_enable: "🔄 Reload & Enable Camera",
      hiro_badge: "🧯 HIRO MARKER (EXTINGUISHER STATION)",
      hiro_instruction: "Point your phone camera at this marker to trigger the 3D Fire Extinguisher.",
      kanji_badge: "🔥 KANJI MARKER (FIRE HAZARD)",
      kanji_instruction: "Point your phone camera at this marker to trigger the 3D Fire hazard in Step 2 & Step 3."
    },
    graphics: {
      abc_chemical: "ABC DRY CHEMICAL",
      pass_instructions: "1. PULL PIN\n2. AIM AT BASE\n3. SQUEEZE LEVER\n4. SWEEP HAZARD",
      aim_flame_base: "👇 AIM AT BASE OF FLAMES"
    },
    fire: {
      exit_badge_1: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (1/4)",
      exit_title_1: "Why Identifying Exits Matters",
      exit_desc_1: "In a fire emergency, heavy smoke reduces visibility to zero in under 30 seconds. Panic causes confusion — knowing your exit routes beforehand saves critical seconds.",
      exit_next_1: "Next: Primary & Backup Exits ➜",
      exit_badge_2: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (2/4)",
      exit_title_2: "Primary vs. Backup Route",
      exit_desc_2: "Never rely on a single exit path. If flames or smoke block your primary route, you must immediately pivot to your pre-identified secondary emergency path.",
      exit_next_2: "Next: Elevators Danger ➜",
      exit_badge_3: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (3/4)",
      exit_title_3: "Never Use Elevators in a Fire",
      exit_desc_3: "Elevator shafts act as natural chimneys drawing superheated toxic gases. Power failure can strand the car between burning floors. Always use designated fire stairwells.",
      exit_next_3: "Next: Place Extinguisher ➜",
      place_badge: "🔥 STEP 1 / 3 — EXIT IDENTIFICATION (4/4)",
      place_title: "Place Extinguisher on Ground",
      place_desc: "Point your tablet at the floor or table. Tap the green button below (or tap anywhere on screen) to place the extinguisher.",
      place_btn: "🎯 TAP TO PLACE EXTINGUISHER ON FLOOR",
      pass_pull_badge: "🔥 STEP 2 / 3 — PASS TECHNIQUE (1/4)",
      pass_pull_title: "P — Pull the Pin",
      pass_pull_desc: "Tap the yellow guide arrow or pin ring to select, then drag right to pull the pin.",
      pass_pull_badge_btn: "👉 SWIPE RIGHT OR TAP TO PULL PIN",
      pass_aim_badge: "🔥 STEP 2 / 3 — PASS TECHNIQUE (2/4)",
      pass_aim_title: "A — Aim at the Base",
      pass_aim_desc: "Aim at the glowing green ring at the bottom of the fire. Tap the button below or point your phone camera at it.",
      pass_aim_btn: "🎯 TAP TO LOCK AIM AT FIRE BASE",
      pass_squeeze_badge: "🔥 STEP 2 / 3 — PASS TECHNIQUE (3/4)",
      pass_squeeze_title: "S — Squeeze the Handle",
      pass_squeeze_desc: "Tap the 3D operating lever (or button below) to select, then press & hold 1.5s.",
      pass_squeeze_btn: "👉 TAP HERE TO SELECT LEVER",
      pass_sweep_badge: "🔥 STEP 2 / 3 — PASS TECHNIQUE (4/4)",
      pass_sweep_title: "S — Sweep Side to Side",
      pass_sweep_desc: "Physically move your phone side to side across the fire base.",
      evac_badge_1: "🔥 STEP 3 / 3 — EVACUATION (1/3)",
      evac_title_1: "Why Evacuation Order Matters",
      evac_desc_1: "Sounding the building alarm immediately alerts everyone before heat spreads. Never delay evacuation to gather personal belongings or tools.",
      evac_next_1: "Next: Assembly Area Purpose ➜",
      evac_badge_2: "🔥 STEP 3 / 3 — EVACUATION (2/3)",
      evac_title_2: "Assembly & Headcount",
      evac_desc_2: "Proceed directly to your designated external assembly area. Immediate headcount verification ensures rescuers know if anyone is trapped inside.",
      evac_next_2: "Next: Evacuation Protocol Choice ➜",
      evac_badge_3: "🔥 STEP 3 / 3 — EVACUATION (3/3)",
      evac_title_3: "Evacuation Protocol Choice",
      evac_desc_3: "What is the correct immediate action after attempting extinguisher use?"
    },
    gas: {
      step1_badge_1: "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (1/3)",
      step1_title_1: "Confined Space Atmospheric Hazards",
      step1_desc_1: "Confined spaces (tanks, sumps, silos, underground pits) trap invisible lethal gases like H₂S, methane, or CO. Low oxygen (<19.5%) causes sudden loss of consciousness without warning.",
      step1_next_1: "Next: Testing & Permits ➜",
      step1_badge_2: "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (2/3)",
      step1_title_2: "Atmospheric Testing & Entry Permits",
      step1_desc_2: "Continuous calibrated 4-gas monitoring (O₂, LEL/CH₄, CO, H₂S) and a signed entry permit are legally mandated before breaking the plane of entry.",
      step1_next_2: "Next: Hazard Demarcation Choice ➜",
      step1_badge_3: "☣ STEP 1 / 3 — HAZARD ZONE RECOGNITION (3/3)",
      step1_title_3: "Hazard Zone Demarcation Choice",
      step1_desc_3: "Select the mandatory immediate action upon identifying an unmonitored confined space with suspected gas buildup:",
      step2_badge: "☣ STEP 2 / 3 — PPE SELECTION",
      step2_title: "Select Life-Critical Confined Space PPE",
      step2_desc: "Choose ALL required PPE for entry. WARNING: Choosing incorrect gear (like a dust mask) is fatal in oxygen-deficient or toxic atmospheres.",
      step3_badge: "☣ STEP 3 / 3 — BUDDY SYSTEM PROTOCOL",
      step3_title: "Standby Person (Hole Watch) Protocol",
      step3_desc: "Your entrant colleague inside signals distress or collapses. What is your required action as the designated standby buddy?"
    }
  },
  hi: {
    app: {
      tier1_ready: "एआर टीयर 1 तैयार (WebXR)",
      tier1_ready_desc: "टैबलेट पर धरातल पहचान समर्थित है। शुरू करने के लिए नीचे टैप करें:",
      start_ar_session: "🚀 एआर सत्र शुरू करें (WebXR)",
      launch_module_direct: "या सीधे मॉड्यूल शुरू करें:",
      tier1_active: "एआर टीयर 1 सक्रिय (WebXR)",
      tier1_active_desc: "समतल सतह की ओर इंगित करें और अग्निशामक रखने के लिए टैप करें।",
      tier2_active: "एआर टीयर 2 सक्रिय (Hiro मार्कर)",
      tier2_active_desc: "कैमरे को Hiro मार्कर पर लक्षित करें। मॉड्यूल चुनें।",
      fire_btn: "🔥 आग प्रतिक्रिया",
      gas_btn: "☣️ गैस रिसाव",
      webxr_diag: "🔍 WebXR निदान:",
      device_not_supported: "उपकरण समर्थित नहीं है"
    },
    marker: {
      camera_denied: "कैमरा अनुमति अस्वीकृत",
      camera_denied_desc: "सुरक्षा मार्कर पहचानने के लिए SafeAR को कैमरे की अनुमति आवश्यक है।",
      camera_how_to: "Chrome में कैमरा कैसे चालू करें:",
      camera_step1: "ऊपर बाईं ओर लॉक आइकन पर टैप करें।",
      camera_step2: "अनुमतियाँ ➔ कैमरा पर टैप करें।",
      camera_step3: "अनुमति दें (Allow) चुनें।",
      camera_step4: "नीचे 'पुनः लोड करें' पर टैप करें।",
      reload_enable: "🔄 पुनः लोड करें और कैमरा सक्षम करें",
      hiro_badge: "🧯 HIRO मार्कर (अग्निशामक स्टेशन)",
      hiro_instruction: "3D अग्निशामक देखने के लिए फोन कैमरे को इस मार्कर पर रखें।",
      kanji_badge: "🔥 KANJI मार्कर (आग खतरा)",
      kanji_instruction: "3D आग खतरे को देखने के लिए फोन कैमरे को इस मार्कर पर रखें।"
    },
    graphics: {
      abc_chemical: "ABC सूखा रासायनिक",
      pass_instructions: "1. पिन खींचें\n2. आधार पर निशाना लगाएं\n3. लीवर दबाएं\n4. छिड़काव करें",
      aim_flame_base: "👇 आग के आधार पर निशाना लगाएं"
    },
    fire: {
      exit_badge_1: "🔥 चरण 1 / 3 — निकास पहचान (1/4)",
      exit_title_1: "निकास पहचानना क्यों आवश्यक है",
      exit_desc_1: "आग लगने पर घना धुआं 30 सेकंड में दृश्यता शून्य कर देता है। पहले से निकास मार्ग जानना जीवन बचाता है।",
      exit_next_1: "आगे: मुख्य और वैकल्पिक निकास ➜",
      exit_badge_2: "🔥 चरण 1 / 3 — निकास पहचान (2/4)",
      exit_title_2: "मुख्य बनाम वैकल्पिक मार्ग",
      exit_desc_2: "कभी एक ही रास्ते पर निर्भर न रहें। धुआं होने पर तुरंत वैकल्पिक आपातकालीन रास्ते पर जाएं।",
      exit_next_2: "आगे: लिफ्ट का खतरा ➜",
      exit_badge_3: "🔥 चरण 1 / 3 — निकास पहचान (3/4)",
      exit_title_3: "आग में लिफ्ट का प्रयोग कभी न करें",
      exit_desc_3: "लिफ्ट शाफ्ट जहरीली गैसों को खींचते हैं। हमेशा अग्नि सीढ़ियों का उपयोग करें।",
      exit_next_3: "आगे: अग्निशामक रखें ➜",
      place_badge: "🔥 चरण 1 / 3 — निकास पहचान (4/4)",
      place_title: "अग्निशामक को जमीन पर रखें",
      place_desc: "टैबलेट को फर्श या मेज की ओर रखें। अग्निशामक रखने के लिए नीचे दिए गए बटन पर टैप करें।",
      place_btn: "🎯 अग्निशामक को जमीन पर रखने के लिए टैप करें",
      pass_pull_badge: "🔥 चरण 2 / 3 — PASS तकनीक (1/4)",
      pass_pull_title: "P — पिन खींचें",
      pass_pull_desc: "पिन चुनने के लिए पीले तीर पर टैप करें, फिर खींचने के लिए दाईं ओर स्वाइप करें।",
      pass_pull_badge_btn: "👉 स्वाइप करें या पिन खींचने के लिए टैप करें",
      pass_aim_badge: "🔥 चरण 2 / 3 — PASS तकनीक (2/4)",
      pass_aim_title: "A — आधार पर निशाना लगाएं",
      pass_aim_desc: "आग के तल पर चमकते हरे छल्ले पर निशाना लगाएं। नीचे दिए गए बटन पर टैप करें।",
      pass_aim_btn: "🎯 आग के आधार पर निशाना लॉक करें",
      pass_squeeze_badge: "🔥 चरण 2 / 3 — PASS तकनीक (3/4)",
      pass_squeeze_title: "S — हैंडल दबाएं",
      pass_squeeze_desc: "लीवर को चुनने के लिए टैप करें, फिर 1.5 सेकंड तक दबाए रखें।",
      pass_squeeze_btn: "👉 लीवर चुनने के लिए यहाँ टैप करें",
      pass_sweep_badge: "🔥 चरण 2 / 3 — PASS तकनीक (4/4)",
      pass_sweep_title: "S — दाएं-बाएं छिड़कें",
      pass_sweep_desc: "आग के आधार पर फोन को धीरे-धीरे दाएं-बाएं घुमाएं।",
      evac_badge_1: "🔥 चरण 3 / 3 — निकासी (1/3)",
      evac_title_1: "निकासी क्रम का महत्व",
      evac_desc_1: "अलार्म बजाने से तुरंत सभी को चेतावनी मिलती है। सामान समेटने में समय न गंवाएं।",
      evac_next_1: "आगे: सभा क्षेत्र ➜",
      evac_badge_2: "🔥 चरण 3 / 3 — निकासी (2/3)",
      evac_title_2: "सभा और गिनती",
      evac_desc_2: "सीधे बाहरी सुरक्षित सभा क्षेत्र में जाएं। तुरंत गिनती से पता चलता है कि कोई अंदर फंसा तो नहीं।",
      evac_next_2: "आगे: निकासी विकल्प ➜",
      evac_badge_3: "🔥 चरण 3 / 3 — निकासी (3/3)",
      evac_title_3: "निकासी प्रोटोकॉल विकल्प",
      evac_desc_3: "अग्निशामक प्रयोग के बाद सही तत्काल कार्रवाई चुनें:"
    },
    gas: {
      step1_badge_1: "☣ चरण 1 / 3 — खतरा क्षेत्र पहचान (1/3)",
      step1_title_1: "संकीर्ण स्थान वायुमंडलीय खतरे",
      step1_desc_1: "संकीर्ण स्थान (टैंक, गड्ढे) अदृश्य जहरीली गैसें रोकते हैं। ऑक्सीजन की कमी से अचानक बेहोशी होती है।",
      step1_next_1: "आगे: परीक्षण और परमिट ➜",
      step1_badge_2: "☣ चरण 1 / 3 — खतरा क्षेत्र पहचान (2/3)",
      step1_title_2: "वायुमंडलीय परीक्षण और परमिट",
      step1_desc_2: "प्रवेश से पहले गैस मॉनिटरिंग और हस्ताक्षरित परमिट अनिवार्य है।",
      step1_next_2: "आगे: सीमांकन विकल्प ➜",
      step1_badge_3: "☣ चरण 1 / 3 — खतरा क्षेत्र पहचान (3/3)",
      step1_title_3: "खतरा क्षेत्र सीमांकन विकल्प",
      step1_desc_3: "गैस जमाव वाले संकीर्ण स्थान की पहचान पर अनिवार्य कार्रवाई चुनें:",
      step2_badge: "☣ चरण 2 / 3 — PPE चयन",
      step2_title: "जीवन-रक्षक PPE चुनें",
      step2_desc: "प्रवेश के लिए आवश्यक सभी PPE चुनें। चेतावनी: धूल मास्क जैसी गलत वस्तु का चयन जानलेवा है।",
      step3_badge: "☣ चरण 3 / 3 — साथी प्रणाली (Buddy System)",
      step3_title: "स्टैंडबाय साथी प्रोटोकॉल",
      step3_desc: "अंदर गया साथी संकट में है या गिर गया है। आपकी अनिवार्य कार्रवाई क्या है?"
    }
  },
  sat: {
    app: {
      tier1_ready: "AR Tier 1 Ready (WebXR)",
      tier1_ready_desc: "ᱚᱛ ᱪᱤᱱᱦᱟᱹᱣ ᱫᱟᱲᱮᱭᱟᱜ-ᱟ᱾ ᱮᱛᱚᱦᱚᱵ ᱞᱟᱹᱜᱤᱫ ᱞᱟᱛᱟᱨ ᱨᱮ ᱚᱛᱟᱭ ᱢᱮ:",
      start_ar_session: "🚀 AR ᱮᱛᱚᱦᱚᱵ ᱢᱮ (WebXR)",
      launch_module_direct: "ᱥᱮ ᱢᱚᱰᱭᱩᱞ ᱮᱛᱚᱦᱚᱵ ᱢᱮ:",
      tier1_active: "AR Tier 1 Active (WebXR)",
      tier1_active_desc: "ᱥᱚᱢᱟᱱ ᱡᱟᱭᱜᱟ ᱨᱮ ᱚᱛᱟᱭ ᱢᱮ ᱥᱮᱸᱜᱮᱞ ᱤᱬᱤᱡ ᱫᱚᱦᱚ ᱞᱟᱹᱜᱤᱫ᱾",
      tier2_active: "AR Tier 2 Active (Hiro Marker)",
      tier2_active_desc: "ᱠᱮᱢᱮᱨᱟ Hiro ᱢᱟᱨᱠᱟᱨ ᱨᱮ ᱫᱚᱦᱚᱭ ᱢᱮ᱾",
      fire_btn: "🔥 ᱥᱮᱸᱜᱮᱞ ᱨᱩᱠᱷᱤᱭᱟᱹ",
      gas_btn: "☣️ ᱜᱮᱥ ᱩᱰᱩᱠ",
      webxr_diag: "🔍 WebXR Diagnostic:",
      device_not_supported: "ᱥᱟᱫᱷᱚᱱ ᱵᱟᱭ ᱜᱟᱱᱚᱜ-ᱟ"
    },
    marker: {
      camera_denied: "ᱠᱮᱢᱮᱨᱟ ᱪᱷᱟᱹᱲ ᱵᱟᱹᱱᱩᱜ-ᱟ",
      camera_denied_desc: "SafeAR ᱞᱟᱹᱜᱤᱫ ᱠᱮᱢᱮᱨᱟ ᱪᱷᱟᱹᱲ ᱞᱟᱹᱠᱛᱤᱜ-ᱟ᱾",
      camera_how_to: "Chrome ᱨᱮ ᱠᱮᱢᱮᱨᱟ ᱪᱮᱫᱞᱮᱠᱟ ᱪᱟᱹᱞᱩᱭᱟ:",
      camera_step1: "ᱪᱮᱛᱟᱱ ᱨᱮ ᱞᱚᱠ ᱪᱤᱱᱦᱟᱹ ᱚᱛᱟᱭ ᱢᱮ᱾",
      camera_step2: "Permissions ➔ Camera ᱚᱛᱟᱭ ᱢᱮ᱾",
      camera_step3: "Allow ᱵᱟᱪᱷᱟᱣ ᱢᱮ᱾",
      camera_step4: "ᱞᱟᱛᱟᱨ ᱨᱮ Reload ᱚᱛᱟᱭ ᱢᱮ᱾",
      reload_enable: "🔄 Reload ᱟᱨ ᱠᱮᱢᱮᱨᱟ ᱪᱟᱹᱞᱩᱭ ᱢᱮ",
      hiro_badge: "🧯 HIRO MARKER",
      hiro_instruction: "3D ᱥᱮᱸᱜᱮᱞ ᱤᱬᱤᱡ ᱧᱮᱞ ᱞᱟᱹᱜᱤᱫ ᱯᱷᱚᱱ ᱠᱮᱢᱮᱨᱟ ᱱᱚᱶᱟ ᱢᱟᱨᱠᱟᱨ ᱨᱮ ᱫᱚᱦᱚᱭ ᱢᱮ᱾",
      kanji_badge: "🔥 KANJI MARKER",
      kanji_instruction: "3D ᱥᱮᱸᱜᱮᱞ ᱵᱚᱛᱚᱨ ᱧᱮᱞ ᱞᱟᱹᱜᱤᱫ ᱯᱷᱚᱱ ᱠᱮᱢᱮᱨᱟ ᱱᱚᱶᱟ ᱢᱟᱨᱠᱟᱨ ᱨᱮ ᱫᱚᱦᱚᱭ ᱢᱮ᱾"
    },
    graphics: {
      abc_chemical: "ABC DRY CHEMICAL",
      pass_instructions: "1. PULL PIN\n2. AIM AT BASE\n3. SQUEEZE LEVER\n4. SWEEP HAZARD",
      aim_flame_base: "👇 ᱥᱮᱸᱜᱮᱞ ᱵᱩᱰᱟᱹ ᱨᱮ ᱴᱟᱨᱜᱮᱴ ᱢᱮ"
    },
    fire: {
      exit_badge_1: "🔥 ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱰᱟᱦᱟᱨ (1/4)",
      exit_title_1: "ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱰᱟᱦᱟᱨ ᱪᱮᱫᱟᱜ ᱞᱟᱹᱠᱛᱤᱭᱟ",
      exit_desc_1: "ᱥᱮᱸᱜᱮᱞ ᱨᱮ ᱫᱷᱩᱶᱟᱹ ᱛᱮ ᱧᱮᱞ ᱵᱟᱭ ᱜᱟᱱᱚᱜ-ᱟ᱾ ᱰᱟᱦᱟᱨ ᱵᱟᱰᱟᱭ ᱞᱮᱠᱷᱟᱱ ᱡᱤᱣᱤ ᱵᱟᱧᱪᱟᱣᱜ-ᱟ᱾",
      exit_next_1: "ᱞᱟᱦᱟ: ᱢᱩᱬ ᱟᱨ ᱫᱚᱥᱟᱨ ᱰᱟᱦᱟᱨ ➜",
      exit_badge_2: "🔥 ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱰᱟᱦᱟᱨ (2/4)",
      exit_title_2: "ᱢᱩᱬ ᱟᱨ ᱫᱚᱥᱟᱨ ᱰᱟᱦᱟᱨ",
      exit_desc_2: "ᱢᱤᱫᱴᱟᱝ ᱰᱟᱦᱟᱨ ᱨᱮ ᱟᱞᱚᱢ ᱯᱟᱹᱛᱭᱟᱹᱣᱜ-ᱟ᱾ ᱫᱚᱥᱟᱨ ᱰᱟᱦᱟᱨ ᱛᱮ ᱪᱟᱞᱟᱜ ᱢᱮ᱾",
      exit_next_2: "ᱞᱟᱦᱟ: ᱞᱤᱯᱷᱴ ᱵᱚᱛᱚᱨ ➜",
      exit_badge_3: "🔥 ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱰᱟᱦᱟᱨ (3/4)",
      exit_title_3: "ᱥᱮᱸᱜᱮᱞ ᱨᱮ ᱞᱤᱯᱷᱴ ᱟᱞᱚᱢ ᱵᱮᱵᱷᱟᱨᱟ",
      exit_desc_3: "ᱞᱤᱯᱷᱴ ᱨᱮ ᱵᱤᱥ ᱫᱷᱩᱶᱟᱹ ᱵᱚᱞᱚᱱᱟ᱾ ᱥᱤᱲᱦᱤ ᱵᱮᱵᱷᱟᱨ ᱢᱮ᱾",
      exit_next_3: "ᱞᱟᱦᱟ: ᱥᱮᱸᱜᱮᱞ ᱤᱬᱤᱡ ᱫᱚᱦᱚᱭ ᱢᱮ ➜",
      place_badge: "🔥 ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱰᱟᱦᱟᱨ (4/4)",
      place_title: "ᱥᱮᱸᱜᱮᱞ ᱤᱬᱤᱡ ᱚᱛ ᱨᱮ ᱫᱚᱦᱚᱭ ᱢᱮ",
      place_desc: "ᱴᱮᱵᱽᱞᱮᱴ ᱚᱛ ᱥᱮᱫ ᱫᱚᱦᱚᱭ ᱢᱮ ᱟᱨ ᱫᱚᱦᱚ ᱞᱟᱹᱜᱤᱫ ᱚᱛᱟᱭ ᱢᱮ᱾",
      place_btn: "🎯 ᱥᱮᱸᱜᱮᱞ ᱤᱬᱤᱡ ᱫᱚᱦᱚ ᱞᱟᱹᱜᱤᱫ ᱚᱛᱟᱭ ᱢᱮ",
      pass_pull_badge: "🔥 ᱦᱟᱹᱴᱤᱧ 2 / 3 — PASS ᱦᱩᱱᱟᱹᱨ (1/4)",
      pass_pull_title: "P — ᱯᱤᱱ ᱚᱨ ᱢᱮ",
      pass_pull_desc: "ᱥᱟᱥᱟᱝ ᱛᱤᱨ ᱚᱛᱟᱭ ᱢᱮ, ᱟᱨ ᱡᱚᱡᱚᱢ ᱥᱮᱫ ᱚᱨ ᱢᱮ᱾",
      pass_pull_badge_btn: "👉 ᱯᱤᱱ ᱚᱨ ᱞᱟᱹᱜᱤᱫ ᱚᱛᱟᱭ ᱢᱮ",
      pass_aim_badge: "🔥 ᱦᱟᱹᱴᱤᱧ 2 / 3 — PASS ᱦᱩᱱᱟᱹᱨ (2/4)",
      pass_aim_title: "A — ᱵᱩᱰᱟᱹ ᱨᱮ ᱴᱟᱨᱜᱮᱴ ᱢᱮ",
      pass_aim_desc: "ᱥᱮᱸᱜᱮᱞ ᱵᱩᱰᱟᱹ ᱨᱮ ᱦᱟᱹᱨᱭᱟᱹᱲ ᱪᱤᱱᱦᱟᱹ ᱨᱮ ᱴᱟᱨᱜᱮᱴ ᱢᱮ᱾ ᱞᱟᱛᱟᱨ ᱨᱮ ᱚᱛᱟᱭ ᱢᱮ᱾",
      pass_aim_btn: "🎯 ᱴᱟᱨᱜᱮᱴ ᱞᱚᱠ ᱞᱟᱹᱜᱤᱫ ᱚᱛᱟᱭ ᱢᱮ",
      pass_squeeze_badge: "🔥 ᱦᱟᱹᱴᱤᱧ 2 / 3 — PASS ᱦᱩᱱᱟᱹᱨ (3/4)",
      pass_squeeze_title: "S — ᱦᱮᱱᱰᱮᱞ ᱞᱤᱱ ᱢᱮ",
      pass_squeeze_desc: "ᱞᱤᱵᱷᱚᱨ ᱵᱟᱪᱷᱟᱣ ᱞᱟᱹᱜᱤᱫ ᱚᱛᱟᱭ ᱢᱮ, ᱟᱨ 1.5 ᱴᱤᱯᱤᱡ ᱫᱷᱟᱹᱵᱤᱡ ᱞᱤᱱ ᱫᱚᱦᱚᱭ ᱢᱮ᱾",
      pass_squeeze_btn: "👉 ᱞᱤᱵᱷᱚᱨ ᱵᱟᱪᱷᱟᱣ ᱞᱟᱹᱜᱤᱫ ᱱᱚᱸᱰᱮ ᱚᱛᱟᱭ ᱢᱮ",
      pass_sweep_badge: "🔥 ᱦᱟᱹᱴᱤᱧ 2 / 3 — PASS ᱦᱩᱱᱟᱹᱨ (4/4)",
      pass_sweep_title: "S — ᱮᱛᱚᱢ-ᱠᱚᱧᱮ ᱪᱷᱤᱴᱠᱟᱹᱣ ᱢᱮ",
      pass_sweep_desc: "ᱥᱮᱸᱜᱮᱞ ᱵᱩᱰᱟᱹ ᱨᱮ ᱯᱷᱚᱱ ᱮᱛᱚᱢ-ᱠᱚᱧᱮ ᱞᱟᱲᱟᱣ ᱢᱮ᱾",
      evac_badge_1: "🔥 ᱦᱟᱹᱴᱤᱧ 3 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ (1/3)",
      evac_title_1: "ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱨᱮᱭᱟᱜ ᱞᱟᱹᱠᱛᱤ",
      evac_desc_1: "ᱜᱷᱟᱹᱱᱴᱤ ᱥᱟᱰᱮ ᱞᱮᱠᱷᱟᱱ ᱡᱚᱛᱚ ᱦᱚᱲ ᱠᱚ ᱵᱟᱰᱟᱭᱟ᱾ ᱡᱤᱱᱤᱥ ᱠᱚ ᱥᱟᱢᱴᱟᱣ ᱨᱮ ᱚᱠᱛᱚ ᱟᱞᱚᱢ ᱠᱷᱟᱨᱟᱯᱟ᱾",
      evac_next_1: "ᱞᱟᱦᱟ: ᱡᱟᱣᱨᱟᱜ ᱡᱟᱭᱜᱟ ➜",
      evac_badge_2: "🔥 ᱦᱟᱹᱴᱤᱧ 3 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ (2/3)",
      evac_title_2: "ᱡᱟᱣᱨᱟᱜ ᱟᱨ ᱞᱮᱠᱷᱟ",
      evac_desc_2: "ᱵᱟᱦᱨᱮ ᱨᱩᱠᱷᱤᱭᱟᱹ ᱡᱟᱭᱜᱟ ᱛᱮ ᱪᱟᱞᱟᱜ ᱢᱮ ᱟᱨ ᱞᱮᱠᱷᱟᱜ ᱢᱮ᱾",
      evac_next_2: "ᱞᱟᱦᱟ: ᱰᱟᱦᱟᱨ ᱵᱟᱪᱷᱟᱣ ➜",
      evac_badge_3: "🔥 ᱦᱟᱹᱴᱤᱧ 3 / 3 — ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ (3/3)",
      evac_title_3: "ᱵᱟᱦᱨᱮ ᱩᱰᱩᱠ ᱰᱟᱦᱟᱨ ᱵᱟᱪᱷᱟᱣ",
      evac_desc_3: "ᱥᱮᱸᱜᱮᱞ ᱤᱬᱤᱡ ᱛᱟᱭᱚᱢ ᱥᱟᱹᱨᱤ ᱠᱟᱹᱢᱤ ᱵᱟᱪᱷᱟᱣ ᱢᱮ:"
    },
    gas: {
      step1_badge_1: "☣ ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱚᱛᱚᱨ ᱡᱟᱭᱜᱟ (1/3)",
      step1_title_1: "ᱥᱟᱸᱜᱤᱧ ᱡᱟᱭᱜᱟ ᱨᱮ ᱜᱮᱥ ᱵᱚᱛᱚᱨ",
      step1_desc_1: "ᱴᱮᱝᱠᱤ, ᱠᱷᱟᱫᱟᱱ ᱨᱮ ᱵᱤᱥ ᱜᱮᱥ ᱛᱟᱦᱮᱸᱱᱟ᱾ ᱚᱠᱥᱤᱡᱮᱱ ᱠᱚᱢ ᱞᱮᱠᱷᱟᱱ ᱦᱚᱲ ᱠᱚ ᱵᱮᱦᱚᱸᱥᱚᱜ-ᱟ᱾",
      step1_next_1: "ᱞᱟᱦᱟ: ᱯᱚᱨᱢᱤᱴ ➜",
      step1_badge_2: "☣ ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱚᱛᱚᱨ ᱡᱟᱭᱜᱟ (2/3)",
      step1_title_2: "ᱜᱮᱥ ᱡᱟᱸᱪ ᱟᱨ ᱯᱚᱨᱢᱤᱴ",
      step1_desc_2: "ᱵᱚᱞᱚᱱ ᱢᱟᱲᱟᱝ ᱜᱮᱥ ᱡᱟᱸᱪ ᱟᱨ ᱥᱩᱦᱤ ᱟᱠᱟᱱ ᱯᱚᱨᱢᱤᱴ ᱞᱟᱹᱠᱛᱤᱭᱟ᱾",
      step1_next_2: "ᱞᱟᱦᱟ: ᱵᱚᱛᱚᱨ ᱡᱟᱭᱜᱟ ᱵᱟᱪᱷᱟᱣ ➜",
      step1_badge_3: "☣ ᱦᱟᱹᱴᱤᱧ 1 / 3 — ᱵᱚᱛᱚᱨ ᱡᱟᱭᱜᱟ (3/3)",
      step1_title_3: "ᱵᱚᱛᱚᱨ ᱡᱟᱭᱜᱟ ᱨᱮ ᱪᱮᱫ ᱠᱟᱹᱢᱤ",
      step1_desc_3: "ᱜᱮᱥ ᱡᱟᱣᱨᱟ ᱡᱟᱭᱜᱟ ᱨᱮ ᱞᱟᱹᱠᱛᱤᱭᱟᱱ ᱠᱟᱹᱢᱤ ᱵᱟᱪᱷᱟᱣ ᱢᱮ:",
      step2_badge: "☣ ᱦᱟᱹᱴᱤᱧ 2 / 3 — PPE ᱵᱟᱪᱷᱟᱣ",
      step2_title: "ᱡᱤᱣᱤ ᱨᱩᱠᱷᱤᱭᱟᱹ PPE ᱵᱟᱪᱷᱟᱣ ᱢᱮ",
      step2_desc: "ᱵᱚᱞᱚᱱ ᱞᱟᱹᱜᱤᱫ ᱡᱚᱛᱚ PPE ᱵᱟᱪᱷᱟᱣ ᱢᱮ᱾ ᱵᱷᱩᱞ ᱢᱟᱥᱠ ᱵᱟᱪᱷᱟᱣ ᱞᱮᱠᱷᱟᱱ ᱡᱤᱣᱤ ᱪᱟᱞᱟᱜ-ᱟ᱾",
      step3_badge: "☣ ᱦᱟᱹᱴᱤᱧ 3 / 3 — ᱜᱟᱛᱮ ᱥᱟᱶ ᱪᱟᱞᱟᱜ",
      step3_title: "ᱵᱟᱦᱨᱮ ᱨᱮ ᱛᱟᱦᱮᱸᱱ ᱜᱟᱛᱮ ᱨᱮᱭᱟᱜ ᱠᱟᱹᱢᱤ",
      step3_desc: "ᱵᱷᱤᱛᱨᱤ ᱜᱟᱛᱮ ᱵᱮᱦᱚᱸᱥ ᱮᱱᱟ᱾ ᱟᱢᱟᱜ ᱞᱟᱹᱠᱛᱤᱭᱟᱱ ᱠᱟᱹᱢᱤ ᱪᱮᱫ?"
    }
  }
};

// set active locale ("en", "hi", "sat")
function setLocale(lang) {
  if (lang && _catalog[lang]) {
    _currentLocale = lang;
  }
}

// read active locale
function getLocale() {
  return _currentLocale;
}

// translate key with fallback and parameter interpolation
function t(path, fallback = "", params = {}) {
  const parts = path.split(".");
  let current = _catalog[_currentLocale];

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      current = null;
      break;
    }
  }

  // fallback to english catalog if current language missing key
  if (current === null && _currentLocale !== "en") {
    let enCurrent = _catalog.en;
    for (const part of parts) {
      if (enCurrent && typeof enCurrent === "object" && part in enCurrent) {
        enCurrent = enCurrent[part];
      } else {
        enCurrent = null;
        break;
      }
    }
    current = enCurrent;
  }

  let result = (typeof current === "string") ? current : fallback;

  // interpolate {param} substitutions
  if (params && typeof params === "object") {
    Object.keys(params).forEach((key) => {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), params[key]);
    });
  }

  return result;
}

export {
  t,
  setLocale,
  getLocale
};
