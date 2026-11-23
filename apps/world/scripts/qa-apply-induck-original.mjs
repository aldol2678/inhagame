// Private QA only: materialize the exact pre-public-transition Induck GLB
// from an already private repository history. Never run in normal CI or public builds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const PREFIX = new URL('../', import.meta.url);
const EXPECTED = 'bec8585e3e64f092585c23e353ae833215a25ceffa850d819bce7d34d70f01ea';
assert.equal(process.env.INHAWORLD_PRIVATE_INDUCK_QA, '1', 'private asset QA must be explicitly enabled');
const encoded = readFileSync(new URL('private-qa/induck-legacy-production-202610.glb.base64', PREFIX), 'utf8').replace(/\s+/g, '');
const bytes = Buffer.from(encoded, 'base64');
assert.equal(bytes.length, 87788, 'historical Induck byte size');
assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'GLB magic');
assert.equal(bytes.readUInt32LE(4), 2, 'glTF 2');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB header length');
assert.equal(createHash('sha256').update(bytes).digest('hex'), EXPECTED, 'exact historical original fingerprint');
const jsonSize = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonSize).trim());
assert.equal(gltf.asset?.generator, 'INHAGAME Campus low-poly authoring');
assert.equal(gltf.meshes.length, 15);
assert.equal(gltf.materials.length, 4);
for (const pivot of ['DuckWing_L', 'DuckWing_R', 'DuckLeg_L', 'DuckLeg_R'])
  assert(gltf.nodes.some(node => node.name === pivot), 'missing ' + pivot);
writeFileSync(new URL('assets/induck-v3.glb', PREFIX), bytes);
console.log('INHAGAME PRIVATE QA Induck original: size=87788 sha256=' + EXPECTED + ', 15 meshes, 4 materials, four wing/leg pivots verified');
