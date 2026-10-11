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

test('long asset waits do not fail; confirmed asset and GPU errors reject', async () => {
  const app = new EventEmitter();
  let timeoutCallback, rejectAssets, delayed = false, settled = false;
  const timers = { setTimeout(callback) { timeoutCallback = callback; return 1; }, clearTimeout() {} };
  const waiting = waitForWorldRender({ app, ready: new Promise((resolve, reject) => { rejectAssets = reject; }),
    timers, onDelay: () => { delayed = true; } });
  waiting.then(() => { settled = true; }, () => { settled = true; });
  timeoutCallback();
  await Promise.resolve();
  assert.equal(delayed, true);
  assert.equal(settled, false, 'elapsed time is not evidence of failure');
  rejectAssets(new Error('model failed'));
  await assert.rejects(waiting, /model failed/);
  assert.equal(app.listenerCount('postrender'), 0);
  app.graphicsDevice = { wgpu: { queue: { onSubmittedWorkDone() { throw new Error('GPU lost'); } } } };
  const rendering = waitForWorldRender({ app });
  await Promise.resolve();
  for (let i = 0; i < 3; i++) app.emit('postrender');
  await assert.rejects(rendering, /GPU lost/);
  assert.equal(app.listenerCount('postrender'), 0);
});
