// Restore presentation around the existing pedestrian-gate collision envelopes.
import { SIDE_GATE_PATHS, SIDE_GATE_BOXES, SIDE_GATE_FRAME as gate } from './north-side-gate-layout.js';
import { roadSurface } from './campus-road-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
const stone='#b4b4a8',light='#e6e4d3',metal='#505b5b',yellow='#d8b453';
const point=(u,v,y)=>{const p=gate.at(u,v);return[p.x,y,p.z];};
const box=(b,c,u,v,y,w,h,d)=>b.box(c,point(u,v,y),[w,h,d],gate.yaw);
export function fillNorthSideGate(b){
  for(const s of SIDE_GATE_PATHS){const f=s.frame,h=s.width/2;
    // Side-gate stone owns the join above the north-road base, below edge paint.
    roadSurface(b,stone,f,0,f.length,-h,h,(G.SURFACE+G.EDGE)/2);
    for(let u=.5;u<f.length-.02;u+=.5)roadSurface(b,'#69716e',f,u,Math.min(u+.018,f.length),-h,h,G.PAINT);
    for(let v=-h+.5;v<h-.02;v+=.5)roadSurface(b,'#69716e',f,0,f.length,v,Math.min(v+.018,h),G.PAINT);
  }
  roadSurface(b,stone,gate,-4.8,4.8,-.1,2.7,G.EDGE);
  for(let u=-4.5;u<4.8;u+=.5)roadSurface(b,'#69716e',gate,u,Math.min(u+.018,4.8),-.1,2.7,G.PAINT);
  for(let v=.4;v<2.7;v+=.5)roadSurface(b,'#69716e',gate,-4.8,4.8,v,Math.min(v+.018,2.7),G.PAINT);
  roadSurface(b,yellow,gate,-1.4,1.4,2.1,2.5,G.DETAIL);
  roadSurface(b,yellow,gate,-.18,.18,.4,2.1,G.DETAIL);
  for(const q of SIDE_GATE_BOXES){
    if(q.id.includes('railing')){
      const start=q.v-q.d/2+.025,end=q.v+q.d/2-.025;
      for(let v=start;v<=end;v+=.44)b.tube(light,point(q.u,v,.02),point(q.u,v,.625),.025,5);
      for(const y of [.22,.625])b.tube(light,point(q.u,start,y),point(q.u,end,y),.025,5);
    }else{
      box(b,q.id.includes('bollard')?metal:stone,q.u,q.v,(q.minY+q.maxY)/2,q.w,q.maxY-q.minY,q.d);
      if(q.id.includes('bollard'))box(b,yellow,q.u,q.v,.41,q.w+.002,.09,q.d+.002);
    }
  }
  // Generic unlettered notice panels, without copied notices or personal data.
  box(b,light,3.35,-.285,.95,1.95,1.25,.025);
  const panels=[yellow,'#6c9290','#69716e'];
  for(let i=0;i<4;i++)for(let j=0;j<3;j++)box(b,panels[(i+j)%3],2.65+i*.46,-.265,.54+j*.36,.37,.29,.015);
  box(b,metal,3.35,-.28,1.68,2,.04,.04);
  // Existing internal-lane crossing stays entirely flat.
  const f=SIDE_GATE_PATHS[1].frame;
  for(let i=0;i<5;i++){const u=f.length-1.4+i*.6;roadSurface(b,light,f,u,u+.3,-1.45,1.45,G.DETAIL);}
  return b;
}
