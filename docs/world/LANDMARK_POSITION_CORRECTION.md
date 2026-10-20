# Landmark position correction · 2026-09-26

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Reference: two satellite screenshots supplied by the user in this task, showing
the Woonam aircraft beside the main hall's east wing and the pavilion on the
northwest bank of Inkyung Pond. These coordinates are visually estimated against
the existing source footprints, not surveyed or extracted map coordinates.

| Landmark | Previous latitude, longitude | Corrected latitude, longitude |
| --- | --- | --- |
| Woonam aircraft | 37.44908, 126.65333 | 37.449075, 126.655204 |
| Pond gazebo | 37.44948, 126.65541 | 37.44999, 126.656075 |

Only the two landmark anchors and their semantic area membership change.
Existing silhouettes, headings, sizes, source building/pond polygons and road
centerlines remain unchanged. Woonam now belongs to the main-hall area. The
library area's stable ID remains `AREA_JUNGSEOK_WOONAM` for compatibility, while
its members and displayed name describe the library and Hawaii–Inha Park.
Rendering chunk ownership and tree exclusion follow the corrected anchors.

Validation: 185 Node tests and `apps/world/qa.mjs` pass. Regression checks cover
the aircraft's entire conservative footprint against buildings and roads, tree
crown clearance, and the gazebo deck crossing the northwest shoreline. Edge
WebGPU inspection confirms both placements; no console errors were captured.
