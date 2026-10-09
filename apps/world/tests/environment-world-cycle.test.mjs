import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_VISUAL_PHASES,
  baseWeatherForWorldSchedule,
  celestialPoseAtCycleSeconds,
  rainEventForWorldSchedule,
  visualPhaseAtCycleSeconds,
  weatherForWorldSchedule
} from '../src/environment/environment-world-cycle.js';

const minute = value => value * 60;

test('visual phases keep sunset short inside the existing 75-minute day', () => {
  assert.deepEqual(WORLD_VISUAL_PHASES.map(item => [item.id, item.startMinute, item.endMinute]), [
    ['dawn', 0, 4],
    ['morning', 4, 15],
    ['day', 15, 40],
    ['afternoon', 40, 50],
    ['golden_hour', 50, 54],
    ['sunset', 54, 58],
    ['dusk', 58, 60],
    ['night', 60, 75]
  ]);
  assert.equal(visualPhaseAtCycleSeconds(minute(45)).id, 'afternoon');
  assert.equal(visualPhaseAtCycleSeconds(minute(50)).environmentTime, 'GOLDEN_HOUR');
  assert.equal(visualPhaseAtCycleSeconds(minute(54)).environmentTime, 'SUNSET');
  assert.equal(visualPhaseAtCycleSeconds(minute(58)).environmentTime, 'DUSK');
  assert.equal(visualPhaseAtCycleSeconds(minute(60)).environmentTime, 'NIGHT');
});

test('sun and moon follow opposite continuous orbits over the shared cycle', () => {
  const dawn = celestialPoseAtCycleSeconds(minute(0));
  const noon = celestialPoseAtCycleSeconds(minute(30));
  const sunset = celestialPoseAtCycleSeconds(minute(60));
  const midnight = celestialPoseAtCycleSeconds(minute(67.5));

  assert.ok(Math.abs(dawn.sunAltitudeDegrees) < 1e-9);
  assert.ok(Math.abs(noon.sunAltitudeDegrees - 60) < 1e-9);
  assert.ok(Math.abs(sunset.sunAltitudeDegrees) < 1e-9);
  assert.ok(Math.abs(midnight.sunAltitudeDegrees + 45) < 1e-9);
  assert.equal(midnight.moonAltitudeDegrees, -midnight.sunAltitudeDegrees);
  assert.equal((midnight.moonAzimuthDegrees - midnight.sunAzimuthDegrees + 360) % 360, 180);
  assert.equal(noon.sunEuler[0], 30);
});

test('base weather is deterministic, period-aware and never auto-selects rain or snow', () => {
  const schedule = { slot: 12345, period: 'morning', offsetSeconds: 0 };
  assert.equal(baseWeatherForWorldSchedule(schedule), baseWeatherForWorldSchedule(schedule));

  const seen = new Set();
  for (let slot = 0; slot < 500; slot++) {
    for (const period of ['morning', 'class_time', 'lunch', 'evening', 'night']) {
      const weather = baseWeatherForWorldSchedule({ slot, period, offsetSeconds: 0 });
      assert.notEqual(weather, 'RAIN');
      assert.notEqual(weather, 'SNOW');
      assert.ok(['CLEAR', 'CLOUDY', 'FOG'].includes(weather));
      seen.add(weather);
    }
  }
  assert.deepEqual([...seen].sort(), ['CLEAR', 'CLOUDY', 'FOG']);
});

test('rain occurs at deterministic random offsets for 3 to 7 minutes, with cloudy shoulders', () => {
  let sample = null;
  for (let slot = 0; slot < 1000 && !sample; slot++) {
    for (const period of ['morning', 'class_time', 'lunch', 'evening', 'night']) {
      const schedule = { slot, period, offsetSeconds: 0 };
      const event = rainEventForWorldSchedule(schedule);
      if (event.occurs) sample = { schedule, event };
    }
  }

  assert.ok(sample, 'expected at least one deterministic rain event');
  const { schedule, event } = sample;
  assert.ok(event.durationSeconds >= minute(3));
  assert.ok(event.durationSeconds <= minute(7));
  assert.ok(event.startSeconds >= minute(1));
  assert.ok(event.endSeconds <= minute(14));

  const same = rainEventForWorldSchedule(schedule);
  assert.equal(same.startSeconds, event.startSeconds);
  assert.equal(same.durationSeconds, event.durationSeconds);

  const lead = {
    ...schedule,
    offsetSeconds: Math.max(0, event.startSeconds - 1)
  };
  const active = {
    ...schedule,
    offsetSeconds: event.startSeconds + Math.min(30, Math.max(0, event.durationSeconds - 1))
  };
  const trail = {
    ...schedule,
    offsetSeconds: event.endSeconds
  };

  assert.equal(weatherForWorldSchedule(lead), 'CLOUDY');
  assert.equal(weatherForWorldSchedule(active), 'RAIN');
  assert.equal(weatherForWorldSchedule(trail), 'CLOUDY');
});

test('rain events appear across all world periods and never occupy the full 15-minute period', () => {
  const periods = ['morning', 'class_time', 'lunch', 'evening', 'night'];
  for (const period of periods) {
    let found = null;
    for (let slot = 0; slot < 5000 && !found; slot++) {
      const event = rainEventForWorldSchedule({ slot, period, offsetSeconds: 0 });
      if (event.occurs) found = event;
    }
    assert.ok(found, `expected rain event for ${period}`);
    assert.ok(found.startSeconds > 0);
    assert.ok(found.endSeconds < minute(15));
    assert.ok(found.durationSeconds < minute(15));
  }
});
