// Collision uses the same footprint as rendering, including concave setbacks.
import { triangulatePolygon } from './reality-adapter.js';
const dot = (a,b) => a.x*b.x+a.z*b.z;
function edges(polygon) {
  const area = polygon.reduce((s,p,i)=>{const q=polygon[(i+1)%polygon.length];return s+p.x*q.z-q.x*p.z},0);
  return polygon.map((a,i)=>{
    const b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    return {a,b,length,t:{x:dx/length,z:dz/length},n:{x:(area>0?dz:-dz)/length,z:(area>0?-dx:dx)/length}};
  });
}
export function polygonOverlap(x,z,polygon,radius=0) {
  let inside=false;
  for(const {a,b,t,length} of edges(polygon)) {
    if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    const u=Math.max(0,Math.min(length,(x-a.x)*t.x+(z-a.z)*t.z));
    if(Math.hypot(x-a.x-u*t.x,z-a.z-u*t.z)<radius)return true;
  }
  return inside;
}
export function moveAroundPolygons(position,dx,dz,obstacles,{radius,footOffset,headOffset}) {
  let p={x:position.x,z:position.z},v={x:dx,z:dz};
  for(let pass=0;pass<4&&Math.hypot(v.x,v.z)>1e-7;pass++) {
    let hit=null;
    const consider=(time,n)=>{if(time>=-1e-8&&time<=1&&dot(v,n)<-1e-8&&(!hit||time<hit.time))hit={time:Math.max(0,time),n}};
    for(const box of obstacles) {
      if(position.y-footOffset>=box.maxY-.001||position.y+headOffset<=box.minY+.001)continue;
      for(const {a,t,n,length}of edges(box.polygon)) {
        const relative={x:p.x-a.x,z:p.z-a.z},distance=dot(relative,n),speed=dot(v,n);
        if(distance>=radius-1e-7&&speed<0) {
          const time=(radius-distance)/speed,u=dot(relative,t)+time*dot(v,t);
          if(u>=0&&u<=length)consider(time,n);
        }
        // Rounded corners avoid false AABB corners and allow sliding around rotated buildings.
        const A=dot(v,v),B=2*dot(relative,v),C=dot(relative,relative)-radius*radius,D=B*B-4*A*C;
        if(C>=-1e-7&&D>=0) {
          const time=(-B-Math.sqrt(D))/(2*A),nx=relative.x+time*v.x,nz=relative.z+time*v.z,len=Math.hypot(nx,nz);
          if(len>0)consider(time,{x:nx/len,z:nz/len});
        }
      }
    }
    if(!hit){p.x+=v.x;p.z+=v.z;break;}
    p.x+=v.x*hit.time+hit.n.x*.00001;p.z+=v.z*hit.time+hit.n.z*.00001;
    v={x:v.x*(1-hit.time),z:v.z*(1-hit.time)};
    const into=dot(v,hit.n);v.x-=Math.min(0,into)*hit.n.x;v.z-=Math.min(0,into)*hit.n.z;
  }
  return p;
}
const cache=new WeakMap();
export function polygonCameraFraction(from,to,body) {
  let triangles=cache.get(body);
  if(!triangles){const ids=triangulatePolygon(body.polygon);triangles=[];for(let i=0;i<ids.length;i+=3)triangles.push(ids.slice(i,i+3).map(id=>body.polygon[id]));cache.set(body,triangles)}
  let nearest=1;
  for(const triangle of triangles) {
    const planes=edges(triangle).map(({a,n})=>({n:[n.x,0,n.z],limit:dot(a,n)+.35}));
    planes.push({n:[0,1,0],limit:body.maxY+.35},{n:[0,-1,0],limit:-body.minY});
    let enter=0,leave=1;
    for(const {n,limit}of planes){const start=n.reduce((s,v,i)=>s+v*from[i],0)-limit,delta=n.reduce((s,v,i)=>s+v*(to[i]-from[i]),0);
      if(Math.abs(delta)<1e-9){if(start>0){enter=2;break}}else if(delta<0)enter=Math.max(enter,-start/delta);else leave=Math.min(leave,-start/delta);
    }
    if(enter<=leave&&enter<=1&&leave>=0)nearest=Math.min(nearest,Math.max(.06,enter-.025));
  }
  return nearest;
}
