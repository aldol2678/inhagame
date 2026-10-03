const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const mix = (a, b, t) => a + (b - a) * t;
const mixTuple = (a, b, t) => a.map((value, index) => mix(value, b[index], t));

export const POND_WATER_BASE = Object.freeze({
  diffuse: Object.freeze([0.35, 0.43, 0.37]),
  specular: Object.freeze([0.45, 0.50, 0.45]),
  gloss: 0.78,
  reflectivity: 0.60,
  bumpiness: 0.45,
  rippleSpeed: 0.025
});

export const POND_WATER_RAIN = Object.freeze({
  diffuse: Object.freeze([0.24, 0.31, 0.33]),
  specular: Object.freeze([0.68, 0.73, 0.76]),
  gloss: 0.90,
  reflectivity: 0.72,
  bumpiness: 0.76,
  rippleSpeed: 0.052
});

export const POND_WATER_NIGHT = Object.freeze({
  diffuseScale: 0.56,
  blueLift: 0.035,
  reflectivityLift: 0.07,
  glossLift: 0.035
});

export function pondWeatherProfile(rainIntensity = 0, artificialLightFactor = 0) {
  const rain = clamp01(rainIntensity);
  const night = clamp01(artificialLightFactor);
  const diffuse = mixTuple(POND_WATER_BASE.diffuse, POND_WATER_RAIN.diffuse, rain)
    .map((value, index) => {
      const scaled = value * mix(1, POND_WATER_NIGHT.diffuseScale, night);
      return index === 2 ? scaled + POND_WATER_NIGHT.blueLift * night : scaled;
    });
  const specular = mixTuple(POND_WATER_BASE.specular, POND_WATER_RAIN.specular, rain);

  return Object.freeze({
    rainIntensity: rain,
    nightFactor: night,
    diffuse: Object.freeze(diffuse),
    specular: Object.freeze(specular),
    gloss: Math.min(1, mix(POND_WATER_BASE.gloss, POND_WATER_RAIN.gloss, rain) + POND_WATER_NIGHT.glossLift * night),
    reflectivity: Math.min(1, mix(POND_WATER_BASE.reflectivity, POND_WATER_RAIN.reflectivity, rain) + POND_WATER_NIGHT.reflectivityLift * night),
    bumpiness: mix(POND_WATER_BASE.bumpiness, POND_WATER_RAIN.bumpiness, rain),
    rippleSpeed: mix(POND_WATER_BASE.rippleSpeed, POND_WATER_RAIN.rippleSpeed, rain)
  });
}
