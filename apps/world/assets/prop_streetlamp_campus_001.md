# PROP_STREETLAMP_CAMPUS_001 · Runtime Integration P2

## Authority and dependency

- Repository: `aldol2678/inhagame` (source-visible, All Rights Reserved)
- Depends on #56. P2 is stacked on `feat/world-bench-runtime-p1` at `78773942eea6ce2b82ea3aa0f0cc4fbcb12f3bb2`, not an independent main PR
- Main observed 2026-10-03 10:59 UTC: `27214d8d198f395f9796f0766719a9d5c7f0e597`; #57 adds Environment P0, but #56 was still unmerged. Neither #56 nor its base is rebased/merged by P2
- Resume check 2026-10-03 11:56 UTC: main is `7ce12e90a1a754a8de82f51b92b44416803cf8e8` (#57 day/night, #58 weather/fog, #59 mobile boot diagnostics). #56 remains the same unmerged Draft dependency. Its back-alley compatibility fix already matches main; no automatic merge/rebase or environment wiring is performed
- [Approved Asset Library root](https://drive.google.com/drive/folders/1yW7kdvmR3aBvt3NMMa0k-i8MWQBxMV8S)
- [Original runtime GLB](https://drive.google.com/file/d/1eR5O5uNy30D8zZBy5jh1HkK0vsYZRaHz/view)
- [Source BLEND](https://drive.google.com/file/d/13t3fbLxNcnn3YxJt4AEDEFRQTFZeaHst/view)
- [Original QA](https://drive.google.com/drive/folders/1eDSKlYQLdDBCZp_gwJ7GSlTsFtjWdu5R), [README](https://drive.google.com/file/d/1Uj_GtwZmepng7xm_h4DZQAkKgIgsXhGB/view)
- Asset Library status APPROVED; original Blender round-trip/Godot instantiate PASS. Those do not substitute for browser QA
- DOT_MEDIATED_MCP authoring: Blender4.3.2, server0.2.0, SDK1.30.0, protocol2025-11-25. Publication is explicitly requested by the owner, with no new license assigned

## Byte integrity

Drive download and repository copy are byte-identical: **12,736 bytes**, SHA-256 **`62c81c051fda70edaf155bdb0f68c2accd6f97854fc942bfe758f07a829b0575`**. GLB2, five meshes plus root, two materials,220 triangles, no external buffer/image URI, no imported lights. No re-export, recompression, source BLEND edits, or changed GLB materials.

## Reused contract

`WorldDocument → AssetResolver → createPlayCanvasRuntimeContext → URL-cached PlayCanvas container → instance` remains unchanged. `campus-static-prop-runtime.js` is the existing P1 lifecycle/status owner with its WorldDocument argument made explicit. Bench and streetlamp both use it; no loader, physics, generic asset framework or world-architecture redesign is added. The lamp-only material decorator is not part of a general material framework.

The document root and instance-local material belong to the prop instance. Cached GLB container/original materials remain owned by the existing PlayCanvas asset registry. Destroying an instance must not unload resources reusable by another consumer. Pending-load teardown waits for attachment, then destroys the root/context, including its material clone.

## Placement and transforms

- Zone: `AREA_JUNGSEOK_WOONAM`; lawn `site_218215618`
- Logical position: `[-0.6740967219938909,0.018,-13.46121105869368]`
- Document metre position: `[-1.3481934439877818,0.036,-26.92242211738736]`
- Yaw0°, quaternion `[0,0,0,1]`; entity scale `[1,1,1]`
- Parent `CampusBase → WorldDocument:world.campus-streetlamp-p2`
- Document-root scale `[.5,.5,.5]` under existing CampusCoordinateFrame Z reflection; no second metre scaling or axis flip
- Source bounds `[-.180000007,0,-.180000007]` to `[.700000048,3.5,.180000007]` metres, asymmetric+X head
- Expected runtime dimensions: `.440000027 × 1.75 × .180000007` WU (equivalent to `.880000055 × 3.50 × .360000014`m)
- Pole-centre origin sits on rendered lawnY=.018. Logical walking ground unchanged
- Lamp1.5WU east of bench; base-to-bench gap.96WU vs walker diameter.48WU. Head points away from bench. This is an authored game-layout estimate, not a surveyed campus lamp position
- Centre2.442WU from lawn edge;8.627WU from guidance network. No doorway, road, quest trigger, portal or NPC corridor is replaced

## Collision

Existing immutable `OBSTACLES` authority owns two minimum polygon prisms derived from the same document transform:

- `.base`: `.36 × .12 × .36`m at ground
- `.pole`: `.13 × 3.340001 × .13`m, fromY=.06m to3.400001m

Head/arm have no collision; no triangle mesh physics. The base is wide only at ground level, avoiding a full-height base-width wall. NPC grid uses both; existing campus guidance includes the tall pole and excludes low base/bench. Flight and camera reuse existing height-aware checks. Existing camera triangle padding is deliberately unchanged and is more conservative than walking collision.

## Lighting decision

**P2 visual integration = emissive-only**

Original `Lamp_Diffuser` has no emissiveFactor, so imported emission is black. On instantiation, only the diffuser is cloned; clone emissionRGB`[.92,.8,.55]`, intensity`.35`. Original base colour/PBR data remain inherited. This is a modest self-lit diffuser, not illumination of the ground. The clone is destroyed with its visual; the cached source remains black/unmodified.

- Added point/spot light count:0
- Range/intensity/color/shadow of realtime lamp: not applicable
- Added realtime shadow lights:0. Existing sun/mesh shadow policy is unchanged
- Dependency base has the existing campus directional sun. Shadowless omni-light patterns already exist in personal-room, dorm1-lobby, club-room and event-room renderers, scoped to those room roots. They establish engine capability, not a campus streetlight budget or lifecycle contract; P2 deliberately does not copy them
- Current main has #57 Environment P0 `createEnvironmentDirector`, manual day/sunset/night presets and interpolated sun/ambient/exposure. That does not exist in the mandated #56 base; P2 does not cherry-pick/rebase it
- Future hook: after dependencies reconcile, Campus Lighting System P3 may consume environment target/settled state and establish explicit finite light budgets. P2 adds no schedule, automatic on/off, lighting engine or new day/night contract

## Reproduction and acceptance evidence

- `node --test apps/world/tests/campus-bench.test.mjs apps/world/tests/campus-streetlamp.test.mjs`
- `node --test apps/world/tests/*.test.mjs`
- `bash scripts/public-ci.sh`
- `bash scripts/public-db.sh` only in the CI disposable database
- `WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/campus-streetlamp-smoke.mjs`

The browser smoke uses actual Chromium/full Campus/PlayerController in the existing offline harness. Backend/Supabase traffic is isolated. It checks desktop1440×900, portrait390×844, landscape844×390; actual GLB200, imported material/clone emission, grounded bounds/scale, four-direction collision/retreat, a walking circuit, rendered meshes/framebuffer delta, reload, all streamed-chunk eviction/recreation, one persistent instance/container, and unchanged light counts. Three screenshots and a JSON report are uploaded by the asset CI workflow. The PR records exact-head pass/fail evidence; this document alone is not an execution receipt.

Persistent BASE scenery is intentionally not destroyed when NEAR/DETAIL chunks unload. Browser tests must show the same lamp survives those chunk transitions, never a second lamp. Shared owner unit tests separately destroy/recreate the actual adapter document and verify delayed disposal, load failures, cache reuse, and cloned-material cleanup.

UNVERIFIED unless separately evidenced: real mobile touch hardware, WebGPU hardware, full mounted/flight gameplay, exhaustive manual camera orbit, online/deployed gameplay, LOD. No invented FPS claims. No merge, manual deploy, Production mutation or live DB change.
