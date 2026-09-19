const { GRADING_ERRORS, GradingError } = require("./errors");

// a distance ray cannot be four times longer than the target zone and still be a hit
const IMPLAUSIBLE_DISTANCE_FACTOR = 4;

// squeeze any number into the 0..1 a checkpoint score has to live in
function _clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// only the tracking sources the team approved may ever reach a certificate
function _assertTrackingSource(observation, definition) {
  if (!Array.isArray(definition.allowedTrackingSources)) {
    return;
  }
  if (!definition.allowedTrackingSources.includes(observation.trackingSource)) {
    throw new GradingError(
      GRADING_ERRORS.TRACKING_SOURCE_NOT_ALLOWED,
      `checkpoint "${definition.checkpointId}" does not certify from tracking source "${observation.trackingSource}"`,
      definition.checkpointId
    );
  }
}

// a frame count below the floor means the dwell was never really held
function _assertFrameCount(observation, definition) {
  if (definition.minFrameCount === null) {
    return;
  }
  if (observation.frameCount < definition.minFrameCount) {
    throw new GradingError(
      GRADING_ERRORS.IMPLAUSIBLE_OBSERVATION,
      `checkpoint "${definition.checkpointId}" reported a dwell over ${observation.frameCount} frames, floor is ${definition.minFrameCount}`,
      definition.checkpointId
    );
  }
}

// did the device hold its aim on an anchored object long enough
function gradeSpatialAlignment(observation, definition) {
  if (definition.anchorId !== null && observation.anchorId !== definition.anchorId) {
    throw new GradingError(
      GRADING_ERRORS.ANCHOR_MISMATCH,
      `checkpoint "${definition.checkpointId}" anchors on "${definition.anchorId}", payload says "${observation.anchorId}"`,
      definition.checkpointId
    );
  }

  _assertTrackingSource(observation, definition);
  _assertFrameCount(observation, definition);

  if (!definition.gradeable) {
    return { score: 0, passed: false, reason: "not_gradeable", gradeable: false };
  }

  // nobody has measured this angle on a real device yet. score zero, never guess a pass.
  if (definition.maxAngularErrorRad === null || definition.maxAngularErrorRad <= 0) {
    return { score: 0, passed: false, reason: "threshold_unconfigured", gradeable: false };
  }

  if (definition.minDwellMs !== null && observation.dwellMs < definition.minDwellMs) {
    return { score: 0, passed: false, reason: "dwell_too_short", gradeable: true };
  }

  const score = _clamp01(1 - observation.angularErrorRad / definition.maxAngularErrorRad);
  const passed = observation.angularErrorRad <= definition.maxAngularErrorRad;

  return {
    score: Math.round(score * 1e6) / 1e6,
    passed,
    reason: passed ? "aligned" : "misaligned",
    gradeable: true
  };
}

// how close to the base of the fire did the ray land, and was it held there
function gradeAimDwell(observation, definition) {
  _assertTrackingSource(observation, definition);
  _assertFrameCount(observation, definition);

  if (!definition.gradeable) {
    return { score: 0, passed: false, reason: "not_gradeable", gradeable: false };
  }

  if (definition.maxDistanceM === null || definition.maxDistanceM <= 0 || definition.passThreshold === null) {
    return { score: 0, passed: false, reason: "threshold_unconfigured", gradeable: false };
  }

  // a button fallback produces no distance, so it lands here and scores zero
  if (observation.hitDistanceM === null) {
    return { score: 0, passed: false, reason: "no_aim_sample", gradeable: true };
  }

  if (observation.hitDistanceM > definition.maxDistanceM * IMPLAUSIBLE_DISTANCE_FACTOR) {
    throw new GradingError(
      GRADING_ERRORS.IMPLAUSIBLE_OBSERVATION,
      `checkpoint "${definition.checkpointId}" reported a hit ${observation.hitDistanceM}m from a target ${definition.maxDistanceM}m wide`,
      definition.checkpointId
    );
  }

  if (definition.minDwellMs !== null && observation.dwellMs < definition.minDwellMs) {
    return { score: 0, passed: false, reason: "dwell_too_short", gradeable: true };
  }

  const score = _clamp01(1 - observation.hitDistanceM / definition.maxDistanceM);
  const rounded = Math.round(score * 1e6) / 1e6;

  // an incomplete sweep fails the checkpoint but keeps the score for the report
  if (definition.minSweepCoverage !== null) {
    const coverage = observation.sweepCoverage;
    if (coverage === null || coverage < definition.minSweepCoverage) {
      return { score: rounded, passed: false, reason: "sweep_incomplete", gradeable: true };
    }
  }

  const passed = rounded >= definition.passThreshold;
  return {
    score: rounded,
    passed,
    reason: passed ? "on_target" : "off_target",
    gradeable: true
  };
}

module.exports = { gradeSpatialAlignment, gradeAimDwell, IMPLAUSIBLE_DISTANCE_FACTOR };
