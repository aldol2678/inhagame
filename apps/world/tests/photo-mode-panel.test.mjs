import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPhotoModeEntry, createPhotoModePanel, PHOTO_ENTRY_BLOCK_MESSAGES } from '../src/photo/photo-mode-panel.js';
import { createPhotoMode } from '../src/photo/photo-mode.js';
import { createPhotoCameraController } from '../src/photo/photo-camera-controller.js';
import { createPhotoInput } from '../src/photo/photo-input.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createFakeCameraEntity } from './support/fake-camera.mjs';

function fixture({ capture = null, downloadFailure = false, downloadSupported = true, pose = 'started', coarsePointer = () => false,
  getAlbumLatest = null, onCaptured = null, onOpenAlbum = null } = {}) {
  const urls = [], revoked = [], downloads = [], timers = [];
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
  const win = { listeners: new Map(), addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener, dispatch: doc.dispatch };
  const opener = doc.createElement('button'), canvas = doc.createElement('canvas'); doc.body.append(opener, canvas); opener.focus();
  const camera = createFakeCameraEntity({ position: [3, 2.4, -6.3], target: [3, 1, -3] });
  const orbit = { yaw: 0, pitch: .3, distance: 3.5, firstPerson: false, camera };
  const focus = createInputFocusManager();
  const rig = createPhotoCameraController({ camera });
  const mode = createPhotoMode({ orbit, rig, inputFocus: focus,
    getPosition: () => ({ x: 3, y: 1.15, z: 3 }),
    getState: () => ({ world: true, region: 'campus', space: 'campus', grounded: true, accountId: 'guest' }),
    requestPose: () => pose });
  const input = createPhotoInput({ mode, rig, canvas, doc, win });
  const ui = createPhotoModePanel({ mode, rig, input, doc, win, fallbackFocus: canvas, capture, coarsePointer,
    getAlbumLatest, onCaptured, onOpenAlbum,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    urlApi: { createObjectURL(blob) { const url = `blob:photo-${urls.length}`; urls.push({ url, blob }); return url; }, revokeObjectURL(url) { revoked.push(url); } } });
  const nodes = () => { const walk = n => [n, ...n.children.flatMap(walk)]; return walk(ui.root); };
  const control = name => nodes().find(n => n.dataset.photoControl === name);
  const key = (code, extras = {}) => doc.dispatch('keydown', { target: doc.activeElement ?? canvas, stopPropagation() {}, ...extras, code });
  return { doc, win, opener, canvas, camera, orbit, focus, rig, mode, input, ui, nodes, control, key, urls, revoked, downloads, timers };
}

test('opening hides the HUD and focuses the shutter; every control sits on an edge region, the centre is empty', () => {
  const h = fixture({ capture: deferredCapture() }); h.doc.body.dataset.photoMode = 'previous';
  h.mode.open();
  assert.equal(h.ui.root.hidden, false); assert.equal(h.doc.body.dataset.photoMode, 'active');
  assert.equal(h.doc.activeElement, h.control('capture'), 'Space/Enter on the focused shutter captures');
  const regions = h.ui.root.children.map(n => n.className.split(' ')[0]);
  assert.deepEqual(regions, ['photo-mode-grid', 'photo-mode-flash', 'photo-mode-top', 'photo-mode-settings', 'photo-mode-preview', 'photo-mode-bottom', 'photo-mode-restore']);
  assert.equal(h.control('settings-panel').hidden, true, 'settings are collapsed by default');
  assert.equal(h.ui.root.getAttribute('aria-label'), '사진 모드');
  for (const name of ['close', 'settings', 'ui', 'capture', 'pose', 'up', 'down']) assert.ok(h.control(name).getAttribute('aria-label'), `${name} has an accessible name`);
  h.control('close').click(); assert.equal(h.ui.root.hidden, true);
  assert.equal(h.doc.body.dataset.photoMode, 'previous'); assert.equal(h.doc.activeElement, h.opener, 'focus returns to the opener');
});

test('legacy framing sliders and the centre dock are gone', () => {
  const h = fixture(); h.mode.open();
  for (const name of ['yaw', 'pitch', 'distance']) assert.equal(h.control(name), undefined, `${name} slider removed`);
  assert.equal(h.nodes().some(n => /photo-mode-dock|photo-mode-range/.test(n.className)), false);
  assert.equal(h.nodes().filter(n => n.type === 'range').length, 1, 'only the optional FOV slider, inside settings');
  assert.equal(h.control('fov').parent.parent, h.control('settings-panel'));
});

