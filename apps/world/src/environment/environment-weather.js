export const ENVIRONMENT_WEATHER = Object.freeze({
  CLEAR: 'CLEAR',
  FOG: 'FOG'
});

export const DEFAULT_ENVIRONMENT_WEATHER = ENVIRONMENT_WEATHER.CLEAR;

const tuple = values => Object.freeze([...values]);
const preset = ({ fogType, fogStart, fogEnd, fogColorMix, fogTint }) => Object.freeze({
  fogType,
  fogStart,
  fogEnd,
  fogColorMix,
  fogTint: tuple(fogTint)
});

export const ENVIRONMENT_WEATHER_PRESETS = Object.freeze({
  [ENVIRONMENT_WEATHER.CLEAR]: preset({
    fogType: 'none',
    // Keep a canonical off-frame for smooth exits without changing view-distance ownership.
    fogStart: 650,
    fogEnd: 700,
    fogColorMix: 0,
    fogTint: [0.68, 0.72, 0.76]
  }),
  [ENVIRONMENT_WEATHER.FOG]: preset({
    fogType: 'linear',
    // Calibrated around the NORMAL streaming envelope: nearby campus stays readable
    // while distant geometry fades before the default load boundary.
    fogStart: 40,
    fogEnd: 155,
    fogColorMix: 0.46,
    fogTint: [0.68, 0.72, 0.76]
  })
});

export function resolveEnvironmentWeather(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return Object.hasOwn(ENVIRONMENT_WEATHER_PRESETS, key) ? key : DEFAULT_ENVIRONMENT_WEATHER;
}

export function environmentWeatherPreset(value) {
  return ENVIRONMENT_WEATHER_PRESETS[resolveEnvironmentWeather(value)];
}
