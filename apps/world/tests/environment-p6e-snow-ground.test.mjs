import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_ACCUMULATION_RATE,
  SNOW_GROUND_DRAW_BUDGET,
  SNOW_GROUND_LAWN_OPACITY,
  SNOW_GROUND_ROAD_OPACITY,
  SNOW_MELT_RATE,
  snowGroundDrawBudget,
  snowGroundVisibility,
  stepSnowAccumulation
} from '../src/environment/snow-ground-policy.js';

test('P6E ground-snow budgets stay small across graphics tiers', () => {
  assert.deepEqual(SNOW_GROUND_DRAW_BUDGET, { low: 1, medium: 2, high: 2 });
  assert.deepEqual(SNOW_GROUND_LAWN_OPACITY, { low: 0.48, medium: 0.58, high: 0.66 });
  assert.deepEqual(SNOW_GROUND_ROAD_OPACITY, { low: 0, medium: 0.26, high: 0.34 });
  assert.equal(snowGroundDrawBudget('unknown'), 2);
});

test('snow accumulation builds during snowfall and melts after it stops', () => {
  const built = stepSnowAccumulation(0, 1, 4);
  assert.ok(Math.abs(built - SNOW_ACCUMULATION_RATE * 4) < 1e-9);
  const halfIntensity = stepSnowAccumulation(0, 0.5, 4);
  assert.ok(halfIntensity > 0 && halfIntensity < built);

  const melted = stepSnowAccumulation(built, 0, 10);
  assert.ok(Math.abs(melted - Math.max(0, built - SNOW_MELT_RATE * 10)) < 1e-9);
  assert.equal(stepSnowAccumulation(0, 0, 10), 0);
  assert.equal(stepSnowAccumulation(1, 1, 10), 1);
});

test('lawn cover appears before road dusting and low tier skips the road mesh', () => {
  const low = snowGroundVisibility(0.5, 'low');
  assert.ok(low.lawn > 0);
  assert.equal(low.road, 0);
  assert.equal(low.roadEnabled, false);

  const medium = snowGroundVisibility(0.5, 'medium');
  assert.ok(medium.lawn > medium.road);
  assert.ok(medium.road > 0);
  assert.equal(medium.roadEnabled, true);

  const high = snowGroundVisibility(1, 'high');
  assert.equal(high.accumulation, 1);
  assert.equal(high.lawn, SNOW_GROUND_LAWN_OPACITY.high);
  assert.equal(high.road, SNOW_GROUND_ROAD_OPACITY.high);
});
