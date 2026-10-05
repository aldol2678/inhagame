import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const source=new URL('./browser/heidegger-forest-qa.mjs',import.meta.url);
const qa=existsSync(source)?await import(source):{};
test('forest literal baseline guard replaces both modified sources and rejects a widened runtime scope',()=>{
 assert.equal(typeof qa.forestBaselinePlan,'function');
 const files=['facility-blockout.js','campus-material-profile.js','heidegger-forest-geometry.js'].map(p=>'apps/world/src/'+p);
 const plan=qa.forestBaselinePlan(files);assert.equal(plan.replace.length,2);assert.equal(plan.added.length,1);
 assert.throws(()=>qa.forestBaselinePlan(files.slice(1)),/scope/);
 assert.throws(()=>qa.forestBaselinePlan([...files,'apps/world/src/campus-layout.js']),/scope/);
});
test('forest QA views cover the brick-walk viewpoint, clearing closeup and far silhouette',()=>{
 assert.equal(typeof qa.forestViews,'function');const views=qa.forestViews();
 assert.deepEqual(views.map(v=>v.id),['brick-walk-eye','soil-and-canopy','far-silhouette']);
 for(const v of views)assert.ok([...v.from,...v.target].every(Number.isFinite));
 assert.ok(views[0].from[1]<2.5);assert.ok(views[2].from[1]>15);
});
test('hosted forest QA remains exact-head, offline and in the existing read-only workflow',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/campus-visual-parity-browser.yml',import.meta.url),'utf8');
 assert.match(workflow,/heidegger-forest-null-smoke\.mjs/);assert.match(workflow,/heidegger-forest-smoke\.mjs/);
 assert.match(workflow,/EXPECTED_FOREST_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
 assert.doesNotMatch(workflow,/pull_request_target|contents: write|secrets\.|deploy|--force/);
});

test('pixel round-trip rejects a different restored image even when toggle counts match',()=>{
 assert.equal(typeof qa.forestPixelDelta,'function');
 const original=new Uint8Array([0,0,0,255]),hidden=new Uint8Array([255,255,255,255]),wrongRestored=new Uint8Array([128,128,128,255]);
 assert.equal(qa.forestPixelDelta(original,hidden),qa.forestPixelDelta(hidden,wrongRestored));
 assert.equal(qa.forestPixelDelta(wrongRestored,original),1);
 assert.equal(qa.forestPixelDelta(original,original),0);
});

test('portrait clearing closeup pulls back on the same viewing ray',()=>{
 assert.equal(typeof qa.forestCamera,'function');const v=qa.forestViews()[1];
 const wide=qa.forestCamera(v,1280/720),portrait=qa.forestCamera(v,390/844);
 assert.deepEqual(wide,v);assert.deepEqual(portrait.target,v.target);
 for(let i=0;i<3;i++)assert.ok(Math.abs((portrait.from[i]-v.target[i])/(v.from[i]-v.target[i])-.84/(390/844))<1e-9);
 assert.deepEqual(qa.forestCamera(qa.forestViews()[0],390/844),qa.forestViews()[0]);
});
