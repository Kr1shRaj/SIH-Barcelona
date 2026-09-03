const { z } = require("zod");
const { uuidV4 } = require("./primitives");
const { ValidationError, issuesFromZod, makeIssue, STRUCTURAL } = require("./errors");

// a cert id we minted ourselves
const CERT_ID = /^SAFEAR-[0-9A-F]{16}$/;

// issuing takes an attempt id and nothing else. score, worker and module all come
// from the stored attempt, so the caller cannot claim a mark it did not earn.
const certIssueSchema = z
  .object({
    attemptId: uuidV4
  })
  .strict();

// verify by scanning a qr, or by typing the cert id off a printed card
const certVerifySchema = z
  .object({
    qr: z.string().min(1).max(4096).optional(),
    certId: z.string().regex(CERT_ID, "must look like SAFEAR-0123456789ABCDEF").optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasQr = data.qr !== undefined;
    const hasCertId = data.certId !== undefined;

    if (!hasQr && !hasCertId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "supply either qr or certId"
      });
    }

    // both at once is ambiguous, we would not know which one to believe
    if (hasQr && hasCertId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "supply qr or certId, not both"
      });
    }
  });

// validate cert issue payload shape
function validateCertIssueRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(STRUCTURAL, [
      makeIssue("", "invalid_type", "certificate issue request must be an object")
    ]);
  }

  const parsed = certIssueSchema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(STRUCTURAL, issuesFromZod(parsed.error));
  }
  return parsed.data;
}

// validate cert verify payload shape
function validateCertVerifyRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(STRUCTURAL, [
      makeIssue("", "invalid_type", "certificate verify request must be an object")
    ]);
  }

  const parsed = certVerifySchema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(STRUCTURAL, issuesFromZod(parsed.error));
  }
  return parsed.data;
}

module.exports = {
  validateCertIssueRequest,
  validateCertVerifyRequest,
  certIssueSchema,
  certVerifySchema,
  CERT_ID
};
