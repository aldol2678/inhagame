import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCombatRuntimeV03 } from '../src/combat/combat-runtime-v03.js';
import { createCombatHudV03 } from '../src/combat/combat-hud-v03.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = runtime => runtime.startTraining({
  sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST'
});

// Execute the actual registration blocks, not copies of their input decisions.
function inputRig() {
  const win = createFakeDocument();
  const canvas = win.createElement('canvas');
  const runtime = createCombatRuntimeV03();
  const inputFocus = createInputFocusManager();
  const controller = { keys: new Set() };
  const journal = { open: false, setOpen(value) { this.open = value; } };
  let interactions = 0;
  const keyStart = main.indexOf('window.addEventListener("keydown", (event) => {\n  if (event.code !== "KeyF"');
  const keyEnd = main.indexOf('guestbookInteraction = createGuestbookInteraction', keyStart);
  assert.ok(keyStart >= 0 && keyEnd > keyStart);
  new Function('window', 'canvas', 'combatRuntime', 'controller', 'inputFocus', 'interactionAction', 'HTMLElement',
    main.slice(keyStart, keyEnd))(win, canvas, runtime, controller, inputFocus, () => ++interactions, class {});
  const qStart = main.indexOf('window.addEventListener("keydown", (event) => {\n  if (event.code !== "KeyQ"');
  const qEnd = main.indexOf('\n});', qStart) + 4;
  assert.ok(qStart >= 0 && qEnd > qStart);
  new Function('window', 'combatRuntime', 'inputFocus', 'lobbyWorld', 'lobbyTransition', 'questJournal', 'HTMLElement',
    main.slice(qStart, qEnd))(win, runtime, inputFocus, { active: false }, { active: false }, journal, class {});
  return {
    runtime, inputFocus, controller, journal,
    key: (code, extra = {}) => win.dispatch('keydown', { code, repeat: false, target: null, ...extra }),
    pointer: () => canvas.dispatch('pointerdown', { button: 0 }),
    interactions: () => interactions
  };
}

for (const focusClass of ['CHAT', 'BLOCKING_UI', 'SYSTEM_LOCK']) {
  test(`Combat input yields to ${focusClass}, including Escape, and resumes after release`, () => {
    const r = inputRig();
    start(r.runtime);
    r.runtime.gainUltimate(100);
    const claim = r.inputFocus.claim('overlay', INPUT_FOCUS_POLICY[focusClass]);
    const before = r.runtime.snapshot();
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyQ', 'Escape']) r.key(code);
    r.pointer();
    assert.deepEqual(r.runtime.snapshot(), before, 'blocked input must not act, consume ULT or exit training');
    r.inputFocus.release(claim);
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'ShiftLeft', 'KeyF']) r.key(code);
    r.pointer();
    r.key('KeyQ');
    assert.equal(r.runtime.snapshot().actionSerial, 6);
    assert.equal(r.runtime.snapshot().ultimateGauge, 0);
    assert.equal(r.runtime.snapshot().lockOn, true);
    r.key('Escape');
    assert.equal(r.runtime.active, false);
    r.key('KeyF');
    r.key('KeyQ');
    assert.equal(r.interactions(), 1, 'Explore F returns to its existing interaction authority');
    assert.equal(r.journal.open, true, 'Explore Q retains its journal action');
  });
}

test('Combat ignores repeat/modifier keys and clears Shift locomotion only for an accepted dodge', () => {
  const r = inputRig();
  start(r.runtime);
  r.controller.keys.add('ShiftLeft');
  r.key('Digit1', { repeat: true });
  r.key('Digit2', { ctrlKey: true });
  r.key('KeyQ', { altKey: true });
  assert.equal(r.runtime.snapshot().actionSerial, 0);
  assert.equal(r.runtime.snapshot().lockOn, false);
  r.key('ShiftLeft');
  assert.equal(r.runtime.snapshot().actionSerial, 1);
  assert.equal(r.controller.keys.has('ShiftLeft'), false);
});

test('Combat HUD immediately disables on focus claims and rejects retained pointer callbacks', () => {
  const doc = createFakeDocument();
  const buttons = ['basic', 'active_1', 'active_2', 'active_3', 'dodge', 'ultimate'].map(action => {
    const button = doc.createElement('button');
    button.dataset.combatAction = action;
    button.removeEventListener = (type, listener) => {
      button.listeners.set(type, (button.listeners.get(type) ?? []).filter(fn => fn !== listener));
    };
    return button;
  });
  const root = doc.createElement('section');
  root.querySelector = () => null;
  root.querySelectorAll = () => buttons;
  const runtime = createCombatRuntimeV03();
  const inputFocus = createInputFocusManager();
  const hud = createCombatHudV03({ root, runtime, inputFocus });
  start(runtime);
  runtime.gainUltimate(100);
  assert.equal(buttons.every(button => !button.disabled), true);
  for (const focusClass of ['CHAT', 'BLOCKING_UI', 'SYSTEM_LOCK']) {
    const claim = inputFocus.claim('overlay', INPUT_FOCUS_POLICY[focusClass]);
    assert.equal(buttons.every(button => button.disabled), true, `${focusClass} must update HUD without a combat event`);
    const before = runtime.snapshot();
    for (const button of buttons) button.dispatch('pointerdown');
    assert.deepEqual(runtime.snapshot(), before);
    inputFocus.release(claim);
    assert.equal(buttons.every(button => !button.disabled), true);
  }
  buttons[5].dispatch('pointerdown');
  assert.equal(runtime.snapshot().ultimateGauge, 0);
  assert.equal(buttons[5].disabled, true);
  hud.destroy();
  buttons[0].dispatch('pointerdown');
  assert.equal(runtime.snapshot().actionSerial, 1, 'destroy removes the input listener');
});
