# Approved campus bench: Runtime Integration P1

## Source and scope

- Asset Library ID: `PROP_BENCH_CAMPUS_001`, registered `APPROVED` / `PASS`
- [Authoritative runtime GLB](https://drive.google.com/file/d/11QRGLk1c3xvNphczcCZXsd7hVPWcrbbZ/view)
- [Asset Library record and historical QA](https://drive.google.com/file/d/1_1_KimIYNGymszjqg1AK8G0lYq_SrvGo/view)
- [Editable Blender source](https://drive.google.com/file/d/19odwrYIXj8J7iQmuMU9ZSTsF5RPlex8d/view)
- Repo/runtime URL: `apps/world/assets/prop_bench_campus_001.glb` / `/assets/prop_bench_campus_001.glb`
- Source and repository SHA-256: `765066e241469666dcc7671a994968b63e9899886cd3bb0f315b305995e5a74d`
- Size: 128,636 bytes; GLB 2; 972 triangles; 2 meshes and 2 materials; embedded WebP plus PNG fallback; no external resource URI
- The original bytes are unchanged. No re-export or Blender/Godot processing was performed for this integration
- Baseline: public `aldol2678/inhagame` main `0e25a22d9b129240de82080f2edd6801fb5e2afd`, freshly resolved on 2026-10-03 UTC

Historical standalone Godot acceptance does not establish browser gameplay acceptance. This PR adds only this bench. It does not add the streetlamp, sitting, NPC interaction, rewards, a physics engine, or an asset framework.

## One placement authority

`src/campus-bench-layout.js` supplies one ordinary WorldDocument 0.1.0 asset and one `core.renderable` entity. The existing schema, `AssetResolver`, `loadWorldDocument`, `createPlayCanvasRuntimeContext`, and PlayCanvas container registry do the loading. There is no parallel GLB loader or probe-specific schema.

The source placement is the vertex-average center of the existing rendered lawn `SITE_FEATURES.site_218215618`. This is an intentionally estimated game placement, not a claim about surveyed campus furniture.

| Property | Value |
| --- | --- |
| Semantic zone | `AREA_JUNGSEOK_WOONAM` |
| Entity | `prop.campus-bench-001` |
| Parent chain | `CampusCoordinateFrame` → `CampusBase` → `WorldDocument:world.campus-bench-p1` → bench |
| Document position, metres | `[-4.348193443987782, 0.036, -26.92242211738736]` |
| Campus logical position, world units | `[-2.174096721993891, 0.018, -13.46121105869368]` |
| Local yaw / quaternion | `0°` / `[0, 0, 0, 1]` |
| Authored entity scale | `[1, 1, 1]` |
| Document root scale | `[0.5, 0.5, 0.5]`, because one campus unit is two metres |
| Existing campus-root scale | `[1, 1, -1]`; no second Z reflection is added |
| Source axes / origin | Y-up, right-handed, feet at Y=0 |
| Source bounds, metres | `[-0.9, 0, -0.33]` to `[0.9, 0.8, 0.24]` within GLB float precision |
| Logical dimensions | `0.9 × 0.4 × 0.285` world units |

The `.018` placement height matches the current `buildCampusGrounds` lawn surface. The existing logical walking ground stays at zero. The asymmetric source Z bounds are preserved. The footprint is wholly inside visible lawn; the nearest canonical navigation edge is about 7.31 world units away and the nearest generated tree is about 4.70 away. No quest, spawn, portal, road, staircase, or entrance is moved.

## Collision and ownership

The current authority is the statically initialized, frozen `campus-layout.js` `OBSTACLES` list. The bench contributes one conservative rectangular polygon plus `minY/maxY`, derived from the same transform and GLB bounds. Its box intentionally fills slat and leg gaps. There is no visual-triangle collider and no independently authored collision position. The historical Godot two-box wrapper is not imported.

- Walk, grounded mounts, height-aware flight/landing and chase-camera collision use the existing `world-collision.js` functions
- Static registration occurs before `PlayerController` captures its no-bike obstacle snapshot and before the NPC navigation grid is built
- Campus guidance deliberately ignores low props below 1.2 world units. The bench remains off that graph; no navigation policy is changed. The NPC occupancy grid includes it
- The bench is persistent BASE scenery. Chunk NEAR/DETAIL eviction and rebuilding do not instantiate or remove it
- `campus-bench-runtime.js` owns the document instance and its context materials, including disposal requested during an in-flight load. PlayCanvas retains ownership of its shared URL-cached container until application teardown; disposing one instance does not unload shared assets

P1 requires identity yaw. A future rotated prop must derive its collision footprint from the same transform and add coverage; do not rotate the visual while leaving the current axis-aligned proxy unchanged.

## Verification and known limits

Local checks:

```sh
node --test apps/world/tests/campus-bench.test.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
bash scripts/public-ci.sh
```

Offline browser QA, using the repository's existing harness:

```sh
npm ci --prefix apps/world/tests/browser --ignore-scripts --no-audit --no-fund
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/campus-bench-smoke.mjs
```

The `World asset optimizer` workflow runs this browser command and uploads `campus-bench-browser-evidence` (JSON and desktop/portrait/landscape screenshots). It checks real Campus boot, HTTP 200 GLB delivery, material/mesh counts, finite world bounds and dimensions, inherited axis reflection, renderer visibility plus a bench on/off framebuffer pixel difference, four actual PlayerController approaches and retreat, chunk eviction/reentry, and a full page reload. It reuses the offline harness: Supabase is stubbed, API calls return fixture responses, and other off-origin traffic is blocked.

Treat a browser case as VERIFIED only when its exact-head CI result and artifact confirm it. Local Chromium launch in the implementation workspace was blocked by `socket() EPERM`; the official Playwright browser download was truncated. Node tests alone are not visual evidence. The hosted test uses WebGL2 software rendering: real WebGPU hardware, physical mobile touch gameplay, all mount interactions, and every dynamically selected NPC route remain UNVERIFIED. No FPS claim is made. Resource checks cover one container/instance and duplicate-free reload rather than a performance benchmark.

Drive and Notion were read-only. This change makes no database, permissions, authentication, production deployment, release, or PR-merge change. Existing CI may replay its disposable local test database; it does not access production.
