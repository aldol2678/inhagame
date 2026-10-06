import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const source=new URL('./browser/heidegger-forest-qa.mjs',import.meta.url);
const qa=existsSync(source)?await import(source):{};
test('forest-isolated baseline accepts only the complete approved extension',()=>{
 assert.equal(typeof qa.forestBaselinePlan,'function');
 const forest=['facility-blockout.js','campus-material-profile.js','heidegger-forest-geometry.js'].map(p=>'apps/world/src/'+p);
 const extra=['seat-anchors.js','matching-tree-layout.js','matching-tree-geometry.js'].map(p=>'apps/world/src/'+p);
 extra.push('apps/world/data/reality/campus-facilities.json');
 const plan=qa.forestBaselinePlan([...forest,...extra]);
 assert.deepEqual(plan.replace,['apps/world/src/campus-material-profile.js']);
 assert.ok(plan.shared.includes('apps/world/src/facility-blockout.js'));
 assert.ok(plan.shared.includes('apps/world/src/matching-tree-geometry.js'));
 assert.throws(()=>qa.forestBaselinePlan([...forest,...extra.slice(1)]),/scope/);
 assert.throws(()=>qa.forestBaselinePlan([...forest,...extra,'apps/world/src/campus-layout.js']),/scope/);
 assert.throws(()=>qa.forestBaselinePlan([...forest,...extra,'apps/world/data/reality/campus-landmarks.json']),/scope/);
 assert.throws(()=>qa.forestBaselinePlan([...forest,...extra,extra[0]]),/scope/);
});
test('isolated forest adapter extracts only the exact previous-main grove branch and rejects changed shapes',async()=>{
 assert.equal(typeof qa.forestBaselineAdapter,'function');
 const source = `import { forestRoadTrees } from './campus-road-layout.js';
function tree(batch,x,z,scale=1,color='#527447') {
  batch.tube('#6c5942',[x,0,z],[x,3.2*scale,z],.24*scale);
  batch.crown(color,[x,4.1*scale,z],[4*scale,3.4*scale,4*scale]);
}
function landmark(root,batch,f) {
  if(f.style==='forest'){
    forestRoadTrees(f.center).forEach((p,i)=>tree(batch,p.x,p.z,1.25,i%2?'#567f48':'#41694b'));
    return;
  }
  if(f.style==='tree'){ throw Error('unrelated matching tree must not be copied'); }
}`;
 const adapter=qa.forestBaselineAdapter(source);
 assert.match(adapter,/export function fillHeideggerForest/);
 assert.doesNotMatch(adapter,/fillMatchingTree|lmk_matching_tree|function landmark/);
 for(const changed of [source.replace('3.2*scale','3.3*scale'),source.replace("i%2?'#567f48'", "i%2?'#000000'"),source.replace("if(f.style==='forest'){", "if(f.style==='forest' || f.style==='park'){")])
  assert.throws(()=>qa.forestBaselineAdapter(changed),/previous-main forest/);
 const {forestRoadTrees}=await import('../src/campus-road-layout.js');
 const fill=new Function('forestRoadTrees',adapter.replace(/^import[^\n]+\n/,'').replace('export function','function')+'; return fillHeideggerForest;')(forestRoadTrees);
 const calls=[],batch={tube(...args){calls.push(['tube',...args]);},crown(...args){calls.push(['crown',...args]);}};
 const center={x:10,z:20}; fill(batch,center);
 const expected=forestRoadTrees(center).flatMap((p,i)=>[
  ['tube','#6c5942',[p.x,0,p.z],[p.x,4,p.z],.3],
  ['crown',i%2?'#567f48':'#41694b',[p.x,5.125,p.z],[5,4.25,5]]]);
 assert.deepEqual(calls,expected);
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
