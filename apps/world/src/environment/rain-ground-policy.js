const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const RAIN_SPLASH_GROUPS = Object.freeze({
  low: 1,
  medium: 2,
  high: 3
});

export const RAIN_SPLASH_MARKS = Object.freeze({
  low: 5,
  medium: 8,
  high: 11
});

export const RAIN_SPLASH_RADIUS = Object.freeze({
  low: 5.5,
  medium: 7.5,
  high: 9.5
});

export const RAIN_SPLASH_OPACITY = Object.freeze({
  low: 0.30,
  medium: 0.38,
  high: 0.46
});

export const RAIN_PUDDLE_BUDGET = Object.freeze({
  low: 5,
  medium: 9,
  high: 14
});

export const RAIN_PUDDLE_OPACITY = Object.freeze({
  low: 0.15,
  medium: 0.22,
  high: 0.28
});

export function rainSplashGroups(tier) {
  return Object.hasOwn(RAIN_SPLASH_GROUPS, tier) ? RAIN_SPLASH_GROUPS[tier] : RAIN_SPLASH_GROUPS.medium;
}

export function rainSplashMarks(tier) {
  return Object.hasOwn(RAIN_SPLASH_MARKS, tier) ? RAIN_SPLASH_MARKS[tier] : RAIN_SPLASH_MARKS.medium;
}

export function rainSplashRadius(tier) {
  return Object.hasOwn(RAIN_SPLASH_RADIUS, tier) ? RAIN_SPLASH_RADIUS[tier] : RAIN_SPLASH_RADIUS.medium;
}

export function rainSplashOpacity(tier) {
  return Object.hasOwn(RAIN_SPLASH_OPACITY, tier) ? RAIN_SPLASH_OPACITY[tier] : RAIN_SPLASH_OPACITY.medium;
}

export function rainPuddleBudget(tier) {
  return Object.hasOwn(RAIN_PUDDLE_BUDGET, tier) ? RAIN_PUDDLE_BUDGET[tier] : RAIN_PUDDLE_BUDGET.medium;
}

export function rainPuddleOpacity(tier) {
  return Object.hasOwn(RAIN_PUDDLE_OPACITY, tier) ? RAIN_PUDDLE_OPACITY[tier] : RAIN_PUDDLE_OPACITY.medium;
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(value) {
  return hashString(value) / 0xffffffff;
}

export function rainSplashLayout(tier, groupIndex = 0) {
  const count = rainSplashMarks(tier);
  const radius = rainSplashRadius(tier);
  const group = Math.max(0, Math.floor(groupIndex) || 0);
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const key = `${tier}:${group}:${index}`;
    const angle = unit(`${key}:a`) * Math.PI * 2;
    const r = (0.18 + Math.sqrt(unit(`${key}:r`)) * 0.82) * radius;
    return Object.freeze({
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      radius: 0.07 + unit(`${key}:size`) * 0.09,
      squash: 0.72 + unit(`${key}:squash`) * 0.28
    });
  }));
}

function normalizeSegment(segment, index) {
  const length = Math.max(0, Number(segment?.length ?? segment?.frame?.length) || 0);
  const width = Math.max(0.5, Number(segment?.width ?? segment?.road?.width) || 3);
  const at = segment?.at ?? segment?.frame?.at;
  if (length <= 0 || typeof at !== 'function') return null;
  return {
    id: String(segment?.id ?? `segment-${index}`),
    length,
    width,
    y: Number(segment?.y) || 0,
    at
  };
}

export function rainPuddleLayout(segments, tier = 'medium') {
  const budget = rainPuddleBudget(tier);
  const normalized = (segments ?? [])
    .map(normalizeSegment)
    .filter(Boolean)
    .map(segment => ({ segment, score: unit(`${segment.id}:score`) }))
    .sort((a, b) => a.score - b.score || a.segment.id.localeCompare(b.segment.id));

  const puddles = [];
  for (const { segment } of normalized) {
    if (puddles.length >= budget) break;
    const key = `${tier}:${segment.id}`;
    const u = segment.length * (0.18 + unit(`${key}:u`) * 0.64);
    const half = Math.max(0.25, segment.width / 2 - 0.18);
    const side = unit(`${key}:side`) < 0.5 ? -1 : 1;
    const lateral = side * half * (0.30 + unit(`${key}:v`) * 0.45);

    const center = segment.at(u, lateral);
    const a = segment.at(Math.max(0, u - 0.25), lateral);
    const b = segment.at(Math.min(segment.length, u + 0.25), lateral);
    const dx = b.x - a.x, dz = b.z - a.z;
    const tangentLength = Math.hypot(dx, dz) || 1;

    const radiusLong = 0.42 + unit(`${key}:long`) * 0.58;
    const radiusShort = radiusLong * (0.42 + unit(`${key}:short`) * 0.28);
    puddles.push(Object.freeze({
      id: segment.id,
      x: center.x,
      y: segment.y,
      z: center.z,
      tx: dx / tangentLength,
      tz: dz / tangentLength,
      radiusLong,
      radiusShort,
      rotationJitter: (unit(`${key}:rot`) - 0.5) * 0.55
    }));
  }

  return Object.freeze(puddles);
}

export function rainGroundVisibility(rainIntensity, wetness) {
  const rain = clamp01(rainIntensity);
  const wet = clamp01(wetness);
  return Object.freeze({
    splash: rain,
    puddle: Math.pow(wet, 0.86)
  });
}
