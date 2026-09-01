const { z } = require("zod");
const {
  isoTimestamp,
  uuidV4,
  identifier,
  workerId,
  deviceId,
  score01,
  percentage,
  weight,
  nonNegativeNumber,
  positiveInt
} = require("./primitives");
const { ValidationError, issuesFromZod, makeIssue, STRUCTURAL, REFERENTIAL } = require("./errors");

// payload shapes this build understands. adding 1.1 is a one line change here.
const SUPPORTED_CONTRACT_VERSIONS = new Set(["1.0"]);

// mirrors the CHECK constraint on checkpoint_result.checkpoint_type
const CHECKPOINT_TYPES = ["aim", "proximity", "select"];

// context is free form evidence, cap it so nothing unbounded reaches context_json
const MAX_CONTEXT_BYTES = 4096;

// B5: anything longer than four hours is garbage, not a training run
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;

// B4: phone clocks drift, allow five minutes into the future before calling it a lie
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

// context stays open on purpose, but the answer key must never ride along
const contextSchema = z
  .record(z.unknown())
  .refine((ctx) => !Array.isArray(ctx), { message: "context must be an object, not an array" })
  .refine((ctx) => !Object.prototype.hasOwnProperty.call(ctx, "correct"), {
    message: 'context must not carry the answer key — strip "correct" in the engine'
  })
  .refine((ctx) => JSON.stringify(ctx).length <= MAX_CONTEXT_BYTES, {
    message: `context must serialize to ${MAX_CONTEXT_BYTES} bytes or less`
  });

// one checkpoint inside one attempt
const checkpointResultSchema = z
  .object({
    checkpointId: identifier,
    type: z.enum(CHECKPOINT_TYPES),
    passed: z.boolean(),
    score: score01,
    weight: weight,
    timestamp: isoTimestamp,
    context: contextSchema
  })
  .strict();

// B3: strict top level. an unknown key is a loud failure so a typo surfaces at integration,
// not three weeks later when a field turns out to have been silently dropped.
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

    checkpoints: z.array(checkpointResultSchema).min(1),

    // client claims. range checked only — arithmetic disagreement is evidence, not an error.
    totalScore: nonNegativeNumber,
    maxScore: z.number().finite().positive(),
    percentage: percentage,
    passThresholdUsed: score01,
    passed: z.boolean()
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

    // every checkpoint has to have happened during the run it belongs to
    attempt.checkpoints.forEach((checkpoint, index) => {
      const firedAt = Date.parse(checkpoint.timestamp);
      if (firedAt < startedAt || firedAt > completedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checkpoints", index, "timestamp"],
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

// layer 2. does this attempt agree with the manifest the server holds.
// definitions are checkpoint_definition rows as sqlite hands them back, snake_case.
// caller reads them, this stays free of any db import.
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

    if (definition.checkpoint_type !== checkpoint.type) {
      issues.push(
        makeIssue(
          `checkpoints.${index}.type`,
          "checkpoint_type_mismatch",
          `"${checkpoint.checkpointId}" is type "${definition.checkpoint_type}" in the manifest, payload says "${checkpoint.type}"`
        )
      );
    }
  });

  // a completed attempt that skipped a required checkpoint must never certify
  forModule
    .filter((row) => row.required === 1)
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
  checkpointResultSchema,
  SUPPORTED_CONTRACT_VERSIONS,
  CHECKPOINT_TYPES,
  MAX_CONTEXT_BYTES,
  MAX_DURATION_MS,
  CLOCK_SKEW_TOLERANCE_MS
};
