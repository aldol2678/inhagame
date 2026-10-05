import test from 'node:test';
import assert from 'node:assert/strict';
import { actualRecastLoader } from './evaluate.mjs';
import { buildCampusArtifact } from './build-artifact.mjs';
import { localFetcher } from './campus-context.mjs';
import { loadRecastArtifact, createRecastArtifact, fingerprint, validateRecastArtifact } from '../../npc-factory/recast-navmesh-artifact.mjs';
import { createRecastNpcNavigator, recastArtifactContract } from '../../npc-factory/recast-navigator-poc.mjs';

test('actual Recast WASM rejects unreachable destination across disconnected surfaces', async () => {
  const walkable = p => p.x >= 0 && p.x <= 27 && p.z >= 0 && p.z <= 9 && (p.x <= 9 || p.x >= 18);
  const segmentSafe = (a, b) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.1));
    for (let i = 0; i <= steps; i++) if (!walkable({ x: a.x + (b.x - a.x) * i / steps,
      z: a.z + (b.z - a.z) * i / steps })) return false;
    return true;
  };
  const base = { bounds: { minX: 0, maxX: 27, minZ: 0, maxZ: 9 }, walkable, segmentSafe };
  const nav = await createRecastNpcNavigator(base, { loader: actualRecastLoader });
  let imported;
  try {
    const result = nav.evaluateRoute({ x: 4.5, z: 4.5 }, { x: 22.5, z: 4.5 });
    assert.equal(result.ok, false);
    assert.equal(result.route, null);
    assert.equal(result.reason, 'INCOMPLETE_PATH');
    const bytes = nav.exportNavMesh();
    const inputSha256 = await fingerprint({ fixture: 'disconnected-surfaces' });
    const { surfaceTiles, corridorQuads, triangleCount } = nav.recast;
    const manifest = await createRecastArtifact({ bytes, inputSha256, contract: recastArtifactContract(),
      surface: { surfaceTiles, corridorQuads, triangleCount } });
    imported = await createRecastNpcNavigator(base, { loader: actualRecastLoader,
      prebuilt: { bytes, manifest, expectedInputSha256: inputSha256 } });
    assert.deepEqual(imported.evaluateRoute({ x: 4.5, z: 4.5 }, { x: 22.5, z: 4.5 }), result);
  } finally { imported?.destroy(); nav.destroy(); }
});

test('current campus cold generation and serialized import preserve every accepted route', async t => {
  const build = await buildCampusArtifact();
  const result = build.importedResult;
  // Readback the files actually emitted, not only the in-memory serialized round-trip.
  const stored = await loadRecastArtifact({ fetcher: localFetcher, expectedInputSha256: build.manifest.inputSha256 });
  assert.deepEqual(stored.manifest, build.manifest);
  assert.equal(stored.bytes.byteLength, build.manifest.byteLength);
  assert.deepEqual(await validateRecastArtifact({ ...stored, contract: build.manifest.contract }), build.manifest.surface);
  t.diagnostic(JSON.stringify(build));
  assert.equal(result.population, 48);
  assert.equal(result.expansion, 'READY');
  assert.equal(result.eligibleLegs, 200);
  assert.equal(result.movementLegs, 141);
  assert.equal(result.recastRoutes, 200);
  assert.equal(result.movementCoverage, 1);
  assert.equal(result.legacyRoutes, 200);
  assert.equal(build.unsafeReturnedRoutes, 0);
  assert.equal(build.incorrectEndpoints, 0);
});
