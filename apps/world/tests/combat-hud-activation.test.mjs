import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCombatHudV03 } from '../src/combat/combat-hud-v03.js';
import { createCombatRuntimeV03 } from '../src/combat/combat-runtime-v03.js';
import { createBuilding5CombatTraining, BUILDING5_TRAINING_TARGET } from '../src/combat/building5-combat-training.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createChatPanel } from '../src/online/chat-panel.js';
import { PlayerController } from '../src/player-controller.js';
import { FakeElement, createFakeDocument } from './support/fake-dom.mjs';

const actions = ['basic', 'active_1', 'active_2', 'active_3', 'dodge', 'ultimate'];

function rig(t) {
  const doc = createFakeDocument();
  doc.body = doc.createElement('body');
  doc.getElementById = () => null;
  const previous = Object.fromEntries(['window', 'document', 'HTMLElement'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window: doc, document: doc, HTMLElement: FakeElement });
  t.after(() => Object.assign(globalThis, previous));
  const controller = new PlayerController({});
  const makeButton = action => {
    const button = doc.createElement('button');
    button.dataset.combatAction = action;
    button.removeEventListener = (type, fn) => button.listeners.set(type, (button.listeners.get(type) ?? []).filter(x => x !== fn));
    return button;
  };
  const buttons = Object.fromEntries(actions.map(action => [action, makeButton(action)]));
  const reset = makeButton('reset');
  const root = doc.createElement('section');
  root.append(...Object.values(buttons), reset);
  root.querySelector = selector => selector === '[data-combat-reset]' ? reset : null;
  root.querySelectorAll = () => Object.values(buttons);
  const clock = { now: () => 1000 };
  const training = createBuilding5CombatTraining({ clock, getPlayerPosition: () => ({
    x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + 6
  }) });
  const runtime = createCombatRuntimeV03({ clock, localTraining: training });
  const calls = [];
  let resets = 0;
  const inputFocus = createInputFocusManager();
  const hud = createCombatHudV03({ root, inputFocus, runtime: {
    ...runtime,
    dispatch(action) { calls.push(action); return runtime.dispatch(action); },
    resetTrainingTarget() { resets += 1; return runtime.resetTrainingTarget(); }
  } });
  const el = tag => doc.createElement(tag);
  const chat = createChatPanel({
    doc, toggle: el('button'), form: el('form'), input: el('input'), feedList: el('ol'), hint: el('p'),
    getChat: () => ({ signedIn: true, submit: () => ({ result: 'sent' }) })
  });
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
  runtime.gainUltimate(100);
  runtime.dispatch('ultimate'); // Supply the existing Barrage resource requirement.
  runtime.gainUltimate(100);
  return { doc, root, buttons, reset, runtime, training, calls, inputFocus, hud, controller, chat, resets: () => resets };
}

function event(button, type, data = {}) {
  return button.dispatch(type, { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data });
}

// Model only the native button default-action boundary. Real browser acceptance
// separately verifies that Enter produces click on keydown and Space on keyup.
function press(button, code, { repeat = false } = {}) {
  const down = event(button, 'keydown', { code, key: code === 'Space' ? ' ' : 'Enter', repeat });
  if (code !== 'Space' && !down.defaultPrevented && !button.disabled) event(button, 'click', { detail: 0 });
  const up = event(button, 'keyup', { code, key: code === 'Space' ? ' ' : 'Enter' });
  if (code === 'Space' && !repeat && !down.defaultPrevented && !up.defaultPrevented && !button.disabled) event(button, 'click', { detail: 0 });
  return down;
}

for (const action of actions) {
  for (const mode of ['mouse', 'touch', 'Enter', 'NumpadEnter', 'Space', 'assistive-click']) {
    test(`${action}: ${mode} dispatches exactly once and leaves chat/jump untouched`, t => {
      const r = rig(t), button = r.buttons[action];
      assert.equal(button.disabled, false);
      button.focus();
      if (mode === 'mouse' || mode === 'touch') {
        const down = event(button, 'pointerdown', { button: 0, pointerType: mode, pointerId: 1 });
        assert.equal(r.calls.length, 1, 'pointer response stays immediate');
        assert.equal(down.defaultPrevented, true, 'preserves existing touch/focus gesture handling');
        event(button, 'pointerup', { button: 0, pointerType: mode, pointerId: 1 });
        event(button, 'click', { button: 0, pointerType: mode, detail: 1 });
      } else if (mode === 'assistive-click') event(button, 'click', { detail: 0 });
      else press(button, mode);
      assert.deepEqual(r.calls, [action]);
      assert.equal(r.runtime.snapshot().lastAction.action, action);
      assert.equal(r.chat.open, false, 'Enter belongs to the focused button');
      assert.equal(r.controller.jumpQueued, false, 'Space cannot also jump');
      assert.equal(r.controller.ascendHeld, false);
      assert.equal(r.controller.keys.has('Space'), false);
    });
  }
}

