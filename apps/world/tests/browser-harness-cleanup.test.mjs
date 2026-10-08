import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { abortSmokeResources } from './browser/harness-cleanup.mjs';

test('forced cleanup stops only the owned server before attempting browser close', async () => {
  const calls = [];
  const pending = abortSmokeResources({
    stopServer() { calls.push('owned-server'); },
    browser: { close() { calls.push('browser'); return new Promise(() => {}); } }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['owned-server', 'browser']);
  // The caller bounds abort independently; browser responsiveness cannot delay server stop.
  void pending;
});

test('server is already stopped if the independent browser close fails', async () => {
  const calls = [];
  await assert.rejects(abortSmokeResources({
    stopServer() { calls.push('owned-server'); },
    browser: { close() { calls.push('browser'); throw new Error('browser closed'); } }
  }), /browser closed/);
  assert.deepEqual(calls, ['owned-server', 'browser']);
});

test('normal harness close retains its existing order; abort is a separate optional hook', async () => {
  const harness = await readFile(new URL('./browser/harness.mjs', import.meta.url), 'utf8');
  assert.match(harness, /await context\.close\(\);\s*await browser\.close\(\);\s*server\.stop\(\);/);
  assert.match(harness, /abort: \(\) => abortSmokeResources\(\{ stopServer: server\.stop, browser \}\)/);
});
