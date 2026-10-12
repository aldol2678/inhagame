import { WALKWAY_SURFACES, WALKWAY_COLORS as C, WALKWAY_PROPS, WALKWAY_WALL_PROPS, WALKWAY_ENTRANCE as E } from './north-walkway-layout.js';
import { emitSurface, intersectSurface, surfaceRect } from './north-walkway-surface.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
import { QA } from './public-qa-geometry.js';

function clipped(b,s,color,u0,u1,v0,v1,y){
  const rect=surfaceRect(s.frame,u0,u1,v0,v1);
  for(const mask of s.rings){const ring=intersectSurface(rect,mask);if(ring.length)emitSurface(b,color,ring,y);}
}
export function fillWalkwayPaving(b){
  for(const s of WALKWAY_SURFACES){
    if(!s.span){for(const r of s.rings)emitSurface(b,s.id.includes('south_')?C.plaza:QA.ground,r,G.SURFACE);continue;}
    const plaza=s.id.endsWith('_3'),f=s.frame,max=s.span.gap*.69;
    // Existing north-road owner emits each piece exactly once. No overlay slab.
    for(const r of s.rings)emitSurface(b,plaza?C.plaza:C.paving,r,G.SURFACE);
    if(plaza)clipped(b,s,C.band,f.length*.59,f.length+.3,.35,1.25,G.EDGE);
    // Longitudinal rectangular paving rhythm; batched seams, never block boxes.
    for(let v=.35;v<max;v+=.55)clipped(b,s,C.joint,-.3,f.length+.3,v,v+.018,G.PAINT);
    for(let u=0;u<f.length;u+=1.1)clipped(b,s,C.joint,u,u+.014,.35,max,G.PAINT);
    if(plaza){
      for(const t of [.67,.9]){
        const u=f.length*t;clipped(b,s,C.metal,u-.20,u+.20,1.65,1.95,G.DETAIL);
        for(let i=0;i<5;i++)clipped(b,s,C.plaza,u-.18+i*.08,u-.15+i*.08,1.67,1.93,G.DETAIL+.001);
      }
      const center=f.at(f.length*.74,max*.72),r=.32;
      for(let i=0;i<12;i++){
        const at=a=>({x:center.x+r*Math.cos(a),z:center.z+r*Math.sin(a)});
        const ring=[center,at(i*Math.PI/6),at((i+1)*Math.PI/6)];
        for(const mask of s.rings){const cut=intersectSurface(ring,mask);if(cut.length)emitSurface(b,C.metal,cut,G.DETAIL);}
      }
      // Flat visual edging; no invented surveyed curb height or stair collision.
      clipped(b,s,C.plaza,f.length+.12,f.length+.3,.35,max,G.DETAIL);
    }
  }
  return b;
}
const point=(q,u,out,y)=>{const p=q.frame.at(q.u+u,q.out+out);return[p.x,y,p.z];};
const box=(b,q,c,u,out,y,w,h,d)=>b.box(c,point(q,u,out,y),[w,h,d],q.frame.yaw);
const tube=(b,q,c,a,d,r=.035)=>b.tube(c,point(q,...a),point(q,...d),r,6);
function globe(b,p,r){
  // A small 6 x 8 latitude mesh survives silhouette inspection as a globe.
  const at=(lat,lon)=>[p[0]+r*Math.cos(lat)*Math.cos(lon),p[1]+r*Math.sin(lat),p[2]+r*Math.cos(lat)*Math.sin(lon)];
  for(let j=0;j<6;j++)for(let i=0;i<8;i++){
    const a=-Math.PI/2+j*Math.PI/6,c=a+Math.PI/6,u=i*Math.PI/4,v=u+Math.PI/4;
    b.quad(C.globe,at(a,u),at(c,u),at(c,v),at(a,v));
  }
}
export function fillWalkwayProps(b,tier='NEAR'){
  for(const q of [...WALKWAY_PROPS,...WALKWAY_WALL_PROPS]){
    if(tier==='DETAIL'){
      if(q.kind==='pergola')for(let u=-.85;u<=.85;u+=.28)box(b,q,C.wood,u,0,2.65,.07,.09,1.85);
      continue;
    }
    if(q.kind==='tree'){
      box(b,q,C.soil,0,0,.025,1.25,.012,1.25);
      for(const side of [-1,1]){
        box(b,q,C.curb,side*.65,0,.07,.06,.1,1.36);
        box(b,q,C.curb,0,side*.65,.07,1.25,.1,.06);
      }
      tube(b,q,C.wood,[0,0,.05],[0,0,2.4],.10);
      for(const side of [-1,1])tube(b,q,C.wood,[0,0,1.4],[side*.6,0,2.7],.065);
      b.crown(C.leaf,point(q,0,0,3),[2.5,1.9,2.1]);
      box(b,q,C.leaf,0,.95,.35,1.2,.65,.45);
    }else if(q.kind==='globe'){
      tube(b,q,C.metal,[0,0,.03],[0,0,2.8],.045);globe(b,point(q,0,0,2.95),.19);
    }else if(q.kind==='pergola'){
      for(const u of [-.8,.8])for(const v of [-.65,.65])box(b,q,C.wood,u,v,1.3,.12,2.6,.12);
      for(const v of [-.76,.76])box(b,q,C.wood,0,v,2.53,1.95,.16,.12);
      for(const u of [-.85,0,.85])box(b,q,C.wood,u,0,2.55,.11,.14,1.85);
    }else if(q.kind==='planter'){
      box(b,q,C.wood,0,0,.28,.9,.56,.9);b.crown(C.leaf,point(q,0,0,.94),[.85,1.05,.85]);
    }else if(q.kind==='cycles'){
      for(let i=0;i<3;i++){
        const o=(i-1)*1.35;
        for(const u of [-.42,.42]){
          for(let j=0;j<10;j++){
            const a=j*Math.PI/5,d=(j+1)*Math.PI/5;
            tube(b,q,C.metal,[o+u+.27*Math.cos(a),0,.32+.27*Math.sin(a)],[o+u+.27*Math.cos(d),0,.32+.27*Math.sin(d)],.025);
          }
        }
        for(const [a,d]of [[[o-.42,0,.32],[o-.14,0,.8]],[[o-.14,0,.8],[o+.42,0,.32]],[[o+.42,0,.32],[o-.42,0,.32]],[[o+.42,0,.32],[o+.3,0,1.0]]])tube(b,q,i===1?C.wood:C.metal,a,d,.028);
        box(b,q,C.metal,o-.15,0,.82,.26,.06,.16);box(b,q,C.metal,o+.3,0,1,.08,.05,.36);
      }
      box(b,q,C.metal,2.7,0,.16,.65,.07,.18);tube(b,q,C.metal,[2.95,0,.18],[2.95,0,1],.03);box(b,q,C.metal,2.95,0,1,.05,.05,.35);
    }else if(q.kind==='railing'){
      for(const u of [-1.6,-.8,0,.8,1.6])tube(b,q,C.metal,[u,0,.03],[u,0,1.0]);
      for(const y of [.28,1])tube(b,q,C.metal,[-1.6,0,y],[1.6,0,y]);
      // Unlettered fabric bay: no copied announcements, brands or invented use.
      box(b,q,C.curb,0,.03,.62,2.7,.53,.015);
    }
  }
  return b;
}
export function fillWalkwayEntrance(b,c){
  const q={frame:E.frame,u:E.u,out:0};
  for(let i=0;i<4;i++){
    const u=(i-1.5)*E.width/4;
    box(b,q,c.glass,u,.095,1.32,E.width/4-.07,2.6,.12);
    box(b,q,c.metal,u-E.width/8,.19,1.35,.055,2.7,.04);
    box(b,q,c.joint,u+.12,.22,1.1,.025,.55,.03);
  }
  box(b,q,c.glass,0,.095,2.90,E.width,.52,.12);
  box(b,q,c.ribbon,0,.64,2.95,E.width+.5,.22,1.45);
  box(b,q,c.joint,0,1.34,2.92,E.width+.5,.08,.06);
  for(const side of [-1,1])box(b,q,c.metal,side*(E.width/2+.18),.94,1.4,.07,2.8,.07);
  return b;
}
