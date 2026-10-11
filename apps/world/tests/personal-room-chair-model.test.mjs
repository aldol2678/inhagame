import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPersonalRoomChairModel, PERSONAL_ROOM_CHAIR_MODEL_URL } from "../src/rooms/personal-room-chair-model.js";
import { PERSONAL_ROOM_CHAIR_PARTS, buildPersonalRoomChairGeometry } from "../src/rooms/personal-room-chair-design.js";
import { generatePersonalRoomChairGlb } from "../../../tools/world-assets/generate-personal-room-chair.mjs";
import { PERSONAL_ROOM_BASIC_FURNITURE } from "../src/rooms/personal-room-layout.js";
import { createRoomWorldAdapter } from "../src/rooms/room-world-adapter.js";
import { ROOMS } from "../src/rooms/room-registry.js";

function rig({ loadError = null, instantiateError = false, attachError = false, materialError = false, bindMaterials = false } = {}) {
  let callback, destroyRoot;
  const calls = [], children = [];
  const sharedMaterial = { name: 'woodOak', unchanged: true }, roomMaterial = { name: 'room-owned-oak' };
  const instance = { material: sharedMaterial };
  const materials = bindMaterials ? { get(name) { assert.equal(name, 'woodOak'); if (materialError) throw Error('material unavailable'); return roomMaterial; } } : undefined;
  const model = {
    findComponents: () => [{ meshInstances: [instance] }],
    destroyed: false,
    setLocalPosition: (...v) => { model.position = v; },
    setLocalScale: (...v) => { model.scale = v; },
    setLocalEulerAngles: (...v) => { model.angles = v; },
    destroy() { this.destroyed = true; }
  };
  const app = { assets: { loadFromUrl(url, type, cb) {
    calls.push({ url, type });
    if (loadError) throw loadError;
    callback = cb;
  } } };
  const root = { enabled: false, once(event, cb) { assert.equal(event, "destroy"); destroyRoot = cb; } };
  const anchor = { addChild(child) {
    if (attachError) throw new Error("attachment failed");
    children.push(child);
  } };
  const fallback = { enabled: true };
  let instances = 0;
  const asset = { resource: { instantiateRenderEntity(options) {
    instances++;
    assert.deepEqual(options, { castShadows: true, receiveShadows: true });
    if (instantiateError) throw new Error("instance failed");
    return model;
  } } };
  const ensure = createPersonalRoomChairModel({ app, root, anchor, fallback, materials });
  return { root, model, fallback, calls, children, ensure, sharedMaterial, roomMaterial, instance,
    complete: (error = null, value = asset) => callback(error, value),
    destroy: () => destroyRoot(), instances: () => instances };
}

test("chair load is lazy and concurrent/repeated activations share one instance", async () => {
  const r = rig();
  assert.equal(r.calls.length, 0);
  const first = r.ensure();
  assert.strictEqual(r.ensure(), first);
  await Promise.resolve();
  assert.deepEqual(r.calls, [{ url: PERSONAL_ROOM_CHAIR_MODEL_URL, type: "container" }]);
  assert.equal(r.fallback.enabled, true, "existing chair stays visible while loading");
  assert.deepEqual(r.children, []);
  r.complete();
  assert.equal(await first, true);
  assert.equal(r.fallback.enabled, false);
  assert.deepEqual(r.children, [r.model]);
  assert.deepEqual(r.model.position, [0, 0, 0]);
  assert.deepEqual(r.model.scale, [1, 1, 1]);
  assert.deepEqual(r.model.angles, [0, 0, 0]);
  assert.strictEqual(r.ensure(), first);
  assert.equal(await r.ensure(), true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.instances(), 1);
});

for (const [label, error, asset] of [
  ["network or dependency failure", new Error("load failed"), undefined],
  ["missing asset", null, null],
  ["missing container resource", null, {}]
]) {
  test(`${label} retains the fallback and does not retry on re-entry`, async () => {
    const r = rig(), pending = r.ensure();
    await Promise.resolve();
    r.complete(error, asset);
    assert.equal(await pending, false);
    assert.equal(r.fallback.enabled, true);
    assert.deepEqual(r.children, []);
    assert.strictEqual(r.ensure(), pending);
    assert.equal(r.calls.length, 1);
  });
}

