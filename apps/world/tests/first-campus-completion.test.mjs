import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirstCampusCompletion, isElementVisible } from '../src/quest/first-campus-completion.js';
import { createQuestClient } from '../npc-factory/quest-client.mjs';
import { QUEST_ID } from '../npc-factory/quest-contract.mjs';
const reward = { rewardId:'reward.quest.first_campus', rewardVersion:2, rewardTransactionId:'tx-1', status:'SUCCESS', replayed:false, completedAt:'2026-10-04T00:00:00Z', entries:[{grantType:'ITEM',targetId:'badge.main_gate',requested:1,granted:1,status:'GRANTED',reason:null},{grantType:'EXP',targetId:'exp.campus',requested:100,granted:100,status:'GRANTED',reason:null}] };
const memory = () => { const map=new Map(); return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}; };
function setup(storage=memory()) {
 const events=[]; const funnel=Object.fromEntries(['firstReward','rewardSeen','growthSeen','nextGoalSeen'].map(k=>[k,()=>events.push(k)]));
 const flow=createFirstCampusCompletion({storage,getFunnel:()=>funnel}); flow.setAccount('account-A');
 return {flow,events,storage};
}
for(const replayed of [false,true]) test(`receipt ${replayed?'recovery':'fresh'} records milestones only after real presentation and current-account readback`,()=>{
 const {flow,events}=setup();flow.begin(); const token=flow.accept({...reward,replayed}); assert.ok(token); let showing=false;
 flow.trackToast(token,{isVisible:()=>showing});
 flow.observe({growthVisible:true,nextGoalVisible:true});assert.deepEqual(events,['firstReward']);
 flow.growthReadback({accountId:'account-A',reason:'core15-first-campus-reward',state:'READY',snapshot:{level:2,totalExp:100}});
 flow.observe({growthVisible:false,nextGoalVisible:false});assert.deepEqual(events,['firstReward']);
 showing=true;flow.observe({growthVisible:false,nextGoalVisible:false});assert.deepEqual(events,['firstReward','rewardSeen']);
 flow.observe({growthVisible:true,nextGoalVisible:false});assert.deepEqual(events,['firstReward','rewardSeen','growthSeen']);
 flow.observe({growthVisible:true,nextGoalVisible:true});assert.deepEqual(events,['firstReward','rewardSeen','growthSeen','nextGoalSeen']);
 assert.equal(flow.needsRecovery(),false);flow.observe({growthVisible:true,nextGoalVisible:true});assert.equal(events.length,4);
});
test('reload remembers an interrupted attempt only for the same account, never a completed account',()=>{
 const h=setup();h.flow.begin();const a=setup(h.storage);assert.equal(a.flow.needsRecovery(),true);
 a.flow.setAccount('account-B');assert.equal(a.flow.needsRecovery(),false);a.flow.setAccount('account-A');assert.equal(a.flow.needsRecovery(),true);
 const token=a.flow.accept(reward);a.flow.trackToast(token,{isVisible:()=>true});a.flow.growthReadback({accountId:'account-A',reason:'core15-first-campus-reward',state:'READY',snapshot:{level:2,totalExp:100}});a.flow.observe({growthVisible:true,nextGoalVisible:true});
 assert.equal(setup(h.storage).flow.needsRecovery(),false);
});
test('account generation invalidates old toast tokens and readback without completing another account',()=>{
 const {flow,events}=setup();flow.begin();const token=flow.accept(reward);flow.trackToast(token,{isVisible:()=>true});flow.setAccount('account-B');
 assert.equal(token.isCurrent(),false);flow.growthReadback({accountId:'account-A',reason:'core15-first-campus-reward',state:'READY',snapshot:{level:2,totalExp:100}});flow.observe({growthVisible:true,nextGoalVisible:true});assert.deepEqual(events,['firstReward']);
 flow.setAccount('account-A');assert.equal(token.isCurrent(),false);assert.equal(flow.needsRecovery(),true);
});
test('read failure, generic refresh, other account and malformed receipt cannot prove growth',()=>{
 const {flow,events}=setup();flow.begin();assert.equal(flow.accept({...reward,rewardTransactionId:''}),null);const token=flow.accept(reward);flow.trackToast(token,{isVisible:()=>true});
 for(const change of [{accountId:'account-A',reason:'reward',state:'READY',snapshot:{}},{accountId:'account-B',reason:'core15-first-campus-reward',state:'READY',snapshot:{}},{accountId:'account-A',reason:'core15-first-campus-reward',state:'UNAVAILABLE',snapshot:null}])flow.growthReadback(change);
 flow.observe({growthVisible:true,nextGoalVisible:true});assert.deepEqual(events,['firstReward','rewardSeen']);
});
test('a historical replay with no interrupted attempt is not a fresh first-session reward',()=>{const {flow,events}=setup();assert.equal(flow.accept({...reward,replayed:true}),null);assert.deepEqual(events,[]);});
test('DOM visibility requires a rendered, connected, visible element and foreground document',()=>{
 const doc={visibilityState:'visible',defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})}};
 const el={ownerDocument:doc,isConnected:true,hidden:false,parentElement:null,getClientRects:()=>[{width:40,height:20}]};
 assert.equal(isElementVisible(el),true);el.hidden=true;assert.equal(isElementVisible(el),false);el.hidden=false;doc.visibilityState='hidden';assert.equal(isElementVisible(el),false);doc.visibilityState='visible';el.isConnected=false;assert.equal(isElementVisible(el),false);el.isConnected=true;el.parentElement={hidden:true};assert.equal(isElementVisible(el),false);
});
function browser(flow, respond) {return createQuestClient({enabled:true,endpoint:'/quest',getSession:async()=> 'synthetic',completion:flow,statusRetryDelays:[],onReward:r=>flow.accept(r),fetcher:async(_url,options)=>({ok:true,json:async()=>respond(JSON.parse(options.body))})});}
test('lost response then reload replays the existing final-talk receipt only with an account-scoped attempt',async()=>{
 const h=setup();let stage=4,grants=0;
 const first=browser(h.flow,({event})=>{if(event==='talk_001'){stage=5;grants++;throw Error('response lost');}return {quest_id:QUEST_ID,stage};});
 await first.setSignedIn(true);await assert.rejects(first.advanceNpc('INKYUNG-NPC-001'),/response lost/);assert.equal(h.flow.needsRecovery(),true);
 const resumed=setup(h.storage),calls=[];const reloaded=browser(resumed.flow,({event})=>{calls.push(event);return {quest_id:QUEST_ID,stage:5,...(event==='talk_001'?{rewardReceipt:{...reward,replayed:true}}:{})};});
 await reloaded.setSignedIn(true);assert.deepEqual(calls,['status','talk_001']);assert.deepEqual(resumed.events,['firstReward']);assert.equal(grants,1);
 const other=setup(h.storage);other.flow.setAccount('account-B');const otherCalls=[];await browser(other.flow,({event})=>{otherCalls.push(event);return {quest_id:QUEST_ID,stage:5};}).setSignedIn(true);assert.deepEqual(otherCalls,['status']);
});
test('normal completed account makes only status call and no receipt presentation',async()=>{const h=setup(),calls=[];await browser(h.flow,({event})=>{calls.push(event);return {quest_id:QUEST_ID,stage:5};}).setSignedIn(true);assert.deepEqual(calls,['status']);assert.deepEqual(h.events,[]);});
test('receipt readback that is temporarily missing retries with the same final-talk intent, then stops',async()=>{
 const h=setup();h.flow.begin();const timers=[],calls=[];let receipts=0;
 const client=createQuestClient({enabled:true,endpoint:'/quest',getSession:async()=> 'synthetic',completion:h.flow,statusRetryDelays:[1,3],setTimer:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimer:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},onReward:r=>h.flow.accept(r),fetcher:async(_url,opts)=>{const {event}=JSON.parse(opts.body);calls.push(event);return {ok:true,json:async()=>({quest_id:QUEST_ID,stage:5,...(event==='talk_001'&&++receipts>1?{rewardReceipt:{...reward,replayed:true}}:{})})};}});
 await client.setSignedIn(true);assert.equal(timers.length,1);await timers.shift().fn();await Promise.resolve();assert.deepEqual(calls,['status','talk_001','talk_001']);assert.deepEqual(h.events,['firstReward']);assert.equal(timers.length,0);
});
test('switching accounts cancels deferred receipt recovery',async()=>{
 const h=setup();h.flow.begin();const timers=[],calls=[];
 const client=createQuestClient({enabled:true,endpoint:'/quest',getSession:async()=> 'synthetic',completion:h.flow,statusRetryDelays:[1],setTimer:fn=>(timers.push(fn),fn),clearTimer:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},fetcher:async(_url,opts)=>{calls.push(JSON.parse(opts.body).event);return {ok:true,json:async()=>({quest_id:QUEST_ID,stage:5})};}});
 await client.setSignedIn(true);assert.equal(timers.length,1);h.flow.setAccount('account-B');await client.setSignedIn(true);assert.equal(timers.length,0);assert.deepEqual(calls,['status','talk_001','status']);
});
test('reload joins receipt recovery after a transient initial status failure',async()=>{
 const h=setup();h.flow.begin();const timers=[],calls=[];let statusReads=0;
 const client=createQuestClient({enabled:true,endpoint:'/quest',getSession:async()=> 'synthetic',completion:h.flow,statusRetryDelays:[1,3],setTimer:fn=>(timers.push(fn),fn),clearTimer:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},onReward:r=>h.flow.accept(r),fetcher:async(_url,opts)=>{const {event}=JSON.parse(opts.body);calls.push(event);if(event==='status'&&++statusReads===1)throw Error('offline');return {ok:true,json:async()=>({quest_id:QUEST_ID,stage:5,...(event==='talk_001'?{rewardReceipt:{...reward,replayed:true}}:{})})};}});
 await client.setSignedIn(true);assert.equal(timers.length,1);timers.shift()();for(let i=0;i<20;i++)await Promise.resolve();assert.deepEqual(calls,['status','status','talk_001']);assert.deepEqual(h.events,['firstReward']);assert.equal(timers.length,0);
});

test('DOM visibility rejects clipped or offscreen CTA until its full usable surface is shown',()=>{
 const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
 const doc={visibilityState:'visible',defaultView:{innerWidth:844,innerHeight:390,getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',...node.style})}};
 const parent={ownerDocument:doc,parentElement:null,style:{overflowX:'hidden',overflowY:'hidden'},getBoundingClientRect:()=>rect(622,154,210,80)};
 const el={ownerDocument:doc,isConnected:true,parentElement:parent,getClientRects:()=>[rect(831,155,29,55)]};
 assert.equal(isElementVisible(el),false,'a clipped 1px sliver is not a usable next-goal button');
 el.getClientRects=()=>[rect(820,155,20,32)];
 assert.equal(isElementVisible(el),false,'ancestor clipping still matters when the button fits the viewport');
 el.getClientRects=()=>[rect(790,195,36,32)];
 assert.equal(isElementVisible(el),true,'fully contained button is visible');
 parent.style={overflowX:'visible',overflowY:'visible'};el.getClientRects=()=>[rect(831,155,29,55)];
 assert.equal(isElementVisible(el),false,'viewport clipping cannot prove display');
});
