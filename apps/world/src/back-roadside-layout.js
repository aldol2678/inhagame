import { BACK_SEGMENTS, BACK_GATE_FRAME, BACK_TREES } from './back-gate-layout.js';
import { BACK_APPROACH_SEGMENTS } from './back-approach-layout.js';
import { BACK_STREET_BLOCKS, BACK_STREET_COLLIDERS, BACK_CROSSING_STATION, streetFrame } from './back-street-layout.js';
import { BACK_ALLEY_COLLIDERS } from './back-alley-layout.js';
import { BACK_WEST_COLLIDERS } from './back-west-layout.js';
import { BACK_FURNITURE, BACK_WALL_COLLIDERS } from './back-furniture-layout.js';
import { SIDE_GATE_FRAME, SIDE_GATE_COLLIDERS, sideGateTreeClear } from './north-side-gate-layout.js';
import { FACILITY_COLLIDERS, FACILITY_BOUNDS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { roadTreeClear, distanceToRoad } from './campus-road-layout.js';
import { northRoadTreeClear } from './north-campus-layout.js';
import { polygonOverlap } from './polygon-collision.js';

const roads=[...BACK_SEGMENTS,...BACK_APPROACH_SEGMENTS];
const frontage=roads.filter(s=>s.road.osmWayId===1223158575||s.road.style==='avenue');
const obstacles=[...FACILITY_COLLIDERS,...BUILDINGS.map(b=>({polygon:b.vertices})),...BACK_STREET_COLLIDERS,...BACK_ALLEY_COLLIDERS,...BACK_WEST_COLLIDERS,...SIDE_GATE_COLLIDERS,...BACK_WALL_COLLIDERS];
const rect=(f,r)=>[[-r,-r],[r,-r],[r,r],[-r,r]].map(([u,v])=>f.at(u,v));
function frameAt(f,u,v){
  const a=f.at(0),b=f.at(1);
  return {at:(x,z=0)=>f.at(u+x,v+z),yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI};
}
// Both crossing pairs are observed in April 2026 imagery. The side-gate
// source is set back 6.2 WU from its street centerline in its existing layout.
export const BACK_SIGNAL_CROSSINGS=[
  {id:'main',frame:streetFrame(BACK_CROSSING_STATION)},
  {id:'side',frame:frameAt(SIDE_GATE_FRAME,0,6.2)}
];
const signalPoles=BACK_SIGNAL_CROSSINGS.flatMap(q=>[-1,1].map(side=>({
  id:`back_signal_${q.id}_${side}`,frame:frameAt(q.frame,side*3.3,side*4.15),side,kind:'signal',height:3.55,radius:.08
})));
const assets=[];
function add(s,u,v,kind){
  const frame=frameAt(s.frame,u,v),center=frame.at(0),tree=kind==='tree',radius=tree?.14:.07;
  if(center.x-1.5<FACILITY_BOUNDS.minX||center.x+1.5>FACILITY_BOUNDS.maxX||center.z-1.5<FACILITY_BOUNDS.minZ||center.z+1.5>FACILITY_BOUNDS.maxZ)return;
  if(!roadTreeClear(center,.25)||!northRoadTreeClear(center,.25)||!sideGateTreeClear(center,.35))return;
  if(roads.some(r=>distanceToRoad(center,r)<r.road.width/2+radius+.2))return;
  if(obstacles.some(o=>polygonOverlap(center.x,center.z,o.polygon,tree?1.35:.22)))return;
  if(BACK_FURNITURE.some(q=>Math.hypot(center.x-q.center.x,center.z-q.center.z)<q.radius+(tree?1.3:.5)))return;
  if(BACK_TREES.some(p=>Math.hypot(center.x-p.x,center.z-p.z)<2.8))return;
  if(BACK_STREET_BLOCKS.some(q=>{const p=q.frame.at(-3.8,4.1);return Math.hypot(center.x-p.x,center.z-p.z)<1.5;}))return;
  if([...assets,...signalPoles].some(q=>{const p=q.center||q.frame.at(0);return Math.hypot(center.x-p.x,center.z-p.z)<(tree||q.kind==='tree'?3.2:2);} ))return;
  // Keep the main gate forecourt and both crossings free of trunks/poles.
  if([BACK_GATE_FRAME,...BACK_SIGNAL_CROSSINGS.map(q=>q.frame)].some(f=>{
    const a=f.at(0),b=f.at(1),u=(center.x-a.x)*(b.x-a.x)+(center.z-a.z)*(b.z-a.z);
    return Math.abs(u)<3&&Math.hypot(center.x-a.x,center.z-a.z)<10;
  }))return;
  assets.push({id:`back_roadside_${s.id}_${Math.round(u*10)}_${v>0?'shop':'campus'}_${kind}`,frame,center,kind,radius,side:Math.sign(v),height:tree?3.5:kind==='lamp'?4.6:3.4,index:assets.length});
}
// Spacing is continuous across centerline vertices; short OSM segments do not
// restart the row. Trunks sit beside the curb, with branches above walking height.
for(const kind of ['lamp','tree'])for(const side of [-1,1]){
  let chain=0;
  const ordered=[...frontage].sort((a,b)=>a.frame.at(0).x-b.frame.at(0).x);
  for(const s of ordered){
    const step=kind==='tree'?7.6:19,offset=kind==='tree'?4:8;
    for(let u=offset-(chain%step);u<s.frame.length;u+=step)if(u>=0)add(s,u,side*(kind==='tree'?4.65:4.15),kind);
    chain+=s.frame.length;
  }
}
// Narrow lanes use sparse compact service poles, not avenue tree rows.
for(const s of BACK_APPROACH_SEGMENTS.filter(s=>['inha_67_entrance','inha_77_entrance','inha_91_entrance','west_47_lane','west_rear_link'].includes(s.road.id))){
  for(let u=10;u<s.frame.length-3;u+=18)add(s,u,s.road.width/2+.32,'utility');
}
export const BACK_ROADSIDE_ASSETS=assets;
export const BACK_ROADSIDE_COLLIDERS=[...assets,...signalPoles].map(q=>({id:q.id,minY:0,maxY:q.height,polygon:rect(q.frame,q.radius)}));
export const backRoadsideTreeClear=p=>[...assets,...signalPoles].every(q=>{const c=q.center||q.frame.at(0);return Math.hypot(p.x-c.x,p.z-c.z)>3;});
