import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWorld } from '../src/editor/world-schema.js';
import { OBSTACLES, TOUR_STOPS } from '../src/campus-layout.js';
import { canOccupy, moveAroundObstacles, resolveHeight, cameraSafeFraction } from '../src/world-collision.js';
import { WALK_SHAPE, MOUNT_SHAPE, PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { polygonOverlap } from '../src/polygon-collision.js';

const benchLayout = () => import('../src/campus-bench-layout.js');

const assetUrl = new URL('../assets/prop_bench_campus_001.glb', import.meta.url);

test('approved campus bench is present byte-for-byte as a self-contained GLB 2', () => {
  assert.ok(existsSync(assetUrl), 'the approved bench must be added to the public asset directory');
  const bytes = readFileSync(assetUrl);
  assert.equal(bytes.length, 128636);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '765066e241469666dcc7671a994968b63e9899886cd3bb0f315b305995e5a74d');
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.meshes.length, 2);
  assert.equal(gltf.materials.length, 2);
  assert.equal(gltf.meshes.flatMap(mesh => mesh.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0), 972);
  assert.ok(gltf.buffers.every(buffer => !buffer.uri));
  assert.ok(gltf.images.every(image => !image.uri && Number.isInteger(image.bufferView)));
  for (const node of gltf.nodes) {
    assert.deepEqual(node.translation ?? [0, 0, 0], [0, 0, 0]);
    assert.deepEqual(node.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1]);
    assert.deepEqual(node.scale ?? [1, 1, 1], [1, 1, 1]);
  }
});

test('one standard WorldDocument asset/entity supplies the placement and persistent collision', async () => {
  const { CAMPUS_BENCH_WORLD: world, CAMPUS_BENCH_COLLIDER: box } = await benchLayout();
  assert.equal(validateWorld(world).valid, true);
  assert.equal(world.assets.length, 1);
  assert.equal(world.assets[0].id, 'PROP_BENCH_CAMPUS_001');
  assert.equal(world.assets[0].uri, '/assets/prop_bench_campus_001.glb');
  assert.equal(world.entities.length, 1);
  const entity = world.entities[0];
  assert.equal(entity.components['core.renderable'].assetId, world.assets[0].id);
  assert.deepEqual(entity.transform.rotation, [0, 0, 0, 1]);
  assert.deepEqual(entity.transform.scale, [1, 1, 1]);
  const [x, y, z] = entity.transform.position.map(value => value / 2);
  assert.ok([x, y, z, ...Object.values(box).filter(value => typeof value === 'number')].every(Number.isFinite));
  assert.ok(Math.abs(x - -2.174096721993891) < 1e-8);
  assert.ok(Math.abs(z - -13.46121105869368) < 1e-8);
  assert.equal(roadviewGroundHeight(x, z), 0);
  assert.equal(y, .018, 'origin sits on the existing rendered lawn surface');
  const lawn = SITE_FEATURES.find(feature => feature.id === 'site_218215618');
  assert.ok(box.polygon.every(point => polygonOverlap(point.x, point.z, lawn.vertices)), 'entire footprint has existing visible ground');
  assert.equal(getPlaceZoneAt({ x, z }).id, 'AREA_JUNGSEOK_WOONAM');
  assert.ok(TOUR_STOPS.every(stop => Math.hypot(x - stop.x, z - stop.z) > stop.radius + 1));
  assert.equal(box.minX, x - .45);
  assert.equal(box.maxX, x + .45);
  assert.equal(box.minZ, z - .165);
  assert.equal(box.maxZ, z + .12);
  assert.equal(box.minY, y);
  assert.equal(box.maxY, y + .4);
  assert.equal(OBSTACLES.filter(other => other.id === box.id).length, 1);
  assert.ok(canOccupy({ x, y: PLAYER_ORIGIN_Y, z }, { ...WALK_SHAPE, radius: .9 }, OBSTACLES.filter(other => other.id !== box.id)), 'rest space has clearance from pre-existing solids');
});

