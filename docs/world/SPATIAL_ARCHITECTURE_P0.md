# INHA WORLD spatial architecture P0 (private #87)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

The subsequent view-distance extension is documented in [VIEW_DISTANCE_P0.md](VIEW_DISTANCE_P0.md).
It supersedes the single fixed policy and discrete layer toggles below with four
presets, incremental policy reconciliation and 250 ms layer fades. The baseline
audit, semantic inventory, compatibility and collision policy remain valid.

## Baseline audit before implementation

Audited PR head `0814bfab39d00f150abbaca738be46eba7a01d20`, main
`a6cf759`, including the requested src modules, World QA/tests, zone manifests,
Reality data schemas, projected runtime outlines and their evidence references.
The track, aircraft clearance and 6–9 courtyard corrections are preserved.

Legacy rectangles (logical X east, Z north, 1 unit approximately 2 metres):

| ID | X | Z | Neighbors |
| --- | --- | --- | --- |
| C01_GATE | -182..309 | -181..-50 | C02 |
| C02_MAIN_HALL | -182..95 | -50..166 | C01, C03 |
| C03_CENTRAL | 95..309 | -50..166 | C02 |

All bounds have Y -5..40, but containment ignores height. Every 250 ms:
containing rectangle = ACTIVE; declared neighbor = NEAR regardless of distance;
otherwise center distance <= 180/260/180 = VISTA, else UNLOADED. activeDistance
and nearDistance in JSON are unused. Every state change destroys the old root,
including ACTIVE/NEAR, and rebuilds its ground, buildings, custom meshes and props.
Pond ripple callback is deregistered on destruction. No residency hysteresis.

Facilities are assigned by centroid Z < -50, otherwise X < 95. This splits the
2호관 wings and calls Agora Gate. Main Hall + library + ALL lawns, paths and
procedural trees are built in C02; pond in C03; gate in C01. Main-hall/facility
builders omit some windows in VISTA, but most other geometry has no LOD.

Dependency map:
- main.js loads ZoneRegistry, passes player logical coordinates to streaming;
  callback updates HUD and campus_zone_enter telemetry; activeZoneId feeds tour.
- campus-tour.js requires stop.zone plus radius. Storage key remains
  inhagame-campus-tour-v1; stages 0/1/2, former completed stage 3 clamps to 2.
- main.js still compares tour completion to literal 3; migration must use the
  actual stop count so completion attribution remains functional.
- campus-profile.js only owns guest nickname/nameplate; no zone persistence.
- player-controller.js uses WORLD_BOUNDS and world-collision independently of
  render roots. OBSTACLES holds all building/tower/roof/gate-wall polygons.
  Ground height is analytical; decorative paving/trees/water have no colliders.
- reality-adapter.js owns source projection/triangulation; source coordinates
  are not to be rewritten as game region boundaries. Old Agora evidence remains
  archival and must never reappear as a live pond-side plaza.
- qa.mjs and pond-runtime tests explicitly exercise old rectangles; retain these
  as compatibility tests while adding semantic resolution checks.
- qa-facilities-runtime assumes all facilities resident at one central pose and
  tests C03 state names; replace those assumptions with per-chunk visits/audits.

No online transport, database, Presence or remote-player work belongs to this PR.

## Implemented contract

`PlaceZoneRegistry` is the only live authority for location. It has no PlayCanvas
or render-chunk import. `getPlaceZoneAt({x,z})` is a pure lookup;
`getCurrentPlaceZone()` reads the latest result; `update(position)` notifies
`onPlaceZoneChanged((previous, next) => ...)` subscribers only when the ID changes.
Subscription returns an unsubscribe function. Initial entry has previous=null;
outside the playable envelope has next=null. Height does not affect the place.
The app also forwards the same records through `app.fire('placeZoneChanged', ...)`.

Records have stable AREA IDs, displayName, member polygons, open-space anchors,
resolver version, discoveryId, legacyZoneId and futureRealtimeChannelKey.
Whole member footprints take priority, then nearest member/explicit anchor wins;
ties use definition order. Courtyards use their outer member footprint for
semantic ownership, independently of collision holes. These are game regions,
not surveyed boundaries. Source geometry/provenance remains unchanged.

HUD and tour read the place record, never RC state. Future Online P0 can subscribe,
leave the previous record's channel and join `world:campus:<AREA_ID>` on the next
record. It must handle null, teardown, debounce and asynchronous joins itself.
No transport, Presence, poses, RemotePlayer, chat, online database or network
dependency has been introduced. The current resolver emits immediate changes;
render hysteresis must not be mistaken for network/semantic-border debounce.

## Compatibility and saved state

`legacy-zone-compat.js` is explicitly transitional:

