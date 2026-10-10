import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoCapture } from '../src/photo/photo-capture.js';

function fixture({ width = 640, height = 360, contextLost = false, transparent = false, diagnostics = false, onDiagnostic, now } = {}) {
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
  const capture = createPhotoCapture({ app, canvas, mode, diagnostics, onDiagnostic, now, doc: { visibilityState: 'visible', createElement: () => snapshot },
    setTimer(fn) { timers.add(fn); return fn; }, clearTimer(fn) { timers.delete(fn); } });
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


test('diagnostics are disabled by default and never read the clock', async () => {
  const h = fixture({ now: () => { throw new Error('must not run'); } });
  const p = h.capture.request(); h.frame(); h.encode(png()); await p;
  assert.deepEqual(h.capture.diagnostics(), []);
});

test('opt-in diagnostics record monotonic stages and bounded non-sensitive state', async () => {
  let t = 100;
  const h = fixture({ diagnostics: true, now: () => t });
  h.app.autoRender = true;
  const p = h.capture.request(); t = 110; h.frame(); t = 115; h.encode(png()); await p;
  const [record] = h.capture.diagnostics();
  assert.equal(record.code, 'success');
  assert.deepEqual(record.events.map(e => e.phase), ['request', 'frame', 'readback', 'encoding', 'complete']);
  assert.deepEqual(record.events.map(e => e.elapsedMs), [0, 10, 10, 10, 15]);
  assert.deepEqual(record.events[0].state, { visibility: 'visible', contextLost: false, postrenderObservedSinceRequest: false, autoRender: true, renderNextFrame: false, width: 640, height: 360 });
  record.events[0].state.width = -1;
  assert.equal(h.capture.diagnostics()[0].events[0].state.width, 640, 'readers cannot mutate stored evidence');
  for (let i = 0; i < 10; i++) { const p = h.capture.request(); h.frame(); h.encode(png()); await p; }
  assert.equal(h.capture.diagnostics().length, 8);
});

for (const phase of ['request', 'encoding']) test('timeout diagnostics retain last reached phase: ' + phase, async () => {
  const h = fixture({ diagnostics: true });
  const p = h.capture.request(); if (phase === 'encoding') h.frame(); [...h.timers][0]();
  await assert.rejects(p, { code: 'timeout' });
  const [record] = h.capture.diagnostics();
  assert.equal(record.code, 'timeout'); assert.equal(record.phase, phase);
  assert.equal(record.events.at(-1).phase, 'failed');
  const saved = JSON.stringify(record); if (phase === 'encoding') h.encode(png());
  const after = h.capture.diagnostics()[0]; delete after.lateEncodingCallback;
  assert.equal(JSON.stringify(after), saved, 'late callbacks cannot overwrite terminal evidence');
});

test('readback exceptions retain only an allowlisted kind; diagnostic observers cannot break capture', async () => {
  const h = fixture({ diagnostics: true, onDiagnostic: () => { throw new Error('observer failure'); } });
  h.snapshot.getContext = () => ({ drawImage() {}, getImageData() { throw Object.assign(new Error('private account https://secret.example/token'), { name: 'SecurityError' }); } });
  const p = h.capture.request(); h.frame(); await assert.rejects(p, { code: 'unavailable' });
  const [record] = h.capture.diagnostics();
  assert.equal(record.phase, 'readback'); assert.equal(record.exceptionKind, 'SecurityError');
  assert.doesNotMatch(JSON.stringify(record), /private|secret|token/);
});

test('null encoding and cancellation have distinct diagnostics without changing errors', async () => {
  const h = fixture({ diagnostics: true });
  let p = h.capture.request(); h.frame(); h.encode(null); await assert.rejects(p, { code: 'encoding' });
  p = h.capture.request(); h.mode.close(); await assert.rejects(p, { name: 'AbortError' });
  assert.deepEqual(h.capture.diagnostics().map(r => [r.code, r.phase]), [['encoding', 'encoding'], ['cancelled', 'request']]);
});

test('diagnostic clock and observer failures never change successful PNG completion', async () => {
  for (const options of [
    { now: () => { throw new Error('clock unavailable'); } },
    { onDiagnostic: () => { throw new Error('observer unavailable'); } }
  ]) {
    const h = fixture({ diagnostics: true, ...options }), p = h.capture.request();
    h.frame(); const blob = png(); h.encode(blob);
    assert.deepEqual(await p, { blob, width: 640, height: 360 });
    assert.equal(h.timers.size, 0); assert.equal(h.capture.busy, false);
  }
});

test('diagnostic elapsed times never go backwards and final state is sampled again', async () => {
  let t = 10;
  const h = fixture({ diagnostics: true, now: () => t });
  const p = h.capture.request(); t = 20; h.frame(); t = 15;
  h.app.graphicsDevice.contextLost = true; h.encode(null);
  await assert.rejects(p, { code: 'encoding' });
  const [record] = h.capture.diagnostics();
  assert.equal(record.events.at(-1).elapsedMs, 10);
  assert.equal(record.events.at(-1).state.contextLost, true);
});

for (const rendered of [false, true]) test('diagnostics distinguish frameend from observed postrender: ' + rendered, async () => {
  const h = fixture({ diagnostics: true }); h.app.autoRender = false;
  const p = h.capture.request();
  assert.equal(typeof h.listeners.get('postrender'), 'function');
  if (rendered) h.listeners.get('postrender')();
  h.app.renderNextFrame = false; h.frame(); h.encode(png()); await p;
  const [record] = h.capture.diagnostics();
  assert.equal(record.postrenderObservedSinceRequest, rendered);
  assert.equal(record.events.find(e => e.phase === 'frame').state.postrenderObservedSinceRequest, rendered);
  assert.equal(h.listeners.size, 0, 'all per-request listeners removed');
});

for (const end of ['cancel', 'timeout', 'unavailable']) test('postrender observer is removed on ' + end, async () => {
  const h = fixture({ diagnostics: true, contextLost: end === 'unavailable' });
  const p = h.capture.request(), late = h.listeners.get('postrender');
  assert.equal(typeof late, 'function');
  if (end === 'cancel') h.capture.cancel();
  else if (end === 'timeout') [...h.timers][0]();
  else h.frame();
  await assert.rejects(p);
  assert.equal(h.listeners.has('postrender'), false);
  const before = JSON.stringify(h.capture.diagnostics()); late();
  assert.equal(JSON.stringify(h.capture.diagnostics()), before);
});

test('disabled diagnostics never subscribe to postrender', async () => {
  const h = fixture(), p = h.capture.request();
  assert.equal(h.listeners.has('postrender'), false);
  h.frame(); h.encode(png()); await p;
});

test('readback diagnostics separately time draw, pixel read and alpha scan without retaining pixels', async () => {
  let t = 100;
  const h = fixture({ diagnostics: true, now: () => t });
  const pixels = { length: 4, get 3() { t += 3; return 255; } };
  h.snapshot.getContext = () => ({ drawImage() { t += 20; }, getImageData() { t += 400; return { data: pixels }; } });
  const p = h.capture.request(); t = 110; h.frame(); h.encode(png()); await p;
  const [record] = h.capture.diagnostics();
  assert.deepEqual(record.readbackOperations, [
    { operation: 'drawImage', startElapsedMs: 10, endElapsedMs: 30, durationMs: 20 },
    { operation: 'getImageData', startElapsedMs: 30, endElapsedMs: 430, durationMs: 400, rectangle: [0, 0, 1, 1] },
    { operation: 'alphaScan', startElapsedMs: 430, endElapsedMs: 433, durationMs: 3 }
  ]);
  assert.doesNotMatch(JSON.stringify(record), /pixels|data:/);
});

test('failed readback records the started operation but does not fabricate its end', async () => {
  let t = 0;
  const h = fixture({ diagnostics: true, now: () => t });
  h.snapshot.getContext = () => ({ drawImage() { t = 2; }, getImageData() { t = 5; throw new Error('private'); } });
  const p = h.capture.request(); h.frame(); await assert.rejects(p, { code: 'unavailable' });
  assert.deepEqual(h.capture.diagnostics()[0].readbackOperations, [
    { operation: 'drawImage', startElapsedMs: 0, endElapsedMs: 2, durationMs: 2 },
    { operation: 'getImageData', startElapsedMs: 2, endElapsedMs: null, durationMs: null, rectangle: [0, 0, 1, 1] }
  ]);
});

test('timeout diagnostic separates nominal deadline, callback lateness and bounded late encoding observation', async () => {
  let t = 100;
  const h = fixture({ diagnostics: true, now: () => t });
  const p = h.capture.request(); t = 110; h.frame(); t = 13567; [...h.timers][0]();
  await assert.rejects(p, { code: 'timeout' });
  const terminal = h.capture.diagnostics()[0];
  assert.deepEqual(terminal.timeout, { nominalDeadlineElapsedMs: 10000, callbackElapsedMs: 13467, skewMs: 3467 });
  t = 14000; h.encode(png());
  const late = h.capture.diagnostics()[0];
  assert.deepEqual(late.lateEncodingCallback, { elapsedMs: 13900, afterTimeoutMs: 433 });
  delete late.lateEncodingCallback;
  assert.deepEqual(late, terminal, 'terminal evidence stays unchanged');
  t = 15000; h.encode(null);
  assert.equal(h.capture.diagnostics()[0].lateEncodingCallback.elapsedMs, 13900, 'only first callback is retained');
});

for (const ending of ['expired', 'destroyed', 'cancelled', 'evicted']) test('late encoding observation excludes ' + ending, async () => {
  let t = 0;
  const h = fixture({ diagnostics: true, now: () => t });
  const p = h.capture.request(); h.frame();
  const oldEncode = h.encode;
  // Save the actual callback before a later request replaces the fixture callback.
  let callback;
  h.snapshot.toBlob = fn => { callback = fn; };
  if (ending === 'cancelled') h.capture.cancel(); else { t = 10000; [...h.timers][0](); }
  await assert.rejects(p);
  if (ending === 'destroyed') h.capture.destroy();
  if (ending === 'expired') t = 40001;
  if (ending === 'evicted') for (let i = 0; i < 8; i++) { const next = h.capture.request(); h.frame(); callback(png()); await next; }
  oldEncode(png());
  assert.ok(h.capture.diagnostics().every(record => !record.lateEncodingCallback));
});

test('readback operation timestamps never regress when the diagnostic clock goes backwards', async () => {
  let t = 100;
  const h = fixture({ diagnostics: true, now: () => t });
  h.snapshot.getContext = () => ({ drawImage() { t = 120; }, getImageData() { t = 110; return { data: [0, 0, 0, 255] }; } });
  const p = h.capture.request(); h.frame(); h.encode(png()); await p;
  assert.deepEqual(h.capture.diagnostics()[0].readbackOperations.map(op => [op.startElapsedMs, op.endElapsedMs]), [[0, 20], [20, 20], [20, 20]]);
  assert.equal(h.capture.diagnostics()[0].events.at(-1).elapsedMs, 20);
});

test('a stale timeout callback cannot change successful terminal diagnostics', async () => {
  let t = 0;
  const h = fixture({ diagnostics: true, now: () => t });
  const p = h.capture.request(), staleTimer = [...h.timers][0];
  h.frame(); h.encode(png()); await p;
  const before = h.capture.diagnostics(); t = 20000; staleTimer();
  assert.deepEqual(h.capture.diagnostics(), before);
});

// A rectangular pixel-plane fake models real getImageData coordinates, rather
// than returning the same opaque pixel regardless of the requested rectangle.
function pixelPlane(h, alphaAt) {
  const reads = [], contexts = [];
  h.snapshot.getContext = (kind, options) => {
    contexts.push({ kind, options });
    return {
      drawImage(...args) { h.draws.push(args); },
      getImageData(x, y, width, height) {
        reads.push([x, y, width, height]);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++)
          data[(row * width + col) * 4 + 3] = alphaAt(x + col, y + row);
        return { data };
      }
    };
  };
  return { reads, contexts };
}

