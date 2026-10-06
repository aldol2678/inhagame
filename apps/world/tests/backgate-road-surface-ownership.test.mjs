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
import { BACK_GATE_FRAME as gate } from '../src/back-gate-layout.js';
import { FLAT_GROUND_Y as G } from '../src/flat-ground-surface.js';

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

function gateBounds(face){
  const o=gate.at(0),u=gate.at(1),v=gate.at(0,1);
  const points=face.ring.map(p=>({u:(p.x-o.x)*(u.x-o.x)+(p.z-o.z)*(u.z-o.z),v:(p.x-o.x)*(v.x-o.x)+(p.z-o.z)*(v.z-o.z)}));
  return [Math.min(...points.map(p=>p.u)),Math.max(...points.map(p=>p.u)),Math.min(...points.map(p=>p.v)),Math.max(...points.map(p=>p.v))].map(n=>Number(n.toFixed(7)));
}

test('rear gate tile apron remains one complete continuous original rectangle',()=>{
  const tiles=capture().filter(q=>q.owner==='backGate'&&q.color==='#aaa99e');
  assert.equal(tiles.length,1,'no apron clipping or split faces');
  assert.equal(tiles[0].ring.length,4);
  assert.deepEqual(gateBounds(tiles[0]),[-11,5.5,-4,2.3]);
  assert.ok(Math.abs(Math.abs(area(tiles[0].ring))-16.5*6.3)<1e-7);
  assert.equal(tiles[0].y,G.SURFACE,'original pavement height');
});

test('rear gate retains every full original tile seam without clipped gaps',()=>{
  const seams=capture().filter(q=>q.owner==='backGate'&&q.color==='#bcbbae');
  const expected=[];
  for(let u=-10.5;u<5.5;u+=1)expected.push([u,u+.035,-4,2.3]);
  for(let v=-4;v<2.3;v+=1)expected.push([-11,5.5,v,v+.035]);
  assert.equal(seams.length,23);
  seams.forEach((seam,i)=>gateBounds(seam).forEach((bound,j)=>
    assert.ok(Math.abs(bound-expected[i][j])<1e-7,'full original seam extent')));
  assert.ok(seams.every(q=>q.ring.length===4&&q.y===G.PAINT));
});

test('rear zebra long axes follow the road and retain the same crossing footprint',()=>{
  const stripes=capture().filter(q=>q.owner==='backGate'&&q.color==='#dedcd1');
  assert.equal(stripes.length,10);
  const bounds=stripes.map(gateBounds);
  for(let i=0;i<bounds.length;i++){
    const [u0,u1,v0,v1]=bounds[i];
    assert.equal(u0,-11.5);assert.equal(u1,-6.9);
    assert.ok(Math.abs(v1-v0-.4)<1e-7,'narrow v depth with a long horizontal u axis');
    if(i)assert.ok(v0>bounds[i-1][3],'separate bars repeat along v');
    assert.equal(stripes[i].y,G.DETAIL,'original paint height');
  }
  assert.equal(bounds[0][2],3.1);assert.equal(bounds.at(-1)[3],10.1);
});

test('rear zebra crossing has no yellow lane paint underneath',()=>{
  const faces=capture();
  const stripes=faces.filter(q=>q.owner==='backGate'&&q.color==='#dedcd1');
  const lines=faces.filter(q=>q.owner==='backGate'&&q.color==='#d8b453');
  assert.ok(stripes.length&&lines.length);
  for(const stripe of stripes)for(const line of lines)
    assert.ok(Math.abs(area(intersect(stripe.ring,line.ring)))<1e-7,'no near-coplanar lane paint below horizontal zebra');
});
