// Neutral culture facades; legacy market helper behavior stays unchanged.
import { CULTURE_SEGMENTS, CULTURE_BUILDINGS, CULTURE_GATE, CULTURE_POSTS } from './culture-street-layout.js';
import { QA, box, building, corridor } from './public-qa-geometry.js';
import { fillShopfrontBase, fillShopfrontNear, fillShopfrontDetail } from './backgate-shopfront-geometry.js';
const facadeIds=new Set(CULTURE_BUILDINGS.map(q=>q.id));
export function fillCulturePaving(b){for(const s of CULTURE_SEGMENTS)corridor(b,s.frame,s.road.width);return b;}
export function fillStreetBuildingBase(b,buildings){for(const q of buildings)building(b,q);return b;}
export function fillCultureBase(b){
  for(const q of CULTURE_BUILDINGS)fillShopfrontBase(b,q);
  const q=CULTURE_GATE;
  for(const p of CULTURE_POSTS)box(b,q.frame,p.u,p.v,q.roofTop/2,.26,q.roofTop,.26);
  box(b,q.frame,0,0,(q.roofBottom+q.roofTop)/2,2*q.halfLength+.4,q.roofTop-q.roofBottom,2*q.halfWidth+.4,QA.edge);
  return b;
}
export function fillCultureNear(b,ids,buildings=CULTURE_BUILDINGS){
  for(const q of buildings.filter(q=>ids.includes(q.id))) {
    if(facadeIds.has(q.id))fillShopfrontNear(b,q);
    else box(b,q.frame,0,.04,1.5,Math.min(1,q.w/2),1,.04,QA.edge);
  }
  return b;
}
export function fillCultureDetail(b,ids,buildings=CULTURE_BUILDINGS){
  for(const q of buildings.filter(q=>ids.includes(q.id))) {
    if(facadeIds.has(q.id))fillShopfrontDetail(b,q);
    else box(b,q.frame,0,.06,2.4,Math.min(1,q.w/2),.1,.04,QA.edge);
  }
  return b;
}
