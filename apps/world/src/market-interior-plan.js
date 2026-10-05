import { BACK_APPROACH_ROADS } from './back-approach-layout.js';
import { roadFrame } from './campus-road-layout.js';
import { cultureRectangle, culturePolygonsOverlap } from './culture-street-layout.js';

// Presentation estimates inside the observed street network, NOT surveyed roads.
const origin=BACK_APPROACH_ROADS.find(r=>r.id==='inha_67_entrance').vertices[0];
const end=BACK_APPROACH_ROADS.find(r=>r.id==='inha_77_entrance').vertices[0];
export const INTERIOR_GRID=roadFrame(origin,end);
const uv=p=>{const a=INTERIOR_GRID.at(1),dx=a.x-origin.x,dz=a.z-origin.z;return {u:(p.x-origin.x)*dx+(p.z-origin.z)*dz,v:-(p.x-origin.x)*dz+(p.z-origin.z)*dx};};
function onRoad(id,u) {
  const points=BACK_APPROACH_ROADS.find(r=>r.id===id).vertices;
  for(let i=1;i<points.length;i++) {
    const a=uv(points[i-1]),b=uv(points[i]);
    if(u>=Math.min(a.u,b.u)&&u<=Math.max(a.u,b.u))return a.v+(b.v-a.v)*(u-a.u)/(b.u-a.u);
  }
  throw Error(`Interior access misses ${id}`);
}
const raw=[
  ['west-lower',[[25,onRoad('culture_cross_west',25)],[25,14]]],
  ['west-middle',[[25,onRoad('culture_cross_west',25)],[25,onRoad('culture_67_link',25)]]],
  ['west-upper',[[32,onRoad('culture_67_link',32)],[32,onRoad('culture_47_junction',32)]]],
  ['east-court',[[84,onRoad('culture_cross_east',84)],[84,25]]],
  ['east-spine',[[84,onRoad('culture_cross_east',84)],[84,onRoad('culture_47_junction',84)]]],
  ['west-yard',[[11,18],[25,18],[41,18]]],
  ['west-link',[[11,50],[25,50],[41,50]]],
  ['upper-yard',[[21,80],[32,80],[44,80]]],
  ['east-south',[[63,58],[84,58],[105,58]]],
  ['east-middle',[[63,85],[84,85],[103,85]]],
  ['east-north',[[63,108],[84,108],[95,108]]]
];
export const INTERIOR_PATHS=raw.map(([id,line])=>({id:`interior_${id}`,vertices:line.map(p=>INTERIOR_GRID.at(...p)),width:1.8,estimated:true}));
export const INTERIOR_SEGMENTS=INTERIOR_PATHS.flatMap(r=>r.vertices.slice(1).map((p,i)=>{
  const frame=roadFrame(r.vertices[i],p);
  return {id:`${r.id}_${i}`,road:r,frame,polygon:cultureRectangle(frame,frame.length/2,0,frame.length+1.1,r.width+1.1)};
}));
export const INTERIOR_COURTS=[
  {id:'west_shared_yard',u:25,v:18,w:6,d:6,kind:'yard'},
  {id:'west_parking',u:25,v:50,w:7,d:7,kind:'parking'},
  {id:'upper_shared_yard',u:32,v:80,w:6,d:6,kind:'yard'},
  {id:'east_parking',u:84,v:85,w:7,d:7,kind:'parking'},
  {id:'east_shared_yard',u:84,v:108,w:6,d:6,kind:'yard'}
].map(q=>({...q,center:INTERIOR_GRID.at(q.u,q.v),polygon:cultureRectangle(INTERIOR_GRID,q.u,q.v,q.w,q.d)}));
export const interiorReservationClear=ring=>[...INTERIOR_SEGMENTS,...INTERIOR_COURTS].every(q=>!culturePolygonsOverlap(ring,q.polygon));
export const INTERIOR_GROUNDS=[
  [[3,7],[48,7],[48,32],[3,32]],[[4,39],[48,39],[48,63],[4,63]],
  [[8,70],[48,70],[48,103]],[[58,22],[110,22],[110,32],[58,32]],
  [[58,39],[108,39],[96,134],[58,107]]
].map((ring,i)=>({id:`interior_ground_${i}`,polygon:ring.map(p=>INTERIOR_GRID.at(...p))}));
