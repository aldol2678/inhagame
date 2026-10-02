// Shared render-height contract for flat walkable campus surfaces.
// Ordinary player/NPC grounding is y=0. These are presentation-only offsets just above
// the campus lawn surface (y=.018), solely to avoid z-fighting.
//
// Do not use these values for a real curb, stair, platform, terrace or slope. Real elevation
// must be owned by roadviewGroundHeight() (or the area's equivalent) and matching render geometry.
export const FLAT_GROUND_Y = Object.freeze({
  UNDERLAY: .020,
  SURFACE: .022,
  EDGE: .024,
  PAINT: .026,
  DETAIL: .028
});

export const FLAT_GROUND_MAX_Y = .030;
