# Campus visual / collision parity P1

## Scope and provenance

This local candidate restores neutral procedural rendering for three areas that
already have public gameplay geometry but whose render functions were no-ops:

- Back alleys: all 35 existing `BACK_ALLEY_COLLIDERS`, including their unchanged
  footprint and full collision height, are visible in persistent BASE
- Library garden: 19 wall segments, eight beds, four benches, four trees, three
  stepped entrances, one ramp, and the existing library-route centerlines
- Stadium: four standing rows, twelve-step aisle strips, two six-step side
  entrances, and existing retaining-wall/cheek collider bounds

The authority is public `aldol2678/inhagame` main
`3b1bcbaddf1e2bd506206d8c67727c11dfd0a47c`. All layout, collision, height,
footprint, roads and navigation files remain byte-identical to that base. This
includes the newly integrated Main Hall / Jeongseok runtime owner from PR #151.
The existing `campus-terrain.js` remains the sole depressed-floor owner.

These are newly authored primitives based on current public gameplay contracts.
No private historical rendering code, source photographs/PDF, street-view facade
recipe, shop identity, logo, texture or other binary asset is included. Existing
OpenStreetMap attribution in NOTICE.md still applies to the source footprints.
Paving width, foliage silhouette and colors are neutral presentation choices,
not measured architecture or evidence of real-world commercial tenancy.

## Rendering and lifetime contract

Opaque, collidable objects live in persistent BASE; streamed detail cannot make
an obstacle disappear. Alley NEAR/DETAIL remain empty because this slice does
not add decorative facades. Stadium steps sample the existing height functions
at each tread, with exact aisle partitions. Garden bench seat heights use the
existing GARDEN_SEAT contract and the lowered GARDEN_FLOOR offset.

All custom meshes use the existing FacilityMeshBatch ownership and material
cache. BASE adds 10 material mesh batches total: alley 2, garden 5, stadium 3.
Garden DETAIL adds two owner-filtered material batches and follows the existing
chunk fade/cleanup path. No new physics, interaction, NPC, database, terrain-floor
or material-cache authority is introduced.

Geometry budgets: alley 420 triangles, garden BASE 858 triangles, stadium 1,068
triangles. These are geometry counts, not a measured GPU/FPS benchmark.

## Validation commands

- `node --test apps/world/tests/campus-visual-parity-geometry.test.mjs apps/world/tests/campus-visual-parity-walking.test.mjs apps/world/tests/library-garden-geometry.test.mjs apps/world/tests/back-alley-geometry-contract.test.mjs`
- `bash scripts/public-ci.sh`
- `bash scripts/public-db.sh` only against a disposable local stack
- `cd apps/world/tests/browser && npm ci --ignore-scripts --no-audit --no-fund`
- `node apps/world/tests/browser/campus-visual-parity-null-smoke.mjs`
- `node apps/world/tests/browser/hall-library-integration-null-smoke.mjs`
- In a browser-enabled executor: `WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/campus-visual-parity-smoke.mjs`

The graphical smoke runs 55 deterministic actual-PlayerController cases per viewport: all four garden entrances and five stadium routes in both directions, two clear alley traversals, and approach/stop checks for each of the 35 alley colliders. It then prepares actual-campus on/off captures for desktop,
portrait and landscape sizes, with production Z reflection and an unreflected
control. Its on/off views are a rendering diagnostic, not captures of a prior
released commit. Supabase and API calls are stubbed by the existing offline
harness; external requests are blocked. These controller inputs do not establish trusted keyboard/touch gesture handling, physical-device support or photorealistic accuracy. The existing offline fixture shuttle clock advances during controller ticks; player position and input state are restored.

## Remaining release gate

Local Chromium launch is blocked in the current executor at
`process_singleton_posix.cc`: `socket() failed: Operation not permitted`, ending
with SIGABRT. Do not treat the null-device checks as pixel evidence. The dedicated read-only pull-request workflow runs the browser script on a GitHub-hosted runner. Hosted results must be checked for the exact published head; a ready Preview alone does not satisfy this gate. No workaround of the local restriction is attempted.

The disposable database suite cannot run here because the `supabase` CLI is
absent. No database files are changed and no Production database is accessed.

This candidate does not itself authorize publication, a PR, merge or Production
deployment. After a separately approved hosted run, review the actual before /
after frames, stationary-frame stability, unchanged routes, entry crossings and
material/LOD behavior before release. The wider public campus reconstruction,
student-center activation, Agora/pond dressing and detailed backgate facades are
outside this slice.
