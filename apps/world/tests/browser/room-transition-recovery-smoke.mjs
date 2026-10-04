// Hosted Chromium acceptance, entirely offline. No accounts, database writes or production calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output=path.resolve(process.env.ROOM_RECOVERY_QA_OUTPUT||'test-results/room-transition-recovery');
await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const expectedHead=process.env.EXPECTED_ROOM_HEAD;
assert.match(expectedHead??'',/^[a-f0-9]{40}$/,'EXPECTED_ROOM_HEAD must identify the immutable candidate');
assert.equal(head,expectedHead,'browser must test the exact candidate head');
const report={head,expectedHead,scope:'Offline WebGL2 real-room modules with synthetic campus/avatar and presence counters; no live accounts or optional visual assets',screenshots:[],viewports:[],sourceHashes:{},status:'RUNNING'};
for(const file of ['src/main.js','src/rooms/room-transition.js','src/rooms/room-world-adapter.js','src/rooms/space-fade.js','src/player-controller.js','src/orbit-camera-controller.js','src/lobby/lobby-loading.js']){
  report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL(`../../${file}`,import.meta.url))).digest('hex');
}
const cases=[
  ...['fade-before','leaveCampus','showRoom','placePlayer','fade-after'].map(step=>({source:'campus',action:'enter',step})),
  {source:'campus',action:'enter',step:'showRoom',async:true},
  ...['showRoom','placePlayer'].map(step=>({source:'ROOM_DORM1_LOBBY',action:'personal',step,async:true})),
  ...['showRoom','placePlayer'].map(step=>({source:'ROOM_PERSONAL_BASIC',action:'exit',step})),
  ...['showCampus','placePlayer','resumeCampus'].map(step=>({source:'ROOM_DORM1_LOBBY',action:'exit',step,async:true}))
];
const viewports=[{label:'desktop',width:1280,height:720,mobile:false},{label:'portrait360',width:360,height:800,mobile:true},{label:'portrait390',width:390,height:844,mobile:true},{label:'landscape',width:844,height:390,mobile:true}];
const snapshot=page=>page.evaluate(()=>window.__ROOM_RECOVERY_QA__.snapshot());
const settled=async(page,before)=>{
  await page.waitForFunction(count=>window.__ROOM_RECOVERY_QA__.snapshot().errors.length>count,before.errors.length,{timeout:10_000});
  const tick=await page.evaluate(()=>window.__ROOM_RECOVERY_QA__.snapshot().ticks);
  await page.waitForFunction(previous=>window.__ROOM_RECOVERY_QA__.snapshot().ticks>previous+1,tick,{timeout:10_000});
  return snapshot(page);
};
const shot=async(page,name,state)=>{
  const file=`${name}.png`;await page.screenshot({path:path.join(output,file)});
  const bytes=await readFile(path.join(output,file));
  report.screenshots.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,state});
};
const stableFields=['space','parent','movement','campus','visibleRooms','campusPaused','returnContext','metadata','parentRoomId','marker','label','camera'];
function assertRecovered(before,after,label){
  for(const key of stableFields)assert.deepEqual(after[key],before[key],`${label}: restored ${key}`);
  assert.ok(Math.hypot(...after.position.map((n,i)=>n-before.position[i]))<.015,`${label}: restored position`);
  assert.ok(Math.abs(after.rotation.reduce((sum,n,i)=>sum+n*before.rotation[i],0))>.9999,`${label}: restored full quaternion`);
  assert.equal(after.busy,false,`${label}: busy cleared`);
  assert.equal(after.inputEnabled,true,`${label}: controller input restored`);
  assert.equal(after.cameraEnabled,true,`${label}: camera input restored`);
  assert.equal(after.focus.activeClaimCount,0,`${label}: no leaked focus owner`);
  assert.equal(after.fadeHidden,true,`${label}: fade hidden`);assert.equal(after.fadeOn,false,`${label}: black class removed`);
  assert.deepEqual(after.stats,before.stats,`${label}: failure is not success`);
  assert.equal(after.events.length,before.events.length,`${label}: no false ownership event`);
  assert.equal(after.errors.at(-1).recovered,true);
  assert.match(after.message,/다시 시도/);
}
try{
 for(const viewport of viewports){
  const smoke=await startSmoke({viewport:{width:viewport.width,height:viewport.height},contextOptions:{isMobile:viewport.mobile,hasTouch:viewport.mobile}});
  let page;
  try{
   page=await smoke.context.newPage();const fatal=smoke.watch(page);
   await page.goto(`${smoke.origin}/tests/browser/room-transition-recovery-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>window.__ROOM_RECOVERY_QA__?.ready||window.__ROOM_RECOVERY_QA__?.error,null,{timeout:TIMEOUT_MS}),fatal]);
   assert.equal(await page.evaluate(()=>window.__ROOM_RECOVERY_QA__.error??null),null);
   const click=async action=>{const button=page.locator(`#qa-${action}`);viewport.mobile?await button.tap():await button.click();};
   const cdp=viewport.mobile?await smoke.context.newCDPSession(page):null;
   const moveGesture=async({locked=false}={})=>{
     if(!viewport.mobile){await page.keyboard.down('KeyD');await page.waitForTimeout(250);await page.keyboard.up('KeyD');return;}
     const rect=await page.locator('#joystick').boundingBox();assert.ok(rect);
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2+25,y:rect.y+rect.height/2,id:51,radiusX:1,radiusY:1,force:1}]});
     if(!locked)await page.waitForFunction(()=>Math.hypot(...Object.values(window.__ROOM_RECOVERY_QA__.controller.touchVector))>.2);
     await page.waitForTimeout(250);
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     const state=await snapshot(page);assert.deepEqual(state.touchVector,{x:0,y:0});
     assert.ok(state.trustedTouches.some(event=>event.trusted&&event.type==='touch'),'native trusted joystick event reached the real controller');
   };
   const results=[];
   for(const [index,scenario] of cases.entries()){
    await page.evaluate(source=>window.__ROOM_RECOVERY_QA__.prepare(source),scenario.source);
    const before=await snapshot(page);
    await page.evaluate(config=>window.__ROOM_RECOVERY_QA__.arm(config),scenario);
    await click(scenario.action);
    const during=await snapshot(page);
    assert.equal(during.busy,true,`${viewport.label}#${index}: in-flight lock`);
    assert.equal(during.inputEnabled,false);assert.equal(during.cameraEnabled,false);
    const after=await settled(page,before);
    const label=`${viewport.label}-${index}-${scenario.action}-${scenario.step}`;
    assertRecovered(before,after,label);
    const capture=scenario.step==='placePlayer'&&scenario.source!=='ROOM_PERSONAL_BASIC';
    if(capture)await shot(page,`${label}-recovered`,after);
    // A trusted key event actually moves the real PlayerController after recovery.
    if(index===0){
      await moveGesture();
      const moved=await snapshot(page);assert.ok(Math.hypot(moved.position[0]-after.position[0],moved.position[2]-after.position[2])>.03,'recovered native movement works');
    }
    await page.evaluate(()=>window.__ROOM_RECOVERY_QA__.arm(null));
    await click(scenario.action);
    await page.waitForFunction(count=>{const s=window.__ROOM_RECOVERY_QA__.snapshot();return !s.busy&&s.events.length>count;},before.events.length,{timeout:10_000});
    const retried=await snapshot(page);
    const expectedRoom=scenario.action==='enter'?'ROOM_CLUBHOUSE_01':scenario.action==='personal'?'ROOM_PERSONAL_BASIC':scenario.source==='ROOM_PERSONAL_BASIC'?'ROOM_DORM1_LOBBY':'campus';
    assert.equal(retried.space,expectedRoom,'retry reaches the intended destination');
    assert.equal(retried.movement,expectedRoom);assert.equal(retried.campus,expectedRoom==='campus');
    assert.deepEqual(retried.visibleRooms,expectedRoom==='campus'?[]:[expectedRoom]);
    assert.equal(retried.campusPaused,expectedRoom!=='campus');
    assert.equal(retried.fadeHidden,true);assert.equal(retried.inputEnabled,true);assert.equal(retried.cameraEnabled,true);
    assert.equal(retried.events.length,before.events.length+1,'retry commits exactly once');
    assert.equal(retried.children,before.children,'scene roots do not accumulate');
    if(capture)await shot(page,`${label}-retry`,retried);
    results.push({scenario,before,during,after,retried});
   }
   // Reduced motion exercises the same UI and modules without relying on visual timers.
   await page.evaluate(()=>window.__ROOM_RECOVERY_QA__.prepare('campus'));
   await page.emulateMedia({reducedMotion:'reduce'});
   const reducedBefore=await snapshot(page);
   await page.evaluate(()=>window.__ROOM_RECOVERY_QA__.arm({step:'placePlayer',async:true}));
   await click('enter');const reducedAfter=await settled(page,reducedBefore);
   assertRecovered(reducedBefore,reducedAfter,`${viewport.label}-reducedMotion`);
   await page.emulateMedia({reducedMotion:'no-preference'});
   // Failed rollback is terminal for this page. It must clear black but retain the safe lock.
   await page.evaluate(()=>window.__ROOM_RECOVERY_QA__.arm({step:'showRoom',rollbackFail:true}));
   const lockedBefore=await snapshot(page);await click('enter');const locked=await settled(page,lockedBefore);
   assert.equal(locked.busy,true);assert.equal(locked.inputEnabled,false);assert.equal(locked.cameraEnabled,false);
   assert.equal(locked.focus.topOwners.includes('room-transition'),true);
   assert.equal(locked.fadeHidden,true);assert.equal(locked.fadeOn,false);assert.equal(locked.errors.at(-1).recovered,false);
   assert.match(locked.message,/새로고침/);
   await moveGesture({locked:true});
   const stillLocked=await snapshot(page);assert.deepEqual(stillLocked.position,locked.position,'fail-closed state refuses movement');
   assert.equal(await page.locator('#qa-enter').isDisabled(),true);
   await shot(page,`${viewport.label}-rollback-failure-locked`,locked);
   assert.deepEqual(smoke.problems,[],smoke.problems.join('\n'));
   report.viewports.push({viewport,cases:results,reducedMotion:{before:reducedBefore,after:reducedAfter},rollbackFail:locked,problems:[...smoke.problems]});
  }catch(error){
   report.error=String(error?.stack??error);
   if(page){try{await shot(page,`${viewport.label}-failure`,await snapshot(page));}catch{}}
   throw error;
  }finally{await smoke.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
 }
 report.status='PASS';
 console.log(JSON.stringify({status:report.status,head,viewports:report.viewports.length,failureRetryCases:cases.length*viewports.length,reducedMotionCases:viewports.length,rollbackFailCases:viewports.length,screenshots:report.screenshots.length}));
}catch(error){report.status='FAIL';throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
