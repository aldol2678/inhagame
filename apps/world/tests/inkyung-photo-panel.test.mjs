import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoModePanel } from '../src/photo/photo-mode-panel.js';
import { createPhotoMode } from '../src/photo/photo-mode.js';
import { createInputFocusManager } from '../src/input/input-focus-manager.js';
import { INKYUNG_PHOTO_POINT } from '../src/photo/inkyung-photo-point.js';
import { createFakeDocument } from './support/fake-dom.mjs';

function fixture({ capture = null, downloadFailure = false, downloadSupported = true } = {}) {
  const urls = [], revoked = [], downloads = [];
  const doc = createFakeDocument(); doc.body = doc.createElement('body');
  const create = doc.createElement;
  doc.createElement = tag => {
    const el = create(tag);
    if (tag === 'a') {
      if (downloadSupported) el.download = '';
      el.click = () => { if (downloadFailure) throw new Error('download blocked'); downloads.push({ href: el.href, filename: el.download }); };
    }
    el.removeAttribute = name => delete el.attributes[name];
    el.removeEventListener = (type, fn) => el.listeners.set(type, (el.listeners.get(type) ?? []).filter(f => f !== fn));
    el.remove = () => { el.parent.children = el.parent.children.filter(x => x !== el); el.parent = null; };
    Object.defineProperty(el, 'isConnected', { get: () => doc.body.contains(el) });
    return el;
  };
  doc.removeEventListener = (type, fn) => doc.listeners.set(type, (doc.listeners.get(type) ?? []).filter(f => f !== fn));
  const win = { listeners: new Map(), addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener,
    dispatch: doc.dispatch };
  const opener = doc.createElement('button'), canvas = doc.createElement('canvas'); doc.body.append(opener, canvas); opener.focus();
  const orbit = { yaw: 0, pitch: .3, distance: 3.5, firstPerson: false, camera: { camera: { nearClip: .3 } } };
  const mode = createPhotoMode({ orbit, inputFocus: createInputFocusManager(),
    getPosition: () => ({ ...INKYUNG_PHOTO_POINT.position, y: 1.1 }), getState: () => ({ campus: true, grounded: true }),
    requestPose: () => 'started' });
  const ui = createPhotoModePanel({ mode, doc, win, fallbackFocus: canvas, capture,
    urlApi: { createObjectURL(blob) { const url = `blob:photo-${urls.length}`; urls.push({ url, blob }); return url; }, revokeObjectURL(url) { revoked.push(url); } } });
  const nodes = () => { const walk = n => [n, ...n.children.flatMap(walk)]; return walk(ui.root); };
  const control = name => nodes().find(n => n.dataset.photoControl === name);
  return { doc, win, opener, canvas, orbit, mode, ui, control, urls, revoked, downloads };
}

test('photo UI hides HUD with a temporary presentation flag and restores focus on explicit close', () => {
  const h = fixture(); h.doc.body.dataset.photoMode = 'previous';
  h.mode.open(); assert.equal(h.ui.root.hidden, false); assert.equal(h.doc.body.dataset.photoMode, 'active');
  assert.equal(h.doc.activeElement, h.control('close'));
  h.control('distance').value = '5'; h.control('distance').dispatch('input'); assert.equal(h.orbit.distance, 5);
  h.control('pose').click(); assert.match(h.control('status').textContent, /포즈/);
  h.control('close').click(); assert.equal(h.ui.root.hidden, true);
  assert.equal(h.doc.body.dataset.photoMode, 'previous'); assert.equal(h.doc.activeElement, h.opener);
});

test('Escape consumes its key and restores UI/camera; Tab wraps both ways without trapping each key at close', () => {
  const h = fixture(); h.mode.open();
  let prevented = 0, stopped = 0;
  const key = (code, extras = {}) => h.doc.dispatch('keydown', { code, preventDefault: () => prevented++, stopPropagation: () => stopped++, ...extras });
  key('Tab', { shiftKey: true }); assert.equal(h.doc.activeElement, h.control('pose'));
  key('Tab'); assert.equal(h.doc.activeElement, h.control('close'));
  h.control('yaw').focus(); const before = prevented; key('Tab'); assert.equal(prevented, before, 'native middle traversal is allowed');
  key('Escape'); assert.equal(h.mode.active, false); assert.equal(h.doc.body.dataset.photoMode, undefined); assert.ok(stopped > 0);
});

for (const reason of ['takeover', 'lifecycle']) test(`${reason} close never steals focus for another screen`, () => {
  const h = fixture(); h.mode.open(); const other = h.doc.createElement('button'); h.doc.body.append(other); other.focus();
  h.mode.close(reason); assert.equal(h.doc.activeElement, other); assert.equal(h.doc.body.dataset.photoMode, undefined);
});

test('blur, hidden page and BFCache pagehide close safely; repeated open and destroy leave no listeners', () => {
  const h = fixture();
  for (const event of ['blur', 'pagehide']) {
    h.mode.open(); h.win.dispatch(event, { persisted: true }); assert.equal(h.mode.active, false); assert.equal(h.doc.body.dataset.photoMode, undefined);
  }
  h.mode.open(); h.doc.hidden = true; h.doc.dispatch('visibilitychange'); assert.equal(h.mode.active, false);
  h.doc.hidden = false; h.mode.open(); h.ui.destroy(); h.mode.destroy();
  assert.equal(h.mode.active, false); assert.equal(h.doc.body.dataset.photoMode, undefined);
  assert.equal((h.doc.listeners.get('keydown') ?? []).length, 0);
  assert.equal((h.win.listeners.get('pagehide') ?? []).length, 0);
});

