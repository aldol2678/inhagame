import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WINTER_SOAK_CONTRACT,
  WINTER_SOAK_CYCLES,
  WINTER_SOAK_WEATHER_SEQUENCE
} from '../src/environment/winter-soak-policy.js';

test('P6L accelerated soak covers repeated winter lifecycle transitions', () => {
  assert.equal(WINTER_SOAK_CYCLES, 24);
  assert.deepEqual(WINTER_SOAK_WEATHER_SEQUENCE, ['snow', 'rain', 'clear', 'cloudy']);
  assert.ok(WINTER_SOAK_CYCLES >= WINTER_SOAK_WEATHER_SEQUENCE.length * 5);
});

test('P6L forbids winter topology and passive mesh churn', () => {
  assert.deepEqual(WINTER_SOAK_CONTRACT, {
    entityGrowth: 0,
    meshInstanceGrowth: 0,
    meshIdentityChanges: 0,
    materialIdentityChanges: 0,
    passiveFootprintMeshRebuilds: 0
  });
});
