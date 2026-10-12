import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createWorldGraphicsDevice } from '../src/webgpu-device.js';
import { createWorldLoading } from '../src/lobby/lobby-loading.js';
const source = readFileSync(new URL('../src/lobby/boot-recovery.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map(), timers = new Map();
  const element = () => ({ dataset: {}, style: {}, hidden: false, textContent: '', disabled: false,
    setAttribute() {}, classList: { add() {} }, addEventListener(type, fn) { this[type] = fn; },
    removeEventListener(type) { this[type] = () => {}; } });
  const elements = Object.fromEntries(['world-loading', 'world-loading-message', 'world-loading-detail',
    'world-loading-retry', 'world-lobby'].map(id => [id, element()]));
  let sequence = 0, reloads = 0;
  const doc = { hidden: false, getElementById: id => elements[id],
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  const win = { AbortController, document: doc, location: { reload() { reloads++; } },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  vm.runInNewContext(source, win);
  const recovery = win.__INHA_WORLD_BOOT_RECOVERY__;
  const tick = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
  const attach = () => {
    const loading = createWorldLoading({ root: elements['world-loading'], messageElement: elements['world-loading-message'],
      detailElement: elements['world-loading-detail'], interactionRoot: elements['world-lobby'], recovery,
      timers: { setTimeout: win.setTimeout, clearTimeout: win.clearTimeout } });
    recovery.attach(loading);
    return loading;
  };
  return { recovery, elements, listeners, timers, doc, win, tick, attach, reloads: () => reloads };
}
test('independent watchdog detects entry delay without modules and only retries on click', () => {
  const f = fixture(); f.tick();
  assert.equal(f.recovery.status().code, 'BOOT_ENTRY_DELAY');
  assert.equal(f.recovery.status().state, 'DELAYED');
  assert.equal(f.elements['world-loading-retry'].hidden, false);
  assert.equal(f.reloads(), 0);
  f.elements['world-loading-retry'].click(); f.elements['world-loading-retry'].click();
  assert.equal(f.reloads(), 1);
});
test('module resource failure remains sticky through late loader attachment and phases', () => {
  const f = fixture();
  f.listeners.get('error')({ target: { matches: () => true } });
  const loading = f.attach(); f.recovery.markBootEntered();
  assert.equal(loading.setPhase('ASSETS'), false);
  loading.setEssentialReady(); loading.setRenderReady();
  assert.equal(loading.finish(), false);
  assert.equal(f.recovery.status().code, 'BOOT_MODULE_ERROR');
  f.tick();
  assert.equal(f.elements['world-loading'].dataset.state, 'ERROR');
});
test('unrelated resource failures are ignored; syntax and promise failures are diagnosed', () => {
  const f = fixture();
  f.listeners.get('error')({ target: { matches: () => false } });
  assert.equal(f.recovery.status().state, 'LOADING');
  f.listeners.get('error')({ message: 'SyntaxError' });
  assert.equal(f.recovery.status().code, 'BOOT_SCRIPT_ERROR');
  const g = fixture(); g.listeners.get('unhandledrejection')({});
  assert.equal(g.recovery.status().code, 'BOOT_PROMISE_REJECTION');
});
test('slow assets and render waits recover naturally and cannot force READY', () => {
  const f = fixture(), loading = f.attach(); f.recovery.markBootEntered();
  loading.setPhase('ASSETS'); f.tick();
  assert.equal(f.recovery.status().code, 'ASSET_LOADING_DELAY');
  assert.equal(loading.status().failed, false);
  assert.equal(loading.setPhase('READY'), false);
  assert.equal(loading.finish(), false);
  loading.setEssentialReady(); loading.setPhase('RENDERING'); f.tick();
  assert.equal(f.recovery.status().code, 'INITIAL_RENDER_DELAY');
  assert.equal(loading.finish(), false);
  loading.setRenderReady(); assert.equal(loading.finish(), true);
  assert.equal(f.recovery.status().state, 'READY');
  assert.equal(f.listeners.size, 0);
  assert.equal(f.elements['world-lobby'].inert, false);
});
test('progress and background suspension restart the warning window without failure', () => {
  const f = fixture(), loading = f.attach(); f.recovery.markBootEntered();
  loading.setPhase('RENDERER'); f.tick();
  assert.equal(f.recovery.status().code, 'GRAPHICS_INIT_DELAY');
  loading.setPhase('WORLD');
  assert.equal(f.recovery.status().state, 'LOADING');
  f.doc.hidden = true; f.listeners.get('visibilitychange')();
  assert.equal(f.timers.size, 0);
  f.doc.hidden = false; f.listeners.get('visibilitychange')();
  assert.equal(f.recovery.status().state, 'LOADING');
});
for (const code of ['ASSET_LOAD_FAILED', 'GRAPHICS_INIT_FAILED', 'INITIAL_RENDER_FAILED', 'BOOT_INIT_FAILED', 'ASSET_LOADING_TIMEOUT', 'INITIAL_RENDER_TIMEOUT', 'GRAPHICS_INIT_TIMEOUT']) {
  test(`${code} keeps interaction blocked and a manual retry available`, () => {
    const f = fixture(), loading = f.attach(); f.recovery.markBootEntered();
    f.recovery.fail(code);
    assert.equal(loading.finish(), false);
    assert.equal(f.elements['world-lobby'].inert, true);
    assert.equal(f.elements['world-loading-retry'].hidden, false);
    assert.match(f.elements['world-loading-detail'].textContent, new RegExp(code));
    assert.equal(f.reloads(), 0);
  });
}

test('graphics initialization preserves its default 10s protection with a distinct timeout code', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = createWorldGraphicsDevice({ createGraphicsDevice: () => new Promise(() => {}) }, {});
  const rejected = assert.rejects(pending, error => error.code === 'GRAPHICS_INIT_TIMEOUT');
  t.mock.timers.tick(10000);
  await rejected;
});

test('retry cancels the old document gate and late readiness cannot reveal the lobby', () => {
  const f = fixture(), loading = f.attach(); f.recovery.markBootEntered();
  loading.setPhase('ASSETS'); f.tick();
  f.elements['world-loading-retry'].click();
  assert.equal(f.recovery.signal.aborted, true);
  assert.equal(loading.status().cancelled, true);
  assert.equal(loading.setEssentialReady(), false);
  assert.equal(loading.setRenderReady(), false);
  assert.equal(loading.finish(), false);
  f.recovery.progress('RENDERING'); f.recovery.fail('BOOT_INIT_FAILED'); f.tick();
  assert.equal(f.recovery.status().retrying, true);
  assert.equal(f.recovery.status().code, 'ASSET_LOADING_DELAY');
  assert.equal(f.elements['world-lobby'].inert, true);
  assert.equal(f.reloads(), 1);
});

test('classic installation is reentrant and destroy cancels timers, listeners and retry', () => {
  const f = fixture(), loading = f.attach();
  const original = f.recovery;
  vm.runInNewContext(source, f.win);
  assert.equal(f.win.__INHA_WORLD_BOOT_RECOVERY__, original);
  f.tick(); f.recovery.destroy(); f.recovery.destroy();
  f.elements['world-loading-retry'].click(); f.tick();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.reloads(), 0);
  assert.equal(loading.finish(), false);
  assert.equal(f.recovery.signal.aborted, true);
});

test('progress removes retry focus from the hidden button; READY transfers only loader-owned focus', () => {
  const f = fixture(), loading = f.attach();
  const root = f.elements['world-loading'], lobby = f.elements['world-lobby'];
  root.ownerDocument = f.doc;
  root.focus = () => { f.doc.activeElement = root; };
  root.contains = element => element === root || element === f.elements['world-loading-retry'];
  lobby.focus = () => { f.doc.activeElement = lobby; };
  f.tick(); f.doc.activeElement = f.elements['world-loading-retry'];
  loading.setPhase('ASSETS');
  assert.equal(f.doc.activeElement, root);
  loading.setEssentialReady(); loading.setRenderReady(); loading.finish();
  assert.equal(f.doc.activeElement, lobby);
});


test('late loader attachment after retry is cancelled and cannot consume stale readiness', () => {
  const f = fixture(); f.tick(); f.elements['world-loading-retry'].click();
  const loading = f.attach();
  assert.equal(loading.status().cancelled, true);
  assert.equal(loading.finish(), false);
  assert.equal(f.elements['world-lobby'].inert, true);
});

test('once READY, unrelated errors and stale idle timers do not reopen the loader', () => {
  const f = fixture(), loading = f.attach();
  const staleTimers = [...f.timers.values()];
  loading.setEssentialReady(); loading.setRenderReady(); loading.finish();
  for (const callback of staleTimers) callback();
  f.recovery.fail('BOOT_INIT_FAILED'); f.recovery.progress('ASSETS');
  assert.equal(f.recovery.status().state, 'READY');
  assert.equal(f.elements['world-loading-retry'].hidden, true);
  assert.equal(f.elements['world-lobby'].inert, false);
});
