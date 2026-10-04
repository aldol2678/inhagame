const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const mix = (a, b, t) => a + (b - a) * t;
const mixTuple = (a, b, t) => a.map((value, index) => mix(value, b[index], t));

export const BIRYONG_ATMOSPHERE_PROFILE_VERSION = "biryong.visual.atmosphere.p0d.v1";

export const BIRYONG_ATMOSPHERE_TIERS = Object.freeze({
  low: Object.freeze({
    hazeStart: 120,
    hazeEnd: 285,
    tintMix: 0.10,
    clearMix: 0.025,
    saturation: 1.02,
    contrast: 1.008,
    brightness: 1.00,
    cinematicToneMapping: false
  }),
  medium: Object.freeze({
    hazeStart: 92,
    hazeEnd: 238,
    tintMix: 0.16,
    clearMix: 0.045,
    saturation: 1.04,
    contrast: 1.016,
    brightness: 1.00,
    cinematicToneMapping: true
  }),
  high: Object.freeze({
    hazeStart: 76,
    hazeEnd: 210,
    tintMix: 0.21,
    clearMix: 0.062,
    saturation: 1.055,
    contrast: 1.024,
    brightness: 1.005,
    cinematicToneMapping: true
  })
});

const TIME_TINT = Object.freeze({
  DAY: Object.freeze([0.57, 0.70, 0.72]),
  SUNSET: Object.freeze([0.62, 0.47, 0.55]),
  NIGHT: Object.freeze([0.10, 0.15, 0.25])
});

function tuple3(value, fallback) {
  return [0, 1, 2].map(index => Number.isFinite(value?.[index]) ? value[index] : fallback[index]);
}

function weatherTintWeight(weather) {
  if (weather === "FOG") return 0.35;
  if (weather === "RAIN") return 0.45;
  if (weather === "SNOW") return 0.32;
  return 1;
}

export function biryongAtmosphereProfile(base = {}, tier = "medium") {
  const resolvedTier = Object.hasOwn(BIRYONG_ATMOSPHERE_TIERS, tier) ? tier : "medium";
  const quality = BIRYONG_ATMOSPHERE_TIERS[resolvedTier];
  const time = Object.hasOwn(TIME_TINT, base.targetTime) ? base.targetTime : "DAY";
  const tint = TIME_TINT[time];
  const weather = String(base.targetWeather ?? "CLEAR").toUpperCase();
  const weatherWeight = weatherTintWeight(weather);

  const baseFogStart = Number.isFinite(base.fogStart) ? base.fogStart : 650;
  const baseFogEnd = Number.isFinite(base.fogEnd) ? base.fogEnd : 700;
  const hasWeatherFog = base.fogType === "linear";

  const fogStart = hasWeatherFog ? Math.min(baseFogStart, quality.hazeStart) : quality.hazeStart;
  const fogEndCandidate = hasWeatherFog ? Math.min(baseFogEnd, quality.hazeEnd) : quality.hazeEnd;
  const fogEnd = Math.max(fogStart + 24, fogEndCandidate);

  const clearColor = tuple3(base.clearColor, [0.52, 0.71, 0.84]);
  const fogColor = tuple3(base.fogColor, clearColor);
  const tintMix = quality.tintMix * weatherWeight;
  const clearMix = quality.clearMix * weatherWeight;

  const night = clamp01(base.artificialLightFactor);
  const gradeBrightness = quality.brightness * (1 - night * 0.012);

  return Object.freeze({
    version: BIRYONG_ATMOSPHERE_PROFILE_VERSION,
    tier: resolvedTier,
    targetTime: time,
    targetWeather: weather,
    fogType: "linear",
    fogStart,
    fogEnd,
    fogColor: Object.freeze(mixTuple(fogColor, tint, tintMix).map(clamp01)),
    clearColor: Object.freeze(mixTuple(clearColor, tint, clearMix).map(clamp01)),
    toneMapping: quality.cinematicToneMapping ? "cinematic" : "neutral",
    canvasFilter: `saturate(${quality.saturation}) contrast(${quality.contrast}) brightness(${gradeBrightness.toFixed(3)})`,
    screenSpaceBloom: false,
    bloomReason: "No WebGPU-safe post-effect chain is present in the current World renderer; keep bloom out of P0-D rather than add a second render path."
  });
}
