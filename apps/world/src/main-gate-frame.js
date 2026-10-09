import { geoToWorld } from './geo-coordinates.js';

// Synchronous boot mirror of the canonical bldg_01 southwest front edge.
// Canonical authority remains campus-buildings.json; parity is pinned by test.
// Keeping this tiny frame source synchronous prevents physical Safari from
// observing an uninitialised GATE_FRAME while basic-campus.js awaits JSON.
export const MAIN_HALL_FRONT_EDGE_WGS84=Object.freeze([
  Object.freeze([37.449444,126.6540696]),
  Object.freeze([37.4491809,126.6546605])
]);

const [a,b]=MAIN_HALL_FRONT_EDGE_WGS84.map(([lat,lon])=>geoToWorld(lat,lon));
const length=Math.hypot(b.x-a.x,b.z-a.z);
const along=Object.freeze({x:(b.x-a.x)/length,z:(b.z-a.z)/length});
const inward=Object.freeze({x:-along.z,z:along.x});

export const GATE_FRAME=Object.freeze({
  yaw:-Math.atan2(along.z,along.x)*180/Math.PI,
  at:(u,v)=>({
    x:along.x*u+inward.x*v,
    z:-90+along.z*u+inward.z*v
  })
});

export const rectInGateFrame=(u0,u1,v0,v1)=>[
  GATE_FRAME.at(u0,v0),
  GATE_FRAME.at(u1,v0),
  GATE_FRAME.at(u1,v1),
  GATE_FRAME.at(u0,v1)
];
