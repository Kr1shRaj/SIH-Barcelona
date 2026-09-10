const { z } = require("zod");
const {
  isoTimestamp,
  uuidV4,
  identifier,
  workerId,
  deviceId,
  percentage,
  positiveInt
} = require("./primitives");
const { ValidationError, issuesFromZod, makeIssue, STRUCTURAL, REFERENTIAL } = require("./errors");

// payload shapes this build understands. v1.0 let the phone send its own score and
// is gone on purpose — a server that still speaks it still accepts a forged mark.
const SUPPORTED_CONTRACT_VERSIONS = new Set(["2.0"]);

// mirrors the CHECK constraint on checkpoint_result.checkpoint_type. content label only.
const CHECKPOINT_TYPES = ["aim", "proximity", "select"];

// mirrors the CHECK constraint on checkpoint_definition.observation_kind
const OBSERVATION_KINDS = ["selection_single", "selection_multi", "spatial_alignment", "aim_dwell"];

// how the phone says it knew where it was pointing. which of these may certify
// is a per checkpoint decision held in checkpoint_definition, not here.
const TRACKING_SOURCES = ["webxr_pose", "arjs_marker", "device_orientation", "none"];

// B5: anything longer than four hours is garbage, not a training run
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;

// B4: phone clocks drift, allow five minutes into the future before calling it a lie
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

// a selection list longer than this is not a ui the team ships
const MAX_SELECTION_ITEMS = 32;

// one option out of a closed list
const selectionSingleObservation = z
  .object({
    kind: z.literal("selection_single"),
    selected: z.string().min(1).max(64)
  })
  .strict();

// a set of options out of a closed list
const selectionMultiObservation = z
  .object({
    kind: z.literal("selection_multi"),
    selected: z.array(z.string().min(1).max(64)).max(MAX_SELECTION_ITEMS)
  })
  .strict();

// device held its aim on an anchored object. angle and dwell, nothing derived.
const spatialAlignmentObservation = z
  .object({
    kind: z.literal("spatial_alignment"),
    anchorId: identifier,
    angularErrorRad: z.number().finite().min(0).max(Math.PI),
    dwellMs: z.number().finite().min(0).max(MAX_DURATION_MS),
    frameCount: z.number().int().min(0),
    trackingSource: z.enum(TRACKING_SOURCES)
  })
  .strict();

// a ray hit the target this far from its base. null means no ray ever hit it.
const aimDwellObservation = z
  .object({
    kind: z.literal("aim_dwell"),
    hitDistanceM: z.number().finite().min(0).nullable(),
    dwellMs: z.number().finite().min(0).max(MAX_DURATION_MS),
    sweepCoverage: z.number().finite().min(0).max(1).nullable(),
    frameCount: z.number().int().min(0),
    trackingSource: z.enum(TRACKING_SOURCES)
  })
  .strict();

// raw observation only. no verdict, no score, no weight, no answer key.
const observationSchema = z.discriminatedUnion("kind", [
  selectionSingleObservation,
  selectionMultiObservation,
  spatialAlignmentObservation,
  aimDwellObservation
]);

// one checkpoint inside one attempt
const checkpointObservationSchema = z
  .object({
    checkpointId: identifier,
    observedAt: isoTimestamp,
    observation: observationSchema
  })
  .strict();

// B3: strict top level. an unknown key is a loud failure so a typo surfaces at integration,
// not three weeks later when a field turns out to have been silently dropped.
// strict is also what rejects a v1 style passed/score/weight riding along.
const attemptContractSchema = z
  .object({
    contractVersion: z.string().min(1),

    attemptId: uuidV4,
    workerId: workerId,
    moduleId: identifier,
    moduleVersion: positiveInt,

    engineVersion: z.string().min(1).max(32),
    deviceId: deviceId,
    arTier: z.union([z.literal(1), z.literal(2)]),
    locale: z.string().min(2).max(8),

    startedAt: isoTimestamp,
    completedAt: isoTimestamp,
    durationMs: z.number().int().min(0).max(MAX_DURATION_MS),
    status: z.literal("completed"),

    checkpoints: z.array(checkpointObservationSchema).min(1),

    // what the phone told the trainee offline. kept so disagreement is visible,
    // never read by scoring or by certificate issuance.
    clientClaimedPercentage: percentage,
    clientClaimedPassed: z.boolean()
  })
  .strict()
  .superRefine((attempt, ctx) => {
    // the contract says exactly one entry per checkpoint. a repeat means the engine is broken,
    // so shout instead of quietly collapsing it and hiding the bug.
    const seen = new Set();
    attempt.checkpoints.forEach((checkpoint, index) => {
      if (seen.has(checkpoint.checkpointId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checkpoints", index, "checkpointId"],
          message: `duplicate checkpoint "${checkpoint.checkpointId}" — the engine must keep one entry per checkpoint`
        });
      }
      seen.add(checkpoint.checkpointId);
    });

    const startedAt = Date.parse(attempt.startedAt);
    const completedAt = Date.parse(attempt.completedAt);

    if (completedAt < startedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "completedAt must not be earlier than startedAt"
      });
      return;
    }

    // B5 again, on the pair that actually gets stored. durationMs is a client claim
    // the server throws away, so capping it alone left the real window unbounded.
    if (completedAt - startedAt > MAX_DURATION_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: `attempt window is ${completedAt - startedAt}ms, longer than the ${MAX_DURATION_MS}ms a training run may take`
      });
      return;
    }

    // every checkpoint has to have happened during the run it belongs to
    attempt.checkpoints.forEach((checkpoint, index) => {
      const firedAt = Date.parse(checkpoint.observedAt);
      if (firedAt < startedAt || firedAt > completedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checkpoints", index, "observedAt"],
          message: `checkpoint fired outside the attempt window ${attempt.startedAt} .. ${attempt.completedAt}`
        });
      }
    });
  });

