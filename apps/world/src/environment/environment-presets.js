import { NPC_WORLD_CYCLE_MINUTES } from '../../npc-factory/npc-world-time-contract.mjs';

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

// Approved preset magnitudes, sampled at representative solar-time anchors.
// Sunrise/sunset use NIGHT at the horizon so a below-horizon sun never lights
// the night. Only magnitudes change: existing phase color/art direction stays.
const LIGHTING_ANCHORS = Object.freeze([
  [0, 'NIGHT'], [2, 'DAWN'], [30, 'DAY'], [52, 'GOLDEN_HOUR'],
  [56, 'SUNSET'], [59, 'DUSK'], [60, 'NIGHT'], [NPC_WORLD_CYCLE_MINUTES, 'NIGHT']
].map(([minute, time]) => Object.freeze({ minute, preset: ENVIRONMENT_PRESETS[time] })));

export function environmentLightingAtCycleSeconds(cycleSeconds, out = {}) {
  const seconds = Number.isFinite(cycleSeconds) ? cycleSeconds : 0;
  const duration = NPC_WORLD_CYCLE_MINUTES * 60;
  const minute = ((seconds % duration) + duration) % duration / 60;
  let index = 1;
  while (index < LIGHTING_ANCHORS.length - 1 && minute > LIGHTING_ANCHORS[index].minute) index++;
  const from = LIGHTING_ANCHORS[index - 1];
  const to = LIGHTING_ANCHORS[index];
  const linear = (minute - from.minute) / (to.minute - from.minute);
  // Zero slope at anchors avoids sudden rate changes without overshoot.
  const t = linear * linear * (3 - 2 * linear);
  for (const key of ['sunIntensity', 'exposure', 'shadowIntensity'])
    out[key] = from.preset[key] + (to.preset[key] - from.preset[key]) * t;
  return out;
}
