import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatFeedbackV03 } from '../src/combat/combat-feedback-v03.js';

function classList() {
  const set = new Set();
  return {
    add: (...items) => items.forEach(x => set.add(x)),
    remove: (...items) => items.forEach(x => set.delete(x)),
    contains: item => set.has(item)
  };
}
function visual() {
  return { dataset: {}, classList: classList(), offsetWidth: 100 };
}
function runtimeRig(clock) {
  let listener = null;
  let state = {
    active: true,
    lastAction: null,
    training: {
      hitSerial: 0,
      breakSerial: 0,
      player: { hitSerial: 0, perfectDodgeSerial: 0, defeated: false }
    }
  };
  const runtime = {
    active: true,
    snapshot: () => state,
    subscribe(fn, { emitCurrent = false } = {}) {
      listener = fn;
      if (emitCurrent) fn(state, 'sync');
      return () => { listener = null; };
    }
  };
  return {
    runtime,
    emit(next, event) { state = next; listener?.(state, event); },
    state: () => state,
    clock
  };
}

test('Combat feedback routes basic, BREAK, player-hit and Perfect Dodge haptics without duplicate contact', () => {
  let now = 1000;
  const clock = { now: () => now };
  const r = runtimeRig(clock);
  const canvas = visual(), overlay = visual(), patterns = [];
  const feedback = createCombatFeedbackV03({
    runtime: r.runtime,
    canvas,
    overlay,
    navigatorLike: { vibrate: pattern => patterns.push([...pattern]) },
    AudioContextCtor: null,
    documentLike: null,
    clock
  });

  r.emit({
    ...r.state(),
    lastAction: { action: 'basic' },
    training: { ...r.state().training, hitSerial: 1 }
  }, 'action');
  assert.deepEqual(patterns.at(-1), [8]);
  assert.equal(canvas.dataset.combatKick, 'basic');
  assert.equal(feedback.status().hitstopRemainingMs, 18);

  now += 20;
  r.emit({
    ...r.state(),
    lastAction: { action: 'active_2' },
    training: { ...r.state().training, hitSerial: 2, breakSerial: 1 }
  }, 'action');
  assert.deepEqual(patterns.at(-1), [26, 35, 32]);
  const countAfterBreak = patterns.length;
  r.emit(r.state(), 'tick');
  assert.equal(patterns.length, countAfterBreak, 'BREAK consumes the same hit serial');

  now += 70;
  r.emit({
    ...r.state(),
    training: {
      ...r.state().training,
      player: { ...r.state().training.player, hitSerial: 1, defeated: false }
    }
  }, 'player-hit');
  assert.deepEqual(patterns.at(-1), [22]);
  assert.equal(canvas.dataset.combatKick, 'player-hit');
  assert.ok(feedback.poseOffsets());

  now += 50;
  r.emit({
    ...r.state(),
    training: {
      ...r.state().training,
      player: { ...r.state().training.player, perfectDodgeSerial: 1 }
    }
  }, 'perfect-dodge');
  assert.deepEqual(patterns.at(-1), [12, 28, 18]);
  assert.equal(overlay.dataset.kind, 'perfect');
  assert.ok(feedback.poseOffsets());
  feedback.destroy();
});

test('Combat feedback defeat uses the v9.22 defeat haptic and local reaction only', () => {
  let now = 0;
  const clock = { now: () => now };
  const r = runtimeRig(clock), patterns = [];
  const feedback = createCombatFeedbackV03({
    runtime: r.runtime,
    canvas: visual(),
    overlay: visual(),
    navigatorLike: { vibrate: pattern => patterns.push([...pattern]) },
    AudioContextCtor: null,
    documentLike: null,
    clock
  });
  r.emit({
    ...r.state(),
    training: {
      ...r.state().training,
      player: { ...r.state().training.player, hitSerial: 1, defeated: true }
    }
  }, 'player-defeated');
  assert.deepEqual(patterns.at(-1), [35, 55, 45]);
  assert.equal(feedback.status().reaction, 'defeat');
  feedback.destroy();
});
