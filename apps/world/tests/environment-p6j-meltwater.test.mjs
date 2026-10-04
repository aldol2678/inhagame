import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MELTWATER_DRAIN_BUDGET,
  MELTWATER_EAVE_BUDGET,
  MELTWATER_MIN_ACCUMULATION,
  MELTWATER_RUNOFF_BUDGET,
  meltwaterDrainBudget,
  meltwaterEaveBudget,
  meltwaterProfile,
  meltwaterRunoffBudget
} from '../src/environment/meltwater-policy.js';

test('P6J meltwater budgets are tier bounded', () => {
  assert.deepEqual(MELTWATER_EAVE_BUDGET, { low: 8, medium: 16, high: 24 });
  assert.deepEqual(MELTWATER_RUNOFF_BUDGET, { low: 4, medium: 8, high: 12 });
  assert.deepEqual(MELTWATER_DRAIN_BUDGET, { low: 0, medium: 4, high: 8 });
  assert.equal(meltwaterEaveBudget('unknown'), 16);
  assert.equal(meltwaterRunoffBudget('unknown'), 8);
  assert.equal(meltwaterDrainBudget('unknown'), 4);
});

test('active snowfall suppresses meltwater presentation', () => {
  const state = meltwaterProfile({
    accumulation: 0.6,
    snowIntensity: 1,
    wetness: 1,
    tier: 'high'
  });
  assert.equal(state.enabled, false);
  assert.equal(state.dripOpacity, 0);
  assert.equal(state.runoffOpacity, 0);
});

test('snow to rain transition produces stronger runoff than dry thaw', () => {
  const wet = meltwaterProfile({
    accumulation: 0.5,
    snowIntensity: 0,
    wetness: 1,
    tier: 'high'
  });
  const dry = meltwaterProfile({
    accumulation: 0.5,
    snowIntensity: 0,
    wetness: 0,
    tier: 'high'
  });
  assert.equal(wet.enabled, true);
  assert.ok(wet.dripOpacity > 0);
  assert.ok(wet.runoffOpacity > 0);
  assert.ok(wet.runoff > dry.runoff);
  assert.ok(wet.drip > dry.drip);
});

test('fresh rain without snow history never creates meltwater', () => {
  const state = meltwaterProfile({
    accumulation: 0,
    snowIntensity: 0,
    wetness: 1,
    tier: 'medium'
  });
  assert.equal(state.enabled, false);
  assert.equal(state.runoffOpacity, 0);
  assert.equal(state.dripOpacity, 0);
});

test('meltwater disappears when snow falls below the remaining-snow threshold', () => {
  const state = meltwaterProfile({
    accumulation: MELTWATER_MIN_ACCUMULATION,
    snowIntensity: 0,
    wetness: 1,
    tier: 'medium'
  });
  assert.equal(state.enabled, false);
});
