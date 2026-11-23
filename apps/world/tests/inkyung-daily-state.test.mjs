import test from 'node:test';
import assert from 'node:assert/strict';
import {createScene,POSES,speedFor} from '../src/inkyung-daily-state.mjs';
const tick=(s,d,p)=>{for(let n=0;n<Math.round(d/.05);n++)s.update(.05,p);};
test('phone actor eases to a full stop before dialogue and resumes route after release',()=>{
 const scene=createScene();const phone=scene.actors.phone;
 const close={x:phone.x+.5,z:phone.z};
 tick(scene,.25,close);
 assert.equal(scene.interact('phone',close),true);
 assert.notEqual(phone.state,'dialogue');
 tick(scene,.8,close);
 assert.equal(phone.state,'dialogue');assert.equal(phone.speed,0);assert.equal(phone.clip,POSES.idle);
 const before=[phone.x,phone.z];
 tick(scene,.2,close);
 assert.deepEqual([phone.x,phone.z],before);
 scene.dismiss();
 tick(scene,.6);
 assert.equal(phone.state,'patrol');assert(phone.speed>0);
});
test('out of range and second dialogue attempts are denied; walking away releases conversation',()=>{
 const s=createScene(),c=s.actors.call,p={x:c.x+.4,z:c.z};
 assert.equal(s.interact('call',{x:c.x+30,z:c.z}),false);
 assert.equal(s.interact('call',p),true);
 assert.equal(s.interact('phone',p),false);
 tick(s,.5,p);assert.equal(s.activeTalk,'call');
 tick(s,.2,{x:c.x+40,z:c.z});assert.equal(s.activeTalk,null);
});
test('bench dialogue is deferred, never hard cuts the sit-stand clip and uses one stationary anchor',()=>{
 const s=createScene(),a=s.actors.bench,p={x:a.x+.4,z:a.z};const before=[a.x,a.z];
 tick(s,1.5,p);assert.equal(a.clip,POSES.bench);
 assert.equal(s.interact('bench',p),true);assert.equal(a.state,'bench');
 tick(s,1,p);assert.equal(a.state,'bench');
 tick(s,3,p);assert.equal(a.state,'dialogue');assert.equal(a.clip,POSES.idle);
 assert.deepEqual([a.x,a.z],before);
});
test('phone patrol and grounded bench use finite speeds, no teleports and independent actors',()=>{
 const s=createScene();const p=s.actors.phone,q=s.actors.call,b=s.actors.bench;
 const before=[p.x,p.z];const bench=[b.x,b.z];
 s.update(5);assert(Math.hypot(p.x-before[0],p.z-before[1])<1);
 assert.equal(q.speed,0);assert.deepEqual([b.x,b.z],bench);
 assert(speedFor(POSES.walk)>.2&&speedFor(POSES.walk)<1);
 assert.equal(speedFor(POSES.bench),0);
});
