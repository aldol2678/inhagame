import { NPC_WORLD_CYCLE_MINUTES } from '../../npc-factory/npc-world-time-contract.mjs';

const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const wrapDegrees = value => ((Number(value) % 360) + 360) % 360;
const WORLD_PERIOD_SECONDS = 15 * 60;
const RAIN_MIN_SECONDS = 3 * 60;
const RAIN_MAX_SECONDS = 7 * 60;
const RAIN_CLOUD_LEAD_SECONDS = 60;
const RAIN_CLOUD_TRAIL_SECONDS = 60;

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

// Base weather excludes rain. Rain is a shorter event layered inside each
// authoritative 15-minute world period, so a rainy period is never 15 minutes
// of uninterrupted precipitation.
export const BASE_WEATHER_WEIGHTS_BY_WORLD_PERIOD = Object.freeze({
  morning: Object.freeze([
    ['CLEAR', 0.526], ['CLOUDY', 0.295], ['FOG', 0.179]
  ]),
  class_time: Object.freeze([
    ['CLEAR', 0.625], ['CLOUDY', 0.341], ['FOG', 0.034]
  ]),
  lunch: Object.freeze([
    ['CLEAR', 0.667], ['CLOUDY', 0.311], ['FOG', 0.022]
  ]),
  evening: Object.freeze([
    ['CLEAR', 0.591], ['CLOUDY', 0.386], ['FOG', 0.023]
  ]),
  night: Object.freeze([
    ['CLEAR', 0.488], ['CLOUDY', 0.442], ['FOG', 0.070]
  ])
});

// Event incidence is intentionally higher than the old whole-period RAIN
// probability because each event lasts only 3..7 of the 15 minutes. With an
// average duration of five minutes, expected rain-time remains approximately
// 5% / 12% / 10% / 12% / 14% across the five gameplay periods.
export const RAIN_EVENT_CHANCE_BY_WORLD_PERIOD = Object.freeze({
  morning: 0.15,
  class_time: 0.36,
  lunch: 0.30,
  evening: 0.36,
  night: 0.42
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

function deterministicUnit(slot, salt = 0) {
  let x = ((Number(slot) >>> 0) ^ Math.imul((Number(salt) >>> 0) + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0x100000000;
}

function weightedWeather(weights, roll) {
  let cursor = 0;
  for (const [weather, weight] of weights) {
    cursor += weight;
    if (roll < cursor) return weather;
  }
  return weights[weights.length - 1][0];
}

export function baseWeatherForWorldSchedule(schedule) {
  const weights = BASE_WEATHER_WEIGHTS_BY_WORLD_PERIOD[schedule?.period] ??
    BASE_WEATHER_WEIGHTS_BY_WORLD_PERIOD.class_time;
  return weightedWeather(weights, deterministicUnit(schedule?.slot ?? 0, 11));
}

export function rainEventForWorldSchedule(schedule) {
  const period = String(schedule?.period ?? 'class_time');
  const chance = RAIN_EVENT_CHANCE_BY_WORLD_PERIOD[period] ??
    RAIN_EVENT_CHANCE_BY_WORLD_PERIOD.class_time;
  const slot = schedule?.slot ?? 0;
  const occurs = deterministicUnit(slot, 23) < chance;

  if (!occurs) return Object.freeze({
    occurs: false,
    active: false,
    cloudLeadActive: false,
    cloudTrailActive: false,
    startSeconds: null,
    endSeconds: null,
    durationSeconds: 0
  });

  const durationSeconds = Math.round(
    RAIN_MIN_SECONDS +
    deterministicUnit(slot, 29) * (RAIN_MAX_SECONDS - RAIN_MIN_SECONDS)
  );
  const availableStartSpan = Math.max(
    0,
    WORLD_PERIOD_SECONDS - durationSeconds - RAIN_CLOUD_LEAD_SECONDS - RAIN_CLOUD_TRAIL_SECONDS
  );
  const startSeconds = Math.round(
    RAIN_CLOUD_LEAD_SECONDS + deterministicUnit(slot, 31) * availableStartSpan
  );
  const endSeconds = startSeconds + durationSeconds;
  const offsetSeconds = Math.max(0, Number(schedule?.offsetSeconds) || 0);

  return Object.freeze({
    occurs: true,
    active: offsetSeconds >= startSeconds && offsetSeconds < endSeconds,
    cloudLeadActive:
      offsetSeconds >= Math.max(0, startSeconds - RAIN_CLOUD_LEAD_SECONDS) &&
      offsetSeconds < startSeconds,
    cloudTrailActive:
      offsetSeconds >= endSeconds &&
      offsetSeconds < Math.min(WORLD_PERIOD_SECONDS, endSeconds + RAIN_CLOUD_TRAIL_SECONDS),
    startSeconds,
    endSeconds,
    durationSeconds
  });
}

export function weatherForWorldSchedule(schedule) {
  const baseWeather = baseWeatherForWorldSchedule(schedule);
  const rainEvent = rainEventForWorldSchedule(schedule);
  if (rainEvent.active) return 'RAIN';
  if (rainEvent.cloudLeadActive || rainEvent.cloudTrailActive) return 'CLOUDY';
  return baseWeather;
}

export function worldEnvironmentAt(schedule) {
  const visual = visualPhaseAtCycleSeconds(schedule?.cycleSeconds ?? 0);
  const rainEvent = rainEventForWorldSchedule(schedule);
  const baseWeather = baseWeatherForWorldSchedule(schedule);
  const weather = rainEvent.active
    ? 'RAIN'
    : rainEvent.cloudLeadActive || rainEvent.cloudTrailActive
      ? 'CLOUDY'
      : baseWeather;

  return Object.freeze({
    phase: visual.id,
    phaseProgress: visual.progress,
    cycleMinute: visual.cycleMinute,
    environmentTime: visual.environmentTime,
    weather,
    baseWeather,
    rainEvent,
    celestial: celestialPoseAtCycleSeconds(schedule?.cycleSeconds ?? 0)
  });
}
