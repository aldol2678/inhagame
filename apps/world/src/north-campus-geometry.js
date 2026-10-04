// Existing neutral roads/approaches keep their exact support and clearance.
// Photo-informed building presentation is isolated in the imported module.
import { NORTH_LANES, ANNIVERSARY_BACK_GATE_LINKS, NORTH_APPROACHES, FIVE, ANNIVERSARY, exteriorFrame, FIVE_FRONT_TREES } from './north-campus-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { QA, corridor, rect, box } from './public-qa-geometry.js';
import { fillFivePhotoFacade,fillAnniversaryPhotoFacade } from './north-campus-photo-geometry.js';
const bodies=[...FACILITY_COLLIDERS.filter(q=>q.minY===0).map(q=>q.polygon),...BUILDINGS.map(q=>q.vertices)];
export const northSurface=rect;
export function fillNorthRoads(b){for(const s of [...NORTH_LANES,...ANNIVERSARY_BACK_GATE_LINKS])corridor(b,s.frame,s.width,bodies);return b;}
export function fillFiveGardenPaths(b){
  const ring=FIVE.rings[1];
  for(let i=0;i<ring.length;i++){
    const edge=exteriorFrame(ring,i,true);
    const f={length:edge.length,at:(u,v=0)=>edge.at(u,v+1)};
    corridor(b,f,.6,bodies);
  }return b;
}
export function fillFiveFacade(b,tier='NEAR'){return fillFivePhotoFacade(b,tier);}
export function fillAnniversaryFacade(b,tier='NEAR'){return fillAnniversaryPhotoFacade(b,tier);}
export function fillNorthEntrances(b,owner){
  for(const q of NORTH_APPROACHES.filter(q=>q.owner===owner)){
    box(b,q.frame,q.u,q.landing/2,q.height/2,q.width,q.height,q.landing);
    for(let i=0;i<q.steps;i++){
      const depth=q.run/q.steps,top=q.height*(1-i/q.steps);
      box(b,q.frame,q.u,q.landing+(i+.5)*depth,top/2,q.width,top,depth);
    }
  }return b;
}
export function fillNorthFurniture(b,owner){
  if(owner===FIVE.id)for(const p of FIVE_FRONT_TREES){
    b.box(QA.body,[p.x,.5,p.z],[.15,1,.15],0);
    b.crown(QA.edge,[p.x,1.5,p.z],[1,1,1]);
  }return b;
}
