import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { STUDENT_CENTER_VENDORS as vendors, studentCenterVendor, applyStudentVendorPlacement, createStudentVendorInteraction } from '../src/shop/student-center-vendors.js';
import { studentConnectedFrame, createStudentConnectedWalk } from '../src/student-center-connected.js';
import { WALK_SHAPE } from '../src/player-dimensions.js';
const frame = studentConnectedFrame();
const pos = vendor => ({...vendor.position,y:vendor.position.y+WALK_SHAPE.footOffset});

test('two explicit assignments use existing shop workers and never quest NPCs or generic roles',()=>{
 const batch=JSON.parse(readFileSync(new URL('../npc-factory/data/repaired/INKYUNG-20-A-R1.json',import.meta.url)));
 assert.equal(vendors.length,2);
 for(const v of vendors){const npc=batch.npcs.find(n=>n.npc_id===v.npcId);assert.equal(npc.identity.name,v.name);assert.equal(npc.archetype,'shop_worker');assert.deepEqual(frame.toWorld(v.local),[v.position.x,v.position.y,v.position.z]);}
 assert.equal(studentCenterVendor('INKYUNG-NPC-015'),null);
 assert.equal(studentCenterVendor('shop_worker'),null);
});
test('both shelf-front vendors and return path have actual supported body clearance',()=>{
 for(const v of vendors){
  const route=[[-14,14],[-14,1],[-8,1],[-8,6],[9,6],[9,4],[10.2,1],[v.local[0],1],[v.local[0],v.local[2]]];
  const walk=createStudentConnectedWalk();let state={x:-14,z:14,elevation:0};
  for(const p of [...route.slice(1),...route.slice(0,-1).reverse()]){state=walk.step(state,...p);assert.equal(state.blocked,false,JSON.stringify({v:v.npcId,p,state}));}
  assert.equal(walk.inspect(v.local[0],v.local[2],v.local[1]).clear,true);
  assert.equal(walk.inspect(v.local[0],v.local[2],v.local[1]).supported,true);
 }
});
test('same actor is repositioned before outdoor schedule, with no clone or quest override',()=>{
 const v=vendors[0],actor={id:v.npcId},visual={avatar:{enabled:false},motion:{position:{x:0,z:0},route:[1],moving:true},seat:{}};
 assert.equal(applyStudentVendorPlacement(visual,actor,v),true);
 assert.equal(visual.actor,actor);assert.deepEqual(actor.position,{x:v.position.x,z:v.position.z});
 assert.equal(visual.motion.moving,false);assert.equal(visual.seat,null);assert.equal(visual.avatar.enabled,true);
 assert.equal(applyStudentVendorPlacement(visual,{id:'INKYUNG-NPC-015'},v),false);
 const source=readFileSync(new URL('../npc-factory/dev-runtime.mjs',import.meta.url),'utf8');
 assert.match(source,/function applyActor[\s\S]*?applyStudentVendorPlacement/);
 assert.match(source,/function advanceMotion[\s\S]*?applyStudentVendorPlacement[\s\S]*?sharedAuthority.stateFor/);
 assert.match(source,/!assignedVendor\(actor.id\) && avatars.get/);
 assert.match(source,/visible: !assignedVendor\(id\)/);
});
test('proximity publishes F/mobile candidate only and rechecks account, gates, readiness and position on trigger',()=>{
 let p=pos(vendors[0]),blocked=false,available=true,ready=true;const calls=[];
 const ui=createStudentVendorInteraction({getPosition:()=>p,getBlocked:()=>blocked,getAvailable:()=>available,getNpcReady:()=>ready,openShop:id=>{calls.push(id);}});
 const action=ui.observe();assert.equal(action.shortcut,'F');assert.match(action.label,/나수현.*기념품/);assert.deepEqual(calls,[]);
 assert.equal(action.trigger(),true);assert.deepEqual(calls,['shop.student_center']);
 blocked=true;assert.equal(ui.canAccess(vendors[0].shopId),true);assert.equal(ui.canAccess('shop.dorm_furniture'),false);assert.equal(action.trigger(),false);assert.equal(ui.observe(),null);blocked=false;
 available=false;assert.equal(ui.observe().disabled,true);assert.equal(action.trigger(),false);available=true;
 ready=false;assert.equal(ui.observe(),null);assert.equal(action.trigger(),false);ready=true;
 p={...p,y:p.y+2};assert.equal(ui.canAccess(vendors[0].shopId),false);assert.equal(ui.observe(),null);assert.equal(action.trigger(),false);
 p=pos(vendors[1]);assert.match(ui.observe().label,/가지안.*패션/);assert.equal(action.trigger(),false);assert.equal(ui.observe().trigger(),true);
 assert.deepEqual(calls,['shop.student_center','shop.student_center_fashion']);
});
test('shelves, outside entry, missing height and unsafe defaults fail closed',()=>{
 let p=pos(vendors[0]);const ui=createStudentVendorInteraction({getPosition:()=>p,getBlocked:()=>false,getNpcReady:()=>true,getAvailable:()=>true});
 const q=frame.toWorld([10.2,.08,-5]);p={x:q[0],y:q[1]+WALK_SHAPE.footOffset,z:q[2]};assert.equal(ui.observe(),null);
 p={x:vendors[0].position.x,z:vendors[0].position.z};assert.equal(ui.observe(),null);
 assert.equal(createStudentVendorInteraction().observe(),null);
});
