// Actual rendered pixels, never a null-device substitute. No reference photos are served.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const output=process.env.WORLD_PHOTO_QA_OUTPUT||'test-results/photo-landmarks';await mkdir(output,{recursive:true});
const report={scope:'Three photo-informed landmarks, offline renderer only. BASE/detail comparisons are visibility checks, not original-version screenshots.',cases:[]};
const assertFrame=frame=>{assert.ok(frame.points>0);assert.ok(frame.minX>=.06&&frame.maxX<=.94&&frame.minY>=.06&&frame.maxY<=.94,`actual mesh bounds must fit: ${JSON.stringify(frame)}`);assert.equal(frame.captionOverlapsCanvas,false);};
try{
 for(const [name,viewport,mobile] of [['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true],['desktop',{width:1280,height:720},false]]){
  const entry={name,viewport,landmarks:[]};report.cases.push(entry);let smoke;
  try{
   smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}});
   const page=await smoke.context.newPage(),fatal=smoke.watch(page);
   await page.goto(`${smoke.origin}/tests/browser/photo-landmarks-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>window.__PHOTO_LANDMARK_QA__?.ready||window.__PHOTO_LANDMARK_QA__?.error,null,{timeout:TIMEOUT_MS}),fatal]);
   assert.equal(await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.error),undefined);
   entry.stats=await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.stats());assert.equal(entry.stats.groups.length,3);
   for(const id of ['bldg_07','bldg_01','bldg_jungseok'])for(const reflected of [true,false]){
    const view=options=>page.evaluate(({id,reflected,options})=>window.__PHOTO_LANDMARK_QA__.view(id,reflected,options),{id,reflected,options});
    const pixels=()=>page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.pixels({compare:true}));
    await view({hidden:true});await pixels();await view({details:false});const base=await pixels();assert.ok(base.changed>10,`${id}: visible base`);
    await view({details:true});const detail=await pixels();assert.ok(detail.changed>10,`${id}: visible refinement tiers`);assert.equal(detail.scaleSign,reflected?-1:1);assert.equal(detail.glError,0);
    const stable=await pixels();assert.equal(stable.hash,detail.hash,`${id}: stationary frame stable`);assert.equal(stable.changed,0);
    const framing=await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.framing());assertFrame(framing);
    entry.landmarks.push({id,reflected,base,detail,stable,framing});
    await page.screenshot({path:path.join(output,`${name}-${id}-${reflected?'production-z':'control-z'}.png`),timeout:TIMEOUT_MS});
   }
   await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.view('bldg_jungseok',true,{mode:'canopy'}));
   const canopy=await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.pixels({compare:true}));
   const canopyStable=await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.pixels({compare:true}));
   const framing=await page.evaluate(()=>window.__PHOTO_LANDMARK_QA__.framing());assertFrame(framing);
   assert.equal(canopy.glError,0);assert.equal(canopyStable.hash,canopy.hash);assert.equal(canopyStable.changed,0);
   entry.canopy={scope:'Low oblique entrance-canopy close-up; framing covers the canopy only, not the complete building',pixels:canopy,stable:canopyStable,framing};
   await page.screenshot({path:path.join(output,`${name}-bldg_jungseok-entry-canopy.png`),timeout:TIMEOUT_MS});
   assert.deepEqual(smoke.problems,[]);entry.result='PASS';
  }catch(error){entry.result='FAIL';entry.error=String(error.stack||error);throw error;}
  finally{if(smoke)await smoke.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
 }
 console.log('photo-informed landmark Chromium pixels: PASS');
}finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
