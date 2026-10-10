import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoCapture } from '../src/photo/photo-capture.js';

function fixture({ width = 640, height = 360, contextLost = false, transparent = false, now } = {}) {
  const listeners = new Map(), subscribers = new Set(), timers = new Set(), draws = [];
  const app = { graphicsDevice: { contextLost }, renderNextFrame: false,
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
    now, setTimer(fn) { timers.add(fn); return fn; }, clearTimer(fn) { timers.delete(fn); } });
  return { app, canvas, mode, capture, snapshot, draws, listeners, subscribers, timers,
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

for (const stage of ['awaiting-frame', 'encoding']) test(`timeout preserves the capture phase: ${stage}`, async () => {
  const h = fixture(), pending = h.capture.request();
  if (stage === 'encoding') h.frame();
  [...h.timers][0]();
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'timeout'); assert.equal(error.phase, stage);
    assert.ok(Number.isFinite(error.elapsedMs) && error.elapsedMs >= 0);
    return true;
  });
  if (stage === 'encoding') h.encode(png());
  assert.equal(h.capture.busy, false); assert.equal(h.snapshot.width, 0);
});

for (const [options, reason] of [[{ width: 0 }, 'dimensions'], [{ contextLost: true }, 'context-lost'], [{ transparent: true }, 'empty-frame']])
  test(`readback failure preserves a bounded reason: ${reason}`, async () => {
    const h = fixture(options), pending = h.capture.request(); h.frame();
    await assert.rejects(pending, { code: 'unavailable', phase: 'readback', reason });
  });

test('encoding callback and synchronous encoding exceptions preserve phase without raw exception text', async () => {
  for (const throwing of [false, true]) {
    const h = fixture();
    if (throwing) h.snapshot.toBlob = () => { throw new Error('private raw exception'); };
    const pending = h.capture.request(); h.frame(); if (!throwing) h.encode(null);
    await assert.rejects(pending, error => {
      assert.equal(error.phase, 'encoding'); assert.equal(error.reason, throwing ? 'exception' : 'invalid-blob');
      assert.doesNotMatch(error.message, /private raw exception/); return true;
    });
  }
});

test('elapsed diagnostics use the injected monotonic clock without altering the deadline', async () => {
  let at = 120;
  const h = fixture({ now: () => at }), pending = h.capture.request();
  at = 180; h.frame(); at = 10125; [...h.timers][0]();
  await assert.rejects(pending, { code: 'timeout', phase: 'encoding', elapsedMs: 10005 });
});
