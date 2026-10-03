import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMcm2026EventClient } from "../src/events/zombie-university-2026/event-client.js";
import { MCM_2026_EVENT_ID, MCM_2026_PROGRESS_STAGE } from "../src/events/zombie-university-2026/event-data.js";
import { MCM_2026_ROOM_ID } from "../src/events/zombie-university-2026/minigame-room-layout.js";
import { ROOMS, ROOM_ENTRANCES } from "../src/rooms/room-registry.js";
import { createRoomTransition } from "../src/rooms/room-transition.js";
import { BACK_GATE_SPAWN, campusSpawn } from "../src/campus-spawn.js";
import { isMcm2026PreviewRequest } from "../src/events/zombie-university-2026/event-route.js";
import { resolveWorldStartupConfig } from "../src/startup/startup-config.js";


test("production review URL enables isolated MCM preview and starts at the back gate", async () => {
  const locationLike={hostname:"inhagame.example",search:"?event=zombie-university-2026"};
  assert.equal(isMcm2026PreviewRequest(locationLike),true);
  assert.deepEqual(campusSpawn(locationLike),BACK_GATE_SPAWN);
  assert.equal(isMcm2026PreviewRequest({hostname:"example.com",search:locationLike.search}),false,
    "arbitrary hosts cannot opt into the QA preview");

  assert.equal(resolveWorldStartupConfig(locationLike).mcmEventPreviewMode, true);
});

test("MCM preview walks the full content path without server authority or rewards", async () => {
  let fetchCalls=0,rpcCalls=0,now=Date.parse("2026-09-30T18:10:00+09:00");
  const client=createMcm2026EventClient({
    preview:true,
    clock:{now:()=>now},
    fetcher:async()=>{fetchCalls+=1;throw Error("preview must not fetch");},
    getClient:()=>({rpc(){rpcCalls+=1;throw Error("preview must not rpc");}}),
    randomBytes:()=>Uint8Array.of(2)
  });
  await client.setSignedIn(true);
  assert.equal(client.state.eventId,MCM_2026_EVENT_ID);
  assert.equal((await client.advance("start")).progress.stage,MCM_2026_PROGRESS_STAGE.STARTED);
  for(const action of ["investigate_dancing","investigate_hungry","investigate_staggering"])await client.advance(action);
  assert.equal(client.state.progress.stage,MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED);
  const run=await client.startRun();
  assert.equal(run.actorIds.length,5);
  assert.equal("survivorId" in run,false,"preview public run also keeps its secret private");
  let clear=null;
  for(const actorId of run.actorIds){
    clear=await client.submitRun(run.runId,actorId);
    if(clear.status==="CLEARED")break;
  }
  assert.equal(clear.status,"CLEARED");
  assert.equal(client.state.progress.stage,MCM_2026_PROGRESS_STAGE.COMPLETED);
  assert.equal((await client.claimLandlord()).status,"PREVIEW");
  assert.equal((await client.claimMain()).status,"PREVIEW");
  assert.deepEqual([fetchCalls,rpcCalls],[0,0],"preview never mutates server state");
});

test("live MCM client uses trusted progress endpoint and zero-argument value RPCs", async () => {
  const calls=[];
  let state={eventId:MCM_2026_EVENT_ID,eventState:"ACTIVE",serverNow:"2026-09-30T09:10:00Z",
    progress:{stage:"NOT_STARTED",investigated:[],startedAt:null,venueUnlockedAt:null,completedAt:null},
    landlord:{firstClearedAt:null,activeRun:null}};
  const rpc=async(name,args)=>{
    calls.push(["rpc",name,args]);
    if(name==="get_my_mcm_2026_event_v1")return {data:state,error:null};
    if(name==="start_mcm_landlord_run_v1")return {data:{runId:"11111111-1111-4111-8111-111111111111",status:"ACTIVE",serverNow:state.serverNow,deadlineAt:"2026-09-30T09:10:45Z",wrongCount:0,actorIds:["ZUE-MG-001","ZUE-MG-002","ZUE-MG-003","ZUE-MG-004","ZUE-MG-005"]},error:null};
    if(name==="submit_mcm_landlord_choice_v1")return {data:{runId:args.p_run_id,status:"FAILED",correct:false,serverNow:state.serverNow,deadlineAt:"2026-09-30T09:10:05Z",wrongCount:9},error:null};
    if(name.startsWith("claim_my_mcm_"))return {data:{status:"ALREADY_CLAIMED",rewardStatus:"SUCCESS",rewardResult:{entries:[]}},error:null};
    throw Error(name);
  };
  const client=createMcm2026EventClient({
    getClient:()=>({rpc}),
    getSessionToken:async()=>"jwt",
    fetcher:async(_url,options)=>{
      const body=JSON.parse(options.body);calls.push(["fetch",body]);
      state={...state,progress:{...state.progress,stage:"STARTED",startedAt:state.serverNow}};
      return {ok:true,json:async()=>state};
    },
    clock:{now:()=>Date.parse("2026-09-30T09:10:00Z")}
  });
  await client.setSignedIn(true);
  assert.equal((await client.advance("start")).progress.stage,"STARTED");
  assert.deepEqual(calls.find(call=>call[0]==="fetch")[1],{quest_id:MCM_2026_EVENT_ID,event:"start"});
  const run=await client.startRun();
  assert.equal("survivorId" in run,false);
  await client.submitRun(run.runId,"ZUE-MG-001");
  await client.claimMain();
  await client.claimLandlord();
  const claims=calls.filter(call=>call[0]==="rpc"&&call[1].startsWith("claim_my_mcm_"));
  assert.ok(claims.every(call=>Object.keys(call[2]).length===0),"claimant cannot choose reward payload");
});

