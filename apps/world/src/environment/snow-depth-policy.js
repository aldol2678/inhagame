const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const SNOW_DEPTH_MIN_ACCUMULATION = 0.28;

export const SNOW_EDGE_LIP_BUDGET = Object.freeze({
  low: 28,
  medium: 64,
  high: 96
});

export const SNOW_DRIFT_BUDGET = Object.freeze({
  low: 4,
  medium: 10,
  high: 18
});

export const SNOW_PLOW_TRACE_BUDGET = Object.freeze({
  low: 0,
  medium: 6,
  high: 10
});

export const SNOW_DEPTH_OPACITY = Object.freeze({
  low: 0.28,
  medium: 0.40,
  high: 0.48
});

export const SNOW_PLOW_OPACITY = Object.freeze({
  low: 0,
  medium: 0.46,
  high: 0.56
});

function tierValue(table, tier) {
  return Object.hasOwn(table, tier) ? table[tier] : table.medium;
}

export const snowEdgeLipBudget = tier => tierValue(SNOW_EDGE_LIP_BUDGET, tier);
export const snowDriftBudget = tier => tierValue(SNOW_DRIFT_BUDGET, tier);
export const snowPlowTraceBudget = tier => tierValue(SNOW_PLOW_TRACE_BUDGET, tier);

export function snowDepthOpacity(tier, accumulation) {
  const amount = clamp01(accumulation);
  if (amount <= SNOW_DEPTH_MIN_ACCUMULATION) return 0;
  const normalized = (amount - SNOW_DEPTH_MIN_ACCUMULATION) /
    (1 - SNOW_DEPTH_MIN_ACCUMULATION);
  return tierValue(SNOW_DEPTH_OPACITY, tier) * Math.pow(clamp01(normalized), 0.8);
}

export function snowPlowOpacity(tier, accumulation) {
  const amount = clamp01(accumulation);
  if (amount <= SNOW_DEPTH_MIN_ACCUMULATION) return 0;
  const normalized = (amount - SNOW_DEPTH_MIN_ACCUMULATION) /
    (1 - SNOW_DEPTH_MIN_ACCUMULATION);
  return tierValue(SNOW_PLOW_OPACITY, tier) * Math.pow(clamp01(normalized), 0.9);
}

export function snowDepthTierPolicy(tier) {
  return Object.freeze({
    edgeLipBudget: snowEdgeLipBudget(tier),
    driftBudget: snowDriftBudget(tier),
    plowTraceBudget: snowPlowTraceBudget(tier)
  });
}
