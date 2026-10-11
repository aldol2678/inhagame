import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC_OBSTACLES } from "../src/rooms/personal-room-layout.js";
import { furnitureBox, validateFurniture } from "../src/rooms/furniture-layout.js";

// Substitute only GPU allocation. Production scene construction, geometry,
// transforms, material lookups and the real chair asset loader all run unchanged.
const mock = `
export class Entity {
  constructor(name){this.name=name;this.children=[];this.handlers=new Map();this.enabled=true;this.position=[0,0,0];this.scale=[1,1,1];this.angles=[0,0,0];}
  addChild(child){this.children.push(child);child.parent=this;}
  addComponent(type,value){this[type]=value;}
  setLocalPosition(...value){this.position=value;}
  setLocalScale(...value){this.scale=value;}
  setLocalEulerAngles(...value){this.angles=value;}
  once(event,fn){const fns=this.handlers.get(event)||[];fns.push(fn);this.handlers.set(event,fns);}
  destroy(){if(this.destroyed)return;this.destroyed=true;for(const c of this.children)c.destroy();this.children=[];for(const fn of this.handlers.get('destroy')||[])fn();this.handlers.clear();}
}
export class MeshInstance {constructor(mesh,material){Object.assign(this,{mesh,material});}}
export function createMesh(device,positions,options){
  if(device.failMesh)throw new Error('optional mesh unavailable');
  const mesh={positions,...options,destroyCalls:0,destroy(){this.destroyCalls++;}};
  device.meshes.push(mesh);return mesh;
}
export class StandardMaterial{update(){}}
export class Color{constructor(r,g,b){Object.assign(this,{r,g,b});}}
`;
registerHooks({ resolve(specifier, context, next) {
  return specifier === "playcanvas" ? { url: `data:text/javascript,${encodeURIComponent(mock)}`, shortCircuit: true } : next(specifier, context);
} });
const { Entity } = await import("playcanvas");
const { createPersonalRoomFixtures, buildPersonalRoomSoftGeometry, buildPersonalRoomLeafGeometry } = await import("../src/rooms/personal-room-fixtures-v2.js");
const { PERSONAL_ROOM_MATERIAL_PROFILES } = await import("../src/rooms/personal-room-materials.js");
const source = readFileSync(new URL("../src/rooms/personal-room-fixtures-v2.js", import.meta.url), "utf8");
const flatten = entity => [entity, ...entity.children.flatMap(flatten)];
const find = (entity, name) => flatten(entity).find(child => child.name === name);
function rig({ failMesh = false, noDevice = false, loadError = true } = {}) {
  const root = new Entity("Room_ROOM_PERSONAL_BASIC"), calls = [], materialKeys = new Set(), device = { meshes: [], failMesh };
  const app = { graphicsDevice: noDevice ? null : device, assets: { loadFromUrl(url, type, callback) {
    calls.push({ url, type, callback });
    if (loadError) callback(new Error("offline"));
  } } };
  const materials = { get(name) { assert.ok(PERSONAL_ROOM_MATERIAL_PROFILES[name], `registered material ${name}`); materialKeys.add(name); return { name }; } };
  return { root, device, calls, materialKeys, ...createPersonalRoomFixtures({ app, root, materials }) };
}

function vertexPoints(entity) {
  if (!entity.render) return [];
  const values = entity.render.meshInstances?.[0]?.mesh.positions;
  if (values) return Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3));
  return [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => [x, y, z])));
}
function inAnchor(point, entity, anchor) {
  for (let node = entity; node !== anchor; node = node.parent) {
    point = point.map((v, i) => v * node.scale[i]);
    const [rx, ry, rz] = node.angles.map(v => v * Math.PI / 180);
    let [x, y, z] = point;
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    point = [x, y, z].map((v, i) => v + node.position[i]);
  }
  return point;
}

