import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player-controller.js';
import { createPhotoMode, PHOTO_MODE_BLOCK } from '../src/photo/photo-mode.js';
import { createPhotoCameraController } from '../src/photo/photo-camera-controller.js';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '../src/input/input-focus-runtime.js';
import { createFakeCameraEntity } from './support/fake-camera.mjs';
import { CAMPUS_BIKE_ID } from '../src/mounts/campus-bike-world.js';
import { CAMPUS_KICKBOARD_ID } from '../src/mounts/campus-kickboard-world.js';
import { CAMPUS_KART_ID } from '../src/mounts/campus-kart-world.js';
import { DUCK_BOAT_ID } from '../src/mounts/duck-boat-world.js';
import { CAMPUS_HELICOPTER_ID } from '../src/mounts/campus-helicopter-world.js';

function harness(id=CAMPUS_HELICOPTER_ID) {
  globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{mountId:id}},getElementById:()=>null};
  const p={x:0,y:10,z:0}, entity={mountKind:id,getLocalPosition:()=>({...p}),setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}),setLocalEulerAngles(){}};
  const controller=new PlayerController(entity);controller.mounted=true;controller.mountId=id;entity.mountKind=id;controller.grounded=false;
  if(id===CAMPUS_KART_ID)controller.kartSeats.claim('driver','local-player');
  if(id===DUCK_BOAT_ID)controller.boatSeats.claim('driver','local-player');
  const camera=createFakeCameraEntity({position:[0,12,8],target:[0,10,0]});camera.camera.aspectRatio=1;
  const orbit=new OrbitCameraController(camera,{addEventListener(){}}),focus=createInputFocusManager();
  bindInputFocusRuntime({manager:focus,controller,orbit});
  const rig=createPhotoCameraController({camera});
  const state={world:true,region:'campus',space:'campus',accountId:'guest'};
  let bounds={min:{x:-3,y:9,z:-3},max:{x:3,y:12,z:3}};
  const mode=createPhotoMode({orbit,rig,inputFocus:focus,getPosition:()=>p,
    getState:()=>({...state,mounted:controller.mounted,grounded:controller.grounded}),
    getMount:()=>controller.getPhotoHoldTarget(),getMountBounds:()=>bounds,entryOwnerId:'smartphone'});
  return {controller,camera,orbit,focus,rig,mode,p,state,loseVisual(){bounds=null;},driftMount(){bounds={min:{x:5,y:9,z:-3},max:{x:11,y:12,z:3}};}};
}
for(const id of [CAMPUS_BIKE_ID,CAMPUS_KICKBOARD_ID,CAMPUS_KART_ID,DUCK_BOAT_ID,CAMPUS_HELICOPTER_ID]) {
  test(`${id}: held motion, input handoff, full subject rig and exact camera restoration`,()=>{
    const h=harness(id),before=h.camera.pose(),target=h.controller.getPhotoHoldTarget();
    Object.assign(h.controller.groundMotion,{speed:6,vx:4,vz:5});Object.assign(h.controller.boatMotion,{speed:5,vx:2,vz:3});
    Object.assign(h.controller.helicopterFlight,{vx:4,vy:-5,vz:3,pitch:12,roll:10});
    assert.equal(h.mode.open(),true);assert.equal(h.controller.photoHolding,true);assert.equal(h.controller.inputEnabled,false);assert.equal(h.orbit.inputEnabled,false);
    assert.deepEqual(h.focus.snapshot().topOwners,['photo-mode']);assert.equal(h.mode.pose(),'mounted');
    for(let i=0;i<60;i++){h.controller.keys.add('KeyW');h.controller.update(1/60);h.mode.applyCamera(1/60);}
    assert.deepEqual(h.p,{x:0,y:10,z:0});assert.equal(id===CAMPUS_HELICOPTER_ID?h.controller.helicopterFlight.vy:id===DUCK_BOAT_ID?h.controller.boatMotion.speed:h.controller.groundMotion.speed,0);
    assert.ok(h.rig.snapshot().subjectBounds);assert.ok(h.rig.snapshot().travel.radius>h.rig.limits.radius);
    const entry=h.rig.snapshot().entry;h.rig.look(40,10);h.rig.zoom(.6);h.rig.setMoveIntent({x:1});h.mode.applyCamera(.1);
    h.rig.reset();assert.deepEqual(h.rig.snapshot().position,{x:entry.x,y:entry.y,z:entry.z});
    assert.equal(h.mode.close(),true);assert.deepEqual(h.camera.pose(),before);assert.equal(h.controller.mounted,true);
    assert.equal(h.controller.photoHolding,false);assert.equal(h.controller.inputEnabled,true);assert.equal(h.orbit.inputEnabled,true);assert.equal(h.controller.keys.size,0);
    assert.equal(target.exitPhotoHold(),false);assert.equal(h.focus.size,0);
  });
}
test('unsupported or partial runtime/visual state keeps mounted block',()=>{
  const unsupported=harness('annyongi');assert.equal(unsupported.mode.blockedReason(),PHOTO_MODE_BLOCK.MOUNTED);
  for(const cause of ['visual','kind','landing','space','runtime']){const h=harness();
    if(cause==='visual')h.loseVisual();if(cause==='kind')h.controller.entity.mountKind=null;
    if(cause==='landing')h.controller.landing=true;if(cause==='space')h.controller.space={id:'room'};
    if(cause==='runtime')h.controller.helicopterFlight=null;
    assert.equal(h.mode.open(),false,cause);assert.equal(h.focus.size,0);assert.equal(h.controller.photoHolding,false);
  }
});
test('dismount, reference loss, visual disposal, transition, account, combat and teleport safely close',()=>{
  for(const cause of ['dismount','reference','visual','transition','account','combat','teleport','mount-drift']){
    const h=harness();h.mode.open();h.rig.look(100,40);h.mode.applyCamera(.1);
    if(cause==='dismount')h.controller.mounted=false;if(cause==='reference')h.controller.mountId=null;if(cause==='visual')h.loseVisual();
    if(cause==='transition')h.state.transitioning=true;if(cause==='account')h.state.accountId='other';if(cause==='combat')h.state.combat=true;if(cause==='teleport')h.p.x=100;
    if(cause==='mount-drift')h.driftMount();
    assert.equal(h.mode.update(),false,cause);assert.equal(h.controller.photoHolding,false);assert.equal(h.controller.inputEnabled,true);assert.equal(h.focus.size,0);assert.equal(h.rig.active,false);
  }
});
test('closing cleanup runs before rig restore and each failing cleanup cannot strand hold/input',()=>{
  const h=harness(),order=[];h.mode.subscribeClosing(()=>{order.push('cancel');throw Error('synthetic UI failure');});
  h.mode.subscribeClosing(()=>{order.push('UI cleanup');},{priority:30});h.mode.subscribe(({active})=>{if(!active)order.push('restored');});
  h.mode.open();h.mode.close();assert.deepEqual(order,['cancel','UI cleanup','restored']);assert.equal(h.focus.size,0);assert.equal(h.controller.photoHolding,false);assert.equal(h.controller.inputEnabled,true);
});
test('Phone origin handoff returns its owner after mounted camera restoration',()=>{
  const h=harness();let token=h.focus.claim('smartphone',INPUT_FOCUS_POLICY.BLOCKING_UI),seen;
  const before=h.camera.pose();h.mode.subscribe(change=>{
    if(change.active){h.focus.release(token);token=null;}else{seen=h.camera.pose();token=h.focus.claim('smartphone',INPUT_FOCUS_POLICY.BLOCKING_UI);assert.equal(change.origin,'PHONE_CAMERA');}
  });
  assert.equal(h.mode.open({entryOwner:'smartphone',origin:'PHONE_CAMERA'}),true);assert.deepEqual(h.focus.snapshot().topOwners,['photo-mode']);
  h.mode.close();assert.deepEqual(seen,before);assert.deepEqual(h.focus.snapshot().topOwners,['smartphone']);assert.equal(h.controller.inputEnabled,false);
  h.focus.release(token);assert.equal(h.controller.inputEnabled,true);
});
test('mounted rig still sweeps geometry and rejects oversized/invalid subjects without a lease leak',()=>{
  const h=harness(),collision={obstacles:()=>[{id:'wall',minX:2,maxX:3,minY:0,maxY:40,minZ:-30,maxZ:30}],floorHeight:()=>0};
  const rig=createPhotoCameraController({camera:h.camera,collision});
  assert.equal(rig.begin(h.mode.saved),false);
  const snapshot={position:{x:0,y:10,z:0},forward:{x:0,y:0,z:1},fov:60};
  assert.equal(rig.begin(snapshot,{subjectBounds:{min:{x:0,y:9,z:-1},max:{x:1,y:11,z:1}}}),true);
  rig.setMoveIntent({x:1});for(let i=0;i<300;i++)rig.update(.1);assert.ok(rig.snapshot().position.x<2,'wall remains authoritative');rig.end();
  assert.equal(rig.begin(snapshot,{subjectBounds:{min:{x:-100,y:-100,z:-100},max:{x:100,y:100,z:100}}}),false);
});
