import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERSONAL_ROOM_DECOR, personalRoomDecorBox, visiblePersonalRoomDecor } from "../src/rooms/personal-room-decor-layout.js";
import { createPersonalRoomFixtureModel } from "../src/rooms/personal-room-fixture-model.js";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC_OBSTACLES } from "../src/rooms/personal-room-layout.js";
import { validateFurniture } from "../src/rooms/furniture-layout.js";

const id = "11111111-1111-4111-8111-111111111111";
const chair = (x, z) => ({ id, itemId: "furniture.induck_chair", surface: "floor", x, z, yaw: 0 });
const visibleIds = objects => visiblePersonalRoomDecor(objects).map(prop => prop.id);
const overlaps = (a,b) => ["X","Y","Z"].every(axis => a[`min${axis}`] < b[`max${axis}`] && a[`max${axis}`] > b[`min${axis}`]);

test("three optional decorations fit the room without crossing the exit or fixed furniture", () => {
  assert.deepEqual(visibleIds([]), ["reading_table", "floor_lamp", "wall_shelf"]);
  const boxes = PERSONAL_ROOM_DECOR.map(personalRoomDecorBox);
  const exit = {minX:-.9,maxX:.9,minY:0,maxY:2.15,minZ:-4.2,maxZ:-2.25};
  for (const box of boxes) {
    assert.ok(box.minX >= -PERSONAL_ROOM_BASIC.halfWidth && box.maxX <= PERSONAL_ROOM_BASIC.halfWidth);
    assert.ok(box.minZ >= -PERSONAL_ROOM_BASIC.halfDepth && box.maxZ <= PERSONAL_ROOM_BASIC.halfDepth);
    assert.ok(box.minY >= 0 && box.maxY < PERSONAL_ROOM_BASIC.ceiling);
    assert.equal(overlaps(box,exit),false,box.id);
    for (const fixed of PERSONAL_ROOM_BASIC_OBSTACLES) assert.equal(overlaps(box,fixed),false,`${box.id} versus ${fixed.id}`);
    for (const other of boxes) if (box !== other) assert.equal(overlaps(box,other),false);
  }
  assert.equal(PERSONAL_ROOM_BASIC_FURNITURE.length,6,"existing server-reserved template remains unchanged");
});

test("existing valid owned furniture takes priority and clearing it restores a decoration", () => {
  const object = chair(-3.75,-2.25), snapshot = JSON.stringify(object);
  assert.equal(validateFurniture([object]),null,"no new client-only/server-mismatched reservation");
  assert.deepEqual(visibleIds([object]),["floor_lamp","wall_shelf"]);
  assert.deepEqual(visibleIds([]),["reading_table","floor_lamp","wall_shelf"]);
  assert.equal(JSON.stringify(object),snapshot,"owned placement is not relocated or modified");
  assert.deepEqual(visibleIds([chair(-4.75,-3)]),["reading_table","wall_shelf"]);
});

test("west-wall posters hide the shelf while low floor furniture can remain underneath", () => {
  const poster = {id,itemId:"furniture.campus_map_poster",surface:"west",x:-5.35,z:-1.75,yaw:270};
  assert.equal(validateFurniture([poster]),null);
  assert.deepEqual(visibleIds([poster]),["reading_table","floor_lamp"]);
  assert.equal(validateFurniture([chair(-5,-1.75)]),null);
  assert.deepEqual(visibleIds([chair(-5,-1.75)]),["reading_table","floor_lamp","wall_shelf"]);
});

test("flat owned rugs remain beneath optional floor decorations", () => {
  const rug = {id,itemId:"furniture.campus_rug_blue",surface:"floor",x:-3.5,z:-2.25,yaw:0};
  assert.equal(validateFurniture([rug]),null);
  assert.deepEqual(visibleIds([rug]),["reading_table","floor_lamp","wall_shelf"]);
});

test("actual glTF vertex bounds fit every decoration's rotated, offset collision box", () => {
  for (const prop of PERSONAL_ROOM_DECOR) {
    const url = new URL(`..${prop.model.url}`,import.meta.url);
    const gltf = JSON.parse(readFileSync(url,"utf8"));
    const buffers = gltf.buffers.map(resource => {
      assert.match(resource.uri,/^[\w-]+\.bin$/);
      const bytes = readFileSync(new URL(resource.uri,url));
      assert.equal(bytes.length,resource.byteLength);
      return bytes;
    });
    for (const image of gltf.images) {
      assert.equal(image.uri,"furniturebits_texture.png");
      const png = readFileSync(new URL(image.uri,url));
      assert.equal(png.readUInt32BE(16),1024);
      assert.equal(png.readUInt32BE(20),1024);
    }
    const bound = personalRoomDecorBox(prop), angle = prop.model.yaw*Math.PI/180;
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION], view = gltf.bufferViews[accessor.bufferView];
      assert.equal(accessor.componentType,5126);assert.equal(accessor.type,"VEC3");
      for (let i=0;i<accessor.count;i++) {
        const start = (view.byteOffset??0)+(accessor.byteOffset??0)+i*(view.byteStride??12);
        const [x,y,z] = [0,1,2].map(axis=>buffers[view.buffer].readFloatLE(start+axis*4)*prop.model.scale);
        const point = [x*Math.cos(angle)+z*Math.sin(angle),y,-x*Math.sin(angle)+z*Math.cos(angle)]
          .map((coordinate,axis)=>coordinate+prop.model.offset[axis]+prop.at[axis]);
        for (let axis=0;axis<3;axis++) {
          const label=["X","Y","Z"][axis];
          assert.ok(point[axis]>=bound[`min${label}`]-1e-6 && point[axis]<=bound[`max${label}`]+1e-6,`${prop.id} vertex outside ${label} bound`);
        }
      }
    }
  }
});

test("independent model failures cannot suppress successfully loaded decorations", async () => {
  const callbacks = new Map(), fallbacks = [];
  const root = {once() {}};
  const app = {assets:{loadFromUrl(url,type,callback){assert.equal(type,"container");callbacks.set(url,callback);}}};
  const loaders = PERSONAL_ROOM_DECOR.map(prop => {
    const fallback = {enabled:true};fallbacks.push(fallback);
    const anchor = {children:[],addChild(model){this.children.push(model);}};
    return createPersonalRoomFixtureModel({app,root,anchor,fallback,model:prop.model});
  });
  const pending = loaders.map(load=>load());
  await Promise.resolve();
  const entity = () => ({setLocalPosition(){},setLocalScale(){},setLocalEulerAngles(){},destroy(){}});
  const asset = {resource:{instantiateRenderEntity:entity}};
  callbacks.get(PERSONAL_ROOM_DECOR[0].model.url)(null,asset);
  callbacks.get(PERSONAL_ROOM_DECOR[1].model.url)(new Error("lamp unavailable"));
  callbacks.get(PERSONAL_ROOM_DECOR[2].model.url)(null,asset);
  assert.deepEqual(await Promise.all(pending),[true,false,true]);
  assert.deepEqual(fallbacks.map(fallback=>fallback.enabled),[false,true,false]);
  assert.deepEqual(await Promise.all(loaders.map(load=>load())),[true,false,true]);
  assert.equal(callbacks.size,3);
});
