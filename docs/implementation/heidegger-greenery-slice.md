# Heidegger Forest: photo-grounded greenery slice

## Scope and evidence

Initial public main: `c8648c044ff3af1d34e67bed0e01f644055882e3` (#204).
The approved small greenery slice improves the existing Heidegger Forest owner
beside the 6/9 Hall road. It does not implement a second central-lawn layout.

Both reference images were inspected as actual pixels before implementation:

| Reference | Date support | Visible evidence | Limits |
| --- | --- | --- | --- |
| [Official university spring gallery](https://www.inha.ac.kr/bbs/kr/64/37176/artclView.do), [credited image mirror](https://media.tel-co.net/isr/uploads/download_c1ef0d0567.do?w=720) | Published 2024-04-12. Mirror EXIF DateTimeOriginal says 2024-04-05 16:49:01; metadata is not independently verified | Mature exposed trunks, open pale compacted soil, brick walking strip with gray edging and discrete wooden benches | A single perspective does not establish the entire path graph, tree/bench count, placement, dimensions or current state |
| [Michuhol-gu campus visit](https://m.blog.naver.com/tong_namgu/223433854717), [forest interior image](https://cdn.welfarehello.com/naver-blog/production/tong_namgu/2024-05/223433854717/tong_namgu_223433854717_8.jpg?f=webp&q=80&w=800) | Published 2024-05-02; exact capture date unknown | Green-season broadleaf and pine-like crowns, irregular branching, tall clear trunks, earth beside a brick walk | Supports silhouette/material character, not identified species or a surveyed layout |

These are the newest inspected forest ground-level references available for this
slice, not a claim that no newer photographs exist. The 2026-published aerial has
an unknown capture date and does not justify exact ground geometry. The supplied
2026-10-01 field reference grounds earlier pond/lawn work but is not used to invent
forest details. Public photographs are reference links only; no photo is added to
app assets or redistributed with this patch.

## Implemented

- Preserve all 12 existing `forestRoadTrees()` centers. Their positions remain
  generated game presentation, not independently surveyed trees
- Replace equal-height single crowns with eight broadleaf-like and four flatter
  pine-like profiles. Three offset canopy lobes and branch forks give taller,
  varied silhouettes; heights are bounded game-scale estimates (7.4–8.92 WU)
- Crown bottoms stay at least 4.67 WU high. The maximum horizontal envelope is
  2.425 WU, within the existing 2.5-WU tree-clearance radius
- Add one 53.7705 WU² matte earth clearing around the existing four-tree cluster.
  Its 12-edge convex outline derives from those centers; it is a bounded visual
  pilot, not the photographed clearing's measured boundary
- The earth stays at the existing `.020` flat-ground render offset. Whole-polygon
  tests exclude roads, path shoulders, brick promenade, all existing lawn
  compartments, water, buildings and seating. No terrain height changes
- Retain the existing brick promenade exactly. Do not infer a second interior
  path, new junctions, benches or seating interactions from these perspectives
- Reuse the current `lmk_heidegger_forest` persistent BASE owner. There are no new
  streaming owners, framework, textures, colliders, lights or per-frame rebuilds
- Add the soil color to the existing matte-ground material palette. Existing
  ground/foliage/wood optical profiles and the shared material cache are unchanged

The #181 contact-shading pilot owns Main Hall/Jeongseok and NEAR trees in
`RC_0_0`/`RC_-1_-1`. This forest belongs to `RC_1_-2`; no contact-shading
owner, receiver mask, transparent material or fade behavior is added or changed.
The forest batches retain the existing landmark directional-shadow setting,
including `castShadows=true`. No extra shadow system is introduced; this is not
a claim that shadow-map work is unchanged.

## Resource and regression checks

| Resource | Previous forest | Candidate |
| --- | ---: | ---: |
| Tree centers | 12 | 12 |
| Color meshes | 3 | 4 |
| Triangles | 576 | 1,450 |
| Position/normal/index bytes | 44,928 | 113,100 |

Delta: one color mesh, 874 triangles and 68,172 bytes. Tests cap the candidate at
four meshes, 1,700 triangles and 140,000 bytes. These are actual generated resource
counts, not measured mobile/WebGPU frame-time improvements.

Verification available locally:

- Test-first profile, surface-exclusion, winding, finite-buffer, deterministic
  geometry, matte-material and literal-baseline scope contracts
- Actual PlayCanvas 2.22.4 NullGraphicsDevice: three disposal cycles with reflected
  and unreflected roots; SHORT/MAX policies; ACTIVE/NEAR/FAR/VISTA transitions;
  stable BASE buffers; no duplicate streamed grove; unchanged shared fade state;
  complete buffer disposal
- Independent review inspected both reference photos, reran the geometry and
  lifecycle checks, and sampled 21,510 interior clearing points with no protected
  surface intersection or raised ground
- Existing road/path, navigation, obstacle, terrain and seat regressions remain
  enforced. Only three runtime files are in scope: the forest geometry helper,
  its existing facility caller and the soil palette membership

## Hosted visual gate

Local Chromium is blocked by the executor's socket policy; do not work around it.
Null-device QA provides no rendered pixel evidence. Recognizability, ground/shadow
appearance and mobile framing remain pending actual browser review.

The existing read-only Campus visual parity job includes a bounded forest
comparison for `codex/heidegger-greenery-slice-*` branches. It loads the exact PR
head and base SHA, replaces both modified runtime sources with literal base bytes
in the baseline page, rejects a broader runtime diff, checks one forest owner,
compares unchanged obstacle/road/path/seat/navigation data, and captures the same
three cameras at desktop, portrait and landscape widths. Views cover the brick
walk at eye level, the earth/canopy closeup, and a distant SHORT-policy silhouette with the forest chunk actually in VISTA.
The portrait clearing camera pulls back along the same viewing ray to include
the full four-tree cluster.
Each view checks stationary pixels and an on/off/on visibility round trip.
These files prepare QA; they are not evidence of a completed hosted run.

Commands:

```sh
node --test apps/world/tests/heidegger-forest*.test.mjs
node apps/world/tests/browser/heidegger-forest-null-smoke.mjs
bash scripts/public-ci.sh
WORLD_FOREST_BASE=<exact-base-sha> EXPECTED_FOREST_HEAD=<exact-head-sha> \
  WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome \
  node apps/world/tests/browser/heidegger-forest-smoke.mjs
```

Publish/hosted execution, merge and Production deployment require their respective
approvals. Rollback restores the original forest branch in `facility-blockout.js`
and removes this helper plus its soil color membership. No saved player state or
database changes exist.

## Publication refresh

The same runtime slice is integrated on public main
`20257f9f35e56a2a198fb997845b898ed6ca3534`, preserving #79 population BFCache,
#73 account-scoped resume/events, #74 design documentation, #52 TML evidence and
#197 WorldForge. The ten-file candidate applies without conflicts; the three
runtime changes remain identical. Draft publication and hosted verification are
approved. Rendered visual acceptance remains pending the exact-head hosted run;
merge and Production deployment are not included.
