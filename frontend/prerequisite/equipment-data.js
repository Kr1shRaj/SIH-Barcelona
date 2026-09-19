// equipment catalog for the mandatory familiarization step. data only, no dom.
//
// One entry per real object. safety_helmet is worn in both modules, so it appears
// once here and names both — a worker should not meet the same helmet twice.
//
// Callout geometry is expressed in the 0-100 viewBox space shared by the art and the
// leader-line layer, so a label and the line pointing at it never drift apart:
//   anchor — the point ON the equipment the line touches
//   label  — where the label box sits, as a percentage of the stage
//   side   — which edge the label hugs, so text can flow away from the art

const ART_VIEWBOX = "0 0 100 100";

// An item is only shown, and only counted towards completion, once it has real
// artwork. The other six keep their data and their locale strings and come back by
// flipping this to "active" and giving them an image — no UI work needed.
const STATUS_ACTIVE = "active";
const STATUS_PENDING_ARTWORK = "pending_artwork";

// A photograph sits inside the stage rather than filling it, so the callout labels
// have gutters to live in and never cover the equipment. The box stays square, so a
// square photo fills it exactly: stage = IMAGE_INSET + (fraction of image) * IMAGE_SPAN.
const IMAGE_INSET = 17;
const IMAGE_SPAN = 66;

// how far the assembled photo shrinks when the view comes apart, leaving room for
// the part plates either side while staying recognisable as the central reference
const EXPLODED_BODY_SCALE = 0.52;

// How much of the stage a callout label may occupy, measured in from its own edge.
// The label box is pinned to that edge and grows inward, so it can never be clipped
// by the viewport however long the translated string turns out to be, and the leader
// line stops at the box's inner edge rather than running underneath it.
const CALLOUT_GUTTER = 27;

// Geometry of one part plate, as a percentage of the square stage. It lives here
// rather than in the stylesheet because the renderer needs the same numbers to fit
// each component photograph inside its frame without stretching it, and two copies
// of a number that must agree is how a layout drifts.
//
// Three rows of 27 leave a gap between them, and two columns of 28 either side leave
// the middle clear for the body at EXPLODED_BODY_SCALE. A plate is 96 x 93 css px on
// a 375 px phone, comfortably past the 48 px tap minimum.
const PART_PLATE = { width: 28, height: 27, frameHeight: 20 };

// Every supplied photograph was shot on white paper. Rather than editing the
// photographs — they ship byte-identical, and re-encoding a jpeg to punch an alpha
// channel into it would throw away image quality for nothing — each one carries a
// separate mask: a png whose alpha is the object's silhouette and whose colour
// channels are empty. CSS masks the photo with it, so the white paper is simply not
// painted and the equipment sits on the app's own dark background.
//
// The masks were derived from the photographs' own pixels by
// `make-background-masks.ps1`, next to them: flood-fill the near-white paper inward
// from the border, cut the enclosed holes that are big enough to be real holes (the
// gap inside the hose loop, the bore of the O-ring, the bore of the pin's ring) while
// leaving the small enclosed white patches alone because those are specular
// highlights on chrome, then erode a pixel to take the jpeg fringe off and blur to
// give the edge its antialiasing back.
const PHOTOS = {
  assembled: {
    image: "./assets/images/fire-extinguisher.jpeg",
    mask: "./assets/images/fire-extinguisher.mask.png",
    size: { w: 554, h: 554 }
  },
  // one photograph of a stripped valve assembly — lever, threaded block and gauge
  // laid out separately. three components share it and are framed by `crop`.
  valveKit: {
    image: "./assets/images/fire-extinguisher-valve-kit.jpg",
    mask: "./assets/images/fire-extinguisher-valve-kit.mask.png",
    size: { w: 1000, h: 1000 }
  },
  safetyPin: {
    image: "./assets/images/fire-extinguisher-safety-pin.jpeg",
    mask: "./assets/images/fire-extinguisher-safety-pin.mask.png",
    size: { w: 1172, h: 1172 }
  },
  hose: {
    image: "./assets/images/fire-extinguisher-hose.jpg",
    mask: "./assets/images/fire-extinguisher-hose.mask.png",
    size: { w: 428, h: 500 }
  },
  nozzle: {
    image: "./assets/images/fire-extinguisher-nozzle.jpg",
    mask: "./assets/images/fire-extinguisher-nozzle.mask.png",
    size: { w: 500, h: 500 }
  }
};

