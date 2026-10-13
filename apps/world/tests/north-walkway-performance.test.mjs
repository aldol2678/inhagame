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
