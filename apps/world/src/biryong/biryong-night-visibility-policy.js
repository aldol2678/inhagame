import { ENVIRONMENT_PRESETS, ENVIRONMENT_TIME } from '../environment/environment-presets.js';

// Read-only reuse of the existing cool DUSK palette. This is a region presentation
// floor, not a new world-time/weather policy, light source, or daytime adjustment.
export const BIRYONG_NIGHT_VISIBILITY = Object.freeze({
  ambientFloor: ENVIRONMENT_PRESETS[ENVIRONMENT_TIME.DUSK].ambientColor,
  exposureFloor: ENVIRONMENT_PRESETS[ENVIRONMENT_TIME.DUSK].exposure,
  start: ENVIRONMENT_PRESETS[ENVIRONMENT_TIME.DUSK].artificialLightFactor
});
export function biryongNightVisibilityWeight(night) {
  const t = Math.min(1, Math.max(0, ((Number(night) || 0) - BIRYONG_NIGHT_VISIBILITY.start) /
    (1 - BIRYONG_NIGHT_VISIBILITY.start)));
  return t * t * (3 - 2 * t);
}
