import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { waitForWorldRender } from '../src/lobby/lobby-loading.js';

test('loader waits for assets, an empty streaming queue, real frames and GPU work', async () => {
  const app = new EventEmitter();
  let assetsDone, gpuDone;
  const ready = new Promise(resolve => { assetsDone = resolve; });
  const gpu = new Promise(resolve => { gpuDone = resolve; });
  app.graphicsDevice = { wgpu: { queue: { onSubmittedWorkDone: () => gpu } } };
  let sceneReady = false, finished = false;
  const paints = [];
  const result = waitForWorldRender({ app, ready, isSceneReady: () => sceneReady,
    requestFrame: callback => paints.push(callback) }).then(value => { finished = true; return value; });
  app.emit('postrender');
  assetsDone();
  await Promise.resolve();
  app.emit('postrender');
  sceneReady = true;
  for (let i = 0; i < 2; i++) app.emit('postrender');
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(paints.length, 0);
  sceneReady = false;
  app.emit('postrender');
  sceneReady = true;
  for (let i = 0; i < 3; i++) app.emit('postrender');
  await Promise.resolve();
  assert.equal(finished, false, 'GPU work is still pending');
  gpuDone();
  await Promise.resolve();
  paints.shift()();
  assert.equal(finished, false, 'loader remains through the paint opportunity');
  paints.shift()();
  assert.deepEqual(await result, { renderedFrames: 3 });
  assert.equal(app.listenerCount('postrender'), 0);
});

test('render timeout and asset failure reject instead of revealing the scene', async () => {
  const app = new EventEmitter();
  let timeoutCallback;
  const timers = { setTimeout(callback) { timeoutCallback = callback; return 1; }, clearTimeout() {} };
  const waiting = waitForWorldRender({ app, ready: new Promise(() => {}), timers });
  timeoutCallback();
  await assert.rejects(waiting, /rendering timed out/);
  assert.equal(app.listenerCount('postrender'), 0);
  await assert.rejects(waitForWorldRender({ app, ready: Promise.reject(new Error('model failed')) }), /model failed/);
  assert.equal(app.listenerCount('postrender'), 0);
});


test('the existing 60s hard deadline distinguishes asset wait from first-render wait', async () => {
  for (const assetsReady of [false, true]) {
    const app = new EventEmitter();
    let timeout;
    const timers = { setTimeout(fn, ms) { assert.equal(ms, 60000); timeout = fn; return 1; }, clearTimeout() {} };
    const pending = waitForWorldRender({ app, ready: assetsReady ? Promise.resolve() : new Promise(() => {}), timers });
    await Promise.resolve();
    timeout();
    await assert.rejects(pending, { code: assetsReady ? 'INITIAL_RENDER_TIMEOUT' : 'ASSET_LOADING_TIMEOUT' });
    assert.equal(app.listenerCount('postrender'), 0);
  }
});

test('slow assets can still finish before the hard deadline and only real eligible frames count', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new EventEmitter();
  let release, progress = 0;
  const pending = waitForWorldRender({ app, ready: new Promise(resolve => { release = resolve; }),
    onProgress: () => { progress++; }, requestFrame: fn => { fn(); return 1; } });
  t.mock.timers.tick(59000);
  app.emit('postrender');
  assert.equal(progress, 0, 'unresolved assets cannot report rendering progress');
  release(); await Promise.resolve();
  for (let i = 0; i < 3; i++) app.emit('postrender');
  assert.deepEqual(await pending, { renderedFrames: 3 });
  assert.equal(progress, 3);
  assert.equal(app.listenerCount('postrender'), 0);
});

test('scene stalls do not fabricate progress and GPU rejection never reveals a READY frame', async () => {
  const app = new EventEmitter();
  let progress = 0, sceneReady = false;
  app.graphicsDevice = { wgpu: { queue: { onSubmittedWorkDone() { throw Error('device lost'); } } } };
  const pending = waitForWorldRender({ app, isSceneReady: () => sceneReady, onProgress: () => { progress++; } });
  await Promise.resolve();
  for (let i = 0; i < 10; i++) app.emit('postrender');
  assert.equal(progress, 0);
  sceneReady = true;
  for (let i = 0; i < 3; i++) app.emit('postrender');
  await assert.rejects(pending, /device lost/);
  assert.equal(app.listenerCount('postrender'), 0);
});

for (const when of ['already', 'assets', 'gpu', 'paint', 'progress']) {
  test(`cancel ${when} removes the render gate and ignores stale completion`, async () => {
    const app = new EventEmitter(), controller = new AbortController();
    let release, gpuDone, painted = 0, progress = 0;
    const frames = new Map(); let nextFrame = 0;
    app.graphicsDevice = { wgpu: { queue: { onSubmittedWorkDone: () => new Promise(resolve => { gpuDone = resolve; }) } } };
    if (when === 'already') controller.abort();
    const pending = waitForWorldRender({ app, signal: controller.signal,
      ready: when === 'assets' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(),
      onProgress() { progress++; if (when === 'progress') controller.abort(); },
      requestFrame(fn) { painted++; frames.set(++nextFrame, fn); return nextFrame; },
      cancelFrame(id) { frames.delete(id); } });
    const rejected = assert.rejects(pending, { name: 'AbortError', code: 'BOOT_CANCELLED' });
    await Promise.resolve();
    if (['gpu', 'paint', 'progress'].includes(when)) {
      for (let i = 0; i < 3; i++) app.emit('postrender');
      await Promise.resolve();
      if (when === 'paint') { gpuDone(); await Promise.resolve(); }
    }
    controller.abort();
    await rejected;
    release?.(); gpuDone?.();
    await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 5; i++) app.emit('postrender');
    assert.equal(app.listenerCount('postrender'), 0);
    assert.equal(frames.size, 0);
    if (when !== 'paint') assert.equal(painted, 0);
    if (when === 'progress') assert.equal(progress, 1);
  });
}

test('cancelling one of two render waiters leaves the other waiter intact', async () => {
  const app = new EventEmitter(), controller = new AbortController();
  const cancelled = waitForWorldRender({ app, signal: controller.signal });
  const next = waitForWorldRender({ app, requestFrame: fn => { fn(); return 1; } });
  controller.abort();
  await assert.rejects(cancelled, { code: 'BOOT_CANCELLED' });
  assert.equal(app.listenerCount('postrender'), 1);
  for (let i = 0; i < 3; i++) app.emit('postrender');
  assert.deepEqual(await next, { renderedFrames: 3 });
  assert.equal(app.listenerCount('postrender'), 0);
});
