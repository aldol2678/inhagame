import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneMessages } from '../src/phone/phone-messages.js';
import { createFakeDocument } from './support/fake-dom.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const TARGET='33333333-3333-4333-8333-333333333333';
const receipt=(owner,body)=>({conversationId:'conversation',messageId:'server-receipt',senderId:owner,body,createdAt:new Date().toISOString()});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const descendants=node=>[node,...node.children.flatMap(descendants)];
function fixture() {
 const doc=createFakeDocument(),host=doc.createElement('main');let resolveSend;
 const f={sendResult:{outcome:'FAILED',code:'FAILED'},listFail:false,threadFail:false,defer:false,calls:0,messages:[],hasConversation:true};
 const item={conversationId:'conversation',other:{userId:TARGET,nickname:'Target',available:true},blockedByMe:false,updatedAt:new Date().toISOString()};
 const model={accountId:null,get conversations(){return f.hasConversation?[item]:[];},unreadCount:0,setAccount(id){this.accountId=id;},
  async refreshUnread(){return {outcome:'READY',unreadCount:0};},
  async list(){return f.listFail?{outcome:'FAILED'}:{outcome:'READY',conversations:f.hasConversation?[item]:[],unreadCount:0};},
  async thread(){return f.threadFail?{outcome:'FAILED'}:{outcome:'READY',thread:{messages:f.messages}};},
  async markRead(){return {outcome:'SUCCESS'};},
  async recipient(){return {outcome:'READY',recipient:{...item.other,relationship:'friends'}};},
  async send(target,body){f.calls++;f.lastSend={owner:this.accountId,body};return f.defer?new Promise(resolve=>{resolveSend=resolve;}):f.sendResult?.outcome==='SUCCESS' && f.sendResult.data===undefined?{...f.sendResult,data:receipt(this.accountId,body)}:f.sendResult;}
 };
 const ui=createPhoneMessages({doc,getClient:()=>({}),getFactory:async()=>()=>model});
 const find=(tag,text)=>descendants(host).find(n=>n.tagName===tag && (text===undefined || n.textContent===text));
 const button=text=>find('BUTTON',text);
 const open=async()=>{ui.activate();ui.mount(host);await settle();button('').click();await settle();};
 // The inbox item button has children rather than a textContent label.
 f.startNew=async()=>{ui.activate();ui.mount(host);await settle();const input=find('INPUT');input.value=TARGET;input.parent.dispatch('submit');await settle();};
 f.open=open;f.button=button;f.ui=ui;f.host=host;f.model=model;
 f.send=async(body='hello')=>{const field=find('TEXTAREA');field.value=body;field.parent.dispatch('submit');await settle();};
 f.check=async()=>{button('최신 대화 확인').click();await settle();};
 f.resolve=result=>resolveSend(result.outcome==='SUCCESS' && result.data===undefined?{...result,data:receipt(f.lastSend.owner,f.lastSend.body)}:result);f.setAccount=async id=>{ui.setAccount(id);await settle();};
 ui.setAccount(A);return f;
}
async function ready(){const f=fixture();await f.open();return f;}
test('unknown send outcome blocks duplicate submit until fresh readback and explicit manual retry permission',async()=>{
 const f=await ready();await f.send();assert.equal(f.calls,1);assert.equal(f.button('보내기').disabled,true);
 await f.send();assert.equal(f.calls,1);assert.equal(f.button('중복 가능성 확인 · 재시도 허용'),undefined);
 await f.check();assert.equal(f.calls,1);assert.equal(f.button('보내기').disabled,true);
 f.button('중복 가능성 확인 · 재시도 허용').click();assert.equal(f.calls,1);assert.equal(f.button('보내기').disabled,false);
 await f.send();assert.equal(f.calls,2);
});
for(const failure of ['listFail','threadFail'])test(`${failure}: failed readback retains lock and does not offer retry permission`,async()=>{
 const f=await ready();await f.send();f[failure]=true;await f.check();
 assert.equal(f.button('보내기').disabled,true);assert.equal(f.button('중복 가능성 확인 · 재시도 허용'),undefined);assert.equal(f.calls,1);
});
test('unknown send lock survives close, reopen and A→B→A without affecting account B',async()=>{
 const f=await ready();await f.send();f.ui.close();f.host.replaceChildren();await f.open();assert.equal(f.button('보내기').disabled,true);
 await f.setAccount(B);await f.open();assert.equal(f.button('보내기').disabled,false);
 await f.setAccount(A);await f.open();assert.equal(f.button('보내기').disabled,true);assert.equal(f.calls,1);
});
test('in-flight send survives close and ABA; stale settlement becomes uncertainty, never auto-resends',async()=>{
 const f=await ready();f.defer=true;await f.send();f.ui.close();await f.open();assert.equal(f.button('보내기').disabled,true);
 assert.equal(f.button('최신 대화 확인'),undefined);await f.setAccount(B);await f.setAccount(A);await f.open();
 await f.send();assert.equal(f.calls,1);f.resolve({outcome:'STALE'});await settle();assert.ok(f.button('최신 대화 확인'));
 assert.equal(f.button('보내기').disabled,true);assert.equal(f.calls,1);
});
test('new matching server message suppresses resend using ID, account, target thread, time and body',async()=>{
 const f=await ready();await f.send();f.messages=[{id:'new-server-id',senderId:A,body:'hello',createdAt:new Date().toISOString()}];
 await f.check();assert.equal(f.button('보내기').disabled,true);assert.equal(f.button('중복 가능성 확인 · 재시도 허용'),undefined);
 assert.equal(f.button('최신 대화 확인'),undefined);assert.equal(f.calls,1);
 await f.send('hello');assert.equal(f.calls,1);f.sendResult={outcome:'SUCCESS'};await f.send('a different new message');assert.equal(f.calls,2);
});
for(const variant of ['old-time','future-time','other-sender','different-body','known-id'])test(`${variant}: identical body alone never establishes observed delivery`,async()=>{
 const f=await ready();
 if(variant==='known-id'){f.messages=[{id:'known',senderId:A,body:'hello',createdAt:new Date().toISOString()}];await f.open();}
 await f.send();f.messages=[{id:variant==='known-id'?'known':'new',senderId:variant==='other-sender'?B:A,
  body:variant==='different-body'?'different':'hello',createdAt:variant==='old-time'?'2000-01-01T00:00:00Z':variant==='future-time'?'2100-01-01T00:00:00Z':new Date().toISOString()}];
 await f.check();assert.ok(f.button('중복 가능성 확인 · 재시도 허용'));assert.equal(f.calls,1);
});
test('definitive rejection permits corrected manual send while confirmed success is not locked',async()=>{
 const f=await ready();f.sendResult={outcome:'FAILED',code:'INVALID_MESSAGE'};await f.send();assert.equal(f.button('보내기').disabled,false);
 f.sendResult={outcome:'SUCCESS'};await f.send();assert.equal(f.button('보내기').disabled,false);assert.equal(f.calls,2);
});
test('thrown transport failures remain locked and cannot bypass through form resubmission',async()=>{
 const f=await ready();f.model.send=async()=>{f.calls++;throw Error('transport lost');};
 await f.send();await f.send();assert.equal(f.calls,1);assert.equal(f.button('보내기').disabled,true);
});
test('close during readback does not grant retry permission on reopen',async()=>{
 const f=await ready();await f.send();const list=f.model.list;let resolve;
 f.model.list=()=>new Promise(r=>{resolve=r;});f.button('최신 대화 확인').click();await settle();
 f.ui.close();resolve(await list());await settle();f.model.list=list;await f.open();
 assert.equal(f.button('보내기').disabled,true);assert.equal(f.button('중복 가능성 확인 · 재시도 허용'),undefined);
});
test('confirmed send settles while closed without resurfacing UI or retaining false uncertainty',async()=>{
 const f=await ready();f.defer=true;await f.send();f.ui.close();f.host.replaceChildren();
 f.resolve({outcome:'SUCCESS'});await settle();assert.equal(f.host.children.length,0);await f.open();
 assert.equal(f.button('보내기').disabled,false);assert.equal(f.calls,1);
});

