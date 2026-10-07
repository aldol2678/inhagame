# Inkyung fishing visuals v1

Original low-poly geometry and atlas art authored for INHA WORLD on 2026-10-07. Runtime files
are byte-for-byte copies of the approved fishing asset pack; no GLB re-export or texture changes.

- Rod/reel: 3,432 triangles, 3 material surfaces
- Float: 360 triangles, 1 material surface
- Crucian fish: 1,148 triangles, 2 material surfaces
- Total: 4,940 triangles. Embedded COLOR_0 palette, no external model dependencies or required extensions
- GLBs are metre/Y-up. The runtime applies `metersToWorld(1)` (0.5) exactly once on each instance
- `atlas.json`: original 8-frame/4-by-2 atlas metadata. Ripple 8 fps, splash 12 fps; straight alpha/sRGB
- SHA-256 values are pinned in `src/activity/fishing-visuals.js`; the tests verify the committed bytes

## Runtime contract

`fishing-renderer.js` reuses `createEquipmentModelLoader` and PlayCanvas's existing registry cache.
Temporary entities and cloned materials belong to this local presentation. Containers, meshes and
textures remain registry-owned. A dedicated Activity_Grip_R is a child of Equipment_Frame; it does
not replace a wardrobe slot or depend on an internal fallback/GLB avatar node.

`fishing-visuals.js` observes the existing fishing client and `fishingPhase`. Only a server STARTED
outcome casts; a replay/refresh resumes the current phase. A new authoritative SUCCEEDED hook shows
the fish while settlement remains owned by the original client. Close, cancel, account change,
hidden character/scene/document, BFCache suspension and disposal remove the presentation without
sending a server action. Server timings, requests, rewards, collection and skill IDs are unchanged.
The line is one immediate PlayCanvas line between the model sockets; there is no fishing physics.

Shore targets are derived from the two existing spots and checked against the canonical pond polygon.
Water elevation comes from the same surface geometry producer used by central-blockout. Campus
reflection and body rotation are handled in matrix/local space rather than a world lookAt quaternion.

## Verification and limits

- `node --test apps/world/tests/*fishing*.test.mjs`: phases, replay and delayed settlement, lifecycle,
  stale async loads, partial setup rollback, owned/shared resources, hashes and atlas sampler state
- `node apps/world/tests/browser/fishing-engine-contract.mjs` after installing the existing pinned
  browser-test dependencies: real PlayCanvas 2.22.4 GLB parsing, buffers, material surfaces/COLOR_0,
  actual scale/socket/shore matrices and cache survival. Uses NullGraphicsDevice, so this produces
  no GPU pixels and is not browser visual acceptance
- To reuse an installed pinned module for that CPU check, set PLAYCANVAS_MODULE to its module URL

The grip offset is an initial art placement. Real duck/fallback visual fit, actual shader appearance,
first/third-person camera occlusion, night/rain readability, mobile/low-end WebGL2 and GPU device-loss
restoration still require browser visual QA. No public push, PR, production deployment or DB change
is part of this local integration.
