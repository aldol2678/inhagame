import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { boundedPerformancePhase } from './browser/biryong-performance-diagnostics.mjs';
import { finalizeTraceDiagnostic } from './browser/biryong-render-trace-cleanup.mjs';

const never = () => new Promise(() => {});
const phase = (label, work) => boundedPerformancePhase(work, { label, timeoutMs: 10 });
async function finish(smoke) {
  const receipt = { status: 'DIAGNOSTIC_COMPLETE' }, calls = [];
  await finalizeTraceDiagnostic({ smoke, receipt, phase,
    fail: () => calls.push('failure'),
    persist: async () => { await delay(2); calls.push(['persist', structuredClone(receipt)]); },
    log: () => calls.push('log'), exit: code => calls.push(['exit', code]) });
  return { receipt, calls };
}
test('normal close preserves normal path: no abort, failure mark or explicit exit', async () => {
  const actions = [];
  const result = await finish({ close: async () => actions.push('close'), abort: async () => actions.push('abort'), problems: [] });
  assert.deepEqual(actions, ['close']);
  assert.equal(result.receipt.status, 'DIAGNOSTIC_COMPLETE');
  assert.deepEqual(result.calls.map(c => Array.isArray(c) ? c[0] : c), ['persist', 'log']);
});
test('close hang calls bounded owned-resource abort and persists partial receipt', async () => {
  let aborts = 0;
  const result = await finish({ close: never, abort: async () => { aborts++; }, problems: [] });
  assert.equal(aborts, 1);
  assert.match(result.receipt.cleanupError, /close-offline-browser.*host deadline/);
  assert.equal(result.receipt.status, 'DIAGNOSTIC_PARTIAL');
  assert.equal(result.receipt.cleanupAbortError, undefined);
  assert.deepEqual(result.calls.map(c => Array.isArray(c) ? c[0] : c), ['failure', 'persist', 'log']);
});
test('close and abort hangs persist partial receipt before explicit failure exit', async () => {
  const result = await finish({ close: never, abort: never, problems: ['test fixture'] });
  assert.match(result.receipt.cleanupAbortError, /abort-offline-browser.*host deadline/);
  assert.equal(result.receipt.forcedFailureExit, true);
  assert.equal(result.receipt.status, 'DIAGNOSTIC_PARTIAL');
  assert.deepEqual(result.calls.map(c => Array.isArray(c) ? c[0] : c), ['failure', 'persist', 'log', 'exit']);
  assert.deepEqual(result.calls.at(-1), ['exit', 1]);
  assert.equal(result.calls[1][1].forcedFailureExit, true);
});
test('missing integrated abort hook fails closed and never silently reports successful cleanup', async () => {
  const result = await finish({ close: async () => { throw new Error('close failed'); } });
  assert.match(result.receipt.cleanupAbortError, /owned-resource abort hook unavailable/);
  assert.equal(result.receipt.forcedFailureExit, true);
  assert.deepEqual(result.calls.at(-1), ['exit', 1]);
});