test("MCM event room is registered on the current room authority", () => {
  assert.ok(ROOMS[MCM_2026_ROOM_ID]);
  assert.ok(ROOM_ENTRANCES.some(entry=>entry.roomId===MCM_2026_ROOM_ID));
  assert.equal(ROOMS[MCM_2026_ROOM_ID].type,"event");
});

test("event-room entry obeys the server-projected canEnter gate", () => {
  const entrance=ROOM_ENTRANCES.find(entry=>entry.roomId===MCM_2026_ROOM_ID);
  const world={getPlaceZoneId:()=>null,leaveCampus(){},showRoom(){},showCampus(){},resumeCampus(){},placePlayer(){}};
  const denied=createRoomTransition({world,canEnter:()=>false,clock:{now:()=>1000}});
  assert.equal(denied.enter(MCM_2026_ROOM_ID),false);
  assert.equal(denied.contextAction({position:entrance.position,grounded:true,mounted:false}),null);
  const allowed=createRoomTransition({world,canEnter:()=>true,clock:{now:()=>1000}});
  assert.equal(allowed.enter(MCM_2026_ROOM_ID),true);
});

test("MCM investigation actors render as zombies while the guide remains human", async () => {
  const avatar=await readFile(new URL("../npc-factory/dev-human-avatar.mjs",import.meta.url),"utf8");
  const runtime=await readFile(new URL("../src/events/zombie-university-2026/event-runtime.js",import.meta.url),"utf8");
  assert.match(avatar,/appearance\.skin_color_override \?\?/,"shared human renderer honors event skin overrides");
  assert.match(avatar,/appearance\.eye_color_override \?\?/);
  assert.match(avatar,/appearance\.face_mark_color/);
  assert.match(runtime,/name:"비틀거리는 좀비"/);
  assert.match(runtime,/name:"춤추는 좀비"/);
  assert.match(runtime,/name:"배고픈 좀비"/);
  assert.match(runtime,/function applyZombiePose/);
  assert.match(runtime,/GUIDE\]:\{height:1,presentation:"female",skin_tone:1/,"survivor guide keeps normal skin");
});

test("ported content drops legacy client reward/completion authority", async () => {
  const paths=[
    "../src/events/zombie-university-2026/event-client.js",
    "../src/events/zombie-university-2026/event-runtime.js",
    "../src/events/zombie-university-2026/event-ui.js",
    "../src/events/zombie-university-2026/minigame-room-runtime.js",
    "../src/main.js"
  ];
  const text=(await Promise.all(paths.map(path=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n");
  assert.doesNotMatch(text,/zombie2026_survivor_bandage/);
  assert.doesNotMatch(text,/save_my_game_progress/);
  assert.doesNotMatch(text,/grantZombieReward|equipZombieReward/);
  const game=await readFile(new URL("../src/events/zombie-university-2026/minigame-room-runtime.js",import.meta.url),"utf8");
  assert.doesNotMatch(game,/run\s*%\s*5/);
  assert.doesNotMatch(game,/survivorId/,"live room never knows the server survivor");
  assert.doesNotMatch(game,/Date\.now\(/,"live room timer projects the server deadline instead of judging locally");
});
