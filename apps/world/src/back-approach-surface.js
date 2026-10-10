import { BACK_SEGMENTS } from './back-gate-layout.js';
import { BACK_APPROACH_SEGMENTS } from './back-approach-layout.js';

// Subtract a road rectangle from a pavement polygon. Cutting the actual polygon
// preserves angled mouths; lifting one surface over another hides road markings.
function half(poly,distance,inside){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b);
    const ia=inside?da>=0:da<=0,ib=inside?db>=0:db<=0;
    if(ia)out.push(a);
    if(ia!==ib){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
  }
  return out;
}
export function subtractRoadFootprint(poly,s,pad=0){
  const a=s.frame.at(0),b=s.frame.at(1),tx=b.x-a.x,tz=b.z-a.z,h=s.road.width/2+pad;
  const u=p=>(p.x-a.x)*tx+(p.z-a.z)*tz,v=p=>-(p.x-a.x)*tz+(p.z-a.z)*tx;
  const planes=[p=>u(p)+.15,p=>s.frame.length+.15-u(p),p=>v(p)+h,p=>h-v(p)];
  if(planes.some(d=>poly.every(p=>d(p)<=0)))return [poly];
  let remaining=poly;const pieces=[];
  for(const d of planes){
    const outside=half(remaining,d,false);if(outside.length>=3)pieces.push(outside);
    remaining=half(remaining,d,true);if(remaining.length<3)break;
  }
  return pieces;
}
const main=[...BACK_SEGMENTS.filter(s=>s.road.osmWayId===1223158575),...BACK_APPROACH_SEGMENTS.filter(s=>s.road.style==='avenue')];
export function approachSurface(b,color,s,u0,u1,v0,v1,y,detail=false){
  if(u1<=u0||v1<=v0)return;
  let pieces=[[s.frame.at(u0,v0),s.frame.at(u0,v1),s.frame.at(u1,v1),s.frame.at(u1,v0)]];
  const masks=s.road.style==='avenue'?[]:main;
  for(const mask of masks)pieces=pieces.flatMap(p=>subtractRoadFootprint(p,mask));
  // Drainage lines and tile seams stop at side junctions as well.
  if(detail)for(const mask of BACK_APPROACH_SEGMENTS.filter(t=>t.road!==s.road&&t.road.style!=='avenue'))
    pieces=pieces.flatMap(p=>subtractRoadFootprint(p,mask,.12));
  for(const p of pieces)for(let i=1;i<p.length-1;i++)b.triangle(color,...[p[0],p[i],p[i+1]].map(q=>[q.x,y,q.z]));
}
