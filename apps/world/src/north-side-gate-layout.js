// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { geoToWorld } from './geo-coordinates.js';
import { roadFrame, distanceToRoad } from './campus-road-layout.js';
import { FIVE, ANNIVERSARY, exteriorFrame } from './north-campus-layout.js';

export const SIDE_GATE_SOURCE=geoToWorld(37.4516913,126.6546437);
const street=roadFrame(geoToWorld(37.4517233,126.6546715),geoToWorld(37.4514268,126.6558634));
const anchor=street.at(0,-6.2),direction=street.at(1,-6.2);
export const SIDE_GATE_FRAME={...roadFrame(anchor,direction),yaw:-Math.atan2(direction.z-anchor.z,direction.x-anchor.x)*180/Math.PI};
const west=exteriorFrame(ANNIVERSARY.rings[0],2),five=exteriorFrame(FIVE.rings[0],18);
const entry=SIDE_GATE_FRAME.at(0,-1.8),junction=west.at(0,2.2);
export const SIDE_GATE_PATHS=[
  {id:'side_gate_entry',frame:roadFrame(SIDE_GATE_FRAME.at(0,2.7),entry),width:3.4},
  {id:'side_gate_anniversary',frame:roadFrame(entry,junction),width:3.0},
  {id:'side_gate_five',frame:roadFrame(junction,five.at(0,2.2)),width:2.4},
  {id:'side_gate_five_north',frame:roadFrame(five.at(0,2.2),five.at(18,2.2)),width:2.4}
];
export const SIDE_GATE_BOXES=[
  ...[-1,1].map((side,i)=>({id:`side_gate_pillar_${i}`,u:side*2,v:-.35,w:.4,d:.4,minY:0,maxY:1.7})),
  {id:'side_gate_noticeboard',u:3.35,v:-.4,w:2,d:.2,minY:.18,maxY:1.7},
  ...[-1,1].map((side,i)=>({id:`side_gate_bollard_${i}`,u:side*.85,v:.25,w:.12,d:.12,minY:0,maxY:.52})),
  ...[-1,1].map((side,i)=>({id:`side_gate_railing_${i}`,u:side*1.8,v:-1.8,w:.10,d:2.7,minY:0,maxY:.65}))
];
export const SIDE_GATE_COLLIDERS=SIDE_GATE_BOXES.map(q=>({id:q.id,minY:q.minY,maxY:q.maxY,
  polygon:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>SIDE_GATE_FRAME.at(q.u+u*q.w/2,q.v+v*q.d/2))}));
export const sideGateTreeClear=(p,radius=1.9)=>SIDE_GATE_PATHS.every(s=>distanceToRoad(p,s)>s.width/2+radius);
