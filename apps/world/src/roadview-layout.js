// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { FACILITIES } from './campus-facilities.js';
import { HALL_FRONT, BUILDINGS } from './basic-campus.js';
import { GATE_FRAME } from './main-gate-frame.js';
import { mainGateProductionStructure } from './editor/main-gate-production.js';
import { northApproachHeight } from './north-campus-layout.js';
import { polygonOverlap } from './polygon-collision.js';
import { getCanonicalLandmark, projectPolygon } from './reality-adapter.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { gazeboGroundHeight, GAZEBO_COLLIDERS, GAZEBO } from './landmark-detail-layout.js';
import { roadTreeClear } from './campus-road-layout.js';
import { libraryGardenGroundHeight } from './library-garden-layout.js';
import { stadiumGroundHeight } from './stadium-stands-layout.js';
import { LIBRARY_ENTRY_HEIGHT, LIBRARY_FRONT_STAIR, libraryRouteGroundHeight } from './library-route-layout.js';
import { biryongGroundHeight } from './biryong/biryong-layout.js';

export function edgeFrame(ring,index) {
  const a=ring[index],b=ring[(index+1)%ring.length],length=Math.hypot(b.x-a.x,b.z-a.z);
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  const area=ring.reduce((sum,p,i)=>sum+p.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*p.z,0);
  const nx=area>0?tz:-tz,nz=area>0?-tx:tx;
  return {length,yaw:-Math.atan2(tz,tx)*180/Math.PI,
    at:(u,out)=>({x:a.x+tx*u+nx*out,z:a.z+tz*u+nz*out}),
    local:p=>({u:(p.x-a.x)*tx+(p.z-a.z)*tz,out:(p.x-a.x)*nx+(p.z-a.z)*nz})};
}
export const POND_RING=projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
export const POND_TREE_SEATING=Object.freeze({edge:1,us:Object.freeze([6,15,24,33]),out:3.2,slabs:8,
  ringRadius:.65,slabY:.48,slabSize:Object.freeze([.5,.1,.4]),clearance:1.2});
export function pondSeatTrees(){
  const f=edgeFrame(POND_RING,POND_TREE_SEATING.edge);
  return POND_TREE_SEATING.us.map((u,index)=>({index,u,center:f.at(u,POND_TREE_SEATING.out)}))
    .filter(t=>!FACILITY_COLLIDERS.some(c=>polygonOverlap(t.center.x,t.center.z,c.polygon,POND_TREE_SEATING.clearance)));
}
export function pondBankTrees(){
  const result=[];
  for(let i=3;i<POND_RING.length;i++){
    const f=edgeFrame(POND_RING,i);
    for(let u=2;u<f.length;u+=5.8){
      const p=f.at(u,4.4+Math.sin(i+u)*.6);
      if(Math.hypot(p.x-GAZEBO.center.x,p.z-GAZEBO.center.z)<6||!roadTreeClear(p,2.2)||
        [...FACILITY_COLLIDERS,...BUILDINGS.map(b=>({polygon:b.vertices}))].some(c=>polygonOverlap(p.x,p.z,c.polygon,2.2)))continue;
      if(result.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<4))continue;
      result.push({...p,willow:i%3===0});
    }
  }
  // 2026-10-01 field visit: the pond reads strongly through one oversized
  // willow silhouette near the gazebo. Keep every tree at its existing safe
  // generated position; only tag the nearest already-valid tree for presentation.
  const hero=result.reduce((best,p)=>{
    const distance=Math.hypot(p.x-GAZEBO.center.x,p.z-GAZEBO.center.z);
    return !best||distance<best.distance?{p,distance}:best;
  },null);
  if(hero){hero.p.heroWillow=true;hero.p.willow=true;}
  return result;
}
export function pondPromenadeCells(){
  const f=edgeFrame(POND_RING,1),cells=[];
  for(let u=-.5;u<f.length+1;u+=.5)for(let out=4.4;out<7.4;out+=.5){
    const ring=[f.at(u,out),f.at(u+.5,out),f.at(u+.5,out+.5),f.at(u,out+.5)];
    if(ring.some(p=>FACILITY_COLLIDERS.some(c=>polygonOverlap(p.x,p.z,c.polygon,.25))))continue;
    cells.push(ring);
  }
  return cells;
}
export const rectInFrame=(frame,u0,u1,v0,v1)=>[frame.at(u0,v0),frame.at(u1,v0),frame.at(u1,v1),frame.at(u0,v1)];
export const MAIN_HALL_APPROACH={frame:edgeFrame(BUILDINGS.find(b=>b.id==='bldg_01').vertices,5),height:.28,landing:.55,run:1.4,steps:4};
const agora=FACILITIES.find(f=>f.id==='fac_agora_courtyard');
export const AGORA={ring:agora.rings[0],frame:edgeFrame(agora.rings[0],3),height:1.6,run:4.8,steps:12};
AGORA.stairStart=AGORA.frame.length*.30;AGORA.stairEnd=AGORA.frame.length*.66;
AGORA.ramp=rectInFrame(AGORA.frame,AGORA.stairStart,AGORA.stairEnd,-.15,AGORA.run);
const student=FACILITIES.find(f=>f.id==='bldg_07');
export const STUDENT_TERRACES=[2,4,5].map(index=>({id:`student_terrace_${index}`,frame:edgeFrame(student.rings[0],index),height:.6,landing:.85,run:2.4,steps:5}));
// User-authored field-visit presentation contract retained from previously reviewed source.
export const STUDENT_CENTER_FIELDTRIP_PRESENTATION=Object.freeze({
  observedEdges:Object.freeze([0,2,4,5,9,10,12,13,15,16,17]),
  waterfrontEdges:Object.freeze([2,4,5]),
  ribbonYs:Object.freeze([3.6,6.1,8.6,11.1]),
  groundFloorGlass:'#2f5058',
  canopy:'#d7cbb5'
});
export { GATE_FRAME };
const GATE_BOOTH_STRUCTURE=mainGateProductionStructure('gate_security_booth');
export const GATE_BOOTH=GATE_BOOTH_STRUCTURE.footprint;
export const LIBRARY_WEST=edgeFrame(BUILDINGS.find(b=>b.id==='bldg_jungseok').vertices,0);
const libraryRing=BUILDINGS.find(b=>b.id==='bldg_jungseok').vertices;
export const LIBRARY_APPROACHES=[
  {id:'library_front',frame:edgeFrame(libraryRing,6),height:LIBRARY_ENTRY_HEIGHT,...LIBRARY_FRONT_STAIR,steps:22},
  {id:'library_rear',frame:edgeFrame(libraryRing,13),height:.30,landing:1.1,run:1.2,steps:3,inset:.55}
];
export function libraryStairHeight(t,out){
  const step=Math.max(0,Math.min(t.steps,Math.floor((out-t.landing)/t.run*t.steps+1e-8)));
  return t.height*(1-step/t.steps);
}
export const librarySideRailStart=(t,side)=>t.id==='library_front'?(side===0?4:t.landing):0;
export function libraryApproachHeight(x,z){
  for(const t of LIBRARY_APPROACHES){const q=t.frame.local({x,z});
    if(q.u>=t.inset&&q.u<=t.frame.length-t.inset&&q.out>=0&&q.out<=t.landing+t.run)
      return libraryStairHeight(t,q.out);
  }
  return 0;
}

