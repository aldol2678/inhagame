const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const SNOW_THAW_MIN_ACCUMULATION = 0.035;

export const SNOW_SLUSH_BUDGET = Object.freeze({
  low: 6,
  medium: 12,
  high: 18
});

export const SNOW_ICE_BUDGET = Object.freeze({
  low: 0,
  medium: 6,
  high: 12
});

export const SNOW_SLUSH_OPACITY = Object.freeze({
  low: 0.22,
  medium: 0.30,
  high: 0.36
});

export const SNOW_ICE_OPACITY = Object.freeze({
  low: 0,
  medium: 0.18,
  high: 0.24
});

const tierValue = (table, tier) =>
  Object.hasOwn(table, tier) ? table[tier] : table.medium;

export const snowSlushBudget = tier => tierValue(SNOW_SLUSH_BUDGET, tier);
export const snowIceBudget = tier => tierValue(SNOW_ICE_BUDGET, tier);

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function snowThawProfile({
  accumulation,
  snowIntensity,
  wetness,
  tier = 'medium'
} = {}) {
  const snow = clamp01(snowIntensity);
  const amount = clamp01(accumulation);
  const wet = clamp01(wetness);

  if (amount <= SNOW_THAW_MIN_ACCUMULATION) {
    return Object.freeze({
      enabled: false,
      thawGate: 0,
      slush: 0,
      ice: 0,
      slushOpacity: 0,
      iceOpacity: 0
    });
  }

  // Fresh snowfall suppresses thaw visuals. Once snowfall fades, the remaining
  // accumulation enters a melt presentation without inventing a temperature system.
  const thawGate = 1 - smoothstep(0.02, 0.18, snow);

  // Slush peaks at medium remaining accumulation and is strengthened by wet roads/rain.
  const slushRise = smoothstep(0.08, 0.34, amount);
  const slushFall = 1 - smoothstep(0.58, 0.88, amount);
  const slush = clamp01(slushRise * slushFall * thawGate * (0.58 + wet * 0.42));

  // Thin ice sheen survives later in the melt. Heavy wetness favors slush over ice.
  const iceRise = smoothstep(0.04, 0.11, amount);
  const iceFall = 1 - smoothstep(0.24, 0.48, amount);
  const ice = clamp01(iceRise * iceFall * thawGate * (0.78 - wet * 0.28));

  return Object.freeze({
    enabled: slush > 0.002 || ice > 0.002,
    thawGate,
    slush,
    ice,
    slushOpacity: slush * tierValue(SNOW_SLUSH_OPACITY, tier),
    iceOpacity: ice * tierValue(SNOW_ICE_OPACITY, tier)
  });
}
