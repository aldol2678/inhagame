// Browser-only test surface. Production modules; explicit synthetic accounts/RPC.
import { PlayerController } from '../../src/player-controller.js';
import { createShopClient, SHOP_READ_RPC, SHOP_PURCHASE_RPC, SHOP_STUDENT_CENTER } from '../../src/shop/shop-client.js';
import { createLoadoutClient, APPEARANCE_SLOTS, LOADOUT_READ_RPC } from '../../src/appearance/loadout-client.js';
import { createShopPanel } from '../../src/shop/shop-panel.js';
import { createDailyQuizClient, DAILY_QUIZ_RPC } from '../../src/daily-quiz/daily-quiz-client.js';
import { createAttendanceClient, ATTENDANCE_RPC } from '../../src/attendance/attendance-client.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const ok=data=>({data,error:null});
const offer={listingId:'offer.fixture.item',itemId:'memorabilia.campus_mug',currencyId:'currency.induck_coin',price:120,quantity:1,requiredLevel:null,purchaseLimit:null,startAt:null,endAt:null,status:'ACTIVE',purchasable:true,unavailableReason:null};
const shopView=()=>({shopId:SHOP_STUDENT_CENTER,status:'ACTIVE',playerLevel:1,offers:[offer]});
const slotsView=()=>({slots:Object.fromEntries(APPEARANCE_SLOTS.map(s=>[s,null]))});
function transport(){const calls=[];return{calls,rpc(fn,args){return new Promise((resolve,reject)=>calls.push({fn,args,resolve,reject}));}};}
const panel=document.getElementById('shop-panel');
const position={x:0,y:1.15,z:-98};
const controller=new PlayerController({getLocalPosition:()=>({...position}),setLocalPosition:(x,y,z)=>Object.assign(position,{x,y,z}),setLocalEulerAngles(){}});
const pad=document.getElementById('joystick'),events=[];
for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])pad.addEventListener(type,e=>events.push({type,id:e.pointerId,trusted:e.isTrusted,pointerType:e.pointerType}));
let current;
const receipt=message=>{document.getElementById('receipt').textContent=message;};
async function prepareShop(){
  panel.replaceChildren();const tx=transport(),toasts=[],callbacks=[],walletReads=[];let sequence=0;
  const client=createShopClient({getClient:()=>tx,createKey:()=>`fixture:key-${++sequence}`});
  const ui=createShopPanel({panel,shop:client,doc:document,onStatus:s=>toasts.push(s),onPurchase:r=>callbacks.push(r),wallet:{accountId:null,onChange(){},refresh:r=>walletReads.push(r)}});
  client.setAccount('fixture-A');ui.setOpen(true);tx.calls.at(-1).resolve(ok(shopView()));await flush();
  const purchase=client.purchase;let pending;client.purchase=id=>(pending=purchase(id));
  current={tx,client,ui,toasts,callbacks,walletReads,get pending(){return pending;}};receipt('합성 계정 A · 구매 클릭 후 응답 순서 검증');return true;
}
async function beginReadback(){check(current.pending,'actual buy click required');current.tx.calls.at(-1).resolve(ok({status:'SUCCESS'}));await flush();check(current.tx.calls.at(-1).fn===SHOP_READ_RPC,'post-purchase read required');current.oldRead=current.tx.calls.at(-1);return true;}
async function switchShop(accounts){for(const account of accounts){current.client.setAccount(account);if(account){const read=current.client.refresh('account');current.tx.calls.at(-1).resolve(ok(shopView()));await read;}await flush();}return true;}
async function finishReadback(failure=false){
  const c=current;c.oldRead.resolve(failure?{error:{message:'synthetic offline'}}:ok(shopView()));const result=await c.pending;await flush();
  check(result.outcome==='STALE','old purchase result escaped');check(c.ui.status().hint==='','old account hint escaped');check(!c.toasts.length&&!c.callbacks.length&&!c.walletReads.length,'old callback/toast/wallet read escaped');
  const writes=c.tx.calls.filter(x=>x.fn===SHOP_PURCHASE_RPC).length;check(writes===1,'unexpected purchase retry');receipt('PASS · 이전 계정 구매 결과 차단\n새 계정 안내·콜백·지갑 조회 0회 / 구매 RPC 1회');return{outcome:result.outcome,writes,toasts:c.toasts.length,callbacks:c.callbacks.length,walletReads:c.walletReads.length,account:c.client.accountId};
}
async function loadoutBoundaries(){
  const results=[];
  for(const action of ['equip','unequip'])for(const accounts of [['fixture-B'],['fixture-B','fixture-A'],[null]])for(const failure of [false,true]){
    const tx=transport(),c=createLoadoutClient({getClient:()=>tx,createKey:()=> 'fixture:key'});let p=c.setAccount('fixture-A');tx.calls.at(-1).resolve(ok(slotsView()));await p;
    const done=action==='equip'?c.equip('HEAD','head.inha_cap'):c.unequip('HEAD');tx.calls.at(-1).resolve(ok({status:'SUCCESS'}));await flush();const oldRead=tx.calls.at(-1);check(oldRead.fn===LOADOUT_READ_RPC,'loadout readback missing');
    for(const a of accounts){p=c.setAccount(a);if(a)tx.calls.at(-1).resolve(ok(slotsView()));await p;}
    oldRead.resolve(failure?{error:{message:'synthetic offline'}}:ok(slotsView()));check((await done).outcome==='STALE','old loadout result escaped');check(tx.calls.filter(x=>x.fn!==LOADOUT_READ_RPC).length===1,'loadout repeated write');results.push({action,accounts,failure,outcome:'STALE'});
  }return results;
}
async function staleKey(){
  const tx=transport();let sequence=0;const c=createShopClient({getClient:()=>tx,createKey:()=>`fixture:key-${++sequence}`});c.setAccount('fixture-A');const old=c.purchase(offer.listingId),oldCall=tx.calls.at(-1);c.setAccount('fixture-B');const now=c.purchase(offer.listingId),newCall=tx.calls.at(-1);oldCall.resolve(ok({status:'SUCCESS'}));check((await old).outcome==='STALE','old write not stale');newCall.reject(new Error('synthetic unknown outcome'));await now;const retry=c.purchase(offer.listingId),retryCall=tx.calls.at(-1);check(newCall.args.p_idempotency_key===retryCall.args.p_idempotency_key,'old generation retired current key');retryCall.reject(new Error('synthetic offline'));await retry;return{sameRetryKey:true,explicitWrites:3,automaticRetries:0};
}
const quizView=(active=false)=>({rewardDate:'2026-10-04',status:active?'ACTIVE':'AVAILABLE',runId:active?'11111111-2222-4333-8444-555555555555':null,progress:{answered:0,correct:0,total:3},rewardPreview:[],...(active?{question:{questionId:'fixture-q',index:0,prompt:'Synthetic question',options:['a','b','c','d']}}:{})});
const attendanceView=claimed=>({rewardDate:'2026-10-04',month:'2026-10',claimedToday:claimed,attendedDays:claimed?1:0,attendedDates:claimed?['2026-10-04']:[],dailyCoin:10,nextMilestone:{days:3,bonusCoin:30},milestones:[[3,30],[7,50],[14,100],[21,150]].map(([days,bonusCoin])=>({days,bonusCoin,claimed:false}))});
async function dailyOrdering(){
  const results=[];
  for(const type of ['quiz','attendance']){
    const tx=transport(),quiz=type==='quiz';const c=quiz?createDailyQuizClient({getClient:()=>tx}):createAttendanceClient({getClient:()=>tx});const initial=quiz?quizView():attendanceView(false);let p=c.setAccount('fixture-A');tx.calls.at(-1).resolve(ok(initial));check(await p,'initial read validation');
    const old=c.refresh('open'),oldCall=tx.calls.at(-1),write=quiz?c.start():c.claim(),writeCall=tx.calls.at(-1);const after=quiz?quizView(true):{...attendanceView(true),claimed:false,replayed:true,rewards:[]};
    const deferred=c.refresh('resume');check(tx.calls.at(-1)===writeCall,'read raced pending mutation');writeCall.resolve(ok(after));const result=await write;check(result.outcome===(quiz?'OK':'ALREADY_CLAIMED'),'invalid write fixture');await flush();const fresh=tx.calls.at(-1);check(fresh!==writeCall,'post-write read missing');fresh.resolve(ok(after));await deferred;
    const accepted=c.snapshot;oldCall.resolve(ok(initial));check(await old===false,'stale read applied');check(c.snapshot===accepted,'stale read replaced latest snapshot');check(tx.calls.filter(x=>x.fn===(quiz?DAILY_QUIZ_RPC.START:ATTENDANCE_RPC.CLAIM)).length===1,'automatic daily mutation');results.push({type,staleReadApplied:false,mutationCount:1});
  }return results;
}
window.__WORLD_STABILITY__={ready:true,prepareShop,beginReadback,switchShop,finishReadback,loadoutBoundaries,staleKey,dailyOrdering,
  touchState:()=>({vector:{...controller.touchVector},knob:document.getElementById('joystick-knob').style.transform,events:events.slice(),position:{...position}}),
  block:enabled=>controller.setInputEnabled(enabled),releaseCapture:ownerId=>{check(pad.hasPointerCapture(ownerId),'specified capture owner missing');pad.releasePointerCapture(ownerId);},
  lifecycle:type=>window.dispatchEvent(new Event(type)),step:()=>controller.update(1/60),receipt};
receipt('브라우저 준비 완료 · 합성 계정 / 운영 연결 없음');
