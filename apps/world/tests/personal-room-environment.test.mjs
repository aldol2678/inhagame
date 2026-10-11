import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalRoomEnvironment, personalRoomLightingFrame, PERSONAL_ROOM_CONTROLS } from '../src/rooms/personal-room-environment.js';
import { selectContextAction } from '../src/context-action.js';
function rig() {
  const c = { active: true, sessionKey: 'self:room-a', position: {...PERSONAL_ROOM_CONTROLS.light}, grounded: true };
  const frames = [], poses = [];
  const runtime = createPersonalRoomEnvironment({getContext:()=>c, getOutdoor:()=>({artificialLightFactor:1,clearColor:[.03,.05,.1]}),applyFrame:f=>frames.push(f),setCurtainOpen:x=>poses.push(x)});
  runtime.update(0);
  return {c,runtime,frames,poses};
}
test('world projection controls daylight without a second clock, night OFF stays readable',()=>{
  const night = personalRoomLightingFrame({artificialLightFactor:1},{lightsOn:false,curtainOpen:0});
  const day = personalRoomLightingFrame({artificialLightFactor:0},{lightsOn:false,curtainOpen:1});
  assert.ok(night.ambient.every(v=>v>=.19)); assert.equal(night.intensity,0); assert.equal(night.diffuser,0);
  assert.ok(day.ambient[0]>night.ambient[0]);
  assert.ok(personalRoomLightingFrame({artificialLightFactor:0},{lightsOn:false,curtainOpen:0}).ambient[0]<day.ambient[0]);
  const invalid=personalRoomLightingFrame({artificialLightFactor:NaN,clearColor:[NaN,Infinity,-1]});
  assert.ok(invalid.sky.every(Number.isFinite));
});
test('switch toggles only in range and rechecks stale input locks, movement and session',()=>{
  const {c,runtime,frames}=rig(); const action=runtime.contextAction();
  assert.equal(action.label,'천장 조명 끄기'); assert.equal(action.trigger(),true); assert.equal(frames.at(-1).intensity,0);
  for(const prop of ['blocked','mounted','seated']){c[prop]=true;assert.equal(action.trigger(),false);c[prop]=false;}
  c.grounded=false;assert.equal(runtime.contextAction(),null);c.grounded=true;
  c.position={x:0,z:0};assert.equal(action.trigger(),false);
  c.position={...PERSONAL_ROOM_CONTROLS.light};c.sessionKey='new-account:room-b';assert.equal(action.trigger(),false);
  assert.equal(runtime.status().lightsOn,true);
});
test('curtains animate bounded and reverse without creating geometry; reduced motion snaps',()=>{
  const {c,runtime,poses}=rig();c.position={...PERSONAL_ROOM_CONTROLS.curtain};
  assert.equal(runtime.contextAction().label,'커튼 닫기');runtime.contextAction().trigger();runtime.update(.1);
  assert.ok(runtime.status().openness>0&&runtime.status().openness<1);
  runtime.contextAction().trigger();runtime.update(.1);assert.equal(runtime.status().openness,1);
  runtime.contextAction().trigger();for(let i=0;i<10;i++)runtime.update(.1);
  assert.equal(runtime.status().openness,0);assert.ok(poses.every(v=>v>=0&&v<=1));
  c.reducedMotion=true;runtime.contextAction().trigger();assert.equal(runtime.status().openness,1);
});
test('leaving, repeated entries and visitor/account changes reset session-local controls',()=>{
  const {c,runtime}=rig();
  for(let i=0;i<20;i++){
    runtime.contextAction().trigger();assert.equal(runtime.status().lightsOn,false);
    const retained=runtime.contextAction();c.active=false;runtime.update();assert.equal(runtime.status().active,false);assert.equal(retained.trigger(),false);
    c.active=true;runtime.update();assert.equal(runtime.status().lightsOn,true);assert.equal(runtime.status().openness,1);
  }
  runtime.contextAction().trigger();c.sessionKey='self:friend-room';runtime.update();assert.equal(runtime.status().lightsOn,true);
});
test('nearest equal-priority door or switch wins, never steals high-priority furniture action',()=>{
  const {runtime}=rig(); const light=runtime.contextAction();
  assert.equal(selectContextAction([light,{id:'room-door',priority:150,distance:.9}]).id,light.id);
  assert.equal(selectContextAction([{...light,distance:.6},{id:'room-door',priority:150,distance:.2}]).id,'room-door');
  assert.equal(selectContextAction([light,{id:'furniture',priority:260}]).id,'furniture');
});

test('main uses the shared environment projection and shared action slot without color aliasing',async()=>{
  const {readFile}=await import('node:fs/promises');
  const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  const source=await readFile(new URL('../src/rooms/personal-room-environment.js',import.meta.url),'utf8');
  assert.match(main,/getOutdoor: \(\) => environment.copyVisualAtmosphereState/);
  assert.match(main,/personalRoomEnvironment.update\(dt\)/);
  assert.match(main,/contextActions.set\("personal-room-environment", personalRoomEnvironment.contextAction\(\)\)/);
  assert.match(main,/app.scene.ambientLight.copy\(ambient\)/);
  assert.match(main,/camera.camera.clearColor.copy\(clearColor\)/);
  assert.match(main,/app.scene.ambientLight.copy\(personalRoomScene.ambient\)/);
  assert.doesNotMatch(source,/Date\.now|setInterval|localStorage|sessionStorage|fetch\(|\.rpc\(|\.broadcast\(|addEventListener/);
});
