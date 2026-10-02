// Independent public QA geometry: uniform primitives, no visual-reference input.
import { NORTH_LANES, NORTH_APPROACHES, FIVE, ANNIVERSARY, exteriorFrame, FIVE_FRONT_TREES } from './north-campus-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { QA, corridor, rect, box } from './public-qa-geometry.js';
const bodies=[...FACILITY_COLLIDERS.filter(q=>q.minY===0).map(q=>q.polygon),...BUILDINGS.map(q=>q.vertices)];
export const northSurface=rect;
export function fillNorthRoads(b){for(const s of NORTH_LANES)corridor(b,s.frame,s.width,bodies);return b;}
export function fillFiveGardenPaths(b){
  const ring=FIVE.rings[1];
  for(let i=0;i<ring.length;i++){
    const edge=exteriorFrame(ring,i,true);
    const f={length:edge.length,at:(u,v=0)=>edge.at(u,v+1)};
    corridor(b,f,.6,bodies);
  }return b;
}
function facade(b,f){
  for(const [i] of f.rings[0].entries()){
    const edge=exteriorFrame(f.rings[0],i);
    // One inset neutral panel per edge; no original facade rhythm or profile.
    if(edge.length>2)box(b,edge,edge.length/2,.015,f.height/2,Math.min(edge.length-1,2),1,.02,QA.edge);
  }return b;
}
export function fillFiveFacade(b){return facade(b,FIVE);}
export function fillAnniversaryFacade(b){return facade(b,ANNIVERSARY);}
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
