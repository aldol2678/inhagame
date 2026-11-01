import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldGraphicsDevice, GraphicsUnavailableError } from '../src/webgpu-device.js';

const graphicsApi = createGraphicsDevice => ({
  DEVICETYPE_WEBGPU: 'webgpu',
  DEVICETYPE_WEBGL2: 'webgl2',
  createGraphicsDevice
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('fast WebGPU succeeds without destroying the device', async () => {
  let releases = 0;
  const device = { isWebGPU: true, isWebGL2: false, destroy: () => { releases++; } };
  const result = await createWorldGraphicsDevice(graphicsApi((_canvas, opts) => {
    assert.deepEqual(opts.deviceTypes, ['webgpu', 'webgl2']);
    assert.equal(opts.powerPreference, 'high-performance');
    return Promise.resolve(device);
  }), {}, { timeoutMs: 100 });
  assert.equal(result, device);
  assert.equal(releases, 0);
});

test('fast WebGL2 fallback is preserved', async () => {
  const device = { isWebGPU: false, isWebGL2: true, destroy() { throw new Error('should not be called'); } };
  assert.equal(await createWorldGraphicsDevice(graphicsApi(() => Promise.resolve(device)), {}, { timeoutMs: 100 }), device);
});

test('timeout retains the public GRAPHICS_INIT_TIMEOUT code and destroys late GPU exactly once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  let releases = 0;
  const result = createWorldGraphicsDevice(graphicsApi(() => pending.promise), {});
  const rejected = assert.rejects(result, e => e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(10_000);
  await rejected;
  pending.resolve({ isWebGPU: true, destroy() { releases++; } });
  await Promise.resolve(); // release occurs on the settled initialization promise
  assert.equal(releases, 1);
});

test('late cleanup failure does not create an unhandled rejection or replace timeout error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const result = createWorldGraphicsDevice(graphicsApi(() => pending.promise), {}, { timeoutMs: 17 });
  const rejected = assert.rejects(result, e => e.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(17);
  await rejected;
  pending.resolve({ isWebGL2: true, destroy() { throw new Error('GPU already lost'); } });
  await Promise.resolve();
  await Promise.resolve();
});

test('late initialization rejection preserves timeout error and does not generate unhandled rejection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const result = createWorldGraphicsDevice(graphicsApi(() => pending.promise), {}, { timeoutMs: 5 });
  const rejected = assert.rejects(result, e => e.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(5);
  await rejected;
  pending.reject(new Error('driver initialized too late'));
  await Promise.resolve();
  await Promise.resolve();
});

test('non-timeout initialization error preserves GRAPHICS_INIT_FAILED', async () => {
  await assert.rejects(
    createWorldGraphicsDevice(graphicsApi(() => Promise.reject(new Error('driver failure'))), {}, { timeoutMs: 100 }),
    e => e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_FAILED'
  );
});

test('non-WebGPU/non-WebGL2 result preserves existing initialization failure', async () => {
  await assert.rejects(
    createWorldGraphicsDevice(graphicsApi(() => Promise.resolve({ isWebGPU: false, isWebGL2: false })), {}, { timeoutMs: 100 }),
    e => e instanceof GraphicsUnavailableError && e.code === 'GRAPHICS_INIT_FAILED'
  );
});
