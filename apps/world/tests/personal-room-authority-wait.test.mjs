import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalRoomInteraction } from "../src/rooms/personal-room-interaction.js";

const authority={roomId:"room-a",ownerUserId:"user-a",visibility:"friends"};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function rig(){
  let space="ROOM_DORM1_LOBBY",busy=false;
  const requests=[],events=[],messages=[],timers=new Map();
  let timerId=0;
  const client={generation:0,getSelfUserId:()=>"user-a",ensure:()=>{
    events.push("ensure");const request=deferred();requests.push(request);return request.promise;
  }};
  const rooms={get currentSpace(){return space;},status:()=>({busy}),enterNested:()=>{events.push("enter");return true;}};
  const options={client,rooms,onStatus:m=>messages.push(m),onOpeningChange:state=>events.push(state),
    setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)};
  const interaction=createPersonalRoomInteraction(options);
  return {interaction,options,client,rooms,requests,events,messages,timers,setSpace:v=>space=v,setBusy:v=>busy=v};
}

test("authority UI starts before ensure and releases before transition owns loading",async()=>{
  const r=rig(),pending=r.interaction.open();
  assert.equal(r.events[0].active,true);
  assert.equal(r.events[1],"ensure");
  assert.equal(r.interaction.opening,true);
  assert.equal([...r.timers.values()][0].ms,15000);
  assert.equal(await r.interaction.open(),false);
  r.requests[0].resolve(authority);
  assert.equal(await pending,true);
  assert.deepEqual(r.events.slice(-2),[{active:false,onCancel:null},"enter"]);
  assert.equal(r.interaction.opening,false);
  assert.equal(r.timers.size,0);
});

test("cancel is silent and immediate retry survives late success and stale cancel callback",async()=>{
  const r=rig(),old=r.interaction.open(),cancelOld=r.events[0].onCancel;
  assert.equal(cancelOld(),true);
  assert.equal(r.interaction.opening,false);
  const retry=r.interaction.open();
  assert.equal(cancelOld(),false);
  r.requests[0].resolve(authority);
  assert.equal(await old,false);
  assert.equal(r.interaction.opening,true);
  assert.equal(r.events.filter(e=>e?.active===false).length,1);
  assert.equal(r.events.includes("enter"),false);
  r.requests[1].resolve(authority);
  assert.equal(await retry,true);
  assert.deepEqual(r.messages,[]);
  assert.equal(r.interaction.cancelOpen(),false);
});

test("timeout bounds unresolved authority and allows retry without resetting client",async()=>{
  const r=rig(),old=r.interaction.open();
  const expire=[...r.timers.values()][0].fn;
  expire();
  assert.equal(r.interaction.opening,false);
  assert.match(r.messages[0],/다시 시도/);
  const retry=r.interaction.open();
  expire(); // A stale timer cannot cancel the retry.
  r.requests[0].reject(new Error("late failure"));
  assert.equal(await old,false);
  assert.equal(r.interaction.opening,true);
  assert.equal(r.messages.length,1);
  assert.equal(r.client.generation,0);
  r.requests[1].resolve(authority);
  assert.equal(await retry,true);
});

for(const change of [r=>r.client.generation++,r=>r.client.getSelfUserId=()=>"user-b",r=>r.setSpace("campus")]){
  test("authority completion fails closed after account or source-space change",async()=>{
    const r=rig(),pending=r.interaction.open();change(r);r.requests[0].resolve(authority);
    assert.equal(await pending,false);
    assert.equal(r.events.includes("enter"),false);
    assert.equal(r.events.at(-1).active,false);
    assert.equal(r.interaction.opening,false);
    assert.equal(r.timers.size,0);
  });
}

test("busy transition and non-lobby opens cannot claim loading UI",async()=>{
  const r=rig();r.setBusy(true);assert.equal(await r.interaction.open(),false);
  r.setBusy(false);r.setSpace("campus");assert.equal(await r.interaction.open(),false);
  assert.deepEqual(r.events,[]);
});

test("callback failures clean up and do not strand future opens",async()=>{
  const r=rig();let activeCalls=0;
  const interaction=createPersonalRoomInteraction({...r.options,onOpeningChange:({active})=>{
    if(active)activeCalls++;
    throw new Error("UI failure");
  }});
  assert.equal(await interaction.open(),false);
  assert.equal(interaction.opening,false);
  assert.equal(await interaction.open(),false);
  assert.equal(activeCalls,2);
  assert.equal(r.timers.size,0);
});

test("generic authority failure preserves status and releases loader",async()=>{
  const r=rig(),pending=r.interaction.open();r.requests[0].reject(new Error("network"));
  assert.equal(await pending,false);
  assert.equal(r.messages[0],"개인방을 불러오지 못했어요.");
  assert.equal(r.events.at(-1).active,false);
  assert.equal(r.timers.size,0);
});

test('programmatic transition cancels authority before claiming shared input; late reply cannot release it',async()=>{
  const r=rig();let locked=false;
  const interaction=createPersonalRoomInteraction({...r.options,onOpeningChange:({active})=>{locked=active;}});
  const pending=interaction.open();assert.equal(locked,true);
  // Production onBusyChange ordering: cancel authority synchronously, then acquire.
  interaction.cancelOpen();locked=true;
  r.requests[0].resolve(authority);assert.equal(await pending,false);assert.equal(locked,true);
  assert.equal(r.events.includes('enter'),false);
});

test('timeout invalidates only its authority generation so retry starts a fresh request',async()=>{
  const r=rig();let resets=0;
  r.client.reset=()=>{resets++;r.client.generation++;};
  const first=r.interaction.open();[...r.timers.values()][0].fn();assert.equal(await first,false);assert.equal(resets,1);
  const second=r.interaction.open();assert.equal(r.requests.length,2);
  r.requests[0].resolve(authority);await Promise.resolve();assert.equal(r.interaction.opening,true);
  r.requests[1].resolve(authority);assert.equal(await second,true);
});

test('real authority client abandons a hung inFlight on timeout and fences its late cache write',async()=>{
  const {PersonalRoomClient}=await import('../src/rooms/personal-room-client.js');
  const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',roomId='11111111-1111-4111-8111-111111111111';
  const requests=[],timers=[];let entered=0;
  const client=new PersonalRoomClient({getSelfUserId:()=>user,getClient:()=>({rpc:()=>{
    const d=deferred();requests.push(d);return d.promise;
  }})});
  const interaction=createPersonalRoomInteraction({client,rooms:{currentSpace:'ROOM_DORM1_LOBBY',enterNested:()=>{entered++;return true;}},
    setTimer:fn=>(timers.push(fn),timers.length),clearTimer(){}});
  const first=interaction.open();timers[0]();assert.equal(await first,false);
  const second=interaction.open();assert.equal(requests.length,2);
  const data={roomId,ownerUserId:user,roomType:'DORM_1_BASIC',visibility:'private'};
  requests[0].resolve({data});await Promise.resolve();await Promise.resolve();assert.equal(client.cached,null);
  requests[1].resolve({data});assert.equal(await second,true);assert.equal(entered,1);assert.equal(client.cached.roomId,roomId);
});
