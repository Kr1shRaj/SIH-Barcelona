# Santali Translation Manifest — Equipment Familiarization

132 strings introduced by the equipment familiarization, loading, in-app bar and sign in
screens need a human Santali (Ol Chiki) translation.

None of them were machine-translated. Ol Chiki has no settled vocabulary for most of
this equipment — there is no agreed term for a multi-gas detector or a dorsal D-ring —
and inventing one would put a word into a worker's language that no worker uses. So
these keys are **deliberately absent from `sat.json`**, and the app marks what it is
showing as untranslated instead of passing a fallback off as Santali.

## How to land a translation

1. Add the key and its Ol Chiki string to `frontend/locales/sat.json`.
2. Delete the same key from `PREREQUISITE_UI_KEYS` in
   `frontend/prerequisite/translation-status.js`, or — for an `equipment.*` key —
   from the catalog-derived set there.
3. Run the frontend tests. `prerequisite.test.js` fails if a key is in both places or
   in neither, so a half-finished translation cannot ship silently.

## Priority

The **component labels** matter most. They are what a worker has to recognise on the
real object. The longer `desc` lines are supporting detail and the narration audio
carries them better than the screen does.

## Strings

| Key | English source | Hindi reference |
|---|---|---|
| `auth.activate_action` | Activate and continue | चालू करें और आगे बढ़ें |
| `auth.activate_lede` | Enter the code your supervisor gave you, then choose a PIN. | सुपरवाइज़र से मिला कोड डालें, फिर अपना पिन चुनें। |
| `auth.activate_title` | Set up your account | अपना खाता शुरू करें |
| `auth.code` | Activation code | एक्टिवेशन कोड |
| `auth.confirm_pin` | Confirm PIN | पिन दोबारा डालें |
| `auth.error_activation_failed` | That activation code is not valid for this worker ID. | यह एक्टिवेशन कोड इस वर्कर आईडी के लिए सही नहीं है। |
| `auth.error_invalid_credentials` | Worker ID or PIN is not correct. | वर्कर आईडी या पिन सही नहीं है। |
| `auth.error_network_error` | Cannot reach the training server. Check the connection. | प्रशिक्षण सर्वर तक नहीं पहुँच पा रहे। कनेक्शन देखें। |
| `auth.error_too_many_attempts` | Too many attempts. Wait a moment and try again. | बहुत बार कोशिश हुई। थोड़ी देर बाद फिर कोशिश करें। |
| `auth.fill_all` | Fill in every field. | सभी जानकारी भरें। |
| `auth.have_account` | I already have a PIN | मेरे पास पहले से पिन है |
| `auth.login_action` | Sign in | साइन इन करें |
| `auth.login_lede` | Enter your worker ID and PIN to continue your training. | प्रशिक्षण जारी रखने के लिए अपना वर्कर आईडी और पिन डालें। |
| `auth.login_title` | Sign in | साइन इन करें |
| `auth.new_pin` | Choose a PIN | पिन चुनें |
| `auth.no_account` | First time? Set up your account | पहली बार? अपना खाता शुरू करें |
| `auth.offline_lede` | You are offline. Enter your PIN to continue training. | आप ऑफ़लाइन हैं। प्रशिक्षण जारी रखने के लिए पिन डालें। |
| `auth.offline_locked` | Too many attempts. Sign in online to continue. | बहुत बार गलत। जारी रखने के लिए ऑनलाइन साइन इन करें। |
| `auth.offline_title` | Welcome back | वापसी पर स्वागत है |
| `auth.pin` | PIN | पिन |
| `auth.pin_mismatch` | The two PINs do not match. | दोनों पिन एक जैसे नहीं हैं। |
| `auth.pin_rule` | At least 6 digits | कम से कम 6 अंक |
| `auth.sign_out` | Sign out | साइन आउट |
| `auth.use_worker_id` | Sign in with worker ID instead | वर्कर आईडी से साइन इन करें |
| `auth.wrong_pin` | That PIN is not correct. | यह पिन सही नहीं है। |
| `auth.worker_id` | Worker ID | वर्कर आईडी |
| `auth.working` | Working… | हो रहा है… |
| `app.theme_light` | Switch to light mode | लाइट मोड पर जाएं |
| `app.theme_dark` | Switch to dark mode | डार्क मोड पर जाएं |
| `app.tagline` | Ready before it's real. | असली हालात से पहले तैयारी। |
| `app.splash_loading` | Preparing your training environment | आपका प्रशिक्षण वातावरण तैयार हो रहा है |
| `app.select_language_hint` | Choose your preferred language | अपनी पसंद की भाषा चुनें |
| `equipment.fire_extinguisher.components.handle.desc` | Squeeze to discharge. Release to stop. | छोड़ने के लिए दबाएं। रोकने के लिए छोड़ दें। |
| `equipment.fire_extinguisher.components.handle.label` | Handle / Lever | हैंडल / लीवर |
| `equipment.fire_extinguisher.components.hose.desc` | Carries the powder from the cylinder to the nozzle. Check it for cracks. | पाउडर को सिलेंडर से नोज़ल तक ले जाती है। इसमें दरारों की जांच करें। |
| `equipment.fire_extinguisher.components.hose.label` | Hose | नली |
| `equipment.fire_extinguisher.components.nozzle.desc` | Point this at the base of the fire, not at the flames. | इसे आग के आधार पर रखें, लपटों पर नहीं। |
| `equipment.fire_extinguisher.components.nozzle.label` | Nozzle | नोज़ल |
| `equipment.fire_extinguisher.components.pressure_gauge.desc` | The needle must sit in the green band. In the red, the cylinder will not discharge. | सुई हरे क्षेत्र में होनी चाहिए। लाल में होने पर सिलेंडर काम नहीं करेगा। |
| `equipment.fire_extinguisher.components.pressure_gauge.label` | Pressure Gauge | दाब मापक |
| `equipment.fire_extinguisher.components.safety_pin.desc` | Pull this out first. The lever will not move until it is removed. | पहले इसे बाहर खींचें। इसके हटने तक लीवर नहीं चलेगा। |
| `equipment.fire_extinguisher.components.safety_pin.label` | Safety Pin | सुरक्षा पिन |
| `equipment.fire_extinguisher.components.valve_block.desc` | Holds the pressure in. Never strike it or loosen it. | दबाव को अंदर रखता है। इसे कभी न मारें और न ढीला करें। |
| `equipment.fire_extinguisher.components.valve_block.label` | Valve Block | वाल्व ब्लॉक |
| `equipment.fire_extinguisher.name` | Fire Extinguisher | अग्निशामक यंत्र |
| `equipment.fire_extinguisher.purpose` | Puts out a small fire before it spreads. Aim at the base of the flames. | छोटी आग को फैलने से पहले बुझाता है। लपटों के आधार पर निशाना लगाएं। |
| `equipment.multi_gas_detector.components.alarm_indicator.desc` | Flashes and sounds when gas rises or oxygen falls. Leave at once. | गैस बढ़ने या ऑक्सीजन घटने पर चमकता और बजता है। तुरंत बाहर निकलें। |
| `equipment.multi_gas_detector.components.alarm_indicator.label` | Alarm Indicator | अलार्म सूचक |
| `equipment.multi_gas_detector.components.control_buttons.desc` | Power on, move through the readings, and confirm. Test before every shift. | चालू करने, रीडिंग बदलने और पुष्टि करने के लिए। हर पाली से पहले जाँचें। |
| `equipment.multi_gas_detector.components.control_buttons.label` | Control Buttons | नियंत्रण बटन |
| `equipment.multi_gas_detector.components.display_screen.desc` | Shows the live reading for each gas. | प्रत्येक गैस का सजीव पाठ्यांक दिखाती है। |
| `equipment.multi_gas_detector.components.display_screen.label` | Display Screen | प्रदर्शन स्क्रीन |
| `equipment.multi_gas_detector.components.sensor_intake.desc` | Air enters here. Never cover it with a hand or a glove. | हवा यहां प्रवेश करती है। इसे कभी हाथ या दस्ताने से न ढकें। |
| `equipment.multi_gas_detector.components.sensor_intake.label` | Sensor Intake | सेंसर इनटेक |
| `equipment.multi_gas_detector.name` | Multi-Gas Detector | मल्टी-गैस डिटेक्टर |
| `equipment.multi_gas_detector.purpose` | Reads the air before you enter. It finds gases you cannot smell. | प्रवेश से पहले हवा को पढ़ता है। यह उन गैसों को पकड़ता है जिन्हें आप सूंघ नहीं सकते। |
| `equipment.ppe_kit.components.flame_resistant_coverall.desc` | Does not melt onto skin. Ordinary synthetic clothing does. | त्वचा पर नहीं पिघलता। साधारण सिंथेटिक कपड़े पिघलते हैं। |
| `equipment.ppe_kit.components.flame_resistant_coverall.label` | Flame-Resistant Coverall | अग्निरोधी कवरऑल |
| `equipment.ppe_kit.components.high_vis_vest.desc` | Reflective strips let rescuers find you in heavy smoke. | परावर्तक पट्टियां घने धुएं में बचावकर्मियों को आपको ढूंढने देती हैं। |
| `equipment.ppe_kit.components.high_vis_vest.label` | High-Visibility Vest | उच्च दृश्यता जैकेट |
| `equipment.ppe_kit.components.safety_gloves.desc` | Protect the hands from hot metal and from the extinguisher's cold horn. | हाथों को गर्म धातु और अग्निशामक के ठंडे हॉर्न से बचाते हैं। |
| `equipment.ppe_kit.components.safety_gloves.label` | Safety Gloves | सुरक्षा दस्ताने |
| `equipment.ppe_kit.components.safety_goggles.desc` | Shield the eyes from smoke, sparks and flying debris. | आंखों को धुएं, चिंगारी और उड़ते मलबे से बचाता है। |
| `equipment.ppe_kit.components.safety_goggles.label` | Safety Goggles | सुरक्षा चश्मा |
| `equipment.ppe_kit.name` | PPE Kit | पीपीई किट |
| `equipment.ppe_kit.purpose` | The protective clothing worn before entering a fire or hot work area. | आग या गर्म कार्य क्षेत्र में जाने से पहले पहने जाने वाले सुरक्षा वस्त्र। |
| `equipment.safety_harness.components.chest_strap.desc` | Keeps the shoulder straps from sliding off. | कंधे की पट्टियों को फिसलने से रोकता है। |
| `equipment.safety_harness.components.chest_strap.label` | Chest Strap | छाती पट्टा |
| `equipment.safety_harness.components.dorsal_d_ring.desc` | The lifeline attaches here, between the shoulder blades. | लाइफलाइन यहां, दोनों कंधों के बीच जुड़ती है। |
| `equipment.safety_harness.components.dorsal_d_ring.label` | Dorsal D-Ring | पृष्ठीय डी-रिंग |
| `equipment.safety_harness.components.leg_straps.desc` | Carry your weight during a rescue. Snug, about two fingers of slack. | बचाव के दौरान आपका वज़न उठाते हैं। कसे हुए, लगभग दो उंगली ढीले। |
| `equipment.safety_harness.components.leg_straps.label` | Leg Straps | पैर पट्टे |
| `equipment.safety_harness.components.lifeline.desc` | Runs to the winch outside. It stays attached the whole time you are inside. | बाहर विंच तक जाती है। जब तक आप भीतर हैं, यह जुड़ी रहनी चाहिए। |
| `equipment.safety_harness.components.lifeline.label` | Lifeline | लाइफलाइन |
| `equipment.safety_harness.name` | Safety Harness & Lifeline | सुरक्षा हार्नेस और लाइफलाइन |
| `equipment.safety_harness.purpose` | Lets the attendant pull you out of a confined space without entering it. | परिचारक को बिना भीतर आए आपको सीमित स्थान से बाहर खींचने देता है। |
| `equipment.safety_helmet.components.chin_strap.desc` | Keeps the helmet on your head when you bend or fall. Fasten it every time. | झुकने या गिरने पर हेलमेट को सिर पर रखता है। हर बार बांधें। |
| `equipment.safety_helmet.components.chin_strap.label` | Chin Strap | ठुड्डी का पट्टा |
| `equipment.safety_helmet.components.brim.desc` | Keeps falling dust and water off the face. | गिरती धूल और पानी को चेहरे से दूर रखता है। |
| `equipment.safety_helmet.components.brim.label` | Brim | किनारा |
| `equipment.safety_helmet.components.outer_shell.desc` | Spreads the force of an impact. Replace it after any hard blow. | टक्कर के बल को फैलाता है। किसी भी तेज़ चोट के बाद इसे बदलें। |
| `equipment.safety_helmet.components.outer_shell.label` | Outer Shell | बाहरी खोल |
| `equipment.safety_helmet.components.suspension_harness.desc` | The inner cradle. It holds a gap between shell and skull — never remove it. | भीतरी पालना। यह खोल और खोपड़ी के बीच जगह रखता है — इसे कभी न हटाएं। |
| `equipment.safety_helmet.components.suspension_harness.label` | Suspension Harness | सस्पेंशन हार्नेस |
| `equipment.safety_helmet.name` | Safety Helmet | सुरक्षा हेलमेट |
| `equipment.safety_helmet.purpose` | Protects the head from falling rock, tools and impact. Worn in both modules. | सिर को गिरते पत्थर, औज़ार और टक्कर से बचाता है। दोनों मॉड्यूल में पहना जाता है। |
| `equipment.safety_shoes.components.ankle_collar.desc` | Supports the ankle on uneven mine floors. | असमान खदान फर्श पर टखने को सहारा देता है। |
| `equipment.safety_shoes.components.ankle_collar.label` | Ankle Collar | टखना कॉलर |
| `equipment.safety_shoes.components.anti_slip_sole.desc` | Grips wet and oily floors. Check the tread is not worn smooth. | गीले और तैलीय फर्श पर पकड़ बनाता है। जांचें कि ट्रेड घिसा हुआ न हो। |
| `equipment.safety_shoes.components.anti_slip_sole.label` | Anti-Slip Sole | फिसलन-रोधी तलवा |
| `equipment.safety_shoes.components.penetration_resistant_midsole.desc` | Stops nails and sharp scrap coming up through the sole. | कीलों और नुकीले कबाड़ को तलवे से ऊपर आने से रोकता है। |
| `equipment.safety_shoes.components.penetration_resistant_midsole.label` | Penetration-Resistant Midsole | भेदन-रोधी मिडसोल |
| `equipment.safety_shoes.components.steel_toe_cap.desc` | Takes the weight of a dropped load off your toes. | गिरे हुए भार का वज़न आपकी उंगलियों से हटाता है। |
| `equipment.safety_shoes.components.steel_toe_cap.label` | Steel Toe Cap | स्टील टो कैप |
| `equipment.safety_shoes.name` | Safety Shoes | सुरक्षा जूते |
| `equipment.safety_shoes.purpose` | Protect the feet from falling loads, sharp scrap and slippery ground. | पैरों को गिरते भार, नुकीले कबाड़ और फिसलन भरी ज़मीन से बचाते हैं। |
| `equipment.scba.components.air_cylinder.desc` | Holds your air supply. Know how many minutes it gives you. | आपकी वायु आपूर्ति रखता है। जानें कि यह कितने मिनट की हवा देता है। |
| `equipment.scba.components.air_cylinder.label` | Air Cylinder | वायु सिलेंडर |
| `equipment.scba.components.cylinder_valve.desc` | Open it fully before entry and check the gauge reads full. | प्रवेश से पहले इसे पूरा खोलें और जांचें कि गेज पूरा दिखा रहा है। |
| `equipment.scba.components.cylinder_valve.label` | Cylinder Valve | सिलेंडर वाल्व |
| `equipment.scba.components.face_mask.desc` | Must seal against the skin. A beard breaks the seal. | त्वचा से सटकर सील होना चाहिए। दाढ़ी सील तोड़ देती है। |
| `equipment.scba.components.face_mask.label` | Face Mask | फेस मास्क |
| `equipment.scba.components.pressure_regulator.desc` | Steps the cylinder pressure down to air you can breathe. | सिलेंडर के दबाव को घटाकर सांस लेने योग्य हवा बनाता है। |
| `equipment.scba.components.pressure_regulator.label` | Pressure Regulator | दाब नियामक |
| `equipment.scba.name` | SCBA / Breathing Apparatus | एससीबीए / श्वास उपकरण |
| `equipment.scba.purpose` | Supplies clean air from a cylinder. The only protection in a toxic or low-oxygen space. | सिलेंडर से स्वच्छ हवा देता है। विषैले या कम-ऑक्सीजन स्थान में यही एकमात्र सुरक्षा है। |
| `modules.locked` | Complete equipment familiarization first | पहले उपकरण परिचय पूरा करें |
| `modules.select_subtitle` | Pick a module to begin | शुरू करने के लिए मॉड्यूल चुनें |
| `modules.select_title` | Choose Your Training | अपना प्रशिक्षण चुनें |
| `prerequisite.audio_unavailable` | Narration not yet recorded | वर्णन अभी रिकॉर्ड नहीं हुआ |
| `prerequisite.badge_both` | Both modules | दोनों मॉड्यूल |
| `prerequisite.badge_fire` | Fire & Explosion | आग और विस्फोट |
| `prerequisite.badge_gas` | Gas Leak & Confined Space | गैस रिसाव और सीमित स्थान |
| `prerequisite.btn_close` | Close | बंद करें |
| `prerequisite.btn_done` | Done | पूर्ण |
| `prerequisite.btn_listen` | Listen | सुनें |
| `prerequisite.btn_next` | Next | अगला |
| `prerequisite.btn_prev` | Previous | पिछला |
| `prerequisite.btn_reassemble` | Reassemble | वापस जोड़ें |
| `prerequisite.card_open_hint` | Tap to open | खोलने के लिए टैप करें |
| `prerequisite.card_viewed` | Viewed | देखा गया |
| `prerequisite.complete_desc` | You may now begin training. | अब आप प्रशिक्षण शुरू कर सकते हैं। |
| `prerequisite.complete_title` | Equipment Familiarization Complete | उपकरण परिचय पूर्ण |
| `prerequisite.detail_components` | Key parts | मुख्य भाग |
| `prerequisite.explode_hint` | Tap a part to read about it | पढ़ने के लिए किसी भाग पर टैप करें |
| `prerequisite.item_position` | {current} / {total} | {current} / {total} |
| `prerequisite.locked_notice` | Open every item to unlock training | प्रशिक्षण खोलने के लिए हर वस्तु देखें |
| `prerequisite.progress` | {viewed} of {total} viewed | {total} में से {viewed} देखे गए |
| `prerequisite.subtitle` | Learn the equipment before training begins | प्रशिक्षण शुरू होने से पहले उपकरण जानें |
| `prerequisite.title` | Equipment Familiarization | उपकरण परिचय |
| `prerequisite.tap_to_dismantle` | Tap the equipment to take it apart | उपकरण खोलने के लिए उस पर टैप करें |
| `prerequisite.translation_pending` | Santali translation pending | संताली अनुवाद लंबित |

## Related

- Audio for these items: `frontend/audio/RECORDING_MANIFEST.md`
- The 32 Santali keys missing from the *existing* modules are a separate, older gap
  and are not listed here.