export function roadviewGroundHeight(x,z) {
  const sportsHeight=stadiumGroundHeight(x,z);
  if(sportsHeight!==null)return sportsHeight;
  const gardenHeight=libraryGardenGroundHeight(x,z);
  if(gardenHeight!==null)return gardenHeight;
  const p={x,z};let height=Math.max(libraryRouteGroundHeight(x,z)??0,libraryApproachHeight(x,z),northApproachHeight(x,z),gazeboGroundHeight(x,z),biryongGroundHeight(x,z));
  if(polygonOverlap(x,z,AGORA.ring,0))height=AGORA.height;
  const a=AGORA.frame.local(p);
  if(a.u>=AGORA.stairStart&&a.u<=AGORA.stairEnd&&a.out>=0&&a.out<=AGORA.run)
    height=Math.max(height,AGORA.height*(1-a.out/AGORA.run));
  // Legacy terrace frames remain anchor metadata; the connected model owns student support.
  const t=MAIN_HALL_APPROACH,q=t.frame.local(p);
  if(q.u>=0&&q.u<=t.frame.length&&q.out>=0&&q.out<=t.landing+t.run)
    height=Math.max(height,t.height*Math.min(1,(t.landing+t.run-q.out)/t.run));
  return height;
}

export const ROADVIEW_OBSTACLES=[
  ...GAZEBO_COLLIDERS,
  ...LIBRARY_APPROACHES.flatMap(t=>[0,t.frame.length-t.inset].flatMap((u,i)=>[
    {id:`${t.id}_side_${i}`,polygon:rectInFrame(t.frame,u,u+t.inset,0,t.landing+t.run),minY:0,maxY:t.height},
    {id:`${t.id}_side_rail_${i}`,polygon:rectInFrame(t.frame,u,u+t.inset,librarySideRailStart(t,i),t.landing+t.run),minY:t.height,maxY:t.height+.45}
  ])),
  {id:'gate_security_booth',polygon:GATE_BOOTH,minY:0,maxY:GATE_BOOTH_STRUCTURE.collisionMaxY},
  // Retaining edge also acts as a guard: only the stair opening is walkable.
  ...[[0,AGORA.stairStart],[AGORA.stairEnd,AGORA.frame.length]].map(([a,b],i)=>({
    id:`fac_agora_courtyard_guard_${i}`,polygon:rectInFrame(AGORA.frame,a,b,-.12,.12),minY:0,maxY:AGORA.height+.9
  }))
];
