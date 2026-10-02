import { projectPolygon } from './reality-adapter.js';
import { BACK_APPROACH_SEGMENTS } from './back-approach-layout.js';
import { polygonOverlap } from './polygon-collision.js';

const url=new URL('../data/reality/evidence/roads/back-west-buildings.json',import.meta.url);
// Node (tests, QA) reads file: URLs from disk; browsers fetch over HTTP. Deciding by protocol,
// not by `window`, keeps tests that shim `window` working.
const data=url.protocol==='file:'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`West buildings load failed: ${r.status}`);return r.json();})();

const buildings=data.buildings.map((q,index)=>{
  const polygon=projectPolygon(q.ring),center={x:polygon.reduce((s,p)=>s+p.x,0)/polygon.length,z:polygon.reduce((s,p)=>s+p.z,0)/polygon.length};
  const area=polygon.reduce((s,p,i)=>s+p.x*polygon[(i+1)%polygon.length].z-polygon[(i+1)%polygon.length].x*p.z,0);
  const edges=polygon.map((a,i)=>{
    const c=polygon[(i+1)%polygon.length],length=Math.hypot(c.x-a.x,c.z-a.z),tx=(c.x-a.x)/length,tz=(c.z-a.z)/length,sign=area>0?-1:1;
    return {length,yaw:-Math.atan2(tz,tx)*180/Math.PI,at:(u,v=0)=>({x:a.x+tx*u-tz*v*sign,z:a.z+tz*u+tx*v*sign})};
  }).filter(f=>f.length>1.2);
  return {...q,index,polygon,bounds:polygon,center,edges,height:q.levels*1.5+.25,
    color:'#598f91'};
});
export const BACK_WEST_BUILDINGS=buildings.map(q=>{
  // Hide facade dressing on party walls; source footprints are never shifted.
  const edges=q.edges.filter(f=>{const p=f.at(f.length/2,.45);return !buildings.some(o=>o!==q&&polygonOverlap(p.x,p.z,o.polygon,.2));});
  const choices=edges.filter(f=>f.length>2).flatMap(f=>{
    const p=f.at(f.length/2),out=f.at(f.length/2,1);
    return BACK_APPROACH_SEGMENTS.map(s=>{
      const a=s.frame.at(0),c=s.frame.at(1),u=Math.max(0,Math.min(s.frame.length,(p.x-a.x)*(c.x-a.x)+(p.z-a.z)*(c.z-a.z))),r=s.frame.at(u);
      const facing=(r.x-p.x)*(out.x-p.x)+(r.z-p.z)*(out.z-p.z)>0;
      return {frame:f,distance:facing?Math.hypot(r.x-p.x,r.z-p.z):Infinity};
    });
  }).sort((a,b)=>a.distance-b.distance);
  return {...q,edges,front:choices[0]?.distance<18?choices[0].frame:null};
});
export const BACK_WEST_COLLIDERS=buildings.map(q=>({id:q.id,polygon:q.polygon,minY:0,maxY:q.height+.2}));
