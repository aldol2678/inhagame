import { createVehicleSeats } from "../src/mobility/vehicle-seats.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlayerController, findHelicopterSummonPose } from "../src/player-controller.js";
import { CAMPUS_KART_ID, getCampusKartParkedPose, parkCampusKartAt } from "../src/mounts/campus-kart-world.js";
import { CAMPUS_HELICOPTER_PAD, getCampusHelicopterParkedPose } from "../src/mounts/campus-helicopter-world.js";
import { getMobilityByMountId, getPlayerVisibleMobility, MOBILITY_REGISTRY, mobilityMatchesFilter, mobilityMatchesQuery } from "../src/mobility/mobility-registry.js";
import { findGroundSummonPose, findNearbyGroundSummonPose } from "../src/mobility/ground-summon.js";
import { stepLightCar, CAR_LIGHT_PROFILE } from "../src/mounts/ground-mount-motion.js";
import { wireMountFor, remoteMountState } from "../src/mounts/mount-kinds.js";
import { Anim, Mount, encodePose, validatePose } from "../src/network/protocol.js";
const definition = getMobilityByMountId(CAMPUS_KART_ID);
const base = () => ({ definition, origin:{x:0,y:1.15,z:0}, yawDeg:0, spaceId:"campus",
  mounted:false, grounded:true, allowMount:true, groundHeight:()=>0, overWater:()=>false,
  canOccupyAt:()=>true, bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20}, groundY:1.15 });
