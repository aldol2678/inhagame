import test from "node:test";
import assert from "node:assert/strict";
import {PlayerController} from "../src/player-controller.js";
import {DUCK_BOAT_ID} from "../src/mounts/duck-boat-world.js";
import {INKYUNG_DOCK,INKYUNG_WATER_Y,findDuckBoatSummonPose,fitsInkyungWater,constrainDuckBoat,stepDuckBoat} from "../src/mounts/duck-boat-motion.js";
import {getMobilityByMountId,getPlayerVisibleMobility,mobilityMatchesFilter} from "../src/mobility/mobility-registry.js";
import {createVehicleSeats} from "../src/mobility/vehicle-seats.js";
import {wireMountFor,remoteMountState} from "../src/mounts/mount-kinds.js";
import {readFileSync} from "node:fs";
const d=getMobilityByMountId(DUCK_BOAT_ID);
function setup(){
 globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{}},getElementById:()=>null};
 const p={...INKYUNG_DOCK.shore,y:1.15};
 const c=new PlayerController({getLocalPosition:()=>({...p}),setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}),setLocalEulerAngles(){}});
 return{c,p};
}
test("boat replaces the placeholder with experimental WATER_SURFACE contract",()=>{
 assert.equal(d.physicsProfile,"BOAT");assert.equal(d.inputProfile,"BOAT");assert.equal(d.access,"TEST_ONLY");assert.equal(d.activeEligible,false);
 assert.equal(d.availability,"EXPERIMENTAL");assert.equal(d.seats.length,2);assert.equal(d.seats[1].controls,false);
 assert.ok(mobilityMatchesFilter(d,"WATER"));assert.equal(mobilityMatchesFilter(d,"GROUND"),false);
 assert.ok(getPlayerVisibleMobility().every(v=>v.availability!=="HIDDEN"));
});
test("fixed safe dock only; remote shore, indoors, mounted, roof, occupied spawn refuse",()=>{
 const b={definition:d,origin:{...INKYUNG_DOCK.shore,y:1.15},spaceId:"campus",mounted:false,grounded:true,
 canOccupyAt:()=>true,bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
 assert.deepEqual(findDuckBoatSummonPose(b),INKYUNG_DOCK.spawn);
 for(const change of [{origin:{x:0,y:1.15,z:0}},{spaceId:"room"},{mounted:true},{grounded:false},
 {canOccupyAt:()=>false},{origin:{...INKYUNG_DOCK.shore,y:5}},{definition:{...d,summonEnabled:false}}])
 assert.equal(findDuckBoatSummonPose({...b,...change}),null);
});
test("continuous water constraint cannot tunnel onto land or cross lake boundary",()=>{
 const a=INKYUNG_DOCK.spawn;
 assert.ok(fitsInkyungWater(a.x,a.z,d.summonClearance.radius));
 assert.equal(fitsInkyungWater(INKYUNG_DOCK.shore.x,INKYUNG_DOCK.shore.z),false);
 for(const to of [{x:a.x+100,z:a.z},{x:a.x-100,z:a.z},{x:a.x,z:a.z-100},{x:a.x,z:a.z+100}]){
 const p=constrainDuckBoat(a,to);assert.ok(fitsInkyungWater(p.x,p.z));
 }
 assert.equal(fitsInkyungWater(NaN,0),false);
});
test("boat has low speed/turn rate and neutral braking, never helicopter attitude",()=>{
 let s={speed:0,yaw:0};
 for(let i=0;i<100;i++)s=stepDuckBoat(s,{throttle:1,steer:1},.1);
 assert.equal(s.speed,3);assert.ok(Math.abs(s.yaw-280)<1e-8);
 assert.equal("pitch" in s,false);assert.equal("roll" in s,false);
 for(let i=0;i<30;i++)s=stepDuckBoat(s,{},.1);assert.equal(s.speed,0);
});
test("summon/board/float/drive/dock dismount use real controller and land exit",()=>{
 const {c,p}=setup();assert.ok(c.summonDuckBoat());assert.equal(c.mounted,false);assert.ok(c.transportAction());
 assert.equal(c.onDuckBoat,true);assert.equal(c.onBike,false);
 c.keys.add("KeyW");c.keys.add("Space");const before={...p};
 for(let i=0;i<15;i++)c.update(.016,0);
 c.keys.clear();assert.ok(Math.hypot(p.x-before.x,p.z-before.z)>.01);
 assert.equal(p.y,INKYUNG_WATER_Y+1.15);assert.ok(fitsInkyungWater(p.x,p.z));
 assert.ok(c.dismountDuckBoat());assert.equal(c.mountId,null);assert.deepEqual({x:p.x,z:p.z},INKYUNG_DOCK.shore);
});
test("driver-only authority and passenger transform contract; no shared passenger claim path",()=>{
 const seats=createVehicleSeats(d.seats);assert.ok(seats.claim("driver","d"));assert.ok(seats.claim("passenger","p"));
 assert.equal(seats.canDrive("p"),false);assert.equal(seats.canDrive("d"),true);
 assert.equal(seats.claim("driver","p"),false);assert.equal(seats.release("driver","p"),false);
 assert.deepEqual(seats.worldPose("passenger",{x:1,y:0,z:2,yaw:0}),{x:1.3,y:.3,z:2,yaw:0});
});
test("water mount presence remains distinct and dismount does not write ownership",()=>{
 assert.equal(remoteMountState({anim:"fly",mount:wireMountFor({mounted:true,mountId:DUCK_BOAT_ID})}).mountId,DUCK_BOAT_ID);
 const source=readFileSync(new URL("../src/player-controller.js",import.meta.url),"utf8");
 assert.doesNotMatch(source,/localStorage|writeActiveMount|grantOwnership/);
 const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
 assert.equal(css.split("/* LANDSCAPE-HUD:end */")[1].trim(),"");
});
