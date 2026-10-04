import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlatNavigationSurface,
  createRecastNpcNavigator,
  routeLength
} from '../npc-factory/recast-navigator-poc.mjs';

test('Recast NPC PoC builds a conservative flat surface from the existing navigator contract', () => {
  const navigator = {
    bounds: { minX: 0, maxX: 3, minZ: 0, maxZ: 3 },
    walkable: () => true
  };
  const surface = buildFlatNavigationSurface(navigator, { tileSize: 1.5 });
  assert.equal(surface.tiles, 4);
  assert.equal(surface.indices.length, surface.tiles * 6);
  assert.equal(surface.positions.length, surface.tiles * 12);
});

test('Recast NPC PoC rejects a surface with no fully walkable tiles', () => {
  const navigator = {
    bounds: { minX: 0, maxX: 1.5, minZ: 0, maxZ: 1.5 },
    walkable: ({ x, z }) => !(x === 0 && z === 0)
  };
  assert.throws(() => buildFlatNavigationSurface(navigator, { tileSize: 1.5 }), /no walkable triangles/);
});

test('Recast NPC PoC preserves the navigator interface and can be dependency-injected in CI', async () => {
  let destroyed = 0;
  const base = {
    bounds: { minX: 0, maxX: 3, minZ: 0, maxZ: 3 },
    walkable: () => true,
    segmentSafe: () => true,
    route: (from, to) => [to],
    networkRoute: null
  };
  class FakeQuery {
    computePath(from, to) {
      return { success: true, path: [from, { x: 1.5, y: 0, z: 1.5 }, to] };
    }
    destroy() { destroyed++; }
  }
  const loader = async () => ({
    core: { init: async () => {}, NavMeshQuery: FakeQuery },
    generators: {
      generateSoloNavMesh: () => ({
        success: true,
        navMesh: { destroy() { destroyed++; } }
      })
    }
  });

  const navigator = await createRecastNpcNavigator(base, { loader, tileSize: 1.5 });
  const from = { x: 0.25, z: 0.25 };
  const to = { x: 2.75, z: 2.75 };
  const route = navigator.route(from, to);
  assert.deepEqual(route.at(-1), to);
  assert.ok(routeLength(from, route) > 0);
  assert.equal(navigator.recast.packageVersion, '0.43.1');
  navigator.destroy();
  assert.equal(destroyed, 2);
});
