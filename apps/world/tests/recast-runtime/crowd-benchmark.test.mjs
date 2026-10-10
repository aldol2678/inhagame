import test from 'node:test';
import assert from 'node:assert/strict';
import { INHA_NATIVE_P0_SCHEMA, runCrowdBenchmark } from './crowd-benchmark.mjs';

test('INHA Native P0 initializes real DetourCrowd WASM for 48 campus agents without taking authority', async () => {
  const result = await runCrowdBenchmark({ tiers: [48], steps: 30, includeJs: true });
  assert.equal(result.schema, INHA_NATIVE_P0_SCHEMA);
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.productionCutover, false);
  assert.equal(result.packageVersion, '0.43.1');
  assert.ok(result.movementPairCount >= 48);

  const tier = result.results[0];
  assert.equal(tier.agents, 48);
  assert.equal(tier.wasm.activeAgents, 48);
  assert.equal(tier.wasm.acceptedTargets, 48);
  assert.equal(tier.wasm.invalidAgents, 0);
  assert.ok(Number.isFinite(tier.wasm.updateMs) && tier.wasm.updateMs >= 0);
  assert.ok(Number.isFinite(tier.wasm.meanDistanceMoved) && tier.wasm.meanDistanceMoved > 0);
  assert.ok(Number.isFinite(tier.js.updateMs) && tier.js.updateMs >= 0);
});
