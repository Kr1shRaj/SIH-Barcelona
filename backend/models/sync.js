const { z } = require("zod");
const { uuidV4, isoTimestamp, workerId, deviceId } = require("./primitives");
const { validateAttemptContract } = require("./attempt");
const { ValidationError, issuesFromZod, STRUCTURAL } = require("./errors");

// B6: one flush carries at most fifty runs, matching the contract
const MAX_BATCH_ATTEMPTS = 50;

// attempts stay unknown here on purpose — each one goes through validateAttemptContract
// so it gets its own version gate and clock check, with the batch index kept in the path.
const syncEnvelopeSchema = z
  .object({
    batchId: uuidV4,
    deviceId: deviceId,
    workerId: workerId,
    sentAt: isoTimestamp,
    attempts: z.array(z.unknown()).min(1).max(MAX_BATCH_ATTEMPTS)
  })
  .strict();

// validate offline sync payload from phone
function validateSyncPayload(data, options = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(STRUCTURAL, [
      { path: "", code: "invalid_type", message: "sync payload must be an object" }
    ]);
  }

  const parsed = syncEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(STRUCTURAL, issuesFromZod(parsed.error));
  }

  // walk every attempt so one bad record names its own index instead of sinking the batch blindly
  const attempts = [];
  const issues = [];

  parsed.data.attempts.forEach((raw, index) => {
    try {
      attempts.push(validateAttemptContract(raw, options));
    } catch (err) {
      if (!(err instanceof ValidationError)) {
        throw err;
      }
      err.issues.forEach((issue) => {
        issues.push({
          path: issue.path ? `attempts.${index}.${issue.path}` : `attempts.${index}`,
          code: issue.code,
          message: issue.message
        });
      });
    }
  });

  if (issues.length > 0) {
    throw new ValidationError(STRUCTURAL, issues);
  }

  return {
    batchId: parsed.data.batchId,
    deviceId: parsed.data.deviceId,
    workerId: parsed.data.workerId,
    sentAt: parsed.data.sentAt,
    attempts
  };
}

module.exports = {
  validateSyncPayload,
  syncEnvelopeSchema,
  MAX_BATCH_ATTEMPTS
};
