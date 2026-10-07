import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_TIME_BY_WORLD_PERIOD,
  createEnvironmentWorldTime,
  environmentTimeForWorldPeriod
} from '../src/environment/environment-world-time.js';
import {
  NPC_WORLD_CYCLE_MINUTES,
  NPC_WORLD_CYCLE_MS,
  NPC_WORLD_EPOCH_MS as E,
  NPC_WORLD_PERIOD_MINUTES,
  NPC_WORLD_PERIOD_MS as P,
  NPC_WORLD_PERIODS
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
  const timeCalls = [];
  const weatherCalls = [];
  const celestialCalls = [];
  return {
    setTimeOfDay(value, options) {
      timeCalls.push({ value, options });
      return value;
    },
    setWeather(value, options) {
      weatherCalls.push({ value, options });
      return value;
    },
    setCelestialPose(value, options) {
      celestialCalls.push({ value, options });
      return true;
    },
    timeCalls,
    weatherCalls,
    celestialCalls
  };
}

test('canonical world day is five 15-minute periods, totaling 75 real minutes', () => {
  assert.equal(NPC_WORLD_PERIOD_MINUTES, 15);
  assert.equal(P, 15 * 60_000);
  assert.deepEqual(NPC_WORLD_PERIODS, ['morning', 'class_time', 'lunch', 'evening', 'night']);
  assert.equal(NPC_WORLD_CYCLE_MINUTES, 75);
  assert.equal(NPC_WORLD_CYCLE_MS, 75 * 60_000);
});

test('coarse period mapping stays compatible while runtime visuals subdivide evening', () => {
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

test('evening begins as afternoon, then advances through golden hour, sunset and dusk', async () => {
  const clock = fakeClock(E + 45 * 60_000 + 1_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  assert.equal(controller.status().period, 'evening');
  assert.equal(controller.status().visualPhase, 'afternoon');
  assert.equal(controller.status().environmentTime, 'DAY');
  assert.deepEqual(environment.timeCalls[0], {
    value: 'DAY',
    options: { immediate: true }
  });

  clock.setNow(E + 50 * 60_000 + 1_000);
  controller.update();
  assert.equal(controller.status().visualPhase, 'golden_hour');
  assert.equal(controller.status().environmentTime, 'GOLDEN_HOUR');

  clock.setNow(E + 54 * 60_000 + 1_000);
  controller.update();
  assert.equal(controller.status().visualPhase, 'sunset');
  assert.equal(controller.status().environmentTime, 'SUNSET');

  clock.setNow(E + 58 * 60_000 + 1_000);
  controller.update();
  assert.equal(controller.status().visualPhase, 'dusk');
  assert.equal(controller.status().environmentTime, 'DUSK');

  clock.setNow(E + 60 * 60_000 + 1_000);
  controller.update();
  assert.equal(controller.status().period, 'night');
  assert.equal(controller.status().visualPhase, 'night');
  assert.equal(controller.status().environmentTime, 'NIGHT');
});

test('server-synced weather and celestial pose are applied immediately then remain clock-driven', async () => {
  const clock = fakeClock(E + 10 * 60_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  assert.equal(environment.weatherCalls.length, 1);
  assert.equal(environment.weatherCalls[0].options.immediate, true);
  assert.equal(environment.celestialCalls.length, 1);
  assert.equal(environment.celestialCalls[0].options.immediate, true);
  assert.equal(typeof controller.status().weather, 'string');
  assert.equal(typeof controller.status().celestial.sunAltitudeDegrees, 'number');

  clock.setNow(E + 10 * 60_000 + 1_000);
  controller.update();
  assert.equal(environment.celestialCalls.length, 2);
  assert.equal(environment.celestialCalls[1].options.immediate, false);
});

test('visual DAY periods do not retrigger the director until the visual lighting state changes', async () => {
  const clock = fakeClock(E + 5 * 60_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  assert.equal(environment.timeCalls[0].value, 'DAY');

  clock.setNow(E + P + 1_000);
  controller.update();
  clock.setNow(E + 2 * P + 1_000);
  controller.update();
  assert.equal(environment.timeCalls.length, 1);

  clock.setNow(E + 50 * 60_000 + 1_000);
  controller.update();
  assert.equal(environment.timeCalls.length, 2);
  assert.equal(environment.timeCalls[1].value, 'GOLDEN_HOUR');
});

test('unavailable world time never falls back to the client clock or invents a visual state', async () => {
  const clock = fakeClock(null);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  controller.update();
  assert.deepEqual(environment.timeCalls, []);
  assert.deepEqual(environment.weatherCalls, []);
  assert.deepEqual(environment.celestialCalls, []);
  assert.equal(controller.status().state, 'UNAVAILABLE');
  assert.equal(controller.status().environmentTime, null);
});

test('preview-disabled controller leaves manual environment controls untouched', async () => {
  const clock = fakeClock(E + 4 * P + 1_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock, enabled: false });

  await controller.sync();
  controller.update();
  assert.deepEqual(environment.timeCalls, []);
  assert.deepEqual(environment.weatherCalls, []);
  assert.deepEqual(environment.celestialCalls, []);
  assert.equal(controller.status().state, 'DISABLED');
  assert.equal(clock.counts().syncCalls, 0);
});
