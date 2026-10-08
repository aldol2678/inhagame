import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROOM_FURNITURE, validateFurniture, furnitureBox, positionOnSurface, firstFurniturePosition, canonicalFurniture } from "../src/rooms/furniture-layout.js";
import { getItemDefinition } from "../src/collection/item-catalog.js";

const id = "11111111-1111-4111-8111-111111111111", id2 = "22222222-2222-4222-8222-222222222222";
const chair = extra => ({ id, itemId:"furniture.induck_chair", surface:"floor",x:-2,z:-1,yaw:0,...extra });
const owned = ROOM_FURNITURE.map(item => ({itemId:item.itemId,quantity:1}));

test("all sixteen F0 placements are Collection furniture; server dimension/surface mirror agrees", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261008090000_world_personal_room_f0_furniture.sql",import.meta.url),"utf8");
  const rows = [...sql.matchAll(/\('(furniture\.[a-z0-9_]+)', ([\d.]+)(?:::float8)?, ([\d.]+)(?:::float8)?, ([\d.]+)(?:::float8)?, array\[([^\]]+)\], (true|false), (true|false)\)/g)];
  assert.equal(rows.length,16); assert.equal(ROOM_FURNITURE.length,16);
  for (const item of ROOM_FURNITURE) {
    assert.equal(getItemDefinition(item.itemId).category,"FURNITURE");
    const row = rows.find(row => row[1] === item.itemId); assert.ok(row);
    assert.deepEqual(row.slice(2,5).map(Number),[item.width,item.height,item.depth]);
    assert.deepEqual([...row[5].matchAll(/'([^']+)'/g)].map(match=>match[1]),item.surfaces);
    assert.equal(row[6] === "true",item.solid); assert.equal(row[7] === "true",item.flat);
  }
});
test("every supported surface offers a valid owned starting placement", () => {
  for (const item of ROOM_FURNITURE) for (const surface of item.surfaces) {
    const position = firstFurniturePosition(item.itemId,surface,[],owned); assert.ok(position,`${item.itemId}: ${surface}`);
    assert.equal(validateFurniture([position],owned),null);
    assert.ok(Math.abs(furnitureBox(position).maxY-furnitureBox(position).minY-item.height)<1e-7);
  }
});
test("placements enforce server ownership and aggregate quantities without consuming inventory", () => {
  assert.equal(validateFurniture([chair()],[]),"ITEM_NOT_OWNED");
  assert.equal(validateFurniture([chair(),chair({id:id2,x:0,z:0})],owned),"ITEM_NOT_OWNED");
  const two = [{itemId:"furniture.induck_chair",quantity:2}];
  assert.equal(validateFurniture([chair(),chair({id:id2,x:0,z:0})],two),null);
  assert.equal(two[0].quantity,2);
});
for (const [name,object,expected] of [
  ["outside room",chair({x:-7}),"ROOM_BOUNDS"],
  ["exit/spawn corridor",chair({x:0,z:-2.75}),"EXIT_BLOCKED"],
  ["fixed bed",chair({x:-3.75,z:1.5}),"FURNITURE_OVERLAP"],
  ["fixed chair",chair({x:3,z:.75}),"FURNITURE_OVERLAP"],
  ["non-grid coordinate",chair({x:-2.1}),"INVALID_LAYOUT"],
  ["non-grid yaw",chair({yaw:46}),"INVALID_LAYOUT"],
  ["NaN",chair({x:NaN}),"INVALID_LAYOUT"],
  ["Infinity",chair({z:Infinity}),"INVALID_LAYOUT"],
  ["unsupported old catalog",chair({itemId:"bed_basic"}),"INVALID_LAYOUT"],
  ["arbitrary height",chair({y:99}),"INVALID_LAYOUT"],
  ["wrong mount",chair({surface:"north"}),"INVALID_LAYOUT"],
  ["invalid ID",chair({id:"bad"}),"INVALID_LAYOUT"]
]) test(`rejects ${name}`,()=>assert.equal(validateFurniture([object],owned),expected));
test("C70 floor expansion accepts the side bays while rotation still honors the new bounds", () => {
  assert.equal(validateFurniture([chair({x:-6.5,z:0,yaw:0})],owned),null);
  assert.equal(validateFurniture([chair({x:-6.7,z:0,yaw:0})],owned),null);
  assert.equal(validateFurniture([chair({x:-6.7,z:0,yaw:45})],owned),"ROOM_BOUNDS");
});
test("the seven new F0 definitions fit their intended starter surfaces", () => {
  const expected = new Map([
    ["furniture.dorm_single_sofa", ["floor"]],
    ["furniture.dorm_side_table_low", ["floor"]],
    ["furniture.dorm_bookshelf_slim", ["floor"]],
    ["furniture.dorm_plant_medium", ["floor"]],
    ["furniture.dorm_monitor", ["desk"]],
    ["furniture.dorm_trophy_shelf", ["floor"]],
    ["furniture.study_books_set", ["desk"]]
  ]);
  for (const [itemId,surfaces] of expected) {
    const item = ROOM_FURNITURE.find(row => row.itemId === itemId); assert.ok(item,itemId);
    assert.deepEqual(item.surfaces,surfaces,itemId);
    const position = firstFurniturePosition(itemId,surfaces[0],[],owned); assert.ok(position,itemId);
    assert.equal(validateFurniture([position],owned),null,itemId);
  }
});

