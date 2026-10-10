import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { abortSmokeResources } from './browser/harness-cleanup.mjs';
import * as cleanupHelpers from './browser/harness-cleanup.mjs';
import { runInNewContext } from 'node:vm';

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

for (const failedStep of ['launch', 'newContext', 'addInitScript', 'route']) {
  test(`startup ${failedStep} failure stops only the owned server and preserves the original error`, async () => {
    const harness = await readFile(new URL('./browser/harness.mjs', import.meta.url), 'utf8');
    const startSource = harness.slice(harness.indexOf('export async function startSmoke(')).replace(/^export /, '');
    const originalError = new Error(`${failedStep} failed`), calls = [];
    const context = {
      addInitScript: async () => { if (failedStep === 'addInitScript') throw originalError; },
      route: async () => { if (failedStep === 'route') throw originalError; }
    };
    const browser = {
      newContext: async () => { if (failedStep === 'newContext') throw originalError; return context; },
      close: async () => { calls.push('browser'); throw new Error('cleanup failed'); }
    };
    const launcher = { launch: async () => { if (failedStep === 'launch') throw originalError; return browser; } };
    const start = runInNewContext(`(${startSource})`, {
      process: { platform: 'linux', env: { WORLD_SMOKE_DISABLE_WEBGPU: '1' } },
      chromium: launcher, webkit: launcher, console,
      pinnedPlayCanvas: async () => ({}),
      startServer: async () => ({ origin: 'http://127.0.0.1:1234', stop: () => { calls.push('owned-server'); } }),
      ...cleanupHelpers
    });
    await assert.rejects(start(), error => error === originalError);
    assert.deepEqual(calls, failedStep === 'launch' ? ['owned-server'] : ['owned-server', 'browser']);
  });
}

test('startup cleanup stops its server before bounding a hung browser close', async () => {
  assert.equal(typeof cleanupHelpers.cleanupFailedSmokeStart, 'function');
  const calls = [];
  await cleanupHelpers.cleanupFailedSmokeStart({
    stopServer: () => { calls.push('owned-server'); },
    browser: { close: () => { calls.push('browser'); return new Promise(() => {}); } }
  }, { timeoutMs: 5 });
  assert.deepEqual(calls, ['owned-server', 'browser']);
});

for (const pendingStep of ['launch', 'newContext', 'addInitScript', 'route']) {
  test(`opt-in startup deadline owns cleanup when ${pendingStep} hangs`, async () => {
    const harness = await readFile(new URL('./browser/harness.mjs', import.meta.url), 'utf8');
    const startSource = harness.slice(harness.indexOf('export async function startSmoke(')).replace(/^export /, '');
    const calls = [];
    let releaseLaunch, releaseContext;
    const context = {
      addInitScript: () => { calls.push('init'); return pendingStep === 'addInitScript' ? new Promise(() => {}) : Promise.resolve(); },
      route: () => { calls.push('route'); return pendingStep === 'route' ? new Promise(() => {}) : Promise.resolve(); }
    };
    const browser = {
      newContext: () => { calls.push('context'); return pendingStep === 'newContext' ? new Promise(resolve => { releaseContext = resolve; }) : Promise.resolve(context); },
      close: async () => { calls.push('browser'); }
    };
    const launcher = { launch: () => pendingStep === 'launch' ? new Promise(resolve => { releaseLaunch = resolve; }) : Promise.resolve(browser) };
    const start = runInNewContext(`(${startSource})`, {
      process: { platform: 'linux', env: { WORLD_SMOKE_DISABLE_WEBGPU: '1' } },
      chromium: launcher, webkit: launcher, console,
      pinnedPlayCanvas: async () => ({}),
      startServer: async () => ({ origin: 'http://127.0.0.1:1234', stop: () => { calls.push('owned-server'); } }),
      ...cleanupHelpers
    });
    const result = await Promise.race([
      start({ startupTimeoutMs: 5 }).then(() => 'completed', error => error.code),
      new Promise(resolve => setTimeout(() => resolve('still pending'), 50))
    ]);
    assert.equal(result, 'SMOKE_STARTUP_TIMEOUT');
    assert.equal(calls.includes('owned-server'), true);
    if (pendingStep === 'launch') {
      assert.deepEqual(calls, ['owned-server']);
      releaseLaunch(browser);
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.deepEqual(calls, ['owned-server', 'browser'], 'late browser closes without starting a context');
    } else {
      assert.equal(calls.at(-1), 'browser');
      assert.ok(calls.indexOf('owned-server') < calls.indexOf('browser'));
      if (releaseContext) {
        releaseContext(context);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(calls.includes('init'), false, 'late context does not continue setup');
      }
    }
  });
}

