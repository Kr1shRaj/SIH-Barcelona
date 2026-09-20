import { describe, it } from "node:test";
import assert from "node:assert";
import { cameraToMarkerSpace } from "../ar/marker-pose.js";

// test marker-local pose math with known transforms
describe("marker-pose: cameraToMarkerSpace", () => {

  // identity: camera at origin, marker at origin, no yaw
  it("returns zero when camera and marker overlap", () => {
    const result = cameraToMarkerSpace({ x: 0, z: 0 }, 0, { x: 0, z: 0 }, 0);
    assert.ok(result);
    assert.ok(Math.abs(result.x) < 1e-9);
    assert.ok(Math.abs(result.z) < 1e-9);
    assert.strictEqual(result.yawDeg, 0);
  });

  // pure translation: camera 2m ahead, marker at origin, no yaw
  it("handles pure translation with no rotation", () => {
    const result = cameraToMarkerSpace({ x: 2, z: 0 }, 0, { x: 0, z: 0 }, 0);
    assert.ok(result);
    assert.ok(Math.abs(result.x - 2) < 1e-9);
    assert.ok(Math.abs(result.z) < 1e-9);
  });

  // 90 degree marker rotation
  it("rotates position 90 degrees into marker frame", () => {
    const result = cameraToMarkerSpace({ x: 1, z: 0 }, 0, { x: 0, z: 0 }, 90);
    assert.ok(result);
    // camera at (1,0) in world, marker yaw 90: local frame rotates -90
    // cos(-90)=0, sin(-90)=-1 => x = 1*0 - 0*(-1) = 0, z = 1*(-1) + 0*0 = -1
    assert.ok(Math.abs(result.x) < 1e-6, `x=${result.x} expected ~0`);
    assert.ok(Math.abs(result.z + 1) < 1e-6, `z=${result.z} expected ~-1`);
    assert.strictEqual(result.yawDeg, -90);
  });

  // 180 degree marker rotation
  it("rotates position 180 degrees into marker frame", () => {
    const result = cameraToMarkerSpace({ x: 3, z: 0 }, 45, { x: 0, z: 0 }, 180);
    assert.ok(result);
    // cos(-180)=-1, sin(-180)=0 => x = 3*(-1) - 0*0 = -3, z = 3*0 + 0*(-1) = 0
    assert.ok(Math.abs(result.x + 3) < 1e-6, `x=${result.x} expected ~-3`);
    assert.ok(Math.abs(result.z) < 1e-6, `z=${result.z} expected ~0`);
    assert.strictEqual(result.yawDeg, 45 - 180);
  });

  // translation + rotation combined
  it("handles offset marker with rotation", () => {
    const result = cameraToMarkerSpace({ x: 3, z: 1 }, 10, { x: 1, z: 1 }, 0);
    assert.ok(result);
    // no rotation, just offset: dx=2, dz=0
    assert.ok(Math.abs(result.x - 2) < 1e-9);
    assert.ok(Math.abs(result.z) < 1e-9);
    assert.strictEqual(result.yawDeg, 10);
  });

  // null inputs
  it("returns null for null camera pos", () => {
    assert.strictEqual(cameraToMarkerSpace(null, 0, { x: 0, z: 0 }, 0), null);
  });

  it("returns null for null marker pos", () => {
    assert.strictEqual(cameraToMarkerSpace({ x: 0, z: 0 }, 0, null, 0), null);
  });
});