test('Escape closes the preview, then settings, then Photo Mode; Tab wraps both ways', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open();
  h.control('capture').click(); capture.resolve(); await flush();
  h.control('preview').click(); assert.equal(h.control('image').parent.hidden, false);
  h.key('Escape'); assert.equal(h.control('image').parent.hidden, true); assert.equal(h.mode.active, true);
  assert.equal(h.doc.activeElement, h.control('preview'));
  h.control('settings').click(); assert.equal(h.doc.activeElement, h.control('fov'));
  assert.equal(h.control('settings').getAttribute('aria-expanded'), 'true');
  h.key('Escape'); assert.equal(h.control('settings-panel').hidden, true); assert.equal(h.doc.activeElement, h.control('settings'));
  let prevented = 0;
  h.control('ui').focus(); h.key('Tab', { shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(h.doc.activeElement, h.control('preview'), 'Shift+Tab wraps to the last visible control');
  h.key('Tab', { preventDefault: () => prevented++ }); assert.equal(h.doc.activeElement, h.control('ui'));
  h.control('close').focus(); const before = prevented; h.key('Tab', { preventDefault: () => prevented++ });
  assert.equal(prevented, before, 'native middle traversal is allowed');
  h.key('Escape'); assert.equal(h.mode.active, false); assert.equal(h.doc.body.dataset.photoMode, undefined);
});

for (const reason of ['takeover', 'lifecycle']) test(`${reason} close never steals focus for another screen`, () => {
  const h = fixture(); h.mode.open(); const other = h.doc.createElement('button'); h.doc.body.append(other); other.focus();
  h.mode.close(reason); assert.equal(h.doc.activeElement, other); assert.equal(h.doc.body.dataset.photoMode, undefined);
});

test('a hidden opener returns focus to the focusable canvas', () => {
  const h = fixture(); h.canvas.setAttribute('tabindex', '-1');
  h.canvas.focus = () => { if (h.canvas.getAttribute('tabindex') !== null) h.doc.activeElement = h.canvas; };
  h.mode.open(); h.opener.hidden = true; h.mode.close();
  assert.equal(h.doc.activeElement, h.canvas);
});

test('hidden page and pagehide end the session, blur keeps the shot; destroy leaves no listeners', () => {
  const h = fixture();
  h.mode.open(); h.win.dispatch('blur'); assert.equal(h.mode.active, true, 'switching windows keeps the composition');
  h.win.dispatch('pagehide', { persisted: true }); assert.equal(h.mode.active, false); assert.equal(h.doc.body.dataset.photoMode, undefined);
  h.mode.open(); h.doc.hidden = true; h.doc.dispatch('visibilitychange'); assert.equal(h.mode.active, false);
  h.doc.hidden = false; h.mode.open(); h.ui.destroy(); h.input.destroy(); h.mode.destroy();
  assert.equal(h.mode.active, false); assert.equal(h.doc.body.dataset.photoMode, undefined);
  for (const type of ['keydown', 'keyup', 'visibilitychange']) assert.equal((h.doc.listeners.get(type) ?? []).length, 0, type);
  for (const type of ['pagehide', 'blur']) assert.equal((h.win.listeners.get(type) ?? []).length, 0, type);
  assert.equal(h.ui.root.parent, null);
});

test('UI hide (👁 / H) leaves one restore control; restoring brings focus back; the camera never changes', () => {
  const h = fixture(); h.mode.open(); const pose = h.camera.pose();
  h.control('ui').click();
  assert.equal(h.ui.root.dataset.ui, 'hidden'); assert.equal(h.control('restore').hidden, false);
  assert.equal(h.control('ui').getAttribute('aria-pressed'), 'true');
  assert.equal(h.doc.activeElement, h.control('restore'));
  h.key('Tab'); assert.equal(h.doc.activeElement, h.control('restore'), 'the only stop while hidden');
  h.control('restore').click();
  assert.equal(h.ui.root.dataset.ui, 'visible'); assert.equal(h.control('restore').hidden, true);
  assert.equal(h.doc.activeElement, h.control('ui'));
  h.canvas.focus(); h.key('KeyH'); assert.equal(h.ui.root.dataset.ui, 'hidden');
  assert.equal(h.doc.activeElement, h.canvas, 'H from the canvas keeps focus where it was');
  h.key('KeyH'); assert.equal(h.ui.root.dataset.ui, 'visible');
  h.control('settings').click(); h.key('KeyH'); assert.equal(h.control('settings-panel').hidden, true, 'hiding also closes settings');
  assert.deepEqual(h.camera.pose(), pose); assert.equal(h.mode.active, true);
  h.mode.close(); h.mode.open(); assert.equal(h.ui.root.dataset.ui, 'visible', 'each session starts with the UI shown');
});

test('settings: FOV drives the lens and follows wheel zoom; precision latch, collision, grid and reset', () => {
  const h = fixture(); h.mode.open(); h.control('settings').click();
  const fov = h.control('fov');
  assert.equal(fov.value, '62'); assert.equal(fov.min, '20'); assert.equal(fov.max, '80');
  assert.equal(h.control('fov-value').textContent, '62°');
  fov.value = '35'; fov.dispatch('input'); assert.equal(h.camera.camera.fov, 35); assert.equal(h.control('fov-value').textContent, '35°');
  h.canvas.dispatch('wheel', { deltaY: 200, deltaMode: 0, preventDefault() {} });
  assert.equal(fov.value, String(Math.round(h.camera.camera.fov)), 'wheel zoom is reflected while open');
  const precision = h.control('precision'); precision.checked = true; precision.dispatch('change');
  assert.equal(h.rig.snapshot().precision, true); assert.equal(h.control('precision-badge').hidden, false);
  precision.checked = false; precision.dispatch('change'); assert.equal(h.control('precision-badge').hidden, true);
  const collision = h.control('collision'); assert.equal(collision.checked, false, 'no collision authority in this fixture');
  const grid = h.control('grid'); grid.value = 'thirds'; grid.dispatch('change'); assert.equal(h.ui.root.dataset.grid, 'thirds');
  assert.equal(h.nodes().find(n => n.className === 'photo-mode-grid').getAttribute('aria-hidden'), 'true');
  grid.value = 'golden'; grid.dispatch('change'); assert.equal(h.ui.root.dataset.grid, 'off', 'unknown guides fall back to off');
  h.rig.look(200, 40); h.control('reset').click();
  assert.equal(h.rig.snapshot().yaw, h.rig.snapshot().entry.yaw); assert.equal(h.camera.camera.fov, 62); assert.equal(fov.value, '62');
  assert.match(h.control('status').textContent, /되돌렸어요/);
  h.mode.close(); h.mode.open();
  assert.equal(h.ui.root.dataset.grid, 'off'); assert.equal(h.control('settings-panel').hidden, true);
});

test('pose reports started, cooldown and seated outcomes', () => {
  for (const [result, pattern] of [['started', /포즈/], ['cooldown', /기다린/], ['seated', /앉아/]]) {
    const h = fixture({ pose: result }); h.mode.open(); h.control('pose').click();
    assert.match(h.control('status').textContent, pattern, result);
  }
});

function deferredCapture() {
  let resolve, reject, calls = 0, cancelled = 0, destroyed = 0;
  return { request() { calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    resolve() { resolve({ blob: new Blob(['image'], { type: 'image/png' }), width: 640, height: 360 }); },
    reject(error = new Error('capture failed')) { reject(error); }, cancel() { cancelled++; }, destroy() { destroyed++; },
    get calls() { return calls; }, get cancelled() { return cancelled; }, get destroyed() { return destroyed; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const timing of ['during capture', 'during album save', 'after album failure']) test(`late previous Album photo cannot replace a failed shot's original: ${timing}`, async () => {
  let resolveLatest, resolveSave;
  const opened = [], capture = deferredCapture();
  const h = fixture({ capture, downloadFailure: true,
    getAlbumLatest: () => new Promise(resolve => { resolveLatest = resolve; }),
    onCaptured: () => new Promise(resolve => { resolveSave = resolve; }),
    onOpenAlbum: record => opened.push(record.id) });
  h.mode.open(); h.control('capture').click();
  const previous = { record: { id: 'previous-photo' }, blob: new Blob(['previous-thumbnail']) };
  if (timing === 'during capture') { resolveLatest(previous); await flush(); }
  capture.resolve(); await flush();
  if (timing === 'during album save') { resolveLatest(previous); await flush(); }
  resolveSave(null); await flush();
  if (timing === 'after album failure') { resolveLatest(previous); await flush(); }
  assert.equal(h.downloads.length, 0);
  assert.match(h.ui.status().status, /앨범.*실패/);
  assert.equal(h.ui.status().busy, false);
  assert.equal(h.control('preview').children[0].src, h.control('image').src, 'thumbnail still points at this shot');
  h.control('preview').click();
  assert.deepEqual(opened, [], 'failed shot never opens a different saved photo');
  assert.equal(h.control('image').parent.hidden, false, 'original PNG remains available for manual save');
  assert.equal(h.urls.find(x => x.url === h.control('image').src).blob.type, 'image/png');
  h.key('Escape'); h.key('Escape'); assert.equal(h.mode.active, false);
  h.ui.destroy(); h.input.destroy(); h.mode.destroy();
  assert.deepEqual(h.revoked, h.urls.map(x => x.url));
});

test('successful Album readback still opens the saved shot and ignores the entry lookup', async () => {
  const queries = [], opened = [], capture = deferredCapture(), saved = { id: 'saved-shot' };
  const h = fixture({ capture, getAlbumLatest: () => new Promise(resolve => queries.push(resolve)),
    onCaptured: async () => saved, onOpenAlbum: record => opened.push(record.id) });
  h.mode.open(); h.control('capture').click(); capture.resolve(); await flush();
  queries[1]({ record: saved, blob: new Blob(['new-thumbnail'], { type: 'image/jpeg' }) }); await flush();
  const currentThumbnail = h.control('preview').children[0].src;
  queries[0]({ record: { id: 'previous-photo' }, blob: new Blob(['old-thumbnail']) }); await flush();
  assert.equal(h.control('preview').children[0].src, currentThumbnail);
  h.control('preview').click(); assert.deepEqual(opened, ['saved-shot']);
  h.ui.destroy(); h.input.destroy(); h.mode.destroy();
  assert.deepEqual(new Set(h.revoked), new Set(h.urls.map(x => x.url)));
});

test('capture is busy once, keeps shutter focus, downloads a local PNG and shows a last-shot preview', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open();
  const shutter = h.control('capture');
  shutter.click(); shutter.click(); h.key('Space', { target: h.canvas }); assert.equal(capture.calls, 1);
  assert.equal(shutter.getAttribute('aria-disabled'), 'true'); assert.equal(shutter.disabled, false, 'focus is never dropped');
  assert.equal(h.control('pose').disabled, true); assert.equal(h.ui.root.getAttribute('aria-busy'), 'true');
  capture.resolve(); await flush();
  assert.equal(h.downloads.length, 1); assert.match(h.downloads[0].filename, /^inha-world-.*\.png$/);
  assert.equal(h.downloads[0].href, h.urls[0].url); assert.equal(shutter.getAttribute('aria-disabled'), 'false');
  assert.match(h.control('status').textContent, /다운로드.*요청/);
  assert.doesNotMatch(h.control('status').textContent, /저장했|저장 완료/);
  assert.equal(h.control('preview').hidden, false); assert.equal(h.control('preview').children[0].src, h.urls[0].url);
  assert.ok(h.nodes().find(n => n.className === 'photo-mode-flash').classList.contains('is-on'));
  h.control('preview').click(); assert.equal(h.control('image').parent.hidden, false);
  assert.equal(h.control('image').src, h.urls[0].url); assert.match(h.control('status').textContent, /길게 눌러/);
  h.control('preview').click(); assert.equal(h.control('image').parent.hidden, true);
  h.key('Space', { target: h.canvas }); assert.equal(capture.calls, 2, 'Space from the canvas also shoots');
  h.mode.close(); assert.deepEqual(h.revoked, [h.urls[0].url]);
});

for (const reason of ['close', 'escape', 'lifecycle', 'takeover']) test(`late capture cannot download after ${reason} or repopulate a new photo session`, async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('capture').click();
  if (reason === 'takeover') { const token = h.focus.claim('room-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK); h.focus.release(token); }
  else h.mode.close(reason);
  h.mode.open(); capture.resolve(); await flush();
  assert.equal(h.downloads.length, 0); assert.equal(h.urls.length, 0); assert.equal(h.control('preview').hidden, true);
  assert.equal(h.control('capture').getAttribute('aria-disabled'), 'false'); assert.ok(capture.cancelled > 0);
});

test('failed encoding is visible and retry is possible; no artifact or URL is retained', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('capture').click();
  capture.reject(); await flush(); assert.match(h.control('status').textContent, /만들지 못했/);
  assert.match(h.control('status').textContent, /화면 캡처/); assert.equal(h.urls.length, 0);
  h.control('capture').click(); assert.equal(capture.calls, 2); capture.resolve(); await flush();
  assert.equal(h.downloads.length, 1);
});

for (const options of [{ downloadFailure: true }, { downloadSupported: false }]) test(`download fallback retains only the latest image: ${JSON.stringify(options)}`, async () => {
  const capture = deferredCapture(), h = fixture({ capture, ...options }); h.mode.open();
  h.control('capture').click(); capture.resolve(); await flush();
  assert.match(h.control('status').textContent, /다운로드.*(막혔|지원하지)/); assert.equal(h.control('preview').hidden, false);
  h.control('capture').click(); assert.deepEqual(h.revoked, [h.urls[0].url]); capture.resolve(); await flush();
  assert.equal(h.urls.length, 2); h.ui.destroy();
  assert.deepEqual(h.revoked, h.urls.map(x => x.url)); assert.equal(capture.destroyed, 1);
});

test('without capture support the shutter is disabled and the exit gets initial focus', () => {
  const h = fixture(); h.mode.open();
  assert.equal(h.control('capture').disabled, true); assert.equal(h.doc.activeElement, h.control('close'));
  assert.match(h.control('status').textContent, /화면 캡처/);
});

test('the opening hint matches the pointer: Space only for keyboard users', () => {
  const desktop = fixture({ capture: deferredCapture() }); desktop.mode.open();
  assert.match(desktop.control('status').textContent, /Space/);
  const touch = fixture({ capture: deferredCapture(), coarsePointer: () => true }); touch.mode.open();
  assert.match(touch.control('status').textContent, /촬영 버튼을 누르면/); assert.doesNotMatch(touch.control('status').textContent, /Space/);
});

test('transient status messages clear themselves; progress and fallbacks stay until replaced', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open();
  assert.equal(h.timers.at(-1).ms, 5000);
  h.timers.at(-1).fn(); assert.equal(h.control('status').textContent, '');
  const count = h.timers.length; h.control('capture').click();
  assert.equal(h.timers.length, count, 'progress is sticky'); capture.reject(); await flush();
  assert.equal(h.timers.length, count, 'failure guidance is sticky');
});

test('HUD entry stays focusable, explains why it is blocked, and opens when allowed', () => {
  const doc = createFakeDocument(), button = doc.createElement('button');
  let reason = 'mounted', opened = 0, active = false;
  const mode = { blockedReason: () => active ? 'active' : reason, get active() { return active; }, open() { opened++; active = true; return true; } };
  const entry = bindPhotoModeEntry({ button, mode });
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.getAttribute('aria-label'), `사진 모드 · ${PHOTO_ENTRY_BLOCK_MESSAGES.mounted}`);
  reason = null; entry.refresh();
  assert.equal(button.getAttribute('aria-disabled'), 'false'); assert.equal(button.title, '사진 모드 열기 (P)');
  button.click(); assert.equal(opened, 1); assert.equal(button.getAttribute('aria-disabled'), 'false', 'active is not a blocked state');
  for (const code of Object.keys(PHOTO_ENTRY_BLOCK_MESSAGES)) assert.ok(PHOTO_ENTRY_BLOCK_MESSAGES[code].length > 0);
});

test('capture failure diagnostics survive the UI message and clear on retry and a new session', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('capture').click();
  const details = { code: 'timeout', phase: 'encoding', reason: null, elapsedMs: 10002 };
  capture.reject(Object.assign(new Error('raw text must not escape'), details)); await flush();
  assert.deepEqual(h.ui.status().captureFailure, details);
  assert.ok(Object.isFrozen(h.ui.status().captureFailure));
  h.control('capture').click(); assert.equal(h.ui.status().captureFailure, null);
  capture.reject(Object.assign(new Error('failed'), details)); await flush();
  h.mode.close(); h.mode.open(); assert.equal(h.ui.status().captureFailure, null);
});

test('unknown failure fields and non-finite durations do not leak into status diagnostics', async () => {
  const capture = deferredCapture(), h = fixture({ capture }); h.mode.open(); h.control('capture').click();
  capture.reject(Object.assign(new Error('raw browser message'), {
    code: 'private code', phase: 'private phase', reason: 'private reason', elapsedMs: NaN
  })); await flush();
  assert.deepEqual(h.ui.status().captureFailure, { code: 'unknown', phase: null, reason: null, elapsedMs: null });
});
