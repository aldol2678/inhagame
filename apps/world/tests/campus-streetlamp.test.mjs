import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWorld } from '../src/editor/world-schema.js';
import { OBSTACLES, TOUR_STOPS } from '../src/campus-layout.js';
import { canOccupy, moveAroundObstacles, cameraSafeFraction } from '../src/world-collision.js';
import { WALK_SHAPE, MOUNT_SHAPE, PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { CAMPUS_BENCH_WORLD, CAMPUS_BENCH_COLLIDER } from '../src/campus-bench-layout.js';
const layout = async () => {
  assert.ok(existsSync(new URL('../src/campus-streetlamp-layout.js', import.meta.url)), 'streetlamp placement must exist');
  return import('../src/campus-streetlamp-layout.js');
};
const ownerModule = async () => {
  assert.ok(existsSync(new URL('../src/campus-streetlamp-runtime.js', import.meta.url)), 'streetlamp runtime must exist');
  return import('../src/campus-streetlamp-runtime.js');
};

test('approved streetlamp GLB/source record retain exact portable Drive bytes', () => {
  const path = new URL('../assets/prop_streetlamp_campus_001.glb', import.meta.url);
  assert.ok(existsSync(path), 'approved source GLB must be present');
  const bytes = readFileSync(path), hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, 12736);
  assert.equal(hash, '62c81c051fda70edaf155bdb0f68c2accd6f97854fc942bfe758f07a829b0575');
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.meshes.length, 5); assert.equal(gltf.materials.length, 2);
  assert.equal(gltf.meshes.flatMap(m => m.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0), 220);
  assert.ok(gltf.buffers.every(b => !b.uri)); assert.ok((gltf.images ?? []).every(i => !i.uri));
  assert.equal(gltf.materials.find(m => m.name === 'Lamp_Diffuser').emissiveFactor, undefined, 'original is deliberately unmodified/non-emissive');
  const records = JSON.parse(readFileSync(new URL('../../../ASSET_PROVENANCE.json', import.meta.url))).assets;
  const record = records.find(a => a.path === 'apps/world/assets/prop_streetlamp_campus_001.glb');
  assert.equal(record?.sha256, hash);
  assert.equal(record?.source, 'https://drive.google.com/file/d/1eR5O5uNy30D8zZBy5jh1HkK0vsYZRaHz/view');
});

test('streetlamp uses one unique standard WorldDocument with valid grounded placement beside bench', async () => {
  const { CAMPUS_STREETLAMP_WORLD: w, CAMPUS_STREETLAMP_COLLIDERS: boxes } = await layout();
  assert.equal(validateWorld(w).valid, true); assert.equal(w.assets.length, 1); assert.equal(w.entities.length, 1);
  assert.equal(w.assets[0].id, 'PROP_STREETLAMP_CAMPUS_001'); assert.equal(w.assets[0].uri, '/assets/prop_streetlamp_campus_001.glb');
  assert.equal(new Set([...CAMPUS_BENCH_WORLD.assets, ...w.assets].map(a => a.id)).size, 2);
  const e = w.entities[0], [x, y, z] = e.transform.position.map(v => v / 2);
  assert.equal(e.components['core.renderable'].assetId, w.assets[0].id);
  assert.deepEqual(e.transform.rotation, [0, 0, 0, 1]); assert.deepEqual(e.transform.scale, [1, 1, 1]);
  assert.ok(e.transform.position.every(Number.isFinite)); assert.equal(y, .018);
  assert.equal(getPlaceZoneAt({ x, z }).id, 'AREA_JUNGSEOK_WOONAM');
  const lawn = SITE_FEATURES.find(f => f.id === 'site_218215618');
  for (const b of boxes) {
    assert.ok(b.polygon.every(p => polygonOverlap(p.x, p.z, lawn.vertices)));
    assert.equal(OBSTACLES.filter(o => o.id === b.id).length, 1);
    assert.ok([b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].every(Number.isFinite));
    assert.ok(b.maxX > b.minX && b.maxY > b.minY && b.maxZ > b.minZ);
  }
  assert.ok(TOUR_STOPS.every(s => Math.hypot(x - s.x, z - s.z) > s.radius + 1));
  assert.ok(canOccupy({ x, y: PLAYER_ORIGIN_Y, z }, { ...WALK_SHAPE, radius: .9 }, OBSTACLES.filter(b => !boxes.includes(b))));
  assert.ok(x > CAMPUS_BENCH_COLLIDER.maxX + 1 || x < CAMPUS_BENCH_COLLIDER.minX - 1 || z > CAMPUS_BENCH_COLLIDER.maxZ + 1 || z < CAMPUS_BENCH_COLLIDER.minZ - 1);
});

