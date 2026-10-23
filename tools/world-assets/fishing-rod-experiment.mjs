// Isolated, non-production glTF-Transform experiment. Does NOT change the approved source GLB.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformGlb } from './optimize-world-assets.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(repo, 'apps/world/assets/fishing-v1/fishing_rod_v1.glb');
const candidate = path.join(repo, 'apps/world/.generated/experiments/fishing-rod-v1.glb');
const reportPath = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'fishing-rod-experiment.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sockets = ['Grip_L', 'Grip_R', 'Line_Tip', 'Reel_CrankSocket', 'FishingRod_ROOT'];
const report = {
  schemaVersion: 1,
  project: 'INHA WORLD', experiment: 'fishing-rod-dedup-prune',
  source: 'apps/world/assets/fishing-v1/fishing_rod_v1.glb',
  candidate: 'apps/world/.generated/experiments/fishing-rod-v1.glb',
  productionChanged: false, deployed: false,
  rendererQA: 'Separate offline browser smoke, not Android physical-device proof',
  status: 'NOT_VERIFIED'
};
function sameArrays(a, b, label) {
  assert.ok(a && b, label + ' accessor exists');
  assert.equal(a.getType(), b.getType(), label + ' type');
  assert.equal(a.getComponentType(), b.getComponentType(), label + ' component type');
  assert.deepEqual(a.getArray(), b.getArray(), label + ' values');
}
function verifySemantics(before, after) {
  const oldRoot = before.getRoot(), newRoot = after.getRoot();
  const oldNodes = oldRoot.listNodes(), newNodes = newRoot.listNodes();
  assert.equal(newNodes.length, oldNodes.length, 'node count, including sockets');
  const index = new Map(newNodes.map(n => [n.getName(), n]));
  assert.equal(index.size, newNodes.length, 'unique node names');
  for (const name of sockets) assert.ok(index.has(name), 'required socket: ' + name);
  for (const a of oldNodes) {
    const b = index.get(a.getName());
    assert.ok(b, 'preserved node: ' + a.getName());
    assert.deepEqual(b.getTranslation(), a.getTranslation(), a.getName() + ' translation');
    assert.deepEqual(b.getRotation(), a.getRotation(), a.getName() + ' rotation');
    assert.deepEqual(b.getScale(), a.getScale(), a.getName() + ' scale');
    assert.deepEqual(b.getExtras(), a.getExtras(), a.getName() + ' extras');
    assert.deepEqual(b.listChildren().map(n => n.getName()).sort(), a.listChildren().map(n => n.getName()).sort(), a.getName() + ' child links');
    assert.equal(b.getMesh()?.getName() ?? null, a.getMesh()?.getName() ?? null, a.getName() + ' mesh binding');
    if (!a.getMesh()) continue;
    const oldPrims = a.getMesh().listPrimitives(), newPrims = b.getMesh().listPrimitives();
    assert.equal(newPrims.length, oldPrims.length, 'primitive count');
    for (let p = 0; p < oldPrims.length; p++) {
      const x = oldPrims[p], y = newPrims[p];
      assert.equal(y.getMode(), x.getMode(), 'topology');
      assert.equal(y.getMaterial()?.getName(), x.getMaterial()?.getName(), 'material binding');
      const originalSemantics = x.listSemantics().sort(), outputSemantics = y.listSemantics().sort();
      // prune() may remove an unused UV set from untextured vertex-color fishing materials.
      // All other vertex/index data must remain bit-for-bit identical.
      const removedUV = originalSemantics.includes('TEXCOORD_0') && !outputSemantics.includes('TEXCOORD_0');
      if (removedUV) {
        assert.deepEqual(originalSemantics.filter(name => name !== 'TEXCOORD_0'), outputSemantics,
          'only unused TEXCOORD_0 may be removed');
        const mat = x.getMaterial();
        assert.ok(mat, 'material required for UV-removal safety');
        for (const slot of ['getBaseColorTexture', 'getNormalTexture', 'getMetallicRoughnessTexture',
          'getOcclusionTexture', 'getEmissiveTexture']) {
          assert.equal(mat[slot](), null, 'UV removal only allowed when '+slot+' is unused');
        }
      } else assert.deepEqual(outputSemantics, originalSemantics, 'attribute semantics');
      for (const semantic of outputSemantics)
        sameArrays(x.getAttribute(semantic), y.getAttribute(semantic), semantic);
      if (x.getIndices()) sameArrays(x.getIndices(), y.getIndices(), 'indices');
      else assert.equal(y.getIndices(), null);
      assert.equal(y.listTargets().length, x.listTargets().length, 'morph target count');
    }
  }
  const oldMaterials = oldRoot.listMaterials(), newMaterials = newRoot.listMaterials();
  assert.deepEqual(newMaterials.map(m => m.getName()).sort(), oldMaterials.map(m => m.getName()).sort(), 'material names');
  const byName = new Map(newMaterials.map(m => [m.getName(), m]));
  for (const a of oldMaterials) {
    const b = byName.get(a.getName());
    for (const m of ['getBaseColorFactor', 'getMetallicFactor', 'getRoughnessFactor', 'getEmissiveFactor', 'getDoubleSided', 'getAlphaMode']) {
      assert.deepEqual(b[m](), a[m](), a.getName() + ' ' + m);
    }
  }
  return { nodes: oldNodes.length, meshes: oldRoot.listMeshes().length,
    primitives: oldRoot.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
    materials: oldMaterials.length, socketsPreserved: sockets };
}
try {
  const original = await readFile(source), hash = sha256(original);
  await mkdir(path.dirname(candidate), { recursive: true });
  // Use the EXISTING production algorithm; preserve empty socket leaves for the fishing runtime.
  await transformGlb(source, candidate, { keepEmptyLeafNodes: true });
  const transformed = await readFile(candidate);
  const proof = verifySemantics(await io.read(source), await io.read(candidate));
  const originalAfter = await readFile(source);
  assert.equal(sha256(originalAfter), hash, 'approved source unchanged');
  assert.deepEqual(originalAfter, original, 'source byte-for-byte unchanged');
  const saved = original.length - transformed.length;
  Object.assign(report, { status: 'STRUCTURAL_PASS', sourceBytes: original.length,
    candidateBytes: transformed.length, savedBytes: saved,
    savingsPercent: Math.round(saved / original.length * 100000) / 1000,
    sourceSha256: hash, candidateSha256: sha256(transformed),
    metadata: proof, unusedUV0MayBePruned: true, worthAdopting: saved > 0,
    adoptionGate: 'Do not change source, runtime routing, or hash until independent rendering and usage validation' });
  console.log('FISHING_ROD_EXPERIMENT ' + JSON.stringify(report));
} catch (error) {
  Object.assign(report, { status: 'FAILED', failure: String(error.stack || error) });
  console.error('FISHING_ROD_EXPERIMENT_FAILED ' + report.failure);
  process.exitCode = 1;
} finally {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
