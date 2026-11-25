// P1A east-lakeside road integration candidate for the original PlayCanvas world.
// Source: inhaworld Draft PR #10. The existing Agora courtyard, pond, saved state,
// quest IDs and colliders remain owned by the legacy PlayCanvas modules.
// Only the distinct east approach centre lines are considered here.
import { geoToWorld } from './geo-coordinates.js';
import { projectPolygon, getCanonicalLandmark, triangulatePolygon } from './reality-adapter.js';
import { roadFrame } from './campus-road-layout.js';
import { FLAT_GROUND_Y as Y } from './flat-ground-surface.js';

import record from '../data/reality/evidence/roads/inkyung-east-p1a.json' with { type: 'json' };

// Isolate the experiment: neither main's public domain nor the ordinary legacy QA
// experience opts into new navigation or surfaces without an explicit query param.
export function isP1AEastQaEnabled(host = globalThis.location?.hostname ?? '', search = globalThis.location?.search ?? '') {
  // The PlayCanvas release opts the evidence-backed east shore path in by default.
  // Draft QA on the original project continues to require ?p1a_east=1.
  const qaHost = /(^|\.)inha-world-playcanvas-qa\.pages\.dev$/i.test(host);
  const liveHost = host === 'inhagame.app' || /(^|\.)inhagame-playcanvas-live\.pages\.dev$/i.test(host);
  return liveHost || (qaHost && new URLSearchParams(search).get('p1a_east') === '1');
}

export const P1A_EAST_ROUTES = Object.freeze(record.ways.map(way => Object.freeze({
  id: 'p1a_east_osm_' + way.id,
  sourceId: 'osm_way_' + way.id,
  sourceVersion: way.version,
  highway: way.highway,
  surveyedWidthM: way.surveyedWidthM,
  // WGS84 is the source of spatial facts. Render widths below are estimates only.
  widthWU: way.highway === 'service' ? 2.04 : 1.24,
  vertices: Object.freeze(way.nodes.map(([, lat, lon]) => Object.freeze(geoToWorld(lat, lon))))
})));

export const P1A_POND_RING = Object.freeze(projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon));
const faces = (() => {
  const ids = triangulatePolygon(P1A_POND_RING);
  return Object.freeze(Array.from({ length: ids.length / 3 }, (_, n) =>
    Object.freeze(ids.slice(n * 3, n * 3 + 3).map(i => P1A_POND_RING[i]))));
})();
const EPS = 1e-8;
const area = polygon => polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length];
  return sum + p.x * q.z - q.x * p.z;
}, 0) / 2;
const cross = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
function halfPlane(polygon, a, b, inside) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = cross(a, b, p) * (inside ? -1 : 1);
    const dq = cross(a, b, q) * (inside ? -1 : 1);
    if (dp >= -EPS) out.push(p);
    if ((dp >= -EPS) !== (dq >= -EPS)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out.filter((p, i) => {
    const last = out[(i + out.length - 1) % out.length];
    return Math.hypot(p.x - last.x, p.z - last.z) > EPS;
  });
}
function bounds(polygon) {
  return {
    minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
    minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z))
  };
}
function overlaps(a, b) {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS &&
    a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}
// Uses the same clockwise-triangle subtraction convention as campus-terrain-geometry.
// The concave pond cannot be used as one convex clipping mask.
export function clipP1ARoadFromWater(polygon) {
  let pieces = [polygon];
  for (const mask of faces) {
    const next = [];
    for (const piece of pieces) {
      if (!overlaps(bounds(piece), bounds(mask))) { next.push(piece); continue; }
      let remainder = piece;
      for (let i = 0; i < 3 && remainder.length >= 3; i++) {
        const a = mask[i], b = mask[(i + 1) % 3];
        const outside = halfPlane(remainder, a, b, false);
        if (outside.length >= 3 && Math.abs(area(outside)) > EPS) next.push(outside);
        remainder = halfPlane(remainder, a, b, true);
      }
    }
    pieces = next;
  }
  return pieces;
}

export function p1aEastRoadSurfacePieces() {
  const pieces = [], shoulder = 0.22;
  for (const route of P1A_EAST_ROUTES) for (let i = 1; i < route.vertices.length; i++) {
    const frame = roadFrame(route.vertices[i - 1], route.vertices[i]);
    const half = route.widthWU / 2;
    const strips = [
      [-half - shoulder, -half, '#aba999', Y.SURFACE],
      [-half, half, route.highway === 'service' ? '#80857e' : '#bba992', Y.EDGE],
      [half, half + shoulder, '#aba999', Y.SURFACE]
    ];
    for (const [left, right, color, height] of strips) {
      const polygon = [frame.at(0, left), frame.at(frame.length, left),
        frame.at(frame.length, right), frame.at(0, right)];
      for (const shape of clipP1ARoadFromWater(polygon)) {
        pieces.push({ routeId: route.id, polygon: shape, color, height });
      }
    }
  }
  return pieces;
}

export function fillP1AEastQaSurface(batch) {
  for (const { polygon, color, height } of p1aEastRoadSurfacePieces()) {
    const ring = area(polygon) > 0 ? [...polygon].reverse() : polygon;
    for (let i = 1; i < ring.length - 1; i++) {
      const [a, b, c] = [ring[0], ring[i], ring[i + 1]];
      if (Math.abs(cross(a, b, c)) <= EPS) continue;
      batch.triangle(color, [a.x, height, a.z], [b.x, height, b.z], [c.x, height, c.z]);
    }
  }
}