const VALVE_KIT = PHOTOS.valveKit.image;

// The gas leak / confined space set. Each of these is ONE photograph carrying both
// the assembled view and every component cropped out of it, so a worker never sees a
// close-up of a different unit than the one they were just looking at.
//
// Two are derived rather than copied: see make-background-masks.ps1 next to them.
const GAS_PHOTOS = {
  // the hero view of the team's own detector render, cropped square around the device
  detector: {
    image: "./assets/images/gas-detector.jpg",
    mask: "./assets/images/gas-detector.mask.png",
    size: { w: 990, h: 990 }
  },
  scba: {
    image: "./assets/images/gas-scba.png",
    mask: "./assets/images/gas-scba.mask.png",
    size: { w: 700, h: 700 }
  },
  harness: {
    image: "./assets/images/gas-harness.jpg",
    mask: "./assets/images/gas-harness.mask.png",
    size: { w: 1400, h: 1400 }
  }
};

// fire extinguisher part names mirror buildExtinguisherEntity() in the fire module,
// so the word a worker learns here is the word the AR scene uses later
const EQUIPMENT_CATALOG = [
  {
    id: "fire_extinguisher",
    modules: ["fire-response"],
    status: STATUS_ACTIVE,
    // a photograph of the real thing, not a drawing. a worker has to recognise the
    // extinguisher on the wall, and a diagram does not teach that.
    image: PHOTOS.assembled.image,
    mask: PHOTOS.assembled.mask,
    size: PHOTOS.assembled.size,
    // kept as the fallback the renderer uses when no image is set, and as the
    // reference the part naming came from
    art: "fireExtinguisher",
    // draw a thin arrow from where each part sat to where it came to rest — see
    // explodeArrow below
    explodeArrows: true,
    // Anchors were measured against the photograph's own pixels — the centroid of
    // the red lever mass, of the dark hose, of the metal head — and then checked to
    // land on a non-white pixel. Reading them off a grid by eye was tried first and
    // put four of the six in empty background, so they are not eyeballed.
    //
    // Values here are STAGE coordinates. Divide back out with imagePointToStage to
    // get the position on the photo itself, which is what was measured:
    //   handle 55.6,9.2 · valve 44,17 · gauge 50,17
    //   pin 55.5,16 · hose 21.6,49.9 · nozzle 32.5,80
    //
    // `label.x` is the edge the label box is pinned to, not its centre — see
    // CALLOUT_GUTTER. `label.y` is where it sits down that edge.
    //
    // `part` is the close-up used in the exploded view. Each one is a real
    // photograph of that component, never a crop lifted out of the assembled shot —
    // separating a part from that photo would expose geometry the camera never saw.
    // `crop` frames the component inside its source image, as percentages, so the
    // files ship byte-identical and are never re-encoded. Every crop was read off
    // the component's own bounding box in the silhouette mask, not estimated: the
    // first set was eyeballed and put a second copy of the pressure gauge inside the
    // lever's frame. `explode` is where the
    // part comes to rest once the unit is apart: two columns of three, each part on
    // the side it is called out on and in the order it sits on the real unit.
    components: [
      {
        id: "handle",
        anchor: { x: 53.7, y: 23.1 }, label: { x: 99, y: 14 }, side: "right",
        part: { ...PHOTOS.valveKit, crop: { x: 7, y: 21, w: 87, h: 42 }, explode: { x: 84, y: 15 } },
        // one of four parts on the valve head: each leaves on its own heading so the
        // lines fan apart as soon as they start
        arrow: { exit: -82, lead: 7 }
      },
      {
        id: "safety_pin",
        anchor: { x: 53.6, y: 27.6 }, label: { x: 99, y: 30 }, side: "right",
        part: { ...PHOTOS.safetyPin, crop: { x: 2, y: 23, w: 97, h: 40 }, explode: { x: 84, y: 50 } },
        // one of four parts on the valve head: each leaves on its own heading so the
        // lines fan apart as soon as they start
        arrow: { exit: -45, lead: 4 }
      },
      {
        id: "pressure_gauge",
        anchor: { x: 50, y: 28.2 }, label: { x: 99, y: 46 }, side: "right",
        part: { ...PHOTOS.valveKit, crop: { x: 54, y: 36.5, w: 17, h: 16.5 }, explode: { x: 84, y: 85 } },
        // the gauge sits inside the head's outline. heading down-right at 25° is the
        // quickest way off the body; a straight run to the bottom-right plate would lie
        // along the shoulder of the cylinder instead.
        arrow: { exit: 25, lead: 10, reach: 16 }
      },
      {
        id: "valve_block",
        anchor: { x: 46, y: 28.2 }, label: { x: 1, y: 22 }, side: "left",
        part: { ...PHOTOS.valveKit, crop: { x: 6, y: 56, w: 26, h: 25 }, explode: { x: 16, y: 15 } },
        // one of four parts on the valve head: each leaves on its own heading so the
        // lines fan apart as soon as they start
        arrow: { exit: -128, lead: 6 }
      },
      {
        id: "hose",
        anchor: { x: 31.3, y: 49.9 }, label: { x: 1, y: 50 }, side: "left",
        part: { ...PHOTOS.hose, crop: { x: 2, y: 25, w: 96, h: 50 }, explode: { x: 16, y: 50 } },
        // the hose sits right at the body's edge, so a straight arrow is a stub. it
        // leaves downward and sweeps round into the side of its plate instead.
        arrow: { exit: 110, lead: 10, arrive: 185, reach: 11 }
      },
      {
        id: "nozzle",
        anchor: { x: 38.5, y: 69.8 }, label: { x: 1, y: 74 }, side: "left",
        part: { ...PHOTOS.nozzle, crop: { x: 16, y: 29, w: 65, h: 42 }, explode: { x: 16, y: 85 } }
      }
    ]
  },
  {
    id: "ppe_kit",
    modules: ["fire-response"],
    // awaiting a real photograph. data and locale strings stay, the card does not show.
    status: STATUS_PENDING_ARTWORK,
    art: "ppeKit",
    components: [
      { id: "safety_goggles", anchor: { x: 50, y: 20 }, label: { x: 20, y: 12 }, side: "left" },
      { id: "high_vis_vest", anchor: { x: 50, y: 45 }, label: { x: 77, y: 32 }, side: "right" },
      { id: "flame_resistant_coverall", anchor: { x: 40, y: 62 }, label: { x: 19, y: 58 }, side: "left" },
      { id: "safety_gloves", anchor: { x: 70, y: 55 }, label: { x: 78, y: 70 }, side: "right" }
    ]
  },
  {
    id: "safety_helmet",
    modules: ["fire-response", "gas-leak"],
    // awaiting a real photograph. data and locale strings stay, the card does not show.
    status: STATUS_PENDING_ARTWORK,
    art: "safetyHelmet",
    components: [
      { id: "outer_shell", anchor: { x: 50, y: 30 }, label: { x: 20, y: 16 }, side: "left" },
      { id: "brim", anchor: { x: 74, y: 58 }, label: { x: 78, y: 40 }, side: "right" },
      { id: "suspension_harness", anchor: { x: 50, y: 52 }, label: { x: 19, y: 62 }, side: "left" },
      { id: "chin_strap", anchor: { x: 58, y: 70 }, label: { x: 76, y: 74 }, side: "right" }
    ]
  },
  {
    id: "safety_shoes",
    modules: ["fire-response"],
    // awaiting a real photograph. data and locale strings stay, the card does not show.
    status: STATUS_PENDING_ARTWORK,
    art: "safetyShoes",
    components: [
      { id: "ankle_collar", anchor: { x: 38, y: 30 }, label: { x: 18, y: 16 }, side: "left" },
      { id: "steel_toe_cap", anchor: { x: 76, y: 62 }, label: { x: 78, y: 40 }, side: "right" },
      { id: "penetration_resistant_midsole", anchor: { x: 55, y: 74 }, label: { x: 17, y: 58 }, side: "left" },
      { id: "anti_slip_sole", anchor: { x: 50, y: 84 }, label: { x: 74, y: 80 }, side: "right" }
    ]
  },
  {
    id: "multi_gas_detector",
    modules: ["gas-leak"],
    status: STATUS_ACTIVE,
    image: GAS_PHOTOS.detector.image,
    mask: GAS_PHOTOS.detector.mask,
    size: GAS_PHOTOS.detector.size,
    art: "multiGasDetector",
    // Anchors and crops were read off the photograph's own pixels on a percentage
    // grid, the same way the extinguisher's were, and every anchor is checked by the
    // tests to land on the device rather than in the gutter.
    //
    // There is no belt_clip here even though the catalog used to name one: the render
    // shows the device from the front and the clip is on the back. Inventing a plate
    // for a part no supplied image shows is how a trainee learns the wrong object.
    components: [
      {
        id: "display_screen",
        anchor: { x: 51.3, y: 46.7 }, label: { x: 1, y: 24 }, side: "left",
        part: { ...GAS_PHOTOS.detector, crop: { x: 33, y: 15, w: 40, h: 51 }, explode: { x: 16, y: 27 } }
      },
      {
        id: "sensor_intake",
        anchor: { x: 52, y: 22.9 }, label: { x: 99, y: 16 }, side: "right",
        part: { ...GAS_PHOTOS.detector, crop: { x: 39, y: 4, w: 28, h: 10 }, explode: { x: 84, y: 27 } }
      },
      {
        id: "alarm_indicator",
        anchor: { x: 37.5, y: 23.6 }, label: { x: 1, y: 60 }, side: "left",
        part: { ...GAS_PHOTOS.detector, crop: { x: 25, y: 4.5, w: 12, h: 10 }, explode: { x: 16, y: 73 } }
      },
      {
        id: "control_buttons",
        anchor: { x: 51.3, y: 65.8 }, label: { x: 99, y: 70 }, side: "right",
        part: { ...GAS_PHOTOS.detector, crop: { x: 34, y: 67, w: 37, h: 17 }, explode: { x: 84, y: 73 } }
      }
    ]
  },
  {
    id: "scba",
    modules: ["gas-leak"],
    status: STATUS_ACTIVE,
    image: GAS_PHOTOS.scba.image,
    mask: GAS_PHOTOS.scba.mask,
    size: GAS_PHOTOS.scba.size,
    art: "scba",
    // one photograph of one set: mask, demand valve, cylinder and cylinder valve are
    // all cropped out of the same shot, so nothing here is a different product
    components: [
      {
        id: "face_mask",
        anchor: { x: 49.3, y: 31.5 }, label: { x: 99, y: 14 }, side: "right",
        part: { ...GAS_PHOTOS.scba, crop: { x: 36, y: 4, w: 28, h: 30 }, explode: { x: 84, y: 27 } }
      },
      {
        id: "pressure_regulator",
        anchor: { x: 49.3, y: 38.1 }, label: { x: 1, y: 30 }, side: "left",
        part: { ...GAS_PHOTOS.scba, crop: { x: 41, y: 27, w: 20, h: 14 }, explode: { x: 16, y: 27 } }
      },
      {
        id: "air_cylinder",
        anchor: { x: 49.3, y: 56.6 }, label: { x: 99, y: 58 }, side: "right",
        part: { ...GAS_PHOTOS.scba, crop: { x: 38, y: 38, w: 24, h: 50 }, explode: { x: 84, y: 73 } }
      },
      {
        id: "cylinder_valve",
        anchor: { x: 50, y: 76.4 }, label: { x: 1, y: 84 }, side: "left",
        part: { ...GAS_PHOTOS.scba, crop: { x: 42, y: 84, w: 17, h: 13 }, explode: { x: 16, y: 73 } }
      }
    ]
  },
  {
    id: "safety_harness",
    modules: ["gas-leak"],
    status: STATUS_ACTIVE,
    image: GAS_PHOTOS.harness.image,
    mask: GAS_PHOTOS.harness.mask,
    size: GAS_PHOTOS.harness.size,
    art: "safetyHarness",
    // The supplied photograph is the kit as it is sold: the full-body harness on the
    // left and the shock-absorbing lifeline beside it. That is why three of the four
    // callouts sit on the left and the lifeline's on the right — it is where the parts
    // actually are, not a layout choice.
    components: [
      {
        id: "dorsal_d_ring",
        anchor: { x: 33.5, y: 31.5 }, label: { x: 1, y: 16 }, side: "left",
        part: { ...GAS_PHOTOS.harness, crop: { x: 15, y: 17, w: 21, h: 12 }, explode: { x: 16, y: 27 } }
      },
      {
        id: "chest_strap",
        anchor: { x: 36.8, y: 35.5 }, label: { x: 1, y: 34 }, side: "left",
        part: { ...GAS_PHOTOS.harness, crop: { x: 18, y: 24, w: 26, h: 10 }, explode: { x: 84, y: 27 } }
      },
      {
        id: "leg_straps",
        anchor: { x: 38.1, y: 76.4 }, label: { x: 1, y: 84 }, side: "left",
        part: { ...GAS_PHOTOS.harness, crop: { x: 2, y: 69, w: 46, h: 27 }, explode: { x: 16, y: 73 } }
      },
      {
        id: "lifeline",
        anchor: { x: 73.8, y: 64.5 }, label: { x: 99, y: 60 }, side: "right",
        part: { ...GAS_PHOTOS.harness, crop: { x: 74, y: 56, w: 25, h: 34 }, explode: { x: 84, y: 73 } }
      }
    ]
  }
];