test('base/pole proxies block four approaches, permit escape and never collide with head width', async () => {
  const { CAMPUS_STREETLAMP_WORLD: w, CAMPUS_STREETLAMP_COLLIDERS: boxes } = await layout();
  const [x, , z] = w.entities[0].transform.position.map(v => v / 2), y = PLAYER_ORIGIN_Y;
  const base = boxes.find(b => b.id.endsWith('.base')), pole = boxes.find(b => b.id.endsWith('.pole'));
  assert.ok(base && pole); assert.equal(boxes.length, 2);
  assert.ok(Math.abs(base.maxX - base.minX - .18) < 1e-8); assert.ok(Math.abs(pole.maxX - pole.minX - .065) < 1e-8);
  assert.equal(canOccupy({ x, y, z }), false);
  for (const [start, dx, dz, axis, edge] of [
    [{ x: base.minX - .6, y, z }, 2, 0, 'x', base.minX - WALK_SHAPE.radius],
    [{ x: base.maxX + 1, y, z }, -2, 0, 'x', base.maxX + WALK_SHAPE.radius],
    [{ x, y, z: base.minZ - 1 }, 0, 2, 'z', base.minZ - WALK_SHAPE.radius],
    [{ x, y, z: base.maxZ + 1 }, 0, -2, 'z', base.maxZ + WALK_SHAPE.radius]
  ]) {
    assert.ok(canOccupy(start), 'every approach begins outside bench and lamp collision');
    const stopped = moveAroundObstacles(start, dx, dz);
    assert.ok(Math.abs(stopped[axis] - edge) < 2e-5);
    const retreat = moveAroundObstacles({ ...start, ...stopped }, -dx, -dz);
    assert.ok(canOccupy({ ...start, ...retreat }));
  }
  assert.equal(canOccupy({ x, y: 1.6, z }, { ...WALK_SHAPE, radius: .01 }), false);
  assert.equal(canOccupy({ x: x + .3, y: 1.6, z }, { ...WALK_SHAPE, radius: .01 }), true, 'head itself is non-solid');
  assert.equal(canOccupy({ x, y, z }, MOUNT_SHAPE), false);
  assert.equal(canOccupy({ x, y: pole.maxY + PLAYER_ORIGIN_Y + .1, z }, MOUNT_SHAPE), true);
  assert.ok(cameraSafeFraction([x, 1, z - 1], [x, 1, z + 1]) < 1);
  assert.equal(cameraSafeFraction([x, 2.2, z - 1], [x, 2.2, z + 1]), 1, 'camera clears pole above existing .35 padding');
});

test('NPC occupancy and guidance both receive the tall pole proxy off existing routes', async () => {
  const { CAMPUS_STREETLAMP_WORLD: w } = await layout();
  const [x, , z] = w.entities[0].transform.position.map(v => v / 2), point = { x, z };
  const { createNpcNavigator } = await import('../npc-factory/dev-navigation.mjs');
  const { campusNavGraph, isCampusPointBlocked } = await import('../src/navigation/campus-navigation.js');
  const n = createNpcNavigator(null, { additionalAnchors: [point] });
  assert.equal(n.walkable(point), false); assert.equal(isCampusPointBlocked(point), true);
  assert.ok(campusNavGraph().nearestEdgePoint(point, { maxDistance: 20 }).distance > 3.3);
});

function context({ cache = new Map(), wait = Promise.resolve(), fail = false } = {}) {
  const roots = [], loads = [], materials = [], visuals = [];
  const node = name => ({ name, children: [] });
  const original = { name: 'Lamp_Diffuser', emissive: { value: [0, 0, 0] }, clone() { const clone = { name: this.name, emissive: { set(...v) { this.value = v; } }, update() { this.updated = true; }, destroy() { this.destroyed = true; } }; materials.push(clone); return clone; } };
  const ctx = { assetCache: cache, roots, loads, materials, visuals, original, released: 0,
    loadAsset: async uri => { loads.push(uri); await wait; if (fail) throw Error('fixture load failed'); return { uri }; },
    resolveAssetUri: a => a.uri,
    createRoot: w => { const n = node(w.worldId); roots.push(n); return n; }, createEntity: e => node(e.name),
    attach: (p, c) => { p.children.push(c); c.parent = p; }, setLocalTransform: (n, t) => { n.transform = t; },
    createRenderable: () => { const mesh = { material: original }, v = { ...node('visual'), findComponents: () => [{ meshInstances: [mesh] }], on: (event, f) => { v.destroyCallback = f; }, destroy() { v.destroyed = (v.destroyed ?? 0) + 1; v.destroyCallback?.(); }, mesh }; visuals.push(v); return v; },
    createPlaceholder: () => node('missing'),
    destroyRoot: r => { r.destroyed = true; for (const e of r.children) for (const v of e.children) v.destroyCallback?.(); r.children.length = 0; },
    dispose: () => { ctx.released++; }
  }; return ctx;
}