for (const options of [{ loadError: new Error("registry unavailable") }, { instantiateError: true }, { attachError: true }]) {
  test(`synchronous ${Object.keys(options)[0]} leaves a usable chair`, async () => {
    const r = rig(options), pending = r.ensure();
    await Promise.resolve();
    if (!options.loadError) r.complete();
    assert.equal(await pending, false);
    assert.equal(r.fallback.enabled, true);
    assert.deepEqual(r.children, []);
    if (options.attachError) assert.equal(r.model.destroyed, true, "unattached instance is cleaned up");
  });
}

test("leaving before completion finishes under the hidden root and re-entry reuses it", async () => {
  const r = rig();
  r.root.enabled = true;
  const pending = r.ensure();
  await Promise.resolve();
  r.root.enabled = false;
  r.complete();
  assert.equal(await pending, true);
  assert.equal(r.root.enabled, false, "loader must not reactivate a room");
  r.root.enabled = true;
  assert.equal(await r.ensure(), true);
  assert.equal(r.children.length, 1);
});

test("destroying a pending scene ignores the late callback without instantiating", async () => {
  const r = rig(), pending = r.ensure();
  await Promise.resolve();
  r.destroy();
  r.complete();
  assert.equal(await pending, false);
  assert.equal(r.instances(), 0);
  assert.deepEqual(r.children, []);
  assert.equal(await r.ensure(), false);
  assert.equal(r.calls.length, 1);
});

test("destroy before the request starts performs no asset request", async () => {
  const r = rig(), pending = r.ensure();
  r.destroy();
  assert.equal(await pending, false);
  assert.equal(await r.ensure(), false);
  assert.equal(r.calls.length, 0);
});

test("room activation starts optional visuals without waiting and other rooms remain supported", async () => {
  const r = rig();
  const scene = { root: r.root, ensureVisualAssets: r.ensure };
  const other = { root: { enabled: false } };
  const controller = { setMovementSpace(space) { this.space = space; } };
  const player = { reparent(root) { this.parent = root; } };
  const adapter = createRoomWorldAdapter({
    player, controller, orbit: { setIndoor() {} }, campusRoot: { enabled: true },
    getRoomScene: room => room.id === "ROOM_PERSONAL_BASIC" ? scene : other
  });
  adapter.showRoom(ROOMS.ROOM_CLUBHOUSE_01);
  assert.equal(r.calls.length, 0);
  adapter.showRoom(ROOMS.ROOM_PERSONAL_BASIC);
  assert.equal(controller.space.id, "ROOM_PERSONAL_BASIC", "movement is ready before model load");
  assert.strictEqual(player.parent, r.root);
  await Promise.resolve();
  assert.equal(r.calls.length, 1);
  adapter.showRoom(ROOMS.ROOM_CLUBHOUSE_01);
  r.complete(new Error("offline"));
  assert.equal(await r.ensure(), false);
  assert.equal(r.root.enabled, false);
  adapter.showRoom(ROOMS.ROOM_PERSONAL_BASIC);
  assert.equal(r.fallback.enabled, true);
  assert.equal(r.calls.length, 1);
});

test("loaded chair binds room-owned materials without mutating shared asset materials", async () => {
  const r = rig({ bindMaterials: true }), pending = r.ensure();
  await Promise.resolve(); r.complete();
  assert.equal(await pending, true);
  assert.strictEqual(r.instance.material, r.roomMaterial);
  assert.deepEqual(r.sharedMaterial, { name: 'woodOak', unchanged: true });
  assert.equal(r.model.name, 'personal_chair_oak_linen');
});

test("material preparation failure cleans the candidate and retains the visible fallback", async () => {
  const r = rig({ bindMaterials: true, materialError: true }), pending = r.ensure();
  await Promise.resolve(); r.complete();
  assert.equal(await pending, false);
  assert.equal(r.model.destroyed, true);
  assert.equal(r.fallback.enabled, true);
  assert.equal(r.children.length, 0);
  assert.deepEqual(r.sharedMaterial, { name: 'woodOak', unchanged: true });
});