for (const profile of ["timber", "mattress", "pillow", "duvet", "rug"]) test(`${profile} mesh is finite, curved, closed and outward facing`, () => {
  const mesh = buildPersonalRoomSoftGeometry(profile);
  assert.ok(mesh.indices.length / 3 <= 600);
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.uvs.length, mesh.positions.length / 3 * 2);
  assert.ok([...mesh.positions, ...mesh.normals, ...mesh.uvs].every(Number.isFinite));
  assert.ok(mesh.positions.every(v => Math.abs(v) <= .5 + 1e-10));
  assert.ok(new Set(mesh.positions.map(v => Math.round(v * 1000))).size > 20, "genuinely rounded mesh, not a renamed box");
  const edges = new Map();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3), [a, b, c] = ids.map(id => mesh.positions.slice(id * 3, id * 3 + 3));
    const u = b.map((v, axis) => v - a[axis]), v = c.map((value, axis) => value - a[axis]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(n.reduce((sum, value, axis) => sum + value * (a[axis] + b[axis] + c[axis]), 0) > 0, "front faces point outward");
    for (let j = 0; j < 3; j++) {
      const key = [ids[j], ids[(j + 1) % 3]].sort((a, b) => a - b).join(":");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.ok([...edges.values()].every(count => count === 2), "watertight soft form");
});

