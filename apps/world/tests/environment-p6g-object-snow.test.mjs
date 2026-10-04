import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_OBJECT_BENCH_BUDGET,
  SNOW_OBJECT_LAMP_BUDGET,
  SNOW_OBJECT_MIN_ACCUMULATION,
  SNOW_OBJECT_OPACITY,
  snowObjectBenchBudget,
  snowObjectLampBudget,
  snowObjectOpacity,
  snowObjectTierPolicy
} from '../src/environment/snow-object-policy.js';

test('P6G object-snow budgets scale by graphics tier', () => {
  assert.deepEqual(SNOW_OBJECT_BENCH_BUDGET, { low: 0, medium: 6, high: 12 });
  assert.deepEqual(SNOW_OBJECT_LAMP_BUDGET, { low: 0, medium: 8, high: 16 });
  assert.equal(snowObjectBenchBudget('unknown'), 6);
  assert.equal(snowObjectLampBudget('unknown'), 8);
  assert.deepEqual(snowObjectTierPolicy('low'), { benchBudget: 0, lampBudget: 0 });
});

test('object snow appears after a small accumulation threshold and fades with melt', () => {
  assert.equal(snowObjectOpacity('medium', 0), 0);
  assert.equal(snowObjectOpacity('medium', SNOW_OBJECT_MIN_ACCUMULATION), 0);
  const partial = snowObjectOpacity('medium', 0.45);
  const full = snowObjectOpacity('medium', 1);
  assert.ok(partial > 0 && partial < full);
  assert.equal(full, SNOW_OBJECT_OPACITY.medium);
});

test('higher graphics tiers increase object snow opacity', () => {
  assert.ok(snowObjectOpacity('low', 1) < snowObjectOpacity('medium', 1));
  assert.ok(snowObjectOpacity('medium', 1) < snowObjectOpacity('high', 1));
});
