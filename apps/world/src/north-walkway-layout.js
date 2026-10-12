// P-06/P-07: observed forms, fitted to existing WGS84 -> geoToWorld outlines.
// Every number below is a reversible game fit, NEVER a measured metre value.
import { FIVE, ANNIVERSARY, NORTH_LANES, ANNIVERSARY_BACK_GATE_LINKS, exteriorFrame, FIVE_FRONT_TREES } from './north-campus-layout.js';
import { SIDE_GATE_PATHS } from './north-side-gate-layout.js';
import { ROAD_SEGMENTS, roadFrame, distanceToRoad, roadTreeClear } from './campus-road-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { triangulatePolygon } from './reality-adapter.js';
import { polygonOverlap } from './polygon-collision.js';
import { cutSurfaces, surfaceRect } from './north-walkway-surface.js';

export const WALKWAY_EVIDENCE=Object.freeze({
  status:'DERIVED_BLOCKOUT',photos:Object.freeze(['P-06','P-07']),
  survey:Object.freeze(Object.fromEntries(['corridor_width_m','corridor_length_m','plaza_dimensions_m',
    'tree_spacing_m','lamp_spacing_m','branch_angles','slope','level_changes'].map(k=>[k,null]))),
  surveyStatus:'SURVEY_TBD',fiveEastFacade:'FACADE_TBD',
  deferred:Object.freeze(['current_crosswalk','bench','fixed_bike_rack','bollard','stairs','tree_species'])
});
export const WALKWAY_COLORS=Object.freeze({paving:'#b9b4a6',plaza:'#c5c4bc',band:'#a37765',joint:'#8d8e85',
  curb:'#deded1',soil:'#65594b',wood:'#77604a',leaf:'#657a47',metal:'#505b5b',globe:'#e6e4d3'});
const west=[2,3].map(i=>exteriorFrame(ANNIVERSARY.rings[0],i));
const fiveEdges=FIVE.rings[0].map((p,i)=>roadFrame(p,FIVE.rings[0][(i+1)%FIVE.rings[0].length]));
const gapAt=(f,u)=>Math.min(...fiveEdges.map(frame=>distanceToRoad(f.at(u,0),{frame})));
// A planted western margin is reserved before expanding the EXISTING lane owner.
export const WALKWAY_SPANS=west.map((frame,i)=>({id:`anniversary_perimeter_lane_${i+2}`,frame,
  gap:Math.min(...[.1,.35,.65,.9].map(t=>gapAt(frame,t*frame.length))),evidence:'P-06'}));
const lane=id=>NORTH_LANES.find(s=>s.id===id),end=s=>s.frame.at(s.frame.length);
const road=ROAD_SEGMENTS.find(s=>s.road.osmWayId===216916384&&s.id.endsWith('_2'));
export const WALKWAY_LINKS=[
  {id:'anniversary_south_corner_link',frame:roadFrame(end(lane('anniversary_perimeter_lane_3')),lane('anniversary_perimeter_lane_4').frame.at(0)),width:2.6},
  {id:'anniversary_south_road_link',frame:roadFrame(end(lane('anniversary_perimeter_lane_4')),end(road)),width:2.6}
].map(s=>({...s,status:'DERIVED_BLOCKOUT',evidence:'P-07 / W-05 topology; endpoints from existing owners'}));
export const WALKWAY_SOUTH_ANCHOR=end(road);
export const WALKWAY_ENTRANCE=Object.freeze({frame:west[1],u:west[1].length*.80,width:west[1].length*.19,
  status:'DERIVED_BLOCKOUT',orientation:'INFERRED',evidence:'P-07; west podium near southern end'});

const bodies=[...FACILITY_COLLIDERS.filter(q=>q.minY===0).map(q=>q.polygon),...BUILDINGS.map(q=>q.vertices)];
const localBodies=bodies.filter(r=>r.some(p=>p.x>-60&&p.x<85&&p.z>40&&p.z<145));
const bodyMasks=localBodies.flatMap(r=>{const t=triangulatePolygon(r);return Array.from({length:t.length/3},(_,i)=>t.slice(i*3,i*3+3).map(j=>r[j]));});
export const WALKWAY_EXTERNAL_MASKS=[
  ...ROAD_SEGMENTS.filter(s=>s.frame.at(0).x<85&&s.frame.at(s.frame.length).z>35).map(s=>surfaceRect(s.frame,-.15,s.frame.length+.15,-s.road.width/2-s.road.shoulder,s.road.width/2+s.road.shoulder)),
  ...SIDE_GATE_PATHS.map(s=>surfaceRect(s.frame,0,s.frame.length,-s.width/2,s.width/2))
];
const candidates=[...NORTH_LANES,...ANNIVERSARY_BACK_GATE_LINKS,...WALKWAY_LINKS].map(s=>{
  const span=WALKWAY_SPANS.find(q=>q.id===s.id);
  const frame=span?.frame||s.frame;
  return {id:s.id,frame,span,ring:span?surfaceRect(frame,-.3,frame.length+.3,.35,span.gap*.69):surfaceRect(frame,0,frame.length,-s.width/2,s.width/2)};
});
const owned=[];
// Public source for both 3D paving and map polygons. Earlier owners win joins.
export const WALKWAY_SURFACES=candidates.map(s=>{
  const rings=cutSurfaces([s.ring],[...bodyMasks,...WALKWAY_EXTERNAL_MASKS,...owned]);
  owned.push(...rings);return {...s,rings};
});
export const WALKWAY_PROPS=WALKWAY_SPANS.flatMap((s,index)=>{
  const out=s.gap*.84,items=[];
  for(const [i,t]of [.18,.48,.78].entries()){
    items.push({id:`walkway_tree_${index}_${i}`,kind:'tree',frame:s.frame,u:s.frame.length*t,out,radius:.65});
    items.push({id:`walkway_globe_${index}_${i}`,kind:'globe',frame:s.frame,u:s.frame.length*(t+.09),out:s.gap*.73,radius:.16});
  }
  if(index===0)items.push({id:'walkway_pergola',kind:'pergola',frame:s.frame,u:s.frame.length*.64,out,radius:.95});
  if(index===1)items.push({id:'walkway_planter',kind:'planter',frame:s.frame,u:s.frame.length*.95,out,radius:.6});
  return items.map(q=>({...q,position:q.frame.at(q.u,q.out),status:'DERIVED_BLOCKOUT',evidence:'P-06/P-07'}));
}).filter(q=>roadTreeClear(q.position,q.radius)&&!localBodies.some(r=>polygonOverlap(q.position.x,q.position.z,r,q.radius))
  &&!FIVE_FRONT_TREES.some(p=>Math.hypot(q.position.x-p.x,q.position.z-p.z)<q.radius+1.3));
// Supplemental wall props keep the existing lane centre and player capsule clear.
export const WALKWAY_WALL_PROPS=[
  {id:'walkway_cycles',kind:'cycles',frame:west[0],u:west[0].length*.32,out:.56,radius:.4},
  {id:'walkway_banner_bay',kind:'railing',frame:west[0],u:west[0].length*.64,out:.58,radius:.4}
].map(q=>({...q,position:q.frame.at(q.u,q.out),status:'DERIVED_BLOCKOUT',evidence:'P-06'}));
export const walkwayTreeClear=(p,radius=1.9)=>!WALKWAY_SURFACES.some(s=>s.span&&s.rings.some(r=>polygonOverlap(p.x,p.z,r,radius)))
  &&[...WALKWAY_PROPS,...WALKWAY_WALL_PROPS].every(q=>Math.hypot(p.x-q.position.x,p.z-q.position.z)>radius+q.radius);
