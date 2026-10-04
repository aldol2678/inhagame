// Informational stop P0: derived from the current road frames, no route activation or spawn grant.
import { geoToWorld } from '../geo-coordinates.js';
import { metersToWorld } from '../world-scale.js';
import { roadFrame } from '../campus-road-layout.js';
import { BACK_GATE, BACK_SEGMENTS } from '../back-gate-layout.js';
import { BACK_APPROACH_SEGMENTS } from '../back-approach-layout.js';
import { BACK_ROADSIDE_COLLIDERS } from '../back-roadside-layout.js';
import { WALK_SHAPE } from '../player-dimensions.js';

const point = p => Object.freeze({ x: p.x, z: p.z });
export const BACKGATE_TRANSIT_SOURCE = Object.freeze({
  stopId: '37165', lat: 37.451352, lon: 126.655720,
  // Restored design evidence; no live timetable or public-data lookup at runtime.
  evidenceStatus: 'RESTORED_DESIGN_EVIDENCE', presentationOnly: true
});
export const BACKGATE_TRANSIT_SOURCE_ANCHOR = point(geoToWorld(BACKGATE_TRANSIT_SOURCE.lat, BACKGATE_TRANSIT_SOURCE.lon));
const segment = BACK_APPROACH_SEGMENTS.find(s => s.id === 'inha_west_extension_2');
if (!segment) throw new Error('Back-gate transit road segment unavailable');
export const BACKGATE_TRANSIT_FRAME = segment.frame;
export function transitRoadLocal(p, f = BACKGATE_TRANSIT_FRAME) {
  const a = f.at(0), b = f.at(1), tx = b.x-a.x, tz = b.z-a.z;
  return { u: (p.x-a.x)*tx+(p.z-a.z)*tz, v: -(p.x-a.x)*tz+(p.z-a.z)*tx };
}
const U = transitRoadLocal(BACKGATE_TRANSIT_SOURCE_ANCHOR).u;
export const BACKGATE_TRANSIT = Object.freeze({
  id: 'TRANSIT_BACK_GATE_511', roadRef: segment.id,
  pole: point(segment.frame.at(U, -4.75)),
  wait: point(segment.frame.at(U-1.3, -4.25)),
  boarding: point(segment.frame.at(U-1.3, -3.85)),
  busCenter: point(segment.frame.at(U, -2.4)),
  // F1 is a game-world region handoff. No live timetable or physical bus simulation is implied.
  gameMobilityId: 'transit.biryong_bus.f1', gameStatus: 'AVAILABLE',
  destinationSpawnId: 'BIRYONG_STATION', destinationRegionId: 'BIRYONG_REALM',
  interactionRadius: metersToWorld(3.5), u: U,
  sidewalk: Object.freeze({ minU: U-3, maxU: U+1.5, minV: -4.9, maxV: -3.6 })
});
export function inTransitSidewalk(p, radius = WALK_SHAPE.radius) {
  if (!p || ![p.x,p.z,radius].every(Number.isFinite) || radius < 0) return false;
  const { u,v } = transitRoadLocal(p), s = BACKGATE_TRANSIT.sidewalk;
  return u >= s.minU+radius && u <= s.maxU-radius && v >= s.minV+radius && v <= s.maxV-radius;
}
const rectangle = (f,u0,u1,v0,v1) => Object.freeze([f.at(u0,v0),f.at(u1,v0),f.at(u1,v1),f.at(u0,v1)].map(point));
export const BACKGATE_TRANSIT_COLLIDERS = Object.freeze([
  Object.freeze({id:'backgate_transit_pole', minY:0, maxY:1.8, polygon:rectangle(segment.frame,U-.08,U+.08,-4.83,-4.67)}),
  Object.freeze({id:'backgate_transit_board', minY:1.2, maxY:1.7, polygon:rectangle(segment.frame,U-.58,U+.58,-4.815,-4.685)})
]);

// South-side connector follows existing road frames. Avoid existing lamp/signal poles instead of moving
// them. These are guide waypoints; the regular controller/collision authority still owns motion.
const street = BACK_SEGMENTS.filter(s => s.road.osmWayId === 1223158575);
const nearest = street.reduce((best,s) => {
  const q=transitRoadLocal(BACK_GATE,s.frame), u=Math.max(0,Math.min(s.frame.length,q.u));
  const p=s.frame.at(u), d=Math.hypot(p.x-BACK_GATE.x,p.z-BACK_GATE.z);
  return !best || d<best.d ? {s,u,d} : best;
},null);
const selected = street.slice(0,street.indexOf(nearest.s)+1);
const cross=(a,b)=>a.x*b.z-a.z*b.x;
function offsetJoin(a,b,v=-4.25) {
  const p=a.at(a.length,v),q=b.at(0,v),A=a.at(0),B=a.at(1),C=b.at(0),D=b.at(1);
  const t={x:B.x-A.x,z:B.z-A.z},n={x:D.x-C.x,z:D.z-C.z},den=cross(t,n);
  if(Math.abs(den)<1e-9)return point(p);
  const u=cross({x:q.x-p.x,z:q.z-p.z},n)/den;
  return point(a.at(a.length+u,v));
}
const joins = [offsetJoin(segment.frame,street[0].frame), ...selected.slice(1).map((s,i)=>offsetJoin(selected[i].frame,s.frame))];
const entry=point(nearest.s.frame.at(nearest.u,-4.25));
export const BACKGATE_TRANSIT_CONNECTOR = Object.freeze([
  point(BACK_GATE), entry, ...joins.slice().reverse(), BACKGATE_TRANSIT.wait
]);
const guide=[];
for(let i=1;i<BACKGATE_TRANSIT_CONNECTOR.length;i++) {
  const a=BACKGATE_TRANSIT_CONNECTOR[i-1],b=BACKGATE_TRANSIT_CONNECTOR[i],f=roadFrame(a,b);
  guide.push(point(a));
  const obstacles=BACK_ROADSIDE_COLLIDERS.map(q=>{
    const center={x:q.polygon.reduce((n,p)=>n+p.x,0)/q.polygon.length,z:q.polygon.reduce((n,p)=>n+p.z,0)/q.polygon.length};
    return {q,...transitRoadLocal(center,f)};
  })
    .filter(q=>q.u>0&&q.u<f.length&&Math.abs(q.v)<.35).sort((a,b)=>a.u-b.u);
  for(const {u} of obstacles) {
    // Following this westbound path, positive local v stays on the outer sidewalk.
    const outward=.4;
    guide.push(point(f.at(Math.max(0,u-.9))),point(f.at(Math.max(0,u-.5),outward)),
      point(f.at(Math.min(f.length,u+.5),outward)),point(f.at(Math.min(f.length,u+.9))));
  }
}
guide.push(BACKGATE_TRANSIT.wait);
export const BACKGATE_TRANSIT_WALK_GUIDE = Object.freeze(guide);
