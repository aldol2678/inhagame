import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPersonalRoomChairModel, PERSONAL_ROOM_CHAIR_MODEL_URL } from "../src/rooms/personal-room-chair-model.js";
import { PERSONAL_ROOM_BASIC_FURNITURE } from "../src/rooms/personal-room-layout.js";
import { createRoomWorldAdapter } from "../src/rooms/room-world-adapter.js";
import { ROOMS } from "../src/rooms/room-registry.js";

function rig({ loadError = null, instantiateError = false, attachError = false } = {}) {
  let callback, destroyRoot;
  const calls = [], children = [];
  const model = {
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
  const ensure = createPersonalRoomChairModel({ app, root, anchor, fallback });
  return { root, model, fallback, calls, children, ensure,
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
  assert.deepEqual(r.model.scale, [0.5, 0.5, 0.5]);
  assert.deepEqual(r.model.angles, [0, 180, 0]);
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

test("vendored chair dependencies resolve locally and decoded bounds fit the fixed chair footprint", () => {
  const base = new URL("../assets/kaykit/furniture-bits/", import.meta.url);
  const gltf = JSON.parse(readFileSync(new URL("chair_A.gltf", base), "utf8"));
  assert.equal(gltf.asset.version, "2.0");
  for (const resource of [...gltf.buffers, ...gltf.images]) {
    assert.match(resource.uri, /^[\w-]+\.(bin|png)$/);
    const bytes = readFileSync(new URL(resource.uri, base));
    assert.ok(bytes.length > 0);
    if (resource.byteLength) assert.equal(bytes.length, resource.byteLength);
  }
  const buffer = readFileSync(new URL(gltf.buffers[0].uri, base));
  const primitive = gltf.meshes[0].primitives[0];
  const positions = gltf.accessors[primitive.attributes.POSITION];
  const view = gltf.bufferViews[positions.bufferView];
  assert.equal(positions.componentType, 5126);
  assert.equal(positions.type, "VEC3");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let highBackZ = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const offset = (view.byteOffset ?? 0) + (positions.byteOffset ?? 0) + i * (view.byteStride ?? 12);
    const point = [0, 1, 2].map(axis => buffer.readFloatLE(offset + axis * 4));
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
    if (point[1] > 0.9) highBackZ = Math.max(highBackZ, point[2]);
  }
  assert.deepEqual(min, positions.min);
  assert.deepEqual(max, positions.max);
  assert.ok(Math.abs(min[1]) < 1e-7, "source pivot is on the floor");
  assert.ok(highBackZ < 0, "backrest needs a half turn to match the original chair");
  const chair = PERSONAL_ROOM_BASIC_FURNITURE.find(item => item.kind === "chair");
  assert.deepEqual(chair.at, [2.95, 0, 0.85]);
  assert.equal(chair.collide, false);
  assert.ok((max[0] - min[0]) * 0.5 < chair.size[0]);
  assert.ok((max[2] - min[2]) * 0.5 < chair.size[2]);
  assert.ok(max[1] * 0.5 < 0.65, "chair remains below normal furniture height");
  assert.match(readFileSync(new URL("License.txt", base), "utf8"), /Creative Commons Zero, CC0/);
});
