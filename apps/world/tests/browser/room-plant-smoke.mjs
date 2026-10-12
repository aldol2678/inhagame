// Exact-head real WebGL2 room/editor/client QA, two isolated browser contexts, synthetic server RPCs.
// The companion full Supabase job validates real SQL; this fixture never reaches a live account/server.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {createPlantBackend,IDS,HOURS20} from './room-plant-backend.mjs';
const output=process.env.ROOM_PLANT_QA_OUTPUT??'test-results/room-plant';await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(process.env.EXPECTED_PLANT_HEAD)assert.equal(head,process.env.EXPECTED_PLANT_HEAD);
const sha=b=>createHash('sha256').update(b).digest('hex'),backend=createPlantBackend(),report={head,authority:'synthetic server clock; SQL tested by full Supabase CI',renderer:'actual personal-room scene, assets and PlayCanvas WebGL2',screenshots:[],checks:[],sources:{}};
for(const file of ['apps/world/src/rooms/room-plant-client.js','apps/world/src/rooms/room-plant-feature.js','apps/world/src/rooms/room-plant-panel.js','apps/world/src/rooms/room-plant-visual.js','apps/world/src/rooms/furniture-renderer.js','apps/world/src/rooms/personal-room-renderer.js','apps/world/tests/browser/room-plant-smoke.mjs','apps/world/tests/browser/room-plant-fixture.mjs','apps/world/tests/browser/room-plant-backend.mjs','supabase/migrations/20261012024000_world_room_plant_candidate.sql','supabase/migrations/20261012052000_world_room_plant_friend_care.sql','apps/world/src/rooms/room-chat.js'])report.sources[file]=sha(await readFile(file));
const smokes=[],pages=[];
const state=p=>p.evaluate(()=>window.plantFixture.snapshot());
async function wait(p,fn,arg){await p.waitForFunction(fn,arg,{timeout:TIMEOUT_MS});}
async function settle(p){const n=await p.evaluate(()=>window.plantFixture.frames);await wait(p,n=>window.plantFixture.frames>n+4,n);}
async function refresh(p){await p.evaluate(()=>window.plantFixture.refresh());await wait(p,()=>window.plantFixture.feature.client.state().ready);await settle(p);}
async function boot(visitor){const smoke=await startSmoke({viewport:{width:1280,height:800}});smokes.push(smoke);const p=await smoke.context.newPage();pages.push(p);const fatal=smoke.watch(p);await p.exposeFunction('__plantRpc',(actor,name,args)=>backend.rpc(actor,name,args));await p.goto(`${smoke.origin}/tests/browser/room-plant-harness.html${visitor?'?visitor=1':''}`,{waitUntil:'domcontentloaded'});await Promise.race([fatal,wait(p,()=>window.plantFixture?.ready||window.plantFixture?.error)]);assert.equal((await state(p)).error,null);return p;}
const viewports=[{name:'desktop',width:1280,height:800},{name:'portrait',width:390,height:844},{name:'landscape',width:844,height:390}];
async function pictures(p,stage){
 await p.evaluate(()=>window.plantFixture.feature.panel.close());
 for(const viewport of viewports){
  await p.setViewportSize({width:viewport.width,height:viewport.height});await settle(p);const before=await state(p);
  assert.equal(before.device,'webgl2');assert.equal(before.rootEnabled,true);assert.equal(before.hasRoomShell,true);assert.equal(before.meshEnabled,true);assert.equal(before.visuals[0]?.stage,stage);assert.equal(before.meshCount,{SPROUT:5,BUD:6,BLOOM:14}[stage]);
  const name=`${stage.toLowerCase()}-${viewport.name}.png`,bytes=await p.screenshot({path:path.join(output,name)});
  // An unchanged scene with only the actual saved planter hidden must have different pixels.
  await p.evaluate(()=>{const q=window.plantFixture,o=q.furniture.state().objects[0];q.scene.root.findByName(`placed_${o.id}`).enabled=false;});await settle(p);
  const hidden=await p.screenshot();
  await p.evaluate(()=>{const q=window.plantFixture,o=q.furniture.state().objects[0];q.scene.root.findByName(`placed_${o.id}`).enabled=true;});await settle(p);
  assert.notEqual(sha(bytes),sha(hidden),`${stage}/${viewport.name}: planter contributes actual pixels`);
  const after=await state(p);assert.equal(after.meshEnabled,true);assert.equal(after.visuals[0].stage,stage);
  report.screenshots.push({file:name,sha256:sha(bytes),hiddenComparisonSha256:sha(hidden),viewport,before,after});
 }
 report.checks.push(`visible ${stage} pixels in desktop, portrait, landscape`);
}
async function saveAndClose(p){const editor=p.locator('#furniture-editor');await editor.getByRole('button',{name:'저장',exact:true}).click();await editor.getByText('저장했어요. 다음에 들어와도 그대로예요.').waitFor();await editor.getByRole('button',{name:'완료',exact:true}).click();await refresh(p);}
try{
 const owner=await boot(false),panel=owner.locator('#room-plant-panel');
 await owner.locator('#plant-open').click();await panel.getByRole('button',{name:'첫 화분 받기 · 무료'}).click();
 await panel.getByRole('button',{name:'꾸미기에서 배치'}).click();
 const editor=owner.locator('#furniture-editor');await editor.getByRole('button',{name:'작은 꽃 재배 화분 (0/1) +',exact:true}).click();
 // Use the production editor/client draft then its actual Save button. Server sees only saved six-field objects.
 await owner.evaluate(()=>{const q=window.plantFixture;q.furniture.edit(q.furniture.state().objects.map(o=>({...o,x:-6,z:0,yaw:0})));});
 const draft=(await state(owner)).room.objects[0];
 assert.equal((await backend.rpc(IDS.a,'plant_my_room_plant_v1',{p_room:IDS.roomA,p_object:draft.id,p_request_id:randomUUID()})).error.message,'PLANTER_REQUIRED');
 await saveAndClose(owner);assert.deepEqual(Object.keys(backend.snapshot().rooms[0][1].objects[0]).sort(),['id','itemId','surface','x','yaw','z']);
 await owner.locator('#plant-open').click();await panel.getByRole('button',{name:'꽃 심기',exact:true}).click();await panel.getByRole('button',{name:'물주기',exact:true}).waitFor();await pictures(owner,'SPROUT');
 await owner.locator('#plant-open').click();backend.loseNextCare();await panel.getByRole('button',{name:'물주기',exact:true}).click();await panel.getByRole('button',{name:'같은 요청 다시 확인'}).click();await panel.getByText('다음 변화까지 약 20시간. 서두르지 않아도 괜찮아요.').waitFor();
 assert.equal(backend.snapshot().receipts.length,2);report.checks.push('saved-object gate, real editor save, once claim, lost-care same-request replay');
 // Browser wall-clock tampering cannot advance the independent server clock or unlock care.
 await owner.evaluate(()=>{const D=Date;globalThis.Date=class extends D{constructor(...args){super(...(args.length?args:['2050-01-01T00:00:00Z']));}static now(){return D.parse('2050-01-01T00:00:00Z');}};});
 await refresh(owner);assert.equal((await state(owner)).plant.snapshot.plant.canCare,false);
 backend.advance(HOURS20-1);await refresh(owner);assert.equal((await state(owner)).visuals[0].stage,'SPROUT');assert.equal((await state(owner)).plant.snapshot.plant.canCare,false);
 backend.advance(1);await refresh(owner);assert.equal((await state(owner)).plant.snapshot.plant.canCare,true);await pictures(owner,'BUD');
 const visitor=await boot(true),vp=visitor.locator('#room-plant-panel');await refresh(visitor);
 await wait(visitor,()=>window.plantFixture.feature.client.state().visitorCareAvailable);
 for(const view of viewports){await visitor.setViewportSize({width:view.width,height:view.height});await visitor.locator('#plant-open').click();await vp.getByRole('button',{name:'친구 꽃 물주기',exact:true}).waitFor();await visitor.screenshot({path:path.join(output,`friend-care-${view.name}.png`)});await visitor.keyboard.press('Escape');}
 await visitor.locator('#plant-open').click();backend.loseNextCare();await vp.getByRole('button',{name:'친구 꽃 물주기',exact:true}).click();await vp.getByRole('button',{name:'같은 요청 다시 확인'}).click();await vp.getByText('지금은 자라는 중이에요. 서두르지 않아도 괜찮아요.').waitFor();await refresh(owner);assert.equal((await state(owner)).plant.snapshot.plant.revision,3);
 report.checks.push('actual RoomChat enter issues visitor lease without message; friend waters with lost-response replay and no owner fields');
 backend.advance(HOURS20-1);await refresh(owner);assert.equal((await state(owner)).visuals[0].stage,'BUD');backend.advance(1);await refresh(owner);await pictures(owner,'BLOOM');
 assert.equal(backend.snapshot().receipts.length,3);report.checks.push('20h minus 1ms / exact boundary twice, client clock ignored, three bounded receipts');
 for(const viewport of viewports){await owner.setViewportSize({width:viewport.width,height:viewport.height});await owner.locator('#plant-open').click();const box=await panel.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);const heights=await panel.locator('button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().height));assert.ok(heights.every(h=>h>=44));await owner.screenshot({path:path.join(output,`panel-${viewport.name}.png`)});await owner.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);assert.equal(await owner.locator('#plant-open').evaluate(e=>document.activeElement===e),true);}
 await refresh(visitor);await refresh(visitor);assert.equal((await state(visitor)).visuals[0].stage,'BLOOM');assert.deepEqual(Object.keys((await state(visitor)).plant.snapshot).sort(),['featureStatus','layoutRevision','plants','role','roomId']);await visitor.locator('#plant-open').click();await vp.getByText('물주기가 필요할 때 친구의 꽃을 함께 돌볼 수 있어요. 보상 없이 꽃이 자라는 걸 도와줘요.').waitFor();assert.equal(await vp.getByRole('button').count(),1);assert.equal(await visitor.evaluate(()=>window.plantFixture.feature.client.care(window.plantFixture.furniture.state().objects[0].id)),false);await visitor.keyboard.press('Escape');await visitor.screenshot({path:path.join(output,'visitor-bloom.png')});
 // Recall/save/reload/re-add through the existing editor. New object id, same permanent bloom.
 await owner.locator('#editor-open').click();await editor.locator('select[data-focus="selection"]').selectOption(draft.id);await editor.getByRole('button',{name:'회수',exact:true}).click();await saveAndClose(owner);assert.equal((await state(owner)).visuals.length,0);assert.equal((await state(owner)).plant.snapshot.plant.stage,'BLOOM');await refresh(visitor);assert.equal((await state(visitor)).visuals.length,0);
 await owner.locator('#editor-open').click();await editor.getByRole('button',{name:'작은 꽃 재배 화분 (0/1) +',exact:true}).click();await owner.evaluate(()=>{const q=window.plantFixture;q.furniture.edit(q.furniture.state().objects.map(o=>({...o,x:-6,z:0,yaw:0})));});await saveAndClose(owner);assert.notEqual((await state(owner)).room.objects[0].id,draft.id);assert.equal((await state(owner)).visuals[0].stage,'BLOOM');await refresh(visitor);assert.equal((await state(visitor)).visuals[0].stage,'BLOOM');report.checks.push('two isolated contexts/actors, visitor private-field projection and owner-only write denial, saved recall/re-add keeps bloom');
 // Close and Back do not reopen when a delayed response completes.
 await owner.locator('#plant-open').click();await wait(owner,()=>!window.plantFixture.feature.client.state().reading);backend.holdNextRead();await owner.evaluate(()=>{void window.plantFixture.feature.client.refresh();});assert.equal(backend.snapshot().held,1);await panel.getByRole('button',{name:'닫기',exact:true}).click();backend.release();await settle(owner);assert.equal(await panel.isVisible(),false);
 await owner.evaluate(()=>history.pushState({plant:true},'',location.href));await owner.locator('#plant-open').click();await owner.goBack();assert.equal(await panel.isVisible(),false);
 // One held A response crosses A->B->A. Only a new generation's fresh read may restore the plant.
 await refresh(owner);backend.holdNextRead();await owner.evaluate(()=>{void window.plantFixture.feature.client.refresh();});assert.equal(backend.snapshot().held,1);await owner.evaluate(()=>window.plantFixture.switchAccount(window.plantFixture.ids.b));assert.equal((await state(owner)).plant.snapshot.plant,null);await owner.evaluate(()=>window.plantFixture.switchAccount(window.plantFixture.ids.a));const generation=(await state(owner)).plant.generation;backend.release();await settle(owner);assert.equal((await state(owner)).plant.generation,generation);assert.equal((await state(owner)).visuals[0].stage,'BLOOM');
 backend.denyVisitor();await visitor.evaluate(()=>window.plantFixture.feature.client.refresh());assert.equal((await state(visitor)).visuals.length,0);await visitor.evaluate(()=>window.plantFixture.loseAccess());assert.equal((await state(visitor)).panelOpen,false);
 backend.revoke(IDS.a);await owner.evaluate(()=>window.plantFixture.inventory.refresh());assert.equal((await state(owner)).visuals.length,0);report.checks.push('Escape/focus, Close with late reply, Back, account ABA, visitor access loss, ownership revoke');
 for(const smoke of smokes)assert.deepEqual(smoke.problems,[]);report.backend=backend.snapshot();report.result='PASS';
 console.log('PASS: actual visible room/planter WebGL2 pixels across 3 stages x 3 viewports; two-context authority fixture, real editor saves, server-clock boundaries, recall/re-add, close/ABA/revocation. Full SQL authority is a separate required CI gate.');
}catch(error){report.result='FAIL';report.error=String(error.stack??error);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(output,`failure-${i}.png`)}).catch(()=>{});throw error;
}finally{report.backend??=backend.snapshot();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));for(const smoke of smokes)await smoke.close();}
