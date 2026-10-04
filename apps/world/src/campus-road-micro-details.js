import { ROAD_SEGMENTS, ROAD_CROSSWALKS, distanceToRoad } from './campus-road-layout.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

// Authored presentation, not surveyed infrastructure. Static faces join the
// existing campus road batch: no textures, colliders or per-frame work.
export const ROAD_DETAIL_COLORS = Object.freeze({ asphalt: '#555f5d', metal: '#69716e' });
export const ROAD_DETAIL_SEGMENT_LIMIT = 24;
const TOP = .029; // Above paint, below the shared flat-ground maximum.

export function campusRoadDetailPlan() {
  const details = [];
  const segments = ROAD_SEGMENTS.filter(s => s.frame.length >= 12).slice(0, ROAD_DETAIL_SEGMENT_LIMIT);
  for (const [i, segment] of segments.entries()) {
    const { frame, road } = segment;
    const candidates = [
      { kind: 'patch', u: frame.length * .32, v: -.38, length: 1.2, width: .66 },
      { kind: 'crack', u: frame.length * .57, v: .2, length: .95, width: .3 },
      { kind: 'wear', u: frame.length * .76, v: (i % 2 ? -1 : 1) * (road.width / 2 - .16), length: .7, width: .07 },
      ...(i % 3 === 0 ? [{ kind: 'manhole', u: frame.length * .43, v: .42, length: .58, width: .58 }] : []),
      ...(i % 2 === 0 ? [{ kind: 'drain', u: frame.length * .88, v: -road.width / 2 + .26, length: .5, width: .25 }] : [])
    ];
    for (const d of candidates) {
      const radius = Math.hypot(d.length, d.width) / 2;
      if (d.u - radius < 1.5 || d.u + radius > frame.length - 1.5) continue;
      if (Math.abs(d.v) + d.width / 2 > road.width / 2) continue;
      // Keep crosswalks and intersecting roads readable; avoid doubled dressing.
      if (ROAD_CROSSWALKS.some(c => c.segment === segment && Math.abs(c.u - d.u) < c.width / 2 + radius + 1)) continue;
      const center = frame.at(d.u, d.v);
      if (ROAD_SEGMENTS.some(s => s !== segment && distanceToRoad(center, s) < s.road.width / 2 + radius + .3)) continue;
      details.push({ ...d, segment });
    }
  }
  return details;
}

export function fillCampusRoadMicroDetails(batch) {
  const { asphalt, metal } = ROAD_DETAIL_COLORS;
  for (const d of campusRoadDetailPlan()) {
    const point = (u, v, y) => {
      const p = d.segment.frame.at(d.u + u, d.v + v);
      return [p.x, y, p.z];
    };
    const rect = (color, u0, u1, v0, v1, y) => batch.quad(color,
      point(u0, v0, y), point(u0, v1, y), point(u1, v1, y), point(u1, v0, y));
    if (d.kind === 'patch') {
      rect(asphalt, -.6, .6, -.33, .33, G.EDGE);
    } else if (d.kind === 'crack') {
      // A thin angular seam, with one short branch, rather than a crater.
      const nodes = [[-.475, -.09], [-.18, .02], [.12, -.025], [.475, .09]];
      for (let j = 1; j < nodes.length; j++) {
        const [u, v] = nodes[j - 1], [x, z] = nodes[j], du = x - u, dv = z - v;
        const scale = .012 / Math.hypot(du, dv), a = -dv * scale, b = du * scale;
        batch.quad(asphalt, point(u - a, v - b, G.PAINT), point(u + a, v + b, G.PAINT),
          point(x + a, z + b, G.PAINT), point(x - a, z - b, G.PAINT));
      }
      rect(asphalt, -.2, -.18, .015, .14, G.PAINT);
    } else if (d.kind === 'wear') {
      // Asphalt-colored holes interrupt the existing edge paint only.
      rect('#747d7b', -.35, -.12, -.035, .005, TOP);
      rect('#747d7b', .04, .35, -.005, .035, TOP);
    } else if (d.kind === 'manhole') {
      const center = point(0, 0, G.DETAIL);
      for (let j = 0; j < 8; j++) {
        const angle = j * Math.PI / 4, next = (j + 1) * Math.PI / 4;
        const a = point(Math.cos(angle) * .29, Math.sin(angle) * .29, G.DETAIL);
        const b = point(Math.cos(next) * .29, Math.sin(next) * .29, G.DETAIL);
        // Upward triangle split into a nondegenerate quad for the shared API.
        batch.quad(metal, center, b, b.map((x, k) => (x + a[k]) / 2), a);
      }
      for (const v of [-.12, 0, .12]) rect(asphalt, -.18, .18, v - .012, v + .012, TOP);
    } else if (d.kind === 'drain') {
      rect(metal, -.25, .25, -.125, .125, G.DETAIL);
      for (let j = 0; j < 5; j++) rect(asphalt, -.2 + j * .09, -.16 + j * .09, -.09, .09, TOP);
    }
  }
  return batch;
}
