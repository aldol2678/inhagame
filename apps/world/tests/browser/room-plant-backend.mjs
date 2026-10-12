// Test-only in-memory server clock and saved-layout authority. SQL authority is tested separately.
import {randomUUID} from 'node:crypto';
import {validateFurniture} from '../../src/rooms/furniture-layout.js';
export const IDS={a:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',roomA:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',roomB:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
export const HOURS20=20*60*60*1000;
export function createPlantBackend(){
 let now=Date.parse('2026-10-12T00:00:00Z'),loseCare=false,allowVisitor=true;
 const rooms=new Map([[IDS.roomA,{owner:IDS.a,revision:0,objects:[]}],[IDS.roomB,{owner:IDS.b,revision:0,objects:[]}]]);
 const owned=new Set(),plants=new Map(),receipts=new Map(),leases=new Map(),calls=[],held=[];let hold=false;
 const copy=x=>structuredClone(x),fail=message=>({error:{message}}),ok=data=>({data:copy(data)});
 const inventory=actor=>({items:owned.has(actor)?[{itemId:'furniture.indoor_planter',quantity:1}]:[]});
 const growth=p=>!p?null:{stage:p.second!==null&&now>=p.second+HOURS20?'BLOOM':p.second!==null||(p.first!==null&&now>=p.first+HOURS20)?'BUD':'SPROUT',nextStageAt:p.second!==null&&now<p.second+HOURS20?new Date(p.second+HOURS20).toISOString():p.second===null&&p.first!==null&&now<p.first+HOURS20?new Date(p.first+HOURS20).toISOString():null,canCare:p.first===null||(p.second===null&&now>=p.first+HOURS20)};
 const layout=(r,id,actor)=>({roomId:id,role:r.owner===actor?'owner':'visitor',revision:r.revision,objects:r.objects});
 async function rpc(actor,name,args){
  calls.push({actor,name,args:copy(args)});
  if(name==='fixture_inventory')return ok(inventory(actor));
  const leaseJSON=l=>({version:1,allowed:true,leaseId:l.id,kind:'personal',roomId:l.room,userId:actor,sessionId:l.session,admissionId:null,inboxNonce:l.nonce,topic:'world:room-chat:'+l.id,ttlMs:30000});
  if(name==='join_world_room_chat_v1'){
   const room=rooms.get(args.p_room);if(!room||(!allowVisitor&&actor!==room.owner))return ok({allowed:false});
   const l={id:randomUUID(),nonce:randomUUID(),room:args.p_room,session:args.p_session,expires:now+30000};leases.set(actor,l);return ok(leaseJSON(l));
  }
  if(name==='renew_world_room_chat_v1'){const l=leases.get(actor);if(!l||l.id!==args.p_lease||l.expires<=now||(!allowVisitor&&actor!==rooms.get(l.room).owner))return ok({allowed:false});l.expires=now+30000;l.nonce=randomUUID();return ok(leaseJSON(l));}
  if(name==='leave_world_room_chat_v1'){const l=leases.get(actor);return ok(l?.id===args.p_lease?leases.delete(actor):false);}

  const r=rooms.get(args.p_room);if(!r)return fail('PLANT_ACCESS_DENIED');
  const owner=r.owner===actor;if(!owner&&!allowVisitor)return fail(name.includes('furniture')?'LAYOUT_DENIED':'PLANT_ACCESS_DENIED');
  if(name==='get_world_room_furniture_v1')return ok(layout(r,args.p_room,actor));
  if(name==='save_my_room_furniture_v1'){
   if(!owner)return fail('LAYOUT_DENIED');if(args.p_revision!==r.revision)return fail('LAYOUT_CONFLICT');
   const error=validateFurniture(args.p_objects,inventory(actor).items);if(error)return fail(error);
   r.objects=copy(args.p_objects);r.revision++;return ok(layout(r,args.p_room,actor));
  }
  if(name==='get_world_room_plants_v1'){
   const p=owned.has(r.owner)?plants.get(r.owner):null,obj=r.objects.find(o=>o.itemId==='furniture.indoor_planter'),g=growth(p);
   const base={roomId:args.p_room,role:owner?'owner':'visitor',layoutRevision:r.revision,featureStatus:'ACTIVE'};
   const data=owner?{...base,serverNow:new Date(now).toISOString(),planterOwned:owned.has(actor),plant:p?{objectId:obj?.id??null,plantId:'plant.room_flower',revision:p.revision,...g,canCare:g.canCare&&!!obj}:null}
    :{...base,plants:p&&obj?[{objectId:obj.id,plantId:'plant.room_flower',stage:g.stage,canCare:g.canCare,careToken:g.canCare?p.token:null}]:[]};
   const response=ok(data);if(hold){hold=false;return new Promise(resolve=>held.push(()=>resolve(response)));}return response;
  }
  const visiting=name==='care_visited_room_plant_v1';
  if(!owner&&!visiting)return fail('PLANT_ACCESS_DENIED');
  if(visiting){const l=leases.get(actor);if(owner||!l||l.id!==args.p_visit_lease||l.session!==args.p_visit_session||l.room!==args.p_room||l.expires<=now)return fail('PLANT_ACCESS_DENIED');}
  if(name==='claim_my_room_planter_v1'){const repeated=owned.has(actor);owned.add(actor);return ok({status:'SUCCESS',userId:actor,roomId:args.p_room,itemId:'furniture.indoor_planter',inventory:{status:repeated?'ALREADY_PROCESSED':'GRANTED',userId:actor,itemId:'furniture.indoor_planter'}});}
  const action=name==='plant_my_room_plant_v1'?'PLANT':(name==='care_my_room_plant_v1'||visiting)?'CARE':null;if(!action)throw Error(`Unexpected fixture RPC ${name}`);
  const key=`${actor}:${args.p_request_id}`,binding=JSON.stringify([args.p_room,args.p_object,action,args.p_revision??0,args.p_care_token??null,args.p_visit_session??null,args.p_visit_lease??null]);
  if(visiting&&(!owned.has(r.owner)||!r.objects.some(o=>o.id===args.p_object&&o.itemId==='furniture.indoor_planter')))return fail('PLANTER_REQUIRED');
  if(receipts.has(key)){const old=receipts.get(key);return old.binding===binding?ok(old.data):fail('IDEMPOTENCY_CONFLICT');}
  if(!owned.has(r.owner)||!r.objects.some(o=>o.id===args.p_object&&o.itemId==='furniture.indoor_planter'))return fail('PLANTER_REQUIRED');
  let p=plants.get(r.owner);
  if(action==='PLANT'){if(p)return fail('PLANT_ALREADY_PLANTED');p={first:null,second:null,revision:1,token:randomUUID()};plants.set(r.owner,p);}
  else{if(!p)return fail('PLANT_REQUIRED');if(visiting?p.token!==args.p_care_token:p.revision!==args.p_revision)return fail('PLANT_CONFLICT');if(!growth(p).canCare)return fail('PLANT_NOT_READY');if(p.first===null)p.first=now;else p.second=now;p.revision++;p.token=randomUUID();}
  const data={status:'SUCCESS',userId:actor,roomId:args.p_room,objectId:args.p_object,requestId:args.p_request_id,action,...(visiting?{}:{plantRevision:p.revision}),definitionVersion:1};receipts.set(key,{binding,data});
  if(action==='CARE'&&loseCare){loseCare=false;return fail('fixture response lost after commit');}return ok(data);
 }
 return{rpc,advance:ms=>{if(ms<0)throw Error('server clock cannot regress');now+=ms;},loseNextCare:()=>{loseCare=true;},holdNextRead:()=>{hold=true;},release:()=>{if(!held.length)throw Error('no held read');held.shift()();},denyVisitor:()=>{allowVisitor=false;},revoke:actor=>owned.delete(actor),snapshot:()=>copy({serverNow:new Date(now).toISOString(),rooms:[...rooms],owned:[...owned],plants:[...plants],receipts:[...receipts],calls,held:held.length})};
}
