import { createNpcWorldClock } from '../../npc-factory/npc-world-clock.mjs';
import { worldScheduleAt } from '../../npc-factory/npc-world-time-contract.mjs';
import { worldEnvironmentAt } from './environment-world-cycle.js';

// Coarse compatibility projection. Runtime visuals use worldEnvironmentAt(),
// which subdivides evening into afternoon/golden-hour/sunset/dusk.
export const ENVIRONMENT_TIME_BY_WORLD_PERIOD = Object.freeze({
  morning: 'DAY',
  class_time: 'DAY',
  lunch: 'DAY',
  evening: 'SUNSET',
  night: 'NIGHT'
});

export function environmentTimeForWorldPeriod(period) {
  return ENVIRONMENT_TIME_BY_WORLD_PERIOD[String(period ?? '')] ?? null;
}

export function createEnvironmentWorldTime({
  environment,
  clock = null,
  enabled = true
} = {}) {
  if (!environment?.setTimeOfDay) throw new TypeError('environment.setTimeOfDay is required');

  const ownsClock = enabled && !clock;
  const runtimeClock = clock ?? (enabled ? createNpcWorldClock() : null);
  let initialized = false;
  let schedule = null;
  let environmentTime = null;
  let weather = null;
  let visual = null;
  let disposed = false;

  function apply({ immediate = false } = {}) {
    if (!enabled || disposed) return false;
    const serverNowMs = runtimeClock.now();
    if (!Number.isFinite(serverNowMs)) return false;

    const nextSchedule = worldScheduleAt(serverNowMs);
    const nextVisual = worldEnvironmentAt(nextSchedule);
    const forceImmediate = immediate || !initialized;
    schedule = nextSchedule;
    visual = nextVisual;

    if (nextVisual.environmentTime !== environmentTime) {
      environment.setTimeOfDay(nextVisual.environmentTime, { immediate: forceImmediate });
      environmentTime = nextVisual.environmentTime;
    }

    if (nextVisual.weather !== weather && environment.setWeather) {
      environment.setWeather(nextVisual.weather, { immediate: forceImmediate });
      weather = nextVisual.weather;
    }

    environment.setCelestialPose?.(nextVisual.celestial, { immediate: forceImmediate });
    initialized = true;
    return true;
  }

  async function sync() {
    if (!enabled || disposed) return status();
    const firstSync = !initialized;
    await runtimeClock.sync();
    apply({ immediate: firstSync });
    return status();
  }

  function update() {
    if (!enabled || disposed) return false;
    runtimeClock.refreshIfDue();
    return apply();
  }

  function status() {
    const clockStatus = runtimeClock?.status?.() ?? { state: 'DISABLED', serverNowMs: null, ageMs: null, rttMs: null, lastError: null };
    return Object.freeze({
      enabled,
      state: !enabled ? 'DISABLED' : disposed ? 'DISPOSED' : clockStatus.state,
      period: schedule?.period ?? null,
      periodIndex: schedule?.index ?? null,
      offsetSeconds: schedule?.offsetSeconds ?? null,
      cycleSeconds: schedule?.cycleSeconds ?? null,
      environmentTime,
      weather,
      baseWeather: visual?.baseWeather ?? null,
      rainEvent: visual?.rainEvent ?? null,
      visualPhase: visual?.phase ?? null,
      visualPhaseProgress: visual?.phaseProgress ?? null,
      cycleMinute: visual?.cycleMinute ?? null,
      celestial: visual?.celestial ?? null,
      initialized,
      clock: Object.freeze({ ...clockStatus })
    });
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    if (ownsClock) runtimeClock?.dispose?.();
  }

  return Object.freeze({
    enabled,
    sync,
    update,
    status,
    destroy
  });
}
