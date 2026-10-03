import { GATE_DORM_SEGMENTS, SOSUNG_RO, GATE_DORM_CROSSINGS, MAIN_GATE_INNER_ZEBRA } from './main-gate-road-layout.js';
import { GATE_FRAME } from './roadview-layout.js';
import { roadFrame } from './campus-road-layout.js';
import { roadSurface } from './campus-road-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
import { MAIN_GATE_LEVELS as L } from './main-gate-terrain-layout.js';

export function fillMainGateRoads(batch) {
  const asphalt='#666f70',paving='#b9b4a6',white='#eee9da',yellow='#d6b65a';
  const crossings=new Set(GATE_DORM_CROSSINGS.map(q=>q.id));
  // Roads first, then a flush sidewalk overlay above the lawn/asphalt owner.
  for(const s of GATE_DORM_SEGMENTS.filter(s=>!crossings.has(s.road.id))) {
    const f=s.frame,h=s.road.width/2,path=s.road.kind==='PATH';
    const surfaceY=path?L.sidewalk:L.road;
    roadSurface(batch,path?paving:asphalt,f,-.08,f.length+.08,-h,h,surfaceY);
    if(path) {
      const edgeY=L.paint,detailY=L.joint;
      for(const side of [-1,1])roadSurface(batch,'#d5d0bf',f,0,f.length,side*h-.04,side*h+.04,edgeY);
      for(let u=.5;u<f.length;u+=1.1)roadSurface(batch,'#aaa798',f,u,Math.min(u+.018,f.length),-h,h,detailY);
    }
  }
  const f=roadFrame(...SOSUNG_RO.vertices);
  // Four lanes with a centre double yellow. Keep the gate junction and crossings clear.
  const clear=u=>Math.abs(u)<8||Math.abs(u-11)<1.8||Math.abs(u+11)<1.8;
  for(let u=-34;u<85;u+=.5)if(!clear(u))for(const v of [-.12,.12])
    roadSurface(batch,yellow,f,u+35,u+35+.5,v-.027,v+.027,G.PAINT);
  for(let u=-33;u<84;u+=3)if(!clear(u)&&!clear(u+1.3))for(const v of [-2.5,2.5])
    roadSurface(batch,white,f,u+35,u+36.3,v-.035,v+.035,G.PAINT);
  for(const side of [-1,1])for(let u=-35;u<86;u+=.5) {
    if((side>0&&Math.abs(u)<8)||Math.abs(u-11)<1.5||Math.abs(u+11)<1.5)continue;
    roadSurface(batch,yellow,f,u+35,u+35+.5,side*4.85-.025,side*4.85+.025,G.DETAIL);
  }

  // Editor-authored inner-gate zebra. The path centerline owns position/length and
  // widthMeters owns the crossing span; paint remains a flat production rendering detail.
  {
    const c=roadFrame(...MAIN_GATE_INNER_ZEBRA.vertices),h=MAIN_GATE_INNER_ZEBRA.width/2;
    for(let v=-h+.325;v<=h-.325+1e-9;v+=1.1)
      roadSurface(batch,white,c,0,c.length,v-.325,v+.325,L.zebra);
  }

  for(const crossing of GATE_DORM_CROSSINGS) {
    const c=roadFrame(...crossing.vertices),h=crossing.width/2;
    for(let u=1.05;u<11;u+=.8)roadSurface(batch,white,c,u,Math.min(u+.42,11),-h,h,G.PAINT);
    for(const u of [.25,11.75])roadSurface(batch,'#d2b762',c,u-.22,u+.22,-h,h,G.DETAIL);
  }
  // Drainage grates stay at the curb, outside both zebra landings.
  for(const u of [-26,24,52,80])for(const v of [-19,-9]) {
    const p=GATE_FRAME.at(u,v),yaw=GATE_FRAME.yaw;
    batch.box('#586260',[p.x,G.SURFACE,p.z],[.7,.016,.24],yaw);
  }
  return batch;
}
