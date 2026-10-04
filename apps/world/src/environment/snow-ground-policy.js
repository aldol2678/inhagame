const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const SNOW_ACCUMULATION_RATE = 0.15;
export const SNOW_MELT_RATE = 0.018;

export const SNOW_GROUND_LAWN_OPACITY = Object.freeze({
  low: 0.48,
  medium: 0.58,
  high: 0.66
});

export const SNOW_GROUND_ROAD_OPACITY = Object.freeze({
  low: 0,
  medium: 0.26,
  high: 0.34
});

export const SNOW_GROUND_DRAW_BUDGET = Object.freeze({
  low: 1,
  medium: 2,
  high: 2
});

export function snowGroundLawnOpacity(tier) {
  return Object.hasOwn(SNOW_GROUND_LAWN_OPACITY, tier)
    ? SNOW_GROUND_LAWN_OPACITY[tier]
    : SNOW_GROUND_LAWN_OPACITY.medium;
}

export function snowGroundRoadOpacity(tier) {
  return Object.hasOwn(SNOW_GROUND_ROAD_OPACITY, tier)
    ? SNOW_GROUND_ROAD_OPACITY[tier]
    : SNOW_GROUND_ROAD_OPACITY.medium;
}

export function snowGroundDrawBudget(tier) {
  return Object.hasOwn(SNOW_GROUND_DRAW_BUDGET, tier)
    ? SNOW_GROUND_DRAW_BUDGET[tier]
    : SNOW_GROUND_DRAW_BUDGET.medium;
}

export function stepSnowAccumulation(current, snowIntensity, dt) {
  const accumulation = clamp01(current);
  const snow = clamp01(snowIntensity);
  const seconds = Math.max(0, Number.isFinite(dt) ? dt : 0);
  if (seconds === 0) return accumulation;

  if (snow > 0.01)
    return clamp01(accumulation + seconds * SNOW_ACCUMULATION_RATE * snow);

  return clamp01(accumulation - seconds * SNOW_MELT_RATE);
}

export function snowGroundVisibility(accumulation, tier = 'medium') {
  const amount = clamp01(accumulation);
  const lawn = Math.pow(amount, 0.82) * snowGroundLawnOpacity(tier);
  const road = Math.pow(amount, 1.12) * snowGroundRoadOpacity(tier);
  return Object.freeze({
    accumulation: amount,
    lawn,
    road,
    roadEnabled: snowGroundRoadOpacity(tier) > 0
  });
}