| Legacy caller ID | Default Place ID |
| --- | --- |
| C01_GATE | AREA_MAIN_GATE |
| C02_MAIN_HALL | AREA_MAIN_HALL |
| C03_CENTRAL | AREA_INKYUNG_STUDENT_CENTER |

- Tour stops now carry placeZoneId; deprecated `zone` remains for old callers.
  `placeIdForTour` normalizes old IDs without storing render IDs.
- Storage key `inhagame-campus-tour-v1` and stages are unchanged. Stages 0/1/2
  remain valid; the former three-stop completion 3 still clamps to completed 2.
  Completion attribution now compares against TOUR_STOPS.length, including retry.
- The deployed campus_zone_enter target enum accepts only C01/C02/C03. Analytics
  therefore uses the per-place legacyZoneId in the table below, deduplicated by
  that target. Agora's analytics target remains C01 only for compatibility; its
  actual location/HUD/discovery ID is AREA_AGORA_6_9. Fine-grained place analytics
  requires a separately authorized contract/migration later.
- FACILITIES.zone becomes legacyZoneId, retaining historical centroid metadata.
  Neither semantic ownership nor live streaming uses it.
- `getStatus().activeZone` is a transitional debug alias containing the AREA ID;
  canonical fields are placeZone, renderChunks and streamingMetrics. Old `zones`
  debug field is retired; runtime QA has migrated to the canonical fields.
- ZoneRegistry and data/zones JSON are archived compatibility fixtures used by
  existing geometry QA. They are not loaded by main.js. ZoneStreamingManager is
  removed, so there is exactly one live streaming system.
- There is deliberately no C0-to-RC authority/mapping: content ownership comes
  from geometry, and one semantic place can span several technical chunks.

## Render ownership, tiers and lifecycle

RenderChunkRegistry groups whole assets by their center into 64-unit ownership
cells (about 128 metres). IDs are RC_<gridX>_<gridZ>. Only populated cells exist.
Bounds expand to include the whole asset, with padding for details/trees; bounds
can overlap. No building is sliced at a grid edge. Each facility/building/tree has
exactly one owner. Distance is nearest XZ AABB boundary distance, zero inside.

`CampusBase` is built once: continuous terrain, roads/lawns/pool, gate, pond,
building silhouettes, library roof/glazing silhouette, Main Hall columns and
major landmarks/courts/plazas. It stays resident at all chunk states, preserving
the visible surroundings of permanent collision geometry.

| State/tier | Content | Lifecycle |
| --- | --- | --- |
| BASE / VISTA | Permanent campus and silhouettes above | Never rebuilt on a chunk transition |
| NEAR | Building cornices, lawn trees, 5 courtyard trees, student stairs, Hall entrance | Lazy build once per residency; enable/disable |
| ACTIVE / DETAIL | Facades/windows, library glass rails | Lazy build once per residency; enable/disable |
| UNLOADED | Dynamic chunk root and its NEAR/DETAIL layers absent | Destroy dynamic handle; permanent BASE remains |

ACTIVE to NEAR to VISTA retains the same roots and meshes. Returning to a detail
tier reuses its layer. A far unload destroys dynamic layers; the next load gets
a fresh handle. This is local entity/detail residency, not network asset streaming.
Some landmarks and decorative trees inside landmark builders remain in BASE as
a documented P0 slice. Tier changes are discrete, with no crossfade.

## Distances and hysteresis

Evaluation interval stays 250 ms, independently of per-frame place resolution.
Distances are logical world units and measured against expanded chunk bounds.

| Transition | Enter threshold | Exit threshold |
| --- | --- | --- |
| Resident / UNLOADED | <=150 | >180 |
| NEAR / VISTA | <=85 | >105 |
| ACTIVE / NEAR | <=35 | >50 |

The controller's fastest configured flight is 18 units/s: one evaluation covers
4.5 units. Threshold gaps 15/20/30 exceed that travel; the camera's user orbit cap
is 36. Permanent silhouettes prevent holes when distant detail is absent. These
are tested P0 settings, not a claimed universal performance optimum. Unit tests
oscillate across enter boundaries and exercise exits/restores; browser QA also
repeats actual ACTIVE/NEAR layer changes and far unloading.

## Collision residency

Unchanged: WORLD_BOUNDS, analytical ground, OBSTACLES for building footprints,
towers/roofs and gate walls remain available regardless of render states. Roof
landing, swept movement, concave corners and 5 courtyard holes retain their
existing collision behavior. Decorative trees/water/paving do not gain colliders.
Far dynamic unload cannot remove ground or building collision, and BASE retains
major visible silhouettes. Future collision broad-phase indexing may select
nearby candidates but must retain a movement/landing margin and keep ground and
critical building collision available before enabling aggressive unloading.

## Validation and mutation proofs

Commands passed on the final implementation:

