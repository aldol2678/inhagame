const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const mix = (a, b, t) => a + (b - a) * t;
const mixTuple = (a, b, t) => a.map((value, index) => mix(value, b[index], t));
const freezeTuple = values => Object.freeze([...values]);

export const ATMOSPHERE_DOME_RADIUS = 640;
export const ATMOSPHERE_SEGMENTS = 24;
export const ATMOSPHERE_ELEVATIONS = Object.freeze([-35, -10, 0, 12, 28, 48, 68]);
export const ATMOSPHERE_SUN_GLOW_SIZE = 82;

const DAY_HORIZON = Object.freeze([0.66, 0.82, 0.94]);
const DAY_ZENITH = Object.freeze([0.12, 0.38, 0.74]);
const NIGHT_HORIZON = Object.freeze([0.055, 0.07, 0.13]);
const NIGHT_ZENITH = Object.freeze([0.01, 0.02, 0.055]);
const OVERCAST_HORIZON = Object.freeze([0.52, 0.57, 0.63]);
const OVERCAST_ZENITH = Object.freeze([0.28, 0.34, 0.43]);
const RAIN_HORIZON = Object.freeze([0.40, 0.45, 0.51]);
const RAIN_ZENITH = Object.freeze([0.22, 0.29, 0.38]);
const SNOW_HORIZON = Object.freeze([0.78, 0.82, 0.87]);
const SNOW_ZENITH = Object.freeze([0.55, 0.63, 0.72]);

export function atmosphereSkyProfile({
  sunColor = [1, 0.94, 0.81],
  artificialLightFactor = 0,
  rainIntensity = 0,
  snowIntensity = 0,
  cloudCover = 0.24,
  sunLightScale = 1
} = {}) {
  const night = clamp01(artificialLightFactor);
  const rain = clamp01(rainIntensity);
  const snow = clamp01(snowIntensity);
  const cover = clamp01(cloudCover);
  const sunScale = clamp01(sunLightScale);

  const nightBlend = Math.pow(night, 0.82);
  let horizon = mixTuple(DAY_HORIZON, NIGHT_HORIZON, nightBlend);
  let zenith = mixTuple(DAY_ZENITH, NIGHT_ZENITH, nightBlend);

  const overcastMix = cover * 0.55;
  horizon = mixTuple(horizon, OVERCAST_HORIZON, overcastMix);
  zenith = mixTuple(zenith, OVERCAST_ZENITH, overcastMix);

  horizon = mixTuple(horizon, RAIN_HORIZON, rain * 0.75);
  zenith = mixTuple(zenith, RAIN_ZENITH, rain * 0.75);
  horizon = mixTuple(horizon, SNOW_HORIZON, snow * 0.65);
  zenith = mixTuple(zenith, SNOW_ZENITH, snow * 0.65);

  // SUNSET sits around artificialLightFactor=0.18. Keep the warmth concentrated
  // near the horizon and suppress it under heavy weather.
  const sunsetPhase = Math.sin(Math.PI * clamp01(night / 0.42));
  const sunsetFactor = clamp01(
    sunsetPhase * (1 - rain * 0.90) * (1 - snow * 0.82) * (1 - cover * 0.58)
  );
  const warm = [
    clamp01((sunColor[0] ?? 1) * 1.05),
    clamp01((sunColor[1] ?? 0.8) * 0.72),
    clamp01((sunColor[2] ?? 0.6) * 0.58)
  ];
  horizon = mixTuple(horizon, warm, sunsetFactor * 0.68);
  zenith = mixTuple(zenith, warm, sunsetFactor * 0.08);

  const sourceVisibility = clamp01((1 - night * 1.08) * sunScale);
  const glowOpacity = clamp01(
    sourceVisibility *
    (0.20 + (1 - cover) * 0.14 + sunsetFactor * 0.16) *
    (1 - rain * 0.45) *
    (1 - snow * 0.30)
  );

  return Object.freeze({
    horizonColor: freezeTuple(horizon.map(clamp01)),
    zenithColor: freezeTuple(zenith.map(clamp01)),
    sunsetFactor,
    hazeStrength: clamp01(0.30 + cover * 0.18 + rain * 0.12 + snow * 0.16 + sunsetFactor * 0.18),
    sunGlowOpacity: glowOpacity
  });
}

export function writeAtmosphereColor(out, offset, profile, elevationDegrees) {
  const raw = clamp01(Math.max(0, Number(elevationDegrees) || 0) / 70);
  const t = raw * raw * (3 - 2 * raw);
  out[offset] = mix(profile.horizonColor[0], profile.zenithColor[0], t);
  out[offset + 1] = mix(profile.horizonColor[1], profile.zenithColor[1], t);
  out[offset + 2] = mix(profile.horizonColor[2], profile.zenithColor[2], t);
  out[offset + 3] = 1;
  return out;
}

export function atmosphereColorAtElevation(profile, elevationDegrees) {
  const out = [0, 0, 0, 1];
  writeAtmosphereColor(out, 0, profile, elevationDegrees);
  return Object.freeze(out);
}
