import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_DEPTH_MIN_ACCUMULATION,
  SNOW_DEPTH_OPACITY,
  SNOW_DRIFT_BUDGET,
  SNOW_EDGE_LIP_BUDGET,
  SNOW_PLOW_OPACITY,
  SNOW_PLOW_TRACE_BUDGET,
  snowDepthOpacity,
  snowDepthTierPolicy,
  snowDriftBudget,
  snowEdgeLipBudget,
  snowPlowOpacity,
  snowPlowTraceBudget
} from '../src/environment/snow-depth-policy.js';

test('P6H budgets scale while LOW avoids road plow overlays', () => {
  assert.deepEqual(SNOW_EDGE_LIP_BUDGET, { low: 28, medium: 64, high: 96 });
  assert.deepEqual(SNOW_DRIFT_BUDGET, { low: 4, medium: 10, high: 18 });
  assert.deepEqual(SNOW_PLOW_TRACE_BUDGET, { low: 0, medium: 6, high: 10 });
  assert.equal(snowEdgeLipBudget('unknown'), 64);
  assert.equal(snowDriftBudget('unknown'), 10);
  assert.equal(snowPlowTraceBudget('unknown'), 6);
  assert.deepEqual(snowDepthTierPolicy('low'), {
    edgeLipBudget: 28,
    driftBudget: 4,
    plowTraceBudget: 0
  });
});

test('roof depth and snowdrifts fade in only after meaningful accumulation', () => {
  assert.equal(snowDepthOpacity('medium', 0), 0);
  assert.equal(snowDepthOpacity('medium', SNOW_DEPTH_MIN_ACCUMULATION), 0);
  const partial = snowDepthOpacity('medium', 0.6);
  const full = snowDepthOpacity('medium', 1);
  assert.ok(partial > 0 && partial < full);
  assert.equal(full, SNOW_DEPTH_OPACITY.medium);
  assert.ok(snowDepthOpacity('low', 1) < snowDepthOpacity('high', 1));
});

test('plow traces follow accumulation and graphics tier', () => {
  assert.equal(snowPlowOpacity('low', 1), SNOW_PLOW_OPACITY.low);
  assert.equal(snowPlowOpacity('medium', SNOW_DEPTH_MIN_ACCUMULATION), 0);
  assert.ok(snowPlowOpacity('medium', 0.7) > 0);
  assert.equal(snowPlowOpacity('high', 1), SNOW_PLOW_OPACITY.high);
});
