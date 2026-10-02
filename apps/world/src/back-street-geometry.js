// Independent public QA geometry: uniform primitives, no visual-reference input.
import { BACK_STREET_BLOCKS, BACK_STREET_RAILS, BACK_STREET_SEGMENTS, BACK_CROSSING_STATION, streetFrame } from './back-street-layout.js';
import { QA, box, building, corridor, rect } from './public-qa-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
export function fillBackStreetBase(b){for(const s of BACK_STREET_SEGMENTS)corridor(b,s.frame,s.road.width);for(const q of BACK_STREET_BLOCKS)building(b,q,q.front);return b;}
export function fillBackStreetNear(b,ids){for(const q of BACK_STREET_BLOCKS.filter(q=>ids.includes(q.id)))box(b,q.frame,0,q.front,1.5,1,1,.04,QA.edge);return b;}
export function fillBackStreetDetail(b,ids){for(const q of BACK_STREET_BLOCKS.filter(q=>ids.includes(q.id)))box(b,q.frame,0,q.front,2.4,1,.1,.04,QA.edge);return b;}
export function fillBackStreetSignals(b){
  for(const q of BACK_STREET_RAILS)box(b,q.frame,0,0,.325,q.w,.65,.14,QA.edge);
  const f=streetFrame(BACK_CROSSING_STATION);
  for(let u=-1.5;u<1.5;u+=.5)rect(b,f,u,u+.25,-4.5,5.3,G.PAINT,QA.edge);
  return b;
}
