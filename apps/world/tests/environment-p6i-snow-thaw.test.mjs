import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_ICE_BUDGET,
  SNOW_SLUSH_BUDGET,
  SNOW_THAW_MIN_ACCUMULATION,
  snowIceBudget,
  snowSlushBudget,
  snowThawProfile
} from '../src/environment/snow-thaw-policy.js';

test('P6I thaw budgets stay bounded and LOW skips ice sheen', () => {
  assert.deepEqual(SNOW_SLUSH_BUDGET, { low: 6, medium: 12, high: 18 });
  assert.deepEqual(SNOW_ICE_BUDGET, { low: 0, medium: 6, high: 12 });
  assert.equal(snowSlushBudget('unknown'), 12);
  assert.equal(snowIceBudget('unknown'), 6);
});

test('active snowfall suppresses thaw visuals', () => {
  const fresh = snowThawProfile({
    accumulation: 0.5,
    snowIntensity: 1,
    wetness: 0,
    tier: 'high'
  });
  assert.equal(fresh.enabled, false);
  assert.equal(fresh.slushOpacity, 0);
  assert.equal(fresh.iceOpacity, 0);
});

test('wet mid-melt favors slush while thin late melt exposes ice sheen', () => {
  const wetMid = snowThawProfile({
    accumulation: 0.42,
    snowIntensity: 0,
    wetness: 1,
    tier: 'high'
  });
  assert.equal(wetMid.enabled, true);
  assert.ok(wetMid.slushOpacity > 0);
  assert.ok(wetMid.slush > wetMid.ice);

  const thinDry = snowThawProfile({
    accumulation: 0.14,
    snowIntensity: 0,
    wetness: 0,
    tier: 'high'
  });
  assert.equal(thinDry.enabled, true);
  assert.ok(thinDry.iceOpacity > 0);
  assert.ok(thinDry.ice > thinDry.slush);
});

test('thaw visuals disappear after accumulation is effectively gone', () => {
  const gone = snowThawProfile({
    accumulation: SNOW_THAW_MIN_ACCUMULATION,
    snowIntensity: 0,
    wetness: 1,
    tier: 'medium'
  });
  assert.equal(gone.enabled, false);
  assert.equal(gone.slushOpacity, 0);
  assert.equal(gone.iceOpacity, 0);
});
