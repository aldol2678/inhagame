import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlayerController, findHelicopterSummonPose } from "../src/player-controller.js";
import { CAMPUS_KICKBOARD_ID, getCampusKickboardParkedPose, parkCampusKickboardAt } from "../src/mounts/campus-kickboard-world.js";
import { getCampusHelicopterParkedPose } from "../src/mounts/campus-helicopter-world.js";
import { getMobilityByMountId, getPlayerVisibleMobility, MOBILITY_REGISTRY, mobilityMatchesFilter, mobilityMatchesQuery } from "../src/mobility/mobility-registry.js";
import { findGroundSummonPose } from "../src/mobility/ground-summon.js";
import { stepGroundMount, GROUND_MOTION_PROFILES } from "../src/mounts/ground-mount-motion.js";
import { wireMountFor, remoteMountState } from "../src/mounts/mount-kinds.js";
import { Anim, Mount, encodePose, validatePose } from "../src/network/protocol.js";
const definition = getMobilityByMountId(CAMPUS_KICKBOARD_ID);
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
test("kickboard registry is test-only, searchable, ground-only and never grants ownership",()=>{
  assert.equal(definition.availability,"EXPERIMENTAL");
  assert.equal(definition.access,"TEST_ONLY"); assert.equal(definition.activeEligible,false);
  assert.equal(definition.physicsProfile,"KICKBOARD"); assert.equal(definition.inputProfile,"BIKE_LIKE");
  assert.equal(definition.summonUX,"INSTANT"); assert.equal(definition.primaryLabel,"바로 타기");
  assert.deepEqual(definition.seats,[{id:"rider",role:"RIDER",controls:true}]);
  assert.ok(mobilityMatchesQuery(definition,"킥보드")); assert.ok(mobilityMatchesFilter(definition,"GROUND"));
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
  args.canOccupyAt=(p,shape)=>{assert.equal(shape.radius,0.65);assert.equal(shape.headOffset,0.75);return ++calls>1;};
  const pose=findGroundSummonPose(args); assert.ok(pose);assert.equal(pose.y,0);assert.equal(calls,2);
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
  const profile=GROUND_MOTION_PROFILES.KICKBOARD;
  let state={speed:0,yaw:0};
  state=stepGroundMount(state,{z:1},0.1,profile);assert.equal(state.speed,3.6);
  for(let i=0;i<20;i++)state=stepGroundMount(state,{z:1},0.1,profile);
  assert.equal(state.speed,12);
  const turn=stepGroundMount(state,{x:1},0.1,profile);assert.equal(turn.yaw,54);
  for(let i=0;i<10;i++)state=stepGroundMount(state,{},0.1,profile);
  assert.equal(state.speed,0);assert.deepEqual(stepGroundMount(state,{},NaN,profile),state);
});
test("instant summon mounts at the current dry ground; movement and dismount still work",()=>{
  const {c,p,nodes}=controllerAt();assert.ok(c.summonKickboardInstant());assert.equal(c.onKickboard,true);assert.equal(c.onBike,false);
  const a=getCampusKickboardParkedPose();assert.equal(a.x,p.x);assert.equal(a.z,p.z);
  assert.equal(nodes.get("jump").hidden,true);assert.equal(nodes.get("descend").hidden,true);
  assert.equal(c.summonKickboardInstant(),false);
  c.keys.add("KeyW");c.keys.add("Space");c.jumpQueued=true;
  const start={...p};for(let i=0;i<10;i++)c.update(.05,0);
  assert.equal(p.y,1.15);assert.ok(p.z>start.z);assert.equal(c.grounded,true);
  assert.equal(c.transportAction(),true);assert.equal(c.mounted,false);assert.equal(c.mountId,null);
  assert.equal(nodes.get("jump").hidden,false);
  assert.equal(getCampusKickboardParkedPose().z,p.z);
});
test("instant summon refuses room, water, airborne, disabled input and blocked footprint",()=>{
  const {c,p}=controllerAt();
  c.space.id="room";assert.equal(c.summonKickboardInstant(),false);
  c.space.id="campus";c.grounded=false;assert.equal(c.summonKickboardInstant(),false);
  c.grounded=true;c.setInputEnabled(false);assert.equal(c.summonKickboardInstant(),false);
  c.setInputEnabled(true);c.space.obstacles=[{minX:p.x-.3,maxX:p.x+.3,minZ:p.z-.3,maxZ:p.z+.3,minY:0,maxY:3}];
  assert.equal(c.summonKickboardInstant(),false);
});
test("seat access refuses distant/disabled/indoor riders and transport focus gate",()=>{
  const {c,p}=controllerAt();parkCampusKickboardAt({x:p.x,y:0,z:p.z,yaw:0});
  c.setTransportGate(()=>false);assert.equal(c.transportAction(),false);
  c.setInputEnabled(false);assert.equal(c.boardKickboard(),false);assert.equal(c.summonKickboardNearPlayer(),false);assert.equal(c.summonKickboardInstant(),false);
  c.setInputEnabled(true);c.space.id="room";assert.equal(c.boardKickboard(),false);
  c.space.id="campus";p.x+=100;assert.equal(c.boardKickboard(),false);
});
test("kickboard wire round trip is distinct; existing bike/dragon/helicopter remain stable",()=>{
  for(const [id,wire] of [[CAMPUS_KICKBOARD_ID,Mount.KICKBOARD],["mount.campus_bike.default",Mount.BIKE],
    ["annyongi",Mount.DRAGON],["mount.campus_helicopter.prototype",Mount.HELICOPTER]]) {
    const mount=wireMountFor({mounted:true,mountId:id});assert.equal(mount,wire);
    const packet=encodePose(1,{x:0,y:1,z:0,yaw:0,anim:Anim.FLY,mount});
    assert.equal(validatePose(packet).ok,true);
    assert.equal(remoteMountState(packet).mountId,id);
  }
  assert.equal(remoteMountState({anim:Anim.WALK,mount:Mount.KICKBOARD}).mounted,false);
});
test("helicopter boarding, flight integration, dismount and summon refusal regressions",()=>{
  const a=getCampusHelicopterParkedPose();const {c,p}=controllerAt({x:a.x,y:a.y+1.15,z:a.z});
  assert.ok(c.boardHelicopter());assert.equal(c.onHelicopter,true);assert.equal(c.onGroundMount,false);
  c.keys.add("Space");c.update(.05,0);assert.ok(Number.isFinite(p.y));c.keys.clear();
  c.grounded=true;assert.ok(c.dismountHelicopter());assert.equal(c.mountId,null);
  assert.equal(findHelicopterSummonPose({origin:{x:0,z:0},overWater:()=>true}),null);
});
test("mobile layout authority is unchanged and remains last",()=>{
  const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
  assert.equal(css.split("/* LANDSCAPE-HUD:start").length-1,1);
  assert.equal(css.split("/* LANDSCAPE-HUD:end */").length-1,1);
  assert.equal(css.split("/* LANDSCAPE-HUD:end */")[1].trim(),"");
});
test("kickboard assisted steering is world-space; wall collision stops the full clearance volume",()=>{
  const {c,p}=controllerAt();
  parkCampusKickboardAt({x:p.x,y:0,z:p.z,yaw:0});assert.ok(c.boardKickboard());
  c.space.obstacles=[{minX:p.x-10,maxX:p.x+10,minZ:p.z+2,maxZ:p.z+3,minY:0,maxY:5}];
  const start={...p};c.setAssistedMovement({x:0,z:1});
  for(let i=0;i<30;i++)c.update(.05,Math.PI/2);
  assert.ok(p.z>start.z);assert.ok(p.z<=start.z+2-0.65+1e-6);
  assert.ok(Math.abs(p.x-start.x)<1e-6);
  c.dismountKickboard();
});

