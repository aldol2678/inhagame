// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { FACILITIES } from './campus-facilities.js';
import { polygonOverlap } from './polygon-collision.js';
import { roadTreeClear, roadFrame } from './campus-road-layout.js';
import { BACK_ROADS } from './back-gate-layout.js';
export const FIVE = FACILITIES.find(f=>f.id==='bldg_05');
export const ANNIVERSARY = FACILITIES.find(f=>f.id==='bldg_60th');
export function exteriorFrame(ring,index,hole=false) {
  const a=ring[index],b=ring[(index+1)%ring.length],f=roadFrame(a,b);
  const area=ring.reduce((s,p,i)=>s+p.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*p.z,0);
  const sign=(area>0?-1:1)*(hole?-1:1),t=f.at(1),tx=t.x-a.x,tz=t.z-a.z;
  return {length:f.length,yaw:-Math.atan2(tz,tx)*180/Math.PI,
    at:(u,out)=>f.at(u,out*sign),local:p=>({u:(p.x-a.x)*tx+(p.z-a.z)*tz,out:((p.x-a.x)*-tz+(p.z-a.z)*tx)*sign})};
}
export const NORTH_APPROACHES=[
  {id:'five_south_entry',owner:FIVE.id,frame:exteriorFrame(FIVE.rings[0],7),u:10,width:4,height:.3,landing:.8,run:1.2,steps:3},
  {id:'anniversary_east_entry',owner:ANNIVERSARY.id,frame:exteriorFrame(ANNIVERSARY.rings[0],0),u:22,width:5,height:.65,landing:.75,run:.85,steps:7}
];
const FIVE_SOUTH_APPROACH = NORTH_APPROACHES.find(entry=>entry.id==='five_south_entry');
export const FIVE_SOUTH_ENTRY_APPROACH = Object.freeze(
  FIVE_SOUTH_APPROACH.frame.at(
    FIVE_SOUTH_APPROACH.u,
    FIVE_SOUTH_APPROACH.landing + FIVE_SOUTH_APPROACH.run + 1.2
  )
);
export function northApproachHeight(x,z) {
  let height=0;
  for(const t of NORTH_APPROACHES){const q=t.frame.local({x,z});
    if(Math.abs(q.u-t.u)<=t.width/2&&q.out>=0&&q.out<=t.landing+t.run)
      height=Math.max(height,t.height*Math.min(1,(t.landing+t.run-q.out)/t.run));
  }
  return height;
}
const east=exteriorFrame(ANNIVERSARY.rings[0],0);
const anniversaryEastLane={id:'anniversary_east_lane',frame:roadFrame(east.at(-3,3.1),east.at(east.length+2,3.1)),width:2.8};
const anniversaryPerimeterLanes=[1,2,3,4].map(i=>{const f=exteriorFrame(ANNIVERSARY.rings[0],i);return {id:`anniversary_perimeter_lane_${i}`,frame:roadFrame(f.at(-.3,2.2),f.at(f.length+.3,2.2)),width:2.6};});
export const NORTH_LANES=[anniversaryEastLane,...anniversaryPerimeterLanes];

// Road Network v2 P0: source way 216916384 remains truncated before it reaches the
// 60th Anniversary footprint. The safe bypass uses the existing east-side lane and joins
// it to source way 216916383 at its last retained OSM node. No hand-authored world point.
const backGateService=BACK_ROADS.find(r=>r.osmWayId===216916383);
if(!backGateService)throw Error('Back-gate service road 216916383 is required');
const anniversaryBackJoin=backGateService.vertices.at(-1);
const perimeterOne=anniversaryPerimeterLanes.find(l=>l.id==='anniversary_perimeter_lane_1');
export const ANNIVERSARY_BACK_GATE_LINKS=[
  {id:'anniversary_back_gate_link',frame:roadFrame(anniversaryEastLane.frame.at(anniversaryEastLane.frame.length),anniversaryBackJoin),width:3.5},
  {id:'anniversary_perimeter_join',frame:roadFrame(perimeterOne.frame.at(0),anniversaryBackJoin),width:2.8}
];
export const FIVE_FRONTAGES=[2,6,7].map(i=>exteriorFrame(FIVE.rings[0],i));

export function northRoadTreeClear(p,radius=1.9) {
  return [...NORTH_LANES,...ANNIVERSARY_BACK_GATE_LINKS].every(s=>{
    const a=s.frame.at(0),b=s.frame.at(s.frame.length),dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)>s.width/2+radius;
  });
}
export const FIVE_FRONT_TREES=[...FIVE_FRONTAGES].flatMap(f=>[4,8,12,16,20].filter(u=>u<f.length-1).map(u=>f.at(u,8)))
  .filter(p=>roadTreeClear(p,1.3)&&northRoadTreeClear(p,1.3)&&!FACILITIES.some(f=>f.kind==='building'
    ? f.parts.some(r=>polygonOverlap(p.x,p.z,r,1.3))
    : f.kind==='ground'&&f.rings.some(r=>polygonOverlap(p.x,p.z,r,1.3))));
