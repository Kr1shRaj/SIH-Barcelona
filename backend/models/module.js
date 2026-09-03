const { z } = require("zod");
const { identifier, weight, score01, positiveInt } = require("./primitives");
const { ValidationError, issuesFromZod, STRUCTURAL } = require("./errors");
const { CHECKPOINT_TYPES } = require("./attempt");

// one checkpoint as the manifest describes it, camelCase because this is the wire shape
// the engine fetches, not the snake_case row checkpoint_definition hands back.
const checkpointDefinitionSchema = z
  .object({
    checkpointId: identifier,
    type: z.enum(CHECKPOINT_TYPES),
    weight: weight,
    required: z.boolean(),
    critical: z.boolean()
  })
  .strict();

// what GET /api/modules gives the engine so it can score offline
const moduleManifestSchema = z
  .object({
    moduleId: identifier,
    title: z.string().min(1).max(200),
    version: positiveInt,
    passThreshold: score01,
    // null until the Mines Act period is settled, see D4
    recertMonths: positiveInt.nullable(),
    requiredCheckpoints: z.array(checkpointDefinitionSchema).min(1)
  })
  .strict()
  .superRefine((manifest, ctx) => {
    // a duplicate id here would make weights ambiguous and silently skew every score
    const seen = new Set();
    manifest.requiredCheckpoints.forEach((checkpoint, index) => {
      if (seen.has(checkpoint.checkpointId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requiredCheckpoints", index, "checkpointId"],
          message: `duplicate checkpoint "${checkpoint.checkpointId}" in the manifest`
        });
      }
      seen.add(checkpoint.checkpointId);
    });
  });

// validate one module manifest
function validateModuleManifest(data) {
  const parsed = moduleManifestSchema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(STRUCTURAL, issuesFromZod(parsed.error));
  }
  return parsed.data;
}

// validate the whole manifest list GET /api/modules returns
function validateModuleManifestList(data) {
  if (!Array.isArray(data)) {
    throw new ValidationError(STRUCTURAL, [
      { path: "", code: "invalid_type", message: "module manifest list must be an array" }
    ]);
  }

  const manifests = [];
  const issues = [];

  data.forEach((raw, index) => {
    try {
      manifests.push(validateModuleManifest(raw));
    } catch (err) {
      if (!(err instanceof ValidationError)) {
        throw err;
      }
      err.issues.forEach((issue) => {
        issues.push({
          path: issue.path ? `${index}.${issue.path}` : String(index),
          code: issue.code,
          message: issue.message
        });
      });
    }
  });

  if (issues.length > 0) {
    throw new ValidationError(STRUCTURAL, issues);
  }

  return manifests;
}

module.exports = {
  validateModuleManifest,
  validateModuleManifestList,
  moduleManifestSchema,
  checkpointDefinitionSchema
};
