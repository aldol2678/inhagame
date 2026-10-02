import { BACK_SEGMENTS, BACK_GATE_FRAME, BACK_GATE_COLLIDERS, BACK_TREES } from './back-gate-layout.js';
import { BACK_APPROACH_SEGMENTS, backApproachClear } from './back-approach-layout.js';
import { SIDE_GATE_FRAME, SIDE_GATE_COLLIDERS, sideGateTreeClear } from './north-side-gate-layout.js';
import { northRoadTreeClear } from './north-campus-layout.js';
import { roadTreeClear, distanceToRoad } from './campus-road-layout.js';
import { FACILITY_COLLIDERS, FACILITY_BOUNDS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { polygonOverlap } from './polygon-collision.js';

// Campus-side planting and benches follow the previously observed April 2026
// Inha-ro frontage. Individual positions and dimensions are presentation estimates.
const roads=[...BACK_SEGMENTS.filter(s=>s.road.osmWayId===1223158575),...BACK_APPROACH_SEGMENTS.filter(s=>s.road.style==='avenue')];
const obstacles=[...FACILITY_COLLIDERS,...BUILDINGS.map(b=>({polygon:b.vertices})),...BACK_GATE_COLLIDERS,...SIDE_GATE_COLLIDERS];
function inOpening(p,f,halfWidth){
  const a=f.at(0),b=f.at(1),tx=b.x-a.x,tz=b.z-a.z;
  const u=(p.x-a.x)*tx+(p.z-a.z)*tz,v=-(p.x-a.x)*tz+(p.z-a.z)*tx;
  return Math.abs(u)<halfWidth&&v>-8&&v<5;
}
const items=[];
function routeClear(center,radius,mainOpening=15,sideOpening=7){
  if(center.x-radius<FACILITY_BOUNDS.minX||center.x+radius>FACILITY_BOUNDS.maxX||center.z-radius<FACILITY_BOUNDS.minZ||center.z+radius>FACILITY_BOUNDS.maxZ)return false;
  if(inOpening(center,BACK_GATE_FRAME,mainOpening)||inOpening(center,SIDE_GATE_FRAME,sideOpening))return false;
  return roadTreeClear(center,radius)&&northRoadTreeClear(center,radius)&&sideGateTreeClear(center,radius)&&backApproachClear(center,radius+.3)
    &&BACK_SEGMENTS.every(t=>distanceToRoad(center,t)>=t.road.width/2+radius+.3)
    &&obstacles.every(t=>!polygonOverlap(center.x,center.z,t.polygon,radius+.3));
}
function place(s,u,kind){
  const radius=kind==='tree'?1.65:kind==='bench'?.85:.7;
  const center=s.frame.at(u,-6.5),a=s.frame.at(0),b=s.frame.at(1);
  if(!routeClear(center,radius))return;
  if(BACK_TREES.some(p=>Math.hypot(p.x-center.x,p.z-center.z)<radius+1.7)||items.some(q=>Math.hypot(q.center.x-center.x,q.center.z-center.z)<q.radius+radius+.4))return;
  const frame={at:(x,v=0)=>s.frame.at(u+x,-6.5+v),yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI};
  items.push({id:`back_furniture_${s.id}_${Math.round(u*10)}_${kind}`,kind,center,frame,radius,index:items.length});
}
for(const s of roads)for(let u=4;u<s.frame.length-2;u+=12){
  place(s,u,'tree');
  if(u+3.2<s.frame.length-1)place(s,u+3.2,'bench');
  if(u+5.6<s.frame.length-1)place(s,u+5.6,'planter');
}
export const BACK_FURNITURE=items;
export const BACK_BENCH_SEAT=Object.freeze({centerY:.33,slatHeight:.055});
// April 2026 panoramas distinguish the solid wall west of the side gate,
// open hedged seating frontage, and pale balustrade opposite the 91 alley.
// These extent/setback estimates follow the road, independently of bench count.
export const BACK_FURNITURE_WALLS=roads.flatMap(s=>{
  const walls=[];
  for(let start=0;start<s.frame.length-.3;start+=1.6){
    const w=Math.min(1.6,s.frame.length-start),u=start+w/2,roadPoint=s.frame.at(u);
    if(roadPoint.x>258)continue; // Do not extend the observed campus boundary beyond this frontage.
    const kind=roadPoint.x<SIDE_GATE_FRAME.at(0).x-2?'solid':roadPoint.x>209?'balustrade':'hedge';
    const v=kind==='solid'?-7.7:kind==='hedge'?-8.6:-7.5;
    const height=kind==='solid'?1.35:kind==='hedge'?.48:.9,center=s.frame.at(u,v);
    const samples=[-w/2,0,w/2].map(x=>s.frame.at(u+x,v));
    if(samples.some(p=>!routeClear(p,.3,11.5,2.5)||BACK_TREES.some(t=>Math.hypot(p.x-t.x,p.z-t.z)<.5)))continue;
    const a=s.frame.at(0),b=s.frame.at(1);
    walls.push({id:`back_wall_${s.id}_${Math.round(start*10)}`,w,center,kind,height,
      frame:{at:(x,d=0)=>s.frame.at(u+x,v+d),yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI}});
  }
  return walls;
});
export const BACK_WALL_COLLIDERS=BACK_FURNITURE_WALLS.map(q=>({id:q.id,minY:0,maxY:q.height,
  polygon:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>q.frame.at(u*q.w/2,v*(q.kind==='hedge'?.3:.15)))}));
export const BACK_FURNITURE_COLLIDERS=items.map(q=>{
  const [w,d,h]=q.kind==='tree'?[.26,.26,3.25]:q.kind==='bench'?[1.1,.46,.62]:[1.1,.55,.44];
  return {id:q.id,minY:0,maxY:h,polygon:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>q.frame.at(u*w/2,v*d/2))};
});
export const backFurnitureTreeClear=p=>items.every(q=>Math.hypot(p.x-q.center.x,p.z-q.center.z)>q.radius+2)
  &&BACK_FURNITURE_WALLS.every(q=>Math.hypot(p.x-q.center.x,p.z-q.center.z)>2.2);
