# Image Credits & Licensing — Equipment Familiarization

Photographs used in the prerequisite equipment screens. All were supplied by the
SafeAR team for development, from `2d images/` at the repository root.

Most are copied here **byte-identical** — nothing cropped, edited or re-encoded — and
where only part of one is shown, it is framed by CSS at render time rather than by
cutting a new file. **Two are derived**: the gas detector render (5.4 MB, four views)
and the harness (2560 × 2560) were far larger than anything drawn from them, and a
mine phone precaches every asset to work underground. Each file below says which it
is. The originals in `2d images/` are never modified.

---

## ⚠️ Licensing status: UNVERIFIED for every photograph below

**None of these assets is cleared for public release.** They were supplied for local
development and their origin has not been confirmed. Several carry visible
third-party branding, so they may well be product photographs belonging to someone
else.

**Before this repository is made public or submitted**, for each file either:

1. confirm the source and license and replace the TODO lines with real values — the
   way `frontend/assets/models/gas-leak/CREDITS.md` records its CC0 asset; or
2. replace the file with a CC0 / public-domain equivalent of the same subject.

Swapping any file touches one entry in `PHOTOS` or `GAS_PHOTOS` in
`frontend/prerequisite/equipment-data.js`. A replacement with different framing also
needs its `crop` and its callout `anchor` values re-measured, and its mask rebuilt —
see below. Every anchor is checked by the tests to land on the equipment rather than
in empty background.

---

## The `.mask.png` files are derived, not supplied

Every photograph was shot on a plain backdrop — white paper for everything except the
gas detector render, which is on black. The UI puts the equipment on the app's own
dark background with no plate or card behind it, so the backdrop must not be painted.

Rather than editing the photographs — re-encoding a jpeg to punch an alpha channel
into it would throw image quality away, and the originals would no longer match what
was supplied — each photograph has a **mask** beside it: a png whose alpha channel is
the object's silhouette and whose colour channels are empty. CSS masks the photograph
with it.

`make-background-masks.ps1` in this folder derives and masks all eight from the
supplied originals, deterministically — run it twice and the files are byte-identical:

