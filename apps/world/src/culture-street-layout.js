// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { BACK_APPROACH_ROADS, BACK_APPROACH_SEGMENTS, backApproachFootprintClear } from './back-approach-layout.js';
import { BACK_STREET_COLLIDERS } from './back-street-layout.js';
import { BACK_WEST_COLLIDERS } from './back-west-layout.js';
import { polygonOverlap } from './polygon-collision.js';

export const CULTURE_ROAD = BACK_APPROACH_ROADS.find(r => r.id === 'inha_77_entrance');
let length = 0;
export const CULTURE_SEGMENTS = BACK_APPROACH_SEGMENTS.filter(s => s.road === CULTURE_ROAD).map(s => {
  const start = length; length += s.frame.length;
  return { ...s, start, end: length };
});
export const CULTURE_LENGTH = length;
export function cultureFrame(station) {
  const s = CULTURE_SEGMENTS.find(s => station <= s.end) || CULTURE_SEGMENTS.at(-1);
  const at = (u, v = 0) => s.frame.at(station - s.start + u, v);
  const a = at(0), b = at(1);
  return { at, yaw: -Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI };
}
export const culturePoint = (station, v = 0) => cultureFrame(station).at(0, v);
export const CULTURE_GATE_STATION = CULTURE_SEGMENTS[1].end; // OSM node 2445317858
export const CULTURE_GATE = {
  id: 'culture_canopy', frame: cultureFrame(CULTURE_GATE_STATION),
  halfLength: 2.35, halfWidth: 2.2, postRadius: .13,
  roofBottom: 3.4, roofTop: 3.85
};
export const cultureRectangle = (frame, u, v, w, d) =>
  [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => frame.at(u+x*w/2,v+z*d/2));
export function culturePolygonsOverlap(a, b) {
  return [a,b].every(ring => ring.every((p,i) => {
    const q=ring[(i+1)%ring.length], project=r=>r.x*(q.z-p.z)-r.z*(q.x-p.x);
    const aa=a.map(project),bb=b.map(project);
    return Math.max(...aa)>Math.min(...bb)+.02 && Math.max(...bb)>Math.min(...aa)+.02;
  }));
}
const gatePolygon = cultureRectangle(CULTURE_GATE.frame,0,0,5.1,4.9);
const occupied = [...BACK_STREET_COLLIDERS, ...BACK_WEST_COLLIDERS].map(q => q.polygon);
const buildings = [];
function addBuilding({id,station,side,w=5,d=4.7,h=6,style='brick',color='#a87d6a',sign='#426b70',label='식당',front=2.18}) {
  const road = cultureFrame(station);
  // Local +v runs into the building, local -v faces the road, on either side.
  const at=(u,v=0)=>road.at(side*u,side*(front+v));
  const a=at(0),b=at(1),frame={at,yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI};
  const polygon=cultureRectangle(frame,0,d/2,w,d);
  if(!backApproachFootprintClear(polygon)||culturePolygonsOverlap(polygon,gatePolygon)||occupied.some(p=>culturePolygonsOverlap(polygon,p)))return;
  const bounds=cultureRectangle(frame,0,d/2-.32,w+.6,d+1.1);
  const q={id,station,side,w,d,h,style,color,sign,label,frame,polygon,bounds,center:frame.at(0,d/2)};
  buildings.push(q);occupied.push(polygon);
}

// Four compatibility IDs mark synthetic cuboids, not the former corner businesses.
for(const [id,offset,side] of [['yellow',5.3,1],['check',5.3,-1],['dark',-5.5,1],['pink',-5.5,-1]])
  addBuilding({id:`culture_corner_${id}`,station:CULTURE_GATE_STATION+offset,side,w:4,d:4,h:6,style:'public_qa',color:'#598f91',sign:'#d9eeee',label:'QA',front:2.5});
for(const side of [1,-1])for(let station=7,index=0;station<CULTURE_LENGTH-4;station+=6.1,index++)
  addBuilding({id:`culture_shop_${side>0?'west':'east'}_${index}`,station,side,w:4,d:4,h:6,front:2.5,style:'public_qa',color:'#598f91',sign:'#d9eeee',label:'QA'});

const endFrame=cultureFrame(CULTURE_LENGTH);
const cornerAt=(u,v=0)=>endFrame.at(4.9+v,u);
const cornerYaw=-Math.atan2(cornerAt(1).z-cornerAt(0).z,cornerAt(1).x-cornerAt(0).x)*180/Math.PI;
const terminalFrame={at:cornerAt,yaw:cornerYaw};
const terminalRing=[[-2,1],[-2,4],[2,4],[2,1]].map(([u,v])=>cornerAt(u,v));
if(!backApproachFootprintClear(terminalRing)||occupied.some(p=>culturePolygonsOverlap(terminalRing,p)))throw Error('Culture terminal corner overlaps a source corridor/building');
export const CULTURE_TERMINAL={id:'culture_terminal',station:CULTURE_LENGTH+4.9,side:0,w:4,d:3,h:6,style:'public_qa',color:'#598f91',sign:'#d9eeee',label:'QA',frame:terminalFrame,polygon:terminalRing,bounds:terminalRing,center:cornerAt(0,2.4)};
buildings.push(CULTURE_TERMINAL);
export const CULTURE_BUILDINGS=buildings;
export const CULTURE_POSTS=[-1,1].flatMap(a=>[-1,1].map(b=>({u:a*CULTURE_GATE.halfLength,v:b*CULTURE_GATE.halfWidth})));
export const CULTURE_COLLIDERS=[
  ...buildings.map(q=>({id:q.id,polygon:q.polygon,minY:0,maxY:q.h+.18})),
  ...CULTURE_POSTS.map((p,i)=>({id:`culture_canopy_post_${i}`,polygon:cultureRectangle(CULTURE_GATE.frame,p.u,p.v,.37,.37),minY:0,maxY:CULTURE_GATE.roofTop})),
  {id:'culture_canopy_roof',polygon:gatePolygon,minY:3.1,maxY:4.35}
];
export const CULTURE_STREAM_ITEMS=[...buildings,{id:CULTURE_GATE.id,center:CULTURE_GATE.frame.at(0),bounds:gatePolygon}];
export const CULTURE_BOUNDS = (()=>{
  const points=[...buildings.flatMap(q=>q.bounds),...BACK_APPROACH_ROADS.filter(r=>r.id.startsWith('culture_')).flatMap(r=>r.vertices)];
  return {minX:Math.min(...points.map(p=>p.x))-6,maxX:Math.max(...points.map(p=>p.x))+6,
    minZ:Math.min(...points.map(p=>p.z))-6,maxZ:Math.max(...points.map(p=>p.z))+6};
})();
export const CULTURE_PREVIEW_SPAWN={...culturePoint(CULTURE_GATE_STATION-11),yaw:-Math.atan2(culturePoint(CULTURE_GATE_STATION).x-culturePoint(CULTURE_GATE_STATION-11).x,culturePoint(CULTURE_GATE_STATION).z-culturePoint(CULTURE_GATE_STATION-11).z)};
export const cultureTreeClear=(p,radius=1.9)=>CULTURE_COLLIDERS.every(q=>!polygonOverlap(p.x,p.z,q.polygon,radius));
