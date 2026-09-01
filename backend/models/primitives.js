const { z } = require("zod");

// zod datetime happily takes 2026-02-31, so round trip through Date to be sure it is real
const isoTimestamp = z
  .string()
  .datetime({ precision: 3 })
  .refine(
    (value) => {
      const parsed = new Date(value);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
    },
    { message: "must be a real ISO 8601 UTC instant with milliseconds, e.g. 2026-09-01T10:14:02.118Z" }
  );

// zod .uuid() takes any version and the nil uuid, the contract says v4
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4, "must be a UUID v4");

// module ids and checkpoint ids, lowercase, matches the frontend folder and event names
const IDENTIFIER = /^[a-z][a-z0-9_-]{1,63}$/;
const identifier = z
  .string()
  .regex(IDENTIFIER, "must be a lowercase identifier of 2 to 64 chars, e.g. fire-response");

// worker id format is not settled yet (D6), stay permissive but bounded
const workerId = z.string().min(1).max(64);

// stable per install device id
const deviceId = z.string().min(1).max(64);

// checkpoint score and pass threshold both live in 0..1
const score01 = z.number().finite().min(0).max(1);

const percentage = z.number().finite().min(0).max(100);

const weight = z.number().finite().positive();

const nonNegativeNumber = z.number().finite().min(0);

const positiveInt = z.number().int().positive();

module.exports = {
  isoTimestamp,
  uuidV4,
  identifier,
  workerId,
  deviceId,
  score01,
  percentage,
  weight,
  nonNegativeNumber,
  positiveInt,
  UUID_V4,
  IDENTIFIER
};