1. flood-fill the near-white paper inward from the border, so white *inside* the
   object (the extinguisher's printed label, the gauge dial) survives;
2. cut the enclosed holes that are large enough to be real holes — the gap inside the
   hose loop, the bore of the O-ring, the gaps between the harness straps — while
   leaving the small enclosed white patches alone, because those are specular
   highlights on chrome and punching them out would put pin-holes through the metal.
   This step is **off** for the detector, whose backdrop is black: the biggest
   enclosed dark region in that render is the device's own screen;
3. erode one pixel, which takes off the pale jpeg fringe that rings every edge;
4. blur, which gives the cut edge its antialiasing back.

A mask carries no image content of its own. Its licensing follows the photograph it
was derived from, so a replaced photograph needs a rebuilt mask.

---

### `fire-extinguisher.jpeg` + `fire-extinguisher.mask.png` — assembled unit

- **Shows**: complete ABC dry powder extinguisher — cylinder, handle/lever, valve
  block, safety pin, hose, nozzle. Visible branding: "UltraFire", "POWDER".
- **554 × 554**, JPEG, opaque, 31 KB. Background measured as effectively pure white
  (corners `255,255,255`; darkest background pixel 250/255). Mask 12 KB, object
  occupies 24.8% of the frame, one hole cut (the gap enclosed by the hose loop).
- **Used for**: the card thumbnail and the assembled view, with six callouts whose
  anchors were measured against this file's pixels.
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/fireextinguisher.jpeg`

### `fire-extinguisher-valve-kit.jpg` + mask — stripped valve assembly

- **Shows**: a valve assembly laid out in pieces on white — black handle/lever,
  chrome threaded valve block, pressure gauge, O-ring, plastic adapter and a safety
  pin. Three components are framed out of this one file.
- **1000 × 1000**, JPEG, opaque, 39 KB. Background 0.7% off-white. Mask 30 KB, object
  22.1%, two holes cut (the O-ring bore and the pin ring's bore).
- **Used for**: Handle / Lever, Valve Block, Pressure Gauge close-ups.
- **Note**: this valve is **black**, while the assembled unit's is red. Different
  product, same component type. See "Known limitations".
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/valve.jpg`

### `fire-extinguisher-safety-pin.jpeg` + mask — safety pin

- **Shows**: a safety pin with its pull ring, isolated on white.
- **1172 × 1172**, JPEG, opaque, 36 KB. Background 0.3% off-white — the cleanest of
  the set. Mask 20 KB, object 7.1%, one hole cut (inside the ring).
- **Used for**: the Safety Pin close-up.
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/safteypin.jpeg`

### `fire-extinguisher-hose.jpg` + mask — discharge hose

- **Shows**: a black discharge hose with a chrome fitting at one end and a blue horn
  at the other.
- **428 × 500**, JPEG, opaque, 14 KB. Background 0.5% off-white. Mask 6 KB, object
  10.4%, no holes.
- **Used for**: the Hose close-up.
- **Note**: the horn on this hose is **blue**; the assembled unit's is black.
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/hose.jpg`

### `fire-extinguisher-nozzle.jpg` + mask — discharge nozzle

- **Shows**: a black conical discharge horn, isolated on white.
- **500 × 500**, JPEG, opaque, 9 KB. Background 0.8% off-white. Mask 6 KB, object
  16.0%, no holes.
- **Used for**: the Nozzle close-up.
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/nozzle.jpg`

---

## Gas Leak / Confined Space

Each of these is **one photograph carrying both the assembled view and every
component cropped out of it**, so a close-up is never a different unit than the one
the worker was just looking at. That is the main thing the fire extinguisher set
could not do.

### `gas-detector.jpg` + mask — Multi-Gas Detector

- **Shows**: a rugged handheld multi-gas detector — sensor grille, alarm vents,
  colour display reading O₂ / CO / LEL / CH₄, and a four-button keypad. Branded
  "SafeAR", screen reads "JHARKHAND MINE".
- **990 × 990**, JPEG q92, 134 KB. Mask 21 KB, object 67.6% of the frame.
- **Derived, not copied.** The supplied file is `mutligas detector.png`,
  **3680 × 1120 and 5.4 MB**, holding four views of the device on black. A mine
  phone precaches every asset to work underground, so shipping 5.4 MB for something
  drawn 225 css px wide is not defensible. The hero view is cropped **square** around
  the device (the stage draws into a square box, and a letterboxed source would put
  every callout off the part it points at) and saved as JPEG. The original is
  untouched.
- **Backdrop**: black, not white — so the mask flood-fills near-black, and hole
  cutting is switched off for it. The biggest enclosed dark region in this render is
  the screen itself; cutting enclosed regions here punched the device full of holes.
- **Used for**: the card, the assembled view, and all four components.
- **This is the team's own render, not a photograph of a real product.** It is the
  only asset here whose provenance is not in doubt — but it is also the only one that
  is not a real object, so what a worker recognises on the wall may differ.
- **Source / Author / License**: ⚠️ TODO — CONFIRM this is the team's own work
- **Original**: `2d images/mutligas detector.png`

### `gas-scba.png` + mask — SCBA / Breathing Apparatus

- **Shows**: a complete self-contained breathing apparatus — full-face mask, red
  demand valve, composite air cylinder, backplate and waist harness, pressure gauge
  on the left strap, cylinder valve at the foot. Visible branding: "VENUS".
- **700 × 700**, PNG, opaque, 206 KB, copied byte-identical. Mask 26 KB, object
  20.9%, five holes cut (the gaps between the straps and the cylinder).
- **Used for**: the card, the assembled view, and all four components.
- **Note**: at 700 px the tighter crops — the demand valve and the cylinder valve —
  are soft on a high-density screen. A larger photograph of this same set would fix
  it. See "Known limitations".
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/breathe.png`

### `gas-harness.jpg` + mask — Safety Harness & Lifeline

- **Shows**: a full-body harness — blue shoulder straps, dorsal attachment plate,
  chest strap and buckle, side D-rings, padded waist belt, leg loops — laid out
  beside its shock-absorbing lifeline: screw-gate carabiner, energy absorber pack,
  kernmantle rope and two steel scaffold hooks.
- **1400 × 1400**, JPEG q82, 311 KB. Mask 120 KB (the silhouette is genuinely
  complicated), object 39.6%, fifteen holes cut — the gaps between every strap and
  inside both rope loops.
- **Derived, not copied.** The supplied file is 2560 × 2560 and 714 KB. Scaled to
  1400, which still leaves the smallest crop — the dorsal plate, 21% of the width —
  above the pixels a 375 px phone draws it at. The original is untouched.
- **Used for**: the card, the assembled view, and all four components.
- **Source / Author / License**: ⚠️ TODO — UNVERIFIED
- **Original**: `2d images/haarness.jpg`

---

## Supplied but NOT used

### `2d images/cyllinder.png`

1000 × 1000 RGBA with a real alpha channel — technically the best-prepared asset
supplied, and the only one that arrived with transparency. It is **not used** because
it is a different class of device: an *automatic* engine-compartment unit
("Automatic Fire Extinguisher 5KG HFC227EA — ENGINE COMPARTMENT") with a sprinkler
head, no lever, no hose and no safety pin. Presenting it as the body of a hand-held
extinguisher would teach the wrong object. Metadata: Adobe ImageReady / Photoshop.

Worth keeping — if a *hand-held* cylinder is ever shot the same way, that is exactly
the asset this feature wants.

### `2d images/valve2.jpeg`

554 × 554. A **red** assembled valve head (branded SAFEQUIP) with gauge and pin in
place — its colour matches the assembled unit better than `valve.jpg` does. Not used
because its parts overlap each other, so no single component can be framed out
cleanly, and it is half the resolution of `valve.jpg`. A good candidate if colour
consistency is later judged more important than component isolation.

### `2d images/hellmet.jpeg`

1024 × 1024. A yellow hard hat in side view, SafeAR-branded, on white — shell with
crown ribs, front peak, and the rear of the suspension cradle showing below the rim.
Clean background; it masks well.

**Not used**, because the safety helmet was taken back out of the prerequisite set.
The set is the extinguisher for fire and three items for gas, and nothing else. The
catalog keeps `safety_helmet` as `pending_artwork` with its data and locale strings,
so if it is ever wanted again the work is a photo entry and a status flip.

Worth noting for whoever does that: this is the one supplied photograph whose parts
are **not physically separate**. Everything else was shot as separable pieces, so a
rectangular crop lands on background and the part comes away clean. A hard hat is a
single moulded shell, so every crop leaves a cut edge somewhere, and there is no chin
strap in this photograph at all.

### `2d images/safteyappartus.jpeg`

1024 × 312. Three views of an SCBA — face mask, front, back — branded "SafeAR", so
this one is a rebrand of the same product `breathe.png` shows. Its face-mask view is
larger and cleaner than the mask cropped out of `breathe.png`.

**Not used** because mixing it in would put a SafeAR-branded close-up next to a
VENUS-branded assembled unit, which is exactly the cross-product inconsistency the
fire extinguisher set is criticised for below. Using one photograph for everything was
judged worth the lower resolution. Worth revisiting if a SafeAR-branded *assembled*
view turns up.

### `2d images/fire ext parts.webp`

436 × 446, lossy VP8, no alpha. A supplier parts collage: nine components in a grid,
each with a **text label printed into the image**, plus a title bar. Individual parts
measure only 75×77 to 106×87 px, which is visibly blurry at the size the UI needs,
and the labels cannot be separated from the parts. Reference photograph only.

---

## Known limitations

- **The component close-ups are not all from the same extinguisher.** The valve kit
  is black where the assembled unit is red; the hose horn is blue where the assembled
  unit's is black. Each photograph correctly shows the *type* of component named, but
  they are not the parts off this particular cylinder, and the exploded view does not
  claim they are.
- **The lever's frame contains the pressure gauge.** In the valve-kit photograph the
  gauge is lying loose in the gap between the lever's two arms, so no rectangular crop
  of the whole lever can exclude it. The alternative — cutting the lever short — read
  as a cropping accident, so the whole part is shown. A photograph of the lever on its
  own would remove this.
- **There is no photograph of the cylinder body on its own** for this hand-held unit,
  so the assembled photo stays in the middle of the exploded view rather than being
  replaced by a body-only image. It is the reference the six parts came off.
- **`ppe_kit`, `safety_shoes` and `safety_helmet` are `pending_artwork`.** None is shown and
  none gates a module. All keep their data and locale strings and go live the moment
  a photograph lands and the status flips.
- **The SCBA's tighter crops are soft.** 700 px is enough for the mask and the
  cylinder, marginal for the demand valve and the cylinder valve.
- **Masking is a progressive enhancement.** A browser without CSS masks renders the
  photographs whole, white background and all — the old look, not a broken one. Every
  Chromium-based Android WebView supports it.
