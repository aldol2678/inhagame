import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const smokeSource=readFileSync(new URL('./browser/campus-terrain-smoke.mjs',import.meta.url),'utf8');

test('terrain diagnostic isolates the sky with a known blue clear color, without changing terrain',()=>{
  const fixture=smokeSource.match(/function configureTerrainDiagnosticBackground\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fixture,'missing isolated diagnostic background fixture');
  const color={r:0,g:0,b:0,a:1,set(r,g,b,a){Object.assign(this,{r,g,b,a});}};
  const sky={enabled:true},terrain={enabled:true};
  const entities={EnvironmentSkyVisuals:sky,Camera:{camera:{clearColor:color}},campus_terrain:terrain};
  const app={root:{findByName:name=>entities[name]}};
  const receipt=runInNewContext(`(${fixture})()`,{window:{__INHAGAME_P0__:{app}}});
  assert.equal(sky.enabled,false);
  assert.deepEqual([color.r,color.g,color.b,color.a],[.52,.71,.84,1]);
  assert.equal(terrain.enabled,true);
  assert.equal(receipt.mode,'isolated-blue-background');
  assert.equal(receipt.productionSkyValidated,false);
  assert.equal(receipt.skyVisualsWasEnabled,true);
  assert.equal(receipt.skyVisualsEnabled,false);
  assert.throws(()=>runInNewContext(`(${fixture})()`,{window:{__INHAGAME_P0__:{app:{root:{findByName:()=>null}}}}}),/diagnostic.*missing/i);
});

test('terrain ground-fill, water-hole and far-lip assertions retain the original thresholds',()=>{
  for(const text of [
    'entry.after.changedSky>entry.after.width*entry.after.height*.003',
    'entry.after.blue<entry.before.blue',
    'assert.equal(after.sampled.length,27);assert.deepEqual(after.sampled,before.sampled',
    "['lmk_inkyung_pond','central-pool']",
    'after.changedSky>10',
    "['portrait',{width:390,height:844},true]",
    "['landscape',{width:844,height:390},true]",
    "['desktop',{width:1280,height:720},false]"
  ])assert.ok(smokeSource.includes(text),`original assertion or coverage removed: ${text}`);
  assert.ok(smokeSource.indexOf('d.app.off(\'update\')')<smokeSource.indexOf('await page.evaluate(configureTerrainDiagnosticBackground)'));
});

test('immutable-main control accepts only the identified original failure and complete repaired evidence',async()=>{
  const {BASELINE,ORIGINAL_SCRIPT_SHA256,assertHosted,verifyOriginalFailure,verifyRepairedReport,changedTrackedFiles}=await import('./browser/campus-terrain-baseline-control.mjs');
  assert.equal(BASELINE,'8416e387973058dc4e10adf70192839929c9eb89');
  assert.equal(ORIGINAL_SCRIPT_SHA256,'b981a0ece49ba0d1d2a5ef3ce0b2d808cd047d36c32376029595465bd37fb369');
  assert.throws(()=>assertHosted({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted'}),/hosted/);
  assert.throws(()=>assertHosted({}),/hosted/);
  assert.doesNotThrow(()=>assertHosted({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'}));
  const frame={width:312,height:675,blue:5218,changed:0,changedSky:0,glError:0,readbackFramebuffer:'resolved-default'};
  const original={cases:[{name:'portrait',viewport:{width:390,height:844},renderer:'WebGL2',result:'FAIL',problems:[],before:frame,after:{...frame,blue:5186,changed:17393,changedSky:5},error:'AssertionError [ERR_ASSERTION]: portrait: missing visible sky-to-ground repair (5 pixels)\n    at fixture.mjs:87:14'}]};
  assert.doesNotThrow(()=>verifyOriginalFailure(original,{status:1,signal:null}));
  for(const mutate of [
    r=>{r.cases[0].error='timeout';},
    r=>{r.cases[0].problems=['pageerror'];},
    r=>{r.cases[0].after.changedSky=2000;},
    r=>{r.cases[0].after.changed=0;},
    r=>{r.cases[0].after.glError=1282;},
    r=>{r.cases[0].renderer='UNAVAILABLE';},
    r=>{r.cases.push({...r.cases[0]});}
  ]){const r=structuredClone(original);mutate(r);assert.throws(()=>verifyOriginalFailure(r,{status:1,signal:null}));}
  for(const status of [0,124,137,null])assert.throws(()=>verifyOriginalFailure(original,{status,signal:null}));
  const pixels={...frame,sampled:Array(27).fill(50)};
  const repaired={result:'PASS',cases:['portrait','landscape','desktop'].map(name=>({
    name,result:'PASS',renderer:'WebGL2',before:frame,after:{...frame,blue:5000,changedSky:1000},
    diagnosticBackground:{mode:'isolated-blue-background',productionSkyValidated:false,skyVisualsEnabled:false,clearColor:[.52,.71,.84,1]},
    water:['lmk_inkyung_pond','central-pool'].map(id=>({id,name:id,before:pixels,after:pixels})),
    ...(name==='desktop'?{oblique:['garden','sports'].map(id=>({id,before:frame,after:{...frame,changedSky:11}}))}:{})
  }))};
  assert.doesNotThrow(()=>verifyRepairedReport(repaired,{status:0,signal:null}));
  for(const mutate of [
    r=>{r.cases.pop();},
    r=>{r.cases[0].after.changedSky=631;},
    r=>{r.cases[0].after.blue=5218;},
    r=>{r.cases[0].water[0].after={...pixels,sampled:Array(27).fill(49)};},
    r=>{r.cases[0].water.pop();},
    r=>{r.cases[0].water[0].id='unrelated-water';},
    r=>{r.cases[2].oblique[0].after.changedSky=10;},
    r=>{r.cases[0].diagnosticBackground.productionSkyValidated=true;}
  ]){const r=structuredClone(repaired);mutate(r);assert.throws(()=>verifyRepairedReport(r,{status:0,signal:null}));}
  assert.deepEqual(changedTrackedFiles({'a':'same','b':'old'},{'a':'same','b':'new'}),['b']);
  assert.deepEqual(changedTrackedFiles({'a':'same'},{'a':'same','extra':'new'}),['extra']);
});
