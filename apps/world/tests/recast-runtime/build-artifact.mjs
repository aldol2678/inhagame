import assert from 'node:assert/strict';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { actualRecastLoader } from './evaluate.mjs';
import { prepareCampus, auditCampusRoutes } from './campus-context.mjs';
import { createRecastNpcNavigator } from '../../npc-factory/recast-navigator-poc.mjs';
import { createRecastArtifact, loadRecastArtifact } from '../../npc-factory/recast-navmesh-artifact.mjs';
import { evaluateRecastSchedule } from '../../npc-factory/recast-schedule-evaluation.mjs';

export const defaultOutputDirectory = fileURLToPath(new URL('../../recast-data/', import.meta.url));

async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function acceptance(result, audit) {
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.failures));
  assert.equal(result.movementCoverage, 1);
  assert.equal(result.skippedMissingEndpoints, 0);
  assert.equal(audit.unsafeReturnedRoutes, 0);
  assert.equal(audit.incorrectEndpoints, 0);
}

export async function buildCampusArtifact({ outputDirectory = defaultOutputDirectory } = {}) {
  const started = performance.now();
  const context = await prepareCampus();
  const preparedMs = performance.now() - started;
  const { legacyNavigator, corridorGraph, contract, inputSha256 } = context;
  let at = performance.now();
  const generated = await createRecastNpcNavigator(legacyNavigator, { loader: actualRecastLoader, corridorGraph });
  const generatedNavigatorMs = performance.now() - at;
  let manifest, bytes, generatedResult, generatedAudit, generatedEvaluationMs;
  try {
    at = performance.now();
    generatedResult = evaluateRecastSchedule({ ...context, recastNavigator: generated });
    generatedEvaluationMs = performance.now() - at;
    generatedAudit = auditCampusRoutes(context, generated);
    acceptance(generatedResult, generatedAudit);
    bytes = generated.exportNavMesh();
    const { surfaceTiles, corridorQuads, triangleCount } = generated.recast;
    manifest = await createRecastArtifact({ bytes, inputSha256, contract,
      surface: { surfaceTiles, corridorQuads, triangleCount } });
  } finally { generated.destroy(); }

  // Read the serialized JSON + binary through the same HTTP loader as the browser page,
  // before publishing either output file. Imported routes must match the cold generation.
  const json = JSON.stringify(manifest, null, 2) + '\n';
  const serializedFetcher = async url => url.endsWith('.json') ? new Response(json) :
    url.endsWith(`/${manifest.binarySha256}.bin`) ? new Response(bytes) : new Response('', { status: 404 });
  const prebuilt = await loadRecastArtifact({ fetcher: serializedFetcher, expectedInputSha256: inputSha256 });
  at = performance.now();
  const imported = await createRecastNpcNavigator(legacyNavigator, { loader: actualRecastLoader, corridorGraph, prebuilt });
  const importedNavigatorMs = performance.now() - at;
  let importedResult, importedAudit, importedEvaluationMs;
  try {
    at = performance.now();
    importedResult = evaluateRecastSchedule({ ...context, recastNavigator: imported });
    importedEvaluationMs = performance.now() - at;
    importedAudit = auditCampusRoutes(context, imported);
    acceptance(importedResult, importedAudit);
    assert.deepEqual(importedResult, generatedResult);
    assert.deepEqual(importedAudit, generatedAudit);
  } finally { imported.destroy(); }

  await mkdir(outputDirectory, { recursive: true });
  await atomicWrite(resolve(outputDirectory, `${manifest.binarySha256}.bin`), bytes);
  // Publish the manifest last, after both acceptance gates and the atomic binary write.
  await atomicWrite(resolve(outputDirectory, 'campus.manifest.json'), json);
  return { manifest, generatedResult, importedResult,
    unsafeReturnedRoutes: importedAudit.unsafeReturnedRoutes, incorrectEndpoints: importedAudit.incorrectEndpoints,
    outputDirectory, preparedMs, generatedNavigatorMs, generatedEvaluationMs,
    importedNavigatorMs, importedEvaluationMs, elapsedMs: performance.now() - started };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await buildCampusArtifact(), null, 2));
}
