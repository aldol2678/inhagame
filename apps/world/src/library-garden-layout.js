// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { projectPolygon } from './reality-adapter.js';
import { CAMPUS_ROADS, roadFrame, roadTreeClear } from './campus-road-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { FIVE_FRONT_TREES, exteriorFrame } from './north-campus-layout.js';
import { polygonOverlap } from './polygon-collision.js';

const url=new URL('../data/reality/evidence/roads/library-garden.json',import.meta.url);
const data=typeof window==='undefined'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`Library garden load failed: ${r.status}`);return r.json();})();
export const LIBRARY_GREENS=data.features.map(q=>({...q,polygon:projectPolygon(q.ring)}));
const garden=LIBRARY_GREENS[0],a=garden.polygon[1],b=garden.polygon[2];
export const GARDEN_FRAME=roadFrame(a,b);
GARDEN_FRAME.yaw=-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI;
const buildings=[...FACILITY_COLLIDERS,...BUILDINGS.map(b=>({polygon:b.vertices}))];
const clear=(p,pad=.4)=>roadTreeClear(p,pad)&&!buildings.some(q=>polygonOverlap(p.x,p.z,q.polygon,pad));
const rect=(f,u0,u1,v0,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>f.at(u,v));
export function nearestPolylinePoint(point,vertices){
  let best=null;
  for(let i=1;i<vertices.length;i++){
    const a=vertices[i-1],b=vertices[i],dx=b.x-a.x,dz=b.z-a.z,lengthSq=dx*dx+dz*dz;
    const t=lengthSq<=1e-12?0:Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/lengthSq));
    const hit={x:a.x+dx*t,z:a.z+dz*t},distance=Math.hypot(point.x-hit.x,point.z-hit.z);
    if(!best||distance<best.distance)best={...hit,distance};
  }
  if(!best)throw Error('Polyline requires at least two points');
  return {x:best.x,z:best.z};
}
export const GARDEN_FLOOR=-.6;
export const GARDEN_EDGES=garden.polygon.map((_,i)=>{
  const f=exteriorFrame(garden.polygon,i);
  return {...f,at:(u,v=0)=>f.at(u,-v),local:p=>{const q=f.local(p);return {u:q.u,v:-q.out};}};
});
export const GARDEN_ENTRANCES=[
  {edge:1,u:14,width:2.4,run:2.4,steps:6},
  {edge:1,u:6,width:1.8,run:7.2,steps:0},
  {edge:3,u:6.6,width:2.4,run:2.4,steps:6},
  {edge:5,u:15.1,width:2.4,run:2.4,steps:6}
].map((q,i)=>({...q,id:`library_garden_entry_${i}`,frame:GARDEN_EDGES[q.edge]}));
export function gardenEntryHeight(entry,v){
  const t=Math.max(0,Math.min(1,v/entry.run));
  return GARDEN_FLOOR*(entry.steps?Math.min(entry.steps,Math.floor(t*entry.steps+1e-8))/entry.steps:t);
}
export function libraryGardenGroundHeight(x,z){
  if(!polygonOverlap(x,z,garden.polygon))return null;
  for(const q of GARDEN_ENTRANCES){
    const p=q.frame.local({x,z});
    if(Math.abs(p.u-q.u)<=q.width/2&&p.v>=0&&p.v<=q.run)return gardenEntryHeight(q,p.v);
  }
  return GARDEN_FLOOR;
}
export const GARDEN_WALLS=[...GARDEN_EDGES.flatMap((frame,edge)=>{
  const gaps=GARDEN_ENTRANCES.filter(q=>q.edge===edge).sort((a,b)=>a.u-b.u),spans=[];
  let start=0;
  for(const q of gaps){spans.push([start,q.u-q.width/2]);start=q.u+q.width/2;}
  spans.push([start,frame.length]);
  return spans.filter(([a,b])=>b>a).map(([a,b],i)=>({id:`library_garden_wall_${edge}_${i}`,polygon:rect(frame,a,b,0,.16)}));
}),...GARDEN_ENTRANCES.flatMap(q=>[-1,1].map(side=>{
  const u=q.u+side*(q.width/2+.08);
  return {id:`${q.id}_side_${side}`,polygon:rect(q.frame,u-.08,u+.08,.16,q.run)};
}))];
const libraryWest=exteriorFrame(BUILDINGS.find(b=>b.id==='bldg_jungseok').vertices,0);
const westJoin=libraryWest.at(libraryWest.length,.85);
const westRoad=CAMPUS_ROADS.find(road=>road.id==='road_481241681');
if(!westRoad)throw Error('Jungseok west road 481241681 is required');
export const GARDEN_LIBRARY_ROAD_LINK=[
  westJoin,
  nearestPolylinePoint(westJoin,westRoad.vertices)
];
export const GARDEN_LIBRARY_PATHS=[
  [GARDEN_FRAME.at(14,0),GARDEN_FRAME.at(14,-2)],
  [GARDEN_FRAME.at(6,0),GARDEN_FRAME.at(6,-2)],
  [GARDEN_FRAME.at(14,-2),GARDEN_FRAME.at(0,-2),...GARDEN_LIBRARY_ROAD_LINK]
];
export const GARDEN_BEDS=[2,8,17,24].flatMap(u=>[7,17].map(v=>[u,u+2,v,v+2]))
.map((bounds,i)=>({id:`library_bed_${i}`,bounds,polygon:rect(GARDEN_FRAME,...bounds)}))
  .filter(q=>q.polygon.every(p=>polygonOverlap(p.x,p.z,garden.polygon)&&clear(p,.6)));
