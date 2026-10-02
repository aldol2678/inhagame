// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { FACILITIES } from './campus-facilities.js';
import { exteriorFrame } from './north-campus-layout.js';
import { polygonOverlap } from './polygon-collision.js';

export const SPORTS_FLOOR=-.9;
export const LOWERED_SPORTS_IDS=['fac_stadium','fac_basketball'];
const stadium=FACILITIES.find(f=>f.id==='fac_stadium').rings[0];
const basketball=FACILITIES.find(f=>f.id==='fac_basketball').rings[0];
export const STANDS={frame:exteriorFrame(basketball,5),run:4,rows:4,aisleSteps:12,aisleWidth:1.4};
STANDS.aisles=[2,STANDS.frame.length/2,STANDS.frame.length-2];
const f=STANDS.frame;
export const STANDS_RING=[f.at(0,0),f.at(f.length,0),f.at(f.length,STANDS.run),f.at(0,STANDS.run)];
export const SPORTS_CUT_RING=[...stadium,...basketball.slice(3,6),
  f.at(0,STANDS.run),f.at(f.length,STANDS.run),...basketball.slice(6),basketball[0]];
const rect=(f,u0,u1,v0,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>f.at(u,v));
export const SPORTS_SIDE_ENTRIES=[{edge:7,u:20},{edge:4,u:12}].map((q,i)=>({
  ...q,id:`sports_side_steps_${i}`,frame:exteriorFrame(stadium,q.edge),width:3,run:1.8,steps:6
}));
export function standHeight(out,steps=STANDS.rows){
  const step=Math.min(steps,Math.max(0,Math.floor(out/STANDS.run*steps+1e-8)+1));
  return SPORTS_FLOOR*(1-step/steps);
}
export function sideEntryHeight(entry,inward){
  const step=Math.min(entry.steps,Math.max(0,Math.floor(inward/entry.run*entry.steps+1e-8)));
  return SPORTS_FLOOR*step/entry.steps;
}
export function stadiumGroundHeight(x,z){
  const p={x,z},q=f.local(p);
  if(q.u>=0&&q.u<=f.length&&q.out>=0&&q.out<=STANDS.run)
    return standHeight(q.out,STANDS.aisles.some(u=>Math.abs(q.u-u)<=STANDS.aisleWidth/2)?STANDS.aisleSteps:STANDS.rows);
  for(const e of SPORTS_SIDE_ENTRIES){
    const a=e.frame.local(p);
    if(Math.abs(a.u-e.u)<=e.width/2&&a.out<=0&&a.out>=-e.run)return sideEntryHeight(e,-a.out);
  }
  return polygonOverlap(x,z,SPORTS_CUT_RING)?SPORTS_FLOOR:null;
}
export const SPORTS_RETAINING_WALLS=SPORTS_CUT_RING.flatMap((_,edge)=>{
  const frame=exteriorFrame(SPORTS_CUT_RING,edge),mid=frame.at(frame.length/2,0),q=f.local(mid);
  if(Math.abs(q.out-STANDS.run)<.001)return []; // Walk straight from upper road apron.
  const entry=SPORTS_SIDE_ENTRIES.find(e=>Math.abs(e.frame.local(mid).out)<.001&&Math.abs(e.frame.length-frame.length)<.001);
  const spans=entry?[[0,entry.u-entry.width/2],[entry.u+entry.width/2,frame.length]]:[[0,frame.length]];
  return spans.map(([a,b],i)=>({id:`sports_retaining_${edge}_${i}`,polygon:rect(frame,a,b,-.10,0),minY:SPORTS_FLOOR,maxY:.10}));
});
export const SPORTS_COLLIDERS=[...SPORTS_RETAINING_WALLS,
  ...SPORTS_SIDE_ENTRIES.flatMap(e=>[-1,1].map(side=>{
    const u=e.u+side*(e.width/2+.06);
    return {id:`${e.id}_cheek_${side}`,polygon:rect(e.frame,u-.06,u+.06,-e.run,-.1),minY:SPORTS_FLOOR,maxY:.1};
  }))];
const outward=f.at(0,1),origin=f.at(0,0);
export const STANDS_PREVIEW_SPAWN={...f.at(f.length/2,STANDS.run+.2),yaw:Math.atan2(outward.x-origin.x,origin.z-outward.z)};
