// inline svg for each piece of equipment. drawn, not photographed, so it ships with
// the app and costs nothing to cache.
//
// Every shape a callout points at carries data-part="<component id>", which is what
// welds the art to equipment-data.js: a moved anchor with no matching part is a bug
// the tests catch instead of a line pointing at empty space.
//
// All art lives in the 0-100 viewBox from ART_VIEWBOX.

// extinguisher, parts named the way buildExtinguisherEntity() names them in AR
function fireExtinguisher() {
  return `
    <path class="eq-art__shade" d="M36 34 h28 v46 a8 8 0 0 1 -8 8 h-12 a8 8 0 0 1 -8 -8 z" />
    <path class="eq-art__body" data-part="cylinder" d="M38 30 h24 a4 4 0 0 1 4 4 v46 a8 8 0 0 1 -8 8 h-16 a8 8 0 0 1 -8 -8 v-46 a4 4 0 0 1 4 -4 z" />
    <rect class="eq-art__decal" x="40" y="46" width="20" height="14" rx="2" />
    <path class="eq-art__metal" d="M44 26 h12 v5 h-12 z" />
    <rect class="eq-art__metal" data-part="valve_block" x="42" y="17" width="12" height="9" rx="2" />
    <path class="eq-art__metal" data-part="handle" d="M39 13 h19 a2 2 0 0 1 0 4 h-19 a2 2 0 0 1 0 -4 z" />
    <circle class="eq-art__gauge" data-part="pressure_gauge" cx="57" cy="22" r="5" />
    <path class="eq-art__needle" d="M57 22 L54.5 18.8" />
    <circle class="eq-art__accent" data-part="safety_pin" cx="59" cy="16" r="3.2" />
    <path class="eq-art__accent" d="M59 16 h5" />
    <path class="eq-art__hose" data-part="hose" d="M54 24 C 68 26, 70 38, 63 46 C 58 53, 62 58, 66 62" />
    <path class="eq-art__metal" data-part="nozzle" d="M63 61 l7 -3 l3 6 l-7 3 z" />
  `;
}

// full ppe set shown on a worker outline so each item is read in place
function ppeKit() {
  return `
    <circle class="eq-art__shade" cx="50" cy="19" r="9" />
    <rect class="eq-art__metal" data-part="safety_goggles" x="40" y="16" width="20" height="7" rx="3.5" />
    <path class="eq-art__body" data-part="flame_resistant_coverall" d="M38 30 h24 l4 10 v22 l-3 26 h-9 l-2 -20 l-2 20 h-9 l-3 -26 v-22 z" />
    <path class="eq-art__accent" data-part="high_vis_vest" d="M41 32 h18 v24 h-18 z" />
    <path class="eq-art__stripe" d="M41 42 h18 M41 48 h18" />
    <path class="eq-art__body" d="M38 32 L30 52 l6 4 l6 -16 z" />
    <path class="eq-art__body" d="M62 32 L70 50 l-6 4 l-6 -16 z" />
    <rect class="eq-art__glove" data-part="safety_gloves" x="64" y="50" width="10" height="12" rx="4" />
    <rect class="eq-art__glove" x="26" y="52" width="10" height="12" rx="4" />
  `;
}

// hard hat in profile so the brim and the inner cradle are both visible
function safetyHelmet() {
  return `
    <path class="eq-art__shade" d="M28 60 C 28 36, 72 36, 72 60 z" />
    <path class="eq-art__body" data-part="outer_shell" d="M27 58 C 27 30, 73 30, 73 58 z" />
    <path class="eq-art__ridge" d="M50 30 L50 58" />
    <ellipse class="eq-art__body" data-part="brim" cx="50" cy="59" rx="27" ry="5" />
    <path class="eq-art__suspension" data-part="suspension_harness" d="M34 56 C 42 48, 58 48, 66 56 M50 47 L50 56" />
    <path class="eq-art__strap" data-part="chin_strap" d="M35 60 C 40 72, 60 72, 65 60" />
    <circle class="eq-art__metal" cx="58" cy="69" r="2.4" />
  `;
}

// safety boot in profile, toe to the right, so the sole layers stack readably
function safetyShoes() {
  return `
    <path class="eq-art__shade" d="M30 30 h20 v34 h32 l2 14 h-54 z" />
    <path class="eq-art__body" d="M28 28 h20 a2 2 0 0 1 2 2 v32 h26 a6 6 0 0 1 6 5 l1 10 h-55 a2 2 0 0 1 -2 -2 z" />
    <path class="eq-art__collar" data-part="ankle_collar" d="M28 26 h22 v8 h-22 z" />
    <path class="eq-art__metal" data-part="steel_toe_cap" d="M68 62 a10 10 0 0 1 9 6 l1 7 h-14 v-13 z" />
    <path class="eq-art__midsole" data-part="penetration_resistant_midsole" d="M27 74 h56 v5 h-56 z" />
    <path class="eq-art__sole" data-part="anti_slip_sole" d="M26 79 h58 v7 h-58 z" />
    <path class="eq-art__tread" d="M31 82 h4 M39 82 h4 M47 82 h4 M55 82 h4 M63 82 h4 M71 82 h4" />
    <path class="eq-art__lace" d="M33 38 h14 M33 45 h14 M33 52 h14" />
  `;
}

