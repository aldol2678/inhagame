import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {POND_RING,pondPromenadeCells,roadviewGroundHeight} from '../src/roadview-layout.js';
import {polygonOverlap} from '../src/polygon-collision.js';
import {canOccupy} from '../src/world-collision.js';
import {SEAT_ANCHORS} from '../src/seat-anchors.js';
const source=new URL('../src/inkyung-daily-layout.mjs',import.meta.url);
const mod=existsSync(source)?await import(source):{};
function layout(){assert.equal(typeof mod.createInkyungDailyLayout,'function','official ambient placement is missing');return mod.createInkyungDailyLayout();}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
test('all patrol segments stay on canonical promenade and out of water/collision',()=>{
 const q=layout(),cells=pondPromenadeCells();
 for(let j=0;j<q.route.length;j++)for(let i=0;i<=100;i++){
  const a=q.route[j],b=q.route[(j+1)%q.route.length],p={x:a.x+(b.x-a.x)*i/100,z:a.z+(b.z-a.z)*i/100};
  assert.equal(polygonOverlap(p.x,p.z,POND_RING,.25),false);
  assert(cells.some(r=>polygonOverlap(p.x,p.z,r,.001)),'patrol stays on rendered path');
  assert(canOccupy({...p,y:1.15+roadviewGroundHeight(p.x,p.z)}),'no canonical collider overlap');
 }
});
test('stationary actors and model bench never reuse occupied public seats',()=>{
 const q=layout();
 for(const p of [q.call,q.seat]){
  assert.equal(polygonOverlap(p.x,p.z,POND_RING,.8),false);
  assert(canOccupy({...p,y:1.15+roadviewGroundHeight(p.x,p.z)}));
  for(const a of SEAT_ANCHORS)assert(distance(a.position,p)>1.3,'independent from '+a.id);
 }
 assert(distance(q.call,q.seat)>4,'stationary interaction targets stay distinct');
 for(const p of q.route)assert(distance(p,q.seat)>1.3,'bench leaves walking route clear');
});
test('source-independent world coordinates retain flat canonical ground, not prototype local origin',()=>{
 const q=layout();for(const p of [...q.route,q.call,q.seat]){
  assert(p.x>130&&p.x<150&&p.z>25&&p.z<40,'official east bank world coordinates');
  assert.equal(roadviewGroundHeight(p.x,p.z),0);
 }
});