// the items a worker actually meets today. everything the UI shows and everything
// the gate counts comes from here, never from the full catalog.
const ACTIVE_EQUIPMENT = EQUIPMENT_CATALOG.filter((item) => item.status === STATUS_ACTIVE);

// every id a worker must open before every module unlocks
const REQUIRED_EQUIPMENT_IDS = ACTIVE_EQUIPMENT.map((item) => item.id);

// the training modules that have equipment to read today, in catalog order
const MODULE_IDS = [...new Set(ACTIVE_EQUIPMENT.flatMap((item) => item.modules))];

// look one item up by id, active or not
function getEquipmentById(equipmentId) {
  return EQUIPMENT_CATALOG.find((item) => item.id === equipmentId) || null;
}

// true when this item has artwork and is part of the live flow
function isEquipmentActive(equipmentId) {
  const item = getEquipmentById(equipmentId);
  return Boolean(item && item.status === STATUS_ACTIVE);
}

// list the equipment a given training module actually teaches today
function getEquipmentForModule(moduleId) {
  return ACTIVE_EQUIPMENT.filter((item) => item.modules.includes(moduleId));
}

// The equipment one module gates on. A worker heading into the gas leak module has
// to have been shown the detector, the breathing set and the harness; they do not
// have to have read the fire extinguisher first, and someone heading into the fire
// module does not have to read the gas kit.
//
// An unrecognised module id gets the whole active set, which is the strictest answer
// there is — a typo in a module name must not open a door.
function requiredEquipmentForModule(moduleId) {
  if (!moduleId || typeof moduleId !== "string") return REQUIRED_EQUIPMENT_IDS;
  const forModule = getEquipmentForModule(moduleId).map((item) => item.id);
  return forModule.length > 0 ? forModule : REQUIRED_EQUIPMENT_IDS;
}

