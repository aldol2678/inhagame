import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output=process.env.WORLD_ROACH_QA_OUTPUT||'test-results/giant-roach';
const smoke=await startSmoke({viewport:{width:1280,height:720}});
const page=await smoke.context.newPage();
const fatal=smoke.watch(page);
const results=[];
try{
  await page.goto(`${smoke.origin}/campus/?giantRoachTest=1&roachCount=10&envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
  await Promise.race([page.waitForFunction(()=>window.__GIANT_ROACH_TEST__?.status?.().activeEntityCount===10,null,{timeout:TIMEOUT_MS}),fatal]);
  for(const count of [10,30,50,100]){
    await page.evaluate(n=>window.__GIANT_ROACH_TEST__.setCount(n),count);
    await page.waitForTimeout(6000);
    const samples=[];
    for(let i=0;i<5;i++){samples.push(await page.evaluate(()=>window.__GIANT_ROACH_TEST__.status()));await page.waitForTimeout(500);}
    const avg=k=>{const v=samples.map(s=>s[k]).filter(Number.isFinite);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*100)/100:null};
    results.push({count,fps:avg('fps'),frameTimeMs:avg('frameTimeMs'),runtimeUpdateMs:avg('runtimeUpdateMs'),
      navigationMs:avg('navigationMs'),memoryUsedMB:avg('memoryUsedMB'),drawCalls:avg('drawCalls'),
      triangles:avg('triangles'),errors:Math.max(...samples.map(s=>s.errors??0)),activeEntityCount:samples.at(-1).activeEntityCount});
  }
  const cleanup=await page.evaluate(()=>{window.__GIANT_ROACH_TEST__.destroy();return {api:'__GIANT_ROACH_TEST__' in window,nodes:[...document.querySelectorAll('*')].filter(e=>e.name?.startsWith?.('GIANT_ROACH_')).length};});
  assert.equal(cleanup.api,false);
  assert.equal(smoke.problems.length,0,smoke.problems.join('\n'));
  assert.deepEqual(results.map(r=>r.activeEntityCount),[10,30,50,100]);
  assert.equal(results.some(r=>r.errors>0),false);
  await mkdir(output,{recursive:true}); await writeFile(`${output}/metrics.json`,JSON.stringify({environment:'GitHub Actions headless Chromium / SwiftShader WebGL2',results,cleanup},null,2));
  console.log(JSON.stringify(results,null,2));
} finally { await page.close(); await smoke.close(); }
