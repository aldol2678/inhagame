# Matching Tree: map-aligned location and paired branch seating

## Scope and source accuracy

This is the bounded, requested extension to the Heidegger grove draft. The grove
geometry remains unchanged. Only the `lmk_matching_tree` point landmark moves;
the original campus lawns, paths, water, buildings, terrain, collision and
navigation graph are preserved.

The [university campus illustration](https://www.inha.ac.kr/sites/kr/files/campusmap_front.jpg)
and [2026 brochure, viewer page 21](https://fliphtml5.com/xrdwz/vepf/21/)
label the Matching Tree in the gate-side lawn beside the reflecting pool, on the
right when entering from the main gate. The old game point was in the separate
Main Hall-side lawn. The new game point is an interior estimate within the
corresponding existing OSM lawn, `site_258995412`:

- Previous: 37.44828, 126.65451
- Candidate: 37.44792, 126.65378
- Change: approximately 75.9 physical metres in this projection

These decimal coordinates are a game placement, not surveyed GPS. The campus
illustration is not georectified, so positional precision and a numerical error
bound cannot be established. No user device-location snapshot was used.

The [May 2024 district campus article](https://blog.naver.com/tong_namgu/223433854717)
has a labelled sign photo and a clear view of the low gray-brown U fork. Those
pixels informed a new procedural silhouette: a short stump, continuous natural
branch surface, irregular upright forks and varied low-poly crowns. Exact height,
species and facing are unverified. The existing campus axis is used for a clear
approach facing the pool; this is a gameplay choice, not a measured bearing.

The [Port Authority article](https://incheonport.tistory.com/4030) corroborates
the landmark but uses an ambiguous viewpoint-dependent right-side description.
The explicitly labelled maps take precedence for compartment alignment.
`apps/world/data/reality/matching-tree-placement.provenance.json` records these
sources, the selected point and limitations. Source photographs are not shipped.

## Runtime ownership and interaction

- `campus-facilities.json` remains the sole geographic point authority
- `matching-tree-layout.js` derives one local frame and branch/seat dimensions
- `matching-tree-geometry.js` draws the same horizontal branch surface that the
  anchors use; it adds no separate bench
- The existing facility BASE owner renders the tree once; LOD transitions do not
  rebuild it or duplicate it in streamed layers
- `seat-anchors.js` appends exactly two seats, 0.54 world units apart, with a
  shared branch top of 0.42 world units and an unobstructed front stand point
- The existing F/shared mobile action, `SeatController`, pose networking, best-
  effort occupancy and movement/camera controllers are reused

Sitting stops locomotion. Explicit stand, keyboard movement, touch movement,
jump, mount and zone changes use the existing safe stand-out path. Account
transport turnover preserves the local controller state and clears the old
remote session; disconnect removes remote occupancy. No database, persistence,
permission, account, character-model or input-controller implementation changes
are made. The tree retains the pre-existing decorative-landmark collision policy;
the new seats do not introduce a blocking collider.

All previous seats and all non-target facility values are regression-hashed.
There was no existing Full Map Matching Tree POI to move; this extension does not
add a new marker or navigation destination.

## Verification and delivery boundary

The initial four feature tests were red before the recovered implementation.
Additional provenance regression exposed the missing source record and an
unsupported 20-metre uncertainty claim; both are corrected. Float comparison of
the shared top uses a numerical tolerance rather than exact binary equality.

The dedicated actual PlayCanvas 2.22.4 null-device probe covers:

- Three reflected/unreflected create/dispose cycles
- One persistent tree owner, three color meshes, 456 triangles, 35,568 geometry
  buffer bytes; no shared-material growth or LOD geometry mutation
- Actual engine triangle support under both seat anchors
- Twelve actual controller cases for the two seats: idle, approach, safe release,
  walk-out, jump and landing
- 288 first-/third-person camera poses across desktop and both mobile aspects

The previous tree used three meshes, 160 triangles and 12,480 bytes; this
extension adds 296 triangles and 23,088 bytes without adding a draw group.

The shared fake-transport integration test covers guest/member paired occupancy,
account turnover and disconnect. It does not call an external account service.
The existing grove, surrounding campus, Main Hall/library and north-landmark
null probes remain part of regression validation.

Commands:

```sh
node --test apps/world/tests/matching-tree*.test.mjs apps/world/tests/social-sit.test.mjs
node apps/world/tests/browser/matching-tree-null-smoke.mjs
node apps/world/tests/browser/heidegger-forest-null-smoke.mjs
bash scripts/public-ci.sh
```

Local browser execution is prohibited by this executor's policy. Null-device
results are not visual or hardware-performance acceptance. Hosted browser files
prepare exact-head offline desktop/portrait/landscape captures and real input
checks; they do not prove a completed run. The extended forest comparison is
explicitly forest-isolated: current Matching Tree geometry, seats and facilities
are identical on both pages, and only the guarded previous-main grove recipe and
its material profile differ. It is not a full previous-main runtime comparison.

Publishing this extension to draft #206 and running hosted verification require
the next approval. Merge, Production deployment and database changes are outside
this local candidate's authorization.