// layer 1. structural only, no database, safe to run anywhere.
// options.now lets tests pin the clock so skew checks stay deterministic.
function validateAttemptContract(data, options = {}) {
  const now = typeof options.now === "number" ? options.now : Date.now();

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(STRUCTURAL, [
      makeIssue("", "invalid_type", "attempt payload must be an object")
    ]);
  }

  // version gate first, so a stale apk gets one clear line instead of a field error storm
  if (!SUPPORTED_CONTRACT_VERSIONS.has(data.contractVersion)) {
    const supported = Array.from(SUPPORTED_CONTRACT_VERSIONS).join(", ");
    throw new ValidationError(STRUCTURAL, [
      makeIssue(
        "contractVersion",
        "unsupported_contract_version",
        `unsupported contractVersion ${JSON.stringify(data.contractVersion)} — this server speaks ${supported}`
      )
    ]);
  }

  const parsed = attemptContractSchema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(STRUCTURAL, issuesFromZod(parsed.error));
  }

  // skew lives out here, not in the schema, so the schema stays a pure value
  if (Date.parse(parsed.data.completedAt) > now + CLOCK_SKEW_TOLERANCE_MS) {
    throw new ValidationError(STRUCTURAL, [
      makeIssue(
        "completedAt",
        "future_timestamp",
        `completedAt is more than ${CLOCK_SKEW_TOLERANCE_MS / 60000} minutes in the future`
      )
    ]);
  }

  return parsed.data;
}

// a definition pinned to one tier only counts on that tier
function _appliesToTier(row, arTier) {
  return row.applies_to_tier === null || row.applies_to_tier === undefined
    ? true
    : Number(row.applies_to_tier) === arTier;
}

// layer 2. does this attempt agree with the manifest the server holds.
// definitions are checkpoint_definition rows as sqlite hands them back, snake_case.
// caller reads them, this stays free of any db import.
//
// the checkpoint id picks the definition, never the tier the client claims. arTier
// only narrows — a payload that sends a tier 1 checkpoint while claiming tier 2 is
// rejected instead of being quietly graded by the other tier's rule.
function checkAgainstManifest(attempt, definitions) {
  const forModule = (definitions || []).filter((row) => row.module_id === attempt.moduleId);

  if (forModule.length === 0) {
    throw new ValidationError(REFERENTIAL, [
      makeIssue(
        "moduleId",
        "unknown_module",
        `no checkpoint manifest on this server for module "${attempt.moduleId}"`
      )
    ]);
  }

  const known = new Map(forModule.map((row) => [row.checkpoint_id, row]));
  const sent = new Set(attempt.checkpoints.map((checkpoint) => checkpoint.checkpointId));
  const issues = [];

  attempt.checkpoints.forEach((checkpoint, index) => {
    const definition = known.get(checkpoint.checkpointId);

    if (!definition) {
      issues.push(
        makeIssue(
          `checkpoints.${index}.checkpointId`,
          "unknown_checkpoint",
          `"${checkpoint.checkpointId}" is not a checkpoint of module "${attempt.moduleId}"`
        )
      );
      return;
    }

    if (definition.observation_kind !== checkpoint.observation.kind) {
      issues.push(
        makeIssue(
          `checkpoints.${index}.observation.kind`,
          "observation_kind_mismatch",
          `"${checkpoint.checkpointId}" is graded as "${definition.observation_kind}" in the manifest, payload sent "${checkpoint.observation.kind}"`
        )
      );
    }

    if (!_appliesToTier(definition, attempt.arTier)) {
      issues.push(
        makeIssue(
          `checkpoints.${index}.checkpointId`,
          "checkpoint_tier_mismatch",
          `"${checkpoint.checkpointId}" belongs to AR tier ${definition.applies_to_tier}, this attempt says tier ${attempt.arTier}`
        )
      );
    }
  });

  // a completed attempt that skipped a required checkpoint must never certify.
  // tier pinned rows only count when the attempt actually ran on that tier.
  forModule
    .filter((row) => row.required === 1 && _appliesToTier(row, attempt.arTier))
    .forEach((row) => {
      if (!sent.has(row.checkpoint_id)) {
        issues.push(
          makeIssue(
            "checkpoints",
            "missing_required_checkpoint",
            `required checkpoint "${row.checkpoint_id}" is missing from a completed attempt`
          )
        );
      }
    });

  if (issues.length > 0) {
    throw new ValidationError(REFERENTIAL, issues);
  }

  return attempt;
}

module.exports = {
  validateAttemptContract,
  checkAgainstManifest,
  attemptContractSchema,
  checkpointObservationSchema,
  observationSchema,
  SUPPORTED_CONTRACT_VERSIONS,
  CHECKPOINT_TYPES,
  OBSERVATION_KINDS,
  TRACKING_SOURCES,
  MAX_SELECTION_ITEMS,
  MAX_DURATION_MS,
  CLOCK_SKEW_TOLERANCE_MS
};
