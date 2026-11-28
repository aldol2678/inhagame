import test from 'node:test';
import assert from 'node:assert/strict';
import { INKYUNG_PHOTO_POINT, inkyungPhotoPosition } from '../src/photo/inkyung-photo-point.js';
import { hitsPondTrunk, pondBankTrees } from '../src/roadview-layout.js';
import { positionAt } from '../npc-factory/dev-runtime-state.mjs';

// The anchor stays an NPC semantic location (and a possible optional composition preset);
// Photo Mode itself never reads it.
test('photo anchor exactly reuses the existing semantic location, including every NPC slot', () => {
  const guide = INKYUNG_PHOTO_POINT.position, trunk = pondBankTrees()[4];
  assert.deepEqual(guide, inkyungPhotoPosition(0));
  assert.ok(Math.hypot(guide.x - trunk.x, guide.z - trunk.z) < 2, 'the guide remains at the same landmark');
  assert.equal(hitsPondTrunk(guide, guide, .65), false);
  for (let slot = 0; slot < 12; slot++) assert.deepEqual(inkyungPhotoPosition(slot), positionAt('inkyung_photo_point', slot));
});