for (const [width, height] of [[1, 1], [1, 7], [9, 1], [1280, 720], [360, 800], [844, 390]])
  test(`positive original top-left alpha avoids full readback at ${width}x${height}`, async () => {
    const h = fixture({ width, height });
    const { reads, contexts } = pixelPlane(h, () => 1);
    const p = h.capture.request(); h.frame(); h.encode(png());
    const result = await p;
    assert.deepEqual(reads, [[0, 0, 1, 1]], 'one exact source pixel proves the any-alpha predicate');
    assert.deepEqual(contexts, [{ kind: '2d', options: { willReadFrequently: true } }]);
    assert.equal(result.width, width); assert.equal(result.height, height);
    assert.deepEqual(h.draws, [[h.canvas, 0, 0]], 'no scaling, compositing or source mutation');
  });

for (const alpha of [1, 127, 255]) for (let position = 0; position < 12; position++)
  test(`lone alpha ${alpha} at every 4x3 position ${position} remains valid`, async () => {
    const h = fixture({ width: 4, height: 3 });
    const { reads } = pixelPlane(h, (x, y) => y * 4 + x === position ? alpha : 0);
    const p = h.capture.request(); h.frame(); h.encode(png()); await p;
    assert.deepEqual(reads, position === 0 ? [[0, 0, 1, 1]] : [[0, 0, 1, 1], [0, 0, 4, 3]],
      'zero probe must never reject an unexamined visible pixel');
  });

