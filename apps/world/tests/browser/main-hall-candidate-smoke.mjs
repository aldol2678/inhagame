import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const output=process.env.WORLD_MAIN_HALL_QA_OUTPUT||'test-results/main-hall-candidate';await mkdir(output,{recursive:true});
const report={scope:'Main Hall existing/candidate same-camera comparison; source photos are not served.',cases:[]};
try{for(const[name,viewport]of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}]]){let smoke;try{
 smoke=await startSmoke({viewport});const page=await smoke.context.newPage(),fatal=smoke.watch(page);
 await page.goto(`${smoke.origin}/tests/browser/main-hall-candidate-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>window.__MAIN_HALL_CANDIDATE_QA__?.ready||window.__MAIN_HALL_CANDIDATE_QA__?.error,null,{timeout:TIMEOUT_MS}),fatal]);assert.equal(await page.evaluate(()=>window.__MAIN_HALL_CANDIDATE_QA__.error),undefined);
 for(const reflected of [true,false])for(const mode of ['full','entry']){
  const render=async variant=>{await page.evaluate(({variant,reflected,mode})=>window.__MAIN_HALL_CANDIDATE_QA__.view(variant,reflected,{detailMode:mode}),{variant,reflected,mode});const p=await page.evaluate(()=>window.__MAIN_HALL_CANDIDATE_QA__.pixels());assert.equal(p.glError,0);assert.equal(p.activeVariants,1);assert.equal(p.scaleSign,reflected?-1:1);await page.screenshot({path:path.join(output,`${name}-${mode}-${reflected?'production':'control'}-${variant}.png`),timeout:TIMEOUT_MS});return p;};
  const existing=await render('existing'),candidate=await render('candidate');assert.ok(candidate.changed>10,'candidate changes actually rendered pixels');const stable=await page.evaluate(()=>window.__MAIN_HALL_CANDIDATE_QA__.pixels());assert.equal(stable.hash,candidate.hash);assert.equal(stable.changed,0);report.cases.push({name,reflected,mode,existing,candidate,stable});
 }
 assert.deepEqual(smoke.problems,[]);
}finally{if(smoke)await smoke.close();}}report.result='PASS';}catch(error){report.result='BLOCKED_OR_FAILED';report.error=String(error.stack||error);throw error;}finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
