const { GRADING_ERRORS, GradingError } = require("./errors");

// squeeze any number into the 0..1 a checkpoint score has to live in
function _clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// an option the shipped ui cannot produce did not come from the shipped ui
function _assertInVocabulary(value, definition) {
  if (!Array.isArray(definition.allowedValues)) {
    return;
  }
  if (!definition.allowedValues.includes(value)) {
    throw new GradingError(
      GRADING_ERRORS.VOCABULARY_VIOLATION,
      `"${value}" is not an option of checkpoint "${definition.checkpointId}"`,
      definition.checkpointId
    );
  }
}

// one option out of a closed list, graded against the key the server holds
function gradeSelectionSingle(observation, definition) {
  _assertInVocabulary(observation.selected, definition);

  if (!definition.gradeable) {
    return { score: 0, passed: false, reason: "not_gradeable", gradeable: false };
  }

  if (typeof definition.expectedValue !== "string") {
    throw new GradingError(
      GRADING_ERRORS.DEFINITION_INVALID,
      `checkpoint "${definition.checkpointId}" is selection_single but has no string expected_value`,
      definition.checkpointId
    );
  }

  const passed = observation.selected === definition.expectedValue;
  return {
    score: passed ? 1 : 0,
    passed,
    reason: passed ? "correct" : "incorrect",
    gradeable: true
  };
}

// a set of options, scored the same way the module scores it on the phone.
// arithmetic here must stay in step with evaluatePpeSelection in gas-leak.js.
function gradeSelectionMulti(observation, definition) {
  const selected = observation.selected;

  const seen = new Set();
  selected.forEach((item) => {
    if (seen.has(item)) {
      throw new GradingError(
        GRADING_ERRORS.DUPLICATE_SELECTION,
        `checkpoint "${definition.checkpointId}" listed "${item}" twice`,
        definition.checkpointId
      );
    }
    seen.add(item);
    _assertInVocabulary(item, definition);
  });

  if (!definition.gradeable) {
    return { score: 0, passed: false, reason: "not_gradeable", gradeable: false, missing: [], forbidden: [] };
  }

  if (!Array.isArray(definition.expectedValue) || definition.expectedValue.length === 0) {
    throw new GradingError(
      GRADING_ERRORS.DEFINITION_INVALID,
      `checkpoint "${definition.checkpointId}" is selection_multi but has no expected_value array`,
      definition.checkpointId
    );
  }

  const mandatory = definition.expectedValue;
  const missing = mandatory.filter((item) => !selected.includes(item));
  const forbidden = definition.forbiddenValues.filter((item) => selected.includes(item));
  const correctCount = mandatory.filter((item) => selected.includes(item)).length;

  const rawScore = (correctCount - forbidden.length) / mandatory.length;
  const score = _clamp01(Math.round(rawScore * 100) / 100);
  const passed = missing.length === 0 && forbidden.length === 0;

  return {
    score,
    passed,
    reason: passed ? "correct" : "incomplete_or_unsafe_selection",
    gradeable: true,
    missing,
    forbidden
  };
}

module.exports = { gradeSelectionSingle, gradeSelectionMulti };
