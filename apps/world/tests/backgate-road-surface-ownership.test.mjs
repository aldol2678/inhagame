import test from 'node:test';
import assert from 'node:assert/strict';
import { fillBackStreetPaving } from '../src/back-street-geometry.js';
import { fillCulturePaving } from '../src/culture-street-geometry.js';
import { fillNorthSideGate } from '../src/north-side-gate-geometry.js';
import { fillBackGatePaving } from '../src/back-gate-geometry.js';
import { fillBackApproaches } from '../src/back-approach-geometry.js';
import { fillNorthRoads } from '../src/north-campus-geometry.js';
import { fillCampusRoadBatch } from '../src/campus-road-geometry.js';
import { FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';

const sources=[['street',fillBackStreetPaving,true],['culture',fillCulturePaving,true],['sideGate',fillNorthSideGate,true],['backGate',fillBackGatePaving,false],['approaches',fillBackApproaches,false],['north',fillNorthRoads,false],['campus',fillCampusRoadBatch,false]];
const area=ring=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.x*q.z-q.x*p.z},0)/2;
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
function intersect(subject,clip){
  let ring=subject;
  for(let edge=0;edge<clip.length&&ring.length;edge++){
    const a=clip[edge],b=clip[(edge+1)%clip.length],out=[];
    for(let i=0;i<ring.length;i++){
      const p=ring[i],q=ring[(i+1)%ring.length],dp=cross(a,b,p),dq=cross(a,b,q),pin=dp>=0,qin=dq>=0;
      if(pin)out.push(p);
      if(pin!==qin){const t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
    }
    ring=out;
  }
  return ring;
}
function capture(){
  const faces=[];
  for(const [owner,fill,changed]of sources){
    const record=(color,...ps)=>{
      if(!ps.every(p=>p[1]===ps[0][1]&&p[1]<=FLAT_GROUND_MAX_Y))return;
      let ring=ps.map(p=>({x:p[0],z:p[2]}));if(area(ring)<0)ring.reverse();
      if(Math.abs(area(ring))<1e-10)return;
      faces.push({owner,changed,color,y:ps[0][1],ring,minX:Math.min(...ps.map(p=>p[0])),maxX:Math.max(...ps.map(p=>p[0])),minZ:Math.min(...ps.map(p=>p[2])),maxZ:Math.max(...ps.map(p=>p[2]))});
    };
    fill({quad:record,triangle:record,box(){},tube(){},crown(){}});
  }
  return faces;
}

test('changed rear-gate surfaces have no differently colored coplanar overlap across any neighboring road owner',()=>{
  const faces=capture(),conflicts=new Map();
  for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
    const a=faces[i],b=faces[j];
    if(!(a.changed||b.changed)||a.color===b.color||a.y!==b.y||a.maxX<=b.minX||b.maxX<=a.minX||a.maxZ<=b.minZ||b.maxZ<=a.minZ)continue;
    const overlap=Math.abs(area(intersect(a.ring,b.ring)));if(overlap<=1e-4)continue;
    const key=`${a.owner}/${a.color} vs ${b.owner}/${b.color} y=${a.y}`;
    conflicts.set(key,(conflicts.get(key)||0)+overlap);
  }
  assert.deepEqual([...conflicts].map(([pair,area])=>({pair,area:Number(area.toFixed(6))})),[]);
});

test('intersection probe detects skinny crossing strips whose centroids miss each other',()=>{
  const horizontal=[{x:-3,z:-.02},{x:3,z:-.02},{x:3,z:.02},{x:-3,z:.02}];
  const vertical=[{x:1,z:-2},{x:1.1,z:-2},{x:1.1,z:3},{x:1,z:3}];
  assert.ok(Math.abs(Math.abs(area(intersect(horizontal,vertical)))-.004)<1e-10);
});
