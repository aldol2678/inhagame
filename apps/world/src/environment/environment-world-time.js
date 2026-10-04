import { createNpcWorldClock } from '../../npc-factory/npc-world-clock.mjs';
import { worldScheduleAt } from '../../npc-factory/npc-world-time-contract.mjs';

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
  clock = createNpcWorldClock(),
  enabled = true
} = {}) {
  if (!environment?.setTimeOfDay) throw new TypeError('environment.setTimeOfDay is required');

  let initialized = false;
  let schedule = null;
  let environmentTime = null;
  let disposed = false;

  function apply({ immediate = false } = {}) {
    if (!enabled || disposed) return false;
    const serverNowMs = clock.now();
    if (!Number.isFinite(serverNowMs)) return false;

    const nextSchedule = worldScheduleAt(serverNowMs);
    const nextEnvironmentTime = environmentTimeForWorldPeriod(nextSchedule.period);
    schedule = nextSchedule;
    if (!nextEnvironmentTime) return false;

    if (nextEnvironmentTime !== environmentTime) {
      environment.setTimeOfDay(nextEnvironmentTime, {
        immediate: immediate || !initialized
      });
      environmentTime = nextEnvironmentTime;
    }
    initialized = true;
    return true;
  }

  async function sync() {
    if (!enabled || disposed) return status();
    const firstSync = !initialized;
    await clock.sync();
    apply({ immediate: firstSync });
    return status();
  }

  function update() {
    if (!enabled || disposed) return false;
    clock.refreshIfDue();
    return apply();
  }

  function status() {
    const clockStatus = clock.status();
    return Object.freeze({
      enabled,
      state: !enabled ? 'DISABLED' : disposed ? 'DISPOSED' : clockStatus.state,
      period: schedule?.period ?? null,
      periodIndex: schedule?.index ?? null,
      offsetSeconds: schedule?.offsetSeconds ?? null,
      cycleSeconds: schedule?.cycleSeconds ?? null,
      environmentTime,
      initialized,
      clock: Object.freeze({ ...clockStatus })
    });
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    clock.dispose?.();
  }

  return Object.freeze({
    enabled,
    sync,
    update,
    status,
    destroy
  });
}
