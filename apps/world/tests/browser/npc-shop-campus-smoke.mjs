// Real offline /campus/ scene and NPC runtime; no synthetic login and no purchase.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {configureStudentCampusFixture,captureStudentPixels} from './student-center-campus-smoke.mjs';
const output=process.env.NPC_SHOP_CAMPUS_OUTPUT||'test-results/npc-shop-campus';
await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),result:'running',scope:'Actual campus and NPC runtime, offline signed-out context actions; fixture initial player placements, no walking or authenticated purchase claim',vendors:[]};
let smoke,page;
try{
 if(process.env.NPC_SHOP_HEAD_SHA)assert.equal(report.head,process.env.NPC_SHOP_HEAD_SHA);
 smoke=await startSmoke();
 for(const index of [0,1]){
  page=await smoke.context.newPage();const fatal=smoke.watch(page);
  const evaluate=(fn,arg)=>Promise.race([page.evaluate(fn,arg),fatal]);
  await page.goto(`${smoke.origin}/campus/?campusLife=roster&envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
  await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished&&s.npcTest?.status==='READY';},null,{timeout:TIMEOUT_MS}),fatal]);
  assert.equal(await evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer),'WebGL2');
  await Promise.race([page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS}),fatal]);
  const vendor=await evaluate(async index=>{
   const [{STUDENT_CENTER_VENDORS},{WALK_SHAPE},{studentConnectedFrame},{createStudentConnectedWalk}]=await Promise.all([import('/src/shop/student-center-vendors.js'),import('/src/player-dimensions.js'),import('/src/student-center-frame.js'),import('/src/student-center-connected.js')]);
   const v=STUDENT_CENTER_VENDORS[index],d=window.__INHAGAME_P0__;
   const matches=[];const visit=e=>{if(e.name===`NPC_TEST_HUMAN_${v.npcId}`)matches.push(e);e.children.forEach(visit);};visit(d.app.root);
   if(matches.length!==1)throw Error(`Expected one existing avatar for ${v.npcId}, got ${matches.length}`);
   const avatar=matches[0],p=avatar.getLocalPosition();
   if(!avatar.enabled||Math.hypot(p.x-v.position.x,p.z-v.position.z)>.001||Math.abs(p.y-v.position.y)>.05)throw Error('Vendor placement mismatch');
   if(!avatar.findComponents('render').some(r=>r.meshInstances.length))throw Error('Vendor has no render meshes');
   // Explicit initial placement near the shelf; production update and context arbitration stay live.
   const approach=studentConnectedFrame().toWorld([v.local[0],v.local[1],-.7]);
   const clearance=createStudentConnectedWalk({space:'world'}).inspect(approach[0],approach[2],approach[1]);
   if(!clearance.clear||!clearance.supported)throw Error('Vendor approach lacks actual body clearance/support');
   d.player.setLocalPosition(approach[0],approach[1]+WALK_SHAPE.footOffset,approach[2]);
   d.controller.velocityY=0;d.controller.grounded=true;
   return {...v,approach,clearance,actualAvatar:{name:avatar.name,position:[p.x,p.y,p.z],renderComponents:avatar.findComponents('render').length}};
  },index);
  await page.waitForTimeout(400);
  const action=await evaluate(()=>{const d=window.__INHAGAME_P0__,a=d.contextActions.active;return{id:a?.id??null,label:a?.label??null,panelOpen:d.shopPanel.open};});
  assert.notEqual(action.id,`npc-shop-${vendor.npcId}`,'unnegotiated signed-out session cannot expose a split purchase entry');
  assert.equal(action.panelOpen,false);

  await page.keyboard.press('f');assert.equal(await evaluate(()=>window.__INHAGAME_P0__.shopPanel.open),false);
  // Reuse established full-campus ownership checks, then freeze unrelated callbacks for a stable frame.
  const ownership=await evaluate(configureStudentCampusFixture);
  await evaluate(v=>{const q=window.__studentCampusQA,c=q.camera;const eye=q.frame.toWorld([v.local[0]+2.8,3.1,v.local[2]+5.6]),target=q.frame.toWorld([v.local[0],2,v.local[2]]);c.setPosition(eye[0],eye[1],-eye[2]);c.lookAt(target[0],target[1],-target[2]);q.d.app.renderNextFrame=true;},vendor);
  await evaluate(id=>{window.__INHAGAME_P0__.app.root.findByName(`NPC_TEST_HUMAN_${id}`).enabled=false;},vendor.npcId);
  const control=await evaluate(captureStudentPixels,{});
  await evaluate(id=>{window.__INHAGAME_P0__.app.root.findByName(`NPC_TEST_HUMAN_${id}`).enabled=true;},vendor.npcId);
  const pixels=await evaluate(captureStudentPixels,{compare:true});
  assert.equal(pixels.glError,0);assert.equal(pixels.contextLost,false);assert.ok(pixels.quantizedColors>8&&pixels.luminanceStddev>2,'Nonblank campus frame');
  assert.ok(pixels.changed>30,'Actual vendor must visibly change the campus frame');
  await page.screenshot({path:`${output}/${vendor.npcId}.png`});
  report.vendors.push({vendor,action,ownership,control,pixels,screenshot:`${vendor.npcId}.png`});await page.close();page=null;
 }
 report.problems=smoke.problems;assert.deepEqual(smoke.problems,[]);assert.equal(report.vendors.length,2);report.result='pass';console.log('PASS: both actual campus vendor entities and signed-out HUD gates');
}catch(error){report.result='fail';report.error=error.stack;await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await smoke?.close();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');}
