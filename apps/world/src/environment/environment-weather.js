export const ENVIRONMENT_WEATHER = Object.freeze({
  CLEAR: 'CLEAR',
  FOG: 'FOG',
  RAIN: 'RAIN'
});

export const DEFAULT_ENVIRONMENT_WEATHER = ENVIRONMENT_WEATHER.CLEAR;

const tuple = values => Object.freeze([...values]);
const preset = ({ fogType, fogStart, fogEnd, fogColorMix, fogTint, rainIntensity, wetness }) => Object.freeze({
  fogType,
  fogStart,
  fogEnd,
  fogColorMix,
  fogTint: tuple(fogTint),
  rainIntensity,
  wetness
});

export const ENVIRONMENT_WEATHER_PRESETS = Object.freeze({
  [ENVIRONMENT_WEATHER.CLEAR]: preset({
    fogType: 'none',
    fogStart: 650,
    fogEnd: 700,
    fogColorMix: 0,
    fogTint: [0.68, 0.72, 0.76],
    rainIntensity: 0,
    wetness: 0
  }),
  [ENVIRONMENT_WEATHER.FOG]: preset({
    fogType: 'linear',
    fogStart: 40,
    fogEnd: 155,
    fogColorMix: 0.46,
    fogTint: [0.68, 0.72, 0.76],
    rainIntensity: 0,
    wetness: 0
  }),
  [ENVIRONMENT_WEATHER.RAIN]: preset({
    fogType: 'linear',
    // Rain haze stays lighter than dedicated fog so traversal landmarks remain readable.
    fogStart: 72,
    fogEnd: 220,
    fogColorMix: 0.30,
    fogTint: [0.56, 0.62, 0.68],
    rainIntensity: 1,
    wetness: 1
  })
});

export function resolveEnvironmentWeather(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return Object.hasOwn(ENVIRONMENT_WEATHER_PRESETS, key) ? key : DEFAULT_ENVIRONMENT_WEATHER;
}

export function environmentWeatherPreset(value) {
  return ENVIRONMENT_WEATHER_PRESETS[resolveEnvironmentWeather(value)];
}
