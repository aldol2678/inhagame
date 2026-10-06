const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const NIGHT_STAR_BUDGET = Object.freeze({
  low: 72,
  medium: 132,
  high: 216
});

export const NIGHT_STAR_RADIUS = 610;

export function nightStarBudget(tier) {
  return Object.hasOwn(NIGHT_STAR_BUDGET, tier) ? NIGHT_STAR_BUDGET[tier] : NIGHT_STAR_BUDGET.medium;
}

function unit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function nightStarLayout(tier = 'medium') {
  const count = nightStarBudget(tier);
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const y = 0.08 + unit(index + 101) * 0.90;
    const theta = unit(index + 307) * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    return Object.freeze({
      x: Math.cos(theta) * horizontal,
      y,
      z: Math.sin(theta) * horizontal,
      size: 0.34 + unit(index + 503) * 0.58
    });
  }));
}

export function nightStarVisibility({
  artificialLightFactor = 0,
  cloudCover = 0,
  rainIntensity = 0,
  snowIntensity = 0
} = {}) {
  const night = clamp01((clamp01(artificialLightFactor) - 0.30) / 0.70);
  if (night <= 0) return 0;
  const cover = clamp01(cloudCover);
  const rain = clamp01(rainIntensity);
  const snow = clamp01(snowIntensity);
  return clamp01(
    Math.pow(night, 1.35) *
    (1 - cover * 0.72) *
    (1 - rain * 0.90) *
    (1 - snow * 0.68)
  );
}
