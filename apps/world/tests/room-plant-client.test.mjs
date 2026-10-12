import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoomPlantClient, parseRoomPlantSnapshot, ROOM_PLANT_AVAILABLE, ROOM_PLANT_ITEM, ROOM_PLANT_ID } from "../src/rooms/room-plant-client.js";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A=id(1), B=id(2), ROOM=id(3), OBJECT=id(4);
const object={id:OBJECT,itemId:ROOM_PLANT_ITEM,surface:"floor",x:-6,z:0,yaw:0};
const context = () => ({accountId:A,ownerUserId:A,roomId:ROOM,role:"owner",space:"ROOM_PERSONAL_BASIC",ready:true,sessionActive:true,sessionVersion:1,revision:1,objects:[object]});
const snap = (extra={}) => ({roomId:ROOM,role:"owner",layoutRevision:1,featureStatus:"ACTIVE",serverNow:"2026-10-12T00:00:00Z",planterOwned:true,plant:null,...extra});
const plant = (extra={}) => ({objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"SPROUT",revision:1,nextStageAt:null,canCare:true,...extra});
function rig() {
  const h={account:A,context:context(),calls:[],queue:[],snapshot:snap(),inventoryOK:true,inventoryReads:0,ids:0};
  h.client=createRoomPlantClient({getUserId:()=>h.account,getRoomState:()=>h.context,isAvailable:()=>true,
    requestId:()=>id(10+(h.ids++)), refreshInventory:async()=>{h.inventoryReads++;return h.inventoryOK;},
    getClient:()=>({rpc:async(name,args)=>{
      h.calls.push({name,args:structuredClone(args)}); if(h.queue.length) return await h.queue.shift();
      if(name==="get_world_room_plants_v1") return {data:h.snapshot};
      if(name==="claim_my_room_planter_v1") {h.snapshot=snap();return {data:{status:"SUCCESS",userId:A,roomId:ROOM,itemId:ROOM_PLANT_ITEM,inventory:{status:"GRANTED",userId:A,itemId:ROOM_PLANT_ITEM}}};}
      const revision=name==="plant_my_room_plant_v1"?1:args.p_revision+1;
      h.snapshot=snap({plant:plant({revision,canCare:revision===1,nextStageAt:revision===1?null:"2026-10-12T20:00:00Z"})});
      return {data:{status:"SUCCESS",userId:A,roomId:ROOM,objectId:args.p_object,requestId:args.p_request_id,action:name.startsWith("plant_")?"PLANT":"CARE",plantRevision:revision,definitionVersion:1}};
    }})});
  return h;
}
test("candidate default is CLOSED, no read/write RPCs or imaginary starter pot",async()=>{
  assert.equal(ROOM_PLANT_AVAILABLE,false);let calls=0;
  const c=createRoomPlantClient({getUserId:()=>A,getRoomState:context,getClient:()=>{calls++;}});
  assert.equal(await c.refresh(),false);assert.equal(await c.claim(),false);assert.equal(await c.plant(OBJECT),false);assert.deepEqual(c.visuals(),[]);assert.equal(calls,0);
});
test("plant and care send only narrow target, server revision and stable request; fresh read confirms",async()=>{
  const h=rig();await h.client.refresh();assert.equal(await h.client.plant(OBJECT),true);
  assert.deepEqual(h.calls[1],{name:"plant_my_room_plant_v1",args:{p_room:ROOM,p_object:OBJECT,p_request_id:id(10)}});
  assert.equal(h.client.state().snapshot.plant.revision,1);assert.equal(await h.client.care(OBJECT),true);
  assert.equal(h.calls[3].args.p_revision,1);assert.equal(h.client.state().snapshot.plant.revision,2);
  assert.equal(await h.client.care(OBJECT),false,"client cannot advance from its own clock");
});
test("unknown write response retries frozen request rather than allocating a second one",async()=>{
  const h=rig();await h.client.refresh();h.queue.push({error:{message:"network down"}});
  assert.equal(await h.client.plant(OBJECT),false);assert.equal(h.client.state().retry.requestId,id(10));
  assert.equal(await h.client.plant(OBJECT),false);assert.equal(await h.client.retry(),true);
  assert.deepEqual(h.calls[1],h.calls[2]);assert.equal(h.ids,1);
});
test("double tap while unresolved is suppressed and no automatic write retry runs",async()=>{
  const h=rig();await h.client.refresh();let finish;h.queue.push(new Promise(r=>{finish=r;}));const first=h.client.plant(OBJECT);
  assert.equal(await h.client.plant(OBJECT),false);assert.equal(await h.client.retry(),false);assert.equal(h.calls.length,2);
  finish({error:{message:"network down"}});await first;assert.equal(h.calls.length,2);
});
test("grant is fixed once; failed Inventory read permits read-only retry, not another grant",async()=>{
  const h=rig();h.snapshot=snap({planterOwned:false});await h.client.refresh();h.inventoryOK=false;
  assert.equal(await h.client.claim(),true);assert.equal(h.client.state().needsReadback,true);assert.equal(h.client.state().error,"READBACK_REQUIRED");
  assert.equal(await h.client.claim(),false);assert.equal(h.calls.filter(c=>c.name==="claim_my_room_planter_v1").length,1);
  h.inventoryOK=true;assert.equal(await h.client.refresh(),true);assert.equal(h.client.state().inventoryConfirmed,true);assert.equal(h.inventoryReads,2);
});
test("visitor projection drops private fields and never exposes owner-only mutations",async()=>{
  const h=rig();h.context.role="visitor";h.context.ownerUserId=B;h.context.sessionVersion=id(80);h.context.visitLease={sessionId:id(80),leaseId:id(81)};
  h.snapshot={roomId:ROOM,role:"visitor",layoutRevision:1,featureStatus:"ACTIVE",plants:[{objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"BLOOM",canCare:false,careToken:null,lastCare:"secret"}],serverNow:"secret",planterOwned:true};
  await h.client.refresh();assert.deepEqual(h.client.visuals(),[{objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"BLOOM"}]);
  assert.equal(h.client.state().snapshot.serverNow,undefined);assert.equal(h.client.state().snapshot.plants[0].lastCare,undefined);
  assert.equal(await h.client.claim(),false);assert.equal(await h.client.plant(OBJECT),false);assert.equal(await h.client.care(OBJECT),false);assert.equal(h.inventoryReads,0);
});
for(const [name,change] of [
  ["identity",h=>{h.account=B;h.context={...h.context,accountId:B,ownerUserId:B};}],
  ["room",h=>h.context.roomId=id(9)], ["lost admission",h=>h.context.sessionActive=false],
  ["account ABA",h=>{h.account=B;h.client.sync();h.account=A;h.client.sync();}],
  ["session ABA",h=>{h.context.sessionVersion=2;h.client.sync();h.context.sessionVersion=3;h.client.sync();}],
  ["page lifecycle",h=>h.client.reset()]
]) test(`late response across ${name} cannot publish old success`,async()=>{
  const h=rig();await h.client.refresh();let finish;h.queue.push(new Promise(r=>{finish=r;}));const pending=h.client.plant(OBJECT);
  change(h);finish({data:{status:"SUCCESS",userId:A,roomId:ROOM,objectId:OBJECT,requestId:id(10),action:"PLANT",plantRevision:1,definitionVersion:1}});
  assert.equal(await pending,false);assert.equal(h.client.state().confirmed,null);assert.deepEqual(h.client.visuals(),[]);
});
for(const [key,value] of Object.entries({ready:false,editing:true,busy:true,sessionActive:false,layoutError:"LAYOUT_DENIED",accountId:B,role:"unknown",ownerUserId:B,space:"CAMPUS"}))
  test(`${key} eligibility guard refuses read and writes`,async()=>{const h=rig();h.context[key]=value;assert.equal(await h.client.refresh(),false);assert.equal(await h.client.plant(OBJECT),false);assert.equal(h.calls.length,0);});