test('shared owner reuses resolver cache, destroys cloned emissive once and recreates only one instance', async () => {
  const { createCampusStreetlampRuntime } = await ownerModule();
  const cache = new Map();
  for (let cycle = 0; cycle < 2; cycle++) {
    const c = context({ cache }), owner = createCampusStreetlampRuntime(c), r = await owner.ready;
    assert.equal(r.state, 'ready'); assert.equal(r.bindings.size, 1); assert.equal(c.loads.length, cycle === 0 ? 1 : 0);
    assert.equal(owner.status().assetId, 'PROP_STREETLAMP_CAMPUS_001');
    assert.equal(c.materials.length, 1); assert.equal(c.visuals[0].mesh.material, c.materials[0]);
    assert.deepEqual(c.original.emissive.value, [0, 0, 0], 'cached imported material must remain untouched');
    assert.deepEqual(c.materials[0].emissive.value, [.92, .8, .55]); assert.equal(c.materials[0].emissiveIntensity, 0);
    assert.equal(c.materials[0].updated, true);
    await owner.dispose(); await owner.dispose();
    assert.equal(r.bindings.size, 0); assert.equal(c.released, 1); assert.equal(c.materials[0].destroyed, true);
    assert.equal(owner.status().state, 'disposed');
  }
});

test('loaded lamp registers one shared-budget source and unregisters before material disposal', async () => {
  const { createCampusStreetlampRuntime } = await ownerModule();
  const { CAMPUS_STREETLAMP_LIGHT: lamp } = await layout();
  const c = context(), registered = [];
  let released = 0;
  const nightStreetLights = { registerLamp(source) {
    registered.push(source);
    source.setArtificialLightFactor(.18);
    return () => { assert.notEqual(c.materials[0].destroyed, true); released++; };
  } };
  const owner = createCampusStreetlampRuntime(c, { nightStreetLights });
  await owner.ready;
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'prop.campus-streetlamp-001');
  assert.deepEqual(registered[0].head, lamp.head);
  assert.equal(c.materials[0].emissiveIntensity, .18 * 3.2);
  registered[0].setArtificialLightFactor(1);
  assert.equal(c.materials[0].emissiveIntensity, 3.2);
  registered[0].setArtificialLightFactor(0);
  assert.equal(c.materials[0].emissiveIntensity, 0);
  await owner.dispose(); await owner.dispose();
  assert.equal(released, 1);
  assert.deepEqual(c.original.emissive.value, [0, 0, 0]);
});

test('light head derives from the approved diffuser and the same document transform', async () => {
  const { CAMPUS_STREETLAMP_LIGHT: lamp, CAMPUS_STREETLAMP_WORLD: world } = await layout();
  assert.ok(lamp, 'shared-pool light descriptor exists');
  const bytes = readFileSync(new URL('../assets/prop_streetlamp_campus_001.glb', import.meta.url));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const mesh = gltf.meshes.find(m => m.name === 'DiffuserMesh');
  const bounds = gltf.accessors[mesh.primitives[0].attributes.POSITION];
  const expected = bounds.min.map((v, axis) => (world.entities[0].transform.position[axis] + (v + bounds.max[axis]) / 2) / 2);
  [lamp.head.x, lamp.head.y, lamp.head.z].forEach((v, axis) => assert.ok(Math.abs(v - expected[axis]) < 1e-6));
  assert.ok(lamp.range > lamp.head.y && lamp.range <= 4);
});

test('pending or failed streetlamp loading disposes without late visuals/material leaks', async () => {
  const { createCampusStreetlampRuntime } = await ownerModule();
  let registrations = 0, unregistered = 0;
  const nightStreetLights = { registerLamp() { registrations++; return () => unregistered++; } };
  let release; const c = context({ wait: new Promise(r => { release = r; }) }), o = createCampusStreetlampRuntime(c, { nightStreetLights });
  const pending = o.dispose(); release(); await pending;
  assert.equal(o.status().state, 'disposed'); assert.equal(c.released, 1); assert.equal(c.materials[0].destroyed, true);
  assert.equal(registrations, 1); assert.equal(unregistered, 1, 'late-loaded light registration is immediately released');
  const failed = context({ fail: true }), missing = createCampusStreetlampRuntime(failed, { nightStreetLights }); await missing.ready;
  assert.equal(missing.status().state, 'ready-with-warnings'); assert.equal(missing.status().diagnostics[0].code, 'R_ASSET_LOAD_FAILED');
  await missing.dispose(); assert.equal(failed.materials.length, 0); assert.equal(failed.released, 1); assert.equal(failed.assetCache.size, 0);
  assert.equal(registrations, 1, 'failed source never registers a light');
});


test('rejected light registration destroys the unattached visual and cloned material', async () => {
  const { createCampusStreetlampRuntime } = await ownerModule();
  const c = context(), owner = createCampusStreetlampRuntime(c, {
    nightStreetLights: { registerLamp() { throw new Error('Lamp already registered: prop.campus-streetlamp-001'); } }
  });
  await owner.ready;
  assert.equal(owner.status().state, 'ready-with-warnings');
  assert.equal(c.visuals[0].destroyed, 1);
  assert.equal(c.materials[0].destroyed, true);
  assert.deepEqual(c.original.emissive.value, [0, 0, 0]);
  await owner.dispose();
  assert.equal(c.visuals[0].destroyed, 1, 'rejected visual is never attached or destroyed twice');
});
