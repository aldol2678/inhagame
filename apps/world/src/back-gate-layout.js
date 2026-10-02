import { geoToWorld } from './geo-coordinates.js';
import { roadFrame, distanceToRoad } from './campus-road-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { polygonOverlap } from './polygon-collision.js';

const url=new URL('../data/reality/evidence/roads/back-gate.json',import.meta.url);
// Node (tests, QA) reads file: URLs from disk; browsers fetch over HTTP. Deciding by protocol,
// not by `window`, keeps tests that shim `window` working.
const data=url.protocol==='file:'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`Back gate source load failed: ${r.status}`);return r.json();})();
export const BACK_GATE=geoToWorld(data.gate.lat,data.gate.lon);
export const BACK_ROADS=data.roads.map(r=>{
  let vertices=r.line.map(ll=>geoToWorld(...ll));
  // These OSM endpoints touch source building walls. Keep raw lines in evidence;
  // stop at the existing 60th perimeter and offset the short hitech service bend.
  if(r.osmWayId===216916383)vertices=vertices.slice(0,-1);
  if(r.osmWayId===216916382){vertices=vertices.slice(1);vertices[0]={x:159,z:75};vertices[1]={x:150.2,z:80.2};vertices[2]={x:151.5,z:92};}
  return {...r,vertices,width:r.osmWayId===1223158575?7:3.5};
});
export const BACK_SEGMENTS=BACK_ROADS.flatMap(r=>r.vertices.slice(1).map((b,i)=>({id:`back_${r.osmWayId}_${i}`,road:r,frame:roadFrame(r.vertices[i],b)})));
const street=BACK_ROADS.find(r=>r.osmWayId===1223158575),a=street.vertices[0],b=street.vertices.at(-1),length=Math.hypot(b.x-a.x,b.z-a.z);
export const BACK_GATE_FRAME={...roadFrame(BACK_GATE,{x:BACK_GATE.x+(b.x-a.x)/length,z:BACK_GATE.z+(b.z-a.z)/length}),yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI};
export const BACK_GATE_BOXES=[
  ...[-10,-3,4].map((u,i)=>({id:`back_gate_pillar_${i}`,u,v:0,w:.9,d:.9,minY:0,maxY:i===1?4.3:3.3})),
  {id:'back_gate_lintel',u:-3,v:0,w:16.4,d:.65,minY:3.12,maxY:3.55},
  {id:'back_gate_booth',u:7.1,v:-.6,w:2.4,d:2.0,minY:0,maxY:1.7}
];
export const BACK_GATE_COLLIDERS=BACK_GATE_BOXES.map(q=>({id:q.id,minY:q.minY,maxY:q.maxY,polygon:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>BACK_GATE_FRAME.at(q.u+x*q.w/2,q.v+z*q.d/2))}));
export const backRoadTreeClear=(p,radius=1.9)=>BACK_SEGMENTS.every(s=>distanceToRoad(p,s)>s.road.width/2+radius+.35);
const spine=BACK_SEGMENTS.find(s=>s.road.osmWayId===216916385);
export const BACK_TREES=Array.from({length:14},(_,i)=>spine.frame.at(24+Math.floor(i/2)*7,i%2?4.3:-4.3))
  .filter(p=>backRoadTreeClear(p,1.4)&&!FACILITY_COLLIDERS.some(b=>polygonOverlap(p.x,p.z,b.polygon,1.5)));
