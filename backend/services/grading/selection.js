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

// what one wrong try cost. two slips or one fatal wipe the gate.
// critical grades exactly like fatal (team ruling), the ui only words it differently
const TRY_PENALTY = Object.freeze({ procedural: 0.5, fatal: 1, critical: 1 });
const FAILING_SEVERITIES = Object.freeze(["fatal", "critical"]);

// every pick on a fail-to-learn gate, in order. the ui block until the key is picked,
// so a sequence that repeats a pick or does not end on the key never came from it.
// score = 1 - penalties, passed = no fatal pick along the way.
function gradeSelectionSequence(observation, definition, { scenario } = {}) {
  const picks = observation.tries.map((attempt) => attempt.selected);
  picks.forEach((item) => _assertInVocabulary(item, definition));

  if (new Set(picks).size !== picks.length) {
    throw new GradingError(
      GRADING_ERRORS.DUPLICATE_SELECTION,
      `checkpoint "${definition.checkpointId}" picked the same option twice`,
      definition.checkpointId
    );
  }

  if (!definition.gradeable) {
    return { score: 0, passed: false, reason: "not_gradeable", gradeable: false, tryCount: picks.length, fatalCount: 0 };
  }

  // a key with "by" picks its case from the scenario; a key without one is the rule itself
  const key = definition.answerKey;
  let rule = null;
  if (key && key.by) {
    rule = key.cases && scenario ? key.cases[scenario[key.by]] : null;
  } else if (key) {
    rule = key;
  }
  const accepted = rule ? [].concat(rule.expected).filter((item) => typeof item === "string") : [];
  if (accepted.length === 0) {
    throw new GradingError(
      GRADING_ERRORS.DEFINITION_INVALID,
      `checkpoint "${definition.checkpointId}" has no answer key for this scenario`,
      definition.checkpointId
    );
  }

  // the ui ends the gate on the first right pick, so a right pick can only come last
  const wrong = picks.slice(0, -1);
  if (!accepted.includes(picks[picks.length - 1]) || wrong.some((item) => accepted.includes(item))) {
    throw new GradingError(
      GRADING_ERRORS.IMPLAUSIBLE_OBSERVATION,
      `checkpoint "${definition.checkpointId}" sequence does not end on its only correct option`,
      definition.checkpointId
    );
  }

  // an option the key forgot to rate costs the procedural price, never nothing
  const severity = rule.severity || {};
  const levelOf = (item) => (TRY_PENALTY[severity[item]] === undefined ? "procedural" : severity[item]);
  const fatalCount = wrong.filter((item) => FAILING_SEVERITIES.includes(levelOf(item))).length;
  const penalty = wrong.reduce((sum, item) => sum + TRY_PENALTY[levelOf(item)], 0);
  const score = _clamp01(Math.round((1 - penalty) * 100) / 100);

  let reason = "first_try";
  if (fatalCount > 0) reason = "fatal_then_corrected";
  else if (wrong.length > 0) reason = "corrected";

  return { score, passed: fatalCount === 0, reason, gradeable: true, tryCount: picks.length, fatalCount };
}

module.exports = { gradeSelectionSingle, gradeSelectionMulti, gradeSelectionSequence, TRY_PENALTY, FAILING_SEVERITIES };
