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
    findNearestPoly(point) {
      return { success: true, nearestRef: point.x < 1 ? 1 : 2, nearestPoint: point };
    }
    findPath() {
      return { success: true, status: 0x40000000, polys: { size: 2, get: i => i + 1, destroy() {} } };
    }
    findStraightPath(from, to) {
      const values = [from.x, from.y, from.z, 1.5, 0, 1.5, to.x, to.y, to.z];
      return { success: true, status: 0x40000000, straightPathCount: 3,
        straightPath: { get: i => values[i], destroy() {} } };
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

async function regressionNavigator({ nearestRef = 2, pathStatus = 0x40000000, lastRef = 2,
  straightEnd = { x: 2.75, y: 0, z: 2.75 }, segmentSafe = () => true } = {}) {
  const freed = { corridor: 0, straight: 0, flags: 0, refs: 0, query: 0, mesh: 0 };
  let straightCalls = 0;
  class Query {
    findNearestPoly(point) {
      return { success: true, nearestRef: point.x < 1 ? 1 : nearestRef, nearestPoint: point };
    }
    findPath() {
      return { success: true, status: pathStatus,
        polys: { size: 2, get: i => i ? lastRef : 1, destroy: () => freed.corridor++ } };
    }
    findStraightPath(from) {
      straightCalls++;
      const values = [from.x, from.y, from.z, straightEnd.x, straightEnd.y, straightEnd.z];
      return { success: true, status: 0x40000000, straightPathCount: 2,
        straightPath: { get: i => values[i], destroy: () => freed.straight++ },
        straightPathFlags: { destroy: () => freed.flags++ },
        straightPathRefs: { destroy: () => freed.refs++ } };
    }
    destroy() { freed.query++; }
  }
  const nav = await createRecastNpcNavigator({
    bounds: { minX: 0, maxX: 3, minZ: 0, maxZ: 3 }, walkable: () => true, segmentSafe
  }, { loader: async () => ({
    core: { init: async () => {}, NavMeshQuery: Query },
    generators: { generateSoloNavMesh: () => ({ success: true, navMesh: { destroy: () => freed.mesh++ } }) }
  }) });
  return { nav, freed, straightCalls: () => straightCalls };
}
const from = { x: 0.25, z: 0.25 }, to = { x: 2.75, z: 2.75 };

test('successful nearest-poly call with ref=0 never counts as a route', async () => {
  const { nav } = await regressionNavigator({ nearestRef: 0 });
  assert.equal(nav.evaluateRoute(from, to).reason, 'NO_END_POLYGON');
  assert.equal(nav.route(from, to), null);
  nav.destroy();
});

test('partial, truncated and out-of-nodes paths are rejected and freed before straight-path lookup', async () => {
  for (const detail of [0x40, 0x10, 0x20]) {
    const { nav, freed, straightCalls } = await regressionNavigator({ pathStatus: 0x40000000 | detail });
    assert.equal(nav.evaluateRoute(from, to).reason, 'INCOMPLETE_PATH');
    assert.equal(straightCalls(), 0);
    assert.equal(freed.corridor, 1);
    nav.destroy();
  }
});

test('a corridor that stops on the wrong polygon cannot fabricate the destination', async () => {
  const { nav } = await regressionNavigator({ lastRef: 1 });
  assert.equal(nav.evaluateRoute(from, to).reason, 'INCOMPLETE_PATH');
  nav.destroy();
});

test('a shortened straight path cannot be completed by appending a distant endpoint', async () => {
  const { nav, freed } = await regressionNavigator({ straightEnd: { x: 1, y: 0, z: 1 } });
  assert.equal(nav.evaluateRoute(from, to).reason, 'ENDPOINT_NOT_REACHED');
  assert.deepEqual([freed.corridor, freed.straight, freed.flags, freed.refs], [1, 1, 1, 1]);
  nav.destroy();
});

test('a complete mesh path that crosses legacy-blocked space is rejected', async () => {
  const { nav } = await regressionNavigator({ segmentSafe: (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 3 });
  assert.equal(nav.evaluateRoute(from, to).reason, 'UNSAFE_SEGMENT');
  nav.destroy();
});

test('destroy is idempotent, invalid endpoints and calls after destroy fail closed', async () => {
  const { nav, freed } = await regressionNavigator();
  assert.equal(nav.evaluateRoute(null, to).reason, 'INVALID_ENDPOINT');
  nav.destroy(); nav.destroy();
  assert.equal(nav.evaluateRoute(from, to).reason, 'DESTROYED');
  assert.equal(freed.query, 1); assert.equal(freed.mesh, 1);
});
