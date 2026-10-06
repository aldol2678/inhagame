# Remaining rear-gate infill restoration

## Scope and source authority

Public main `3b95e37f3dec477ebe7e06456907176bb81a63a2` was the initial geometry,
collision, navigation and material-ownership baseline. The publication candidate
is integrated onto `995364fa5a403fcd290d1bf7357b78f85692c447`, preserving the
merged landmark, pond/access-road and world-time HUD changes. The old/new visual
comparison continues to pin only the six presentation modules from the initial baseline. The remaining cyan models
are 35 `BACK_ALLEY_BLOCKS` and 79 generic `MARKET_BUILDINGS`; the already detailed
Geonmulju venue is excluded. The user-approved historical reference was inspected
for architectural vocabulary, then the facade/roof geometry was re-authored on the
current public plots. No historical file, image, texture, brand, sign text,
private operational artifact or credential is copied into this candidate.

The alley reference used wider, varied-height plots. Those dimensions are not
restored: the current 4 × 4 body footprint and 6-unit wall height remain, with the
existing 6.3 collider roof allowance. The market's current variable widths,
depths and heights remain unchanged. Neither dataset is a cadastral survey or a
record of real commercial tenancy.

Target locations:

- Alley: Inha west extension 5, 67 entrance 6, 91 entrance 7, rear connector 17
- Market: culture west cross 9, east cross 15, 67 north 8, 67 link 10,
  47 junction 27, Inha east frontage 10

The previous 37 restored shopfronts, 34 west-footprint buildings, 33 inner
residential buildings, Geonmulju venue and existing market dressing retain their
geometry. Digest tests bind those outputs independently from the changed bodies.
Road/background restoration is documented in `backgate-road-restoration.md`.

## Implementation

`backgate-infill-geometry.js` provides three small batching functions used only by
alley and market render owners. The market no longer depends on the cyan generic
fallback in the shared culture helper; that helper is not globally recolored.

- BASE: complete opaque shell, roof cap/parapet, closed storefront glazing and
  door, fascia and height-dependent upper windows
- NEAR: window surrounds, door frames, facade service unit and limited cafe visor
- DETAIL: inset mullions, door handle, service grille and sparse brick courses

All colors reuse existing material profiles and `FacilityMeshBatch`. No new
material manager, textures, update loop, animation, interaction, collision shape,
navmesh or external dependency is added. Body corners remain exact. Roof rims and inner caps
meet the existing collider top (alley +.30, market +.18), preserving the visible
landing plane instead of introducing a lower decorative roof recess. Facade additions project at most .55 units from the wall and tests
prove every emitted vertex leaves the current mapped road corridors clear.

Existing sign planes remain street-side of the opaque fascia. Door frames remain
behind preserved shutter faces; closed-door caps are inset from the ground-glass
caps. These three integration issues were reproduced in regression tests before
being corrected during independent review.

## Measured geometry

| Scope | BASE triangles | NEAR triangles | DETAIL triangles |
| --- | ---: | ---: | ---: |
| 35 alley bodies | 5,880 | 7,980 | 3,996 |
| 79 market bodies | 14,268 | 21,084 | 10,020 |
| Total | 20,148 | 29,064 | 14,016 |

The total is 63,228 triangles across all three tiers. The 982 cyan shell
triangles in these owners become zero. Existing Geonmulju/dressing and road
triangles are not included in this table. Each district's BASE uses ten shared
colors; this is a geometry budget, not a measured frame-rate claim.

## Verification and visual gate

- Red/green tests cover removal of cyan shells, persistent windows/roofs,
  ID-scoped deterministic tiers, exact collision hash, facade/chunk/road bounds,
  material budget, preserved 37/west/interior/dressing/venue geometry and layering
- Pinned PlayCanvas 2.22.4 actual renderer covers all 114 owners through three
  ACTIVE → VISTA → ACTIVE cycles, checks persistent buffers and cloned detail
  ownership, stable material-cache count and mesh-buffer destruction
- The combined camera fixture fits two representative building views and four
  road/gate views in desktop, portrait and landscape, using the production
  reflected campus coordinate frame
- The hosted-only workflow is prepared to compare 40 old/new same-camera frames
  (20 pairs), stationary-frame equality, hide/show visual contribution, desktop building LOD round
  trips, eight legacy-shopfront controller regression routes and eight restored
  crossing/gate controller routes

Local NullGraphicsDevice checks are not pixel evidence. The browser workflow
must run on an approved public draft and the screenshots must be inspected before
visual signoff. It uses only pinned public baseline presentation modules with the
same current layouts, renderer and materials in both variants. It does not claim
all 114 individual facades were screenshot-inspected, physical-device input,
production sky validation, WebGPU coverage or measured GPU performance.

This local implementation does not authorize publication, merge or Production
deployment. Those require separate approval.
