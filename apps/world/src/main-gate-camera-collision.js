// Camera-only correction for the editor-owned main-gate approach. Do not reuse for
// movement/grounding: gameplay still uses the unchanged canonical OBSTACLES.
import { mainGateProductionPath } from './editor/main-gate-production.js';
import { polygonOverlap } from './polygon-collision.js';

const approach = mainGateProductionPath('main_gate_approach');
const [a, b] = approach.vertices;
const length = Math.hypot(b.x - a.x, b.z - a.z);
const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
const CLEARANCE = .35;
const WALK_ORBIT_REACH = 7;
const boundsCache = new WeakMap();

// Local camera volume, derived from the authored approach plus the existing walk
// orbit reach. Explicit indoor sets and flight rays never select this policy.
export function inMainGateCameraArea(from) {
  if (from[1] < 0 || from[1] > 2.2) return false;
  const dx = from[0] - a.x, dz = from[2] - a.z;
  const along = dx * tx + dz * tz, across = -dx * tz + dz * tx;
  return along >= -WALK_ORBIT_REACH && along <= length + WALK_ORBIT_REACH &&
    Math.abs(across) <= approach.width / 2 + WALK_ORBIT_REACH;
}

function clip(interval, start, delta, low, high) {
  if (Math.abs(delta) < 1e-9) return start >= low && start <= high;
  const t0 = (low - start) / delta, t1 = (high - start) / delta;
  interval[0] = Math.max(interval[0], Math.min(t0, t1));
  interval[1] = Math.min(interval[1], Math.max(t0, t1));
  return interval[0] <= interval[1];
}

// Sweep against the actual concave outline plus finite edge strips/vertex discs.
// Expanding triangulation half-planes makes acute internal triangle tips extend
// tens of units beyond a building and incorrectly puts the ray origin inside it.
export function mainGatePolygonCameraFraction(from, to, body) {
  const delta = to.map((v, i) => v - from[i]);
  let bounds = boundsCache.get(body);
  if (!bounds) {
    bounds = [Math.min(...body.polygon.map(p => p.x)), Math.max(...body.polygon.map(p => p.x)),
      Math.min(...body.polygon.map(p => p.z)), Math.max(...body.polygon.map(p => p.z))];
    boundsCache.set(body, bounds);
  }
  const span = [0, 1];
  if (!clip(span, from[1], delta[1], body.minY, body.maxY + CLEARANCE) ||
      !clip(span, from[0], delta[0], bounds[0] - CLEARANCE, bounds[1] + CLEARANCE) ||
      !clip(span, from[2], delta[2], bounds[2] - CLEARANCE, bounds[3] + CLEARANCE)) return 1;
  let enter = Infinity;
  const sx = from[0] + delta[0] * span[0], sz = from[2] + delta[2] * span[0];
  if (polygonOverlap(sx, sz, body.polygon, CLEARANCE + 1e-9)) enter = span[0];
  for (let i = 0; i < body.polygon.length; i++) {
    const p = body.polygon[i], q = body.polygon[(i + 1) % body.polygon.length];
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    const ux = dx / len, uz = dz / len, rx = from[0] - p.x, rz = from[2] - p.z;
    const strip = [...span];
    if (clip(strip, rx * ux + rz * uz, delta[0] * ux + delta[2] * uz, 0, len) &&
        clip(strip, -rx * uz + rz * ux, -delta[0] * uz + delta[2] * ux, -CLEARANCE, CLEARANCE))
      enter = Math.min(enter, strip[0]);
    const aa = delta[0] ** 2 + delta[2] ** 2;
    const bb = 2 * (rx * delta[0] + rz * delta[2]);
    const cc = rx ** 2 + rz ** 2 - CLEARANCE ** 2;
    const discriminant = bb ** 2 - 4 * aa * cc;
    if (aa > 1e-12 && discriminant >= 0) {
      const lo = (-bb - Math.sqrt(discriminant)) / (2 * aa);
      const hi = (-bb + Math.sqrt(discriminant)) / (2 * aa);
      const first = Math.max(span[0], lo);
      if (first <= Math.min(span[1], hi)) enter = Math.min(enter, first);
    }
  }
  return Number.isFinite(enter) ? Math.max(.06, enter - .025) : 1;
}
