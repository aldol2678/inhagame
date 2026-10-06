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
  const calls = [];
  return {
    setTimeOfDay(value, options) {
      calls.push({ value, options });
      return value;
    },
    calls
  };
}

test('canonical world day is five 15-minute periods, totaling 75 real minutes', () => {
  assert.equal(NPC_WORLD_PERIOD_MINUTES, 15);
  assert.equal(P, 15 * 60_000);
  assert.deepEqual(NPC_WORLD_PERIODS, ['morning', 'class_time', 'lunch', 'evening', 'night']);
  assert.equal(NPC_WORLD_CYCLE_MINUTES, 75);
  assert.equal(NPC_WORLD_CYCLE_MS, 75 * 60_000);
});

test('world schedule periods map onto the existing three environment states', () => {
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

test('DAY periods do not retrigger the director until their visual state actually changes', async () => {
  const clock = fakeClock(E + 1_000);
  const environment = fakeEnvironment();
  const controller = createEnvironmentWorldTime({ environment, clock });

  await controller.sync();
  assert.deepEqual(environment.calls, [
    { value: 'DAY', options: { immediate: true } }
  ]);

  clock.setNow(E + P + 1_000);
  controller.update();
  clock.setNow(E + 2 * P + 1_000);
  controller.update();
  assert.equal(environment.calls.length, 1);

  clock.setNow(E + 3 * P + 1_000);
  controller.update();
  assert.equal(environment.calls.length, 2);
  assert.equal(environment.calls[1].value, 'SUNSET');
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
