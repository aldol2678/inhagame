export const ENVIRONMENT_WEATHER = Object.freeze({
  CLEAR: 'CLEAR',
  CLOUDY: 'CLOUDY',
  FOG: 'FOG',
  RAIN: 'RAIN',
  SNOW: 'SNOW'
});

export const DEFAULT_ENVIRONMENT_WEATHER = ENVIRONMENT_WEATHER.CLEAR;

const tuple = values => Object.freeze([...values]);
const preset = ({
  fogType,
  fogStart,
  fogEnd,
  fogColorMix,
  fogTint,
  rainIntensity,
  snowIntensity,
  wetness,
  cloudCover,
  sunLightScale,
  ambientLightScale
}) => Object.freeze({
  fogType,
  fogStart,
  fogEnd,
  fogColorMix,
  fogTint: tuple(fogTint),
  rainIntensity,
  snowIntensity,
  wetness,
  cloudCover,
  sunLightScale,
  ambientLightScale
});

export const ENVIRONMENT_WEATHER_PRESETS = Object.freeze({
  [ENVIRONMENT_WEATHER.CLEAR]: preset({
    fogType: 'none',
    fogStart: 650,
    fogEnd: 700,
    fogColorMix: 0,
    fogTint: [0.68, 0.72, 0.76],
    rainIntensity: 0,
    snowIntensity: 0,
    wetness: 0,
    cloudCover: 0.24,
    sunLightScale: 1,
    ambientLightScale: 1
  }),
  [ENVIRONMENT_WEATHER.CLOUDY]: preset({
    fogType: 'none',
    fogStart: 650,
    fogEnd: 700,
    fogColorMix: 0,
    fogTint: [0.63, 0.67, 0.72],
    rainIntensity: 0,
    snowIntensity: 0,
    wetness: 0,
    cloudCover: 0.82,
    sunLightScale: 0.58,
    ambientLightScale: 0.86
  }),
  [ENVIRONMENT_WEATHER.FOG]: preset({
    fogType: 'linear',
    fogStart: 40,
    fogEnd: 155,
    fogColorMix: 0.46,
    fogTint: [0.68, 0.72, 0.76],
    rainIntensity: 0,
    snowIntensity: 0,
    wetness: 0,
    cloudCover: 0.54,
    sunLightScale: 0.72,
    ambientLightScale: 0.92
  }),
  [ENVIRONMENT_WEATHER.RAIN]: preset({
    fogType: 'linear',
    fogStart: 72,
    fogEnd: 220,
    fogColorMix: 0.30,
    fogTint: [0.56, 0.62, 0.68],
    rainIntensity: 1,
    snowIntensity: 0,
    wetness: 1,
    cloudCover: 1,
    sunLightScale: 0.38,
    ambientLightScale: 0.78
  }),
  [ENVIRONMENT_WEATHER.SNOW]: preset({
    fogType: 'linear',
    // Snow keeps the campus readable while adding a pale atmospheric veil.
    fogStart: 85,
    fogEnd: 240,
    fogColorMix: 0.24,
    fogTint: [0.80, 0.84, 0.88],
    rainIntensity: 0,
    snowIntensity: 1,
    wetness: 0,
    cloudCover: 0.96,
    sunLightScale: 0.46,
    ambientLightScale: 0.88
  })
});

export function resolveEnvironmentWeather(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return Object.hasOwn(ENVIRONMENT_WEATHER_PRESETS, key) ? key : DEFAULT_ENVIRONMENT_WEATHER;
}

export function environmentWeatherPreset(value) {
  return ENVIRONMENT_WEATHER_PRESETS[resolveEnvironmentWeather(value)];
}