test('uncertain first send with no conversation needs fresh list and explicit retry permission',async()=>{
 const f=fixture();f.hasConversation=false;await f.startNew();await f.send();assert.equal(f.button('보내기').disabled,true);
 await f.check();assert.ok(f.button('중복 가능성 확인 · 재시도 허용'));assert.equal(f.calls,1);
});
test('lost first-send reply discovers new server conversation and suppresses replay',async()=>{
 const f=fixture();f.hasConversation=false;await f.startNew();await f.send();
 f.hasConversation=true;f.messages=[{id:'first-server-id',senderId:A,body:'hello',createdAt:new Date().toISOString()}];
 await f.check();assert.equal(f.button('보내기').disabled,true);assert.equal(f.button('중복 가능성 확인 · 재시도 허용'),undefined);assert.equal(f.calls,1);
});

for(const data of [null,{...receipt(B,'hello')},{...receipt(A,'different')},{...receipt(A,'hello'),conversationId:'wrong'}])test('malformed or mismatched successful RPC response is uncertain, not proof of delivery',async()=>{
 const f=await ready();f.sendResult={outcome:'SUCCESS',data};await f.send();assert.equal(f.button('보내기').disabled,true);assert.ok(f.button('최신 대화 확인'));assert.equal(f.calls,1);
});
