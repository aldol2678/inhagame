// Regression oracle: the pre-broadphase polygon sweep as shipped on main
// 718cdf33b74287e8312f2b36fde04ec693c3f4c8. Keep this independent of
// production helpers, so future optimizations must preserve exact outcomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveAroundPolygons } from '../src/polygon-collision.js';

const dot=(a,b)=>a.x*b.x+a.z*b.z;
function edges(polygon) {
  const area=polygon.reduce((s,p,i)=>{const q=polygon[(i+1)%polygon.length];return s+p.x*q.z-q.x*p.z},0);
  return polygon.map((a,i)=>{
    const b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    return {a,b,length,t:{x:dx/length,z:dz/length},n:{x:(area>0?dz:-dz)/length,z:(area>0?-dx:dx)/length}};
  });
}
function referenceMove(position,dx,dz,obstacles,{radius,footOffset,headOffset}) {
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
const shape={radius:.65,footOffset:1.15,headOffset:1.45};
const rect=(x,z,w=2,d=2,minY=0,maxY=4)=>({
  polygon:[{x:x-w/2,z:z-d/2},{x:x+w/2,z:z-d/2},{x:x+w/2,z:z+d/2},{x:x-w/2,z:z+d/2}],minY,maxY
});
function equivalent(position,dx,dz,obstacles,s=shape) {
  // Deep equality guards floating-point steps and chosen collision normal,
  // not merely the final "arrived" result.
  const expected=referenceMove(position,dx,dz,obstacles,s);
  const actual=moveAroundPolygons(position,dx,dz,obstacles,s);
  assert.deepEqual(actual,expected,JSON.stringify({position,dx,dz,expected,actual}));
}
test('sweep rejects distant polygons without changing corner, wall or sliding outcomes',()=>{
  const obstacles=[
    rect(0,0,4,4),rect(8,1,1,6),rect(-4,-5,4,2),rect(2000,2000,50,50),
    rect(-2000,-2000,80,40),rect(1,1,6,6,8,12)
  ];
  for(const p of [
    {x:-6,y:1.15,z:0},{x:0,y:1.15,z:-6},{x:3,y:1.15,z:3},
    {x:5,y:1.15,z:6},{x:0,y:9.15,z:-6},{x:-.65,y:1.15,z:-.65}
  ])for(const [dx,dz] of [[4,0],[0,6],[6,6],[-8,5],[2,-7],[0,0],[-.00001,.00001]]) {
    equivalent(p,dx,dz,obstacles);
  }
});
test('swept prefilter matches legacy movement for deterministic varied campuses and directions',()=>{
  let seed=0x1743a5c1;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const obstacles=Array.from({length:80},()=>rect(random()*250-125,random()*250-125,
    random()*7+.25,random()*9+.25,random()<.2?7:0,random()<.2?15:4));
  for(let i=0;i<300;i++) {
    const p={x:random()*220-110,z:random()*220-110,y:random()<.1?9.15:1.15};
    const dx=(random()-.5)*15,dz=(random()-.5)*15;
    equivalent(p,dx,dz,obstacles,{...shape,radius:[.1,.65,1.5,3][i%4]});
  }
});
test('in-place edits of polygon vertices and height take effect immediately',()=>{
  const box=rect(200,200),others=[rect(3,0,1,10),box];
  const p={x:0,y:1.15,z:0};
  equivalent(p,5,0,others);
  for(let i=0;i<box.polygon.length;i++) {
    box.polygon[i].x-=198;
    box.polygon[i].z-=200;
  }
  equivalent(p,5,0,others);
  box.maxY=-1;
  equivalent(p,5,0,others);
});
