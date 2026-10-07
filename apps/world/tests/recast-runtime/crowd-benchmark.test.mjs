import test from 'node:test';
import assert from 'node:assert/strict';
import { INHA_NATIVE_P0_SCHEMA, runCrowdBenchmark } from './crowd-benchmark.mjs';

test('INHA Native P0 initializes real DetourCrowd WASM and records 48/100/200 benchmark tiers', async () => {
  const result = await runCrowdBenchmark({ tiers: [48, 100, 200], steps: 180, includeJs: true });
  assert.equal(result.schema, INHA_NATIVE_P0_SCHEMA);
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.productionCutover, false);
  assert.equal(result.packageVersion, '0.43.1');
  assert.ok(result.movementPairCount >= 48);

  const tier48 = result.results[0];
  assert.equal(tier48.agents, 48);
  assert.equal(tier48.wasm.activeAgents, 48);
  assert.equal(tier48.wasm.acceptedTargets, 48);
  assert.equal(tier48.wasm.invalidAgents, 0);
  assert.ok(Number.isFinite(tier48.wasm.updateMs) && tier48.wasm.updateMs >= 0);
  assert.ok(Number.isFinite(tier48.wasm.meanDistanceMoved) && tier48.wasm.meanDistanceMoved > 0);
  assert.ok(Number.isFinite(tier48.js.updateMs) && tier48.js.updateMs >= 0);

  console.log('INHA_NATIVE_P0_FULL_BENCHMARK=' + JSON.stringify(result));
});
