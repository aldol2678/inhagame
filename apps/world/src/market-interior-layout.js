import { INTERIOR_SEGMENTS, INTERIOR_COURTS, INTERIOR_GRID, interiorReservationClear } from './market-interior-plan.js';
import { MARKET_COLLIDERS, MARKET_BUILDINGS } from './back-market-layout.js';
import { CULTURE_COLLIDERS, CULTURE_BUILDINGS, cultureRectangle, culturePolygonsOverlap } from './culture-street-layout.js';
import { BACK_ALLEY_COLLIDERS, BACK_ALLEY_BLOCKS } from './back-alley-layout.js';
import { BACK_STREET_COLLIDERS } from './back-street-layout.js';
import { BACK_WEST_COLLIDERS } from './back-west-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { backApproachFootprintClear } from './back-approach-layout.js';
import { polygonOverlap } from './polygon-collision.js';

const fixed=[...MARKET_COLLIDERS,...CULTURE_COLLIDERS,...BACK_ALLEY_COLLIDERS,...BACK_STREET_COLLIDERS,...BACK_WEST_COLLIDERS,...FACILITY_COLLIDERS,...BUILDINGS.map(q=>({polygon:q.vertices}))];
const occupied=fixed.map(q=>q.polygon),additions=[];
for(const phase of [0,2.5,5])for(const [si,s] of INTERIOR_SEGMENTS.entries())for(const side of [-1,1]) {
  for(let station=(s.frame.length>25?8.2:4.4)+phase,index=0;station<s.frame.length-3.2;station+=7.5,index++) {
    const seed=si*7+index*5+(side>0?1:0),w=[4.5,5.4,6.2][seed%3],d=[4.5,5.3,6.3,4.9][seed%4];
    const front=s.road.width/2+1.25+(seed%3)*.16;
    const at=(u,v=0)=>s.frame.at(station+side*u,side*(front+v)),a=at(0),b=at(1);
    const frame={at,yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI};
    const polygon=cultureRectangle(frame,0,d/2,w,d),bounds=cultureRectangle(frame,0,d/2-.15,w+.65,d+.95);
    // Keep source parcels and access to every earlier building, including rear doors.
    if(!backApproachFootprintClear(bounds)||!interiorReservationClear(bounds)||occupied.some(p=>culturePolygonsOverlap(bounds,p)))continue;
    const apron=cultureRectangle(frame,0,-front/2,w+.5,front);
    if(occupied.some(p=>culturePolygonsOverlap(apron,p)))continue;
    const h=[4.5,6.0,7.5,9.0][seed%4],kind=seed%5===0?'mixed':seed%3===0?'villa':'residential';
    const q={id:`market_interior_${si}_${side}_${index}_${phase}`,seed,frame,w,d,h,kind,polygon,bounds,apron,center:at(0,d/2),color:['#ae806b','#c2bbaa','#b8b9af','#897b70'][seed%4],roof:['#6c8980','#888f88','#82969a'][seed%3]};
    additions.push(q);occupied.push(bounds,apron);
  }
}
export const INTERIOR_BUILDINGS=additions;
export const INTERIOR_FURNITURE=INTERIOR_COURTS.flatMap(q=>[
  {id:`${q.id}_bins`,kind:'bins',u:q.u+q.w/2-.65,v:q.v+q.d/2-.65,w:.85,d:.8,h:.75},
  {id:`${q.id}_rack`,kind:q.kind==='yard'?'bikes':'planter',u:q.u-q.w/2+.85,v:q.v+q.d/2-.65,w:1.35,d:.8,h:.8}
]).map(q=>({...q,center:INTERIOR_GRID.at(q.u,q.v),polygon:cultureRectangle(INTERIOR_GRID,q.u,q.v,q.w,q.d)}));
export const INTERIOR_COLLIDERS=[...additions.flatMap(q=>[
  {id:q.id,polygon:q.polygon,minY:0,maxY:q.h+.18},
  {id:`${q.id}_stairs`,polygon:cultureRectangle(q.frame,-q.w*.23,q.d*.67,1.5,1.9),minY:q.h,maxY:q.h+1.4},
  {id:`${q.id}_tank`,polygon:cultureRectangle(q.frame,q.w*.25,q.d*.68,.86,.86),minY:q.h,maxY:q.h+1.1}
]),...INTERIOR_FURNITURE.map(q=>({id:q.id,polygon:q.polygon,minY:0,maxY:q.h}))];
export const INTERIOR_PREVIEWS={
  'market-interior':{...INTERIOR_GRID.at(84,46),yaw:-Math.atan2(INTERIOR_GRID.at(84,47).x-INTERIOR_GRID.at(84,46).x,INTERIOR_GRID.at(84,47).z-INTERIOR_GRID.at(84,46).z)},
  'market-courtyard':{...INTERIOR_GRID.at(25,44),yaw:-Math.atan2(INTERIOR_GRID.at(25,45).x-INTERIOR_GRID.at(25,44).x,INTERIOR_GRID.at(25,45).z-INTERIOR_GRID.at(25,44).z)}
};
export const interiorTreeClear=(p,radius=1.9)=>INTERIOR_COLLIDERS.every(q=>!polygonOverlap(p.x,p.z,q.polygon,radius))&&INTERIOR_SEGMENTS.every(s=>!polygonOverlap(p.x,p.z,s.polygon,radius))&&INTERIOR_COURTS.every(q=>!polygonOverlap(p.x,p.z,q.polygon,radius));
// Rear equipment stays on the original building envelope and has no lane props.
export const INTERIOR_REAR_FACADES=[...MARKET_BUILDINGS,...CULTURE_BUILDINGS,...BACK_ALLEY_BLOCKS].filter(q=>q.style!=='round');
