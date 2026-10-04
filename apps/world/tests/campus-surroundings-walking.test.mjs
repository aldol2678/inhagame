import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player-controller.js';

test('actual controller traverses both approach directions and stands from all visible pond seats',async()=>{
  const qa=await import('./browser/campus-surroundings-walking.mjs').catch(()=>({}));
  assert.equal(typeof qa.runSurroundingsWalking,'function','shared controller probe is missing');
  const saved={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement};
  globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{}},getElementById(){return null;}};globalThis.HTMLElement=class{};
  let position={x:0,y:1.15,z:-90},rotation={x:0,y:23,z:0};
  const player={getLocalPosition:()=>({...position}),setLocalPosition(x,y,z){position={x,y,z};},getLocalEulerAngles:()=>({...rotation}),setLocalEulerAngles(x,y,z){rotation={x,y,z};}};
  const controller=new PlayerController(player),before={position:{...position},rotation:{...rotation}};
  try{
    const result=qa.runSurroundingsWalking({controller,player});
    assert.equal(result.cases.length,38);assert.equal(result.cases.filter(c=>c.kind==='seat').length,32);
    assert.equal(result.cases.filter(c=>c.kind==='walkway').length,4);assert.equal(result.cases.filter(c=>c.kind==='fishing').length,2);
    assert.ok(result.cases.every(c=>c.passed),JSON.stringify(result.cases.filter(c=>!c.passed)));
    assert.deepEqual(position,before.position);assert.deepEqual(rotation,before.rotation);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('literal baseline comparison replaces every changed existing runtime and rejects broadened scope',async()=>{
  const qa=await import('./browser/campus-surroundings-walking.mjs');
  assert.equal(typeof qa.surroundingsBaselinePlan,'function','literal baseline scope guard missing');
  const files=['campus-chunk-renderer.js','campus-grounds.js','main-hall-walkway-geometry.js','main-hall-walkway-layout.js','minimap/minimap-data.js','navigation/campus-navigation.js','pond-surroundings-geometry.js'].map(p=>'apps/world/src/'+p);
  const plan=qa.surroundingsBaselinePlan(files);
  assert.equal(plan.replace.length,4);assert.equal(plan.added.length,3);
  assert.throws(()=>qa.surroundingsBaselinePlan([...files,'apps/world/src/campus-layout.js']),/scope/);
  assert.throws(()=>qa.surroundingsBaselinePlan(files.slice(1)),/scope/);
});

test('controller probe rejects non-finite positions instead of recording a false pass',async()=>{
  const {runSurroundingsWalking}=await import('./browser/campus-surroundings-walking.mjs');
  const saved={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement};
  globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{}},getElementById(){return null;}};globalThis.HTMLElement=class{};
  try{
    for(const invalid of [NaN,Infinity]){
      let position={x:0,y:1.15,z:-90};
      const player={getLocalPosition:()=>({...position}),setLocalPosition(x,y,z){position={x,y,z};},setLocalEulerAngles(){}};
      const controller=new PlayerController(player);controller.update=()=>{position={x:invalid,y:invalid,z:invalid};};
      const result=runSurroundingsWalking({controller,player});
      assert.equal(result.passed,false,'invalid physics must never pass the probe');
      assert.ok(result.cases.every(c=>!c.passed&&/finite/i.test(c.error)));
      assert.deepEqual(position,{x:0,y:1.15,z:-90},'probe still restores actor state');
    }
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
