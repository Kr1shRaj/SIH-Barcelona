// every way a raw observation can be refused before it is ever scored.
// these are payload problems, not bad performance — they answer 422, not zero.
const GRADING_ERRORS = Object.freeze({
  OBSERVATION_KIND_MISMATCH: "observation_kind_mismatch",
  VOCABULARY_VIOLATION: "vocabulary_violation",
  DUPLICATE_SELECTION: "duplicate_selection",
  IMPLAUSIBLE_OBSERVATION: "implausible_observation",
  TRACKING_SOURCE_NOT_ALLOWED: "tracking_source_not_allowed",
  ANCHOR_MISMATCH: "anchor_mismatch",
  DEFINITION_INVALID: "definition_invalid"
});

// refusing to grade is a normal outcome, not a crash, so it carries a code
class GradingError extends Error {
  constructor(code, message, checkpointId) {
    super(message);
    this.name = "GradingError";
    this.code = code;
    this.checkpointId = checkpointId || null;
  }
}

module.exports = { GRADING_ERRORS, GradingError };
