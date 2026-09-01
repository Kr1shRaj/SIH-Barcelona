const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  isoTimestamp,
  uuidV4,
  identifier,
  score01,
  percentage,
  weight,
  nonNegativeNumber
} = require("../models/primitives");

// small helpers so each assertion reads as pass/fail rather than safeParse noise
function accepts(schema, value) {
  return schema.safeParse(value).success;
}
function rejects(schema, value) {
  return !schema.safeParse(value).success;
}

describe("Validation primitives", () => {
  describe("isoTimestamp", () => {
    it("accepts a real UTC instant with milliseconds", () => {
      assert.ok(accepts(isoTimestamp, "2026-09-01T10:14:02.118Z"));
    });

    it("rejects impossible calendar dates that zod alone lets through", () => {
      // this is the whole reason for the Date round-trip refine
      assert.ok(rejects(isoTimestamp, "2026-02-31T10:14:02.118Z"), "31 Feb must be rejected");
      assert.ok(rejects(isoTimestamp, "2026-13-01T10:14:02.118Z"), "month 13 must be rejected");
      assert.ok(rejects(isoTimestamp, "2026-09-01T25:14:02.118Z"), "hour 25 must be rejected");
    });

    it("rejects a timestamp with no milliseconds", () => {
      assert.ok(rejects(isoTimestamp, "2026-09-01T10:14:02Z"));
    });

    it("rejects a non-UTC offset", () => {
      assert.ok(rejects(isoTimestamp, "2026-09-01T10:14:02.118+05:30"));
    });

    it("rejects a bare date and other junk", () => {
      assert.ok(rejects(isoTimestamp, "2026-09-01"));
      assert.ok(rejects(isoTimestamp, "yesterday"));
      assert.ok(rejects(isoTimestamp, ""));
      assert.ok(rejects(isoTimestamp, 1756725242118));
    });
  });

  describe("uuidV4", () => {
    it("accepts a v4 uuid", () => {
      assert.ok(accepts(uuidV4, "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51"));
    });

    it("rejects a v1 uuid that zod .uuid() would accept", () => {
      assert.ok(rejects(uuidV4, "c232ab00-9414-11ec-b3c8-9f6bdeced846"));
    });

    it("rejects the nil uuid", () => {
      assert.ok(rejects(uuidV4, "00000000-0000-0000-0000-000000000000"));
    });

    it("rejects malformed uuids", () => {
      assert.ok(rejects(uuidV4, "not-a-uuid"));
      assert.ok(rejects(uuidV4, "a3f1c9e25b474d189e6a2c8b7f0d4e51"));
      assert.ok(rejects(uuidV4, ""));
    });
  });

  describe("identifier", () => {
    it("accepts the real module and checkpoint ids", () => {
      assert.ok(accepts(identifier, "fire-response"));
      assert.ok(accepts(identifier, "gas-leak"));
      assert.ok(accepts(identifier, "fire_extinguisher_aim"));
      assert.ok(accepts(identifier, "gas_hazard_zone_recognition"));
    });

    it("rejects uppercase, leading digits, spaces and empties", () => {
      assert.ok(rejects(identifier, "Fire-Response"));
      assert.ok(rejects(identifier, "1fire"));
      assert.ok(rejects(identifier, "fire response"));
      assert.ok(rejects(identifier, ""));
      assert.ok(rejects(identifier, "f"), "single char is too short");
    });

    it("rejects an identifier longer than 64 chars", () => {
      assert.ok(rejects(identifier, "a".repeat(65)));
    });
  });

  describe("numeric ranges", () => {
    it("score01 accepts both ends and the middle", () => {
      assert.ok(accepts(score01, 0));
      assert.ok(accepts(score01, 0.67));
      assert.ok(accepts(score01, 1));
    });

    it("score01 rejects out of range, NaN and Infinity", () => {
      assert.ok(rejects(score01, -0.01));
      assert.ok(rejects(score01, 1.01));
      assert.ok(rejects(score01, NaN));
      assert.ok(rejects(score01, Infinity));
    });

    it("percentage spans 0..100 and no further", () => {
      assert.ok(accepts(percentage, 0));
      assert.ok(accepts(percentage, 91.67));
      assert.ok(accepts(percentage, 100));
      assert.ok(rejects(percentage, 100.01));
      assert.ok(rejects(percentage, -1));
    });

    it("weight must be strictly positive", () => {
      assert.ok(accepts(weight, 1));
      assert.ok(accepts(weight, 0.5));
      assert.ok(rejects(weight, 0), "a zero weight would silently drop a checkpoint");
      assert.ok(rejects(weight, -1));
    });

    it("nonNegativeNumber allows zero but not below", () => {
      assert.ok(accepts(nonNegativeNumber, 0));
      assert.ok(rejects(nonNegativeNumber, -0.5));
    });
  });
});
