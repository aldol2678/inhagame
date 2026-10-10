import { BACKGATE_TRANSIT, BACKGATE_TRANSIT_FRAME as f, BACKGATE_TRANSIT_CONNECTOR } from './backgate-transit-layout.js';
import { BACK_SEGMENTS } from '../back-gate-layout.js';
import { BACK_APPROACH_SEGMENTS } from '../back-approach-layout.js';
import { roadFrame } from '../campus-road-layout.js';
import { FLAT_GROUND_Y as G } from '../flat-ground-surface.js';

// Keep new pavement off all current asphalt/entrance polygons. Existing crossings and painted
// markings retain their surface ownership; clipping introduces no raised curb or movement change.
function half(poly,d,inside) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],da=d(a),db=d(b),ia=inside?da>=0:da<=0,ib=inside?db>=0:db<=0;
    if(ia)out.push(a);
    if(ia!==ib){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
  }
  return out;
}
function subtract(poly,s) {
  const a=s.frame.at(0),b=s.frame.at(1),tx=b.x-a.x,tz=b.z-a.z,h=s.road.width/2;
  const u=p=>(p.x-a.x)*tx+(p.z-a.z)*tz,v=p=>-(p.x-a.x)*tz+(p.z-a.z)*tx;
  const planes=[p=>u(p)+.15,p=>s.frame.length+.15-u(p),p=>v(p)+h,p=>h-v(p)];
  if(planes.some(d=>poly.every(p=>d(p)<=0)))return [poly];
  let remaining=poly;const pieces=[];
  for(const d of planes){const o=half(remaining,d,false);if(o.length>=3)pieces.push(o);remaining=half(remaining,d,true);if(remaining.length<3)break;}
  return pieces;
}
export function fillBackgateTransit(b) {
  for(let i=1;i<BACKGATE_TRANSIT_CONNECTOR.length;i++) {
    const a=BACKGATE_TRANSIT_CONNECTOR[i-1],c=BACKGATE_TRANSIT_CONNECTOR[i],s=roadFrame(a,c);
    let pieces=[[s.at(0,-.65),s.at(s.length,-.65),s.at(s.length,.65),s.at(0,.65)]];
    for(const mask of [...BACK_SEGMENTS,...BACK_APPROACH_SEGMENTS])pieces=pieces.flatMap(p=>subtract(p,mask));
    for(const p of pieces)for(let j=1;j<p.length-1;j++) {
      const v=[p[0],p[j],p[j+1]],up=(v[1].z-v[0].z)*(v[2].x-v[0].x)-(v[1].x-v[0].x)*(v[2].z-v[0].z);
      if(up<0)v.reverse();b.triangle('#9aa69a',...v.map(q=>[q.x,G.SURFACE,q.z]));
    }
  }
  const {u,pole}=BACKGATE_TRANSIT, yaw=-Math.atan2(f.at(1).z-f.at(0).z,f.at(1).x-f.at(0).x)*180/Math.PI;
  b.box('#456270',[pole.x,.9,pole.z],[.16,1.8,.16],yaw);
  b.box('#173b49',[pole.x,1.45,pole.z],[1.15,.5,.12],yaw);
  // Separate colour bands: real 511 information above, game F1 preparation below.
  b.box('#5c9b70',[pole.x,1.58,pole.z],[1.16,.22,.13],yaw);
  b.box('#367b91',[pole.x,1.32,pole.z],[1.16,.22,.13],yaw);
  const wx=u-1.3;
  const ring=[f.at(wx-.4,-4.6),f.at(wx-.4,-3.9),f.at(wx+.4,-3.9),f.at(wx+.4,-4.6)];
  // Clockwise in x/z => upward normal in the renderer.
  b.quad('#73b8b5',...ring.map(p=>[p.x,G.DETAIL,p.z]));
  return b;
}
export function backgateTransitSignRecords() {
  const {u}=BACKGATE_TRANSIT;
  return [['37165 · 511',1.47,1.67],['F1 · 준비중',1.21,1.41]].map(([label,y0,y1])=>{
    const a=f.at(u-.53,-4.82),b=f.at(u+.53,-4.82);
    return {label,corners:[[a.x,y0,a.z],[b.x,y0,b.z],[b.x,y1,b.z],[a.x,y1,a.z]]};
  });
}