test("saved layout revisions invalidate old visuals; recalled plant can return on new object ID",async()=>{
  const h=rig();h.snapshot=snap({plant:plant()});await h.client.refresh();assert.equal(h.client.visuals().length,1);
  h.context.revision=2;h.context.objects=[];h.client.sync();assert.deepEqual(h.client.visuals(),[]);
  h.snapshot=snap({layoutRevision:2,plant:plant({objectId:null,canCare:false})});await h.client.refresh();assert.equal(h.client.state().snapshot.plant.revision,1);
  const other={...object,id:id(8)};h.context.revision=3;h.context.objects=[other];h.snapshot=snap({layoutRevision:3,plant:plant({objectId:other.id})});await h.client.refresh();
  assert.equal(h.client.visuals()[0].objectId,other.id);assert.equal(await h.client.plant(other.id),false);
});
test("current ownership revocation immediately clears cached flower",async()=>{
  const h=rig();h.snapshot=snap({plant:plant()});await h.client.refresh();
  h.client.inventoryChanged({accountId:A,state:"READY",snapshot:{items:[]}});assert.deepEqual(h.client.visuals(),[]);assert.equal(await h.client.care(OBJECT),false);
});
test("definitive stale revision clears retry and demands fresh server state",async()=>{
  const h=rig();h.snapshot=snap({plant:plant()});await h.client.refresh();h.queue.push({error:{message:"PLANT_CONFLICT"}});
  assert.equal(await h.client.care(OBJECT),false);assert.equal(h.client.state().retry,null);assert.equal(h.client.state().ready,false);
});
test("strict parser rejects forged scope, times and contradictory growth",()=>{
  for(const raw of [snap({roomId:B}),snap({layoutRevision:-1}),snap({serverNow:"yesterday"}),snap({plant:plant({stage:"DEAD"})}),
    snap({plant:plant({stage:"BLOOM"})}),snap({plant:plant({nextStageAt:"2026-10-11T00:00:00Z"})}),snap({planterOwned:false,plant:plant()})])
    assert.equal(parseRoomPlantSnapshot(raw,context()),null);
});
test("SQL remains closed, bound to stable ownership with bounded immutable receipts and no economic writes",()=>{
  const sql=readFileSync(new URL("../../../supabase/migrations/20261012024000_world_room_plant_candidate.sql",import.meta.url),"utf8");
  assert.match(sql,/as \$\$ select false \$\$/);assert.match(sql,/unique\(user_id,plant_revision\)/);assert.match(sql,/primary key\(user_id,planter_item_id\)/);
  assert.match(sql,/clock_timestamp\(\)/);assert.match(sql,/PLANT_RECEIPT_APPEND_ONLY/);assert.match(sql,/room-planter-starter:/);
  assert.doesNotMatch(sql,/world_life_skill_xp_apply_v1|world_wallet_apply_v1|world_inventory_consume_v1|world_shop_listings/);
  const main=readFileSync(new URL("../src/main.js",import.meta.url),"utf8");assert.match(main,/onPlant: ROOM_PLANT_AVAILABLE \?/);assert.match(main,/roomPlantFeature\?\.reset\(\)/);
});
test('revocation during an owned read invalidates the stale reply; repeated absent inventory settles',async()=>{
  const h=rig();h.snapshot=snap({plant:plant()});await h.client.refresh();let finish;
  h.queue.push(new Promise(r=>{finish=r;}));const pending=h.client.refresh();
  const absent={accountId:A,state:'READY',snapshot:{items:[]}};h.client.inventoryChanged(absent);
  finish({data:snap({plant:plant()})});assert.equal(await pending,false);assert.deepEqual(h.client.visuals(),[]);
  h.snapshot=snap({planterOwned:false});h.client.inventoryChanged(absent);assert.equal(await h.client.refresh(),true);assert.equal(h.client.state().snapshot.planterOwned,false);
});

