import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const output=process.env.ROOM_ENV_QA_OUTPUT||'test-results/personal-room-environment';await mkdir(output,{recursive:true});
const report=[];
for(const mobile of [false,true]){
 const smoke=await startSmoke({viewport:mobile?{width:390,height:844}:{width:1440,height:900},contextOptions:{hasTouch:mobile,isMobile:mobile}});
 try{
  const page=await smoke.context.newPage(),fatal=smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/personal-room-environment-harness.html`,{waitUntil:'domcontentloaded'});
  await Promise.race([fatal,page.waitForFunction(()=>window.__ROOM_ENV_QA__?.ready||window.__ROOM_ENV_QA__?.error,null,{timeout:TIMEOUT_MS})]);
  assert.equal(await page.evaluate(()=>window.__ROOM_ENV_QA__.error??null),null);
  const snap=()=>page.evaluate(()=>window.__ROOM_ENV_QA__.snapshot());
  const initial=await snap();assert.equal(initial.device,'webgl2');assert.equal(initial.graphicsTier,'low');assert.equal(initial.lightCount,3);
  assert.ok(initial.canvasRect.height >= (mobile?844:900)-1,'canvas fills viewport height');
  assert.ok(initial.canvasRect.width >= (mobile?390:1440)-1,'canvas fills viewport width');
  const activate=async()=>mobile? page.locator('#action').tap():page.keyboard.press('f');
  await activate();assert.equal((await snap()).lightsOn,false);
  await page.evaluate(()=>{window.__ROOM_ENV_QA__.time(67);window.__ROOM_ENV_QA__.control('curtain');});
  await activate();await page.waitForFunction(()=>window.__ROOM_ENV_QA__.snapshot().openness===0);
  const dark=await snap();assert.ok(dark.ambient.every(v=>v>=.27));assert.equal(dark.lights.every(l=>l.intensity===0&&!l.shadow),true);
  assert.equal(dark.other.every(n=>n===.7),true);assert.equal(dark.renderCount,initial.renderCount);
  await page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}-night-off-closed.png`});
  await page.evaluate(()=>window.__ROOM_ENV_QA__.block(true));assert.equal(await page.locator('#action').isHidden(),true);
  await page.keyboard.press('f');assert.equal((await snap()).curtainsOpen,false);
  await page.evaluate(()=>{window.__ROOM_ENV_QA__.block(false);window.__ROOM_ENV_QA__.account('synthetic-account-b:room-b');});
  assert.equal((await snap()).lightsOn,true);assert.equal((await snap()).openness,1);
  for(let i=0;i<10;i++)await page.evaluate(()=>{window.__ROOM_ENV_QA__.active(false);window.__ROOM_ENV_QA__.active(true);});
  const after=await snap();assert.equal(after.renderCount,initial.renderCount);assert.equal(after.textures,initial.textures);
  await page.evaluate(()=>window.__ROOM_ENV_QA__.time(20));const day=await snap();assert.notEqual(day.sky,dark.sky);
  await page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}-day-on-open.png`});
  assert.equal(smoke.problems.length,0,JSON.stringify(smoke.problems));report.push({mobile,initial,dark,after,day});
 }finally{await smoke.close();}
}
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(`Room environment browser QA passed: ${output}`);
