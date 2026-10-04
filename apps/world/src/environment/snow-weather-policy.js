export const SNOW_FLAKE_BUDGET = Object.freeze({
  low: 36,
  medium: 72,
  high: 120
});

export const SNOW_VOLUME_RADIUS = Object.freeze({
  low: 10,
  medium: 14,
  high: 18
});

export const SNOW_VOLUME_HEIGHT = 16;
export const SNOW_FALL_SPEED = 2.1;
export const SNOW_DRIFT_SPEED = 0.45;

export const SNOW_OPACITY = Object.freeze({
  low: 0.34,
  medium: 0.46,
  high: 0.56
});

export function snowFlakeBudget(tier) {
  return Object.hasOwn(SNOW_FLAKE_BUDGET, tier) ? SNOW_FLAKE_BUDGET[tier] : SNOW_FLAKE_BUDGET.medium;
}

export function snowVolumeRadius(tier) {
  return Object.hasOwn(SNOW_VOLUME_RADIUS, tier) ? SNOW_VOLUME_RADIUS[tier] : SNOW_VOLUME_RADIUS.medium;
}

export function snowOpacity(tier) {
  return Object.hasOwn(SNOW_OPACITY, tier) ? SNOW_OPACITY[tier] : SNOW_OPACITY.medium;
}

function unit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function snowFlakeLayout(tier) {
  const count = snowFlakeBudget(tier);
  const radius = snowVolumeRadius(tier);
  return Array.from({ length: count }, (_, i) => {
    const angle = unit(i + 1) * Math.PI * 2;
    const r = Math.sqrt(unit(i + 101)) * radius;
    return Object.freeze({
      x: Math.cos(angle) * r,
      y: unit(i + 211) * SNOW_VOLUME_HEIGHT,
      z: Math.sin(angle) * r,
      size: 0.06 + unit(i + 307) * 0.09,
      stretch: 0.55 + unit(i + 401) * 0.55,
      twist: unit(i + 503) * Math.PI * 2
    });
  });
}
