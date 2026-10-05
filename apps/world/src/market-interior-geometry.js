import { INTERIOR_BUILDINGS, INTERIOR_REAR_FACADES, INTERIOR_FURNITURE } from './market-interior-layout.js';
import { INTERIOR_SEGMENTS, INTERIOR_COURTS, INTERIOR_GRID, INTERIOR_GROUNDS } from './market-interior-plan.js';
import { roadSurface } from './campus-road-geometry.js';
import { buildPolygonSurfaceGeometry } from './reality-adapter.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

const light='#d6d1bf',dark='#555c5d',glass='#57787d',metal='#aeb5b1';
const point=(f,u,v,y)=>{const p=f.at(u,v);return [p.x,y,p.z];};
const box=(b,f,c,u,v,y,w,h,d)=>{const a=f.at(0),z=f.at(1);b.box(c,point(f,u,v,y),[w,h,d],-Math.atan2(z.z-a.z,z.x-a.x)*180/Math.PI);};
function surface(b,c,polygon,y) {
  const g=buildPolygonSurfaceGeometry(polygon,{y});
  for(let i=0;i<g.indices.length;i+=3)b.triangle(c,...g.indices.slice(i,i+3).map(n=>g.positions.slice(n*3,n*3+3)));
}
export function fillInteriorBase(b) {
  for(const q of INTERIOR_GROUNDS)surface(b,'#aaa899',q.polygon,G.UNDERLAY);
  for(const s of INTERIOR_SEGMENTS) {
    const w=s.road.width/2;
    roadSurface(b,'#c1bfb1',s.frame,-.12,s.frame.length+.12,-w-.2,w+.2,G.UNDERLAY);
    roadSurface(b,'#747d7b',s.frame,-.1,s.frame.length+.1,-w,w,G.SURFACE);
  }
  for(const q of INTERIOR_COURTS) {
    surface(b,q.kind==='parking'?'#92968e':'#b6b2a0',q.polygon,G.EDGE);
    if(q.kind==='parking')for(const side of [-1,1]) {
      // Side bays keep the cross-shaped access aisle open through the court.
      const u=q.u+side*2.25;
      for(const du of [-.62,.62])roadSurface(b,light,INTERIOR_GRID,u+du-.025,u+du+.025,q.v-1.15,q.v+1.15,G.PAINT);
      roadSurface(b,light,INTERIOR_GRID,u-.64,u+.64,q.v+1.12,q.v+1.17,G.PAINT);
    }
  }
  for(const q of INTERIOR_BUILDINGS) {
    const f=q.frame;
    surface(b,'#c1bfb1',q.apron,G.EDGE);
    box(b,f,q.color,0,q.d/2,q.h/2,q.w,q.h,q.d);
    box(b,f,q.roof,0,q.d/2,q.h+.015,q.w-.12,.03,q.d-.12);
    for(const side of [-1,1]) {
      box(b,f,q.color,side*(q.w/2-.07),q.d/2,q.h+.09,.14,.18,q.d);
      box(b,f,q.color,0,side<0?.07:q.d-.07,q.h+.09,q.w,.18,.14);
    }
    box(b,f,q.color,-q.w*.23,q.d*.67,q.h+.7,1.5,1.4,1.9);
    box(b,f,dark,-q.w*.23,q.d*.67-.958,q.h+.54,.55,1.08,.025);
    b.tube(metal,point(f,q.w*.25,q.d*.68,q.h+.2),point(f,q.w*.25,q.d*.68,q.h+1.05),.4,10);
    box(b,f,metal,q.w*.25,q.d*.68,q.h+.13,.86,.2,.86);
    box(b,f,dark,0,-.024,.69,.78,1.38,.045);
    // Residential window bands on all sides, instead of shopfront repetitions.
    for(let floor=0;floor<Math.round(q.h/1.5);floor++) {
      const y=.86+floor*1.5;
      for(const u of [-q.w*.31,q.w*.31])for(const v of [-.018,q.d+.018])
        box(b,f,glass,u,v,y,.92,.83,.034);
      for(const side of [-1,1])for(const v of [q.d*.24,q.d*.7])box(b,f,glass,side*(q.w/2+.018),v,y,.034,.83,1.03);
    }
    if(q.kind==='mixed')box(b,f,glass,-q.w*.27,-.032,.79,q.w*.35,1.33,.045);
  }
  for(const q of INTERIOR_FURNITURE) {
    const f=INTERIOR_GRID;
    if(q.kind==='bins')for(const side of [-1,1]) {
      box(b,f,side<0?'#65867b':'#a68b59',q.u+side*.21,q.v,.36,.36,.65,.65);
      box(b,f,dark,q.u+side*.21,q.v,.705,.38,.05,.69);
      box(b,f,light,q.u+side*.21,q.v-.333,.46,.20,.13,.018);
    } else if(q.kind==='planter') {
      box(b,f,'#9b8871',q.u,q.v,.29,1.3,.5,.75);
      box(b,f,'#6d8170',q.u,q.v,.61,1.15,.20,.63);
    } else {
      for(const side of [-1,1]) {
        const u=q.u+side*.42;
        for(let k=0;k<12;k++) {
          const a=k*Math.PI/6,z=(k+1)*Math.PI/6;
          b.tube(dark,point(f,u+.24*Math.cos(a),q.v,.29+.24*Math.sin(a)),point(f,u+.24*Math.cos(z),q.v,.29+.24*Math.sin(z)),.018,4);
        }
        b.tube(metal,point(f,u,q.v,.29),point(f,q.u,q.v,.64),.024,5);
      }
      b.tube(metal,point(f,q.u-.42,q.v,.29),point(f,q.u+.42,q.v,.29),.024,5);
      box(b,f,dark,q.u-.06,q.v,.70,.20,.045,.12);
    }
  }
  return b;
}
export function fillInteriorNear(b,ids) {
  for(const q of INTERIOR_BUILDINGS.filter(q=>ids.includes(q.id))) {
    const f=q.frame;
    for(let floor=0;floor<Math.round(q.h/1.5);floor++)for(const u of [-q.w*.31,q.w*.31])for(const v of [-.05,q.d+.05]) {
      const y=.86+floor*1.5;
      for(const dx of [-.48,0,.48])box(b,f,light,u+dx,v,y,.035,.89,.04);
      for(const dy of [-.43,.43])box(b,f,light,u,v,y+dy,1.0,.04,.05);
    }
    // Recessed entrance canopy, address plate, wall AC and rear service door.
    box(b,f,q.roof,0,-.23,1.49,1.2,.09,.47);
    box(b,f,'#426b70',.62,-.04,1.12,.2,.17,.04);
    box(b,f,dark,0,q.d+.026,.68,.65,1.36,.04);
    box(b,f,light,q.w*.30,q.d+.13,2.35,.58,.35,.26);
    box(b,f,dark,q.w*.30,q.d+.272,2.35,.46,.23,.018);
    b.tube(metal,point(f,-q.w*.44,q.d+.08,.15),point(f,-q.w*.44,q.d+.08,q.h-.12),.037,6);
  }
  // Existing shop rear walls: small doors, high windows and exhaust pipes.
  for(const q of INTERIOR_REAR_FACADES.filter(q=>ids.includes(q.id))) {
    const f=q.frame;
    box(b,f,dark,0,q.d+.015,.7,.67,1.4,.027);
    for(const u of [-q.w*.28,q.w*.28])box(b,f,glass,u,q.d+.025,2.45,.68,.58,.035);
    b.tube(metal,point(f,q.w*.39,q.d+.10,1.6),point(f,q.w*.39,q.d+.10,q.h-.1),.055,6);
  }
  return b;
}
export function fillInteriorDetail(b,ids) {
  for(const q of INTERIOR_BUILDINGS.filter(q=>ids.includes(q.id))) {
    const f=q.frame;
    box(b,f,light,.20,-.055,.7,.025,.23,.035);
    box(b,f,light,.17,q.d+.052,.7,.025,.2,.025);
    if(q.kind==='villa')for(let y=.22;y<q.h-.2;y+=.24)box(b,f,'#916f5e',0,-.012,y,q.w,.012,.012);
    for(const u of [-q.w*.31,q.w*.31])for(let dx=-.36;dx<=.37;dx+=.18)box(b,f,light,u+dx,-.08,.85,.02,.8,.035);
    for(let k=0;k<5;k++)box(b,f,light,q.w*.30-.18+k*.09,q.d+.29,2.35,.018,.21,.02);
  }
  return b;
}