// handheld four-gas monitor, face on
function multiGasDetector() {
  return `
    <rect class="eq-art__shade" x="36" y="22" width="30" height="60" rx="6" />
    <rect class="eq-art__body" x="34" y="20" width="32" height="60" rx="6" />
    <circle class="eq-art__alarm" data-part="alarm_indicator" cx="50" cy="17" r="4" />
    <rect class="eq-art__screen" data-part="display_screen" x="39" y="29" width="22" height="18" rx="2" />
    <path class="eq-art__reading" d="M42 35 h6 M42 40 h10 M55 35 h4" />
    <circle class="eq-art__vent" data-part="sensor_intake" cx="50" cy="68" r="7" />
    <path class="eq-art__grille" d="M45 65 h10 M45 68 h10 M45 71 h10" />
    <rect class="eq-art__metal" data-part="belt_clip" x="28" y="48" width="6" height="16" rx="2" />
    <rect class="eq-art__button" x="41" y="52" width="8" height="5" rx="2" />
    <rect class="eq-art__button" x="52" y="52" width="8" height="5" rx="2" />
  `;
}

// air cylinder on the left, mask on the right, joined by the supply hose
function scba() {
  return `
    <rect class="eq-art__shade" x="30" y="28" width="20" height="52" rx="9" />
    <rect class="eq-art__body" data-part="air_cylinder" x="28" y="26" width="20" height="52" rx="9" />
    <path class="eq-art__band" d="M28 40 h20 M28 62 h20" />
    <rect class="eq-art__metal" data-part="cylinder_valve" x="33" y="16" width="10" height="10" rx="2" />
    <circle class="eq-art__gauge" cx="38" cy="21" r="2.6" />
    <path class="eq-art__hose" d="M43 20 C 58 20, 62 26, 66 30" />
    <ellipse class="eq-art__mask" data-part="face_mask" cx="70" cy="34" rx="11" ry="13" />
    <ellipse class="eq-art__visor" cx="70" cy="31" rx="7.5" ry="7" />
    <rect class="eq-art__metal" data-part="pressure_regulator" x="52" y="56" width="12" height="11" rx="2" />
    <path class="eq-art__hose" d="M48 52 C 52 54, 52 56, 54 57 M64 60 C 68 54, 70 48, 70 46" />
    <path class="eq-art__strap" d="M48 32 C 56 36, 56 44, 50 48" />
  `;
}

// full body harness seen from the back, where the dorsal d-ring sits
function safetyHarness() {
  return `
    <circle class="eq-art__shade" cx="50" cy="23" r="6" />
    <path class="eq-art__metal" data-part="dorsal_d_ring" d="M44 22 a6 6 0 1 1 12 0 a6 6 0 1 1 -12 0 z" />
    <path class="eq-art__strap" d="M50 28 L36 52 M50 28 L64 52" />
    <path class="eq-art__strap" data-part="chest_strap" d="M36 40 h28" />
    <rect class="eq-art__metal" x="46" y="37" width="8" height="6" rx="1.5" />
    <path class="eq-art__strap" d="M36 52 L38 62 M64 52 L62 62 M38 62 h24" />
    <path class="eq-art__strap" data-part="leg_straps" d="M40 62 C 34 70, 38 80, 46 78 M60 62 C 66 70, 62 80, 54 78" />
    <rect class="eq-art__metal" x="42" y="74" width="7" height="5" rx="1.5" />
    <rect class="eq-art__metal" x="51" y="74" width="7" height="5" rx="1.5" />
    <path class="eq-art__lifeline" data-part="lifeline" d="M56 22 C 66 26, 70 36, 68 46 C 66 56, 72 64, 80 68" />
  `;
}

const EQUIPMENT_ART = {
  fireExtinguisher,
  ppeKit,
  safetyHelmet,
  safetyShoes,
  multiGasDetector,
  scba,
  safetyHarness
};

// render the art for one catalog entry, empty string when the key is unknown
function renderArt(artKey) {
  const builder = EQUIPMENT_ART[artKey];
  if (typeof builder !== "function") return "";
  return builder();
}

// which component ids the art actually draws a shape for
function artPartIds(artKey) {
  const markup = renderArt(artKey);
  return [...markup.matchAll(/data-part="([a-z0-9_]+)"/g)].map((match) => match[1]);
}

export { EQUIPMENT_ART, renderArt, artPartIds };
