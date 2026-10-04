import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output=process.env.WORLD_STABILITY_OUTPUT||'test-results/world-stability';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.EXPECTED_STABILITY_HEAD,'browser evidence must match the requested PR head');
await mkdir(output,{recursive:true});
const report={head,scope:'Actual Chromium, production source modules/DOM/pointer capture, synthetic accounts/RPC only; no real purchases, login, DB or full-campus rendering',cases:[],screenshots:[],status:'RUNNING'};
const shot=async(page,name)=>{const path=`${output}/${name}.png`;await page.screenshot({path,animations:'disabled',fullPage:false});report.screenshots.push({name:`${name}.png`,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});};
try{
 for(const [name,viewport,mobile] of [['desktop',{width:1280,height:800},false],['mobile',{width:390,height:844},true]]){
  const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:true,deviceScaleFactor:1}});let page;
  try{
   page=await smoke.context.newPage();const fatal=smoke.watch(page);
   await page.goto(`${smoke.origin}/tests/browser/world-stability-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>window.__WORLD_STABILITY__?.ready,null,{timeout:TIMEOUT_MS}),fatal]);
   for(const accounts of [['fixture-B'],['fixture-B','fixture-A'],[null]])for(const failure of [false,true]){
    await page.evaluate(()=>window.__WORLD_STABILITY__.prepareShop());await page.locator('.shop-offer-buy').click();
    await page.evaluate(()=>window.__WORLD_STABILITY__.beginReadback());await page.evaluate(a=>window.__WORLD_STABILITY__.switchShop(a),accounts);
    const result=await page.evaluate(f=>window.__WORLD_STABILITY__.finishReadback(f),failure);assert.equal(result.outcome,'STALE');assert.equal(result.writes,1);report.cases.push({viewport:name,type:'real-shop-panel-readback',accounts,failure,...result});
   }
   report.cases.push({viewport:name,type:'loadout-readback',results:await page.evaluate(()=>window.__WORLD_STABILITY__.loadoutBoundaries())});
   report.cases.push({viewport:name,type:'stale-key',result:await page.evaluate(()=>window.__WORLD_STABILITY__.staleKey())});
   report.cases.push({viewport:name,type:'daily-ordering',result:await page.evaluate(()=>window.__WORLD_STABILITY__.dailyOrdering())});
   await page.evaluate(()=>window.__WORLD_STABILITY__.prepareShop());
   const cdp=await smoke.context.newCDPSession(page),box=await page.locator('#joystick').boundingBox();assert.ok(box);
   const first={id:11,x:Math.round(box.x+box.width*.82),y:Math.round(box.y+box.height*.5)},second={id:22,x:Math.round(box.x+box.width*.18),y:first.y};
   const touch=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
   const state=()=>page.evaluate(()=>window.__WORLD_STABILITY__.touchState());
   const active=async()=>{await page.waitForFunction(()=>window.__WORLD_STABILITY__.touchState().vector.x>.8,null,{timeout:5000});};
   const stopped=async()=>{await page.waitForFunction(()=>{const v=window.__WORLD_STABILITY__.touchState().vector;return v.x===0&&v.y===0;},null,{timeout:5000});};
   await touch('touchStart',[first]);await active();
   const before=await state();const owner=before.events.findLast(e=>e.type==='pointerdown');assert.ok(owner?.trusted&&owner.pointerType==='touch','native trusted touch required');
   await touch('touchMove',[first,second]);const both=await state(),foreign=both.events.findLast(e=>e.type==='pointerdown');assert.notEqual(foreign.id,owner.id,'a real second pointer is required');assert.ok(both.vector.x>.8,'second native finger cannot take ownership');
   // Current synthetic-pointer CDP contracts shrink the active list. Legacy Chromium
   // CreateWebTouchEvents instead releases the points explicitly named in touchEnd.
   // Detect the native event, never treat an unchanged vector as proof of release.
   await touch('touchMove',[first]);let releaseProtocol='active-point-list';
   if(!(await state()).events.some(e=>e.type==='pointerup'&&e.id===foreign.id)){
    await touch('touchEnd',[second]);releaseProtocol='legacy-explicit-ended-point';
   }
   const released=await state();assert.ok(released.events.some(e=>e.type==='pointerup'&&e.id===foreign.id&&e.trusted),'foreign native pointerup required');assert.ok(released.vector.x>.8,'foreign native release cannot stop owner');
   await touch('touchMove',[{...first,x:first.x-2}]);assert.ok((await state()).events.some(e=>e.type==='gotpointercapture'&&e.id===owner.id&&e.trusted),'actual owner capture required');
   await shot(page,`${name}-native-pointer-owner`);
   await page.evaluate(id=>window.__WORLD_STABILITY__.releaseCapture(id),owner.id);await touch('touchMove',[{...first,x:first.x-3}]);await stopped();
   assert.ok((await state()).events.some(e=>e.type==='lostpointercapture'&&e.id===owner.id&&e.trusted),'native owner capture loss required');await touch('touchEnd',[]);
   report.cases.push({viewport:name,type:'native-release-protocol',releaseProtocol,ownerId:owner.id,foreignId:foreign.id});
   await touch('touchStart',[first]);await active();await page.evaluate(()=>window.__WORLD_STABILITY__.block(false));await stopped();await page.evaluate(()=>window.__WORLD_STABILITY__.block(true));await touch('touchMove',[{...first,x:first.x-4}]);await stopped();await touch('touchEnd',[]);
   for(const type of ['blur','pagehide']){await touch('touchStart',[first]);await active();await page.evaluate(t=>window.__WORLD_STABILITY__.lifecycle(t),type);await stopped();await touch('touchMove',[{...first,x:first.x-4}]);await stopped();await touch('touchEnd',[]);}
   await touch('touchStart',[first]);await active();await touch('touchEnd',[]);await stopped();
   report.cases.push({viewport:name,type:'native-fresh-gesture-recovery',movementRestored:true,endedAtZero:true});
   await page.evaluate(()=>window.__WORLD_STABILITY__.receipt('PASS · 실제 touch 포인터 소유권 / capture·lostcapture\n입력 차단·합성 blur/pagehide 이후 이동 0\n합성 계정 구매·일일 상태 회귀 통과'));
   const final=await state();report.cases.push({viewport:name,type:'native-touch',events:final.events,lifecycleCoverage:'blur/pagehide deliberately dispatched DOM events; no claim of OS-level focus/BFCache coverage',vector:final.vector});await shot(page,`${name}-stability-passed`);
   assert.deepEqual(smoke.problems,[]);await cdp.detach();
  }catch(error){if(page){report.failureTouch=await page.evaluate(()=>window.__WORLD_STABILITY__?.touchState()).catch(()=>null);await shot(page,`${name}-failure`).catch(()=>{});}throw error;}finally{await smoke.close();}
 }
 report.status='PASS';console.log(JSON.stringify(report,null,2));
}catch(error){report.status='FAIL';report.error=error.stack||String(error);throw error;}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');}
