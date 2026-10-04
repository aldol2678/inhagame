export const WINTER_SOAK_CYCLES = 24;

export const WINTER_SOAK_WEATHER_SEQUENCE = Object.freeze([
  'snow',
  'rain',
  'clear',
  'cloudy'
]);

export const WINTER_SOAK_CONTRACT = Object.freeze({
  entityGrowth: 0,
  meshInstanceGrowth: 0,
  meshIdentityChanges: 0,
  materialIdentityChanges: 0,
  passiveFootprintMeshRebuilds: 0
});
