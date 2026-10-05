import { geoToWorld } from './geo-coordinates.js';
import { projectPolygon } from './reality-adapter.js';
import { photoNorthTowerParts } from './north-landmark-massing.js';

const url = new URL('../data/reality/campus-facilities.json', import.meta.url);
const data = url.protocol === 'file:'
  ? JSON.parse((await import('node:fs')).readFileSync(url, 'utf8'))
  : await (async () => { const r = await fetch(url); if (!r.ok) throw Error(`Facilities load failed: ${r.status}`); return r.json(); })();

// Vertical slabs partition an outer ring and its holes without filling the courtyard.
// Every cut is at a source vertex; the even/odd rule works regardless of ring winding.
export function partitionCourtyard(rings) {
  if (rings.length === 1) return [rings[0]];
  const edges = rings.flatMap(r => r.map((a, i) => [a, r[(i + 1) % r.length]]));
  const xs = [...new Set(rings.flat().map(p => p.x))].sort((a, b) => a - b), parts = [];
  const at = ([a, b], x) => a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x);
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1], right = xs[i], mid = (left + right) / 2;
    if (right - left < 1e-8) continue;
    const cuts = edges.filter(([a, b]) => Math.min(a.x, b.x) < mid && Math.max(a.x, b.x) > mid)
      .sort((a, b) => at(a, mid) - at(b, mid));
    if (cuts.length % 2) throw Error('Invalid courtyard ring intersections');
    for (let j = 0; j < cuts.length; j += 2) {
      const points = [{ x:left, z:at(cuts[j],left) }, { x:right, z:at(cuts[j],right) },
        { x:right, z:at(cuts[j+1],right) }, { x:left, z:at(cuts[j+1],left) }];
      const clean = points.filter((p,k) => Math.hypot(p.x-points[(k+3)%4].x,p.z-points[(k+3)%4].z)>1e-7);
      if (clean.length >= 3) parts.push(clean);
    }
  }
  return parts;
}

const averagePoint = points => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  z: points.reduce((sum, point) => sum + point.z, 0) / points.length
});

function ringAreaCentroid(points) {
  let area2 = 0, x = 0, z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a.x * b.z - b.x * a.z;
    area2 += cross;
    x += (a.x + b.x) * cross;
    z += (a.z + b.z) * cross;
  }
  if (!Number.isFinite(area2) || Math.abs(area2) < 1e-9) {
    return { area: 0, center: averagePoint(points) };
  }
  return {
    area: Math.abs(area2) / 2,
    center: { x: x / (3 * area2), z: z / (3 * area2) }
  };
}

// Geometric centroid of an outer footprint minus any courtyard holes.
// Ring winding is intentionally ignored because source OSM rings are not normalized.
export function footprintCentroid(rings) {
  if (!Array.isArray(rings) || !rings.length || rings.some(ring => !Array.isArray(ring) || ring.length < 3)) {
    throw new TypeError('footprintCentroid requires one or more polygon rings');
  }
  const outer = ringAreaCentroid(rings[0]);
  let area = outer.area, x = outer.center.x * outer.area, z = outer.center.z * outer.area;
  for (const hole of rings.slice(1)) {
    const part = ringAreaCentroid(hole);
    area -= part.area;
    x -= part.center.x * part.area;
    z -= part.center.z * part.area;
  }
  if (!(area > 1e-9) || ![x, z].every(Number.isFinite)) return averagePoint(rings[0]);
  return { x: x / area, z: z / area };
}

export const FACILITIES = data.features.map(f => {
  const rings = f.rings?.map(r => projectPolygon(r)) || [];
  const pts = rings[0] || [geoToWorld(f.lat, f.lon)];
  // Keep the historical vertex-average center for gameplay systems that already depend on it.
  // Consumers that need a geometry-faithful anchor (for example the Mini-map) use footprintCenter.
  const center = averagePoint(pts);
  const footprintCenter = rings.length ? footprintCentroid(rings) : center;
  return { ...f, rings, center, footprintCenter, parts:rings.length ? partitionCourtyard(rings) : [],
    legacyZoneId:center.z < -50 ? 'C01_GATE' : center.x < 95 ? 'C02_MAIN_HALL' : 'C03_CENTRAL' };
});

// Raised tower volumes are inset inside the source outline; dimensions are visual estimates.
export function towerParts(f) {
  if(['bldg_05','bldg_60th'].includes(f.id))return photoNorthTowerParts(f);
  if (!['anniversary','hitech'].includes(f.style)) return [];
  const v=f.rings[0], north=[...v].sort((a,b)=>b.z-a.z)[0];
  const center={x:f.center.x*.45+north.x*.55,z:f.center.z*.45+north.z*.55};
  return [{ id:f.id+'_tower', height:f.style==='hitech'?29:30,
    vertices:v.map(p=>({x:center.x+(p.x-f.center.x)*.32,z:center.z+(p.z-f.center.z)*.32})) }];
}
export const FACILITY_COLLIDERS = FACILITIES.filter(f=>f.kind==='building').flatMap(f=>[
  ...f.parts.map((polygon,i)=>({id:f.id+'_'+i,polygon,minY:0,maxY:f.height})),
  ...towerParts(f).map(t=>({id:t.id,polygon:t.vertices,minY:f.height,maxY:t.height}))
]);

// Include the western back-gate block (source footprints reach z=175) and its margin.
const extent=FACILITIES.flatMap(f=>f.rings[0] || [f.center]);
export const FACILITY_BOUNDS = {
  minX:Math.min(-65,Math.floor(Math.min(...extent.map(p=>p.x))-12)),
  maxX:Math.max(174,Math.ceil(Math.max(...extent.map(p=>p.x))+12)),
  minZ:Math.min(-145,Math.floor(Math.min(...extent.map(p=>p.z))-12)),
  maxZ:Math.max(185,Math.ceil(Math.max(...extent.map(p=>p.z))+12))
};
