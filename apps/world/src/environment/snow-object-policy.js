const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const SNOW_OBJECT_MIN_ACCUMULATION = 0.08;

export const SNOW_OBJECT_OPACITY = Object.freeze({
  low: 0.38,
  medium: 0.50,
  high: 0.58
});

export const SNOW_OBJECT_BENCH_BUDGET = Object.freeze({
  low: 0,
  medium: 6,
  high: 12
});

export const SNOW_OBJECT_LAMP_BUDGET = Object.freeze({
  low: 0,
  medium: 8,
  high: 16
});

export function snowObjectOpacity(tier, accumulation) {
  const amount = clamp01(accumulation);
  if (amount <= SNOW_OBJECT_MIN_ACCUMULATION) return 0;
  const base = Object.hasOwn(SNOW_OBJECT_OPACITY, tier)
    ? SNOW_OBJECT_OPACITY[tier]
    : SNOW_OBJECT_OPACITY.medium;
  const normalized = (amount - SNOW_OBJECT_MIN_ACCUMULATION) /
    (1 - SNOW_OBJECT_MIN_ACCUMULATION);
  return base * Math.pow(clamp01(normalized), 0.78);
}

export function snowObjectBenchBudget(tier) {
  return Object.hasOwn(SNOW_OBJECT_BENCH_BUDGET, tier)
    ? SNOW_OBJECT_BENCH_BUDGET[tier]
    : SNOW_OBJECT_BENCH_BUDGET.medium;
}

export function snowObjectLampBudget(tier) {
  return Object.hasOwn(SNOW_OBJECT_LAMP_BUDGET, tier)
    ? SNOW_OBJECT_LAMP_BUDGET[tier]
    : SNOW_OBJECT_LAMP_BUDGET.medium;
}

export function snowObjectTierPolicy(tier) {
  return Object.freeze({
    benchBudget: snowObjectBenchBudget(tier),
    lampBudget: snowObjectLampBudget(tier)
  });
}
