import test from 'node:test';
import assert from 'node:assert/strict';
import { INKYUNG_PHOTO_POINT, inkyungPhotoPosition } from '../src/photo/inkyung-photo-point.js';
import { positionAt } from '../npc-factory/dev-runtime-state.mjs';

// The anchor stays an NPC semantic location (and a possible optional composition preset);
// Photo Mode itself never reads it.
test('photo anchor exactly reuses the existing semantic location, including every NPC slot', () => {
  assert.deepEqual(INKYUNG_PHOTO_POINT.position, { x: 119.93159345039713, z: 32.150936735877636 });
  for (let slot = 0; slot < 12; slot++) assert.deepEqual(inkyungPhotoPosition(slot), positionAt('inkyung_photo_point', slot));
});
