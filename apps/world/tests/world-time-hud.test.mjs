import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_TIME_PHASES,
  createWorldTimeHud,
  worldTimeHudPresentation
} from '../src/hud/world-time-hud.js';

class FakeElement {
  constructor() {
    this.hidden = true;
    this.textContent = '';
    this.title = '';
    this.dataset = {};
    this.attributes = {};
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

test('shared world periods map to compact player-facing time phases', () => {
  const expected = {
    morning: '🌅 아침',
    class_time: '☀️ 낮',
    lunch: '☀️ 점심',
    evening: '🌇 저녁',
    night: '🌙 밤'
  };
  assert.deepEqual(Object.keys(WORLD_TIME_PHASES), Object.keys(expected));
  for (const [period, text] of Object.entries(expected)) {
    const presentation = worldTimeHudPresentation({
      enabled: true,
      state: 'SYNCED',
      period
    });
    assert.equal(presentation.visible, true);
    assert.equal(presentation.period, period);
    assert.equal(presentation.text, text);
    assert.match(presentation.ariaLabel, /^INHA WORLD 시간 · /);
  }
});

test('HUD hides rather than inventing local time when the shared clock is unavailable', () => {
  for (const status of [
    null,
    { enabled: false, state: 'DISABLED', period: 'morning' },
    { enabled: true, state: 'UNAVAILABLE', period: 'night' },
    { enabled: true, state: 'SYNCED', period: 'unknown' }
  ]) {
    assert.equal(worldTimeHudPresentation(status).visible, false);
  }
});

test('HUD keeps the last server-anchored phase visible during clock holdover', () => {
  const presentation = worldTimeHudPresentation({
    enabled: true,
    state: 'HOLDOVER',
    period: 'night'
  });
  assert.equal(presentation.visible, true);
  assert.equal(presentation.text, '🌙 밤');
});

test('runtime updates the existing location-chip slot without owning time authority', () => {
  const element = new FakeElement();
  let snapshot = { enabled: true, state: 'SYNCED', period: 'morning' };
  const hud = createWorldTimeHud({
    element,
    getStatus: () => snapshot,
    refreshSeconds: 1
  });

  assert.equal(element.hidden, false);
  assert.equal(element.textContent, '🌅 아침');
  assert.equal(element.dataset.period, 'morning');

  snapshot = { enabled: true, state: 'SYNCED', period: 'night' };
  assert.equal(hud.update(0.5), false);
  assert.equal(element.textContent, '🌅 아침');
  assert.equal(hud.update(0.5), true);
  assert.equal(element.textContent, '🌙 밤');
  assert.equal(element.dataset.period, 'night');

  snapshot = { enabled: true, state: 'UNAVAILABLE', period: 'night' };
  hud.update(1);
  assert.equal(element.hidden, true);
  assert.equal(element.textContent, '');
  assert.equal('period' in element.dataset, false);
});
