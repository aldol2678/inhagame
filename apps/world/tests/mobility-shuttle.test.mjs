import test from "node:test";
import assert from "node:assert/strict";
import {createTransitRuntime,SHUTTLE_ROUTE,TRANSIT_STATE} from "../src/mobility/transit-runtime.js";
import {PlayerController} from "../src/player-controller.js";
import {CAMPUS_SHUTTLE_ID} from "../src/mounts/campus-shuttle-world.js";
import {getMobilityByMountId,mobilityMatchesFilter,getPlayerVisibleMobility} from "../src/mobility/mobility-registry.js";
import {wireMountFor,remoteMountState} from "../src/mounts/mount-kinds.js";
import {canOccupy} from "../src/world-collision.js";
import {roadviewGroundHeight} from "../src/roadview-layout.js";
import {MAIN_GATE_SPAWN} from "../src/campus-spawn.js";
import {readFileSync} from "node:fs";
test("transit registry exposes autopilot, passive seat, fixed route and test-only status",()=>{
 const d=getMobilityByMountId(CAMPUS_SHUTTLE_ID);
 assert.equal(d.category,"TRANSIT");assert.equal(d.physicsProfile,"PATH_CONSTRAINED");assert.equal(d.inputProfile,"AUTOPILOT");
 assert.equal(d.availability,"HIDDEN");assert.equal(d.activeEligible,false);assert.equal(d.access,"TEST_ONLY");assert.equal(d.summonEnabled,false);
 assert.ok(d.seats.every(s=>!s.controls));assert.ok(mobilityMatchesFilter(d,"TRANSIT"));
 assert.ok(getPlayerVisibleMobility().every(d=>d.availability!=="HIDDEN"));
});
test("production campus keeps shuttle absent until Songdo campus exists",()=>{
 const main=readFileSync(new URL("../src/main.js",import.meta.url),"utf8");
 assert.match(main,/campusShuttleEnabled:\s*false/);
 assert.doesNotMatch(main,/createCampusShuttle|createShuttleStations|setCampusShuttlePropRoot/);
});

test("route cycles all six states, stations and fixed path without timetable",()=>{
 const t=createTransitRuntime({canTravel:()=>true}),seen=new Set([t.transitState]),stations=new Set();
 for(let i=0;i<500;i++){t.update(.1);seen.add(t.transitState);stations.add(t.currentStation.id);assert.equal(t.pose.x,0);assert.ok(t.pose.z>=-92&&t.pose.z<=-70);}
 assert.deepEqual([...seen].sort(),Object.values(TRANSIT_STATE).sort());assert.equal(stations.size,2);
 const s=t.snapshot();assert.equal(s.routeId,SHUTTLE_ROUTE.routeId);assert.equal(s.stations.length,2);
 assert.notEqual(s.currentStation,s.nextStation);
});
test("blocked route holds safely, invalid route/delta rejected and custom stations supported",()=>{
 const t=createTransitRuntime();for(let i=0;i<200;i++)t.update(.1);assert.equal(t.transitState,"MOVING");assert.equal(t.pose.z,-92);
 const before=t.snapshot();t.update(NaN);assert.deepEqual(t.snapshot(),before);
 assert.throws(()=>createTransitRuntime({route:{routeId:"bad",speed:1,stations:[]}}));
 const route={routeId:"future.dorm",speed:1,stations:[{id:"a",x:0,z:0,platform:{x:2,z:0}},{id:"b",x:0,z:1,platform:{x:2,z:1}},{id:"c",x:1,z:1,platform:{x:3,z:1}}]};
 assert.equal(createTransitRuntime({route}).stations.length,3);
});
test("main-gate shuttle parking never overlaps the lobby/gameplay spawn",()=>{
 const s=SHUTTLE_ROUTE.stations[0];
 assert.ok(Math.hypot(s.x-MAIN_GATE_SPAWN.x,s.z-MAIN_GATE_SPAWN.z)>=5,
  "parked shuttle must stay outside the spawn camera envelope");
 assert.ok(Math.hypot(s.platform.x-MAIN_GATE_SPAWN.x,s.platform.z-MAIN_GATE_SPAWN.z)>=4);
});
test("entire authored route and platforms fit existing campus collision",()=>{
 for(let z=-92;z<=-70;z+=.1)assert.ok(canOccupy({x:0,y:1.15+roadviewGroundHeight(0,z),z},{radius:1.6,footOffset:1.15,headOffset:1.65}));
 for(const s of SHUTTLE_ROUTE.stations)assert.ok(canOccupy({...s.platform,y:1.15+roadviewGroundHeight(s.platform.x,s.platform.z)}));
});
test("real passenger boards, ignores driving keys, follows autopilot through input lock and exits only at stop",()=>{
 globalThis.window={addEventListener(){}};globalThis.document={body:{dataset:{}},getElementById:()=>null};
 const p={x:2.2,y:1.15,z:-92};
 const c=new PlayerController({getLocalPosition:()=>({...p}),setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}),setLocalEulerAngles(){}});
 assert.ok(c.transportAction());assert.equal(c.onShuttle,true);
 c.keys.add("KeyD");c.keys.add("Space");c.setInputEnabled(false);
 for(let i=0;i<100;i++)c.update(.1,0);
 assert.equal(p.x,0);assert.ok(p.z>-92);assert.equal(c.dismountShuttle(),false);
 for(let i=0;i<300&&!(c.shuttle.currentStation.id==="gate_north"&&c.shuttle.boardingAllowed);i++)c.update(.1,0);
 c.setInputEnabled(true);assert.ok(c.transportAction());assert.equal(c.mounted,false);assert.equal(p.x,2.2);assert.equal(p.z,-70);
});
test("shuttle presence is distinct and CSS end authority remains untouched",()=>{
 assert.equal(remoteMountState({anim:"fly",mount:wireMountFor({mounted:true,mountId:CAMPUS_SHUTTLE_ID})}).mountId,CAMPUS_SHUTTLE_ID);
 const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
 assert.equal(css.split("/* LANDSCAPE-HUD:end */")[1].trim(),"");
});
