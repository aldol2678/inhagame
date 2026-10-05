// Campus projection scale, shared by every feature that speaks in metres (geo-coordinates.js
// projects OSM landmarks at this ratio). Game feel values, not a survey.
export const METERS_PER_WORLD_UNIT = 2;

export const metersToWorld = (meters) => meters / METERS_PER_WORLD_UNIT;
export const worldToMeters = (units) => units * METERS_PER_WORLD_UNIT;
