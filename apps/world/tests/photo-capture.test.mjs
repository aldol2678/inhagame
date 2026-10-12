import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoCapture } from '../src/photo/photo-capture.js';
import { createPhotoModePanel } from '../src/photo/photo-mode-panel.js';
import { createFakeDocument } from './support/fake-dom.mjs';

function fixture({ width = 640, height = 360, contextLost = false, transparent = false } = {}) {
  const listeners = new Map(), subscribers = new Set(), timers = new Set(), timerDelays = [], draws = [];
  let time = 0;
  const app = { frame: 0, graphicsDevice: { contextLost }, renderNextFrame: false,
    on(name, fn) { listeners.set(name, fn); }, off(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
  const mode = { active: true, valid: true, update() { if (!this.valid) this.close(); return this.active; },
    close() { this.active = false; for (const fn of subscribers) fn({ active: false }); },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); } };
  const canvas = { width, height };
  let encode, mime;
  const snapshot = { width: 0, height: 0,
    getContext() { return { drawImage(...args) { draws.push(args); },
      getImageData() { return { data: new Uint8ClampedArray([10, 30, 50, transparent ? 0 : 255]) }; } }; },
    toBlob(fn, type) { encode = fn; mime = type; } };
  const capture = createPhotoCapture({ app, canvas, mode, doc: { createElement: () => snapshot },
    now: () => time,
    setTimer(fn, ms) { timers.add(fn); timerDelays.push(ms); return fn; }, clearTimer(fn) { timers.delete(fn); } });
  return { app, canvas, mode, capture, snapshot, draws, listeners, subscribers, timers, timerDelays,
    advance: ms => { time += ms; },
    frame: () => listeners.get('frameend')?.(), encode: blob => encode(blob), get mime() { return mime; } };
}
const png = () => new Blob(['synthetic encoded image'], { type: 'image/png' });

test('snapshots only the next completed existing frame at backing-store dimensions, then encodes PNG', async () => {
  const h = fixture(), promise = h.capture.request();
  assert.equal(h.app.renderNextFrame, true); assert.equal(h.draws.length, 0); assert.equal(h.capture.busy, true);
  h.frame(); assert.deepEqual(h.draws, [[h.canvas, 0, 0]]);
  assert.equal(h.snapshot.width, 640); assert.equal(h.snapshot.height, 360); assert.equal(h.mime, 'image/png');
  assert.equal(h.listeners.size, 0, 'detach frame listener before encoding');
  const blob = png(); h.encode(blob); const result = await promise;
  assert.deepEqual(result, { blob, width: 640, height: 360 });
  assert.equal(h.capture.busy, false); assert.equal(h.timers.size, 0); assert.equal(h.snapshot.width, 0);
});

test('rapid duplicate requests do not queue another capture', async () => {
  const h = fixture(), first = h.capture.request();
  await assert.rejects(h.capture.request(), { code: 'busy' });
  h.frame(); h.encode(png()); await first; assert.equal(h.draws.length, 1);
});

for (const stage of ['before frame', 'during encode']) test(`close cancels ${stage}; late callbacks cannot enter a reopened session`, async () => {
  const h = fixture(), first = h.capture.request();
  if (stage === 'during encode') h.frame();
  h.mode.close(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.snapshot.width, 0);
  h.mode.active = true;
  if (stage === 'during encode') h.encode(png());
  assert.equal(h.capture.busy, false);
});

for (const stage of ['before frame', 'during encode']) test(`account/transition revalidation cancels ${stage}`, async () => {
  const h = fixture(), pending = h.capture.request();
  if (stage === 'during encode') h.frame();
  h.mode.valid = false;
  if (stage === 'before frame') h.frame(); else h.encode(png());
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(h.capture.busy, false);
});

test('timeouts release the pending frame and allow a later retry', async () => {
  const h = fixture(), first = h.capture.request(); [...h.timers][0]();
  await assert.rejects(first, { code: 'timeout' }); assert.equal(h.listeners.size, 0);
  const second = h.capture.request(); h.frame(); h.encode(png()); await second;
});

for (const options of [{ width: 0 }, { contextLost: true }, { transparent: true }]) test(`unavailable or empty frame fails explicitly: ${JSON.stringify(options)}`, async () => {
  const h = fixture(options), pending = h.capture.request(); h.frame();
  await assert.rejects(pending, { code: 'unavailable' }); assert.equal(h.capture.busy, false);
});

test('null or non-PNG encoding fails and releases canvas memory', async () => {
  for (const blob of [null, new Blob(['x'], { type: 'image/jpeg' }), new Blob([], { type: 'image/png' })]) {
    const h = fixture(), pending = h.capture.request(); h.frame(); h.encode(blob);
    await assert.rejects(pending, { code: 'encoding' }); assert.equal(h.snapshot.width, 0);
  }
});

test('canvas security errors fail without leaving a listener or a busy operation', async () => {
  const h = fixture(); h.snapshot.getContext = () => { throw new Error('tainted canvas'); };
  const pending = h.capture.request(); h.frame(); await assert.rejects(pending, { code: 'unavailable' });
  assert.equal(h.listeners.size, 0); assert.equal(h.capture.busy, false);
});

test('destroy cancels once and removes mode subscription; closed modes cannot capture', async () => {
  const h = fixture(), pending = h.capture.request(); h.capture.destroy(); h.capture.destroy();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.subscribers.size, 0); await assert.rejects(h.capture.request(), { name: 'AbortError' });
  const closed = fixture(); closed.mode.close(); await assert.rejects(closed.capture.request(), { name: 'AbortError' });
});

