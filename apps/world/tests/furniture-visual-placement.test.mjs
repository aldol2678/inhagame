import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_FURNITURE_CANDIDATES } from '../src/rooms/character-furniture-assets.js';
import { planFurnitureVisualPlacements, furnitureVisualBox } from '../src/rooms/furniture-visual-placement.js';
import { validateFurniture, firstFurniturePosition, furnitureBox } from '../src/rooms/furniture-layout.js';
import { parseFurnitureSnapshot, createFurnitureClient } from '../src/rooms/furniture-client.js';
const candidates=CHARACTER_FURNITURE_CANDIDATES.map(v=>({...v,enabled:true}));
const options={visualForItem:id=>candidates.find(v=>v.itemId===id)};
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const obj=(n,item=0,x=0,z=0,yaw=0)=>({id:id(n),itemId:candidates[item].itemId,surface:'floor',x,z,yaw});
const describe=plan=>[...plan].map(([id,{eligible,reason}])=>[id,eligible,reason]).sort();

test('exact eight-corner projection retains bookshelf off-center at every yaw',()=>{
 for(let yaw=0;yaw<360;yaw+=45){
  const object=obj(1,2,0,0,yaw),box=furnitureVisualBox(object,candidates[2]),r=yaw*Math.PI/180;
  const center=(candidates[2].min[2]+candidates[2].max[2])/2;
  assert.ok(Math.abs((box.minX+box.maxX)/2-Math.sin(r)*center)<1e-9);
  assert.ok(Math.abs((box.minZ+box.maxZ)/2-Math.cos(r)*center)<1e-9);
  assert.equal(box.maxY,.025+candidates[2].max[1]);
 }
});
test('legacy-valid wall, exit, fixed chair and visible decor cases preserve fallback without moving',()=>{
 const cases=[obj(1,2,6.5,0,45),obj(1,0,1.25,-2.75),obj(1,0,2.25,.75),obj(1,2,-4.75,-2.25)];
 for(const object of cases){
  assert.equal(validateFurniture([object]),null,JSON.stringify(object));
  const before=JSON.stringify(object),entry=planFurnitureVisualPlacements([object],options).get(object.id);
  assert.equal(entry.eligible,false,JSON.stringify(entry));assert.equal(JSON.stringify(object),before);assert.deepEqual(entry.box,furnitureBox(object));
 }
});
test('expanded-only conflicts resolve by UUID independently of snapshot ordering',()=>{
 const objects=[obj(1,2,-.5,0),obj(2,2,.5,0)];
 assert.equal(validateFurniture(objects),null);
 const plan=planFurnitureVisualPlacements(objects,options);
 assert.equal(plan.get(id(1)).eligible,true);assert.equal(plan.get(id(2)).reason,'EXPANDED_OVERLAP');
 assert.deepEqual(describe(plan),describe(planFurnitureVisualPlacements([...objects].reverse(),options)));
});
test('disabled and procedural profiles cannot change saved collision or activate a candidate',()=>{
 const object=obj(1);
 for(const config of [{visualForItem:id=>{ const visual=CHARACTER_FURNITURE_CANDIDATES.find(v=>v.itemId===id); return visual ? {...visual,enabled:false} : null; }},{...options,modelMode:'procedural'}]){
  const entry=planFurnitureVisualPlacements([object],config).get(object.id);
  assert.equal(entry.eligible,false);assert.equal(entry.reason,'DISABLED');assert.deepEqual(entry.box,furnitureBox(object));
 }
});
test('legacy dense32 snapshot preserves UUIDs, revision, ownership and objects without writes',async()=>{
 const objects=[],owned=candidates.map(v=>({itemId:v.itemId,quantity:32}));
 for(let n=1;n<=32;n++){
  const item=candidates[(n-1)%3].itemId,found=firstFurniturePosition(item,'floor',objects,owned,{id:id(n)});
  assert.ok(found);objects.push(found);
 }
 const roomId=id(50),snapshot={roomId,role:'owner',revision:42,objects};
 const before=JSON.stringify(snapshot);assert.ok(parseFurnitureSnapshot(snapshot,roomId));
 const plan=planFurnitureVisualPlacements(objects,options);
 assert.equal(plan.size,32);assert.ok([...plan.values()].some(p=>!p.eligible));
 assert.deepEqual(describe(plan),describe(planFurnitureVisualPlacements([...objects].reverse(),options)));
 assert.equal(JSON.stringify(snapshot),before);assert.equal(validateFurniture([...objects,obj(99)]),'INVALID_LAYOUT');
 const calls=[];const client=createFurnitureClient({getUserId:()=>id(51),getClient:()=>({rpc:async(name)=>{calls.push(name);return {data:snapshot};}})});
 assert.equal(await client.bind(roomId),true);assert.equal(client.state().revision,42);assert.deepEqual(client.state().objects,objects);
 planFurnitureVisualPlacements(client.state().objects,options);assert.deepEqual(calls,['get_world_room_furniture_v1']);
 assert.equal(validateFurniture(objects,[]),'ITEM_NOT_OWNED');
 assert.equal(parseFurnitureSnapshot({...snapshot,revision:-1},roomId),null);
 assert.equal(parseFurnitureSnapshot({...snapshot,objects:[{...objects[0],id:'invalid'}]},roomId),null);
});

test('height-aware wall art collision and blocked chair landing keep only the affected legacy shape',()=>{
 const cabinet=obj(1,1,5,0),poster={id:id(2),itemId:'furniture.campus_map_poster',surface:'east',x:5.35,z:0,yaw:90};
 assert.equal(validateFurniture([cabinet,poster]),null);
 assert.equal(planFurnitureVisualPlacements([cabinet,poster],options).get(cabinet.id).reason,'FURNITURE_OVERLAP');
 const chair=obj(1),nightstand=obj(2,1,0,-1);
 assert.equal(validateFurniture([chair,nightstand]),null);
 const plan=planFurnitureVisualPlacements([chair,nightstand],options);
 assert.equal(plan.get(chair.id).reason,'SEAT_EXIT_BLOCKED');assert.equal(plan.get(nightstand.id).eligible,true);
 assert.deepEqual(describe(plan),describe(planFurnitureVisualPlacements([nightstand,chair],options)));
});
test('malformed input never grants a new envelope',()=>{
 assert.equal(planFurnitureVisualPlacements(null,options).size,0);
 assert.equal(planFurnitureVisualPlacements([null],options).size,0);
 assert.equal(planFurnitureVisualPlacements([{...obj(1),id:'bad'}],options).get('bad').eligible,false);
});