test("all six canonical fixture anchors retain identity, position and authority", () => {
  const before = JSON.stringify({ fixtures: PERSONAL_ROOM_BASIC_FURNITURE, obstacles: PERSONAL_ROOM_BASIC_OBSTACLES });
  const r = rig();
  assert.deepEqual(r.root.children.map(child => child.name), PERSONAL_ROOM_BASIC_FURNITURE.map(item => `personal_${item.id}`));
  for (const item of PERSONAL_ROOM_BASIC_FURNITURE) assert.deepEqual(find(r.root, `personal_${item.id}`).position, item.at);
  assert.equal(JSON.stringify({ fixtures: PERSONAL_ROOM_BASIC_FURNITURE, obstacles: PERSONAL_ROOM_BASIC_OBSTACLES }), before);
  for (const anchor of r.root.children) {
    for (const entity of flatten(anchor)) {
      assert.equal(entity.collision, undefined, "no new gameplay collider component");
      const names = entity.children.map(child => child.name);
      assert.equal(new Set(names).size, names.length, `deterministic unambiguous hierarchy inside ${anchor.name}/${entity.name}`);
    }
  }
  assert.doesNotMatch(source, /Math\.random|https?:|FURNITURE_BY_ID|setObjects|\.push\(.*obstacle/);
  assert.ok(r.materialKeys.size >= 15);
});

test("visual footprints preserve editable floor and storage respects the existing height", () => {
  const r = rig();
  for (const item of PERSONAL_ROOM_BASIC_FURNITURE) {
    const anchor = find(r.root, `personal_${item.id}`);
    for (const entity of flatten(anchor)) for (const point of vertexPoints(entity).map(p => inAnchor(p, entity, anchor))) {
      for (const axis of [0, 2]) assert.ok(Math.abs(point[axis]) <= item.size[axis] / 2 + 1e-7, `${item.id}/${entity.name} extends past ${axis}: ${point[axis]}`);
      assert.ok(point[1] >= -1e-7, `${item.id}/${entity.name} must remain above floor`);
      if (["bookshelf", "plant"].includes(item.kind)) assert.ok(point[1] <= item.size[1] + 1e-7, `${item.id}/${entity.name} exceeds collider height ${point[1]}`);
    }
  }
});

test("bed has soft bedding; desk has structural joinery without F0 ownership substitutions", () => {
  const r = rig(), bed = find(r.root, "personal_bed"), desk = find(r.root, "personal_desk");
  for (const name of ["bedframe", "headboard", "mattress", "pillow", "duvet", "duvet_fold"]) assert.ok(find(bed, name));
  for (const name of ["mattress", "pillow", "duvet"]) assert.equal(find(bed, name).render.type, "asset");
  for (const name of ["top", "leg_0_0", "leg_1_1", "drawer_bank", "drawer_front_1", "laptop"]) assert.ok(find(desk, name));
  assert.equal(flatten(r.root).some(entity => /monitor|book_stack|study_books|trophy|sofa|lamp/.test(entity.name)), false);
  for (const id of ["bed", "desk", "bookshelf", "plant"]) {
    const contact = find(find(r.root, `personal_${id}`), "contact_grounding");
    assert.equal(contact.render.meshInstances[0].material.name, "contactShadow");
    assert.equal(contact.render.castShadows, false);
  }
});

test("storage doors face the room along its long side and shelves have real depth", () => {
  const storage = find(rig().root, "personal_bookshelf");
  for (let i = 0; i < 2; i++) {
    const door = find(storage, `wardrobe_door_${i}`);
    assert.ok(door.position[0] < -.25);
    assert.ok(find(door, "ivory_panel").position[0] < 0);
    assert.ok(find(door, "oak_border").scale[2] > .45);
    assert.ok(find(storage, `open_shelf_${i}`).scale[0] > .5);
  }
  assert.ok(find(storage, "wardrobe_door_0").position[2] < find(storage, "wardrobe_door_1").position[2]);
});

test("plant has directional cupped leaves with bounded geometry", () => {
  const mesh = buildPersonalRoomLeafGeometry(), leaves = flatten(find(rig().root, "foliage")).filter(e => e.name.startsWith("leaf_"));
  assert.equal(leaves.length, 9);
  assert.ok(mesh.indices.length / 3 < 120);
  assert.ok([...mesh.positions, ...mesh.normals].every(Number.isFinite));
  assert.ok(new Set(leaves.map(leaf => leaf.angles[1])).size === 9);
  assert.ok(mesh.positions.some((v, i) => i % 3 === 2 && v > .3), "leaves cup around their midrib");
});

for (const options of [{ failMesh: true }, { noDevice: true }]) test(`missing optional mesh capability preserves all visible fixture fallbacks: ${JSON.stringify(options)}`, async () => {
  const r = rig(options);
  assert.equal(r.root.children.length, 6);
  assert.equal(find(r.root, "pillow").render.type, "sphere");
  assert.equal(find(r.root, "duvet").render.type, "sphere");
  assert.ok(find(r.root, "wardrobe_door_0"));
  assert.deepEqual(await r.ensureVisualAssets(), [false]);
  assert.equal(find(r.root, "chair_fallback").enabled, true);
});

test("fixed chair seat contract and real lazy model loader remain intact and idempotent", async () => {
  const r = rig(), seat = find(find(r.root, "chair_fallback"), "seat");
  assert.deepEqual(seat.position, [0, .244, -.018]); assert.deepEqual(seat.scale, [.47, .052, .452]);
  assert.equal(seat.position[1] + seat.scale[1] / 2, .27, "fixed seating support unchanged");
  assert.equal(seat.render.meshInstances[0].material.name, "fabricLinen");
  assert.equal(find(find(r.root, "chair_fallback"), "leg_0_0").render.meshInstances[0].material.name, "woodOak");
  assert.deepEqual(find(r.root, "personal_chair").angles, [0, 180, 0], "fixed chair faces its desk without changing owned chairs");
  assert.equal(r.calls.length, 0);
  const first = r.ensureVisualAssets(); assert.strictEqual(r.ensureVisualAssets(), first);
  assert.deepEqual(await first, [false]); assert.strictEqual(r.ensureVisualAssets(), first);
  assert.equal(r.calls.length, 1); assert.match(r.calls[0].url, /fixed-chair-oak-linen\.glb$/);
  assert.equal(find(r.root, "chair_fallback").enabled, true);
});

test("generated meshes are shared per profile, bounded in cost and disposed once with root", async () => {
  const r = rig(), meshes = [...r.device.meshes];
  assert.ok(meshes.length <= 9, "profile mesh reuse, not one allocation per fixture part");
  const visibleTriangles = flatten(r.root).reduce((sum, entity) => sum + (entity.render?.meshInstances?.[0]?.mesh.indices.length ?? 0) / 3, 0);
  assert.ok(visibleTriangles < 20000, `mobile-safe authored geometry: ${visibleTriangles} triangles`);
  for (let i = 0; i < 20; i++) { r.root.enabled = !r.root.enabled; await r.ensureVisualAssets(); }
  assert.equal(r.root.children.length, 6); assert.equal(r.device.meshes.length, meshes.length); assert.equal(r.calls.length, 1);
  r.root.destroy(); r.root.destroy();
  assert.ok(meshes.every(mesh => mesh.destroyCalls === 1)); assert.equal(r.root.children.length, 0);
  assert.equal(await r.ensureVisualAssets(), false);
});

test("destroying while chair load is pending cannot reattach late visual assets", async () => {
  const r = rig({ loadError: false }), pending = r.ensureVisualAssets();
  await Promise.resolve(); assert.equal(r.calls.length, 1); r.root.destroy();
  let instantiated = false;
  r.calls[0].callback(null, { resource: { instantiateRenderEntity() { instantiated = true; return new Entity("late"); } } });
  assert.deepEqual(await pending, [false]); assert.equal(instantiated, false); assert.equal(await r.ensureVisualAssets(), false);
});

for (const failMesh of [false, true]) test(`saved bed cushion placements remain visible above V2 bedding (primitive fallback: ${failMesh})`, () => {
  const anchor = find(rig({ failMesh }).root, "personal_bed");
  const visuals = flatten(anchor).filter(entity => entity.render).map(entity => {
    const points = vertexPoints(entity).map(point => inAnchor(point, entity, anchor).map((v, axis) => v + anchor.position[axis]));
    const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
    return { name: entity.name, minX: min[0], maxX: max[0], minY: min[1], maxY: max[1], minZ: min[2], maxZ: max[2] };
  });
  const overlaps = (a, b) => a.minX < b.maxX - 1e-7 && a.maxX > b.minX + 1e-7 && a.minZ < b.maxZ - 1e-7 && a.maxZ > b.minZ + 1e-7;
  const cushion = (x, z, yaw = 0) => ({ id: "11111111-1111-4111-8111-111111111111", itemId: "furniture.induck_cushion", surface: "bed", x, z, yaw });
  for (const object of [cushion(-3.75, 1.5), cushion(-3.75, 2.25)]) {
    assert.equal(validateFurniture([object]), null, "representative owned placements remain valid");
    assert.equal(furnitureBox(object).minY, .43, "saved placement support height is unchanged");
  }
  let accepted = 0;
  for (let x = -4.5; x <= -3; x += .25) for (let z = .5; z <= 3.25; z += .25) for (let yaw = 0; yaw < 360; yaw += 45) {
    const object = cushion(x, z, yaw);
    if (validateFurniture([object]) !== null) continue;
    accepted++;
    const bounds = furnitureBox(object);
    for (const visual of visuals) if (overlaps(bounds, visual))
      assert.ok(visual.maxY <= bounds.minY + 1e-7, `${visual.name} covers valid cushion ${x}, ${z}, ${yaw} at Y=${visual.maxY}`);
  }
  assert.ok(accepted > 100, `all ${accepted} accepted grid/rotation placements checked`);
  const pillowReservation = { minX: -4.296, maxX: -3.304, minZ: 2.63, maxZ: 3.11 };
  for (const name of ["pillow", "pillow_piping"]) {
    const bounds = visuals.find(visual => visual.name === name);
    for (const axis of ["X", "Z"]) {
      assert.ok(bounds[`min${axis}`] >= pillowReservation[`min${axis}`] - 1e-7);
      assert.ok(bounds[`max${axis}`] <= pillowReservation[`max${axis}`] + 1e-7);
    }
  }
  for (const visual of visuals.filter(visual => visual.name.startsWith("headboard"))) assert.ok(visual.minZ >= 3.2, "raised headboard stays beyond placement surface");
});

test('refined bedding bindings and cabinet hardware remain structural, within saved clearances', () => {
  const r = rig(), bed = find(r.root, 'personal_bed'), storage = find(r.root, 'personal_bookshelf');
  for (const name of ['duvet_edge_binding', 'duvet_fold_seam']) {
    const detail = find(bed, name); assert.ok(detail);
    for (const point of vertexPoints(detail).map(p => inAnchor(p, detail, bed))) assert.ok(point[1] <= .43 + 1e-7);
  }
  for (let i = 0; i < 2; i++) {
    const door = find(storage, `wardrobe_door_${i}`);
    assert.ok(find(door, 'pull_backplate')); assert.equal(find(door, 'ivory_panel').render.type, 'asset');
  }
});
for (const failMesh of [false, true]) test(`fuller plant remains inside fixed footprint including primitive fallback: ${failMesh}`, () => {
  const r = rig({failMesh}), plant = find(r.root, 'personal_plant');
  for (const entity of flatten(plant)) for (const point of vertexPoints(entity).map(p => inAnchor(p, entity, plant))) {
    assert.ok(Math.abs(point[0]) <= .225 + 1e-7 && Math.abs(point[2]) <= .225 + 1e-7, `${entity.name} widened past plant collision`);
    assert.ok(point[1] >= -1e-7 && point[1] <= .8 + 1e-7, `${entity.name} out of plant height: ${point[1]}`);
  }
});
