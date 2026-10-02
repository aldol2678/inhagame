import test from 'node:test';
import assert from 'node:assert/strict';
import { DORM_1_FRAME as f, DORM_1_ENTRANCE, DORM_1_CAMPUS_RETURN } from '../src/dorm1-layout.js';
import { DORM_1_FENCES, DORM_1_EXTERIOR_BOUNDS, GATE_NAME_SIGNS, DORM_1_NAME_SIGN } from '../src/gate-dorm-exterior-layout.js';
import { OBSTACLES } from '../src/campus-layout.js';
import { canOccupy, moveAroundObstacles } from '../src/world-collision.js';
import { campusSpawn } from '../src/campus-spawn.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { buildDorm1EntranceDetail, fillDorm1Facade } from '../src/dorm1-detail-geometry.js';
import { FACILITIES } from '../src/campus-facilities.js';

test('dorm fence is persistent and the opening preserves room entry and return',()=>{
  for(const fence of DORM_1_FENCES) {
    assert.ok(OBSTACLES.includes(fence));
    assert.equal(canOccupy({...f.at((fence.start+fence.end)/2,fence.v),y:1.15}),false);
  }
  assert.ok(canOccupy(DORM_1_CAMPUS_RETURN.position));
  assert.ok(canOccupy(campusSpawn({search:'?spawn=dorm1-exterior'})));
  for(const reverse of [false,true]){
    const a=f.at(0,reverse?.65:10),b=f.at(0,reverse?10:.65);
    let p={...a,y:1.15};
    for(let i=0;i<100;i++)p={...moveAroundObstacles(p,(b.x-a.x)/100,(b.z-a.z)/100),y:1.15};
    assert.ok(Math.hypot(p.x-b.x,p.z-b.z)<.02);
  }
  assert.ok(Math.hypot(f.at(0,.65).x-DORM_1_ENTRANCE.position.x,f.at(0,.65).z-DORM_1_ENTRANCE.position.z)<DORM_1_ENTRANCE.radius);
});

test('dorm streamed exterior and sign fit their single facility owner',()=>{
  const owners=RENDER_CHUNKS.filter(c=>c.facilities.includes('bldg_dorm1'));
  assert.equal(owners.length,1);const b=owners[0].bounds;
  const check=(x,z)=>assert.ok(x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ);
  for(const p of DORM_1_EXTERIOR_BOUNDS)check(p.x,p.z);
  for(const p of DORM_1_NAME_SIGN.corners)check(p[0],p[2]);
  let count=0;
  const batch={box(c,p,size,yaw=0){count++;assert.ok([...p,...size,yaw].every(Number.isFinite));const a=yaw*Math.PI/180;
    for(const x of [-1,1])for(const z of [-1,1])check(p[0]+x*size[0]/2*Math.cos(a)+z*size[2]/2*Math.sin(a),p[2]-x*size[0]/2*Math.sin(a)+z*size[2]/2*Math.cos(a));},
    crown(c,p,size){count++;check(p[0]-size[0]/2,p[2]-size[2]/2);check(p[0]+size[0]/2,p[2]+size[2]/2);}};
  buildDorm1EntranceDetail(batch,'NEAR');buildDorm1EntranceDetail(batch,'DETAIL');
  fillDorm1Facade(batch,FACILITIES.find(q=>q.id==='bldg_dorm1'));
  assert.ok(count>150&&count<1500);
});

test('gate and dorm lettering remains upright and outward-facing under reflected root',()=>{
  for(const sign of [...GATE_NAME_SIGNS,DORM_1_NAME_SIGN]){
    const [a,b,c]=sign.corners;
    assert.ok(c[1]>b[1]);assert.equal(a[1],b[1]);
    const dx=b[0]-a[0],dz=b[2]-a[2];
    assert.ok(dz*sign.normal[0]-dx*sign.normal[2]>0);
  }
});
