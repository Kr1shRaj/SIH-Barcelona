const { GRADING_ERRORS, GradingError } = require("./errors");
const { parseDefinition } = require("./definition");
const { gradeSelectionSingle, gradeSelectionMulti, gradeSelectionSequence } = require("./selection");
const { gradeSpatialAlignment, gradeAimDwell } = require("./spatial");

// stamped onto every attempt so a certificate issued under a weaker rule stays
// tellable apart from one issued under a stronger one
const GRADER_VERSION = "2.0.0";

const GRADERS = Object.freeze({
  selection_single: gradeSelectionSingle,
  selection_multi: gradeSelectionMulti,
  selection_sequence: gradeSelectionSequence,
  spatial_alignment: gradeSpatialAlignment,
  aim_dwell: gradeAimDwell
});

// grade one raw observation against the rule this server holds for it.
// context carries the scenario rolled from attemptId for scenario graded gates.
// pure — no db, no express, safe to call from anywhere.
function gradeCheckpoint(observation, definitionRow, context = {}) {
  const definition = parseDefinition(definitionRow);

  if (observation.kind !== definition.observationKind) {
    throw new GradingError(
      GRADING_ERRORS.OBSERVATION_KIND_MISMATCH,
      `checkpoint "${definition.checkpointId}" is graded as "${definition.observationKind}", payload sent "${observation.kind}"`,
      definition.checkpointId
    );
  }

  const grader = GRADERS[definition.observationKind];
  if (!grader) {
    throw new GradingError(
      GRADING_ERRORS.DEFINITION_INVALID,
      `no grader for observation kind "${definition.observationKind}"`,
      definition.checkpointId
    );
  }

  return grader(observation, definition, context);
}

module.exports = {
  gradeCheckpoint,
  parseDefinition,
  gradeSelectionSingle,
  gradeSelectionMulti,
  gradeSelectionSequence,
  gradeSpatialAlignment,
  gradeAimDwell,
  GRADER_VERSION,
  GRADING_ERRORS,
  GradingError
};
