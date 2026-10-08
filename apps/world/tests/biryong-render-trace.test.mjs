import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { installWindowProbe, BoundedTrace, assertResolutionControl, summarizeIntervals, TRACE_LIMITS } from './browser/biryong-render-trace-support.mjs';

// Removing the byte/event bound would retain the oversized event and fail this contract.
test('trace collector keeps valid partial JSON under byte and event caps', () => {
  const c = new BoundedTrace({ maxBytes: 120, maxEvents: 2 });
  c.add([{ name: 'first' }, { name: 'x'.repeat(200) }, { name: 'last' }]);
  assert.equal(c.events.length, 1);
  assert.equal(c.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(c.document())) <= 120);
  const n = new BoundedTrace({ maxBytes: 1000, maxEvents: 1 });
  n.add([{ name: 'one' }, { name: 'two' }]);
  assert.equal(n.events.length, 1);
});
const scene = () => ({ viewport: [1280, 720, 1], drawingBuffer: [1024, 576], driver: 'SwiftShader',
  camera: [0, .3, 3.5, false], cameraTransform: [0, 2, 75], position: [0, 1, 75],
  environment: ['DAY', 'CLEAR'], graphics: { tier: 'low', frameLimit: 'auto', castShadows: false },
  visible: 'visible', inBiryong: true, renderComponents: 74 });
test('resolution control allows only half drawing buffer; rejects scene drift or absent baseline', () => {
  const a = scene(), b = scene(); b.drawingBuffer = [512, 288];
  assertResolutionControl(a, b, .5);
  b.graphics.frameLimit = 30;
  assert.throws(() => assertResolutionControl(a, b, .5), /graphics/);
  assert.throws(() => assertResolutionControl(null, b, .5));
  const c = scene(); c.drawingBuffer = [513, 288];
  assert.throws(() => assertResolutionControl(a, c, .5), /drawingBuffer/);
  const d = scene(); d.cameraTransform[0] += .1;
  assert.throws(() => assertResolutionControl(a, d, 1), /cameraTransform/);
});
test('interval summary distinguishes unavailable samples and never calls frame intervals GPU time', () => {
  assert.deepEqual(summarizeIntervals([]), { sampleCount: 0, meanMs: null, p95Ms: null });
  assert.deepEqual(summarizeIntervals([10, 20, 30]), { sampleCount: 3, meanMs: 20, p95Ms: 30 });
  assert.equal(TRACE_LIMITS.windowMs, 8000);
  assert.equal(TRACE_LIMITS.maxSamples, 120);
});
test('diagnostic workflow pins immutable main and preserves artifacts without claiming performance pass', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/biryong-render-trace.yml', import.meta.url), 'utf8');
  assert.match(workflow, /ref: e49419c39d884515f2402a2f3a23fe4c754b8882/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /WORLD_SMOKE_TIMEOUT_MS|pull_request_target|secrets\./);
  const script = await readFile(new URL('./browser/biryong-render-trace.mjs', import.meta.url), 'utf8');
  assert.match(script, /gpuTimeMeasured: false/);
  assert.match(script, /DIAGNOSTIC_ONLY/);
  assert.match(script, /baseline-before.*half-resolution.*baseline-after/s);
  assert.doesNotMatch(script, /setFrameLimit|setViewportSize|screenshot\(/);
});

test('runner temp context is scoped to the collection step, not job env', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/biryong-render-trace.yml', import.meta.url), 'utf8');
  // GitHub's context-availability contract permits runner in steps.env/with,
  // but not jobs.<job_id>.env. This is a targeted semantic regression check.
  const jobEnv = workflow.match(/^    env:\n([\s\S]*?)^    steps:/m)?.[1];
  assert.ok(jobEnv, 'expected job env section');
  assert.doesNotMatch(jobEnv, /\$\{\{[^}]*\brunner\./);
  const collection = workflow.match(/      - name: Collect bounded[^\n]*\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(collection, 'expected collection step');
  assert.match(collection, /^        env:\n          BIRYONG_TRACE_OUTPUT: \$\{\{ runner\.temp \}\}\/biryong-render-trace$/m);
  assert.match(workflow, /^          path: \$\{\{ runner\.temp \}\}\/biryong-render-trace\/\*\*$/m);
});

// Removing hook cleanup, changing span boundaries or removing sample caps breaks this test.
test('browser probe aligns CPU-wall spans, records raw stats and removes hooks without replacing engine methods', () => {
  const app = new EventEmitter();
  Object.assign(app, { frame: 1, graphicsDevice: { canvas: { width: 1024, height: 576 } },
    stats: { frame: { updateTime: 0, renderTime: 999999 }, drawCalls: { total: 74 } } });
  let time = 0, nextId = 0;
  const callbacks = new Map();
  const sandbox = { window: { __INHAGAME_P0__: { app } }, performance: { now: () => time, timeOrigin: 1000 },
    requestAnimationFrame: fn => { const id = ++nextId; callbacks.set(id, fn); return id; },
    cancelAnimationFrame: id => callbacks.delete(id) };
  vm.runInNewContext(`(${installWindowProbe.toString()})({ maxSamples: 2 })`, sandbox);
  for (let i = 0; i < 5; i++) {
    time = i * 20; app.emit('frameupdate'); time += 3; app.emit('framerender');
    time += 7; app.emit('postrender'); time += 1; app.emit('frameend');
    const current = [...callbacks]; callbacks.clear(); current.forEach(([, fn]) => fn(time));
  }
  const result = sandbox.window.__BIRYONG_TRACE_WINDOW__.stop();
  assert.equal(result.frames.length, 2); assert.equal(result.raf.length, 2); assert.equal(result.postrender.length, 2);
  assert.equal(result.observedFrames, 5); assert.equal(result.observedRaf, 5);
  assert.equal(result.frames[0].updateCpuWallMs, 3); assert.equal(result.frames[0].renderSubmissionCpuWallMs, 8);
  assert.equal(result.frames[0].engineStatsRaw.renderTime, 999999);
  assert.equal(result.frames[0].drawCalls, 74);
  assert.equal(app.eventNames().length, 0); assert.equal(callbacks.size, 0);
  assert.equal(app.graphicsDevice.canvas.width, 1024);
});
