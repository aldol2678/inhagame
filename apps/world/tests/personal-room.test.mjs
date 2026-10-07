import test from "node:test";
import assert from "node:assert/strict";
import { DORM_1_LOBBY, DORM_1_LOBBY_MY_ROOM, DORM_1_LOBBY_MY_ROOM_RETURN, DORM_1_LOBBY_OBSTACLES } from "../src/rooms/dorm1-lobby-layout.js";
import {
  PERSONAL_ROOM_BASIC,
  PERSONAL_ROOM_BASIC_EXIT,
  PERSONAL_ROOM_BASIC_OBSTACLES,
  PERSONAL_ROOM_BASIC_SPAWN,
  PERSONAL_ROOM_BASIC_BOUNDS,
  PERSONAL_ROOM_PLACEMENT_ENVELOPE
} from "../src/rooms/personal-room-layout.js";
import { PersonalRoomClient, PersonalRoomError, parsePersonalRoom } from "../src/rooms/personal-room-client.js";
import { createPersonalRoomInteraction } from "../src/rooms/personal-room-interaction.js";
import { createRoomTransition, ROOM_TRANSITION_COOLDOWN_MS } from "../src/rooms/room-transition.js";
import { ROOMS } from "../src/rooms/room-registry.js";
import { OrbitCameraController } from "../src/orbit-camera-controller.js";

const ROOM_A="11111111-1111-4111-8111-111111111111";
const USER_A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("personal room payload is narrow, typed and owner-bound",()=>{
  const room=parsePersonalRoom({
    roomId:ROOM_A,ownerUserId:USER_A,roomType:"DORM_1_BASIC",visibility:"friends",
    createdAt:"2026-09-27T00:00:00Z",updatedAt:"2026-09-27T00:00:00Z",extra:"drop"
  });
  assert.deepEqual(room,{
    roomId:ROOM_A,ownerUserId:USER_A,roomType:"DORM_1_BASIC",visibility:"friends",
    createdAt:"2026-09-27T00:00:00Z",updatedAt:"2026-09-27T00:00:00Z"
  });
  assert.equal(parsePersonalRoom({...room,roomType:"NOPE"}),null);
});

test("client provisions once, caches per account and never sends a user id",async()=>{
  let userId=USER_A,calls=0,lastArgs=null;
  const client={
    rpc:async(name,args)=>{
      calls++;lastArgs={name,args};
      return {data:{roomId:ROOM_A,ownerUserId:userId,roomType:"DORM_1_BASIC",visibility:"friends"},error:null};
    }
  };
  const rooms=new PersonalRoomClient({getClient:()=>client,getSelfUserId:()=>userId});
  const a=await rooms.ensure();
  const b=await rooms.ensure();
  assert.strictEqual(a,b);
  assert.equal(calls,1);
  assert.deepEqual(lastArgs,{name:"get_or_create_my_personal_room_v1",args:{}});
  userId=USER_B;
  const result=await rooms.ensure();
  assert.equal(result.ownerUserId,USER_B);
  assert.equal(calls,2);
});

test("signed-out and mismatched-owner responses fail closed",async()=>{
  const signedOut=new PersonalRoomClient({getClient:()=>null,getSelfUserId:()=>null});
  await assert.rejects(()=>signedOut.ensure(),e=>e instanceof PersonalRoomError&&e.code==="SIGNED_OUT");
  const client={rpc:async()=>({data:{roomId:ROOM_A,ownerUserId:USER_B,roomType:"DORM_1_BASIC",visibility:"friends"},error:null})};
  const mismatch=new PersonalRoomClient({getClient:()=>client,getSelfUserId:()=>USER_A});
  await assert.rejects(()=>mismatch.ensure(),e=>e.code==="FAILED");
});

test("late RPC response after account switch cannot restore the former account room",async()=>{
  let userId=USER_A,resolveOld;
  const oldResponse=new Promise(resolve=>{resolveOld=resolve;});
  const rpc={rpc:()=>oldResponse};
  const client=new PersonalRoomClient({getClient:()=>rpc,getSelfUserId:()=>userId});
  const pending=client.ensure();
  userId=USER_B;
  client.reset();
  resolveOld({data:{roomId:ROOM_A,ownerUserId:USER_A,roomType:"DORM_1_BASIC",visibility:"friends"},error:null});
  await assert.rejects(pending,error=>error.code==="SIGNED_OUT");
  assert.equal(client.cached,null);
  assert.equal(client.cachedUserId,null);
});