```text
node apps/world/qa.mjs
node apps/world/validate-reality.mjs
node apps/world/validate-reality-evidence.mjs
bash .github/ci/world-tests.sh              # 49 tests
node apps/world/qa-spatial-mutations.mjs    # run serially
git diff --check
```

Mutation runner changes actual source in isolation, checks a behavioral assertion
fails (not a syntax/import failure), restores original bytes in finally, and
reruns the clean baseline. All five killed: Agora mapped to Gate; unload
hysteresis removed; center distance substituted; returned Place ID changed to
RC namespace; C01 compatibility entry removed. Never run other source readers or
tests concurrently with this runner. An accidental parallel local suite observed
the compatibility mutation; the restored full suite was rerun sequentially and
all 49 tests passed.

## Churn measurements and browser QA (2026-09-26)

Chrome actual WebGPU, same old seam: warm both sides of (0,-50), then alternate
z=-49.9/-50.1 twenty times. Baseline is isolated commit 0814bfab; old entity counts
use actual GUID set differences under the three zone roots. New counters cover
render-owned entities, not the character or complete engine allocation.

| Metric, 20 crossings | Old | New |
| --- | ---: | ---: |
| State transitions | 60 | 0 |
| Entities created | 18,390 | 0 |
| Entities destroyed | 18,390 | 0 |
| Dynamic chunk builds / destroys | Not the old unit | 0 / 0 |

Twelve additional ACTIVE/NEAR cycles retained the exact root/near/detail GUIDs.
Far eastern chunk unload/restore changed only its dynamic root; CampusBase and
the far building silhouette survived. This demonstrates churn reduction, **not**
FPS, GPU time, memory allocation or network bandwidth improvements.

Fresh runtime route samples below include normal distant loads/restores; these
are cumulative counters, distinct from the warmed seam comparison.

| Sample | ACTIVE / NEAR / VISTA / UNLOADED | Builds / destroys | Entities created / destroyed | Transitions |
| --- | --- | --- | --- | --- |
| Gate | 5 / 4 / 2 / 8 | 11 / 0 | 759 / 0 | 11 |
| Main Hall | 5 / 7 / 5 / 2 | 17 / 0 | 1003 / 0 | 30 |
| Pond | 6 / 3 / 6 / 4 | 19 / 4 | 1027 / 11 | 46 |
| Agora | 4 / 4 / 7 / 4 | 19 / 4 | 1033 / 11 | 56 |
| Sports | 5 / 3 / 5 / 6 | 23 / 10 | 1073 / 62 | 72 |
| Building 5 | 2 / 7 / 6 / 4 | 25 / 10 | 1082 / 62 | 83 |

Actual controller walked Gate to Hall and around its south facade to the pond,
plus Agora courtyard movement. Sports/west were camera and location visits.
All six HUD labels and terrain presence passed; no repetitive boundary flicker
or base rebuilding was observed. The initial Hall-to-pond test tried to cross the
building wall; a walkable route around it passed, preserving collision behavior.
Tour completed 2/2, persisted, restarted, and a local synthetic entry adapter
received exactly one retry/play/result/clear each (no external event sent by that
adapter). All 33 existing facility GPU geometry checks passed, including flat
track, aircraft/tree clearance and source footprints. No console errors observed.

Mobile Chrome emulation 390x844: RUN toggled, real touch joystick moved 0.9436
units, mount exposed ascent/descent, touch ascent reached Y=2.618. The longest
west-area label revealed a HUD/tour overlap; a shared stacked container fixes it
with an observed 8 px gap. This is browser emulation, not physical-device QA.
Desktop viewport/touch overrides were restored afterward.

Screenshots and JSON were returned separately with the delivery record. The
runtime script is reproducible in a disposable local/preview tab via
`(await import('/qa-spatial-runtime.mjs')).run()` after campus loads. It resets
that origin's tour through the existing restart control; do not run against a
user's in-progress production session. Source mutation proofs are local only.

## Remaining boundaries

- BASE and collision stay resident; not a full memory-budgeted world streamer.
- Grid bounds expand/overlap, and some landmark content has not been tier-split.
- Game regions use known runtime positions, including existing estimated assets;
  nearest-anchor boundaries need playtesting and may receive deliberate revisions.
- AREA IDs/channel keys are stable integration identifiers; RC IDs can change
  with content ownership and must never become persistence or Presence keys.
- Online P0 still needs its own lifecycle, border debounce, transport contract,
  security rules and fake transport tests. None is implemented here.
- CI and exact final PR/main identifiers are recorded in the PR delivery record.

## Place zone inventory

Generated below from the implementation; legacy targets are analytics-only.

<!-- SPATIAL_INVENTORY -->

