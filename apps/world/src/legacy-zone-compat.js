// Transitional adapters ONLY: old tour callers and the deployed telemetry enum.
// The legacy rectangles are archival QA fixtures, never a second live resolver.
export const LEGACY_PLACE_DEFAULTS = Object.freeze({
  C01_GATE:'AREA_MAIN_GATE', C02_MAIN_HALL:'AREA_MAIN_HALL', C03_CENTRAL:'AREA_INKYUNG_STUDENT_CENTER'
});
export function placeIdForTour(id) { return LEGACY_PLACE_DEFAULTS[id] ?? id; }
export function legacyTelemetryTarget(place) { return place?.legacyZoneId ?? null; }
