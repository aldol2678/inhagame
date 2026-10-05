import test from 'node:test';
import assert from 'node:assert/strict';
import { AGORA, STUDENT_TERRACES, LIBRARY_APPROACHES, ROADVIEW_OBSTACLES, roadviewGroundHeight } from '../src/roadview-layout.js';
import { PlayerController } from '../src/player-controller.js';
import { moveAroundObstacles } from '../src/world-collision.js';
import { LIBRARY_ROOF_PARTS } from '../src/basic-campus.js';

globalThis.window={addEventListener(){}};
globalThis.document={getElementById(){return null;}};
function actor(p){
  let position={...p,y:1.15+roadviewGroundHeight(p.x,p.z)};
  const entity={getLocalPosition:()=>({...position}),setLocalPosition(x,y,z){position={x,y,z};},setLocalEulerAngles(){}};
  return {entity,controller:new PlayerController(entity)};
}
function walk(a,target){
  for(let i=0;i<600;i++){
    const p=a.entity.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
    if(len<.005){a.controller.touchVector={x:0,y:0};return;}
    a.controller.touchVector={x:dx/len,y:-dz/len};a.controller.update(Math.min(1/60,len/7));
    const next=a.entity.getLocalPosition();
    assert.ok(Math.abs(next.y-1.15-roadviewGroundHeight(next.x,next.z))<1e-6,'feet follow stair surface');
  }
  assert.fail('route blocked');
}
test('Agora approach ascends and descends continuously; jump and flight land on deck',()=>{
  const u=(AGORA.stairStart+AGORA.stairEnd)/2,a=actor(AGORA.frame.at(u,6));
  walk(a,AGORA.frame.at(u,-2));assert.ok(Math.abs(a.entity.getLocalPosition().y-2.75)<1e-6);
  a.controller.jumpQueued=true;a.controller.update(1/60);
  assert.ok(a.entity.getLocalPosition().y>2.75);
  for(let i=0;i<120;i++)a.controller.update(1/60);
  assert.equal(a.controller.grounded,true);assert.equal(a.entity.getLocalPosition().y,2.75);
  a.controller.toggleMount();a.controller.ascendHeld=true;
  for(let i=0;i<60;i++)a.controller.update(1/60);
  a.controller.ascendHeld=false;a.controller.toggleMount();
  for(let i=0;i<120;i++)a.controller.update(1/60);
  assert.equal(a.controller.mounted,false);assert.equal(a.entity.getLocalPosition().y,2.75);
  walk(a,AGORA.frame.at(u,6));assert.equal(a.entity.getLocalPosition().y,1.15);
});
for(const t of STUDENT_TERRACES)test(`${t.id}: retired invisible approach stays flat in both directions`,()=>{
  const a=actor(t.frame.at(t.frame.length/2,t.landing+t.run+1));
  walk(a,t.frame.at(t.frame.length/2,.75));
  assert.ok(Math.abs(a.entity.getLocalPosition().y-1.15)<1e-6);
  walk(a,t.frame.at(t.frame.length/2,t.landing+t.run+1));
  assert.equal(a.entity.getLocalPosition().y,1.15);
});
for(const t of LIBRARY_APPROACHES)test(`${t.id}: climb, jump, land and return to the road`,()=>{
  if(t.id==='library_front'){
    const canopy=LIBRARY_ROOF_PARTS.find(p=>p.id==='library_entry_canopy');
    assert.ok(canopy.y-canopy.height/2>t.height+1.15+1.45,'existing player capsule clears the canopy');
  }
  const u=t.frame.length/2,a=actor(t.frame.at(u,t.landing+t.run+1));
  walk(a,t.frame.at(u,t.landing*.8));
  assert.ok(Math.abs(a.entity.getLocalPosition().y-1.15-t.height)<1e-6);
  a.controller.jumpQueued=true;a.controller.update(1/60);
  for(let i=0;i<120;i++)a.controller.update(1/60);
  assert.ok(a.controller.grounded);assert.ok(Math.abs(a.entity.getLocalPosition().y-1.15-t.height)<1e-6);
  walk(a,t.frame.at(u,t.landing+t.run+1));
  assert.equal(a.entity.getLocalPosition().y,1.15);
});
test('visible west retaining guard blocks a ground-level shortcut; retired Agora stays absent',()=>{
  const start=AGORA.frame.at(AGORA.stairStart/2,2),end=AGORA.frame.at(AGORA.stairStart/2,-2);
  const p=moveAroundObstacles({...start,y:1.15},end.x-start.x,end.z-start.z,ROADVIEW_OBSTACLES);
  assert.ok(AGORA.frame.local(p).out>0);
  assert.equal(roadviewGroundHeight(130,5),0);
  assert.ok(ROADVIEW_OBSTACLES.filter(o=>o.id.includes('agora')).every(o=>o.polygon.every(p=>p.z < -60)));
});