// where a photograph sits inside the stage, as css percentages
function imageInsetPercent() {
  return { inset: IMAGE_INSET, span: IMAGE_SPAN };
}

// every distinct image file the catalog references, masks included, for precache
// checks. a photograph without its mask on the phone would come back as a white
// rectangle underground, so the two travel together.
function allEquipmentImages() {
  const images = new Set();
  const add = (source) => {
    if (!source) return;
    if (source.image) images.add(source.image);
    if (source.mask) images.add(source.mask);
  };

  EQUIPMENT_CATALOG.forEach((item) => {
    add(item);
    item.components.forEach((component) => add(component.part));
  });
  return [...images];
}

// where the leader line stops: the inner edge of the label box on that side
function leaderEndX(side) {
  return side === "left" ? CALLOUT_GUTTER : 100 - CALLOUT_GUTTER;
}

// Exploded-view arrows: where a part came from, to where it came to rest.
//
// Nothing here is placed by hand. The start is the component's own anchor — the
// point measured on the photograph — carried through the same scale the body is
// shrunk by when the unit comes apart, so it lands on the part's original place on
// the shrunken body. The end is the inner edge of the component's photograph inside
// its plate, at the frame's mid-height, so the arrowhead stops just short of the
// part and never runs under it or under the name below it. Both come out in the
// 0-100 stage space the plates and the body already share, so the arrows move with
// the layout at every phone width instead of being right at one.
//
// Optional per-part routing, for where a straight run would read badly. None of it
// moves the origin or the tip — only the path between them:
//   exit   the heading, in degrees (0 = right, 90 = down), the line leaves its part
//          on. Where several parts sit close together on the valve head, each one
//          leaves on its own heading so the four lines fan apart at once instead of
//          looking like one bundle. Headings were picked from the silhouette mask:
//          each is the direction that gets the line off the body soonest.
//   lead   how far the line holds that heading before turning for its plate
//   arrive the heading the line comes into its plate on, when the turn toward the
//          plate would otherwise make it arrive at an awkward angle
//   reach  how straight the line runs into the arrowhead
//   gap    how far from the origin dot the line begins
// Without routing the line is straight. Either way the path is one cubic curve.
const ARROW_START_GAP = 1.3;
const ARROW_END_GAP = 1.6;
const ARROW_HEAD = { length: 1.7, spread: 0.5 };

