const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const MELTWATER_MIN_ACCUMULATION = 0.045;

export const MELTWATER_EAVE_BUDGET = Object.freeze({
  low: 8,
  medium: 16,
  high: 24
});

export const MELTWATER_RUNOFF_BUDGET = Object.freeze({
  low: 4,
  medium: 8,
  high: 12
});

export const MELTWATER_DRAIN_BUDGET = Object.freeze({
  low: 0,
  medium: 4,
  high: 8
});

export const MELTWATER_DRIP_OPACITY = Object.freeze({
  low: 0.20,
  medium: 0.28,
  high: 0.34
});

export const MELTWATER_RUNOFF_OPACITY = Object.freeze({
  low: 0.18,
  medium: 0.26,
  high: 0.32
});

const tierValue = (table, tier) =>
  Object.hasOwn(table, tier) ? table[tier] : table.medium;

export const meltwaterEaveBudget = tier => tierValue(MELTWATER_EAVE_BUDGET, tier);
export const meltwaterRunoffBudget = tier => tierValue(MELTWATER_RUNOFF_BUDGET, tier);
export const meltwaterDrainBudget = tier => tierValue(MELTWATER_DRAIN_BUDGET, tier);

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function meltwaterProfile({
  accumulation,
  snowIntensity,
  wetness,
  tier = 'medium'
} = {}) {
  const amount = clamp01(accumulation);
  const snow = clamp01(snowIntensity);
  const wet = clamp01(wetness);

  if (amount <= MELTWATER_MIN_ACCUMULATION) {
    return Object.freeze({
      enabled: false,
      thawGate: 0,
      drip: 0,
      runoff: 0,
      dripOpacity: 0,
      runoffOpacity: 0
    });
  }

  const thawGate = 1 - smoothstep(0.02, 0.18, snow);
  const remainingSnow = smoothstep(MELTWATER_MIN_ACCUMULATION, 0.28, amount);
  const meltSource = clamp01(Math.pow(amount, 0.58) * thawGate);
  const drip = clamp01(meltSource * (0.52 + wet * 0.48));
  const runoff = clamp01(meltSource * remainingSnow * (0.34 + wet * 0.66));

  return Object.freeze({
    enabled: drip > 0.002 || runoff > 0.002,
    thawGate,
    drip,
    runoff,
    dripOpacity: drip * tierValue(MELTWATER_DRIP_OPACITY, tier),
    runoffOpacity: runoff * tierValue(MELTWATER_RUNOFF_OPACITY, tier)
  });
}
