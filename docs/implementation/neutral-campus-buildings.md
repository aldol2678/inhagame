# Neutral campus building reconstruction

## Scope and source

The 21 public campus facilities render a new generic facade over their existing
footprints and gameplay height estimates. The main hall and library retain their
existing renderer. Surrounding shops, third-party imagery, private facade recipes,
model assets, terrain, navigation and colliders are outside this change.

The committed public manifest was submitted to WorldForge Draft
`chg_eaa29a3ddf25f7d38bd8d683479ed947` (version 1). Native readback matched all
21 logical buildings / 62 mass parts, including 42 courtyard-preserving parts for
5호관. The retained main hall and library make the Draft total 23 logical buildings
and 64 masses. Structural validation passed with no issues. The Draft has not been
promoted; WorldForge preview and capability validation were not run. See the
adjacent manifest/provenance JSON under `apps/world/data/reality/` and `NOTICE.md`.

`worldforge-campus-building-import.js` consumes the committed manifest at runtime.
It converts meter/+Z-south coordinates exactly once to legacy world units:
`x=xWF/2`, `z=-zWF/2-90`, `height=heightMeters/2`. Imported rings and roof parts
are the render input. Before use, their geometry must match the unchanged canonical
gameplay source. Rings preserve outer/hole roles; courtyard parts are compared as
a one-to-one set allowing cyclic rotation and winding reversal. Any mismatch fails
explicitly instead of displaying a building inconsistent with its collider.

## Rendering and resource limits

Three ID-selected generic window rhythms share one neutral palette. Public floor
counts are retained as presentation parameters; this is not a claim of surveyed
dimensions or exact real-building appearance.

The existing chunk system controls residency and fades:

- BASE: coarse exterior/courtyard walls and hole-safe roof caps, 42 meshes,
  2,469 vertices and 823 triangles across all 21 buildings
- NEAR: coplanar window and trim decals, 42 meshes, 29,262 vertices and 9,754
  triangles if all 21 are resident; no duplicated wall or roof geometry
- DETAIL: no additional neutral facade geometry

These counts exclude unchanged entrances, signs, furniture and surroundings.
Two BASE materials and two NEAR source materials are shared. The existing chunk
fade clones NEAR materials per resident chunk and disposes them on destruction.
NEAR source materials have `depthBias=-1` and `slopeDepthBias=-1`; the decal
coordinates themselves remain on the exact footprint and within the existing height.
Budget reductions are geometric counts, not measured FPS claims.

## Verification

Focused tests:

```sh
node --test apps/world/tests/neutral-campus-buildings.test.mjs
```

They cover the manifest hash, geometry parity, courtyard roof area and movement,
finite/bounded surfaces, complete wall coverage, winding/Z reflection, floor rows,
determinism, scope, render-tier budgets and stale-import rejection.

Aggregate checks:

```sh
bash scripts/public-ci.sh
```

Offline browser harness (uses the pinned PlayCanvas/Playwright dev dependencies):

```sh
cd apps/world/tests/browser
npm ci --ignore-scripts
node neutral-campus-buildings-null-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_NEUTRAL_QA_OUTPUT=/tmp/neutral-buildings \
  node neutral-campus-buildings-smoke.mjs
```

The smoke exercises the actual facility renderer, BASE/NEAR material reuse,
destroy/recreate cycles, bias retention on cloned fade materials, and both the
production negative-Z root scale and an unreflected control. It captures an overview,
5호관 exterior/courtyard, 60주년기념관 and first-dormitory views.

The complementary null-device smoke uses the real pinned PlayCanvas mesh/material
classes without a browser. Three create/destroy cycles verify material reuse, the
actual mesh/vertex budgets and preservation of decal bias when a material is cloned.
This check passes locally but generates no pixels and does not establish appearance.

Browser verification is still a release gate: this cloud executor's Chromium aborted
before page startup with `socket() failed: Operation not permitted`, including the
permitted escalation attempt. No screenshots, visual approval, depth-bias appearance
verification or browser PASS are claimed by this candidate. No deployment is included.