function decodeChair() {
  const file = readFileSync(new URL('../assets/rooms/personal-v2/fixed-chair-oak-linen.glb', import.meta.url));
  assert.equal(file.readUInt32LE(0), 0x46546c67); assert.equal(file.readUInt32LE(4), 2); assert.equal(file.readUInt32LE(8), file.length);
  const jsonLength = file.readUInt32LE(12), gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  const binary = file.subarray(28 + jsonLength);
  return { file, gltf, binary };
}

test("self-authored GLB is deterministic, dependency-free and bounded to the fixed chair", () => {
  const { file, gltf, binary } = decodeChair();
  assert.deepEqual(file, generatePersonalRoomChairGlb(), 'committed binary is reproducible from owned source');
  assert.equal(gltf.asset.version, '2.0'); assert.ok(file.length < 30000);
  assert.equal(gltf.images, undefined); assert.equal(gltf.textures, undefined);
  assert.ok(gltf.buffers.every(b => b.uri === undefined)); assert.equal(gltf.buffers[0].byteLength, binary.length);
  assert.deepEqual(gltf.materials.map(m => m.name), ['woodOak', 'fabricLinenSeam', 'fabricLinen', 'woodOakDark']);
  assert.equal(gltf.nodes.length, PERSONAL_ROOM_CHAIR_PARTS.length);
  const chair = PERSONAL_ROOM_BASIC_FURNITURE.find(item => item.kind === 'chair');
  assert.deepEqual(chair.at, [2.95, 0, .85]); assert.deepEqual([chair.size[0], chair.size[2]], [.55, .55]); assert.equal(chair.collide, false);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of gltf.nodes) {
    const part = PERSONAL_ROOM_CHAIR_PARTS.find(p => p.name === node.name);
    assert.deepEqual(node.translation, part.at); assert.deepEqual(node.scale, part.size);
    const primitive = gltf.meshes[node.mesh].primitives[0], positions = gltf.accessors[primitive.attributes.POSITION];
    assert.equal(gltf.materials[primitive.material].name, part.material);
    assert.equal(positions.componentType, 5126); assert.equal(positions.type, 'VEC3');
    const view = gltf.bufferViews[positions.bufferView], expected = buildPersonalRoomChairGeometry(part.shape).positions;
    let partTop = -Infinity, backMinZ = Infinity;
    for (let i = 0; i < positions.count; i++) for (let axis = 0; axis < 3; axis++) {
      const local = binary.readFloatLE((view.byteOffset ?? 0) + i * 12 + axis * 4);
      assert.ok(Math.abs(local - expected[i * 3 + axis]) < 1e-7, 'asset and fallback geometry agree');
      const value = local * node.scale[axis] + node.translation[axis];
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
      if (axis === 1) partTop = Math.max(partTop, value);
      if (axis === 2) backMinZ = Math.min(backMinZ, value);
    }
    if (node.name === 'seat') assert.ok(Math.abs(partTop - .27) < 1e-7, 'seat support top stays exactly .27');
    if (node.name.startsWith('back')) assert.ok(backMinZ > .15, 'back remains at +Z');
  }
  assert.ok(Math.abs(min[1]) < 1e-7); assert.ok(max[1] < .60);
  for (const axis of [0, 2]) { assert.ok(min[axis] >= -chair.size[axis] / 2); assert.ok(max[axis] <= chair.size[axis] / 2); }
  assert.match(readFileSync(new URL('../assets/rooms/personal-v2/README.md', import.meta.url), 'utf8'), /original procedural geometry/);
});

for (const shape of ['timber', 'cushion', 'leg']) test(`chair ${shape} geometry is finite and closed`, () => {
  const mesh = buildPersonalRoomChairGeometry(shape), edges = new Map();
  assert.ok([...mesh.positions, ...mesh.normals, ...mesh.uvs].every(Number.isFinite));
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.uvs.length * 3, mesh.positions.length * 2);
  assert.ok(mesh.indices.length / 3 <= 224);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3);
    for (let j = 0; j < 3; j++) { const key = [ids[j], ids[(j + 1) % 3]].sort((a, b) => a - b).join(':'); edges.set(key, (edges.get(key) ?? 0) + 1); }
  }
  assert.ok([...edges.values()].every(n => n === 2));
});
