export const ENVIRONMENT_TIME = Object.freeze({
  DAY: 'DAY',
  SUNSET: 'SUNSET',
  NIGHT: 'NIGHT'
});

export const DEFAULT_ENVIRONMENT_TIME = ENVIRONMENT_TIME.DAY;

const tuple = values => Object.freeze([...values]);
const preset = ({ sunColor, sunIntensity, sunEuler, ambientColor, exposure, clearColor, shadowIntensity, artificialLightFactor }) => Object.freeze({
  sunColor: tuple(sunColor),
  sunIntensity,
  sunEuler: tuple(sunEuler),
  ambientColor: tuple(ambientColor),
  exposure,
  clearColor: tuple(clearColor),
  shadowIntensity,
  artificialLightFactor
});

export const ENVIRONMENT_PRESETS = Object.freeze({
  [ENVIRONMENT_TIME.DAY]: preset({
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    sunEuler: [55, 30, 0],
    ambientColor: [0.48, 0.54, 0.61],
    exposure: 1.05,
    clearColor: [0.52, 0.71, 0.84],
    shadowIntensity: 0.48,
    artificialLightFactor: 0
  }),
  [ENVIRONMENT_TIME.SUNSET]: preset({
    sunColor: [1, 0.58, 0.34],
    sunIntensity: 0.92,
    sunEuler: [18, 35, 0],
    ambientColor: [0.38, 0.31, 0.37],
    exposure: 0.96,
    clearColor: [0.74, 0.41, 0.30],
    shadowIntensity: 0.50,
    artificialLightFactor: 0.18
  }),
  [ENVIRONMENT_TIME.NIGHT]: preset({
    sunColor: [0.38, 0.46, 0.68],
    sunIntensity: 0.35,
    sunEuler: [125, -25, 0],
    ambientColor: [0.10, 0.14, 0.24],
    exposure: 0.82,
    clearColor: [0.04, 0.07, 0.14],
    shadowIntensity: 0.32,
    artificialLightFactor: 1
  })
});

export function resolveEnvironmentTime(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return Object.hasOwn(ENVIRONMENT_PRESETS, key) ? key : DEFAULT_ENVIRONMENT_TIME;
}

export function environmentPreset(value) {
  return ENVIRONMENT_PRESETS[resolveEnvironmentTime(value)];
}
