// Reproducible paired evidence: the same sampler drives start-main and candidate.
// Reference manual / production source bytes must stay outside this repository.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';
const output=process.env.ANNYONGI_OUTPUT||'test-results/annyongi/fidelity';
await mkdir(output,{recursive:true});
const results=[];
for(const [device,viewport] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]].filter(([name])=>!process.env.FIDELITY_DEVICE||name===process.env.FIDELITY_DEVICE)) {
 const smoke=await startSmoke({viewport,worldRoot:process.env.FIDELITY_WORLD_ROOT});
 try {
  if(process.env.FIDELITY_RIDER_GLB) {
   const body=await readFile(process.env.FIDELITY_RIDER_GLB);
   await smoke.context.route('**/assets/induck-v3.glb',route=>route.fulfill({status:200,contentType:'model/gltf-binary',body}));
  }
  const page=await smoke.context.newPage();smoke.watch(page);
  for(const night of [false,true]) {
   // Fresh page per state gives a common elapsed time and wing phase.
   for(const state of (process.env.FIDELITY_STATES||'ground,hover,ascend,forward,descend,landing').split(',')) {
    await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html'+(night?'?night=1':''));
    await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
    const pose=await page.evaluate(state=>{const d=window.__ANNYONGI_REVIEW__;d.state(state);d.flightView();return d.character.flightVisualState;},state);
    assert.equal(pose.mode,state);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.screenshot({path:`${output}/${device}-${night?'night':'day'}-${state}.png`,timeout:60000});
    results.push({device,night,state,pose});
   }
  }
  if(device==='desktop') {
   await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
   await page.evaluate(()=>{const d=window.__ANNYONGI_REVIEW__;d.state('ground');d.rider.enabled=false;d.camera.camera.orthoHeight=1.55;});
   for(const [name,position] of [['basic',[0,.1,6]],['front',[0,.1,6]],['right',[6,.1,0]],['back',[0,.1,-6]],['left',[-6,.1,0]]]) {
    await page.evaluate(position=>{const d=window.__ANNYONGI_REVIEW__;d.camera.setPosition(...position);d.camera.lookAt(0,.05,0);},position);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.screenshot({path:`${output}/five-${name}.png`,timeout:60000});
   }
  }
  if(device==='desktop' && process.env.FIDELITY_RIDER_GLB) {
   await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
   await page.evaluate(()=>{const d=window.__ANNYONGI_REVIEW__;d.character.setMounted(false);d.character.update(.05,{mounted:false,moving:false,grounded:true});d.rider.enabled=true;d.camera.camera.orthoHeight=1.25;});
   for(const [name,position] of [['basic',[0,.1,6]],['front',[0,.1,6]],['right',[6,.1,0]],['back',[0,.1,-6]],['left',[-6,.1,0]]]) {
    await page.evaluate(position=>{const d=window.__ANNYONGI_REVIEW__;d.camera.setPosition(...position);d.camera.lookAt(0,.12,0);},position);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.screenshot({path:`${output}/induck-${name}.png`,timeout:60000});
   }
  }
  assert.deepEqual(smoke.problems,[]);
 }finally{await smoke.close();}
}
await writeFile(output+'/results.json',JSON.stringify({rider:process.env.FIDELITY_RIDER_GLB?'local supplied Production Induck; bytes not published':'public QA cuboid, NOT Production Induck',results},null,2));
console.log('Fidelity six-state / five-view capture PASS');
