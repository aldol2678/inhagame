// Neutral commercial facades on the unchanged public gameplay envelopes.
import { BACK_STREET_BLOCKS, BACK_STREET_RAILS, BACK_STREET_SEGMENTS, BACK_CROSSING_STATION, streetFrame } from './back-street-layout.js';
import { QA, box, corridor, rect } from './public-qa-geometry.js';
import { fillShopfrontBase, fillShopfrontNear, fillShopfrontDetail } from './backgate-shopfront-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
export function fillBackStreetPaving(b){for(const s of BACK_STREET_SEGMENTS)corridor(b,s.frame,s.road.width);return b;}
export function fillBackStreetBase(b){fillBackStreetPaving(b);for(const q of BACK_STREET_BLOCKS)fillShopfrontBase(b,q);return b;}
export function fillBackStreetNear(b,ids){for(const q of BACK_STREET_BLOCKS.filter(q=>ids.includes(q.id)))fillShopfrontNear(b,q);return b;}
export function fillBackStreetDetail(b,ids){for(const q of BACK_STREET_BLOCKS.filter(q=>ids.includes(q.id)))fillShopfrontDetail(b,q);return b;}
export function fillBackStreetSignals(b){
  for(const q of BACK_STREET_RAILS)box(b,q.frame,0,0,.325,q.w,.65,.14,QA.edge);
  const f=streetFrame(BACK_CROSSING_STATION);
  for(let u=-1.5;u<1.5;u+=.5)rect(b,f,u,u+.25,-4.5,5.3,G.PAINT,QA.edge);
  return b;
}
