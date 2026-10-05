import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecastArtifact, validateRecastArtifact, loadRecastArtifact, fingerprint,
  RECAST_SOURCE_URLS, recastArtifactInputs } from '../npc-factory/recast-navmesh-artifact.mjs';
import { createRecastNpcNavigator, recastArtifactContract } from '../npc-factory/recast-navigator-poc.mjs';

// Synthetic header is only for pre-import validation/lifecycle contracts; campus acceptance
// and unreachable imported routes are independently tested with the real pinned WASM.
const bytes = new Uint8Array(148);
const header = new DataView(bytes.buffer);
for (const [offset, value] of [[0, 0x4d534554], [4, 1], [8, 1], [40, 1], [44, 100],
  [48, 0x444e4156], [52, 7]]) header.setUint32(offset, value, true);
const contract = recastArtifactContract();
const inputSha256 = await fingerprint({ fixture: 'unit-contract' });
const manifest = await createRecastArtifact({ bytes, inputSha256, contract,
  surface: { surfaceTiles: 1, corridorQuads: 0, triangleCount: 2 } });
const prebuilt = { manifest, bytes, expectedInputSha256: inputSha256 };
const base = { bounds: { minX: 0, maxX: 3, minZ: 0, maxZ: 3 },
  walkable: () => true, segmentSafe: () => true };

test('canonical input hash changes for geometry, graph, schedules, safety sources and configuration', async () => {
  const input = recastArtifactInputs({ batch: { npcs: [{ id: 'A' }] },
    roster: new Map([['A', { schedule: [{ destination: 'hall' }], destinations: { hall: { position: { x: 1, z: 2 } } } }]]),
    expansion: 'READY', baseNavigator: { navigationGeometry: () => ({ pond: [{ x: 1, z: 2 }], clearance: .6 }) },
    corridorGraph: { nodes: [{ x: 1, z: 2 }], edges: [] }, contract,
    sourceDigests: Object.fromEntries(RECAST_SOURCE_URLS.map(url => [url, 'a'.repeat(64)])) });
  const original = await fingerprint(input);
  for (const mutate of [x => x.geometry.clearance = .7, x => x.geometry.pond[0].x++,
    x => x.graph.nodes[0].z++, x => x.batch.npcs.push({ id: 'B' }),
    x => x.roster[0].schedule[0].destination = 'gate', x => x.roster[0].destinations.hall.position.x++,
    x => x.sourceDigests[RECAST_SOURCE_URLS[0]] = 'b'.repeat(64), x => x.contract.config.cs = .2]) {
    const changed = structuredClone(input); mutate(changed); assert.notEqual(await fingerprint(changed), original);
  }
  assert.equal(await fingerprint({ b: 2, a: 1 }), await fingerprint({ a: 1, b: 2 }));
});

test('schema, inputs, configuration, manifest tampering and corrupt/truncated binaries fail closed', async () => {
  const cases = [
    [{ manifest: { ...manifest, schema: 'unknown' } }, /SCHEMA/],
    [{ expectedInputSha256: 'b'.repeat(64) }, /INPUT_MISMATCH/],
    [{ manifest: { ...manifest, contract: { ...contract, packageVersion: '0.44.0' } } }, /VERSION_OR_CONFIG/],
    [{ manifest: { ...manifest, surface: { ...manifest.surface, triangleCount: 10 } } }, /MANIFEST_CHECKSUM/],
    [{ bytes: bytes.slice(0, -1) }, /BINARY_CHECKSUM/],
    [{ bytes: bytes.map((byte, index) => index === 80 ? byte ^ 1 : byte) }, /BINARY_CHECKSUM/]
  ];
  for (const [changes, reason] of cases) await assert.rejects(
    validateRecastArtifact({ ...prebuilt, ...changes, contract }), reason);
  await assert.rejects(validateRecastArtifact({ ...prebuilt,
    contract: recastArtifactContract({ navMeshConfig: { cs: .2 } }) }), /VERSION_OR_CONFIG/);
  const wrongHeader = bytes.slice(); wrongHeader[0] = 0;
  await assert.rejects(createRecastArtifact({ bytes: wrongHeader, inputSha256, contract, surface: manifest.surface }), /BINARY_FORMAT/);
});