function _round(value) {
  return +value.toFixed(2);
}

function _unit(x, y) {
  const length = Math.sqrt(x * x + y * y) || 1;
  return { x: x / length, y: y / length };
}

function explodeArrow(component, bodyScale = EXPLODED_BODY_SCALE) {
  const part = component && component.part;
  if (!part || !part.explode || !component.anchor) return null;
  const route = component.arrow || {};

  // the anchor, on the body once it has stepped back around the stage centre
  const origin = {
    x: 50 + (component.anchor.x - 50) * bodyScale,
    y: 50 + (component.anchor.y - 50) * bodyScale
  };

  // the photograph's inner edge inside the plate, at the frame's mid-height
  const fit = fitInFrame(partAspect(part), partFrameAspect());
  const halfWidth = (PART_PLATE.width * fit.w) / 200;
  const inward = part.explode.x > 50 ? -1 : 1;
  const plateTop = part.explode.y - PART_PLATE.height / 2;
  const tip = {
    x: part.explode.x + inward * (halfWidth + ARROW_END_GAP),
    y: plateTop + PART_PLATE.frameHeight / 2
  };

  const chord = _unit(tip.x - origin.x, tip.y - origin.y);
  const exit = typeof route.exit === "number"
    ? { x: Math.cos((route.exit * Math.PI) / 180), y: Math.sin((route.exit * Math.PI) / 180) }
    : chord;

  const gap = typeof route.gap === "number" ? route.gap : ARROW_START_GAP;
  const start = { x: origin.x + exit.x * gap, y: origin.y + exit.y * gap };
  const span = Math.hypot(tip.x - start.x, tip.y - start.y);

  // a straight arrow keeps its controls on the chord, a third of the way from each end
  const lead = typeof route.lead === "number" ? route.lead : span / 3;
  const c1 = { x: start.x + exit.x * lead, y: start.y + exit.y * lead };
  const arrive = typeof route.arrive === "number"
    ? { x: Math.cos((route.arrive * Math.PI) / 180), y: Math.sin((route.arrive * Math.PI) / 180) }
    : _unit(tip.x - c1.x, tip.y - c1.y);
  const reach = typeof route.reach === "number" ? route.reach : span / 3;
  const c2 = { x: tip.x - arrive.x * reach, y: tip.y - arrive.y * reach };

  // the head follows the direction the line arrives in
  const into = _unit(tip.x - c2.x, tip.y - c2.y);
  const bx = into.x * ARROW_HEAD.length;
  const by = into.y * ARROW_HEAD.length;
  const cos = Math.cos(ARROW_HEAD.spread);
  const sin = Math.sin(ARROW_HEAD.spread);
  const wing = (sign) => ({
    x: tip.x - (bx * cos - sign * by * sin),
    y: tip.y - (sign * bx * sin + by * cos)
  });

  const point = (p) => ({ x: _round(p.x), y: _round(p.y) });
  return {
    origin: point(origin),
    start: point(start),
    c1: point(c1),
    c2: point(c2),
    tip: point(tip),
    head: [point(wing(1)), point(tip), point(wing(-1))]
  };
}

