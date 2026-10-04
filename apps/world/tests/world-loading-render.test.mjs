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
