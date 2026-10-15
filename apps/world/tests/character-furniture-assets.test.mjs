import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_FURNITURE_CANDIDATES } from '../src/rooms/character-furniture-assets.js';

test('character candidates are deeply frozen, enabled and separately hash-addressed', () => {
  assert.ok(Object.isFrozen(CHARACTER_FURNITURE_CANDIDATES));
  assert.equal(CHARACTER_FURNITURE_CANDIDATES.length, 3);
  assert.equal(new Set(CHARACTER_FURNITURE_CANDIDATES.map(v => v.itemId)).size, 3);
  for (const visual of CHARACTER_FURNITURE_CANDIDATES) {
    assert.ok(Object.isFrozen(visual));
    assert.equal(visual.enabled, true);
    assert.equal(visual.geometryPolicy, 'character-r1');
    assert.equal(visual.frontAxis, '-Z');
    assert.match(visual.sha256, /^[a-f0-9]{64}$/);
    assert.equal(visual.url, `/api/brand-asset?asset=${visual.version}-${visual.sha256.slice(0, 12)}.glb`);
    assert.equal(visual.transform.yaw, 0);
    assert.deepEqual(visual.transform.scale, [1, 1, 1]);
    assert.deepEqual(visual.allowedExtensions, []);
    for (const value of [visual.min, visual.max, visual.transform, visual.transform.scale, visual.allowedExtensions]) assert.ok(Object.isFrozen(value));
    for (const key of ['byteLength', 'triangles', 'primitives', 'materials']) assert.ok(Number.isSafeInteger(visual[key]) && visual[key] > 0);
    assert.equal(visual.min[1], 0);
    assert.ok(visual.max.every((value, axis) => value > visual.min[axis]));
  }
});

test('chair seat and image memory estimates retain the measured contract', () => {
  const [chair, nightstand, bookshelf] = CHARACTER_FURNITURE_CANDIDATES;
  assert.ok(Object.isFrozen(chair.seat));
  assert.ok(Object.isFrozen(chair.seat.position));
  assert.deepEqual(chair.seat.position, [0, .34, -.155]);
  assert.equal(chair.textureBytesEstimate, 0);
  assert.equal(nightstand.textureBytesEstimate, 5592404);
  assert.equal(bookshelf.textureBytesEstimate, 0);
});

test('activation admits exactly five verified replacements plus the unchanged sofa', async () => {
  const { FURNITURE_VISUALS, furnitureVisualForItem, requireFurnitureVisual } = await import('../src/rooms/furniture-visual-assets.js');
  const enabled = FURNITURE_VISUALS.filter(visual => visual.enabled);
  assert.deepEqual(enabled.map(v => v.version).sort(), ['sofa-glb-v1', 'annyongi-character-chair-r2',
    'induck-character-nightstand-r1', 'annyongi-character-bookshelf-r3',
    'official-rug-replacement-r1', 'official-bed-replacement-r2'].sort());
  assert.equal(new Set(enabled.map(v => v.itemId)).size, 6);
  for (const visual of enabled) {
    assert.equal(furnitureVisualForItem(visual.itemId), visual);
    assert.equal(requireFurnitureVisual(visual), visual);
    assert.throws(() => requireFurnitureVisual({ ...visual }), /UNTRUSTED/);
  }
});
