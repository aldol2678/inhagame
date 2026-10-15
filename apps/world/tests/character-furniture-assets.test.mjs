import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_FURNITURE_CANDIDATES } from '../src/rooms/character-furniture-assets.js';

test('character candidates are deeply frozen, disabled and separately hash-addressed', () => {
  assert.ok(Object.isFrozen(CHARACTER_FURNITURE_CANDIDATES));
  assert.equal(CHARACTER_FURNITURE_CANDIDATES.length, 3);
  assert.equal(new Set(CHARACTER_FURNITURE_CANDIDATES.map(v => v.itemId)).size, 3);
  for (const visual of CHARACTER_FURNITURE_CANDIDATES) {
    assert.ok(Object.isFrozen(visual));
    assert.equal(visual.enabled, false);
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