test('hidden context opener returns focus to a genuinely focusable canvas', () => {
  const h = fixture(); h.canvas.setAttribute('tabindex', '-1');
  h.canvas.focus = () => { if (h.canvas.getAttribute('tabindex') !== null) h.doc.activeElement = h.canvas; };
  h.mode.open(); h.opener.hidden = true; h.mode.close();
  assert.equal(h.doc.activeElement, h.canvas);
});

test('hide/show framing controls clears the view while exit, photo state and focus remain usable', () => {
  const h = fixture(); h.mode.open();
  const toggle = h.control('controls'); assert.ok(toggle, 'temporary framing controls toggle exists');
  const before = { ...h.orbit, camera: h.orbit.camera };
  h.control('yaw').focus(); toggle.click();
  assert.equal(h.control('yaw').parent.parent.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(h.doc.activeElement, toggle); assert.equal(h.mode.active, true);
  assert.equal(h.control('close').hidden, false); assert.equal(h.doc.body.dataset.photoMode, 'active');
  assert.deepEqual(h.orbit, before);
  h.doc.dispatch('keydown', { code: 'Tab' }); assert.equal(h.doc.activeElement, h.control('close'));
  h.doc.dispatch('keydown', { code: 'Tab', shiftKey: true }); assert.equal(h.doc.activeElement, toggle);
  toggle.click(); assert.equal(h.control('yaw').parent.parent.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(h.doc.activeElement, toggle); assert.deepEqual(h.orbit, before);
  h.control('close').click(); assert.equal(h.mode.active, false);
});

test('a new photo session resets the temporary controls to visible', () => {
  const h = fixture(); h.mode.open();
  const toggle = h.control('controls'); assert.ok(toggle);
  toggle.click(); h.mode.close(); h.mode.open();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(h.control('yaw').parent.parent.hidden, false);
  assert.equal(h.doc.activeElement, h.control('close'));
});

function deferredCapture() {
  let resolve, reject, calls = 0, cancelled = 0, destroyed = 0;
  return { request() { calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    resolve() { resolve({ blob: new Blob(['image'], { type: 'image/png' }), width: 640, height: 360 }); },
    reject() { reject(new Error('capture failed')); }, cancel() { cancelled++; }, destroy() { destroyed++; },
    get calls() { return calls; }, get cancelled() { return cancelled; }, get destroyed() { return destroyed; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('save is busy once, downloads a local PNG and exposes explicit mobile preview without claiming saved', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open();
  h.control('save').click(); h.control('save').click(); assert.equal(capture.calls, 1);
  assert.equal(h.control('save').disabled, true); assert.equal(h.control('distance').disabled, true);
  assert.equal(h.ui.root.getAttribute('aria-busy'), 'true');
  capture.resolve(); await flush();
  assert.equal(h.downloads.length, 1); assert.match(h.downloads[0].filename, /^inha-world-.*\.png$/);
  assert.equal(h.downloads[0].href, h.urls[0].url); assert.equal(h.control('save').disabled, false);
  assert.match(h.control('status').textContent, /다운로드.*요청/);
  assert.doesNotMatch(h.control('status').textContent, /저장했|저장 완료/);
  assert.equal(h.control('preview').hidden, false); assert.equal(h.control('image').parent.hidden, true);
  h.control('preview').click(); assert.equal(h.control('image').parent.hidden, false);
  assert.equal(h.control('image').src, h.urls[0].url); assert.match(h.control('status').textContent, /길게 눌러/);
  h.control('preview').click(); assert.equal(h.control('image').parent.hidden, true);
  h.mode.close(); assert.deepEqual(h.revoked, [h.urls[0].url]);
});

for (const reason of ['close', 'escape', 'lifecycle', 'takeover']) test(`late capture cannot download after ${reason} or repopulate a new photo session`, async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('save').click();
  h.mode.close(reason); h.mode.open(); capture.resolve(); await flush();
  assert.equal(h.downloads.length, 0); assert.equal(h.urls.length, 0); assert.equal(h.control('preview').hidden, true);
  assert.equal(h.control('save').disabled, false); assert.ok(capture.cancelled > 0);
});

test('failed encoding is visible and retry is possible; no artifact or URL is retained', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('save').click();
  capture.reject(); await flush(); assert.match(h.control('status').textContent, /만들지 못했/);
  assert.match(h.control('status').textContent, /화면 캡처/); assert.equal(h.urls.length, 0);
  h.control('save').click(); assert.equal(capture.calls, 2); capture.resolve(); await flush();
  assert.equal(h.downloads.length, 1);
});

for (const options of [{ downloadFailure: true }, { downloadSupported: false }]) test(`download fallback retains only the latest image: ${JSON.stringify(options)}`, async () => {
  const capture = deferredCapture(), h = fixture({ capture, ...options }); h.mode.open();
  h.control('save').click(); capture.resolve(); await flush();
  assert.match(h.control('status').textContent, /다운로드.*(막혔|지원하지)/); assert.equal(h.control('preview').hidden, false);
  h.control('save').click(); assert.deepEqual(h.revoked, [h.urls[0].url]); capture.resolve(); await flush();
  assert.equal(h.urls.length, 2); h.ui.destroy();
  assert.deepEqual(h.revoked, h.urls.map(x => x.url)); assert.equal(capture.destroyed, 1);
});

test('Tab skips disabled save/framing controls while close remains usable', () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('save').click();
  h.control('controls').focus(); h.doc.dispatch('keydown', { code: 'Tab' });
  assert.equal(h.doc.activeElement, h.control('close')); h.mode.close();
});
