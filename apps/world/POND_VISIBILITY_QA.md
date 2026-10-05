# Pond presentation and campus orientation regression

Current scope and release status: see `BASIC_CAMPUS_QA.md`. The user authorized merging
private PR #68 with the existing Agora source-location conflict retained as a separate TODO.
The functional checks below do not resolve that geographic identity conflict.

Baseline: `020ad1b9f36696bb41eb4b23ab73f6b33b39c1ed`.

Production inspection found the pond visible, but its flat diffuse-only material read as a
painted patch. The user clarified that the Main Hall/pond left-right relationship was also
reversed. With east = +X, north = +Z and Y up rendered directly, looking north put east on
the left. This was a campus-wide handedness error, not an incorrectly translated pond.

The render boundary now maps campus `(x, y, z)` to PlayCanvas `(x, y, -z)`. Player movement,
collisions, zone lookup, tour stops and canonical polygons remain in campus coordinates.
Camera placement, camera-relative controls and tour bearings use the same convention.
`player.getLocalPosition()` is the gameplay position; `player.getPosition()` is rendered
world position (used by the name label). All streamed geometry shares the reflected root.

The water retains the exact 13 canonical boundary vertices, 11 triangles and Y=0.025.
It uses a small procedural normal texture, sky-colour reflection, specular highlights and
slow UV movement. It stays opaque and below the Agora slab and walkways. No island, gazebo,
shoreline displacement, collision or swimming feature is added.

## Runtime checks

Run the existing Node checks, then start `node apps/world/dev-server.mjs` with `PORT=4187`.
Run `node apps/world/qa-pond-browser.mjs` with Playwright and Chrome available.

- `PLAYWRIGHT_MODULE`: optional absolute path to an existing Playwright `index.mjs`.
- `POND_QA_URL`: local/Preview/Production origin; defaults to `http://127.0.0.1:4187`.
- `POND_QA_OUTPUT`: screenshot/report directory; defaults to `pond-qa`.

The browser check uses real PlayCanvas/GPU buffers, keyboard/touch input, camera projection
and controller/collision traversal. Only analytics requests are intercepted. It runs desktop,
mobile emulation, and WebGL2 fallback (WebGPU is disabled in that context). It checks east
appears right while looking north, right input at two camera angles, water shading and UV
movement, mesh winding, AABB, ground separation, camera layers, tour completion and a real
ACTIVE → NEAR → UNLOADED → ACTIVE traversal with a newly built pond entity.

Campus pond envelope: X=103.4154..141.2942, Z=-4.60224..46.74761.
Rendered AABB after the frame conversion: X=103.4154..141.2942, Z=-46.74761..4.60224.
The change of Z sign is a coordinate conversion; the geographic polygon has not moved.

Screenshots include normal-distance Agora/shore views, NEAR/return views and a Main Hall/pond
layout view within the user's camera zoom limits. Inspect them: assertions alone do not prove
that the water is visually recognizable. Mobile emulation does not certify physical devices.

## Investigated failure modes

- Ground/depth: baseline water Y=0.025 is above ground Y=0; no elevation workaround needed.
- Mesh/layer/winding: one enabled instance on world layer 0, 11 upward local triangles;
  actual Chrome WebGPU and WebGL2 frames are inspected after the reflected-root change.
- Material: baseline used the same diffuse-only material helper as ordinary blockout surfaces.
- Streaming: assertions require destruction at UNLOADED and recreation on return.
- Assets: Production adapter, central blockout and canonical JSON SHA-256 matched baseline Git blobs.
- Camera: baseline rendered geographic east to screen-left looking north; the regression
  assertion failed before the coordinate-frame fix. The reflective-water assertion also
  failed on the original material before the presentation change.

No new geographic research or canonical-data changes are part of this patch. Existing
illustrative Main Hall footprint, paths and fixtures remain illustrative blockout geometry.