for (const focusClass of ['CHAT', 'BLOCKING_UI', 'SYSTEM_LOCK']) {
  test(`blocked ${focusClass} HUD refuses pointer and retained native/assistive callbacks`, t => {
    const r = rig(t);
    const claim = r.inputFocus.claim('overlay', INPUT_FOCUS_POLICY[focusClass]);
    for (const button of [...Object.values(r.buttons), r.reset]) {
      assert.equal(button.disabled, true);
      event(button, 'pointerdown', { button: 0, pointerType: 'touch' });
      event(button, 'click', { detail: 0 });
      press(button, 'Enter');
      press(button, 'Space');
    }
    assert.deepEqual(r.calls, []);
    assert.equal(r.resets(), 0);
    assert.equal(r.chat.open, false);
    assert.equal(r.controller.jumpQueued, false);
    r.inputFocus.release(claim);
    event(r.buttons.basic, 'click', { detail: 0 });
    assert.deepEqual(r.calls, ['basic']);
  });
}

test('disabled actions never dispatch even if a stale callback is invoked', t => {
  const r = rig(t);
  r.buttons.active_1.disabled = true;
  event(r.buttons.active_1, 'pointerdown', { button: 0 });
  event(r.buttons.active_1, 'click', { detail: 0 });
  assert.deepEqual(r.calls, []);
  r.runtime.end();
  for (const button of Object.values(r.buttons)) {
    event(button, 'pointerdown', { button: 0 });
    event(button, 'click', { detail: 0 });
  }
  assert.deepEqual(r.calls, []);
});

test('only primary pointerdown dispatches; zero-detail pointer compatibility clicks stay deduplicated', t => {
  const r = rig(t), button = r.buttons.basic;
  for (const buttonNumber of [1, 2]) event(button, 'pointerdown', { button: buttonNumber, pointerType: 'mouse' });
  assert.deepEqual(r.calls, []);
  event(button, 'pointerdown', { button: 0, pointerType: 'touch' });
  event(button, 'click', { detail: 0, pointerType: 'touch' });
  event(button, 'click', { detail: 1 });
  assert.deepEqual(r.calls, ['basic']);
  event(button, 'click', { detail: 0 });
  assert.deepEqual(r.calls, ['basic', 'basic'], 'a later assistive activation is not swallowed');
});

test('held Enter is single-shot; non-activation keys still reach gameplay and keyup still releases held Space', t => {
  const r = rig(t), button = r.buttons.basic;
  press(button, 'Enter');
  press(button, 'Enter', { repeat: true });
  assert.deepEqual(r.calls, ['basic']);
  event(button, 'keydown', { code: 'Digit1' });
  assert.equal(r.controller.keys.has('Digit1'), true, 'physical combat hotkeys keep bubbling');
  r.doc.dispatch('keydown', { code: 'Space', target: null });
  assert.equal(r.controller.ascendHeld, true);
  event(button, 'keyup', { code: 'Space' });
  assert.equal(r.controller.ascendHeld, false, 'button focus must not strand a previously held world key');
});

for (const mode of ['mouse', 'touch', 'Enter', 'Space', 'assistive-click']) {
  test(`training reset: ${mode} executes once without leaking Enter/Space`, t => {
    const r = rig(t);
    for (let i = 0; i < 100 && !r.training.snapshot().defeated; i += 1) r.runtime.dispatch('basic');
    assert.equal(r.reset.hidden, false);
    if (mode === 'mouse' || mode === 'touch') {
      event(r.reset, 'pointerdown', { button: 0, pointerType: mode });
      event(r.reset, 'click', { detail: 1, pointerType: mode });
    } else if (mode === 'assistive-click') event(r.reset, 'click', { detail: 0 });
    else press(r.reset, mode);
    assert.equal(r.resets(), 1);
    assert.equal(r.training.snapshot().defeated, false);
    assert.equal(r.reset.hidden, true);
    assert.equal(r.chat.open, false);
    assert.equal(r.controller.jumpQueued, false);
  });
}

