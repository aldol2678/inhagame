import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const report=()=>({head:'fixture',renderer:'WebGL2',measurement:'requestAnimationFrame + synchronous 1px framebuffer readback',cameras:[],views:['desktop','portrait','landscape'].flatMap(viewport=>['CAM-A','CAM-B','CAM-C','CAM-D','CAM-E','CAM-F','CAM-G','FIVE-SOUTH-ENTRY'].map(id=>({viewport,id,framebuffer:[800,600],camera:[0,1,2],samples:60,p50Ms:100,p95Ms:100,completedFrameP95Ms:90,fps:10,drawCalls:100,triangles:10000,vramBytes:10000,heapBytes:10000,rawIntervals:Array(60).fill(100),rawCompletedFrameMs:Array(60).fill(90)})))});
function compare(change=()=>{}){
 const dir=mkdtempSync(join(tmpdir(),'walkway-performance-'));
 try{
  const before=report(),after=report();change(after,before);
  for(const [name,r]of [['before',before],['after',after]])writeFileSync(join(dir,name+'.json'),JSON.stringify(r));
  const result=spawnSync(process.execPath,[new URL('./browser/north-walkway-compare.mjs',import.meta.url).pathname,join(dir,'before.json'),join(dir,'after.json'),join(dir,'result.json')],{encoding:'utf8'});
  let output;try{output=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));}catch{}
  return {status:result.status,output};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('completed-frame comparison retains every old budget and adds a GPU completion gate',()=>{
 const r=compare();assert.equal(r.status,0);assert.deepEqual(r.output.budgets,{p95Ratio:1.15,p95SlackMs:2,drawCallDelta:16,triangleRatio:1.05,vramRatio:1.10,heapRatio:1.15});
 for(const [key,value,hold]of [['p95Ms',118,'p95'],['completedFrameP95Ms',106,'completedFrameP95'],['drawCalls',117,'drawCalls'],['triangles',10501,'triangles'],['vramBytes',11001,'vram'],['heapBytes',11501,'heap']]){
  const r=compare(a=>{a.views.at(-1)[key]=value;});assert.equal(r.status,1);assert.equal(r.output.status,'HOLD');assert.ok(r.output.views.at(-1).holds.includes(hold));
 }
});
test('comparison rejects missing or duplicate views, mismatched protocols and lost raw samples',()=>{
 for(const change of [a=>a.views.pop(),a=>a.views[0]=a.views[1],a=>a.measurement='gl.finish only',a=>a.views[0].rawIntervals.pop(),a=>a.views[0].rawCompletedFrameMs[0]=null,a=>a.views[0].samples=30])assert.notEqual(compare(change).status,0);
});


// Release integration must compare its delta against the already shipped base,
// never erase the independent candidate's original baseline or relax budgets.
import {selectWalkwayBaseline, STANDALONE_BASELINE, REVIEWED_RELEASE_BRANCH, REVIEWED_RELEASE_BASE} from './browser/north-walkway-baseline.mjs';
test('standalone walkway retains its original immutable performance baseline',()=>{
 assert.equal(STANDALONE_BASELINE,'2b9a09615f7986e3d5e5b93d731fba21f33afbdd');
 assert.equal(REVIEWED_RELEASE_BASE,'bfa08ad78f92fba51eb1a3978dd97a12182fc82c');
 assert.equal(selectWalkwayBaseline({headRef:'feat/60th-five-walkway-20261012',baseSha:REVIEWED_RELEASE_BASE}),STANDALONE_BASELINE);
 assert.equal(selectWalkwayBaseline(),STANDALONE_BASELINE);
});
test('only the reviewed release and exact main base select the release comparison',()=>{
 assert.equal(selectWalkwayBaseline({headRef:REVIEWED_RELEASE_BRANCH,baseSha:REVIEWED_RELEASE_BASE}),REVIEWED_RELEASE_BASE);
 for(const baseSha of ['',STANDALONE_BASELINE,'0'.repeat(40),REVIEWED_RELEASE_BASE.slice(0,7)])assert.throws(()=>selectWalkwayBaseline({headRef:REVIEWED_RELEASE_BRANCH,baseSha}),/fail closed/);
 for(const headRef of ['release/other','release/2026-10-13-ci-runtime-diagnostics-extra'])assert.throws(()=>selectWalkwayBaseline({headRef,baseSha:REVIEWED_RELEASE_BASE}),/fail closed/);
});
test('workflow samples the selected immutable baseline and triggers for selector changes',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/north-walkway-browser.yml',import.meta.url),'utf8');
 assert.ok(workflow.includes("'apps/world/tests/browser/north-walkway-*'"));
 assert.ok(workflow.includes('WALKWAY_HEAD_REF: ${{ github.event.pull_request.head.ref }}'));
 assert.ok(workflow.includes('WALKWAY_PR_BASE: ${{ github.event.pull_request.base.sha }}'));
 assert.ok(workflow.includes('baseline=$(node apps/world/tests/browser/north-walkway-baseline.mjs)'));
 assert.ok(workflow.includes('git worktree add --detach /tmp/walkway-main "$baseline"'));
 assert.ok(workflow.includes('EXPECTED_WALKWAY_HEAD="$baseline"'));
 assert.ok(workflow.includes('EXPECTED_WALKWAY_HEAD: ${{ github.event.pull_request.head.sha }}'));
});