test("friend care uses opaque token, never owner revision or Inventory, and retries one request",async()=>{
  const h=rig();h.context.role="visitor";h.context.ownerUserId=B;h.context.sessionVersion=id(80);h.context.visitLease={sessionId:id(80),leaseId:id(81)};
  h.snapshot={roomId:ROOM,role:"visitor",layoutRevision:1,featureStatus:"ACTIVE",plants:[{objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"SPROUT",canCare:true,careToken:id(90)}]};
  await h.client.refresh();h.queue.push({error:{message:"lost reply"}});
  assert.equal(await h.client.care(OBJECT),false);const op=h.calls.at(-1);
  assert.deepEqual(op,{name:"care_visited_room_plant_v1",args:{p_room:ROOM,p_object:OBJECT,p_care_token:id(90),p_request_id:id(10),p_visit_session:id(80),p_visit_lease:id(81)}});
  h.snapshot.plants[0]={...h.snapshot.plants[0],canCare:false,careToken:null};
  h.queue.push({data:{status:"SUCCESS",userId:A,roomId:ROOM,objectId:OBJECT,requestId:id(10),action:"CARE",definitionVersion:1}});
  assert.equal(await h.client.retry(),true);assert.deepEqual(h.calls.at(-2),op);assert.equal(h.inventoryReads,0);assert.equal(h.ids,1);
  assert.equal(await h.client.care(OBJECT),false);assert.equal(await h.client.claim(),false);assert.equal(await h.client.plant(OBJECT),false);
});
test("friend care rejects stale A-B-A write result and server permission revocation",async()=>{
  const h=rig();h.context.role="visitor";h.context.ownerUserId=B;h.context.sessionVersion=id(80);h.context.visitLease={sessionId:id(80),leaseId:id(81)};
  h.snapshot={roomId:ROOM,role:"visitor",layoutRevision:1,featureStatus:"ACTIVE",plants:[{objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"SPROUT",canCare:true,careToken:id(90)}]};
  await h.client.refresh();let finish;h.queue.push(new Promise(r=>finish=r));const pending=h.client.care(OBJECT);
  h.context.sessionVersion=id(82);h.client.sync();h.context.sessionVersion=id(80);h.client.sync();
  finish({data:{status:"SUCCESS",userId:A,roomId:ROOM,objectId:OBJECT,requestId:id(10),action:"CARE",definitionVersion:1}});
  assert.equal(await pending,false);assert.equal(h.client.state().confirmed,null);assert.equal(h.client.state().snapshot,null);
  await h.client.refresh();h.queue.push({error:{message:"PLANT_ACCESS_DENIED"}});assert.equal(await h.client.care(OBJECT),false);
  assert.equal(h.client.state().retry,null);assert.equal(h.client.state().snapshot,null);
});
test("visitor care projection refuses contradictory or forged tokens",()=>{
  const ctx={...context(),role:"visitor",ownerUserId:B};
  for(const extra of [{canCare:true,careToken:null},{canCare:false,careToken:id(90)},{canCare:true,careToken:id(90),stage:"BLOOM"}]){
    assert.equal(parseRoomPlantSnapshot({roomId:ROOM,role:"visitor",layoutRevision:1,featureStatus:"ACTIVE",plants:[{objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"SPROUT",...extra}]},ctx),null);
  }
});

