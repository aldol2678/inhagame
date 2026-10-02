// Independent public QA geometry: uniform primitives, no visual-reference input.
import { CULTURE_SEGMENTS, CULTURE_BUILDINGS, CULTURE_GATE, CULTURE_POSTS } from './culture-street-layout.js';
import { QA, box, building, corridor } from './public-qa-geometry.js';
export function fillCulturePaving(b){for(const s of CULTURE_SEGMENTS)corridor(b,s.frame,s.road.width);return b;}
export function fillStreetBuildingBase(b,buildings){for(const q of buildings)building(b,q);return b;}
export function fillCultureBase(b){
  fillStreetBuildingBase(b,CULTURE_BUILDINGS);
  const q=CULTURE_GATE;
  for(const p of CULTURE_POSTS)box(b,q.frame,p.u,p.v,q.roofTop/2,.26,q.roofTop,.26);
  box(b,q.frame,0,0,(q.roofBottom+q.roofTop)/2,2*q.halfLength+.4,q.roofTop-q.roofBottom,2*q.halfWidth+.4,QA.edge);
  return b;
}
export function fillCultureNear(b,ids,buildings=CULTURE_BUILDINGS){
  for(const q of buildings.filter(q=>ids.includes(q.id)))box(b,q.frame,0,.04,1.5,Math.min(1,q.w/2),1,.04,QA.edge);
  return b;
}
export function fillCultureDetail(b,ids,buildings=CULTURE_BUILDINGS){
  for(const q of buildings.filter(q=>ids.includes(q.id)))box(b,q.frame,0,.06,2.4,Math.min(1,q.w/2),.1,.04,QA.edge);
  return b;
}