function rig(){
  const clock={t:0,now(){return this.t;}};
  const calls=[];
  const world={
    getPlaceZoneId:()=> "AREA_DORM_SOUTH",
    leaveCampus:r=>calls.push(["leaveCampus",r.id]),
    showRoom:r=>calls.push(["showRoom",r.id]),
    showCampus:r=>calls.push(["showCampus",r.id]),
    resumeCampus:()=>calls.push(["resumeCampus"]),
    placePlayer:(position,yaw)=>calls.push(["placePlayer",{...position},yaw])
  };
  const rooms=createRoomTransition({world,clock});
  return {clock,calls,rooms};
}

test("nested room transition returns to the dorm lobby without resuming campus presence",()=>{
  const {clock,calls,rooms}=rig();
  assert.ok(rooms.enter("ROOM_DORM1_LOBBY",{entranceId:"DORM_1_ENTRANCE"}));
  clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
  assert.ok(rooms.enterNested("ROOM_PERSONAL_BASIC",{
    fromRoomId:"ROOM_DORM1_LOBBY",
    returnPosition:DORM_1_LOBBY_MY_ROOM_RETURN.position,
    returnYaw:DORM_1_LOBBY_MY_ROOM_RETURN.yaw,
    metadata:{personalRoomId:ROOM_A}
  }));
  assert.equal(rooms.currentSpace,"ROOM_PERSONAL_BASIC");
  assert.equal(rooms.status().parentRoomId,"ROOM_DORM1_LOBBY");
  assert.equal(rooms.status().metadata.personalRoomId,ROOM_A);
  assert.deepEqual(calls.slice(-2).map(x=>x[0]),["showRoom","placePlayer"]);
  assert.equal(calls.some(x=>x[0]==="resumeCampus"),false);

  clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
  const exit=rooms.contextAction({position:PERSONAL_ROOM_BASIC_EXIT.position,grounded:true,mounted:false});
  assert.equal(exit.label,"생활관 로비로 나가기");
  assert.ok(exit.trigger());
  assert.equal(rooms.currentSpace,"ROOM_DORM1_LOBBY");
  assert.deepEqual(calls.at(-1),["placePlayer",{...DORM_1_LOBBY_MY_ROOM_RETURN.position},DORM_1_LOBBY_MY_ROOM_RETURN.yaw]);
  assert.equal(calls.some(x=>x[0]==="resumeCampus"),false);
});

test("nested room camera uses the personal room walls and restores the campus camera",()=>{
  let cameraPosition;
  const orbit=Object.create(OrbitCameraController.prototype);
  orbit.camera={setPosition:(x,y,z)=>{cameraPosition={x,y,z};},lookAt:()=>{}};
  orbit.distance=3.5;
  orbit.pitch=0.35;
  orbit.yaw=0;
  orbit.mounted=false;
  orbit.firstPerson=false;
  orbit.target={x:0,y:0,z:0};
  orbit.indoor=null;

  orbit.setIndoor({limits:DORM_1_LOBBY.camera,obstacles:DORM_1_LOBBY_OBSTACLES});
  const campusSnapshot=orbit.indoor.saved;
  orbit.setIndoor({limits:PERSONAL_ROOM_BASIC.camera,obstacles:PERSONAL_ROOM_BASIC_OBSTACLES});
  assert.strictEqual(orbit.indoor.obstacles,PERSONAL_ROOM_BASIC_OBSTACLES);
  assert.strictEqual(orbit.indoor.limits,PERSONAL_ROOM_BASIC.camera);
  assert.strictEqual(orbit.indoor.saved,campusSnapshot);
  orbit.apply(PERSONAL_ROOM_BASIC_SPAWN.position,0.35);
  // The room root mirrors z into world space; the camera must stay in front of the south wall.
  assert.ok(cameraPosition.z<PERSONAL_ROOM_BASIC.halfDepth-0.35,`camera behind room wall: ${cameraPosition.z}`);

  orbit.setIndoor({limits:DORM_1_LOBBY.camera,obstacles:DORM_1_LOBBY_OBSTACLES});
  assert.strictEqual(orbit.indoor.obstacles,DORM_1_LOBBY_OBSTACLES);
  orbit.setIndoor(null);
  assert.equal(orbit.indoor,null);
  assert.equal(orbit.distance,campusSnapshot.distance);
  assert.equal(orbit.pitch,campusSnapshot.pitch);
});

