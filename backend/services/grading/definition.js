const { GRADING_ERRORS, GradingError } = require("./errors");

// json columns are text in sqlite. a broken one is a server config bug, say so loudly.
function _parseJsonColumn(raw, column, checkpointId) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new GradingError(
      GRADING_ERRORS.DEFINITION_INVALID,
      `checkpoint_definition.${column} for "${checkpointId}" is not valid json`,
      checkpointId
    );
  }
}

// null stays null, everything else has to be a real finite number
function _number(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

// turn one snake_case checkpoint_definition row into the shape graders read
function parseDefinition(row) {
  if (!row) {
    throw new GradingError(GRADING_ERRORS.DEFINITION_INVALID, "no checkpoint definition given");
  }

  const checkpointId = row.checkpoint_id;
  const allowedValues = _parseJsonColumn(row.allowed_values, "allowed_values", checkpointId);
  const forbiddenValues = _parseJsonColumn(row.forbidden_values, "forbidden_values", checkpointId);
  const trackingSources = _parseJsonColumn(
    row.allowed_tracking_sources,
    "allowed_tracking_sources",
    checkpointId
  );

  return {
    moduleId: row.module_id,
    checkpointId,
    checkpointType: row.checkpoint_type,
    observationKind: row.observation_kind,
    appliesToTier: row.applies_to_tier === null || row.applies_to_tier === undefined
      ? null
      : Number(row.applies_to_tier),

    expectedValue: _parseJsonColumn(row.expected_value, "expected_value", checkpointId),
    allowedValues: Array.isArray(allowedValues) ? allowedValues : null,
    forbiddenValues: Array.isArray(forbiddenValues) ? forbiddenValues : [],
    allowedTrackingSources: Array.isArray(trackingSources) ? trackingSources : null,

    anchorId: row.anchor_id === undefined ? null : row.anchor_id,
    maxAngularErrorRad: _number(row.max_angular_error_rad),

    maxDistanceM: _number(row.max_distance_m),
    passThreshold: _number(row.pass_threshold),
    minSweepCoverage: _number(row.min_sweep_coverage),

    minDwellMs: _number(row.min_dwell_ms),
    minFrameCount: _number(row.min_frame_count),

    gradeable: row.gradeable === 1 || row.gradeable === true,
    weight: _number(row.weight) === null ? 1 : _number(row.weight),
    required: row.required === 1 || row.required === true,
    critical: row.critical === 1 || row.critical === true
  };
}

module.exports = { parseDefinition };
