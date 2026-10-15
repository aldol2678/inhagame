import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createRoomLoadingOverlay } from '../src/rooms/room-loading-overlay.js';

function rig() {
  const doc = createFakeDocument();
  doc.removeEventListener = (name, fn) => doc.listeners.set(name, (doc.listeners.get(name) ?? []).filter(f => f !== fn));
  const create = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const node = create(tag);
    node.remove = () => { if (node.parent) node.parent.children = node.parent.children.filter(n => n !== node); node.parent = null; };
    Object.defineProperty(node, 'isConnected', { get: () => Boolean(node.parent) });
    return node;
  };
  doc.body = doc.createElement('body');
  const opener = doc.createElement('button');
  const priorInert = doc.createElement('aside');
  priorInert.inert = true;
  doc.body.append(opener, priorInert);
  opener.focus();
  const ui = createRoomLoadingOverlay({ document: doc });
  const overlay = doc.body.children.at(-1);
  const panel = overlay.children[0];
  const [door, title, stage, hint, cancel] = panel.children;
  const key = (value, extra = {}) => {
    const event = { key: value, target: doc.activeElement, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    // FakeDocument clones events, so observe calls through closures.
    event.preventDefault = () => { event.prevented = true; };
    event.stopPropagation = () => { event.stopped = true; };
    doc.dispatch('keydown', event);
    return event;
  };
  return { doc, opener, priorInert, ui, overlay, panel, door, title, stage, hint, cancel, key };
}

test('overlay starts hidden and becomes an accessible modal with a real stage', () => {
  const h = rig();
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.ui.stage('ignored'), false);
  assert.equal(h.ui.show({ onCancel() {} }), true);
  assert.equal(h.ui.isVisible(), true);
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.panel.getAttribute('role'), 'dialog');
  assert.equal(h.panel.getAttribute('aria-modal'), 'true');
  assert.equal(h.panel.getAttribute('aria-labelledby'), h.title.id);
  assert.equal(h.panel.getAttribute('aria-describedby'), h.stage.id);
  assert.equal(h.stage.getAttribute('aria-live'), 'polite');
  assert.equal(h.door.getAttribute('aria-hidden'), 'true');
  assert.equal(h.stage.textContent, '방 준비 중');
  assert.equal(h.doc.activeElement, h.cancel);
  assert.equal(h.opener.inert, true);
  assert.equal(h.ui.stage('가구 준비 중'), true);
  assert.equal(h.stage.textContent, '가구 준비 중');
  assert.equal(h.ui.stage(''), false);
  assert.equal(h.ui.stage(null), false);
});

test('repeated show and hide preserve original focus and original inert states', () => {
  const h = rig();
  h.ui.show({ onCancel() {} });
  assert.equal(h.ui.show({ onCancel() {} }), false);
  h.ui.hide(); h.ui.hide();
  assert.equal(h.doc.activeElement, h.opener);
  assert.equal(h.opener.inert, false);
  assert.equal(h.priorInert.inert, true);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.ui.isVisible(), false);
  assert.equal([...h.doc.listeners.values()].flat().length, 0);
});

test('Tab in both directions stays inside and escaped focus is returned', () => {
  const h = rig(); h.ui.show({ onCancel() {} });
  for (const shiftKey of [false, true]) {
    h.opener.focus();
    const event = h.key('Tab', { shiftKey });
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(h.doc.activeElement, h.cancel);
  }
  h.opener.focus();
  h.doc.dispatch('focusin', { target: h.opener });
  assert.equal(h.doc.activeElement, h.cancel);
  assert.equal(h.key('w').stopped, true);
  assert.equal(h.overlay.dispatch('pointerdown').stopped, true);
});

test('Escape and click request cancellation once and wait for caller recovery', () => {
  for (const first of ['escape', 'click']) {
    const h = rig(); let calls = 0;
    h.ui.show({ onCancel() { calls++; } });
    if (first === 'escape') assert.equal(h.key('Escape').prevented, true);
    else h.cancel.click();
    h.cancel.click(); h.key('Escape');
    assert.equal(calls, 1);
    assert.equal(h.cancel.disabled, true);
    assert.equal(h.ui.isVisible(), true);
    assert.equal(h.stage.textContent, '이전 화면으로 돌아가는 중');
    assert.equal(h.ui.stage('방 표시 중'), false);
    h.key('Tab');
    assert.equal(h.doc.activeElement, h.panel);
    h.ui.hide();
    assert.equal(h.doc.activeElement, h.opener);
  }
});

test('synchronous cancellation callback can hide; new attempts reset cancellation', () => {
  const h = rig(); let calls = 0;
  const onCancel = () => { calls++; h.ui.hide(); };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(h.ui.show({ onCancel }), true);
    assert.equal(h.cancel.disabled, false);
    assert.equal(h.stage.textContent, '방 준비 중');
    h.key('Escape');
    assert.equal(h.ui.isVisible(), false);
  }
  assert.equal(calls, 2);
});

test('success may skip focus restoration; disconnected opener is not focused', () => {
  const h = rig(); h.ui.show({ onCancel() {} });
  h.ui.hide({ restoreFocus: false });
  assert.notEqual(h.doc.activeElement, h.opener);
  h.opener.focus();
  h.ui.show({ onCancel() {} });
  h.opener.remove();
  h.ui.hide();
  assert.notEqual(h.doc.activeElement, h.opener);
});

test('no callback still traps focus; destroy removes DOM and listeners', () => {
  const h = rig(); h.ui.show();
  assert.equal(h.cancel.disabled, true);
  assert.equal(h.doc.activeElement, h.panel);
  h.key('Escape');
  assert.equal(h.ui.isVisible(), true);
  h.ui.destroy(); h.ui.destroy();
  assert.equal(h.doc.body.children.includes(h.overlay), false);
  assert.equal([...h.doc.listeners.values()].flat().length, 0);
  assert.equal(h.ui.show(), false);
});

test('CSS provides reduced motion, hidden state and touch-size cancellation without timed gating', () => {
  const css = readFileSync(new URL('../src/rooms/room-loading-overlay.css', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/rooms/room-loading-overlay.js', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame|progressbar/);
});
