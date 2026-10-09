import { BUILDINGS,SITE_FEATURES } from './basic-campus.js';
import { FACILITIES } from './campus-facilities.js';
import { WORLD_BOUNDS,OBSTACLES } from './campus-layout.js';
import { ROAD_SEGMENTS,CAMPUS_PATH_WIDTHS,roadFrame } from './campus-road-layout.js';
import { POND_RING,MAIN_HALL_APPROACH,LIBRARY_APPROACHES,rectInFrame } from './roadview-layout.js';
import { LIBRARY_GREENS,GARDEN_FLOOR,GARDEN_BENCHES,GARDEN_WALLS,GARDEN_BEDS,GARDEN_ENTRANCES,GARDEN_LIBRARY_PATHS } from './library-garden-layout.js';
import { SPORTS_CUT_RING } from './stadium-stands-layout.js';
import { MAIN_GATE_GROUND_MASKS } from './main-gate-surface-ownership.js';
import { contactMask,contactEllipse,buildContactGeometry } from './campus-contact-shading-geometry.js';

export const CONTACT_BUILDING_IDS=Object.freeze(['bldg_01','bldg_jungseok']);
export const CONTACT_CHUNK_IDS=Object.freeze(['RC_0_0','RC_-1_-1']);
export const CONTACT_BUDGET=Object.freeze({baseTriangles:300,
  nearTriangles:Object.freeze({'RC_0_0':40,'RC_-1_-1':260}),totalTriangles:600,
  meshes:3,bufferBytes:256*1024});
const frameRect=(f,width)=>rectInFrame(f,-.25,f.length+.25,-width/2,width/2);
const lawns=SITE_FEATURES.filter(f=>f.kind==='lawn');
const pathMasks=SITE_FEATURES.filter(f=>f.kind==='path').flatMap(f=>f.vertices.slice(1).map((p,i)=>
  frameRect(roadFrame(f.vertices[i],p),(CAMPUS_PATH_WIDTHS[f.id]||3.5)+2.1)));
const stairs=[MAIN_HALL_APPROACH,...LIBRARY_APPROACHES].map(q=>
  rectInFrame(q.frame,-.15,q.frame.length+.15,-.15,q.landing+q.run+.15));
const water=[POND_RING,...SITE_FEATURES.filter(f=>f.kind==='reflecting_pool').map(f=>f.vertices)];
const routes=GARDEN_LIBRARY_PATHS.flatMap(path=>path.slice(1).map((p,i)=>frameRect(roadFrame(path[i],p),1.4)));
// Unknown paving and raised surfaces are excluded, not projected to the actor's
// y=0. Inflated library road margins also exclude its parking-apron geometry.
const exclusions=[...water,LIBRARY_GREENS[0].polygon,SPORTS_CUT_RING,...MAIN_GATE_GROUND_MASKS,
  ...pathMasks,...routes,...stairs,
  ...ROAD_SEGMENTS.map(s=>frameRect(s.frame,s.road.width+2*s.road.shoulder+6)),
  ...FACILITIES.filter(f=>f.kind==='ground').map(f=>f.rings[0]),
  ...OBSTACLES.filter(q=>q.minY<=.018 && q.maxY>=0).map(q=>q.polygon)];
const masks=exclusions.map(contactMask);
let flatReceivers;
function receivers() {
  if(flatReceivers)return flatReceivers;
  const b=WORLD_BOUNDS,foundation=[{x:b.minX,z:b.minZ},{x:b.minX,z:b.maxZ},
    {x:b.maxX,z:b.maxZ},{x:b.maxX,z:b.minZ}];
  flatReceivers=[...lawns.map(f=>({id:f.id,y:.018,mask:contactMask(f.vertices),exclude:masks})),
    {id:'foundation',y:0,mask:contactMask(foundation),exclude:[...masks,...lawns.map(f=>contactMask(f.vertices))]}];
  return flatReceivers;
}
function wallPatches() {
  return BUILDINGS.filter(b=>CONTACT_BUILDING_IDS.includes(b.id)).flatMap(building=>{
    const ring=building.vertices,area=ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0);
    return ring.flatMap((a,i)=>{
      // Entrances/west facade have their own steps/columns/parking owner.
      if(building.id==='bldg_01' && i===5 || building.id==='bldg_jungseok' && [0,6,13].includes(i))return [];
      const b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      if(len<.5)return [];
      const nx=(area>0?dz:-dz)/len,nz=(area>0?-dx:dx)/len;
      const p=(u,v,alpha)=>({x:a.x+dx*u/len+nx*v,z:a.z+dz*u/len+nz*v,alpha});
      return [{id:`${building.id}:edge:${i}`,kind:'building',pieces:[
        [p(.1,.015,.16),p(len-.1,.015,.16),p(len-.1,.13,.08),p(.1,.13,.08)],
        [p(.1,.13,.08),p(len-.1,.13,.08),p(len-.1,.32,0),p(.1,.32,0)]]}];
    });
  });
}
export function campusBaseContactGeometry() {
  const garden={id:'garden',y:GARDEN_FLOOR,mask:contactMask(LIBRARY_GREENS[0].polygon),exclude:[
    ...[...GARDEN_WALLS,...GARDEN_BEDS].map(q=>contactMask(q.polygon)),
    ...GARDEN_ENTRANCES.map(q=>contactMask(rectInFrame(q.frame,q.u-q.width/2-.1,q.u+q.width/2+.1,0,q.run+.1)))]};
  const benches=GARDEN_BENCHES.map(q=>({id:q.id,kind:'bench',receiver:'garden',
    pieces:contactEllipse(q.center,(u,v)=>q.frame.at(u,v),.68,.36,.14)}));
  return buildContactGeometry([...benches,...wallPatches()],[garden,...receivers()],
    {maxTriangles:CONTACT_BUDGET.baseTriangles});
}
export function campusTreeContactGeometry(chunk) {
  if(!CONTACT_CHUNK_IDS.includes(chunk.id))return null;
  const patches=chunk.trees.map(q=>({id:q.id,kind:'tree',pieces:contactEllipse(q,
    (u,v)=>({x:q.x+u,z:q.z+v}),.48,.48,.15)}));
  return buildContactGeometry(patches,receivers(),{maxTriangles:CONTACT_BUDGET.nearTriangles[chunk.id]});
}
