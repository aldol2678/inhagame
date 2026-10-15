// Real campus app plus the real optional preview app, on loopback with all remote services blocked.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {observeWorldTimeRequests} from './world-time-request-evidence.mjs';
const output=process.env.FURNITURE_SHOWROOM_OUTPUT||'test-results/furniture-showroom/world';
await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAtUtc:new Date().toISOString(),result:'running',cycles:[],scope:'real offline campus + showroom; no purchases/accounts; no performance acceptance'};
if(process.env.FURNITURE_SHOWROOM_HEAD_SHA)assert.equal(report.head,process.env.FURNITURE_SHOWROOM_HEAD_SHA);
report.hashes=Object.fromEntries(await Promise.all(['src/main.js','src/campus-render-kit.js','src/rooms/furniture-renderer.js','src/shop/furniture-shop-preview.js'].map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
let smoke,page;
let phase='startup';
const worldTimeFailures=[];
try{
 smoke=await startSmoke({viewport:{width:1000,height:650}});
 await smoke.context.addInitScript(observeWorldTimeRequests,{origin:smoke.origin});
 page=await smoke.context.newPage();const fatal=smoke.watch(page);
 page.on('requestfailed',request=>{
  if(request.url()===smoke.origin+'/api/world-time')worldTimeFailures.push({phase,atUtc:new Date().toISOString(),
   error:request.failure()?.errorText,timing:request.timing()});
 });
 await page.goto(`${smoke.origin}/campus/`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:TIMEOUT_MS}),fatal]);
 report.worldRenderer=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer);assert.equal(report.worldRenderer,'WebGL2');
 await page.evaluate(()=>{window.__QA_MAIN_RENDERS__=0;window.__INHAGAME_P0__.app.on('postrender',()=>window.__QA_MAIN_RENDERS__++);});
 for(let cycle=0;cycle<3;cycle++){
  phase=`preview-cycle-${cycle}`;
  const start=await page.evaluate(async()=>{
   const pc=await import('playcanvas');const {createFurnitureShopPreview}=await import('/src/shop/furniture-shop-preview.js');
   const main=window.__INHAGAME_P0__.app;
   const canvas=document.createElement('canvas');canvas.id='qa-showroom-coexist';canvas.style='position:fixed;right:10px;top:10px;width:256px;height:192px;z-index:9999';document.body.append(canvas);
   const preview=await createFurnitureShopPreview(canvas);window.__QA_PREVIEW__={preview,canvas};
   const capture=await preview.capture('furniture.dorm_single_sofa');
   const previewApp=pc.Application.getApplication(canvas.id);
   const renderComponents=previewApp.root.findComponents('render');
   return {frame:window.__QA_MAIN_RENDERS__,capture:{mode:capture?.mode,status:capture?.status,imageBytes:capture?.image?.length},
    ownedByPreview:renderComponents.every(r=>r.system.app===previewApp&&r.meshInstances.every(m=>m.mesh.device===previewApp.graphicsDevice)),
    ownDevice:main.graphicsDevice!==previewApp.graphicsDevice,componentCount:renderComponents.length};
  });
  assert.equal(start.capture.mode,'GLB');assert.ok(start.capture.imageBytes>1000);assert.ok(start.ownedByPreview&&start.ownDevice&&start.componentCount>0);
  await page.waitForFunction(n=>window.__QA_MAIN_RENDERS__>n+2,start.frame,{timeout:30000});
  await page.screenshot({path:`${output}/campus-with-preview-${cycle}.png`});
  const disposed=await page.evaluate(async()=>{
   const {preview,canvas}=window.__QA_PREVIEW__;preview.dispose();canvas.remove();await Promise.resolve();
   const status=preview.visualStatus();delete window.__QA_PREVIEW__;
   return {status,mainFrame:window.__QA_MAIN_RENDERS__,canvasCount:document.querySelectorAll('canvas').length};
  });
  assert.ok(disposed.status.destroyed);assert.deepEqual(disposed.status.resources,[]);assert.equal(disposed.canvasCount,1);
  await page.waitForFunction(n=>window.__QA_MAIN_RENDERS__>n+2,disposed.mainFrame,{timeout:30000});
  report.cycles.push({start,disposed});
 }

 // Build a previously unbuilt public room using native input after preview disposal.
 phase='post-preview-public-lobby';
 // This exercises generic renderer consumers, not only the existing campus frame loop.
 const lobbyBefore=await page.evaluate(()=>window.__INHAGAME_JEONGSEOK_INTERIOR__.status());
 assert.equal(lobbyBefore.policy.mode,'SERVER_GRANT_JSL_A');
 assert.deepEqual(lobbyBefore.scenes.built,[],'the post-preview room must not already be built');
 await page.evaluate(async()=>{
  const d=window.__INHAGAME_P0__;
  const {JEONGSEOK_ENTRANCE}=await import('/src/jeongseok/interior-rooms.js');
  const p=JEONGSEOK_ENTRANCE.position;
  d.controller.velocityY=0;d.player.setLocalPosition(p.x,2.8,p.z);d.player.setLocalEulerAngles(0,0,0);d.orbit.yaw=0;
 });
 await Promise.race([page.waitForFunction(()=>{
  const d=window.__INHAGAME_P0__,a=d.contextActions.active;
  return a?.id==='jeongseok-door'&&/공개 로비/.test(a.label??'')&&d.controller.grounded;
 },null,{timeout:45000}),fatal]);
 await page.keyboard.press('KeyF');
 await Promise.race([page.waitForFunction(()=>{
  const d=window.__INHAGAME_P0__;
  return d.rooms.currentSpace==='ROOM_JEONGSEOK_LOBBY'&&!d.rooms.status().busy&&d.controller.inputEnabled;
 },null,{timeout:45000}),fatal]);
 const lobbyAfter=await page.evaluate(()=>{
  const d=window.__INHAGAME_P0__,s=window.__INHAGAME_JEONGSEOK_INTERIOR__.status();
  const root=d.app.root.findByName('Room_ROOM_JEONGSEOK_LOBBY');
  const renders=root?.findComponents('render')??[];
  return {space:d.rooms.currentSpace,built:s.scenes.built,policy:s.policy,input:d.controller.inputEnabled,
   rootOwnedByMain:root?._app===d.app,renderCount:renders.length,
   componentsOwnedByMain:renders.every(r=>r.system.app===d.app),
   meshesOwnedByMain:renders.every(r=>r.meshInstances.every(mi=>mi.mesh.device===d.app.graphicsDevice)),
   mainFrame:window.__QA_MAIN_RENDERS__,canvasCount:document.querySelectorAll('canvas').length};
 });
 assert.ok(lobbyAfter.built.includes('ROOM_JEONGSEOK_LOBBY'));
 assert.ok(lobbyAfter.rootOwnedByMain&&lobbyAfter.renderCount>0&&lobbyAfter.componentsOwnedByMain&&lobbyAfter.meshesOwnedByMain);
 assert.equal(lobbyAfter.policy.accountBound,false);assert.equal(lobbyAfter.policy.session,false);
 assert.equal(lobbyAfter.canvasCount,1);assert.equal(lobbyAfter.input,true);
 await page.waitForFunction(n=>window.__QA_MAIN_RENDERS__>n+2,lobbyAfter.mainFrame,{timeout:30000});
 report.postPreviewPublicLobby={before:lobbyBefore,after:lobbyAfter};
 await page.screenshot({path:`${output}/public-lobby-after-preview.png`});
 phase='final-request-guard';
 assert.deepEqual(smoke.problems,[]);await page.screenshot({path:`${output}/campus-after-close.png`});report.result='pass';console.log('PASS: real campus continues rendering across 3 preview GLB open/close cycles, correct app/device ownership, one final canvas; post-preview public lobby built with native F');
}catch(e){report.result='fail';report.error=e.stack;throw e;}
finally{
 // Snapshot BEFORE teardown so genuine in-test aborts cannot be confused with page close.
 report.worldTimeDiagnostics={phase};
 if(page&&!page.isClosed()){
  try{Object.assign(report.worldTimeDiagnostics,await page.evaluate(()=>({
   requests:globalThis.__WORLD_TIME_REQUEST_EVIDENCE__?.snapshot()??null,
   clock:globalThis.__INHAGAME_WORLD_TIME__?.status()??null,
   visibility:document.visibilityState
  })));}catch(error){report.worldTimeDiagnostics.snapshotError=error.message;}
 }
 // Events can arrive while the page snapshot is awaited; copy only afterwards.
 report.worldTimeDiagnostics.failures=worldTimeFailures.slice();
 if(smoke)await smoke.close();report.finishedAtUtc=new Date().toISOString();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');
}
