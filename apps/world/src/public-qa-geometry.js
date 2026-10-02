// Independent public QA geometry: uniform primitives, no visual-reference input.
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
import { polygonOverlap } from './polygon-collision.js';
export const QA={body:'#598f91',edge:'#d9eeee',ground:'#758b89'};
export function quad(b,ring,y=G.SURFACE,color=QA.ground){
  const pts=ring.map(p=>[p.x,y,p.z]);
  const [a,c,d]=pts;
  if((c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2])<0)pts.reverse();
  b.quad(color,...pts); return b;
}
export function rect(b,f,u0,u1,v0,v1,y=G.SURFACE,color=QA.ground){
  return quad(b,[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(p=>f.at(...p)),y,color);
}
export function box(b,f,u,v,y,w,h,d,color=QA.body){
  const p=f.at(u,v); b.box(color,[p.x,y,p.z],[w,h,d],f.yaw||0); return b;
}
export function corridor(b,f,width,bodies=[]){
  // Subdivide to clip at source outlines, so the visual never obscures a building.
  for(let u=0;u<f.length;u+=.5){
    const ring=[[u,-width/2],[Math.min(u+.5,f.length),-width/2],[Math.min(u+.5,f.length),width/2],[u,width/2]].map(p=>f.at(...p));
    const center=f.at((u+Math.min(u+.5,f.length))/2);
    if([...ring,center].some(p=>bodies.some(q=>polygonOverlap(p.x,p.z,q,.05))))continue;
    quad(b,ring);
  }return b;
}
export function building(b,q,front=0){
  // Bodies use their actual collision polygon, including non-rectangular terminals.
  const p=q.polygon;
  if(p){
    for(let i=0;i<p.length;i++){
      const a=p[i],c=p[(i+1)%p.length];
      b.quad(QA.body,[a.x,0,a.z],[c.x,0,c.z],[c.x,q.h,c.z],[a.x,q.h,a.z]);
    }
    if(p.length===4)quad(b,p,q.h,QA.edge);
  }else box(b,q.frame,0,front+q.d/2,q.h/2,q.w,q.h,q.d);
  return b;
}
