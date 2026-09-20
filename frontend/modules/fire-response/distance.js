// pure distance and motion math for multi-user marker space

// default printed hiro marker size in cm
const MARKER_SIZE_CM = 20;

// compute distance in metres between two points in marker-local space
function markerDistance(a, b, markerSizeCm = MARKER_SIZE_CM) {
  if (!a || !b) return 0;
  const ax = typeof a.x === "number" ? a.x : 0;
  const az = typeof a.z === "number" ? a.z : 0;
  const bx = typeof b.x === "number" ? b.x : 0;
  const bz = typeof b.z === "number" ? b.z : 0;
  const scale = (typeof markerSizeCm === "number" && markerSizeCm > 0 ? markerSizeCm : MARKER_SIZE_CM) / 100;
  const distUnits = Math.hypot(ax - bx, az - bz);
  return distUnits * scale;
}

// linear interpolation with clamped factor
function lerp(start, end, alpha) {
  const t = Math.max(0, Math.min(1, typeof alpha === "number" ? alpha : 0));
  return start + (end - start) * t;
}

// shortest-path angle lerp in degrees
function lerpAngleDeg(startDeg, endDeg, alpha) {
  const t = Math.max(0, Math.min(1, typeof alpha === "number" ? alpha : 0));
  const s = typeof startDeg === "number" ? startDeg : 0;
  const e = typeof endDeg === "number" ? endDeg : 0;
  let diff = (e - s) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  const res = s + diff * t;
  return ((res % 360) + 360) % 360;
}

// 3d vector lerp for marker space coords
function lerpPosition(startPos, endPos, alpha) {
  if (!startPos && !endPos) return { x: 0, y: 0, z: 0 };
  if (!startPos) return { x: endPos.x || 0, y: endPos.y || 0, z: endPos.z || 0 };
  if (!endPos) return { x: startPos.x || 0, y: startPos.y || 0, z: startPos.z || 0 };
  return {
    x: lerp(startPos.x || 0, endPos.x || 0, alpha),
    y: lerp(startPos.y || 0, endPos.y || 0, alpha),
    z: lerp(startPos.z || 0, endPos.z || 0, alpha)
  };
}

// format metres nicely for hud display
function formatDistance(distMeters) {
  if (typeof distMeters !== "number" || isNaN(distMeters)) return "0.0m";
  return `${distMeters.toFixed(1)}m`;
}

export {
  MARKER_SIZE_CM,
  markerDistance,
  lerp,
  lerpAngleDeg,
  lerpPosition,
  formatDistance
};
