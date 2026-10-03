export const RAIN_STREAK_BUDGET = Object.freeze({
  low: 28,
  medium: 56,
  high: 96
});

export const RAIN_VOLUME_RADIUS = Object.freeze({
  low: 9,
  medium: 12,
  high: 14
});

export const RAIN_VOLUME_HEIGHT = 18;
export const RAIN_FALL_SPEED = 13;

export const RAIN_OPACITY = Object.freeze({
  low: 0.24,
  medium: 0.34,
  high: 0.42
});

export const WET_ROAD_OPACITY = Object.freeze({
  low: 0.07,
  medium: 0.12,
  high: 0.17
});

export function rainStreakBudget(tier) {
  return Object.hasOwn(RAIN_STREAK_BUDGET, tier) ? RAIN_STREAK_BUDGET[tier] : RAIN_STREAK_BUDGET.medium;
}

export function rainVolumeRadius(tier) {
  return Object.hasOwn(RAIN_VOLUME_RADIUS, tier) ? RAIN_VOLUME_RADIUS[tier] : RAIN_VOLUME_RADIUS.medium;
}

export function rainOpacity(tier) {
  return Object.hasOwn(RAIN_OPACITY, tier) ? RAIN_OPACITY[tier] : RAIN_OPACITY.medium;
}

export function wetRoadOpacity(tier) {
  return Object.hasOwn(WET_ROAD_OPACITY, tier) ? WET_ROAD_OPACITY[tier] : WET_ROAD_OPACITY.medium;
}

function unit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function rainStreakLayout(tier) {
  const count = rainStreakBudget(tier);
  const radius = rainVolumeRadius(tier);
  return Array.from({ length: count }, (_, i) => {
    const a = unit(i + 1) * Math.PI * 2;
    const r = Math.sqrt(unit(i + 101)) * radius;
    return Object.freeze({
      x: Math.cos(a) * r,
      y: unit(i + 211) * RAIN_VOLUME_HEIGHT,
      z: Math.sin(a) * r,
      length: 0.75 + unit(i + 307) * 1.15,
      width: 0.015 + unit(i + 401) * 0.018,
      slant: 0.08 + unit(i + 503) * 0.11
    });
  });
}
