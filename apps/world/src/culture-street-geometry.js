// Neutral culture facades; legacy market helper behavior stays unchanged.
import { CULTURE_SEGMENTS, CULTURE_BUILDINGS, CULTURE_GATE, CULTURE_POSTS, CULTURE_GATE_STATION } from './culture-street-layout.js';
import { QA, box, building } from './public-qa-geometry.js';
import { fillShopfrontBase, fillShopfrontNear, fillShopfrontDetail } from './backgate-shopfront-geometry.js';
import { approachSurface } from './back-approach-surface.js';
import { roadSurface } from './campus-road-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
const facadeIds=new Set(CULTURE_BUILDINGS.map(q=>q.id));
export function fillCulturePaving(b){
  // Existing approaches own the base tiles/blue margins. Reapply only the
  // station-continuous paint, clipped away from the mapped road junctions.
  for(const s of CULTURE_SEGMENTS){
    const f=s.frame,h=s.road.width/2;
    for(let u=0;u<f.length;u+=.35)for(const side of [-1,1]){
      const end=Math.min(u+.35,f.length),a=s.start+u,z=s.start+end,band=Math.floor(z/9)*9;
      // Give transverse bands and the plaza ring exclusive paint ownership.
      if(a<CULTURE_GATE_STATION+2.65&&z>CULTURE_GATE_STATION-2.65)continue;
      if(band>=3&&a<band+.48&&z>band)continue;
      const v=side*(h-.48+.12*Math.sin((s.start+(u+end)/2)*Math.PI/9));
      approachSurface(b,'#d8b453',s,u,end,v-.025,v+.025,G.DETAIL,true);
    }
    for(let station=Math.ceil(s.start/9)*9;station<s.end;station+=9){
      if(station<3||(station<CULTURE_GATE_STATION+2.65&&station+.48>CULTURE_GATE_STATION-2.65))continue;
      approachSurface(b,'#6c9290',s,Math.max(0,station-s.start),Math.min(f.length,station-s.start+.48),-h,h,G.DETAIL,true);
    }
  }
  const f=CULTURE_GATE.frame;
  // The plaza overlays the approach's blue edge but remains below tile paint.
  roadSurface(b,'#6c9290',f,-2.45,2.45,-2.15,2.15,(G.EDGE+G.PAINT)/2);
  for(let i=0;i<48;i++){
    const a=i*Math.PI/24,c=(i+1)*Math.PI/24;
    const p=(r,t)=>{const q=f.at(r*Math.cos(t),r*Math.sin(t));return[q.x,G.DETAIL,q.z];};
    b.quad('#e6e4d3',p(1.52,a),p(1.52,c),p(1.63,c),p(1.63,a));
  }
  return b;
}
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
