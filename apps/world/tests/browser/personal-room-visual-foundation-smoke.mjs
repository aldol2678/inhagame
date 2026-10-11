// Reproducible real-render browser QA. Run only where the existing browser harness is supported.
// Optional ROOM_VISUAL_QA_WORLD_ROOT selects before/after source; no live server is contacted.
// This script is prepared for supported browser execution. Null/Blender checks are NOT this pass.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {assertRoomVisualAssets} from './personal-room-visual-foundation-policy.mjs';
const output=path.resolve(process.env.ROOM_VISUAL_QA_OUTPUT||'test-results/personal-room-visual-foundation');await mkdir(output,{recursive:true});
const fixtureFiles=['personal-room-visual-foundation-harness.html','personal-room-visual-foundation-fixture.mjs'];
const fixtures=new Map(await Promise.all(fixtureFiles.map(async name=>[name,await readFile(new URL(name,import.meta.url))])));
const report={kind:'actual-playcanvas-webgl2',results:[]};
for(const assetMode of ['loaded','fallback'])for(const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
 const smoke=await startSmoke({worldRoot:process.env.ROOM_VISUAL_QA_WORLD_ROOT,viewport:{width:viewport.width,height:viewport.height}});
 try{
  // Serve this harness even when sampling the untouched baseline root.
  for(const [name,body] of fixtures)await smoke.context.route(url=>url.pathname===`/tests/browser/${name}`,route=>route.fulfill({status:200,contentType:name.endsWith('.html')?'text/html':'text/javascript',body}));
  const page=await smoke.context.newPage(),fatal=smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/personal-room-visual-foundation-harness.html?assetMode=${assetMode}`,{waitUntil:'domcontentloaded'});
  await Promise.race([fatal,page.waitForFunction(()=>window.__ROOM_VISUAL_FOUNDATION_QA__?.ready||window.__ROOM_VISUAL_FOUNDATION_QA__?.error,null,{timeout:TIMEOUT_MS})]);
  assert.equal(await page.evaluate(()=>window.__ROOM_VISUAL_FOUNDATION_QA__.error??null),null);
  for(const view of ['entry','sleep-study','cutaway']){
   await page.locator(`[data-view="${view}"]`).click();const frames=await page.evaluate(()=>window.__ROOM_VISUAL_FOUNDATION_QA__.frames);
   await page.waitForFunction(before=>window.__ROOM_VISUAL_FOUNDATION_QA__.frames>before+3,frames);
   const state=await page.evaluate(()=>window.__ROOM_VISUAL_FOUNDATION_QA__.snapshot());assertRoomVisualAssets(state,assetMode);assert.equal(state.view,view);assert.equal(state.device,'webgl2');assert.ok(state.meshInstances>0);assert.ok(state.frames>3);
   await page.screenshot({path:path.join(output,`${assetMode}-${viewport.name}-${view}.png`)});report.results.push({assetMode,viewport,view,state});
  }
  assert.equal(smoke.problems.length,0,JSON.stringify(smoke.problems));
 }finally{await smoke.close();}
}
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(`Personal room visual foundation browser QA passed: ${output}`);
