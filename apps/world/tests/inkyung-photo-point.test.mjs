import test from 'node:test';
import assert from 'node:assert/strict';
import { INKYUNG_PHOTO_POINT, inkyungPhotoPosition } from '../src/photo/inkyung-photo-point.js';
import { hitsPondTrunk, pondBankTrees } from '../src/roadview-layout.js';
import { positionAt } from '../npc-factory/dev-runtime-state.mjs';

import { chooseDialogueShot } from '../npc-factory/dialogue-shot.mjs';
import { cameraObstaclesNear, cameraSafeFraction, canOccupy } from '../src/world-collision.js';

// The anchor stays an NPC semantic location (and a possible optional composition preset);
// Photo Mode itself never reads it.
test('photo anchor exactly reuses the existing semantic location, including every NPC slot', () => {
  const guide = INKYUNG_PHOTO_POINT.position, trunk = pondBankTrees()[4];
  assert.deepEqual(guide, inkyungPhotoPosition(0));
  assert.ok(Math.hypot(guide.x - trunk.x, guide.z - trunk.z) < 2, 'the guide remains at the same landmark');
  assert.equal(hitsPondTrunk(guide, guide, .65), false);
  for (let slot = 0; slot < 12; slot++) assert.deepEqual(inkyungPhotoPosition(slot), positionAt('inkyung_photo_point', slot));
});

test('trunk-safe guide still has a clear two-person camera angle in mobile landscape', () => {
  const guide = INKYUNG_PHOTO_POINT.position;
  const subject = { ...guide, y: 1.5 };
  const obstacles = cameraObstaclesNear(subject, 8);
  const setups = Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    return { x: guide.x + 1.5 * Math.cos(angle), y: 1.8, z: guide.z + 1.5 * Math.sin(angle) };
  });
  assert.ok(setups.some(player => canOccupy({ ...player, y: 1.15 }) && chooseDialogueShot({ player, subject, aspect: 667/375, fov: 50,
    visible: (from, to) => cameraSafeFraction(from, to, undefined, obstacles) >= .998 })));
});
