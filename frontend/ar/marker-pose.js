// compute camera pose in marker-local space, plain math, no THREE
// positions are in marker units. multiply by markerSizeCm/100 for metres.

const DEG_TO_RAD = Math.PI / 180;

// translate + rotate camera world position into marker-local frame (yaw only)
function cameraToMarkerSpace(camPos, camYawDeg, markerPos, markerYawDeg) {
  if (!camPos || !markerPos) return null;
  const cx = typeof camPos.x === "number" ? camPos.x : 0;
  const cz = typeof camPos.z === "number" ? camPos.z : 0;
  const mx = typeof markerPos.x === "number" ? markerPos.x : 0;
  const mz = typeof markerPos.z === "number" ? markerPos.z : 0;

  // translate relative to marker origin
  const dx = cx - mx;
  const dz = cz - mz;

  // rotate by negative marker yaw to get marker-local axes
  const angle = -(typeof markerYawDeg === "number" ? markerYawDeg : 0) * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
    yawDeg: (typeof camYawDeg === "number" ? camYawDeg : 0) - (typeof markerYawDeg === "number" ? markerYawDeg : 0)
  };
}

export { cameraToMarkerSpace, DEG_TO_RAD };