function controllerAt(p={x:-1000,y:1.15,z:-1000}) {
  const nodes=new Map(["run","jump","descend"].map(k=>[k,{hidden:false,disabled:false,setAttribute(){}}]));
  globalThis.window={addEventListener(){}};
  globalThis.document={body:{dataset:{}},getElementById:id=>nodes.get(id)??null};
  let yaw=0;
  const c=new PlayerController({ getLocalPosition:()=>({...p}),setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}),
    getLocalEulerAngles:()=>({y:yaw}),setLocalEulerAngles:(_,y)=>{yaw=y;} });
  c.setMovementSpace({id:"campus",allowMount:true,bounds:{minX:-2000,maxX:2000,minZ:-2000,maxZ:2000},obstacles:[],
    groundHeight:()=>0,constrain:(_p,next)=>next});
  return {c,p,nodes};
}
test("kart registry is test-only, searchable, ground-only and never grants ownership",()=>{
  assert.equal(definition.availability,"EXPERIMENTAL");
  assert.equal(definition.access,"TEST_ONLY"); assert.equal(definition.activeEligible,false);
  assert.equal(definition.physicsProfile,"CAR_LIGHT"); assert.equal(definition.inputProfile,"CAR");
  assert.equal(definition.summonUX,"NEARBY"); assert.equal(definition.primaryLabel,"카트 호출");
  assert.equal(definition.seats.length,4); assert.equal(definition.seats.filter(s=>s.controls).length,1);
  assert.ok(mobilityMatchesQuery(definition,"카트")); assert.ok(mobilityMatchesFilter(definition,"GROUND"));
  assert.equal(mobilityMatchesFilter(definition,"AIR"),false);
  assert.ok(getPlayerVisibleMobility().includes(definition));
  assert.ok(getPlayerVisibleMobility().every(d=>d.availability!=="HIDDEN"));
  assert.ok(MOBILITY_REGISTRY.filter(d=>d.availability==="COMING_SOON").every(d=>!d.summonEnabled));
  for(const d of MOBILITY_REGISTRY.filter(d=>/bicycle|helicopter/.test(d.mobilityId))) {
    assert.equal(d.access,"TEST_ONLY"); assert.equal(d.availability,"EXPERIMENTAL"); assert.equal(d.activeEligible,false);
  }
  assert.equal(MOBILITY_REGISTRY.find(d=>d.category==="CREATURE").access,"EVENT");
});
test("safe summon validates volume and finds an alternative clear ground candidate",()=>{
  const args=base(); let calls=0;
  args.canOccupyAt=(p,shape)=>{assert.equal(shape.radius,1.7);assert.equal(shape.headOffset,1.35);return ++calls>1;};
  const pose=findGroundSummonPose(args); assert.ok(pose);assert.equal(pose.y,0);assert.equal(calls,2);
});
test("NEARBY kart search expands beyond the old local rings and reports distance",()=>{
  const args=base();args.bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};
  args.canOccupyAt=(p)=>Math.hypot(p.x,p.z)>=11;
  const pose=findNearbyGroundSummonPose(args);
  assert.ok(pose);assert.ok(pose.distance>=12.5);assert.ok(pose.distance<=25);
});
test("controller NEARBY call places the kart without mounting and records placement",()=>{
  const {c}=controllerAt();assert.ok(c.summonKartNearby());assert.equal(c.mounted,false);
  assert.equal(c.lastSummonPlacement.mountId,CAMPUS_KART_ID);
  assert.equal(c.lastSummonPlacement.mode,"NEARBY");assert.ok(c.lastSummonPlacement.distance>0);
});
test("summon fails closed for room, water, ceiling/wall, bad bounds, mounted, roof and missing authority",()=>{
  for(const change of [{spaceId:"room"},{mounted:true},{grounded:false},{allowMount:false},
    {overWater:()=>true},{canOccupyAt:()=>false},{groundHeight:()=>NaN},
    {bounds:{minX:0,maxX:0.5,minZ:0,maxZ:0.5}},{origin:{x:0,y:6,z:0}},
    {overWater:undefined},{definition:{...definition,summonEnabled:false}},
    {definition:{...definition,spawnDomain:"WATER_SURFACE"}}]) {
    assert.equal(findGroundSummonPose({...base(),...change}),null);
  }
});
test("water touching any sampled footprint refuses even when centre is dry",()=>{
  let centres=0;
  assert.equal(findGroundSummonPose({...base(),overWater:(x,z)=>{
    if(x===0&&z===0)return false; return ++centres%2===0;
  }}),null);
});
test("motor acceleration, speed cap, braking, turn rate and invalid delta",()=>{
  const profile=CAR_LIGHT_PROFILE;
  let state={speed:0,yaw:0};
  state=stepLightCar(state,{z:1},0.1,profile);assert.equal(state.speed,0.8);
  for(let i=0;i<20;i++)state=stepLightCar(state,{z:1},0.1,profile);
  assert.equal(state.speed,10);
  const turn=stepLightCar(state,{x:1},0.1,profile);assert.equal(turn.yaw,8);
  for(let i=0;i<10;i++)state=stepLightCar(state,{},0.1,profile);
  assert.equal(state.speed,0);assert.deepEqual(stepLightCar(state,{},NaN,profile),state);
});
test("summon does not mount; M boards, jump is suppressed, ground movement and dismount work",()=>{
  const {c,p,nodes}=controllerAt();assert.ok(c.summonKartNearPlayer());assert.equal(c.mounted,false);
  const a=getCampusKartParkedPose();Object.assign(p,{x:a.x,y:a.y+1.15,z:a.z});
  assert.equal(c.transportAction(),true);assert.equal(c.onKart,true);assert.equal(c.onBike,false);
  assert.equal(nodes.get("jump").hidden,true);assert.equal(nodes.get("descend").hidden,true);
  assert.equal(c.summonKartNearPlayer(),false);
  c.keys.add("KeyW");c.keys.add("Space");c.jumpQueued=true;
  const start={...p};for(let i=0;i<10;i++)c.update(.05,0);
  assert.equal(p.y,1.15);assert.ok(p.z>start.z);assert.equal(c.grounded,true);
  assert.equal(c.transportAction(),true);assert.equal(c.mounted,false);assert.equal(c.mountId,null);
  assert.equal(nodes.get("jump").hidden,false);
  assert.equal(getCampusKartParkedPose().z,p.z);
});
test("seat access refuses distant/disabled/indoor riders and transport focus gate",()=>{
  const {c,p}=controllerAt();parkCampusKartAt({x:p.x,y:0,z:p.z,yaw:0});
  c.setTransportGate(()=>false);assert.equal(c.transportAction(),false);
  c.setInputEnabled(false);assert.equal(c.boardKart(),false);assert.equal(c.summonKartNearPlayer(),false);
  c.setInputEnabled(true);c.space.id="room";assert.equal(c.boardKart(),false);
  c.space.id="campus";p.x+=100;assert.equal(c.boardKart(),false);
});
test("kart wire round trip is distinct; existing bike/dragon/helicopter remain stable",()=>{
  for(const [id,wire] of [[CAMPUS_KART_ID,Mount.KART],["mount.campus_bike.default",Mount.BIKE],
    ["annyongi",Mount.DRAGON],["mount.campus_helicopter.prototype",Mount.HELICOPTER]]) {
    const mount=wireMountFor({mounted:true,mountId:id});assert.equal(mount,wire);
    const packet=encodePose(1,{x:0,y:1,z:0,yaw:0,anim:Anim.FLY,mount});
    assert.equal(validatePose(packet).ok,true);
    assert.equal(remoteMountState(packet).mountId,id);
  }
  assert.equal(remoteMountState({anim:Anim.WALK,mount:Mount.KART}).mounted,false);
});
test("helicopter boarding, flight integration, dismount and summon refusal regressions",()=>{
  const a=getCampusHelicopterParkedPose();const {c,p}=controllerAt({x:a.x,y:a.y+1.15,z:a.z});
  assert.ok(c.boardHelicopter());assert.equal(c.onHelicopter,true);assert.equal(c.onGroundMount,false);
  c.keys.add("Space");c.update(.05,0);assert.ok(Number.isFinite(p.y));c.keys.clear();
  c.grounded=true;assert.ok(c.dismountHelicopter());assert.equal(c.mountId,null);
  assert.equal(findHelicopterSummonPose({origin:{x:0,z:0},overWater:()=>true}),null);
});
test("helicopter PAD UX falls back to the stadium when every nearby candidate is blocked",()=>{
  const {c,p}=controllerAt({x:-1000,y:1.15,z:-1000});
  c.space.obstacles=[{minX:p.x-100,maxX:p.x+100,minZ:p.z-100,maxZ:p.z+100,minY:0,maxY:20}];
  assert.ok(c.summonHelicopterWithPadFallback());
  const a=getCampusHelicopterParkedPose();
  assert.equal(a.x,CAMPUS_HELICOPTER_PAD.x);assert.equal(a.z,CAMPUS_HELICOPTER_PAD.z);
  assert.equal(c.lastSummonPlacement.mode,"PAD");assert.equal(c.lastSummonPlacement.label,"대운동장");
});
test("mobile layout authority is unchanged and remains last",()=>{
  const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
  assert.equal(css.split("/* LANDSCAPE-HUD:start").length-1,1);
  assert.equal(css.split("/* LANDSCAPE-HUD:end */").length-1,1);
  assert.equal(css.split("/* LANDSCAPE-HUD:end */")[1].trim(),"");
});
test("kart assisted steering is world-space; wall collision stops the full clearance volume",()=>{
  const {c,p}=controllerAt();
  parkCampusKartAt({x:p.x,y:0,z:p.z,yaw:0});assert.ok(c.boardKart());
  c.space.obstacles=[{minX:p.x-10,maxX:p.x+10,minZ:p.z+2,maxZ:p.z+3,minY:0,maxY:5}];
  const start={...p};c.setAssistedMovement({x:0,z:1});
  for(let i=0;i<30;i++)c.update(.05,Math.PI/2);
  assert.ok(p.z>start.z);assert.ok(p.z<=start.z+2-1.7+1e-6);
  assert.ok(Math.abs(p.x-start.x)<1e-6);
  c.dismountKart();
});