test("visitor lease replacement and L1-L2-L1 ABA discard old replies; owner scope ignores chat leases",async()=>{
 for(const aba of [false,true]){
  const h=rig();h.context.role="visitor";h.context.ownerUserId=B;h.context.sessionVersion=id(80);h.context.visitLease={sessionId:id(80),leaseId:id(81)};
  h.snapshot={roomId:ROOM,role:"visitor",layoutRevision:1,featureStatus:"ACTIVE",plants:[{objectId:OBJECT,plantId:ROOM_PLANT_ID,stage:"SPROUT",canCare:true,careToken:id(90)}]};
  await h.client.refresh();let finish;h.queue.push(new Promise(r=>finish=r));const pending=h.client.care(OBJECT);
  h.context.visitLease={sessionId:id(80),leaseId:id(82)};h.client.sync();
  if(aba){h.context.visitLease={sessionId:id(80),leaseId:id(81)};h.client.sync();}
  finish({data:{status:"SUCCESS",userId:A,roomId:ROOM,objectId:OBJECT,requestId:id(10),action:"CARE",definitionVersion:1}});
  assert.equal(await pending,false);assert.equal(h.client.state().confirmed,null);assert.equal(h.client.state().snapshot,null);
 }
 const h=rig();await h.client.refresh();const generation=h.client.state().generation;
 h.context.visitLease={sessionId:id(80),leaseId:id(81)};h.client.sync();assert.equal(h.client.state().generation,generation);
});

// Production RoomChat consumes the browser fixture contract too; keep nonce/admission exact.
test("browser fixture actual RoomChat issues an admission without a message and authorizes friend care",async()=>{
 const {createRoomChat}=await import('../src/rooms/room-chat.js');
 const {createPlantBackend,IDS}=await import('./browser/room-plant-backend.mjs');
 const backend=createPlantBackend(),object=id(88),session=id(89);
 const own=(name,args)=>backend.rpc(IDS.a,name,args);
 await own('claim_my_room_planter_v1',{p_room:IDS.roomA});
 await own('save_my_room_furniture_v1',{p_room:IDS.roomA,p_revision:0,p_objects:[{id:object,itemId:ROOM_PLANT_ITEM,surface:'floor',x:-6,z:0,yaw:0}]});
 await own('plant_my_room_plant_v1',{p_room:IDS.roomA,p_object:object,p_request_id:id(90)});
 const rpc={rpc:(name,args)=>backend.rpc(IDS.b,name,args),auth:{getSession:async()=>({data:{session:{user:{id:IDS.b,is_anonymous:false},access_token:'fixture'}}})},
  realtime:{setAuth:async()=>{}},channel:()=>({on(){return this;},subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return this;}}),removeChannel:async()=>{}};
 const chat=createRoomChat({getClient:()=>rpc,getIdentity:()=>({userId:IDS.b}),windowTarget:null});
 await chat.enter({kind:'personal',roomId:IDS.roomA,sessionId:session});
 for(let n=0;n<10&&!chat.canChat;n++)await new Promise(r=>setImmediate(r));
 const lease=chat.personalVisitLease(IDS.roomA);assert.ok(lease);assert.equal(lease.sessionId,session);
 const read=await backend.rpc(IDS.b,'get_world_room_plants_v1',{p_room:IDS.roomA});
 const result=await backend.rpc(IDS.b,'care_visited_room_plant_v1',{p_room:IDS.roomA,p_object:object,p_care_token:read.data.plants[0].careToken,p_request_id:id(91),p_visit_session:session,p_visit_lease:lease.leaseId});
 assert.equal(result.data.status,'SUCCESS');assert.equal(result.data.plantRevision,undefined);
 assert.equal(backend.snapshot().calls.some(c=>c.name==='send_world_room_chat_v1'),false);
 chat.stop();assert.equal(chat.personalVisitLease(IDS.roomA),null);
});