test('all-zero alpha requires full verification and never reaches PNG encoding', async () => {
  const h = fixture({ width: 4, height: 3 });
  const { reads } = pixelPlane(h, () => 0);
  const p = h.capture.request(); h.frame();
  await assert.rejects(p, { code: 'unavailable' });
  assert.deepEqual(reads, [[0, 0, 1, 1], [0, 0, 4, 3]]);
  assert.equal(h.mime, undefined); assert.equal(h.capture.busy, false);
});

test('fallback readback exception fails closed and releases capture state', async () => {
  const h = fixture({ diagnostics: true }); let reads = 0;
  h.snapshot.getContext = () => ({ drawImage() {}, getImageData() {
    if (++reads === 2) throw Object.assign(new Error('private'), { name: 'SecurityError' });
    return { data: new Uint8ClampedArray(4) };
  } });
  const p = h.capture.request(); h.frame();
  await assert.rejects(p, { code: 'unavailable' });
  assert.equal(reads, 2); assert.equal(h.mime, undefined); assert.equal(h.timers.size, 0);
  const [record] = h.capture.diagnostics();
  assert.equal(record.exceptionKind, 'SecurityError');
  assert.equal(record.readbackOperations.at(-1).endElapsedMs, null);
  assert.deepEqual(record.readbackOperations.at(-1).rectangle, [0, 0, 640, 360]);
  assert.doesNotMatch(JSON.stringify(record), /private/);
});

