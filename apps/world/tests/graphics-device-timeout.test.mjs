import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldGraphicsDevice, GraphicsUnavailableError } from '../src/webgpu-device.js';

function graphicsApi(t, { initWebGpu, createWebGl, destroyWebGpu } = {}) {
  t.mock.getter(globalThis, 'navigator', () => ({ gpu: initWebGpu ? {} : undefined }));
  return {
    WebgpuGraphicsDevice: class {
      initWebGpu() { return initWebGpu(); }
      destroy() { destroyWebGpu?.(); }
    },
    WebglGraphicsDevice: class {
      constructor(canvas, options) { return createWebGl(canvas, options); }
    }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('fast WebGPU succeeds without destroying the device', async t => {
  let releases = 0;
  const device = { isWebGPU: true, isWebGL2: false, destroy: () => { releases++; } };
  const result = await createWorldGraphicsDevice(graphicsApi(t, { initWebGpu: async () => device }), {}, { timeoutMs: 100 });
  assert.equal(result, device);
  assert.equal(releases, 0);
});

test('WebGL2 opens when WebGPU is unavailable', async t => {
  const canvas = {};
  const device = { isWebGPU: false, isWebGL2: true, destroy() { throw new Error('should not be called'); } };
  const pc = graphicsApi(t, { createWebGl(target, options) {
    assert.equal(target, canvas);
    assert.equal(options.powerPreference, 'high-performance');
    return device;
  } });
  assert.equal(await createWorldGraphicsDevice(pc, canvas, { timeoutMs: 100 }), device);
});

test('async WebGPU failure releases the partial device before opening WebGL2', async t => {
  const device = { isWebGL2: true };
  let released = false;
  const pc = graphicsApi(t, {
    initWebGpu: async () => { throw new Error('no GPU adapter'); },
    destroyWebGpu() { released = true; },
    createWebGl() { assert.equal(released, true); return device; }
  });
  assert.equal(await createWorldGraphicsDevice(pc, {}), device);
});

test('a synchronous WebGL2 failure after async WebGPU failure rejects before the watchdog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cause = new Error('WebGL not supported');
  const pc = graphicsApi(t, {
    initWebGpu: async () => { throw new Error('no GPU adapter'); },
    createWebGl() { throw cause; }
  });
  await assert.rejects(createWorldGraphicsDevice(pc, {}), e =>
    e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_FAILED' && e.cause === cause);
});

test('timeout retains the public GRAPHICS_INIT_TIMEOUT code and destroys late GPU exactly once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  let releases = 0;
  const result = createWorldGraphicsDevice(graphicsApi(t, { initWebGpu: () => pending.promise }), {});
  const rejected = assert.rejects(result, e => e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(10_000);
  await rejected;
  pending.resolve({ isWebGPU: true, destroy() { releases++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 1);
});

test('late cleanup failure does not create an unhandled rejection or replace timeout error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const result = createWorldGraphicsDevice(graphicsApi(t, { initWebGpu: () => pending.promise }), {}, { timeoutMs: 17 });
  const rejected = assert.rejects(result, e => e.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(17);
  await rejected;
  pending.resolve({ isWebGPU: true, destroy() { throw new Error('GPU already lost'); } });
  await new Promise(resolve => setImmediate(resolve));
});

test('late WebGPU failure after timeout releases it without starting WebGL2', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  let releases = 0, webglAttempts = 0;
  const pc = graphicsApi(t, {
    initWebGpu: () => pending.promise,
    destroyWebGpu() { releases++; },
    createWebGl() { webglAttempts++; return { isWebGL2: true }; }
  });
  const result = createWorldGraphicsDevice(pc, {}, { timeoutMs: 5 });
  const rejected = assert.rejects(result, e => e.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(5);
  await rejected;
  pending.reject(new Error('driver initialized too late'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 1);
  assert.equal(webglAttempts, 0);
});

test('non-timeout initialization error preserves GRAPHICS_INIT_FAILED', async t => {
  await assert.rejects(
    createWorldGraphicsDevice(graphicsApi(t, { createWebGl() { throw new Error('driver failure'); } }), {}, { timeoutMs: 100 }),
    e => e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_FAILED'
  );
});

test('non-WebGPU/non-WebGL2 result preserves existing initialization failure', async t => {
  await assert.rejects(
    createWorldGraphicsDevice(graphicsApi(t, { createWebGl: () => ({ isWebGPU: false, isWebGL2: false }) }), {}, { timeoutMs: 100 }),
    e => e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_FAILED'
  );
});
