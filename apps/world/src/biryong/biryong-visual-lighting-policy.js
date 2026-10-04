const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const BIRYONG_VISUAL_LIGHTING_PROFILE_VERSION = "biryong.visual.p0a.v1";

export const BIRYONG_VISUAL_LIGHTING_TIERS = Object.freeze({
  low: Object.freeze({
    sunGain: 0.025,
    ambientLift: 0.018,
    shadowBoost: 0.035,
    exposureBoost: 0.008,
    pitchOffset: -1.5,
    yawOffset: 4
  }),
  medium: Object.freeze({
    sunGain: 0.060,
    ambientLift: 0.042,
    shadowBoost: 0.075,
    exposureBoost: 0.020,
    pitchOffset: -3.5,
    yawOffset: 8
  }),
  high: Object.freeze({
    sunGain: 0.085,
    ambientLift: 0.060,
    shadowBoost: 0.105,
    exposureBoost: 0.030,
    pitchOffset: -4.5,
    yawOffset: 10
  })
});

function tuple3(value, fallback) {
  return [0, 1, 2].map(index => Number.isFinite(value?.[index]) ? value[index] : fallback[index]);
}

export function biryongVisualLightingProfile(base = {}, tier = "medium") {
  const quality = Object.hasOwn(BIRYONG_VISUAL_LIGHTING_TIERS, tier)
    ? BIRYONG_VISUAL_LIGHTING_TIERS[tier]
    : BIRYONG_VISUAL_LIGHTING_TIERS.medium;
  const resolvedTier = Object.hasOwn(BIRYONG_VISUAL_LIGHTING_TIERS, tier) ? tier : "medium";

  const night = clamp01(base.artificialLightFactor);
  const daylight = 1 - night;
  const dayWeight = 0.35 + daylight * 0.65;
  const sunLightScale = clamp01(Number.isFinite(base.sunLightScale) ? base.sunLightScale : 1);
  const ambientLightScale = clamp01(Number.isFinite(base.ambientLightScale) ? base.ambientLightScale : 1);

  const ambientBase = tuple3(base.ambientColor, [0.48, 0.54, 0.61])
    .map(value => clamp01(value * ambientLightScale));
  const ambientColor = Object.freeze([
    clamp01(ambientBase[0] * (1 + quality.ambientLift * 0.45 * dayWeight)),
    clamp01(ambientBase[1] * (1 + quality.ambientLift * 0.92 * dayWeight)),
    clamp01(ambientBase[2] * (1 + quality.ambientLift * 1.18 * dayWeight))
  ]);

  const sunColor = Object.freeze(tuple3(base.sunColor, [1, 0.94, 0.81]).map(clamp01));
  const sunIntensity = Math.max(0, Number(base.sunIntensity) || 0) * sunLightScale *
    (1 + quality.sunGain * daylight);
  const shadowIntensity = clamp01((Number(base.shadowIntensity) || 0) + quality.shadowBoost * dayWeight);
  const exposure = Math.max(0, (Number(base.exposure) || 0) + quality.exposureBoost * daylight);

  const sourceEuler = tuple3(base.sunEuler, [55, 30, 0]);
  const sunEuler = Object.freeze([
    clamp(sourceEuler[0] + quality.pitchOffset * daylight, 12, 82),
    sourceEuler[1] + quality.yawOffset * daylight,
    sourceEuler[2]
  ]);

  return Object.freeze({
    version: BIRYONG_VISUAL_LIGHTING_PROFILE_VERSION,
    tier: resolvedTier,
    daylight,
    ambientColor,
    exposure,
    sunColor,
    sunIntensity,
    shadowIntensity,
    sunEuler
  });
}
