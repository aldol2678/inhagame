# 60th Anniversary Hall ↔ Building 5 walkway

Mission `INHA-WORLD-60TH-FIVE-WALKWAY-IMPLEMENT-01`. Development base is
latest main observed at start: `5b0bf8746c1a1f361125319b5a884213a3014109`.
Keep the PR **Draft**. This document is an implementation contract, not release
approval; the exact-head CI artifacts and PR receipt carry the final QA result.

## Evidence and uncertainty

Read the MOA `INHA-WORLD-60TH-FIVE-WALKWAY-MUSE-R1` Drive ZIP: final report,
both build specs, spatial analysis, CAM-A–G CSV, source/verification records,
and both original user HEICs. User photos were decoded for direct visual review
outside this repository. No photo or derived texture is included.
The old build spec's “new slab” recommendation predates the current north roads;
this implementation instead edits their existing presentation owner.

P-06 confirms the longitudinal paving, western planting strip, globe lamps,
wood pergola, railing/banner bay and loose bicycle/scooter group. P-07 confirms
the door/canopy, rectangular pavers, red-brown band, manhole, drains and edging.
Historical external images were not independently revalidated this task; their
rights and MOA analysis remain separate from direct user-photo observations.

All fitted dimensions/counts/placements are `DERIVED_BLOCKOUT`, not metres.
`WALKWAY_EVIDENCE.survey` retains null values for width, length, plaza extent,
spacing, angles, slope and level changes. Door position/orientation is inferred.
Replace the shared layout with surveyed records later; render and map consume
the same partitioned polygons, while existing centreline owners remain intact.
The existing Building 5 bands are preserved, with **FACADE_TBD** still applying:
no new east-facade windows, ornament or claimed verification was added.
No new crosswalk, bench, rack, bollard, stair or entrance portal is invented.

## Implementation and ownership

| Area | Result | Owner |
|---|---|---|
| P0 corridor | Existing west lanes expanded within derived gap; warm grey rectangular paving and longitudinal seams | `north_campus_roads` BASE |
| P0 plaza | Grey pavers, red-brown door band, one manhole, two grates, flat visual curb edge | Same BASE owner |
| P0 south join | Two formerly virtual joins gain physical paving; asphalt/shoulder retains priority | Shared layout; original road renderer |
| P0 doors | Replace the local lower-glass span with door panels; canopy, handles, transom and curved foot | Existing 60th NEAR facade |
| P0 route/map | Two CONNECTOR edges become authored PATHs; identical geometric graph, map receives exact paving polygons and four side-gate paths | Existing navigation/map adapters |
| P1 | Six trees/pits and six globes, pergola, hedge blocks, wood planter, three bikes/scooter, unlettered railing/banner bay | 60th NEAR / lattice DETAIL |

Convex subtraction partitions pavement joins and subtracts source building
triangles, existing asphalt/shoulders and side-gate paths. It does not raise
replacement slabs above old ones. Decorative seams use the existing flat-ground
height contract. The visible edging creates no fictional step collision.
Unrelated north lanes retain their centres/widths; only their overlapping joins
are partitioned. Existing side-gate geometry is unchanged.

The 5th footprint, 60th footprint, original four side-gate paths, existing
perimeter centreline data, clock core, tower, all old ground/elevated colliders,
and geoToWorld source files are pinned by tests. The live navigation geometry
still hashes to `9959b3a7ad148200c2c338d9e1f7ecbd2d6d142683c705668723d1e9bd3be78c`:
187 nodes / 212 edges. Virtual junction count falls from 9 to 7.

Props share the existing material batching and streaming owners. They introduce
no lights, physics bodies or new asset loaders. Generic lawn trees are excluded
from the new planted strip; existing front trees stay unchanged. The 60th chunk
bounds include its western props. FAR removes optional props and facade detail;
BASE paving and both landmark silhouettes remain. Existing mesh/fade/material
cleanup is exercised through real PlayCanvas create/destroy/re-entry cycles.

## Concurrent work reviewed

Open PR file lists inspected: #108 (other landmark facade modules), #90 (static
furniture), #67/#60 (lamp runtime), #359 (graphics quality tiers). None is merged
or copied here. Lamp illumination/runtime remains their responsibility. Their
eventual integration should respect this layout's tree/prop clearance predicate.

## Reproducible verification

```
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
npm ci --prefix apps/world/tests/browser
node apps/world/tests/browser/north-landmark-null-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/north-walkway-smoke.mjs
```

`north-walkway-browser.yml` checks out the exact PR head, runs the same sampler
against pinned main and candidate sequentially, captures 21 views each, exercises
six runtime Auto Move traversals, and uploads the receipts. No online services,
login, operating DB, deployment or account data are used.

Performance samples use eight warm-up frames and thirty measured rAF intervals
per camera; simulation is frozen and each frame explicitly renders. Submission
wall time, FPS, actual draw/triangle submissions, engine VRAM and JS heap are
recorded. Same engine/browser/viewport/cameras and NORMAL streaming policy apply.
Budgets: p95 ≤ baseline × 1.15 + 2 ms; draws ≤ baseline + 16; triangles ≤ +5%;
VRAM ≤ +10%; heap ≤ +15%. These are declared mission QA budgets, not surveyed
or physical-device claims. Any exceeded gate is **HOLD**.

| Camera | Check | Photo-comparison limit |
|---|---|---|
| A | Southern overview, two buildings and clock | Historical MOA analysis only |
| B | North-facing corridor | Historical MOA analysis only |
| C | South-facing corridor, west planting/east glass | Direct P-06; relative structure only |
| D | Door, canopy, pavers, frame foot | Direct P-07; exact scale/position unverified |
| E | Podium/tower oblique overview | Historical analysis; fitted unobstructed camera |
| F | Gate to Building 5 | TEXT ONLY — no photo-match PASS |
| G | South junction toward clock | TEXT ONLY — no photo-match PASS |

Desktop 1280×720, portrait 390×844 and landscape 844×390 are browser viewport
emulations. Physical mobile GPU/thermal/memory behavior remains unmeasured.
The original broad podium silhouette and lighting/material system constrain
photo fidelity. Roof reconstruction, full reflection matching, physical curb
levels and unverified southern road branches remain outside this bounded fit.