for (const failure of ['timeout', 'exit', 'error']) test(`dev-server startup ${failure} kills its owned child before rejecting`, async () => {
  const { EventEmitter } = await import('node:events');
  const harness = await readFile(new URL('./browser/harness.mjs', import.meta.url), 'utf8');
  const source = harness.match(/async function startServer\([\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  let deadline, killed = 0;
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { killed++; };
  const start = runInNewContext(`(${source})`, {
    freePort: async () => 1234, process: { env: {}, execPath: process.execPath }, spawn: () => child,
    setTimeout: fn => { deadline = fn; return 1; }, clearTimeout: () => {}
  });
  const pending = start({ worldRoot: '/fixture', devServer: '/fixture/dev-server.mjs' });
  await new Promise(resolve => setTimeout(resolve, 0));
  if (failure === 'timeout') deadline();
  else if (failure === 'exit') child.emit('exit', 1);
  else child.emit('error', new Error('spawn failed'));
  await assert.rejects(pending, /dev-server (did not start|exited)|spawn failed/);
  assert.equal(killed, 1);
});

for (const timeoutMs of [undefined, 100]) test(`successful startup returns its owned handles with deadline ${timeoutMs ?? 'unset'}`, async () => {
  const browser = {}, context = {};
  const result = await cleanupHelpers.startSmokeResources({
    launchBrowser: async () => browser,
    setupContext: async (received, ensureActive) => {
      assert.equal(received, browser);
      await new Promise(resolve => setTimeout(resolve, 5));
      ensureActive(); return context;
    },
    stopServer: () => assert.fail('successful startup must retain its server')
  }, { timeoutMs });
  assert.equal(result.browser, browser);
  assert.equal(result.context, context);
});

test('startup deadline bounds hung cleanup and absorbs a late launch rejection', async () => {
  const calls = [];
  await assert.rejects(cleanupHelpers.startSmokeResources({
    launchBrowser: async () => ({ close: () => { calls.push('browser'); return new Promise(() => {}); } }),
    setupContext: () => new Promise(() => {}),
    stopServer: () => { calls.push('owned-server'); }
  }, { timeoutMs: 5, cleanupTimeoutMs: 5 }), error => error.code === 'SMOKE_STARTUP_TIMEOUT');
  assert.deepEqual(calls, ['owned-server', 'browser']);
  let rejectLaunch;
  await assert.rejects(cleanupHelpers.startSmokeResources({
    launchBrowser: () => new Promise((_, reject) => { rejectLaunch = reject; }),
    setupContext: () => assert.fail('timed-out startup'), stopServer: () => {}
  }, { timeoutMs: 5 }), error => error.code === 'SMOKE_STARTUP_TIMEOUT');
  rejectLaunch(new Error('late launch failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
});

for (const outcome of ['not-started', 'complete', 'failed', 'timeout']) test(`startup cleanup reports ${outcome} without forcing process exit`, async () => {
  const browser = outcome === 'not-started' ? undefined : { close: () => {
    if (outcome === 'failed') throw new Error('close failed');
    if (outcome === 'timeout') return new Promise(() => {});
  } };
  assert.equal(await cleanupHelpers.cleanupFailedSmokeStart({ stopServer: () => {}, browser }, { timeoutMs: 5 }), outcome);
});

for (const outcome of ['complete', 'failed', 'timeout']) test(`original setup error carries its ${outcome} cleanup outcome`, async () => {
  const error = new Error('context setup failed');
  await assert.rejects(cleanupHelpers.startSmokeResources({
    launchBrowser: async () => ({ close: () => {
      if (outcome === 'failed') throw new Error('close failed');
      if (outcome === 'timeout') return new Promise(() => {});
    } }),
    setupContext: async () => { throw error; }, stopServer: () => {}
  }, { cleanupTimeoutMs: 5 }), received => received === error && received.startupCleanup === outcome);
});
