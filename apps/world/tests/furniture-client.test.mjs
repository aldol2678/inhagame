import test from "node:test";
import assert from "node:assert/strict";
import { createFurnitureClient,parseFurnitureSnapshot } from "../src/rooms/furniture-client.js";
const ROOM="11111111-1111-4111-8111-111111111111", ROOM_B="22222222-2222-4222-8222-222222222222";
const USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", USER_B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const object={id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",itemId:"furniture.induck_chair",surface:"floor",x:-2,z:-1,yaw:0};
const owned=[{itemId:object.itemId,quantity:1}];
const snapshot=(extra={})=>({roomId:ROOM,role:"owner",revision:0,objects:[],...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function rig(){
  let user=USER;const calls=[], queue=[], changes=[];
  const rpc={rpc:async(name,args)=>{calls.push({name,args}); const next=queue.shift(); if(!next)throw Error("MISSING_FIXTURE");return next;}};
  const client=createFurnitureClient({getClient:()=>rpc,getUserId:()=>user,onChange:s=>changes.push(s)});
  return {client,calls,changes,respond:data=>queue.push({data,error:null}),fail:message=>queue.push({data:null,error:{message}}),defer:d=>queue.push(d.promise),switchUser:()=>{user=USER_B;}};
}
async function enter(h,extra){h.respond(snapshot(extra));assert.equal(await h.client.bind(ROOM),true);}
test("owner saves an atomic snapshot and re-entry reloads it through the read RPC", async()=>{
  const h=rig();await enter(h);assert.equal(h.client.begin(),true);h.client.edit([object]);
  h.respond(snapshot({revision:1,objects:[object]}));assert.equal(await h.client.save(owned),true);
  assert.deepEqual(h.calls[1],{name:"save_my_room_furniture_v1",args:{p_room:ROOM,p_revision:0,p_objects:[object]}});
  assert.equal(h.client.state().dirty,false);h.client.reset();await enter(h,{revision:1,objects:[object]});
  assert.deepEqual(h.client.state().objects,[object]);assert.equal(h.client.state().editing,false);
});
test("read payload fails closed on role, geometry, revision or another room",()=>{
  assert.ok(parseFurnitureSnapshot(snapshot(),ROOM));
  for(const extra of [{role:"admin"},{revision:-1},{revision:1.5},{roomId:ROOM_B},{objects:[{...object,x:0,z:-3}]}]) assert.equal(parseFurnitureSnapshot(snapshot(extra),ROOM),null);
});
test("visitors see saved furniture and cannot begin editing or call save",async()=>{
  const h=rig();await enter(h,{role:"visitor",revision:2,objects:[object]});assert.deepEqual(h.client.state().objects,[object]);
  assert.equal(h.client.begin(),false);assert.equal(h.client.edit([]),false);assert.equal(await h.client.save(owned),false);assert.equal(h.calls.length,1);
  h.respond(snapshot({role:"visitor",revision:3,objects:[]}));await h.client.refresh();assert.deepEqual(h.client.state().objects,[]);
});
test("failed/uncertain save preserves draft and retry sends the same expected revision and snapshot",async()=>{
  const h=rig();await enter(h);h.client.begin();h.client.edit([object]);h.fail("network");assert.equal(await h.client.save(owned),false);
  assert.equal(h.client.state().dirty,true);assert.deepEqual(h.client.state().objects,[object]);
  h.respond(snapshot({revision:1,objects:[object]}));assert.equal(await h.client.save(owned),true);assert.deepEqual(h.calls[1],h.calls[2]);
});
test("revision conflict preserves draft and never overwrites or polls over it",async()=>{
  const h=rig();await enter(h);h.client.begin();h.client.edit([object]);h.fail("LAYOUT_CONFLICT");await h.client.save(owned);
  assert.equal(h.client.state().error,"LAYOUT_CONFLICT");assert.deepEqual(h.client.state().objects,[object]);
  assert.equal(await h.client.refresh(),false);assert.equal(h.calls.length,2);
  h.client.cancel();h.respond(snapshot({revision:5,objects:[]}));await h.client.refresh();assert.equal(h.client.state().revision,5);
});
test("invalid and unowned drafts never reach the save endpoint",async()=>{
  const h=rig();await enter(h);h.client.begin();h.client.edit([object]);assert.equal(await h.client.save([]),false);
  assert.equal(h.client.state().error,"ITEM_NOT_OWNED");h.client.edit([{...object,x:0,z:-3}]);assert.equal(await h.client.save(owned),false);
  assert.equal(h.client.state().error,"EXIT_BLOCKED");assert.equal(h.calls.length,1);
});
test("in-flight save locks edits, another save, close and polling",async()=>{
  const h=rig();await enter(h);h.client.begin();h.client.edit([object]);const d=deferred();h.defer(d);const save=h.client.save(owned);
  assert.equal(h.client.state().pending,true);assert.equal(h.client.edit([]),false);assert.equal(h.client.cancel(),false);
  assert.equal(await h.client.save(owned),false);assert.equal(await h.client.refresh(),false);
  d.resolve({data:snapshot({revision:1,objects:[object]}),error:null});assert.equal(await save,true);
});
test("room switch clears former objects immediately and ignores its late read",async()=>{
  const h=rig(),d=deferred();h.defer(d);const first=h.client.bind(ROOM);h.respond(snapshot({roomId:ROOM_B,role:"visitor"}));
  await h.client.bind(ROOM_B);d.resolve({data:snapshot({objects:[object]}),error:null});assert.equal(await first,false);
  assert.equal(h.client.state().roomId,ROOM_B);assert.deepEqual(h.client.state().objects,[]);
});
test("account switch or forced exit cannot resurrect a late saved draft",async()=>{
  for(const mode of ["account","exit"]){
    const h=rig();await enter(h);h.client.begin();h.client.edit([object]);const d=deferred();h.defer(d);const save=h.client.save(owned);
    if(mode==="account"){h.switchUser();h.client.reset();}else h.client.cancel({force:true});
    d.resolve({data:snapshot({revision:1,objects:[object]}),error:null});assert.equal(await save,false);
    assert.equal(h.client.state().editing,false);assert.equal(h.client.state().pending,false);assert.deepEqual(h.client.state().objects,[]);
  }
});
test("server failure returning a different snapshot/revision cannot mark a draft saved",async()=>{
  const h=rig();await enter(h,{revision:2});h.client.begin();h.client.edit([object]);h.respond(snapshot({revision:1,objects:[object]}));
  assert.equal(await h.client.save(owned),false);assert.equal(h.client.state().dirty,true);assert.equal(h.client.state().error,"UNAVAILABLE");
});
test("explicit denial clears a visitor projection while transport failure cannot grant edit access",async()=>{
  const h=rig();await enter(h,{role:"visitor",objects:[object]});h.fail("LAYOUT_DENIED");await h.client.refresh();
  assert.equal(h.client.state().ready,false);assert.deepEqual(h.client.state().objects,[]);assert.equal(h.client.begin(),false);
});