test('diagnostics distinguish probe and full fallback read rectangles without pixel contents', async () => {
  const h = fixture({ width: 4, height: 3, diagnostics: true });
  pixelPlane(h, (x, y) => x === 3 && y === 2 ? 1 : 0);
  const p = h.capture.request(); h.frame(); h.encode(png()); await p;
  const operations = h.capture.diagnostics()[0].readbackOperations;
  assert.deepEqual(operations.filter(op => op.operation === 'getImageData').map(op => op.rectangle),
    [[0, 0, 1, 1], [0, 0, 4, 3]]);
  assert.equal(operations.filter(op => op.operation === 'alphaScan').length, 2);
});

test('fallback retains separately ordered read and scan timings and disabled diagnostics need no clock', async () => {
  for (const diagnostics of [false, true]) {
    let t = 0, reads = 0;
    const h = fixture({ diagnostics, now: () => { if (!diagnostics) throw Error('clock must stay unused'); return t; } });
    h.snapshot.getContext = () => ({ drawImage() { t += 2; }, getImageData() {
      t += ++reads === 1 ? 3 : 40;
      return { data: { length: 4, get 3() { t += 1; return reads === 2 ? 1 : 0; } } };
    } });
    const pending = h.capture.request(); h.frame(); h.encode(png()); await pending;
    if (diagnostics) assert.deepEqual(h.capture.diagnostics()[0].readbackOperations.map(op => [op.operation, op.durationMs]),
      [['drawImage', 2], ['getImageData', 3], ['alphaScan', 1], ['getImageData', 40], ['alphaScan', 1]]);
    else assert.deepEqual(h.capture.diagnostics(), []);
  }
});