| ID | Display name | Legacy analytics | Members |
| --- | --- | --- | --- |
| AREA_MAIN_GATE | 정문·남쪽 진입로 | C01_GATE | bldg_continuing |
| AREA_MAIN_HALL | 본관 | C02_MAIN_HALL | bldg_01 |
| AREA_CENTRAL_LAWN | 중앙 잔디광장 | C02_MAIN_HALL | lmk_matching_tree |
| AREA_JUNGSEOK_WOONAM | 정석·우남호 | C02_MAIN_HALL | bldg_jungseok, lmk_woonam_aircraft, lmk_hawaii_park |
| AREA_SPORTS | 대운동장·체육시설 | C02_MAIN_HALL | fac_stadium, fac_basketball, fac_tennis, fac_south_court, fac_biryong_parking, bldg_rotc |
| AREA_BUILDING_5_WEST | 5호관·서호관·60주년기념관 | C02_MAIN_HALL | bldg_05, bldg_seoho, bldg_nabille, bldg_60th |
| AREA_BUILDING_2_4 | 2·4호관 | C02_MAIN_HALL | bldg_02_south, bldg_02_north, bldg_04 |
| AREA_INKYUNG_STUDENT_CENTER | 인경호·학생회관 | C03_CENTRAL | lmk_inkyung_pond, bldg_07, bldg_c, lmk_pond_gazebo, lmk_biryong_tower |
| AREA_AGORA_6_9 | 아고라·6·9호관 | C01_GATE | bldg_06, bldg_09, fac_agora_courtyard, lmk_heidegger_forest |
| AREA_HITECH | 하이테크센터 | C03_CENTRAL | bldg_hitech |
| AREA_EAST_SUPPORT | 인하드림센터·하와이교포기념관 | C03_CENTRAL | bldg_dream1, bldg_hawaii |
| AREA_EAST_ANNEX | 인하드림센터 2·3관 | C03_CENTRAL | bldg_dream2, bldg_dream3 |
| AREA_LAWSCHOOL | 로스쿨관 | C01_GATE | bldg_lawschool |
| AREA_DORM_SOUTH | 제1생활관 | C01_GATE | bldg_dorm1 |
| AREA_DORM_EAST | 제2생활관 | C01_GATE | bldg_dorm2 |

## Render chunk inventory

Rounded bounds shown; runtime keeps full precision. Global BASE features are not
duplicated into each chunk. Tree count refers to procedural lawn trees.

| ID | X bounds | Z bounds | Whole assets | Trees |
| --- | --- | --- | --- | --- |
| RC_1_0 | 46.4..130.1 | -3.0..90.3 | bldg_02_south, bldg_04, lmk_pond_gazebo | 0 |
| RC_1_1 | 64.0..128.0 | 64.0..128.0 | bldg_02_north | 0 |
| RC_0_1 | -57.8..74.3 | 55.6..154.0 | bldg_05, bldg_60th | 0 |
| RC_1_-1 | 63.0..140.8 | -74.4..0.0 | bldg_06, bldg_dream1, bldg_hawaii, lmk_biryong_tower | 6 |
| RC_1_-2 | 63.0..128.0 | -128.0..-60.7 | bldg_09, lmk_heidegger_forest, fac_agora_courtyard | 1 |
| RC_2_0 | 128.0..192.0 | -14.0..64.0 | bldg_07, bldg_c | 0 |
| RC_2_1 | 128.0..203.0 | 46.4..128.0 | bldg_hitech | 0 |
| RC_-2_1 | -128.0..-46.6 | 50.8..135.9 | bldg_seoho, bldg_nabille, fac_basketball | 0 |
| RC_-1_-1 | -70.4..2.3 | -68.2..34.6 | bldg_lawschool, lmk_hawaii_park, bldg_jungseok | 8 |
| RC_-2_-1 | -128.0..-63.3 | -64.0..0.0 | bldg_rotc, fac_south_court | 0 |
| RC_0_-2 | 0.0..64.0 | -128.0..-64.0 | bldg_continuing | 9 |
| RC_4_-1 | 256.0..320.0 | -64.0..0.0 | bldg_dream2, bldg_dream3 | 0 |
| RC_0_-3 | 0.0..64.0 | -192.0..-128.0 | bldg_dorm1 | 0 |
| RC_4_-2 | 256.0..320.0 | -128.0..-64.0 | bldg_dorm2 | 0 |
| RC_-2_0 | -129.0..-54.4 | -20.3..73.2 | fac_stadium, fac_tennis | 0 |
| RC_-3_1 | -192.0..-95.2 | 30.0..128.0 | fac_biryong_parking | 0 |
| RC_0_-1 | -5.8..70.3 | -69.8..0.0 | lmk_matching_tree, lmk_woonam_aircraft | 18 |
| RC_0_0 | 0.0..93.6 | -24.6..64.0 | bldg_01 | 1 |
| RC_-1_-2 | -64.0..0.0 | -128.0..-64.0 | Trees only | 1 |
