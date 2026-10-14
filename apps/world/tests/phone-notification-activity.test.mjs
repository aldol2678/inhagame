import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectServerActivity } from '../src/phone/phone-notification-activity.js';
import { createPhoneNotificationCenter } from '../src/phone/phone-notification-center.js';
import { createPhoneMessages } from '../src/phone/phone-messages.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const D='44444444-4444-4444-8444-444444444444';
const next=()=>new Promise(resolve=>setImmediate(resolve));
const descendants=node=>[node,...node.children.flatMap(descendants)];
const message={conversationId:'conv-server-1',other:{userId:C,nickname:'인덕이',available:true},
  updatedAt:'2026-10-14T04:00:00Z',unreadCount:2,
  lastMessage:{id:'msg-1',body:'PRIVATE CONTENT MUST NEVER LEAK',createdAt:'2026-10-14T04:00:00Z'}};

test('NOTI-01C projection uses server-confirmed data, no made-up history timestamps or text leaks',()=>{
 const items=projectServerActivity({accountId:A,conversations:[message,message,{...message,conversationId:'conv-server-2',
  other:{userId:A}}],incoming:[{userId:D,nickname:'친구'}, {userId:D,nickname:'친구'}]});
 assert.equal(items.length,2);
 assert.deepEqual(items.map(x=>x.group),['friends','messages']);
 assert.equal(items[0].createdAt,null,'Social RPC contains no friend request timestamp');
 assert.equal(items[1].createdAt,message.lastMessage.createdAt);
 assert.deepEqual(items[1].params,{recipientId:C});
 assert.ok(!JSON.stringify(items).includes('PRIVATE CONTENT'));
 assert.equal(projectServerActivity({accountId:'invalid',conversations:[message]}).length,0);
});

test('NOTI-01C on-demand recent tab loads the existing two server authorities and deep links',async()=>{
 const doc=createFakeDocument(),host=doc.createElement('main');
 const calls={message:0,social:0},opened=[];
 const social={available:true,getSelfUserId:()=>A,
   async mine(){calls.social++;return {incoming:[{userId:D,nickname:'대학 친구'}],friends:[],outgoing:[],blocked:[]};}};
 const c=createPhoneNotificationCenter({doc,getSocial:()=>social,
   getMessageActivity:async()=>{calls.message++;return {outcome:'READY',accountId:A,conversations:[message]};},
   onOpenApp:(id,params)=>{opened.push({id,params});return true;},
   getStorage:()=>({getItem:()=>null,setItem(){}})});
 c.setAccount(A);c.mount(host);
 assert.equal(calls.social,0,'current tab must not start extra RPCs');
 c.setScreen('activity');await next();await next();await next();await next();
 const snapshot=c.snapshot();
 assert.equal(snapshot.activityState,'ready');
 assert.deepEqual(snapshot.activity.map(x=>x.group),['friends','messages']);
 assert.equal(calls.social,1);assert.equal(calls.message,1);
 const click=text=>descendants(host).find(n=>n.tagName==='BUTTON'&&n.textContent===text)?.click();
 click('대화 열기');assert.deepEqual(opened[0],{id:'messages',params:{recipientId:C}});
 click('친구 요청 보기');assert.deepEqual(opened[1],{id:'friends',params:{}});
 assert.equal(c.snapshot().unreadCount,0,'recent conversations never invent unread badge counts');
 c.destroy();
});

test('NOTI-01C async account change drops stale history and prevents cross-account feed',async()=>{
 const doc=createFakeDocument(),host=doc.createElement('main');
 let complete;
 const social={available:true,getSelfUserId:()=>A,mine:()=>new Promise(resolve=>{complete=resolve;})};
 const c=createPhoneNotificationCenter({doc,getSocial:()=>social,getMessageActivity:async()=>({outcome:'READY',accountId:A,conversations:[message]})});
 c.setAccount(A);c.mount(host);c.setScreen('activity');await next();await next();await next();await next();
 c.setAccount(B);complete({incoming:[{userId:D,nickname:'A 친구'}]});await next();
 assert.equal(c.snapshot().accountId,B);
 assert.deepEqual(c.snapshot().activity,[]);
 assert.equal(c.snapshot().activityState,'idle');
 c.destroy();
});

test('NOTI-01C partial server availability shows only confirmed source and warns',async()=>{
 const c=createPhoneNotificationCenter({getSocial:()=>({available:false}),
  getMessageActivity:async()=>({outcome:'READY',accountId:A,conversations:[message]}),
  doc:createFakeDocument()});
 c.setAccount(A);await c.refreshActivity();
 assert.equal(c.snapshot().activityState,'ready');
 assert.equal(c.snapshot().activity.length,1);
 assert.match(c.snapshot().activityNotice,/일부/);
 c.destroy();
});

test('NOTI-01C existing Hub Messages client lists recent conversations with account lease',async()=>{
 const doc=createFakeDocument();let resolveList;
 const model={accountId:null,setAccount(id){this.accountId=id;},
   list(){return new Promise(resolve=>{resolveList=resolve;});},
   refreshUnread:async()=>({outcome:'READY',unreadCount:0})};
 const m=createPhoneMessages({doc,getClient:()=>({}),getFactory:async()=>()=>model});
 m.setAccount(A);await next();
 const request=m.readActivity();
 await next();m.setAccount(B);
 resolveList({outcome:'READY',conversations:[message],unreadCount:2});
 const result=await request;assert.equal(result.outcome,'STALE');
 assert.equal(m.status().unreadCount,0,'no stale unread count after switch');
 const fresh=m.readActivity();await next();
 resolveList({outcome:'READY',conversations:[message],unreadCount:2});
 const now=await fresh;assert.equal(now.outcome,'READY');assert.equal(now.accountId,B);
 assert.equal(now.conversations[0].conversationId,message.conversationId);
 assert.equal(m.status().unreadCount,0,'history projection must not overwrite authoritative total unread');
});
