import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBiryongSamples, boundedPerformancePhase } from './browser/biryong-performance-diagnostics.mjs';
const sample = (p95Ms = 20, p99Ms = 30, longFrameRate = 0) => ({ sampleCount: 90, p95Ms, p99Ms, longFrameRate });
test('an unusable LOW baseline is INCONCLUSIVE and never a performance pass', () => {
  const result = classifyBiryongSamples({ tier: 'low', baseline: sample(550, 566.7, .8), visual: sample(600, 616.7, .8444) });
  assert.equal(result.outcome, 'INCONCLUSIVE');
  assert.equal(result.passed, false);
  assert.equal(result.baselineValid, false);
  assert.ok(result.baselineAssessment.violations.includes('p95Ms:550>85'));
  assert.ok(result.visualAssessment.p95Ratio < 1.1);
});
test('valid baseline with visual regression fails unchanged original budgets', () => {
  const result = classifyBiryongSamples({ tier: 'low', baseline: sample(), visual: sample(100, 170, .4) });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.baselineValid, true);
  assert.equal(result.passed, false);
});
test('only complete, finite, valid baseline and visual measurements pass', () => {
  assert.equal(classifyBiryongSamples({ tier: 'low', baseline: sample(), visual: sample(25, 35) }).outcome, 'PASS');
  for (const baseline of [{}, { ...sample(), sampleCount: 0 }, { ...sample(), p95Ms: null }]) {
    assert.equal(classifyBiryongSamples({ tier: 'low', baseline, visual: sample() }).outcome, 'INCONCLUSIVE');
  }
});
test('host deadline rejects a stalled browser evaluate without waiting for browser timers', async () => {
  await assert.rejects(boundedPerformancePhase(() => new Promise(() => {}), { label: 'baseline:low:sample', timeoutMs: 10 }), /baseline:low:sample.*deadline/);
  assert.equal(await boundedPerformancePhase(async () => 42, { label: 'fast', timeoutMs: 1000 }), 42);
});
test('fatal browser failures interrupt a sampling phase immediately', async () => {
  await assert.rejects(boundedPerformancePhase(() => new Promise(() => {}), {
    label: 'visual:low:sample', timeoutMs: 1000, fatal: Promise.reject(new Error('page crashed'))
  }), /page crashed/);
});

test('smoke preserves sample budgets, records partial outcomes, and enforces equal scene conditions', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./browser/biryong-performance-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /const WARMUP_FRAMES = 30;/);
  assert.match(source, /const SAMPLE_FRAMES = 90;/);
  assert.match(source, /count|sampleCount >= 60/);
  assert.match(source, /assertComparable\(baseline.scene, scene\)/);
  assert.match(source, /process.exitCode = 1/);
  assert.match(source, /finally \{[\s\S]*await persist\(\)/);
  assert.match(source, /validForComparison: baselineCheck.baselineValid/);
  assert.match(source, /fatals.set\(page, smoke.watch\(page\)\)/);
  assert.match(source, /localStorage.clear\(\)/);
  assert.match(source, /gpuTimeMeasured: false/);
});
