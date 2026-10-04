# P7C campus contact shading pilot

Static, texture-free contact shading under the main hall and Jeongseok library
walls, four library-garden benches and nine ordinary trees owned by `RC_0_0`
and `RC_-1_-1`. This is a small presentation proxy; existing directional-light
shadows, P7A surface materials and P7B road details keep their own owners.

## Scope and geometry

- Two selected building footprints drive narrow outward strips. Entrance and
  west-facade edges with independent steps/parking/columns are omitted.
- Benches receive small elliptical shadows on the actual garden floor at
  `GARDEN_FLOOR + 0.0015` (−0.5985), not on the gameplay y=0 plane.
- Tree shadows follow the two owning NEAR layers and their existing fade values.
- Supported receivers are the persistent foundation (y=0), original lawn
  polygons (y=0.018) and garden floor. Foundation and lawns are exclusive.
- Water, lowered basins, paths, road margins, ground facilities, stairs and
  overlapping ground-level obstacle footprints are subtracted exactly.
  Unknown/raised paving is omitted rather than guessing a support height.
- Convex half-plane clipping interpolates opacity at generated vertices.
  Receiver triangles and cutouts retain concave boundaries. Previously emitted
  coverage is subtracted to avoid darkening the same surface twice.

No additional lights, colliders or external textures. The shader uses black,
unlit alpha blending with vertex alpha; depth testing remains enabled and depth
writing, shadow casting and receiving are disabled. Alpha blends in its own
pass and does not enter the existing opaque fade-material clone/dither loop.

## Bounded cost

| Layer | Triangle cap | Current generated | Render mesh/entity/material |
|---|---:|---:|---:|
| BASE building/bench batch | 300 | 283 | 1 / 1 / 1 |
| `RC_-1_-1` NEAR trees | 260 | 258 | 1 / 1 / 1 |
| `RC_0_0` NEAR tree | 40 | 36 | 1 / 1 / 1 |
| Total | 600 | 577 | 3 / 3 / 3 |

Current vertex/index buffers: 72,702 bytes; combined cap: 256 KiB.
Low quality displays only BASE (one potential color draw); medium/high display
up to three batches. Resident NEAR buffers can remain allocated on low until
their chunk is unloaded. Frustum culling can reduce submitted color draws;
the design adds no shadow-map draws. These are bounded geometry/resource
counts, not a measured hardware frame-time claim.

Only alpha/enabled state changes during quality, chunk fade or weather changes.
No per-frame mesh regeneration. Snow accumulation linearly suppresses contact
opacity from 0 to 0.14 and then hides the batches, avoiding original-ground
shadows over raised snow. Normal opacity returns as accumulation melts.

## Lifecycle and QA

BASE has one owner. Each selected NEAR handle owns its mesh/material; removal
destroys both and unregisters the controller entry. Re-entry reconstructs only
that NEAR batch. Global `surface()` cache materials remain unchanged.

`window.__INHAGAME_CONTACT_SHADING__.status()` exposes actual resource counts,
source IDs, caps, quality, accumulation and fade. Preview/local hosts also
expose `setEnabled(bool)` and `?contactShading=0` for comparison. Production
offers the status snapshot only, using the existing preview-host boundary.

Verification:

- Five pure-geometry/policy tests: narrow crossing masks, overlap rejection,
  whole-object caps, snow/quality/fade composition and current pilot inventory.
- Browser smoke: real mesh/material properties, finite buffers, three batches,
  low/high toggle, explicit disable, three unload/re-entry cycles, stable BASE
  resources, unchanged shared material cache, actual snow accumulation/melt.
- The existing World asset optimizer job runs the new smoke; no new job.
- Local software Chromium/WebGL2 exercised the runtime. Physical WebGPU/mobile
  GPU timings are unmeasured. The proposed +0.5 ms median/+1 ms p95 hardware
  targets remain a follow-up measurement, not a claimed PASS.

Local commands:

```sh
node --test apps/world/tests/campus-contact-shading.test.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/contact-shading-smoke.mjs
bash scripts/public-ci.sh
```

For local Chromium installations the harness optionally accepts
`WORLD_SMOKE_EXECUTABLE_PATH`. Screenshots are opt-in through
`WORLD_SMOKE_CONTACT_SCREENSHOTS`; they are local QA outputs, not app assets.
Streetlamp contact shadows and other campus trees remain a later expansion.
