// Explicitly gated QA check for the paired Induck + Annyongi PlayCanvas assets.
// Does not approve mascot art for production; checks runtime compatibility only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

assert.equal(process.env.INHAWORLD_PRIVATE_MASCOT_DUO_QA, '1', 'not authorized outside explicit mascot duo QA build');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function inspect(relative, expectedBytes, expectedSha) {
  const bytes=readFileSync(path.join(root,relative));
  assert.equal(bytes.length,expectedBytes, relative+' byte count changed');
  assert.equal(bytes.toString('ascii',0,4),'glTF',relative+' magic');
  assert.equal(bytes.readUInt32LE(4),2,relative+' glTF version');
  assert.equal(bytes.readUInt32LE(8),bytes.length,relative+' header size');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedSha,relative+' digest mismatch');
  const jlen=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.toString('utf8',20,20+jlen).trim());
  return {bytes,gltf,sha:expectedSha};
}
const duck=inspect('assets/induck-v3.glb',87788,'bec8585e3e64f092585c23e353ae833215a25ceffa850d819bce7d34d70f01ea');
const dragon=inspect('assets/annyongi-flight-v1.glb',394672,'5b53dd9a13e2123bab399f68483c3fa72259b75888edf67b9bab32553a53fc23');
assert.equal(duck.gltf.meshes.length,15);
assert.equal(duck.gltf.materials.length,4);
for(const name of ['DuckWing_L','DuckWing_R','DuckLeg_L','DuckLeg_R']) assert(duck.gltf.nodes.some(n=>n.name===name),'Induck '+name);
assert.equal(dragon.gltf.asset.generator,'INHAGAME Annyongi procedural flight reconstruction v2.1');
for(const name of ['Annyongi_Root','DragonWing_L','DragonWing_R','RiderAnchor','FlightHeadPivot','Tail','TailCloud'])assert(dragon.gltf.nodes.some(n=>n.name===name),'Annyongi '+name);
for(const name of ['Tail','TailCloud']) {
  const node=dragon.gltf.nodes.find(n=>n.name===name);
  const mesh=dragon.gltf.meshes[node.mesh];
  assert.deepEqual(mesh.extras?.targetNames,['TailAscend','TailForward','TailGlide']);
  assert.equal(mesh.primitives[0].targets.length,3);
}
console.log('INHA WORLD private mascot-duo QA PASS: Induck historical source 87788 B, Annyongi flight v2.1 394672 B, verified digests/pivots/morphs');
