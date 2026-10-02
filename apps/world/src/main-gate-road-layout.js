// Main Gate Editor P1: the committed WorldDocument is the production authority for
// Sosung-ro, gate sidewalks/crossings and the Dormitory 1 entry connector.
import { HALL_FRONT } from './basic-campus.js';
import { GATE_FRAME } from './roadview-layout.js';
import { roadFrame, distanceToRoad } from './campus-road-layout.js';
import { mainGateProductionPath } from './editor/main-gate-production.js';

const g=GATE_FRAME.at;
const authored=id=>mainGateProductionPath(id);

export const SOSUNG_RO=authored('sosung_ro_frontage');
export const MAIN_GATE_APPROACH_ROAD=authored('main_gate_approach');
export const GATE_DORM_ROADS=[SOSUNG_RO,MAIN_GATE_APPROACH_ROAD];

export const GATE_DORM_PATHS=[
  authored('sosung_north_sidewalk_west'),
  authored('sosung_north_sidewalk_east'),
  authored('sosung_south_sidewalk'),
  authored('main_gate_pedestrian_exit'),
  authored('dorm1_entry_path')
];
export const GATE_DORM_CROSSINGS=[
  authored('sosung_crossing_west'),
  authored('sosung_crossing_east')
];
export const MAIN_GATE_INNER_ZEBRA=authored('main_gate_inner_zebra');

export const GATE_DORM_CORRIDORS=[...GATE_DORM_ROADS,...GATE_DORM_PATHS,...GATE_DORM_CROSSINGS];
export const GATE_DORM_SEGMENTS=GATE_DORM_CORRIDORS.flatMap(road=>road.vertices.slice(1).map((b,i)=>({
  id:`${road.id}_${i}`,road,frame:roadFrame(road.vertices[i],b)
})));

const exit=GATE_DORM_PATHS.find(path=>path.id==='main_gate_pedestrian_exit');
const eastCrossing=GATE_DORM_CROSSINGS.find(path=>path.id==='sosung_crossing_east');
const dormEntry=GATE_DORM_PATHS.find(path=>path.id==='dorm1_entry_path');
export const GATE_DORM_WALK_ROUTE=[
  ...exit.vertices,
  eastCrossing.vertices.at(-1),
  ...dormEntry.vertices
];
export const gateDormRoadTreeClear=(p,radius=1.9)=>GATE_DORM_SEGMENTS.every(s=>distanceToRoad(p,s)>s.road.width/2+radius);
export const GATE_DORM_ROUTE_SPAWN={...g(11,-21),yaw:-Math.atan2(HALL_FRONT.inward.x,HALL_FRONT.inward.z)};
