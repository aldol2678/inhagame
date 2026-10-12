import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const output='test-results/sofa-glb-pilot';await mkdir(output,{recursive:true});
const report={mission:'INHA-WORLD-PERSONAL-ROOM-GLB-PILOT-01',status:'RUNNING',performanceAcceptance:'UNKNOWN',physicalMobile:'UNKNOWN',results:[]};
report.sourceSha256={};
for(const path of ['src/rooms/furniture-renderer.js','src/rooms/furniture-glb-visual.js','src/rooms/furniture-visual-assets.js','src/rooms/furniture-layout.js','src/rooms/furniture-functions.js','assets/furniture/dorm-single-sofa-v1.glb'])report.sourceSha256[path]=createHash('sha256').update(await readFile(new URL('../../'+path,import.meta.url))).digest('hex');
const assetUrl='/assets/furniture/dorm-single-sofa-v1.glb';
try{
 for(const [name,width,height] of [['desktop',1280,800],['portrait',390,844],['landscape',844,390]]){
  const smoke=await startSmoke({viewport:{width,height}});
  try{
   for(const quality of ['low','medium','high'])for(const mode of ['procedural','glb']){
    const page=await smoke.context.newPage(),fatal=smoke.watch(page);
    await page.goto(`${smoke.origin}/tests/browser/housing-sofa-glb-harness.html?mode=${mode}&quality=${quality}`);
    await Promise.race([fatal,page.waitForFunction(()=>window.__SOFA_QA__?.ready||window.__SOFA_QA__?.error,null,{timeout:TIMEOUT_MS})]);
    assert.equal(await page.evaluate(()=>window.__SOFA_QA__.error??null),null);
    const before=await page.evaluate(()=>window.__SOFA_QA__.frames);await page.waitForFunction(n=>window.__SOFA_QA__.frames>n+12,before);
    const state=await page.evaluate(()=>window.__SOFA_QA__.snapshot());assert.equal(state.device,'webgl2');assert.ok(state.triangles>0);
    if(mode==='glb'){assert.equal(state.visual.objects[0].state,'GLB');assert.ok(state.triangles<=2000);}
    const file=`${name}-${quality}-${mode}.png`;await page.screenshot({path:`${output}/${file}`});
    const result={name,quality,mode,state,image:file,imageSha256:createHash('sha256').update(await readFile(`${output}/${file}`)).digest('hex')};report.results.push(result);
    if(quality==='medium'&&mode==='glb'){
     const thumb=await page.evaluate(()=>window.__SOFA_QA__.capture());assert.equal(thumb.mode,'GLB');assert.ok(thumb.image.startsWith('data:image/png;base64,'));
     result.thumbnail={mode:thumb.mode,cacheKey:thumb.cacheKey,bytes:Buffer.from(thumb.image.split(',')[1],'base64').length};
     result.cycles=await page.evaluate(()=>window.__SOFA_QA__.cycle());
     assert.ok(result.cycles.filter(x=>x.phase==='empty').every(x=>x.children===0&&x.resources.length===0));
     assert.ok(result.cycles.filter(x=>x.phase==='two').every(x=>x.resources.length===1&&x.resources[0].refs===2));
     const empty=result.cycles.filter(x=>x.phase==='empty');assert.equal(empty.at(-1).vram.vb,empty[0].vram.vb);assert.equal(empty.at(-1).vram.ib,empty[0].vram.ib);
    }
    await page.close();
   }
   // Deliberate asset failure: same renderer, visible complete procedural fallback.
   const page=await smoke.context.newPage();await page.route(`**${assetUrl}`,route=>route.abort('failed'));
   await page.goto(`${smoke.origin}/tests/browser/housing-sofa-glb-harness.html?mode=glb&quality=medium`);
   await page.waitForFunction(()=>window.__SOFA_QA__?.ready||window.__SOFA_QA__?.error,null,{timeout:TIMEOUT_MS});
   assert.equal(await page.evaluate(()=>window.__SOFA_QA__.error??null),null);const state=await page.evaluate(()=>window.__SOFA_QA__.snapshot());assert.equal(state.visual.objects[0].state,'FALLBACK');assert.ok(state.meshInstances>0);await page.screenshot({path:`${output}/${name}-fallback.png`});report.results.push({name,mode:'intentional-failure',state});await page.close();
  }finally{await smoke.close();}
 }
 report.status='PASS';report.overall='HOLD';report.holdReason='Hardware GPU/mobile performance and user visual acceptance are not proven by software WebGL browser samples.';
}catch(error){report.status='FAIL';report.error=error.stack;throw error;}
finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