function bench(u,v,side,i){
  const f=GARDEN_FRAME,frame={at:(x,z=0)=>f.at(u+side*x,v+side*z),yaw:f.yaw+(side<0?180:0)};
  return {id:`library_garden_bench_${i}`,kind:'bench',frame,center:frame.at(0),polygon:rect(frame,-.6,.6,-.26,.26)};
}
export const GARDEN_BENCHES=[[9.5,4.8,-1],[18,4.8,-1],[9.5,21.2,1],[18,21.2,1]].map((p,i)=>bench(...p,i))
  .filter(q=>q.polygon.every(p=>polygonOverlap(p.x,p.z,garden.polygon)&&clear(p)));
export const GARDEN_SEAT={centerY:.35,slatHeight:.05};
const trees=[];
for(const [areaIndex,area] of LIBRARY_GREENS.entries()){
  const xs=area.polygon.map(p=>p.x),zs=area.polygon.map(p=>p.z);
  for(let x=Math.min(...xs)+1.5;x<Math.max(...xs)-1;x+=3.8)for(let z=Math.min(...zs)+1.5;z<Math.max(...zs)-1;z+=4.1){
    const p={x:x+Math.sin(z)*.45,z:z+Math.cos(x)*.4};
    if(!polygonOverlap(p.x,p.z,area.polygon)||!clear(p,1.3))continue;
    if(![-1,1].every(t=>polygonOverlap(p.x+t,p.z+t,area.polygon)))continue;
    const bed=areaIndex===0?GARDEN_BEDS.find(q=>polygonOverlap(p.x,p.z,q.polygon)):null;
    if(areaIndex===0&&!bed)continue;
    if(FIVE_FRONT_TREES.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<3))continue;
    trees.push({...p,id:`library_garden_tree_${trees.length}`,index:trees.length,base:bed?.32:.02,pine:trees.length%4===0,areaIndex});
  }
}
export const GARDEN_TREES=trees;
export const GARDEN_COLLIDERS=[
  ...GARDEN_WALLS.map(q=>({...q,minY:GARDEN_FLOOR,maxY:.12})),
  ...GARDEN_BEDS.map(q=>({id:q.id,polygon:q.polygon,minY:GARDEN_FLOOR,maxY:GARDEN_FLOOR+.34})),
  ...GARDEN_BENCHES.map(q=>({id:q.id,polygon:q.polygon,minY:GARDEN_FLOOR,maxY:GARDEN_FLOOR+.62})),
  ...trees.map(q=>({id:q.id,polygon:[{x:q.x-.1,z:q.z-.1},{x:q.x+.1,z:q.z-.1},{x:q.x+.1,z:q.z+.1},{x:q.x-.1,z:q.z+.1}],minY:q.areaIndex===0?GARDEN_FLOOR:0,maxY:3.6+(q.areaIndex===0?GARDEN_FLOOR:0)}))
];
export const GARDEN_PREVIEW_SPAWN={...GARDEN_FRAME.at(14,3.5),yaw:-GARDEN_FRAME.yaw*Math.PI/180};
export const libraryGardenTreeClear=p=>LIBRARY_GREENS.every(q=>!polygonOverlap(p.x,p.z,q.polygon,1));
