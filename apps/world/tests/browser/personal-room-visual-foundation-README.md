# Personal room visual foundation: real-render QA

This isolated fixture builds `createPersonalRoomScene` from the selected source tree. It uses the actual PlayCanvas 2.22.4 WebGL2 renderer, optional room texture/model loaders, empty Collection-owned furniture, room ambient, and room practical lights. It never creates an account or writes persistent furniture.

## Run in a supported browser environment

Install the already-pinned dependencies in `apps/world/tests/browser` through the repository's usual approved setup. Run from the repository root:

```sh
ROOM_VISUAL_QA_OUTPUT=/path/to/evidence/candidate \
  node apps/world/tests/browser/personal-room-visual-foundation-smoke.mjs
```

For a baseline source tree with the same engine pin:

```sh
ROOM_VISUAL_QA_WORLD_ROOT=/path/to/baseline/apps/world \
ROOM_VISUAL_QA_OUTPUT=/path/to/evidence/before \
  node apps/world/tests/browser/personal-room-visual-foundation-smoke.mjs
```

The new fixture is route-served from this checkout even when the source root is the untouched baseline. The existing offline harness provides its pinned engine and stubs/blocks nonlocal requests. The optional model and floor assets therefore must be present in the selected source tree.

Outputs are a JSON report and actual browser screenshots for three fixed cameras at desktop 1440×900 and portrait 390×844, separately for loaded and intentional loader-error modes. The loaded mode requires all four model loads (the fixed-chair GLB and three decor glTFs) and the floor texture to return true, populated enabled model hierarchies, and disabled fallbacks. The fallback mode injects errors at AssetRegistry.loadFromUrl, requires the exact five URL/type calls and false results, absent imported models, and visible populated fallbacks. This is deterministic loader-error coverage, not an HTTP/network-failure test. The shared harness error checks stay strict. A loader parse/prepare error cannot pass as successful visual loading.

The existing Housing browser QA workflow checks out the exact PR head, runs both NullGraphics lifecycle and real ContainerHandler parsing checks, and runs this browser gate with pinned Chromium/SwiftShader. Its uploaded head-sha.txt, report, and screenshots identify the tested candidate. Portrait is a browser viewport, not physical-mobile validation; software WebGL2 does not establish GPU performance.

The strict loader contract targets this V2 candidate; older baseline sources lacking the same model contract are expected to fail it and must not be presented as a passing gate. `entry` and `sleep-study` retain the room shell. `cutaway` hides roof, near walls and their trim/door/ceiling-light visuals only for geometry inspection. It is never the playable-room view.

## Evidence boundary

A WebGL device error is a failure/blocker, never a pixel pass. The cloud browser checked on 2026-10-10 reports WebGL2 disabled or unavailable, and the separately reported local Chromium launch restriction was not bypassed. This browser script has been syntax checked but has not passed here.

An optional Blender CPU comparison may be supplied separately. It uses actual source-derived meshes captured with PlayCanvas NullGraphicsDevice, including world transforms, normals, UVs, material values, and authored texture bytes. That comparison is only an offline geometry/material preview. It does not prove PlayCanvas shader output, GPU frame cost, alpha sorting, culling, downloaded GLTF or floor-image assets, device loss, or actual game camera behavior. Keep those images explicitly labeled and do not substitute them for this browser gate.
