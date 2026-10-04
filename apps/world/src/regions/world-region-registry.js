// World-region identity is separate from local x/y/z coordinates.
// Region ids are persistent semantic addresses; render roots and movement spaces may change later.
export const WORLD_REGION_ID = Object.freeze({
  CAMPUS: "CAMPUS",
  BIRYONG_REALM: "BIRYONG_REALM"
});

export const DEFAULT_WORLD_REGION_ID = WORLD_REGION_ID.CAMPUS;

export const WORLD_REGIONS = Object.freeze({
  [WORLD_REGION_ID.CAMPUS]: Object.freeze({
    id: WORLD_REGION_ID.CAMPUS,
    label: "인하대 캠퍼스",
    kind: "CAMPUS"
  }),
  [WORLD_REGION_ID.BIRYONG_REALM]: Object.freeze({
    id: WORLD_REGION_ID.BIRYONG_REALM,
    label: "비룡권",
    kind: "OUTER_REALM"
  })
});

export const isWorldRegionId = value => typeof value === "string" && Object.hasOwn(WORLD_REGIONS, value);

export function normalizeWorldRegionId(value, fallback = DEFAULT_WORLD_REGION_ID) {
  return isWorldRegionId(value) ? value : fallback;
}