test('destroy removes every new input listener and inactive/hidden reset cannot fire', t => {
  const r = rig(t);
  event(r.reset, 'click', { detail: 0 });
  event(r.reset, 'pointerdown', { button: 0 });
  assert.equal(r.resets(), 0);
  r.hud.destroy();
  for (const button of [...Object.values(r.buttons), r.reset]) {
    for (const type of ['pointerdown', 'click', 'keydown']) assert.equal((button.listeners.get(type) ?? []).length, 0);
    event(button, 'pointerdown', { button: 0 });
    event(button, 'click', { detail: 0 });
  }
  assert.deepEqual(r.calls, []);
  assert.equal(r.resets(), 0);
});

// Execute the existing World registration to catch leakage into the real Shift
// dodge hotkey rather than substituting a test-only shortcut implementation.
function bindPhysicalCombat(r) {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('window.addEventListener("keydown", (event) => {\n  if (!combatRuntime.active || event.repeat');
  const end = main.indexOf('canvas.addEventListener("pointerdown"', start);
  assert.ok(start >= 0 && end > start);
  r.physicalCalls = [];
  const observedRuntime = { ...r.runtime, dispatch(action) {
    r.physicalCalls.push(action);
    return r.runtime.dispatch(action);
  } };
  new Function('window', 'combatRuntime', 'controller', 'inputFocus', 'HTMLElement', main.slice(start, end))(
    r.doc, observedRuntime, r.controller, r.inputFocus, FakeElement);
}

for (const code of ['ShiftLeft', 'ShiftRight']) {
  for (const action of [...actions, 'reset']) {
    test(`${action}: focused ${code} preserves backward Tab without dispatching physical dodge`, t => {
      const r = rig(t);
      bindPhysicalCombat(r);
      if (action === 'reset') {
        for (let i = 0; i < 100 && !r.training.snapshot().defeated; i += 1) r.runtime.dispatch('basic');
      }
      const button = action === 'reset' ? r.reset : r.buttons[action];
      assert.equal(button.hidden, false);
      assert.equal(button.disabled, false);
      button.focus();
      const before = r.runtime.snapshot();
      const shift = event(button, 'keydown', { code, key: 'Shift', shiftKey: true });
      const tab = event(button, 'keydown', { code: 'Tab', key: 'Tab', shiftKey: true });
      assert.equal(shift.defaultPrevented, false, 'modifier default remains intact');
      assert.equal(tab.defaultPrevented, false, 'native backward Tab is not prevented');
      assert.deepEqual(r.runtime.snapshot(), before, 'no action, dodge state or cooldown mutation');
      assert.deepEqual(r.physicalCalls, [], 'no dispatch attempt hidden by cooldown rejection');
      assert.equal(r.controller.keys.has(code), false, 'Shift is owned by the focused control');
      event(button, 'keyup', { code: 'Tab', key: 'Tab', shiftKey: true });
      event(button, 'keyup', { code, key: 'Shift' });
    });
  }
  test(`${code} outside combat buttons still dispatches one normal gameplay dodge`, t => {
    const r = rig(t);
    bindPhysicalCombat(r);
    const before = r.runtime.snapshot().actionSerial;
    r.doc.dispatch('keydown', { code, key: 'Shift', shiftKey: true, target: r.doc.body });
    assert.equal(r.runtime.snapshot().actionSerial, before + 1);
    assert.equal(r.runtime.snapshot().lastAction.action, 'dodge');
    assert.ok(r.runtime.snapshot().training.cooldowns.dodge > 0);
    r.doc.dispatch('keydown', { code, key: 'Shift', shiftKey: true, repeat: true, target: r.doc.body });
    assert.equal(r.runtime.snapshot().actionSerial, before + 1, 'held physical hotkey stays single-shot');
    assert.deepEqual(r.physicalCalls, ['dodge'], 'held Shift makes only one dispatch attempt');
    r.doc.dispatch('keyup', { code, key: 'Shift', target: r.doc.body });
  });
}
