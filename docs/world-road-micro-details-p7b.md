# P7B campus road micro details

Adds sparse, authored road dressing to the existing campus road batch: asphalt
repair patches, angular cracks, manhole covers, drainage grates and worn edge paint.
These are generated presentation details, not claims about surveyed campus infrastructure.

The plan uses existing OSM road frames and excludes short segments, segment ends,
crosswalks and overlapping roads. All emitted faces pass through the existing
editor-owned main-gate ground clipping. Crosswalk paint, navigation, colliders,
grounding, road centerlines and road widths retain their existing authority.

## Rendering budget

- At most 24 eligible segments are dressed, deterministically at build time.
- Current layout: 24 patches, 22 cracks, 24 worn paint locations, 7 manholes, 11 drains.
- Current layout emits 303 quads / 606 triangles, bounded by 384 quads in the geometry test.
- Two additional color groups join `campus_roads`: asphalt `#555f5d` and metal `#69716e`.
- `FacilityMeshBatch` emits one mesh/entity per color: two additional static meshes,
  entities and opaque render submissions, independent of the number of details.
- Wear reuses existing asphalt `#747d7b`; the road batch has at most nine colors.
- No external textures, network fetches, collision shapes, shadows or update callbacks.
- Faces stay between y=.024 and y=.029, below the shared flat-ground y=.030 maximum.

## Verification

`campus-road-micro-details.test.mjs` checks deterministic placement, bounds,
intersection/crosswalk clearance, upward planar faces, gate ownership and batch budget.
The existing campus-road geometry test still checks building clearance and height.
`material-profile-smoke.mjs` additionally checks the live two color batches, optical
profiles, finite mesh vertices, no collision and no shadow casting. It runs in the
existing World asset optimizer job; no additional CI job is introduced.

## Rollback

Remove the `fillCampusRoadMicroDetails` call and import in `campus-road-geometry.js`
to disable the presentation pass. No persistent player or database state is changed.
