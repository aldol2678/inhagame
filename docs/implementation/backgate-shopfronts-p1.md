# Backgate shopfront presentation P1

## Bounded scope and source authority

The change dresses exactly 10 `BACK_STREET_BLOCKS` and 27 `CULTURE_BUILDINGS`
from public main `d9cbd3948e4e5acf359313824387dc8695c3e672`. Their current
synthetic gameplay envelopes, height and OSM road anchors remain authoritative.
These dimensions are not a survey of individual real buildings. All layout,
collision, navigation and source-data files remain unchanged.

The isolated working base was subsequently fast-forwarded to
`cd40b910ed0bf03e48b6da37fcee38b519db1bbc`, preserving the student-center,
Life Skill Book, NPC dialogue and TML integrations. The facade-only comparison still uses
the pinned `d9cbd39` modules; the 37 target layouts are identical at both bases.

The 34 existing west-side OSM buildings and the restored 35 alley envelopes,
library garden and stadium are outside this change. The 80 back-market buildings
reuse culture helpers; their generated geometry is preserved by a baseline digest
test. The culture canopy and its public street title are unchanged.

The procedural facades are newly authored without reference photos, private
historical code, street-view images, logos, shop identities, or new binary assets.
Existing OpenStreetMap attribution in `NOTICE.md` continues to apply to road
facts. Wall colors, window rows and blank signboards are neutral presentation
choices, not evidence of real-world floor counts or commercial tenants.

## Rendering contract

- BASE retains every opaque shell and the exact existing roof height. Closed
  glazing, illustrative upper windows, a vertical parapet band and blank fascia
  remain visible independently of detail residency
- NEAR adds shallow frames/piers and DETAIL adds mullions/door handles/reveals
- All facade dressing remains within the building width and height, extending
  at most 0.13 game units toward its frontage. Vertex tests prove it does not
  enter the existing mapped road corridors. No new awning, street prop,
  interaction, enterable interior or physics authority is introduced
- The terminal front is derived from its polygon at local `v=1`, not assumed
  to be `v=0`. Wall winding is outward; roofs remain upward-facing
- Four wall tones and three facade rhythms are deterministic by stable ID
- Existing `FacilityMeshBatch`, shared surface cache and chunk fade clones own
  resources. No new material/texture lifetime manager or engine dependency

Facades alone use 4,858 BASE, 9,384 NEAR and 2,964 DETAIL triangles across all
37 buildings. BASE has 11 shared colors per district; NEAR 2 and DETAIL 3.
The unchanged road paving and canopy add their existing batches. These are
geometry counts, not measured FPS/GPU-performance claims.

## Verification and release boundary

Local commands:

```sh
node --test apps/world/tests/backgate-shopfronts.test.mjs apps/world/tests/back-street.test.mjs apps/world/tests/culture-street.test.mjs apps/world/tests/flat-ground-render-alignment.test.mjs
bash scripts/public-ci.sh
node apps/world/tests/browser/backgate-shopfront-null-smoke.mjs
```

The null-device test uses pinned PlayCanvas and the actual CampusChunkRenderer
for all target owners, ACTIVE/VISTA/ACTIVE transitions, repeated material-cache
use and teardown. It is not pixel evidence. The road-only ground-height test now
calls an explicit paving fill: facades also emit quads and must not be mistaken
for walkable ground just because of their primitive type.

Browser access to the local dev URL was denied with `net::ERR_BLOCKED_BY_CLIENT`.
No alternate browser route is used. A separately approved hosted workflow must
compare baseline/current same-camera frames, inspect stationary-frame stability,
and verify actual controller paths before visual release signoff. Its baseline
control replaces only the three changed legacy facade/sign modules; all other
current code remains the same. The screenshots are diagnostic actual-campus
views, not photographic reconstruction or physical-device gesture evidence.

Publication, PR creation, merge and Production deployment require their own
approval. This local candidate does not authorize any of those actions.
