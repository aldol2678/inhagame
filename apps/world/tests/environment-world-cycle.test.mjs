import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_VISUAL_PHASES,
  celestialPoseAtCycleSeconds,
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

test('weather selection is deterministic, period-aware and never auto-selects snow', () => {
  const schedule = { slot: 12345, period: 'morning' };
  assert.equal(weatherForWorldSchedule(schedule), weatherForWorldSchedule(schedule));

  const seen = new Set();
  for (let slot = 0; slot < 500; slot++) {
    for (const period of ['morning', 'class_time', 'lunch', 'evening', 'night']) {
      const weather = weatherForWorldSchedule({ slot, period });
      assert.notEqual(weather, 'SNOW');
      assert.ok(['CLEAR', 'CLOUDY', 'FOG', 'RAIN'].includes(weather));
      seen.add(weather);
    }
  }
  assert.deepEqual([...seen].sort(), ['CLEAR', 'CLOUDY', 'FOG', 'RAIN']);
});
