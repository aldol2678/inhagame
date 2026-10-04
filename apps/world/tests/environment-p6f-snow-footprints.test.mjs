import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_FOOTPRINT_BUDGET,
  SNOW_FOOTPRINT_MIN_ACCUMULATION,
  SNOW_FOOTPRINT_OPACITY,
  SNOW_FOOTPRINT_SPACING,
  SNOW_FOOTPRINT_TELEPORT_RESET_DISTANCE,
  shouldPlaceSnowFootprint,
  snowFootprintBudget,
  snowFootprintOpacity
} from '../src/environment/snow-ground-policy.js';

test('P6F footprint budgets remain bounded and tier-scaled', () => {
  assert.deepEqual(SNOW_FOOTPRINT_BUDGET, { low: 12, medium: 20, high: 28 });
  assert.deepEqual(SNOW_FOOTPRINT_OPACITY, { low: 0.22, medium: 0.28, high: 0.34 });
  assert.equal(snowFootprintBudget('unknown'), 20);
  assert.ok(SNOW_FOOTPRINT_SPACING > 0.3 && SNOW_FOOTPRINT_SPACING < 0.7);
});

test('footprints require enough accumulated snow and real walking distance', () => {
  assert.equal(shouldPlaceSnowFootprint({
    accumulation: SNOW_FOOTPRINT_MIN_ACCUMULATION,
    distance: SNOW_FOOTPRINT_SPACING
  }), false);
  assert.equal(shouldPlaceSnowFootprint({
    accumulation: 0.8,
    distance: SNOW_FOOTPRINT_SPACING - 0.01
  }), false);
  assert.equal(shouldPlaceSnowFootprint({
    accumulation: 0.8,
    distance: SNOW_FOOTPRINT_SPACING
  }), true);
  assert.equal(shouldPlaceSnowFootprint({
    accumulation: 0.8,
    distance: SNOW_FOOTPRINT_TELEPORT_RESET_DISTANCE + 0.01
  }), false);
  assert.equal(shouldPlaceSnowFootprint({
    accumulation: 0.8,
    distance: SNOW_FOOTPRINT_SPACING,
    enabled: false
  }), false);
});

test('footprint opacity follows accumulation and graphics tier', () => {
  assert.equal(snowFootprintOpacity('medium', 0), 0);
  assert.equal(snowFootprintOpacity('medium', SNOW_FOOTPRINT_MIN_ACCUMULATION), 0);
  const half = snowFootprintOpacity('medium', 0.5);
  const full = snowFootprintOpacity('medium', 1);
  assert.ok(half > 0 && half < full);
  assert.equal(full, SNOW_FOOTPRINT_OPACITY.medium);
  assert.ok(snowFootprintOpacity('low', 1) < snowFootprintOpacity('high', 1));
});