test('capture diagnostics are immutable, image-free and measure each stage without changing its deadline', async () => {
  const h = fixture(); h.app.frame = 10;
  assert.equal(h.capture.status().state, 'idle');
  const getContext = h.snapshot.getContext;
  h.snapshot.getContext = () => {
    assert.equal(h.capture.status().stage, 'readback');
    h.advance(7);
    return getContext();
  };
  const promise = h.capture.request(), timer = [...h.timers][0];
  h.advance(2);
  const waiting = h.capture.status();
  assert.equal(Object.isFrozen(waiting), true);
  assert.equal(waiting.stage, 'waiting-frame'); assert.equal(waiting.elapsedMs, 2);
  assert.throws(() => { waiting.stage = 'changed'; }, TypeError);
  h.app.frame = 11; h.frame(); h.advance(3);
  const encoding = h.capture.status();
  assert.equal(encoding.stage, 'encoding');
  assert.equal(encoding.frameWaitMs, 2); assert.equal(encoding.readbackMs, 7); assert.equal(encoding.encodingMs, 3);
  assert.equal(waiting.stage, 'waiting-frame', 'previous snapshots never mutate');
  assert.deepEqual([...h.timers], [timer], 'readback and encoding do not reset the timer');
  assert.deepEqual(h.timerDelays, [10_000], 'one unchanged production deadline');
  h.app.frame = 12; h.encode(png()); await promise;
  const complete = h.capture.status();
  assert.deepEqual(complete, { state: 'succeeded', stage: 'complete', errorCode: null,
    requestedFrame: 10, capturedFrame: 11, settledFrame: 12, width: 640, height: 360,
    elapsedMs: 12, frameWaitMs: 2, readbackMs: 7, encodingMs: 3 });
  assert.ok(Object.values(complete).every(value => value === null || ['string', 'number'].includes(typeof value)),
    'no canvases, blobs, pixels, URLs, account or request identifiers');
  h.advance(50); assert.deepEqual(h.capture.status(), complete, 'settled elapsed times stay fixed');
});

for (const stage of ['waiting-frame', 'encoding']) test(`timeout diagnostics preserve the ${stage} failure and ignore late work`, async () => {
  const h = fixture(), pending = h.capture.request();
  if (stage === 'encoding') { h.advance(25); h.app.frame = 1; h.frame(); }
  h.advance(stage === 'encoding' ? 9975 : 10_000); [...h.timers][0]();
  await assert.rejects(pending, { code: 'timeout' });
  const failed = h.capture.status();
  assert.equal(failed.state, 'failed'); assert.equal(failed.stage, stage); assert.equal(failed.errorCode, 'timeout');
  assert.equal(failed.elapsedMs, 10_000);
  assert.equal(failed.frameWaitMs, stage === 'encoding' ? 25 : 10_000);
  assert.equal(failed.encodingMs, stage === 'encoding' ? 9975 : 0);
  if (stage === 'encoding') h.encode(png()); else h.frame();
  assert.deepEqual(h.capture.status(), failed);
  assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.capture.busy, false);
});

test('unavailable and invalid PNG failures keep their original codes and distinct stages', async () => {
  for (const unavailable of [true, false]) {
    const h = fixture({ transparent: unavailable }), pending = h.capture.request();
    h.advance(4); h.frame();
    if (!unavailable) { h.advance(6); h.encode(null); }
    await assert.rejects(pending, { code: unavailable ? 'unavailable' : 'encoding' });
    const failed = h.capture.status();
    assert.equal(failed.state, 'failed');
    assert.equal(failed.stage, unavailable ? 'readback' : 'encoding');
    assert.equal(failed.errorCode, unavailable ? 'unavailable' : 'encoding');
    assert.equal(failed.elapsedMs, unavailable ? 4 : 10);
    assert.equal(h.snapshot.width, 0); assert.equal(h.capture.busy, false);
  }
});

test('cancellation and rejected duplicate requests cannot overwrite a newer capture diagnostic', async () => {
  const h = fixture(), first = h.capture.request(); h.frame(); h.advance(5); h.mode.close();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(h.capture.status().state, 'cancelled'); assert.equal(h.capture.status().errorCode, 'cancelled');
  assert.equal(h.capture.status().stage, 'encoding');
  h.mode.active = true;
  const second = h.capture.request(), current = h.capture.status();
  h.encode(png());
  assert.deepEqual(h.capture.status(), current, 'old encoding callback is ignored even after reopen');
  await assert.rejects(h.capture.request(), { code: 'busy' });
  assert.deepEqual(h.capture.status(), current, 'duplicate request cannot replace the accepted request');
  h.frame(); h.encode(png()); await second;
  assert.equal(h.capture.status().state, 'succeeded'); assert.equal(h.capture.status().errorCode, null);
});

test('existing panel status exposes the capture diagnostic for browser failure reports', async () => {
  const h = fixture(), doc = createFakeDocument(); doc.body = doc.createElement('body');
  const panel = createPhotoModePanel({ mode: h.mode, capture: h.capture, doc, win: null });
  assert.deepEqual(panel.status().capture, h.capture.status());
  const pending = h.capture.request(); h.advance(10_000); [...h.timers][0]();
  await assert.rejects(pending, { code: 'timeout' });
  assert.equal(panel.status().capture.errorCode, 'timeout');
  assert.equal(panel.status().capture.stage, 'waiting-frame');
  assert.equal(Object.isFrozen(panel.status().capture), true);
});
