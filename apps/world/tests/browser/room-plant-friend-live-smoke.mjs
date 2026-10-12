// Real PostgreSQL #353 lease admission + plant mutations, real UI/renderer, two browser contexts.
// Realtime websocket subscription is a deterministic double: no chat delivery is claimed here.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {createFriendPlantBrowserDatabase} from '../../../../supabase/tests/support/room-plant-friend-browser-db.mjs';
const output=process.env.ROOM_PLANT_LIVE_OUTPUT??'test-results/room-plant-live';await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(process.env.EXPECTED_PLANT_HEAD)assert.equal(head,process.env.EXPECTED_PLANT_HEAD);
const report={head,authority:'actual local PostgreSQL RPCs and actual #353 lease helper; client Realtime subscription doubled, not delivery proof',checks:[]};
const db=createFriendPlantBrowserDatabase(),smokes=[],pages=[];
async function boot(visitor){const smoke=await startSmoke({viewport:{width:390,height:844},contextOptions:{isMobile:true,hasTouch:true},sharedBrowser:smokes[0]?.context.browser()});smokes.push(smoke);const p=await smoke.context.newPage();pages.push(p);smoke.watch(p);await p.exposeFunction('__plantRpc',(a,n,q)=>db.rpc(a,n,q));await p.goto(`${smoke.origin}/tests/browser/room-plant-harness.html${visitor?'?visitor=1':''}`);await p.waitForFunction(()=>window.plantFixture?.ready||window.plantFixture?.error,null,{timeout:TIMEOUT_MS});assert.equal(await p.evaluate(()=>window.plantFixture.error??null),null);return p;}
async function ready(p){await p.evaluate(()=>window.plantFixture.refresh());await p.waitForFunction(()=>window.plantFixture.feature.client.state().ready,null,{timeout:TIMEOUT_MS});}
try{
 const owner=await boot(false),panel=owner.locator('#room-plant-panel');await owner.locator('#plant-open').click();await panel.getByRole('button',{name:'첫 화분 받기 · 무료'}).click();await panel.getByRole('button',{name:'꾸미기에서 배치'}).click();
 const editor=owner.locator('#furniture-editor');await editor.getByRole('button',{name:'작은 꽃 재배 화분 (0/1) +',exact:true}).click();await owner.evaluate(()=>{const q=window.plantFixture;q.furniture.edit(q.furniture.state().objects.map(o=>({...o,x:-6,z:0,yaw:0})));});await editor.getByRole('button',{name:'저장',exact:true}).click();await editor.getByText('저장했어요. 다음에 들어와도 그대로예요.').waitFor();await editor.getByRole('button',{name:'완료',exact:true}).click();await ready(owner);
 await owner.locator('#plant-open').click();await panel.getByRole('button',{name:'꽃 심기',exact:true}).click();await panel.getByRole('button',{name:'물주기',exact:true}).waitFor();
 await panel.getByRole('button',{name:'닫기',exact:true}).click();
 const friend=await boot(true),vp=friend.locator('#room-plant-panel');await ready(friend);await friend.waitForFunction(()=>window.plantFixture.feature.client.state().visitorCareAvailable,null,{timeout:TIMEOUT_MS});assert.equal(db.evidence().chatMessages,0,'entry issued lease without sending any chat');
 await friend.locator('#plant-open').click();await vp.getByRole('button',{name:'친구 꽃 물주기',exact:true}).click();await vp.getByText('지금은 자라는 중이에요. 서두르지 않아도 괜찮아요.').waitFor();assert.equal(db.evidence().revision,2);await friend.screenshot({path:path.join(output,'real-friend-first-care-portrait.png')});
 report.checks.push('two isolated contexts, actual chat join+renew SQL, first friend CARE, no message required');
 db.readySecondCare();await vp.getByRole('button',{name:'닫기',exact:true}).click();await ready(friend);await friend.locator('#plant-open').click();await vp.getByRole('button',{name:'친구 꽃 물주기',exact:true}).waitFor();
 const frozen=await friend.evaluate(()=>{const q=window.plantFixture,p=q.feature.client.state().snapshot.plants[0];return{token:p.careToken,object:p.objectId,lease:q.chat.personalVisitLease(q.furniture.state().roomId)};});
 await friend.evaluate(()=>window.plantFixture.leaveChat());await friend.waitForFunction(()=>!window.plantFixture.feature.client.state().visitorCareAvailable);assert.equal(await friend.evaluate(()=>window.plantFixture.feature.client.care(window.plantFixture.furniture.state().objects[0].id)),false);
 const ids=await friend.evaluate(()=>window.plantFixture.ids);const denied=await db.rpc(ids.b,'care_visited_room_plant_v1',{p_room:ids.roomA,p_object:frozen.object,p_care_token:frozen.token,p_request_id:crypto.randomUUID(),p_visit_session:frozen.lease.sessionId,p_visit_lease:frozen.lease.leaseId});assert.equal(denied.error.message,'PLANT_ACCESS_DENIED');assert.equal(db.evidence().revision,2);
 await ready(friend);await friend.waitForFunction(()=>window.plantFixture.feature.client.state().visitorCareAvailable);db.block();await friend.locator('#plant-open').click();await vp.getByRole('button',{name:'친구 꽃 물주기',exact:true}).click();await vp.getByText('지금은 이 방의 화분을 확인할 수 없어요.').waitFor();assert.equal(db.evidence().revision,2);
 db.disableChat();await ready(owner);await owner.locator('#plant-open').click();await panel.getByRole('button',{name:'물주기',exact:true}).click();await panel.getByText('다음 변화까지 약 20시간. 서두르지 않아도 괜찮아요.').waitFor();
 report.db=db.evidence();assert.equal(report.db.revision,3);assert.equal(report.db.receipts,3);assert.equal(report.db.money,0);assert.equal(report.db.xp,0);assert.equal(report.db.lifeXp,0);assert.equal(report.db.chatMessages,0);
 report.checks.push('leave revokes exact lease before CARE; committed block rejects current lease; owner care stays independent of disabled chat; money/XP/message counters unchanged');
 await owner.screenshot({path:path.join(output,'real-owner-second-care-chat-disabled.png')});for(const s of smokes)assert.deepEqual(s.problems,[]);report.result='PASS';console.log('PASS: actual SQL lease + two-browser friend CARE integration, leave/block denial and independent owner CARE.');
}catch(e){report.result='FAIL';report.error=String(e.stack??e);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(output,`failure-${i}.png`)}).catch(()=>{});throw e;}
finally{report.calls=db.calls;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));for(const s of smokes)await s.close();db.close();}
