# Rear-gate road and crossing restoration candidate

This presentation-only candidate is based on public main
`3b95e37f3dec477ebe7e06456907176bb81a63a2`. It repairs the simplified road/gate
layers without replacing the restored shop facades or the existing road network.

## Diagnosis and scope

- A second generic full-width street corridor overlapped the existing asphalt.
  Remove this duplicate; the existing back-gate/approach batches retain ownership
  of asphalt and lane markings.
- The two crossing pairs already had four signal-pole collision anchors, but their
  pole/head visuals were absent. Restore those visuals at the exact existing
  anchors, with static opaque vehicle lenses and pedestrian icons.
- Replace 42 opaque divider cuboids with open posts and horizontal rails. Their
  presentation stays within the existing 1.6 × .14 × .65 collision envelopes.
- Restore flat sidewalk/curb/tactile paint and the side crossing zebra.
  After visual review, the side zebra uses ten horizontal bars running along the
  road, repeated across the unchanged sidewalk-to-sidewalk crossing span. The
  crossing endpoints, signals and camera stay fixed; the main-gate pattern is unchanged. The main
  zebra remains exclusively owned by the existing back-gate paving.
- Restore culture-road curves, accents and the plaza ring over the existing tiled
  approach. Existing road-junction clipping remains in use. Curves yield to
  transverse bands and the plaza so differently colored coplanar paint cannot fight.
- Restore side-gate path seams, open bars, bollard bands and a generic unlettered
  noticeboard. Solid gate bodies retain their current collision dimensions.

No surveyed traffic regulation, business identity or live signal status is
asserted. There are no numeric speed-limit signs, timers, dynamic lights, traffic
simulation, textures, external assets or network requests. Gate/west-background,
roadside/furniture details that were already present remain unchanged. The
existing culture canopy remains outside this bounded restoration.

## Geometry and ownership

The new `back_street_paving_` batch is separate from upright structures and has
`castShadows:false`. `culture_street_paving_` retains the same shadow-free policy.
All new walkable paint/surfaces use `FLAT_GROUND_Y` or explicit midpoint
sublayers between .020 and .028; logical player/NPC grounding remains unchanged.
Side-gate paths at .023 own the overlap above the north-road base (.022); the
plaza at .025 owns the overlap above approach margins (.024); tactile pads at
.027 own the overlap above drainage/tile paint (.026). A combined-owner polygon
intersection test covers the three changed and four neighboring road generators. Divider posts are radius .065 with .070
colored sleeves, preventing coincident pole/sleeve faces without widening rails.

Runtime geometry from PlayCanvas 2.22.4 `NullGraphicsDevice`:

| Persistent owner | Meshes | Triangles |
| --- | ---: | ---: |
| back_street_paving | 3 | 1,088 |
| back_street_signals | 5 | 7,088 |
| culture_street_paving | 3 | 1,147 |
| north_side_gate | 6 | 896 |
| Total | 17 | 10,219 |

The corresponding previous layers contained five material batches and 1,620
triangles; net change is 12 static batches and 8,599 triangles. All batches use
existing material profiles, use no update callbacks, remain persistent while
near/detail chunks change state, and destroy their owned mesh buffers with their
parent. Three actual-renderer create/LOD/destroy cycles keep the material cache
stable. Shopfront BASE drops from 25 to 24 combined street/culture meshes because
its duplicate cyan street surface moves out; all 37 facade geometries remain.

## Preservation contracts

Regression hashes bind the pre-change facts:

- Street, roadside, side-gate and culture collider digest:
  `dee2d0168a23d5eb46101aac7a791fa43caef67ed21ecf5c1a3e177cb2ecd911`
- Street/culture/side-gate source centerline endpoint and width digest:
  `3248af2711a30bd3c5b33b0a39853e428746201ee8e5bc74a450c7a11f2becd9`

No layouts, source OSM data, colliders, navmesh, entrances, input/controller logic,
P7 road micro-details or shared material definitions are changed.

## Verification and remaining visual gate

The initial regression run failed on missing signal poles, solid divider bars,
generic surfaces and missing gate detail; it now passes. Additional reproduced
regressions cover coplanar culture paint, pole sleeves and four cross-owner
color conflicts. The cross-owner probe checks exact convex-polygon intersection
area, including thin crossing strips whose centroids do not intersect. Checks include finite,
upward, flat paint; exact visible pole anchors; bounded primitive/material counts;
open divider dimensions; deterministic builds; mesh destruction and stable cache.

Eight real `PlayerController` routes traverse the main/side crossing, side gate
and culture canopy in both directions with original collision/grounding and
restore prior inputs afterward. Existing street, gate, culture, 37-shopfront,
flat-ground and P7 geometry/material regressions also pass in focused runs.

Commands:

- `node --test apps/world/tests/backgate-road-*.test.mjs`
- `node apps/world/tests/browser/backgate-road-null-smoke.mjs`
- `node apps/world/tests/browser/backgate-shopfront-null-smoke.mjs`
- `node apps/world/tests/browser/backgate-restoration-fixture-null-smoke.mjs`

The road plan exposes four fixed views and reflected envelope corners for the
combined hosted fixture: main crossing, side crossing, side gate and culture
paving. Actual-camera projection checks pass for desktop, portrait and landscape,
with at least 2% viewport margin in the road-only Null fixture. Null-device checks
are geometry/lifecycle evidence, **not rendered-pixel or physical-device evidence**.
Hosted same-camera old/new images remain a separate publication/QA gate.