test("ten campus, lobby and personal room cycles retain one transition listener and safe anchors",()=>{
  const {clock,calls,rooms}=rig();
  let events=0;
  const off=rooms.onChange(()=>events++);
  for(let i=0;i<10;i++){
    assert.ok(rooms.enter("ROOM_DORM1_LOBBY",{entranceId:"DORM_1_ENTRANCE"}));
    clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
    assert.ok(rooms.enterNested("ROOM_PERSONAL_BASIC",{
      fromRoomId:"ROOM_DORM1_LOBBY",returnPosition:DORM_1_LOBBY_MY_ROOM_RETURN.position,
      returnYaw:DORM_1_LOBBY_MY_ROOM_RETURN.yaw,metadata:{personalRoomId:ROOM_A}
    }));
    clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
    assert.ok(rooms.exit());
    assert.equal(rooms.currentSpace,"ROOM_DORM1_LOBBY");
    clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
    assert.ok(rooms.exit());
    assert.equal(rooms.currentSpace,"campus");
    clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
  }
  assert.equal(events,40);
  assert.equal(calls.filter(([kind])=>kind==="resumeCampus").length,10);
  off();
  assert.equal(rooms.status().metadata,null);
});

test("personal room interaction resolves authority before entering",async()=>{
  const {clock,rooms}=rig();
  assert.ok(rooms.enter("ROOM_DORM1_LOBBY",{entranceId:"DORM_1_ENTRANCE"}));
  clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
  let ensureCalls=0;
  const client={generation:0,getSelfUserId:()=>USER_A,ensure:async()=>{ensureCalls++;return {roomId:ROOM_A,ownerUserId:USER_A,roomType:"DORM_1_BASIC",visibility:"friends"};}};
  const messages=[];
  const interaction=createPersonalRoomInteraction({client,rooms,onStatus:m=>messages.push(m)});
  const action=interaction.contextAction({position:DORM_1_LOBBY_MY_ROOM.position,grounded:true,mounted:false});
  assert.equal(action.label,"내 방 들어가기");
  assert.equal(action.trigger(),true);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ensureCalls,1);
  assert.equal(rooms.currentSpace,"ROOM_PERSONAL_BASIC");
  assert.deepEqual(messages,[]);
});

test("guest personal-room attempt stays in the lobby and receives a truthful message",async()=>{
  const {clock,rooms}=rig();
  assert.ok(rooms.enter("ROOM_DORM1_LOBBY",{entranceId:"DORM_1_ENTRANCE"}));
  clock.t+=ROOM_TRANSITION_COOLDOWN_MS+1;
  const client={ensure:async()=>{throw new PersonalRoomError("SIGNED_OUT");}};
  const messages=[];
  const interaction=createPersonalRoomInteraction({client,rooms,onStatus:m=>messages.push(m)});
  interaction.contextAction({position:DORM_1_LOBBY_MY_ROOM.position})?.trigger();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(rooms.currentSpace,"ROOM_DORM1_LOBBY");
  assert.match(messages.at(-1),/로그인/);
});

test("C70 shell reaches the approved 1.70 prototype ratio without widening H2 saved-placement authority",()=>{
  assert.equal(PERSONAL_ROOM_BASIC.aspectRatio,1.70);
  assert.ok(Math.abs(PERSONAL_ROOM_BASIC.halfWidth/PERSONAL_ROOM_BASIC.halfDepth-1.70)<1e-12);
  assert.equal(PERSONAL_ROOM_PLACEMENT_ENVELOPE.floor.maxX,5.3);
  assert.equal(PERSONAL_ROOM_PLACEMENT_ENVELOPE.wall.eastX,5.35);
  assert.ok(PERSONAL_ROOM_PLACEMENT_ENVELOPE.floor.maxX<PERSONAL_ROOM_BASIC.halfWidth);
  assert.ok(PERSONAL_ROOM_BASIC_BOUNDS.maxX>5.3,"walkable shell expands before persisted furniture authority");
});

test("DORM_1_BASIC template is human-scale, local-only and static in D1.3",()=>{
  const room=ROOMS.ROOM_PERSONAL_BASIC;
  assert.equal(room.type,"personal");
  assert.equal(room.entranceId,null);
  assert.equal(room.locationLabel,"🏠 제1생활관 · 내 방");
  assert.ok(PERSONAL_ROOM_BASIC.halfWidth>=5);
  assert.ok(PERSONAL_ROOM_BASIC.ceiling>=2);
  assert.ok(PERSONAL_ROOM_BASIC.camera.max>=4);
  assert.deepEqual(room.spawn,PERSONAL_ROOM_BASIC_SPAWN);
  assert.deepEqual(room.obstacles,PERSONAL_ROOM_BASIC_OBSTACLES);
});