test("wall mounts snap the normal and yaw, keep the window and door clear", () => {
  const poster = {id,itemId:"furniture.campus_map_poster",surface:"north",...positionOnSurface("north",-3,0,45)};
  assert.deepEqual({x:poster.x,z:poster.z,yaw:poster.yaw},{x:-3,z:4.15,yaw:0});
  assert.equal(validateFurniture([poster],owned),null);
  assert.equal(validateFurniture([{...poster,x:.5}],owned),"FURNITURE_OVERLAP");
  assert.equal(validateFurniture([{...poster,surface:"south",...positionOnSurface("south",0,0)}],owned),"EXIT_BLOCKED");
  assert.equal(validateFurniture([{...poster,z:4}],owned),"INVALID_LAYOUT");
});
test("desk/bed props must fit the surface and cannot cover laptop/pillow", () => {
  const lamp={id,itemId:"furniture.dorm_desk_lamp",surface:"desk",x:2.25,z:1.5,yaw:0};
  assert.equal(validateFurniture([lamp],owned),null);
  assert.equal(validateFurniture([{...lamp,x:3.25,z:1.75}],owned),"FURNITURE_OVERLAP");
  assert.equal(validateFurniture([{...lamp,x:0}],owned),"ROOM_BOUNDS");
  const cushion={id,itemId:"furniture.induck_cushion",surface:"bed",x:-3.75,z:1.5,yaw:45};
  assert.equal(validateFurniture([cushion],owned),null);
  assert.equal(validateFurniture([{...cushion,z:2.75}],owned),"FURNITURE_OVERLAP");
});
test("rugs can sit under owned solid furniture; duplicate IDs, same layer overlaps and base rug stacking fail", () => {
  const rug = {id:id2,itemId:"furniture.campus_rug_blue",surface:"floor",x:-2.5,z:-1.75,yaw:0};
  assert.equal(validateFurniture([rug,chair()],owned),null);
  assert.equal(validateFurniture([{...rug,x:0,z:.75}],owned),"FURNITURE_OVERLAP");
  assert.equal(validateFurniture([chair(),chair({id:id2,itemId:"furniture.mini_induck"})],owned),"FURNITURE_OVERLAP");
  assert.equal(validateFurniture([chair(),{...rug,id}],owned),"INVALID_LAYOUT");
});
test("empty layouts clear placements; sorted snapshots do not depend on selection order", () => {
  assert.equal(validateFurniture([],[]),null);
  assert.deepEqual(canonicalFurniture([chair({id:id2}),chair()]).map(row=>row.id),[id,id2]);
  assert.equal(validateFurniture(Array.from({length:33},()=>chair()),owned),"INVALID_LAYOUT");
});
