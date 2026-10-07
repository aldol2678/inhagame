export const ENVIRONMENT_TIME = Object.freeze({
  DAWN: 'DAWN',
  DAY: 'DAY',
  GOLDEN_HOUR: 'GOLDEN_HOUR',
  SUNSET: 'SUNSET',
  DUSK: 'DUSK',
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
  [ENVIRONMENT_TIME.DAWN]: preset({
    sunColor: [1, 0.70, 0.46],
    sunIntensity: 0.66,
    sunEuler: [88, 92, 0],
    ambientColor: [0.30, 0.34, 0.45],
    exposure: 0.92,
    clearColor: [0.35, 0.48, 0.66],
    shadowIntensity: 0.30,
    artificialLightFactor: 0.34
  }),
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
  [ENVIRONMENT_TIME.GOLDEN_HOUR]: preset({
    sunColor: [1, 0.76, 0.50],
    sunIntensity: 1.02,
    sunEuler: [76, 238, 0],
    ambientColor: [0.47, 0.43, 0.44],
    exposure: 1.00,
    clearColor: [0.68, 0.55, 0.50],
    shadowIntensity: 0.50,
    artificialLightFactor: 0.08
  }),
  [ENVIRONMENT_TIME.SUNSET]: preset({
    sunColor: [1, 0.58, 0.34],
    sunIntensity: 0.82,
    sunEuler: [84, 258, 0],
    ambientColor: [0.38, 0.31, 0.37],
    exposure: 0.94,
    clearColor: [0.74, 0.41, 0.30],
    shadowIntensity: 0.46,
    artificialLightFactor: 0.22
  }),
  [ENVIRONMENT_TIME.DUSK]: preset({
    sunColor: [0.76, 0.52, 0.48],
    sunIntensity: 0.28,
    sunEuler: [94, 270, 0],
    ambientColor: [0.20, 0.20, 0.30],
    exposure: 0.86,
    clearColor: [0.18, 0.20, 0.34],
    shadowIntensity: 0.20,
    artificialLightFactor: 0.66
  }),
  [ENVIRONMENT_TIME.NIGHT]: preset({
    // Visual moon is handled by sky-visuals; it never becomes a directional light.
    sunColor: [0.24, 0.31, 0.52],
    sunIntensity: 0,
    sunEuler: [125, -25, 0],
    ambientColor: [0.075, 0.095, 0.16],
    exposure: 0.78,
    clearColor: [0.015, 0.025, 0.06],
    shadowIntensity: 0,
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