test('real collision authority blocks front, sides and back, slides free and supports height-aware flight/camera', async () => {
  const { CAMPUS_BENCH_COLLIDER: box } = await benchLayout();
  const x = (box.minX + box.maxX) / 2, z = (box.minZ + box.maxZ) / 2, y = PLAYER_ORIGIN_Y;
  assert.equal(canOccupy({ x, y, z }), false);
  for (const [start, dx, dz, axis, edge] of [
    [{ x: box.minX - 1, y, z }, 2, 0, 'x', box.minX - WALK_SHAPE.radius],
    [{ x: box.maxX + 1, y, z }, -2, 0, 'x', box.maxX + WALK_SHAPE.radius],
    [{ x, y, z: box.minZ - 1 }, 0, 2, 'z', box.minZ - WALK_SHAPE.radius],
    [{ x, y, z: box.maxZ + 1 }, 0, -2, 'z', box.maxZ + WALK_SHAPE.radius]
  ]) {
    const stopped = moveAroundObstacles(start, dx, dz);
    assert.ok(Math.abs(stopped[axis] - edge) < 2e-5, 'existing polygon sweep adds its 1e-5 separation epsilon');
    const backedOut = moveAroundObstacles({ ...start, ...stopped }, -dx, -dz);
    assert.ok(canOccupy({ ...start, ...backedOut }), 'player can retreat without getting stuck');
  }
  const along = moveAroundObstacles({ x: box.minX - WALK_SHAPE.radius, y, z }, 0, 1);
  assert.ok(along.z > box.maxZ + WALK_SHAPE.radius, 'edge slide escapes the end of the bench');
  assert.equal(canOccupy({ x, y, z }, MOUNT_SHAPE), false);
  assert.equal(canOccupy({ x, y: box.maxY + PLAYER_ORIGIN_Y + .1, z }, MOUNT_SHAPE), true);
  assert.equal(resolveHeight({ x, y: 3, z }, y), box.maxY + PLAYER_ORIGIN_Y);
  assert.ok(cameraSafeFraction([x, .2, z - 2], [x, .2, z + 2]) < 1);
  assert.equal(cameraSafeFraction([x, 2, z - 2], [x, 2, z + 2]), 1);
});

test('NPC grid receives the static proxy while low-prop campus guidance policy is unchanged', async () => {
  const { CAMPUS_BENCH_COLLIDER: box } = await benchLayout();
  const { createNpcNavigator } = await import('../npc-factory/dev-navigation.mjs');
  const { campusNavGraph, isCampusPointBlocked } = await import('../src/navigation/campus-navigation.js');
  const point = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  const navigator = createNpcNavigator(null, { additionalAnchors: [point] });
  assert.equal(navigator.walkable(point), false, 'NPC occupancy includes the one permanent collider');
  assert.equal(navigator.segmentSafe({ x: point.x - 2, z: point.z }, { x: point.x + 2, z: point.z }), false);
  assert.equal(isCampusPointBlocked(point), false, 'guidance deliberately excludes low props under 1.2 WU');
  assert.ok(campusNavGraph().nearestEdgePoint(point, { maxDistance: 20 }).distance > 3.3, 'bench stays off the existing guidance network');
});

function runtimeContext({ assetCache = new Map(), wait = Promise.resolve(), fail = false } = {}) {
  const roots = [], loads = [];
  const node = name => ({ name, parent: null, children: [], enabled: true });
  const context = {
    roots, loads, assetCache, released: 0,
    loadAsset: async uri => { loads.push(uri); await wait; if (fail) throw Error('fixture load failed'); return { uri }; },
    createRoot: world => { const root = node(world.worldId); roots.push(root); return root; },
    createEntity: entity => node(entity.name),
    attach: (parent, child) => { parent.children.push(child); child.parent = parent; },
    setLocalTransform: (object, transform) => { object.transform = structuredClone(transform); },
    createRenderable: asset => node(asset.uri),
    createPlaceholder: () => node('missing asset'),
    destroyRoot: root => { root.destroyed = true; root.children.length = 0; },
    dispose: () => { context.released++; }
  };
  return context;
}

test('existing runtime adapter caches one parse and disposes each instance before reload', async () => {
  const { createCampusBenchRuntime } = await import('../src/campus-bench-runtime.js');
  const assetCache = new Map();
  for (let cycle = 0; cycle < 2; cycle++) {
    const context = runtimeContext({ assetCache });
    const owner = createCampusBenchRuntime(context);
    const runtime = await owner.ready;
    assert.equal(runtime.state, 'ready');
    assert.equal(runtime.bindings.size, 1);
    const binding = [...runtime.bindings.values()][0];
    assert.equal(binding.components.get('core.renderable').placeholder, false);
    assert.equal(binding.runtimeObject.children.length, 1);
    assert.equal(context.loads.length, cycle === 0 ? 1 : 0);
    await owner.dispose();
    await owner.dispose();
    assert.equal(runtime.root, null);
    assert.equal(runtime.bindings.size, 0);
    assert.equal(context.released, 1);
    assert.ok(context.roots.every(root => root.destroyed && root.children.length === 0));
    assert.equal(owner.status().state, 'disposed');
  }
});

test('dispose during loading and a failed GLB leave no late instance or leaked context', async () => {
  const { createCampusBenchRuntime } = await import('../src/campus-bench-runtime.js');
  let release;
  const context = runtimeContext({ wait: new Promise(resolve => { release = resolve; }) });
  const owner = createCampusBenchRuntime(context);
  const disposal = owner.dispose();
  release();
  await disposal;
  assert.equal(owner.status().state, 'disposed');
  assert.equal(context.released, 1);
  assert.ok(context.roots.every(root => root.destroyed));
  const failed = runtimeContext({ fail: true });
  const missing = createCampusBenchRuntime(failed);
  await missing.ready;
  assert.equal(missing.status().state, 'ready-with-warnings');
  assert.equal(missing.status().diagnostics[0].code, 'R_ASSET_LOAD_FAILED');
  await missing.dispose();
  assert.equal(failed.released, 1);
  assert.equal(failed.assetCache.size, 0);
});
