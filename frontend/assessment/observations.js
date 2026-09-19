// Builders for SafeAR Attempt Contract v2.0 observations.
//
// The phone reports what it saw. It never reports a verdict, a score, a weight or
// an answer key — the server holds all of those and grades from these shapes alone.
// Every builder here mirrors a variant of observationSchema in
// backend/models/attempt.js, so a module cannot hand-roll a shape the server rejects.

// mirrors TRACKING_SOURCES in the backend contract
const TRACKING_SOURCES = ["webxr_pose", "arjs_marker", "device_orientation", "none"];

// the schema caps an angle at half a turn. we use that cap as the "nobody measured
// this" sentinel: it is the worst possible alignment, so it can never be mistaken
// for evidence that the trainee was looking at anything.
const UNMEASURED_ANGLE_RAD = Math.PI;

// a selection list longer than this is not a ui the team ships
const MAX_SELECTION_ITEMS = 32;

// tier 1 rides a webxr pose, tier 2 rides the printed marker. nothing else certifies.
function trackingSourceForTier(tier) {
  return Number(tier) === 1 ? "webxr_pose" : "arjs_marker";
}

// clamp into the range the schema allows, keep null as null
function _finite(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

// whole frames only, never negative
function _frames(value) {
  const n = _finite(value, { fallback: 0 });
  return Math.max(0, Math.round(n));
}

// one option out of a closed list
function selectionSingle(selected) {
  return { kind: "selection_single", selected: String(selected) };
}

// a set of options out of a closed list, order preserved, duplicates dropped
function selectionMulti(selectedList) {
  const list = Array.isArray(selectedList) ? selectedList : [];
  const seen = new Set();
  const selected = [];
  list.forEach((item) => {
    const value = String(item);
    if (!seen.has(value) && selected.length < MAX_SELECTION_ITEMS) {
      seen.add(value);
      selected.push(value);
    }
  });
  return { kind: "selection_multi", selected };
}

// a ray hit the target this far from its base. hitDistanceM stays null unless a
// real raycast produced it — a button press is not a measurement, and the server
// scores a null distance zero rather than guessing.
function aimDwell({ hitDistanceM, dwellMs, sweepCoverage, frameCount, trackingSource }) {
  return {
    kind: "aim_dwell",
    hitDistanceM: _finite(hitDistanceM, { min: 0, fallback: null }),
    dwellMs: _finite(dwellMs, { min: 0, fallback: 0 }),
    sweepCoverage: _finite(sweepCoverage, { min: 0, max: 1, fallback: null }),
    frameCount: _frames(frameCount),
    trackingSource: TRACKING_SOURCES.includes(trackingSource) ? trackingSource : "none"
  };
}

// device held its aim on an anchored object. pass angularErrorRad only when a real
// sampler produced it — leave it out and the builder reports the unmeasured
// sentinel with zero frames, which is what an unsampled step honestly looks like.
function spatialAlignment({ anchorId, angularErrorRad, dwellMs, frameCount, trackingSource }) {
  const measured = _finite(angularErrorRad, { min: 0, max: Math.PI, fallback: null });
  return {
    kind: "spatial_alignment",
    anchorId: String(anchorId),
    angularErrorRad: measured === null ? UNMEASURED_ANGLE_RAD : measured,
    dwellMs: _finite(dwellMs, { min: 0, fallback: 0 }),
    frameCount: _frames(frameCount),
    trackingSource: TRACKING_SOURCES.includes(trackingSource) ? trackingSource : "none"
  };
}

export {
  selectionSingle,
  selectionMulti,
  aimDwell,
  spatialAlignment,
  trackingSourceForTier,
  TRACKING_SOURCES,
  UNMEASURED_ANGLE_RAD,
  MAX_SELECTION_ITEMS
};
