import { describe, it } from "node:test";
import assert from "node:assert";
import {
  MARKER_SIZE_CM,
  markerDistance,
  lerp,
  lerpAngleDeg,
  lerpPosition,
  formatDistance
} from "../modules/fire-response/distance.js";

describe("Team Distance and Interpolation Math", () => {
  describe("MARKER_SIZE_CM constant", () => {
    it("exports MARKER_SIZE_CM constant matching default 20cm Hiro marker", () => {
      assert.strictEqual(MARKER_SIZE_CM, 20);
    });
  });

  describe("markerDistance", () => {
    it("returns zero for identical points or null inputs", () => {
      assert.strictEqual(markerDistance({ x: 1, z: 2 }, { x: 1, z: 2 }), 0);
      assert.strictEqual(markerDistance(null, { x: 1, z: 2 }), 0);
      assert.strictEqual(markerDistance({ x: 1, z: 2 }, null), 0);
    });

    it("computes 2D distance in marker units scaled to metres", () => {
      // 3 units in X, 4 units in Z = 5 units hypot
      // with default 20cm marker (MARKER_SIZE_CM): 5 * 0.20 = 1.0 metre
      const distDefault = markerDistance({ x: 0, z: 0 }, { x: 3, z: 4 });
      assert.strictEqual(Math.abs(distDefault - 1.0) < 1e-6, true);

      const dist = markerDistance({ x: 0, z: 0 }, { x: 3, z: 4 }, 20);
      assert.strictEqual(Math.abs(dist - 1.0) < 1e-6, true);

      // with 50cm marker: 5 * 0.50 = 2.5 metres
      const dist50 = markerDistance({ x: 0, z: 0 }, { x: 3, z: 4 }, 50);
      assert.strictEqual(Math.abs(dist50 - 2.5) < 1e-6, true);
    });
  });

  describe("lerp", () => {
    it("interpolates scalar values and clamps factor", () => {
      assert.strictEqual(lerp(0, 10, 0), 0);
      assert.strictEqual(lerp(0, 10, 0.5), 5);
      assert.strictEqual(lerp(0, 10, 1), 10);
      assert.strictEqual(lerp(0, 10, -0.2), 0);
      assert.strictEqual(lerp(0, 10, 1.5), 10);
    });
  });

  describe("lerpAngleDeg", () => {
    it("interpolates angles along the shortest circular path", () => {
      // standard interpolation
      assert.strictEqual(lerpAngleDeg(0, 90, 0.5), 45);

      // shortest path across 0/360 boundary (350 to 10 is 20 deg span forward)
      const midWrap = lerpAngleDeg(350, 10, 0.5);
      assert.strictEqual(Math.abs(midWrap - 0) < 1e-6 || Math.abs(midWrap - 360) < 1e-6, true);

      // reverse shortest path (10 to 350 is 20 deg backward)
      const midRev = lerpAngleDeg(10, 350, 0.5);
      assert.strictEqual(Math.abs(midRev - 0) < 1e-6 || Math.abs(midRev - 360) < 1e-6, true);
    });
  });

  describe("lerpPosition", () => {
    it("interpolates 3D coordinates smoothly", () => {
      const start = { x: 0, y: 1, z: 2 };
      const end = { x: 10, y: 3, z: 6 };
      const mid = lerpPosition(start, end, 0.5);
      assert.deepStrictEqual(mid, { x: 5, y: 2, z: 4 });

      // missing input fallback
      assert.deepStrictEqual(lerpPosition(null, end, 0.5), end);
      assert.deepStrictEqual(lerpPosition(start, null, 0.5), start);
    });
  });

  describe("formatDistance", () => {
    it("formats metres with single decimal place and fallback", () => {
      assert.strictEqual(formatDistance(3.1415), "3.1m");
      assert.strictEqual(formatDistance(0), "0.0m");
      assert.strictEqual(formatDistance(NaN), "0.0m");
    });
  });
});
