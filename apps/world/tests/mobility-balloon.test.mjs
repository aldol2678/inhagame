import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PlayerController} from "../src/player-controller.js";
import {CAMPUS_BALLOON_ID,getCampusBalloonParkedPose} from "../src/mounts/campus-balloon-world.js";
import {createBalloonState,stepBalloon,BALLOON_LIMITS} from "../src/mounts/balloon-flight.js";
import {findGroundSummonPose} from "../src/mobility/ground-summon.js";
import {getMobilityByMountId,getPlayerVisibleMobility,mobilityMatchesFilter,mobilityMatchesQuery} from "../src/mobility/mobility-registry.js";
import {wireMountFor,remoteMountState} from "../src/mounts/mount-kinds.js";
const d=getMobilityByMountId(CAMPUS_BALLOON_ID);
test("balloon has explicit buoyancy authority, AIR discovery and no ownership grant",()=>{
 assert.equal(d.physicsProfile,"BUOYANCY");assert.equal(d.inputProfile,"BALLOON");assert.equal(d.propulsion,"BUOYANCY");
 assert.equal(d.availability,"EXPERIMENTAL");assert.equal(d.access,"TEST_ONLY");assert.equal(d.activeEligible,false);
 assert.equal(d.seats.length,1);assert.equal(d.seats[0].role,"PILOT");assert.equal(d.seats[0].controls,true);
 assert.ok(mobilityMatchesFilter(d,"AIR"));assert.equal(mobilityMatchesFilter(d,"GROUND"),false);assert.ok(mobilityMatchesQuery(d,"열기구"));
 assert.ok(getPlayerVisibleMobility().every(v=>v.availability!=="HIDDEN"));
 for(const id of ["mount.campus_bike.default","mount.campus_helicopter.prototype"]){
 const existing=getMobilityByMountId(id);assert.equal(existing.access,"TEST_ONLY");assert.equal(existing.availability,"EXPERIMENTAL");}
});
test("buoyancy integrates slow vertical/horizontal motion and drag without rotor attitude",()=>{
 let s=createBalloonState();
 for(let i=0;i<1000;i++)s=stepBalloon(s,{x:1,z:1,lift:1},.016);
 assert.ok(s.vy>1.9&&s.vy<=BALLOON_LIMITS.ascendSpeed);
 assert.ok(Math.hypot(s.vx,s.vz)<=BALLOON_LIMITS.horizontalSpeed);
 assert.equal("pitch" in s,false);assert.equal("roll" in s,false);
 const turned=stepBalloon(createBalloonState(),{x:1},.1);assert.equal(turned.yaw,1.5);
 const before={...s};for(let i=0;i<100;i++)s=stepBalloon(s,{},.1);
 assert.ok(Math.abs(s.vx)<Math.abs(before.vx)/100);assert.ok(Math.abs(s.vy)<.01);
 for(let i=0;i<200;i++)s=stepBalloon(s,{lift:-1},.1);assert.equal(s.vy,-BALLOON_LIMITS.descendSpeed);
 assert.deepEqual(stepBalloon(s,{},NaN),s);
});
test("large ground clearance refuses indoor, water, roof, mounted, bounds and occupied volume",()=>{
 let shape;
 const b={definition:d,origin:{x:0,y:1.15,z:0},spaceId:"campus",grounded:true,allowMount:true,
 groundHeight:()=>0,overWater:()=>false,canOccupyAt:(p,s)=>{shape=s;return true;},
 bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20}};
 assert.ok(findGroundSummonPose(b));assert.equal(shape.radius,3.6);assert.equal(shape.headOffset+shape.footOffset,10.3);
 for(const change of [{spaceId:"indoor"},{mounted:true},{grounded:false},{allowMount:false},{overWater:()=>true},
 {origin:{x:0,y:4,z:0}},{canOccupyAt:()=>false},{bounds:{minX:-1,maxX:1,minZ:-1,maxZ:1}},
 {definition:{...d,summonEnabled:false}}])assert.equal(findGroundSummonPose({...b,...change}),null);
});
test("real controller summons, ascends without jump, refuses airborne exit and lands safely",()=>{
 globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{}},getElementById:()=>null};
 const p={x:0,y:1.15,z:-98};
 const c=new PlayerController({getLocalPosition:()=>({...p}),setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}),setLocalEulerAngles(){}});
 assert.ok(c.summonBalloonNearPlayer());assert.equal(c.mounted,false);
 const a=getCampusBalloonParkedPose();Object.assign(p,{x:a.x,y:a.y+c.groundY,z:a.z});
 assert.ok(c.transportAction());assert.equal(c.onBalloon,true);assert.equal(c.onHelicopter,false);
 c.keys.add("Space");for(let i=0;i<200;i++)c.update(.016,0);c.keys.clear();
 assert.ok(p.y>a.y+c.groundY+1);assert.equal(c.velocityY,0);assert.equal(c.grounded,false);assert.equal(c.dismountBalloon(),false);
 c.descendHeld=true;for(let i=0;i<1000&&!c.grounded;i++)c.update(.016,0);c.descendHeld=false;
 assert.equal(c.grounded,true);assert.ok(c.dismountBalloon());assert.equal(c.mountId,null);
});
test("balloon kind roundtrips distinctly and landscape CSS authority remains last",()=>{
 assert.equal(remoteMountState({anim:"fly",mount:wireMountFor({mounted:true,mountId:CAMPUS_BALLOON_ID})}).mountId,CAMPUS_BALLOON_ID);
 const motion=readFileSync(new URL("../src/mounts/balloon-flight.js",import.meta.url),"utf8");
 assert.doesNotMatch(motion,/from .*helicopter|stepHelicopter/);
 const source=readFileSync(new URL("../src/player-controller.js",import.meta.url),"utf8");assert.doesNotMatch(source,/localStorage|writeActiveMount|grantOwnership/);
 const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
 assert.equal(css.split("/* LANDSCAPE-HUD:start").length,2);assert.equal(css.split("/* LANDSCAPE-HUD:end */")[1].trim(),"");
});