// a point along the arrow, t from 0 at the start to 1 at the tip
function arrowPointAt(arrow, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * arrow.start.x + b * arrow.c1.x + c * arrow.c2.x + d * arrow.tip.x,
    y: a * arrow.start.y + b * arrow.c1.y + c * arrow.c2.y + d * arrow.tip.y
  };
}

// the real width-to-height ratio of the region `crop` frames out of its photograph
function partAspect(part) {
  if (!part || !part.crop || !part.size) return 1;
  return (part.crop.w * part.size.w) / (part.crop.h * part.size.h);
}

// the largest box of that shape that fits the frame, as percentages of the frame.
// this is what keeps a 2.2:1 lever from being squashed into a 1.4:1 window.
function fitInFrame(aspect, frameAspect) {
  if (!(aspect > 0) || !(frameAspect > 0)) return { w: 100, h: 100 };
  if (aspect >= frameAspect) {
    return { w: 100, h: +((frameAspect / aspect) * 100).toFixed(2) };
  }
  return { w: +((aspect / frameAspect) * 100).toFixed(2), h: 100 };
}

// the frame's own ratio, which falls out of the plate geometry on a square stage
function partFrameAspect() {
  return PART_PLATE.width / PART_PLATE.frameHeight;
}

// the components of one item that have a close-up photograph to explode out
function explodableComponents(equipmentId) {
  const item = getEquipmentById(equipmentId);
  if (!item) return [];
  return item.components.filter((component) => component.part && component.part.image);
}

