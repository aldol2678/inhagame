import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_TIME_DISPLAY_RANGES,
  WORLD_TIME_PHASES,
  createWorldTimeHud,
  formatWorldTimeClock,
  worldTimeClockMinute,
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

test('five shared schedule periods form one continuous 06:00 -> 06:00 display day', () => {
  const boundaries = [
    ['morning', 0, '06:00'],
    ['morning', 900, '09:00'],
    ['class_time', 0, '09:00'],
    ['class_time', 900, '12:00'],
    ['lunch', 0, '12:00'],
    ['lunch', 900, '17:00'],
    ['evening', 0, '17:00'],
    ['evening', 900, '21:00'],
    ['night', 0, '21:00'],
    ['night', 900, '06:00']
  ];
  for (const [period, offset, clock] of boundaries)
    assert.equal(formatWorldTimeClock(period, offset), clock, `${period} @ ${offset}`);

  assert.equal(worldTimeClockMinute('night', 450), 90);
  assert.equal(formatWorldTimeClock('night', 450), '01:30');
  assert.equal(formatWorldTimeClock('unknown', 0), null);
  assert.equal(formatWorldTimeClock('morning', Number.NaN), null);
  assert.deepEqual(Object.keys(WORLD_TIME_DISPLAY_RANGES), Object.keys(WORLD_TIME_PHASES));
});

test('shared world periods map to compact icon + HH:MM presentation', () => {
  const expected = {
    morning: ['🌅', '아침', '06:00'],
    class_time: ['☀️', '낮', '09:00'],
    lunch: ['☀️', '점심', '12:00'],
    evening: ['🌇', '저녁', '17:00'],
    night: ['🌙', '밤', '21:00']
  };
  for (const [period, [icon, label, clock]] of Object.entries(expected)) {
    const presentation = worldTimeHudPresentation({
      enabled: true,
      state: 'SYNCED',
      period,
      offsetSeconds: 0
    });
    assert.equal(presentation.visible, true);
    assert.equal(presentation.period, period);
    assert.equal(presentation.text, `${icon} ${clock}`);
    assert.equal(presentation.clock, clock);
    assert.equal(presentation.label, label);
    assert.equal(presentation.ariaLabel, `INHA WORLD 시간 · ${label} · ${clock}`);
  }
});

test('HUD hides rather than inventing device time when the shared clock is unavailable', () => {
  for (const status of [
    null,
    { enabled: false, state: 'DISABLED', period: 'morning', offsetSeconds: 0 },
    { enabled: true, state: 'UNAVAILABLE', period: 'night', offsetSeconds: 0 },
    { enabled: true, state: 'SYNCED', period: 'unknown', offsetSeconds: 0 },
    { enabled: true, state: 'SYNCED', period: 'night', offsetSeconds: null }
  ]) {
    assert.equal(worldTimeHudPresentation(status).visible, false);
  }
});

test('HUD keeps server-anchored clock progression readable during holdover', () => {
  const presentation = worldTimeHudPresentation({
    enabled: true,
    state: 'HOLDOVER',
    period: 'night',
    offsetSeconds: 300
  });
  assert.equal(presentation.visible, true);
  assert.equal(presentation.text, '🌙 00:00');
});

test('runtime updates the existing location-chip slot without owning time authority', () => {
  const element = new FakeElement();
  let snapshot = { enabled: true, state: 'SYNCED', period: 'morning', offsetSeconds: 0 };
  const hud = createWorldTimeHud({
    element,
    getStatus: () => snapshot,
    refreshSeconds: 1
  });

  assert.equal(element.hidden, false);
  assert.equal(element.textContent, '🌅 06:00');
  assert.equal(element.dataset.period, 'morning');

  snapshot = { enabled: true, state: 'SYNCED', period: 'night', offsetSeconds: 450 };
  assert.equal(hud.update(0.5), false);
  assert.equal(element.textContent, '🌅 06:00');
  assert.equal(hud.update(0.5), true);
  assert.equal(element.textContent, '🌙 01:30');
  assert.equal(element.dataset.period, 'night');

  snapshot = { enabled: true, state: 'UNAVAILABLE', period: 'night', offsetSeconds: 451 };
  hud.update(1);
  assert.equal(element.hidden, true);
  assert.equal(element.textContent, '');
  assert.equal('period' in element.dataset, false);
});
