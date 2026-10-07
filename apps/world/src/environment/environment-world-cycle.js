import { NPC_WORLD_CYCLE_MINUTES } from '../../npc-factory/npc-world-time-contract.mjs';

const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const wrapDegrees = value => ((Number(value) % 360) + 360) % 360;

const phase = (id, startMinute, endMinute, environmentTime) => Object.freeze({
  id, startMinute, endMinute, environmentTime
});

export const WORLD_VISUAL_PHASES = Object.freeze([
  phase('dawn', 0, 4, 'DAWN'),
  phase('morning', 4, 15, 'DAY'),
  phase('day', 15, 40, 'DAY'),
  phase('afternoon', 40, 50, 'DAY'),
  phase('golden_hour', 50, 54, 'GOLDEN_HOUR'),
  phase('sunset', 54, 58, 'SUNSET'),
  phase('dusk', 58, 60, 'DUSK'),
  phase('night', 60, NPC_WORLD_CYCLE_MINUTES, 'NIGHT')
]);

export const WEATHER_WEIGHTS_BY_WORLD_PERIOD = Object.freeze({
  morning: Object.freeze([
    ['CLEAR', 0.50], ['CLOUDY', 0.28], ['FOG', 0.17], ['RAIN', 0.05]
  ]),
  class_time: Object.freeze([
    ['CLEAR', 0.55], ['CLOUDY', 0.30], ['FOG', 0.03], ['RAIN', 0.12]
  ]),
  lunch: Object.freeze([
    ['CLEAR', 0.60], ['CLOUDY', 0.28], ['FOG', 0.02], ['RAIN', 0.10]
  ]),
  evening: Object.freeze([
    ['CLEAR', 0.52], ['CLOUDY', 0.34], ['FOG', 0.02], ['RAIN', 0.12]
  ]),
  night: Object.freeze([
    ['CLEAR', 0.42], ['CLOUDY', 0.38], ['FOG', 0.06], ['RAIN', 0.14]
  ])
});

function cycleMinute(cycleSeconds) {
  const cycleSecondsMax = NPC_WORLD_CYCLE_MINUTES * 60;
  const wrapped = ((Number(cycleSeconds) % cycleSecondsMax) + cycleSecondsMax) % cycleSecondsMax;
  return wrapped / 60;
}

export function visualPhaseAtCycleSeconds(cycleSeconds) {
  const minute = cycleMinute(cycleSeconds);
  const selected = WORLD_VISUAL_PHASES.find(item =>
    minute >= item.startMinute && minute < item.endMinute
  ) ?? WORLD_VISUAL_PHASES[WORLD_VISUAL_PHASES.length - 1];
  const duration = selected.endMinute - selected.startMinute;
  return Object.freeze({
    id: selected.id,
    environmentTime: selected.environmentTime,
    cycleMinute: minute,
    progress: duration > 0 ? clamp01((minute - selected.startMinute) / duration) : 1
  });
}

export function solarHourAtCycleSeconds(cycleSeconds) {
  const minute = cycleMinute(cycleSeconds);
  // 0..60 real minutes model 06:00..18:00; the 15-minute night compresses
  // 18:00..06:00 so NPC cadence stays untouched while celestial motion continues.
  return minute < 60
    ? 6 + minute * 0.2
    : 18 + (minute - 60) * 0.8;
}

export function celestialPoseAtCycleSeconds(cycleSeconds) {
  const solarHour = solarHourAtCycleSeconds(cycleSeconds);
  const solarAngle = ((solarHour - 6) / 12) * Math.PI;
  const sine = Math.sin(solarAngle);
  const sunAltitudeDegrees = sine >= 0 ? 60 * sine : 45 * sine;
  const sunAzimuthDegrees = wrapDegrees(90 + ((solarHour - 6) / 12) * 180);
  const moonAltitudeDegrees = -sunAltitudeDegrees;
  const moonAzimuthDegrees = wrapDegrees(sunAzimuthDegrees + 180);

  return Object.freeze({
    solarHour,
    sunAltitudeDegrees,
    sunAzimuthDegrees,
    sunEuler: Object.freeze([
      90 - sunAltitudeDegrees,
      sunAzimuthDegrees,
      0
    ]),
    moonAltitudeDegrees,
    moonAzimuthDegrees
  });
}

function deterministicUnit(slot) {
  let x = (Number(slot) >>> 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0x100000000;
}

export function weatherForWorldSchedule(schedule) {
  const weights = WEATHER_WEIGHTS_BY_WORLD_PERIOD[schedule?.period] ??
    WEATHER_WEIGHTS_BY_WORLD_PERIOD.class_time;
  const roll = deterministicUnit(schedule?.slot ?? 0);
  let cursor = 0;
  for (const [weather, weight] of weights) {
    cursor += weight;
    if (roll < cursor) return weather;
  }
  return weights[weights.length - 1][0];
}

export function worldEnvironmentAt(schedule) {
  const visual = visualPhaseAtCycleSeconds(schedule?.cycleSeconds ?? 0);
  return Object.freeze({
    phase: visual.id,
    phaseProgress: visual.progress,
    cycleMinute: visual.cycleMinute,
    environmentTime: visual.environmentTime,
    weather: weatherForWorldSchedule(schedule),
    celestial: celestialPoseAtCycleSeconds(schedule?.cycleSeconds ?? 0)
  });
}