// turn a point measured on the photograph itself into a stage coordinate.
// kept here so a future item's anchors can be measured the same way.
function imagePointToStage(imageX, imageY) {
  return {
    x: IMAGE_INSET + (imageX / 100) * IMAGE_SPAN,
    y: IMAGE_INSET + (imageY / 100) * IMAGE_SPAN
  };
}

// locale key for an equipment name
function equipmentNameKey(equipmentId) {
  return `equipment.${equipmentId}.name`;
}

// locale key for the one-line purpose shown on the card
function equipmentPurposeKey(equipmentId) {
  return `equipment.${equipmentId}.purpose`;
}

// locale key for a component callout label
function componentLabelKey(equipmentId, componentId) {
  return `equipment.${equipmentId}.components.${componentId}.label`;
}

// locale key for the short component explanation
function componentDescKey(equipmentId, componentId) {
  return `equipment.${equipmentId}.components.${componentId}.desc`;
}

// every locale key this feature introduces, for the translation coverage test
function allEquipmentLocaleKeys() {
  const keys = [];
  EQUIPMENT_CATALOG.forEach((item) => {
    keys.push(equipmentNameKey(item.id));
    keys.push(equipmentPurposeKey(item.id));
    item.components.forEach((component) => {
      keys.push(componentLabelKey(item.id, component.id));
      keys.push(componentDescKey(item.id, component.id));
    });
  });
  return keys;
}

export {
  ART_VIEWBOX,
  STATUS_ACTIVE,
  STATUS_PENDING_ARTWORK,
  IMAGE_INSET,
  IMAGE_SPAN,
  EXPLODED_BODY_SCALE,
  CALLOUT_GUTTER,
  GAS_PHOTOS,
  PART_PLATE,
  PHOTOS,
  VALVE_KIT,
  EQUIPMENT_CATALOG,
  ACTIVE_EQUIPMENT,
  REQUIRED_EQUIPMENT_IDS,
  MODULE_IDS,
  getEquipmentById,
  isEquipmentActive,
  getEquipmentForModule,
  requiredEquipmentForModule,
  imageInsetPercent,
  imagePointToStage,
  allEquipmentImages,
  explodableComponents,
  leaderEndX,
  explodeArrow,
  arrowPointAt,
  partAspect,
  partFrameAspect,
  fitInFrame,
  equipmentNameKey,
  equipmentPurposeKey,
  componentLabelKey,
  componentDescKey,
  allEquipmentLocaleKeys
};
