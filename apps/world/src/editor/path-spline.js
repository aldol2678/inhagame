const finitePoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const groundDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const extrapolate = (a, b) => a.map((value, index) => 2 * value - b[index]);
const interpolate = (a, b, start, end, time) => a.map((value, index) =>
  ((end - time) * value + (time - start) * b[index]) / (end - start));

export function validateSplineControls(points, closed = false) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 256 ||
    !points.every(finitePoint) || points.some((point, index) =>
      index > 0 && groundDistance(point, points[index - 1]) < 0.01) ||
    (closed && groundDistance(points[0], points.at(-1)) < 0.01)) {
    throw new Error("E_PATH_SPLINE_POINTS_INVALID");
  }
  for (let index = 0; index < points.length; index += 1) {
    if (!closed && (index === 0 || index === points.length - 1)) continue;
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const incoming = [current[0] - previous[0], current[2] - previous[2]];
    const outgoing = [next[0] - current[0], next[2] - current[2]];
    const cosine = (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
      (groundDistance(previous, current) * groundDistance(current, next));
    if (cosine < -0.866) throw new Error("E_PATH_SPLINE_TURN_TOO_SHARP");
  }
  return points;
}

function catmullRom(p0, p1, p2, p3, fraction) {
  const t0 = 0;
  const t1 = t0 + Math.sqrt(distance(p0, p1));
  const t2 = t1 + Math.sqrt(distance(p1, p2));
  const t3 = t2 + Math.sqrt(distance(p2, p3));
  const time = t1 + (t2 - t1) * fraction;
  const a1 = interpolate(p0, p1, t0, t1, time);
  const a2 = interpolate(p1, p2, t1, t2, time);
  const a3 = interpolate(p2, p3, t2, t3, time);
  const b1 = interpolate(a1, a2, t0, t2, time);
  const b2 = interpolate(a2, a3, t1, t3, time);
  return interpolate(b1, b2, t1, t2, time);
}

export function samplePathCenterline(points, interpolation = "linear", closed = false) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(finitePoint)) return [];
  const linear = () => [...points.map(point => [...point]), ...(closed ? [[...points[0]]] : [])];
  if (interpolation !== "catmull-rom" || points.length < 3 ||
    points.some((point, index) => index > 0 && groundDistance(point, points[index - 1]) < 0.01) ||
    (closed && groundDistance(points[0], points.at(-1)) < 0.01)) return linear();
  const result = [];
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const p1 = points[index], p2 = points[(index + 1) % points.length];
    const p0 = index > 0 ? points[index - 1] : closed ? points.at(-1) : extrapolate(p1, p2);
    const p3 = index + 2 < points.length ? points[index + 2] : closed ? points[(index + 2) % points.length] : extrapolate(p2, p1);
    const steps = Math.max(8, Math.min(64, Math.ceil(distance(p1, p2) / 0.6)));
    for (let step = 0; step < steps; step += 1) result.push(catmullRom(p0, p1, p2, p3, step / steps));
  }
  result.push(closed ? [...points[0]] : [...points.at(-1)]);
  return result;
}

export function buildPathRibbonGeometry(points, widthMeters, closed = false) {
  if (!Number.isFinite(widthMeters) || widthMeters <= 0 || !Array.isArray(points) || points.length < 2 || !points.every(finitePoint)) {
    throw new Error("E_PATH_RIBBON_INVALID");
  }
  const positions = [], normals = [], uvs = [], indices = [];
  let traveled = 0;
  const last = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (index > 0) traveled += distance(point, points[index - 1]);
    const previous = index === 0 ? (closed ? points[last - 1] : point) : points[index - 1];
    const next = index === last ? (closed ? points[1] : point) : points[index + 1];
    let inX = point[0] - previous[0], inZ = point[2] - previous[2];
    let outX = next[0] - point[0], outZ = next[2] - point[2];
    const inLength = Math.hypot(inX, inZ), outLength = Math.hypot(outX, outZ);
    if (inLength < 1e-6 && outLength < 1e-6) throw new Error("E_PATH_RIBBON_INVALID");
    if (inLength < 1e-6) { inX = outX; inZ = outZ; }
    if (outLength < 1e-6) { outX = inX; outZ = inZ; }
    const inNorm = Math.hypot(inX, inZ), outNorm = Math.hypot(outX, outZ);
    const leftIn = [-inZ / inNorm, inX / inNorm];
    const leftOut = [-outZ / outNorm, outX / outNorm];
    let miter = [leftIn[0] + leftOut[0], leftIn[1] + leftOut[1]];
    const miterLength = Math.hypot(...miter);
    miter = miterLength < 1e-6 ? leftOut : miter.map(value => value / miterLength);
    const dot = miter[0] * leftOut[0] + miter[1] * leftOut[1];
    const bend = Math.abs(inX * outZ - inZ * outX);
    const chord = Math.hypot(next[0] - previous[0], next[2] - previous[2]);
    const radius = bend < 1e-9 ? Infinity : inNorm * outNorm * chord / (2 * bend);
    const miterOffset = dot < 0.25 ? widthMeters / 2 : Math.min(widthMeters / (2 * dot), widthMeters);
    // Narrow only very tight bends so the inner edge does not fold over itself.
    const offset = Math.min(miterOffset, radius * 0.4);
    for (const side of [1, -1]) {
      positions.push(point[0] + miter[0] * offset * side, point[1] + 0.04, point[2] + miter[1] * offset * side);
      normals.push(0, 1, 0);
      uvs.push(side === 1 ? 0 : 1, traveled);
    }
    if (index > 0) {
      const previousLeft = (index - 1) * 2, left = index * 2;
      indices.push(previousLeft, left, previousLeft + 1, previousLeft + 1, left, left + 1);
    }
  }
  return { positions, normals, uvs, indices };
}