test('a missing manifest or content-addressed binary cannot fall back to generation', async () => {
  await assert.rejects(loadRecastArtifact({ expectedInputSha256: inputSha256,
    fetcher: async () => new Response('', { status: 404 }) }), /ARTIFACT_UNAVAILABLE/);
  await assert.rejects(loadRecastArtifact({ expectedInputSha256: inputSha256,
    fetcher: async url => url.endsWith('.json') ? new Response(JSON.stringify(manifest)) :
      new Response('', { status: 404 }) }), /BINARY_UNAVAILABLE/);
  let loaded = 0;
  await assert.rejects(createRecastNpcNavigator(base, { prebuilt: { ...prebuilt, bytes: bytes.slice(0, -1) },
    loader: async () => { loaded++; return {}; } }), /BINARY_CHECKSUM/);
  assert.equal(loaded, 0);
});

test('runtime package drift rejects a valid artifact before WASM initialization', async () => {
  let initialized = 0;
  await assert.rejects(createRecastNpcNavigator(base, { prebuilt, loader: async () => ({
    packageVersion: '0.44.0', core: { init() { initialized++; }, importNavMesh() {}, NavMeshQuery: class {} }
  }) }), /RUNTIME_VERSION/);
  assert.equal(initialized, 0);
});

test('import skips generation, retains unsafe-segment rejection, and releases imported ownership once', async () => {
  const freed = { mesh: 0, query: 0, filter: 0 };
  let generationCalls = 0, imports = 0;
  class Query {
    defaultFilter = { raw: {} };
    findNearestPoly(p) { return { success: true, nearestRef: p.x < 1 ? 1 : 2, nearestPoint: p }; }
    findPath() { return { success: true, status: 0x40000000, polys: { size: 2, get: i => i + 1, destroy() {} } }; }
    findStraightPath(a, b) {
      const values = [a.x, a.y, a.z, b.x, b.y, b.z];
      return { success: true, status: 0x40000000, straightPathCount: 2,
        straightPath: { get: i => values[i], destroy() {} } };
    }
    destroy() { freed.query++; }
  }
  const loader = async () => ({ packageVersion: '0.43.1', core: {
    init: async () => {}, NavMeshQuery: Query, Raw: { destroy() { freed.filter++; } },
    importNavMesh() { imports++; return { navMesh: { destroy() { freed.mesh++; } } }; }
  }, generators: { generateSoloNavMesh() { generationCalls++; } } });
  const nav = await createRecastNpcNavigator({ ...base,
    segmentSafe: (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 3 }, { loader, prebuilt });
  assert.equal(nav.recast.initialization, 'IMPORTED');
  assert.equal(nav.evaluateRoute({ x: .25, z: .25 }, { x: 2.75, z: 2.75 }).reason, 'UNSAFE_SEGMENT');
  nav.destroy(); nav.destroy();
  assert.deepEqual(freed, { mesh: 1, query: 1, filter: 1 });
  assert.equal(imports, 1); assert.equal(generationCalls, 0);
  assert.throws(() => nav.exportNavMesh(), /destroyed/);
});

test('query creation failure frees the imported mesh without a generation fallback', async () => {
  let destroyed = 0;
  await assert.rejects(createRecastNpcNavigator(base, { prebuilt, loader: async () => ({ packageVersion: '0.43.1', core: {
    init: async () => {}, importNavMesh: () => ({ navMesh: { destroy() { destroyed++; } } }),
    NavMeshQuery: class { constructor() { throw Error('query init failed'); } }
  } }) }), /query init failed/);
  assert.equal(destroyed, 1);
});