test("four independent seats enforce exclusive claims and driver-only input",()=>{
 const seats=createVehicleSeats(definition.seats);
 assert.ok(seats.claim("driver","driver-a"));
 for(let i=1;i<=3;i++)assert.ok(seats.claim("passenger_"+i,"passenger-"+i));
 assert.equal(seats.claim("driver","intruder"),false);
 assert.equal(seats.claim("passenger_4","extra"),false);
 assert.equal(seats.claim("passenger_1","driver-a"),false);
 assert.equal(seats.canDrive("driver-a"),true);
 assert.equal(seats.canDrive("passenger-1"),false);
 assert.equal(seats.canDrive(null),false);
 assert.equal(seats.release("driver","passenger-1"),false);
 assert.equal(seats.release("passenger_2","passenger-2"),true);
 assert.equal(seats.snapshot().filter(s=>s.occupant).length,3);
});
test("passenger world pose follows vehicle translation/yaw without steering authority",()=>{
 const seats=createVehicleSeats(definition.seats);
 seats.claim("passenger_1","p");
 const a=seats.worldPose("passenger_1",{x:10,y:1,z:20,yaw:0});
 const b=seats.worldPose("passenger_1",{x:20,y:2,z:30,yaw:90});
 assert.deepEqual(a,{x:10.42,y:1.4,z:20.35,yaw:0});
 assert.ok(Math.abs(b.x-20.35)<1e-8);assert.ok(Math.abs(b.z-29.58)<1e-8);
 assert.equal(seats.canDrive("p"),false);
});
test("kart drive path refuses steering input without the driver claim",()=>{
 const {c,p}=controllerAt();parkCampusKartAt({x:p.x,y:0,z:p.z,yaw:0});assert.ok(c.boardKart());
 c.kartSeats.release("driver","local-player");c.keys.add("KeyW");
 const start={...p};c.update(.1,0);assert.deepEqual(p,start);
});
