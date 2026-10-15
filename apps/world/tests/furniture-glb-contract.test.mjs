import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto, createHash } from 'node:crypto';
import { validateFurniturePayload } from '../src/rooms/furniture-glb-contract.js';
import { SOFA_VISUAL, OFFICIAL_FURNITURE_CANDIDATES, requireFurnitureVisual, furnitureVisualForItem, furnitureVisualForUrl } from '../src/rooms/furniture-visual-assets.js';
import { personalRoomAssetDiagnostics } from '../src/rooms/personal-room-asset-budget.js';
const bytes = await readFile(new URL('../assets/furniture/dorm-single-sofa-v1.glb', import.meta.url));
const buffer = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const pin = value => ({ ...SOFA_VISUAL, byteLength: value.length, sha256: createHash('sha256').update(value).digest('hex') });
function mutateJson(change) {
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
  change(json);
  const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32); encoded.copy(padded);
  const result = Buffer.concat([bytes.subarray(0, 12), Buffer.alloc(8), padded, bytes.subarray(20 + length)]);
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12); result.writeUInt32LE(0x4e4f534a, 16);
  return result;
}
test('legacy sofa exact bytes/hash and strict parser contract stay unchanged', async () => {
  assert.equal(bytes.length, 35492);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SOFA_VISUAL.sha256);
  assert.deepEqual(await validateFurniturePayload(buffer(bytes), SOFA_VISUAL, webcrypto), { triangles: 1784, primitives: 3, materials: 3 });
  await assert.rejects(validateFurniturePayload(buffer(bytes.subarray(1)), SOFA_VISUAL, webcrypto), /BYTE_LENGTH/);
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(validateFurniturePayload(buffer(tampered), SOFA_VISUAL, webcrypto), /HASH_MISMATCH/);
});
for (const [label, change, error] of [
  ['external image', g => { g.images = [{ uri: 'https://invalid.example/x.png' }]; }, /EXTERNAL_IMAGE/],
  ['external buffer', g => { g.buffers[0].uri = '/unexpected.bin'; }, /BUFFER/],
  ['animation', g => { g.animations = [{}]; }, /UNSUPPORTED/],
  ['node scale', g => { g.nodes[0].scale = [2, 1, 1]; }, /NODE_TRANSFORM/],
  ['material count', g => { g.materials.push({}); }, /STRUCTURE/],
  ['non-triangle', g => { g.meshes[0].primitives[0].mode = 1; }, /PRIMITIVE/]
]) test(`even explicitly pinned payload rejects ${label}`, async () => {
  const candidate = mutateJson(change);
  await assert.rejects(validateFurniturePayload(buffer(candidate), pin(candidate), webcrypto), error);
});
test('manifest transport rejects arbitrary URLs, copied descriptors and disabled candidates', () => {
  assert.equal(requireFurnitureVisual(SOFA_VISUAL), SOFA_VISUAL);
  assert.throws(() => requireFurnitureVisual({ ...SOFA_VISUAL }), /UNTRUSTED/);
  assert.equal(furnitureVisualForUrl('https://invalid.example/asset.glb'), null);
  assert.equal(OFFICIAL_FURNITURE_CANDIDATES.length, 5);
  for (const visual of OFFICIAL_FURNITURE_CANDIDATES) {
    if (['furniture.campus_rug_blue','fixture.personal_bed'].includes(visual.itemId)) {
      assert.equal(visual.enabled, true);
      assert.equal(furnitureVisualForItem(visual.itemId), visual);
      assert.equal(requireFurnitureVisual(visual), visual);
    } else {
      assert.equal(visual.enabled, false, 'retired sticker candidates remain disabled');
      assert.notEqual(furnitureVisualForItem(visual.itemId), visual);
      assert.throws(() => requireFurnitureVisual(visual), /UNTRUSTED/);
    }
    assert.throws(() => requireFurnitureVisual({ ...visual }), /UNTRUSTED/);
    assert.deepEqual(visual.transform.scale, [1,1,1]);
  }
});
test('32 copies multiply work but share source transfer; diagnostics never claim GPU pass', () => {
  const report = personalRoomAssetDiagnostics(Array.from({length:32}, () => ({itemId:SOFA_VISUAL.itemId})));
  assert.equal(report.registeredGlbEstimates.trianglesSinglePass, 32 * 1784);
  assert.equal(report.registeredGlbEstimates.primitiveSubmissionsSinglePass, 96);
  assert.equal(report.registeredGlbEstimates.uniqueTransferBytes, 35492);
  assert.equal(report.uniqueVisualSources, 1);
  assert.equal(report.placementLimitExceeded, false);
  assert.equal(report.runtimeMeasurements.gpuFrameP95Ms, null);
  assert.equal(report.releaseVerdict, 'not_measured');
  const mixed = personalRoomAssetDiagnostics([{itemId:'unknown'}], {fixedVisuals: Array.from({length:32}, (_,i) => OFFICIAL_FURNITURE_CANDIDATES[i%5])});
  assert.equal(mixed.knownVisualPlacements, 32); assert.equal(mixed.uniqueVisualSources, 5);
  assert.equal(mixed.unaccountedOwnedPlacements, 1);
});

test('capture cache includes actual source versions and never calls mixed procedural content GLB', async () => {
  const { captureFurnitureVisual } = await import('../src/rooms/furniture-visual-assets.js');
  let state = {generation:1,revision:1,destroyed:false,suspended:false,placementCount:1,contentKey:'same-placement',modelMode:'glb',objects:[{state:'GLB',version:'asset-v1'}]};
  const layer = {visualStatus:()=>structuredClone(state),whenVisualsReady:async()=>{}};
  const first=await captureFurnitureVisual(layer,async()=>1,{viewKey:'front'});
  state.objects[0].version='asset-v2';
  const second=await captureFurnitureVisual(layer,async()=>2,{viewKey:'front'});
  assert.notEqual(first.cacheKey,second.cacheKey);
  state.objects[0].sourceKey='/immutable-new-hash.glb@new-hash';
  const third=await captureFurnitureVisual(layer,async()=>3,{viewKey:'front'});
  assert.notEqual(second.cacheKey,third.cacheKey);
  state.placementCount=2;
  assert.equal((await captureFurnitureVisual(layer,async()=>3)).mode,'FALLBACK');
  assert.equal(await captureFurnitureVisual(layer,async()=>{state.revision++;return 'stale';}),null);
});

test('fixed bed explicitly rotates source head -Z to existing pillow keepout +Z', () => {
  const bed=OFFICIAL_FURNITURE_CANDIDATES.find(visual=>visual.itemId==='fixture.personal_bed');
  assert.equal(bed.transform.yaw,180);
  assert.equal(bed.placementHeadAxis,'+Z');
});
