import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const [beforePath,afterPath,output]=process.argv.slice(2);
assert.ok(beforePath&&afterPath&&output,'usage: before/report.json after/report.json comparison.json');
const before=JSON.parse(await readFile(beforePath,'utf8')),after=JSON.parse(await readFile(afterPath,'utf8'));
assert.ok(!before.error&&!after.error);assert.equal(before.renderer,after.renderer);
assert.deepEqual(before.cameras,after.cameras);assert.equal(before.views.length,21);assert.equal(after.views.length,21);
// Mission-specific surrogate budgets declared before measurement. They are
// not a project-wide/mobile-device performance guarantee.
const budgets={p95Ratio:1.15,p95SlackMs:2,drawCallDelta:16,triangleRatio:1.05,vramRatio:1.10,heapRatio:1.15};
const views=after.views.map(a=>{
 const b=before.views.find(b=>b.viewport===a.viewport&&b.id===a.id);assert.ok(b);
 assert.deepEqual(a.framebuffer,b.framebuffer);assert.deepEqual(a.camera,b.camera);assert.equal(a.samples,b.samples);
 for(const key of ['p50Ms','p95Ms','fps','drawCalls','triangles','vramBytes','heapBytes'])assert.ok(Number.isFinite(a[key])&&a[key]>0&&Number.isFinite(b[key])&&b[key]>0,`${a.viewport}/${a.id}: ${key}`);
 const delta=Object.fromEntries(['p50Ms','p95Ms','fps','drawCalls','triangles','vramBytes','heapBytes'].map(k=>[k,a[k]-b[k]]));
 const holds=[];
 if(a.p95Ms>b.p95Ms*budgets.p95Ratio+budgets.p95SlackMs)holds.push('p95');
 if(delta.drawCalls>budgets.drawCallDelta)holds.push('drawCalls');
 if(a.triangles>b.triangles*budgets.triangleRatio)holds.push('triangles');
 if(a.vramBytes>b.vramBytes*budgets.vramRatio)holds.push('vram');
 if(a.heapBytes>b.heapBytes*budgets.heapRatio)holds.push('heap');
 return {viewport:a.viewport,id:a.id,before:b,after:a,delta,holds};
});
const report={baselineHead:before.head,candidateHead:after.head,measurement:after.measurement,budgets,
 status:views.some(v=>v.holds.length)?'HOLD':'PASS_SURROGATE_ONLY',physicalMobile:'NOT_MEASURED',views};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(report.status);for(const v of views)console.log(`${v.viewport} ${v.id}: p95 ${v.before.p95Ms.toFixed(1)} -> ${v.after.p95Ms.toFixed(1)}; draws ${v.delta.drawCalls>=0?'+':''}${v.delta.drawCalls}; ${v.holds.join(',')||'within budget'}`);
if(report.status==='HOLD')process.exitCode=1;
