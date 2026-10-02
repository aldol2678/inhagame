import { geoToWorld } from './geo-coordinates.js';
import { projectPolygon } from './reality-adapter.js';

const url = new URL('../data/reality/campus-facilities.json', import.meta.url);
const data = typeof window === 'undefined'
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

export const FACILITIES = data.features.map(f => {
  const rings = f.rings?.map(r => projectPolygon(r)) || [];
  const pts = rings[0] || [geoToWorld(f.lat, f.lon)];
  const center = { x:pts.reduce((s,p)=>s+p.x,0)/pts.length, z:pts.reduce((s,p)=>s+p.z,0)/pts.length };
  return { ...f, rings, center, parts:rings.length ? partitionCourtyard(rings) : [],
    legacyZoneId:center.z < -50 ? 'C01_GATE' : center.x < 95 ? 'C02_MAIN_HALL' : 'C03_CENTRAL' };
});

// Raised tower volumes are inset inside the source outline; dimensions are visual estimates.
export function towerParts(f) {
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
