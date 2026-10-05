import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_VIEWS,ROAD_OWNER_PREFIXES,roadCameraFor,roadRoutes } from './browser/backgate-road-qa-plan.mjs';
import { runBackgateRoadWalking } from './browser/backgate-road-walking.mjs';
import { PlayerController } from '../src/player-controller.js';
test('road views cover both crossing pairs gate and culture pavement with reflected finite cameras',()=>{
  assert.deepEqual(ROAD_VIEWS.map(q=>q.name),['main-crossing','side-crossing','side-gate','culture-paving']);
  assert.equal(ROAD_OWNER_PREFIXES.length,4);
  for(const view of ROAD_VIEWS)for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:844,height:390}]){
    const p=roadCameraFor(view,viewport);assert.ok([...p.position,...p.target,p.orthoHeight].every(Number.isFinite));assert.equal(p.target[2],-view.frame.at(0).z);assert.ok(p.orthoHeight*2*viewport.width/viewport.height>=22);
  }
});
test('eight real-controller routes preserve grounding crossing/gate access and prior input state',()=>{
  const saved=Object.fromEntries(['window','document','HTMLElement'].map(k=>[k,globalThis[k]]));
  globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{}},getElementById(){return null}};globalThis.HTMLElement=class{};
  let position={x:0,y:1.15,z:-98},rotation={x:0,y:17,z:0};
  const player={getLocalPosition:()=>({...position}),setLocalPosition(x,y,z){position={x,y,z}},getLocalEulerAngles:()=>({...rotation}),setLocalEulerAngles(x,y,z){rotation={x,y,z}}};
  const controller=new PlayerController(player),before={...position};controller.keys.add('KeyA');controller.touchVector.x=.2;controller.inputEnabled=false;
  try{
    const report=runBackgateRoadWalking({player,controller});assert.equal(roadRoutes().length,8);assert.equal(report.passed,true);
    assert.ok(report.cases.every(q=>q.passed&&q.ticks>0&&q.remaining<.005&&q.maxFootError<1e-6&&q.trace.length===q.ticks+1));
    assert.deepEqual(position,before);assert.deepEqual([...controller.keys],['KeyA']);assert.equal(controller.touchVector.x,.2);assert.equal(controller.inputEnabled,false);
  }finally{for(const [k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
