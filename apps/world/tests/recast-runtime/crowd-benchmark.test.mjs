import test from 'node:test';
import assert from 'node:assert/strict';
import { INHA_NATIVE_P0_SCHEMA, runCrowdBenchmark } from './crowd-benchmark.mjs';

test('INHA Native P0 one-shot full 48/100/200 crowd benchmark', async () => {
  const result = await runCrowdBenchmark({ tiers: [48, 100, 200], steps: 180, includeJs: true });
  assert.equal(result.schema, INHA_NATIVE_P0_SCHEMA);
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.productionCutover, false);
  assert.equal(result.packageVersion, '0.43.1');
  assert.ok(result.movementPairCount >= 48);

  for (const tier of result.results) {
    assert.equal(tier.wasm.activeAgents, tier.agents);
    assert.equal(tier.wasm.acceptedTargets, tier.agents);
    assert.equal(tier.wasm.invalidAgents, 0);
    assert.ok(Number.isFinite(tier.wasm.updateMs) && tier.wasm.updateMs >= 0);
    assert.ok(Number.isFinite(tier.wasm.meanDistanceMoved) && tier.wasm.meanDistanceMoved > 0);
    assert.ok(Number.isFinite(tier.js.updateMs) && tier.js.updateMs >= 0);
  }

  console.log('INHA_NATIVE_P0_FULL_BENCHMARK=' + JSON.stringify(result));
});
