import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_TIME_BY_WORLD_PERIOD,
  MORNING_ENVIRONMENT_STAGES,
  createEnvironmentWorldTime,
  environmentTimeForWorldPeriod,
  environmentTimeForWorldSchedule
} from '../src/environment/environment-world-time.js';
import {
  NPC_WORLD_EPOCH_MS as E,
  NPC_WORLD_PERIOD_MS as P
} from '../npc-factory/npc-world-time-contract.mjs';

function fakeClock(initialNow = null) {
  let nowMs = initialNow;
  let syncCalls = 0;
  let refreshCalls = 0;
  let disposed = false;
  return {
    setNow(value) { nowMs = value; },
    now() { return nowMs; },
    async sync() { syncCalls++; return this.status(); },
    refreshIfDue() { refreshCalls++; },
    status() {
      return {
        state: disposed ? 'DISPOSED' : Number.isFinite(nowMs) ? 'SYNCED' : 'UNAVAILABLE',
        serverNowMs: nowMs,
        ageMs: 0,
        rttMs: 0,
        lastError: null
      };
    },
    dispose() { disposed = true; },
    counts() { return { syncCalls, refreshCalls }; }
  };
}

function fakeEnvironment() {
  const calls = [];
  return {
    setTimeOfDay(value, options) {
      calls.push({ value, options });
      return value;
    },
    calls
  };
}

test('world schedule periods keep the existing broad environment mapping', () => {
  assert.deepEqual(ENVIRONMENT_TIME_BY_WORLD_PERIOD, {
    morning: 'DAY',
    class_time: 'DAY',
    lunch: 'DAY',
    evening: 'SUNSET',
    night: 'NIGHT'
  });
  assert.equal(environmentTimeForWorldPeriod('evening'), 'SUNSET');
  assert.equal(environmentTimeForWorldPeriod('night'), 'NIGHT');
  assert.equal(environmentTimeForWorldPeriod('unknown'), null);
});

test('morning period subdivides into dawn sunrise and day without changing the NPC schedule', () => {
  assert.deepEqual(MORNING_ENVIRONMENT_STAGES, [
    { untilSeconds: 300, time: 'DAWN' },
    { untilSeconds: 600, time: 'SUNRISE' },
    { untilSeconds: 900, time: 'DAY' }
  ]);
  assert.equal(environmentTimeForWorldSchedule({ period: 'morning', offsetSeconds: 0 }), 'DAWN');
  assert.equal(environmentTimeForWorldSchedule({ period: 'morning', offsetSeconds: 299.999 }), 'DAWN');
  assert.equal(environmentTimeForWorldSchedule({ period: 'morning', offsetSeconds: 300 }), 'SUNRISE');
  assert.equal(environmentTimeForWorldSchedule({ period: 'morning', offsetSeconds: 599.999 }), 'SUNRISE');
  assert.equal(environmentTimeForWorldSchedule({ period: 'morning', offsetSeconds: 600 }), 'DAY');
  assert.equal(environmentTimeForWorldSchedule({ period: 'class_time', offsetSeconds: 0 }), 'DAY');
  assert.equal(environmentTimeForWorldSchedule({ period: 'evening', offsetSeconds: 0 }), 'SUNSET');
  assert.equal(environmentTimeForWorldSchedule({ period: 'night', offsetSeconds: 0 }), 'NIGHT');
});

test('first server-synced world period applies immediately, then boundaries use the normal transition', async () => {
  const clock = fakeClock(E + 3 * P + 1_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  assert.deepEqual(environment.calls, [
    { value: 'SUNSET', options: { immediate: true } }
  ]);
  assert.equal(controller.status().period, 'evening');
  assert.equal(controller.status().environmentTime, 'SUNSET');

  clock.setNow(E + 4 * P + 1_000);
  controller.update();
  assert.deepEqual(environment.calls[1], {
    value: 'NIGHT',
    options: { immediate: false }
  });
  assert.equal(controller.status().period, 'night');
  assert.equal(controller.status().environmentTime, 'NIGHT');
  assert.equal(clock.counts().refreshCalls, 1);
});

test('morning sky advances through dawn sunrise and day, then stays DAY through class and lunch', async () => {
  const clock = fakeClock(E + 1_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  assert.deepEqual(environment.calls, [
    { value: 'DAWN', options: { immediate: true } }
  ]);

  clock.setNow(E + 300_000 + 1_000);
  controller.update();
  assert.equal(environment.calls[1].value, 'SUNRISE');

  clock.setNow(E + 600_000 + 1_000);
  controller.update();
  assert.equal(environment.calls[2].value, 'DAY');

  clock.setNow(E + P + 1_000);
  controller.update();
  clock.setNow(E + 2 * P + 1_000);
  controller.update();
  assert.equal(environment.calls.length, 3);

  clock.setNow(E + 3 * P + 1_000);
  controller.update();
  assert.equal(environment.calls.length, 4);
  assert.equal(environment.calls[3].value, 'SUNSET');
});

test('unavailable world time never falls back to the client clock or invents a visual state', async () => {
  const clock = fakeClock(null);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  controller.update();
  assert.deepEqual(environment.calls, []);
  assert.equal(controller.status().state, 'UNAVAILABLE');
  assert.equal(controller.status().environmentTime, null);
});

test('preview-disabled controller leaves manual environment controls untouched', async () => {
  const clock = fakeClock(E + 4 * P + 1_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock, enabled: false });

  await controller.sync();
  controller.update();
  assert.deepEqual(environment.calls, []);
  assert.equal(controller.status().state, 'DISABLED');
  assert.equal(clock.counts().syncCalls, 0);
});
