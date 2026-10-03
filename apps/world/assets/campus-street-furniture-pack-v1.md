# Campus Street Furniture Pack v1: batch runtime integration

Depends on #56 and #60. This branch is based on the actual #60 head
`f60dcbb4d6c183da4f202255ed66bd3b061bcf77`, not current main or lighting P3.
Public main observed 2026-10-03 14:35 UTC was
`65eaf5480244b8c9acc75010a5bda37b3b8917be`. Both prerequisite PRs were open Drafts.
This change does not merge, rebase, deploy, migrate a DB, or change permissions.

## Asset authority and integrity

Six user-approved DOT batch source GLBs were copied unchanged after original
portable GLB, Blender round-trip and Godot import evidence was resolved by file
readback. All six Drive runtime downloads match repository bytes and SHA-256.
No re-export/recompression, textures, animation, camera, light or external URI.
Asset-authoring QA is provenance, not proof of browser/runtime acceptance.
Source geometry total: 1,444 triangles / 90 meshes / 14 materials.

| Asset | Library folder | Drive GLB | Drive/repo bytes | SHA-256 | Match |
|---|---|---|---:|---|---|
| PROP_TRASHBIN_CAMPUS_001 | [folder](https://drive.google.com/drive/folders/1KJ6nTWQG3l3I9DfIxdYmzPiQGL290WRx) | [GLB](https://drive.google.com/file/d/1FY3iQMUMNlEqHCDH_R3AUSD5CVcXOxW4/view) | 9528 / 9528 | `48fec26a8e0b948b816dbea136f25668092f506fa8a02f1ca416a6469e24267e` | MATCH |
| PROP_BOLLARD_CAMPUS_001 | [folder](https://drive.google.com/drive/folders/18wPe2qyO0E7RjsGfrFk5Nbkpeq28eNEG) | [GLB](https://drive.google.com/file/d/16qpR9d_bWn_8qILI3r7OMzNk_TX_5fbd/view) | 10628 / 10628 | `6e2be5f12e68ae2fc9d68961cc42112731539103c98f0ce1584aa555667d88b9` | MATCH |
| PROP_BIKERACK_CAMPUS_001 | [folder](https://drive.google.com/drive/folders/1cLvJqm3HhSO1ZseuAA51CbDkNJkMFPf8) | [GLB](https://drive.google.com/file/d/1V4HgBLIVTAjd9qOfMFthx0hT4Fpzfet1/view) | 16028 / 16028 | `71fdd39606a9895985b1930f0146c52310d4a83a45d23ed446174a6e7e4d5005` | MATCH |
| PROP_PLANTER_CAMPUS_001 | [folder](https://drive.google.com/drive/folders/1mPexN4bCIn2Je8y3CgWZviI2YZKgpAid) | [GLB](https://drive.google.com/file/d/1CxhskSQw392qokWSnqRxUKsEwCS-zjLJ/view) | 25020 / 25020 | `f3ea8d22be93d29f1e7d69330436224696e1ce3c23efd7057fbef32304d4708a` | MATCH |
| PROP_SIGN_CAMPUS_001 | [folder](https://drive.google.com/drive/folders/1WznUbFpdAqu0R_TKLckr3g_0o-2imcSz) | [GLB](https://drive.google.com/file/d/1Vl8hPSvV1zA4EKmQ9N4G0VSRO02TfScr/view) | 36508 / 36508 | `d0f4b15cc47600f0706f3e22d6860190f604d6d29e9881af9a803bba1c8b2a8b` | MATCH |
| PROP_VENDING_CAMPUS_001 | [folder](https://drive.google.com/drive/folders/1cJa5Yp2O3i_jlhu4RvypFZKipRF9DH3Y) | [GLB](https://drive.google.com/file/d/17t5dv57x2qKqJekNJcMLQqkrJ2er4f3n/view) | 24288 / 24288 | `4898b5529c659a8753ad2fcc34c7b43e118b997296f29506e48e562782e20f33` | MATCH |

## Contract and coordinate authority

`campus-static-props.js` is the single six-prop definition/placement authority.
It derives one existing WorldDocument 0.1.0 with six assets and six entities.
`createCampusStaticPropRuntime` → `loadWorldDocument` → `AssetResolver` →
`createPlayCanvasRuntimeContext` → the existing PlayCanvas container loader.
The shared owner changes only batch status reporting (`assetIds`; singleton
`assetId` remains compatible, batch `assetId` is null). No new runtime helper,
loader, physics engine, schema, per-asset runtime wrapper or asset framework.

Each entity has identity scale, standard yaw quaternion, document coordinates
in metres; the document root under persistent `CampusBase` has scale 0.5.
`CampusRoot` supplies the existing one-time Z reflection. Logical collision
coordinates must not receive that visual reflection. Authored XYZ dimensions
are width/height/depth; original batch spreadsheet uses width/depth/height.
The expected local-axis rendered dimensions are authored dimensions ×0.5.
Rotated world AABBs are checked against each original mesh POSITION bound,
not a misleading rotated aggregate box. Ground contact is render-surface
height, separate from the existing physical ground-height convention.

Placements are game-layout estimates based on the current campus geometry,
not surveyed real street furniture. They are dispersed over rest lawn,
vehicle-road boundary, library parking apron, raised Agora edge, a junction
lawn and the main-hall side apron. The two aprons replace initially considered
bare-terrain locations because this dependency base has no generic terrain
renderer. No synthetic showroom floor is added. Exact positions, yaw, site,
semantic zone readback, surface, physical ground and render offset are recorded
in the manifest and browser JSON. A position may resolve to a nearby semantic
zone rather than its nearest building label.

## Static collision and interaction boundary

One oriented box per prop, using original local bounds except the sign's
minimum ground-through-pole proxy (0.09m ×1.82m ×0.09m). No visual-triangle
collision. Vending preserves its asymmetric Z bounds [-0.375,+0.4425]m.
Bollard stays within its 0.19m footprint; rack stays within 2m ×0.56m.
Existing `OBSTACLES` owns these six persistent proxies exactly once.

The sign panel and broad foot are deliberately non-solid. This is not a
complete silhouette collider for camera or airborne mounts. Unit-level
walking/mount/flight-height/camera consumers are exercised; full mount/flight
and dynamic NPC gameplay remains unverified. Existing navigation height filters
exclude all six: raised planter minY >0.5, other props maxY <1.2. They are placed
outside guidance corridors, not advertised as dynamically rerouting guidance.
The NPC grid has a different height filter; exhaustive NPC route behavior is
not an acceptance claim.

Vending and sign are static visuals only. No purchase UI, inventory, quest,
marker, dialogue, reward, economy or interaction is implemented.
Original GLB materials are used unchanged, with no override or material clone.
No realtime light or added shadow caster. Both are future Interactive Props P1
candidates: vending needs explicit catalog/transaction/authority design; sign
needs explicit navigation/content/accessibility design before interaction.

## Ownership, performance and repeatability

All six instances belong to one persistent BASE WorldDocument. Chunk eviction
and recreation must leave one of each entity/container, while real streamed
chunks disappear and return. Page reload must recreate one of each; source
resources are app-registry/cache owned, not disposed by a visual instance.
Pure adapter tests additionally exercise explicit owner dispose/recreate,
pending disposal and one failed asset among six. The failed URL is removed
from cache so it cannot poison later attempts. No FPS/GPU speed claim.

## Reproduction and evidence

- `node --test apps/world/tests/campus-{bench,streetlamp,static-props}.test.mjs`
- `node --test apps/world/tests/*.test.mjs`
- `bash scripts/public-ci.sh`
- `bash scripts/public-db.sh` (disposable local stack only, no production DB)
- `WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/campus-static-props-smoke.mjs`

The existing hosted asset/browser workflow also runs bench/streetlamp regression
and four asset smoke suites. Batch evidence uploads as
`campus-static-props-browser-evidence`, including JSON and views at 1440×900,
390×844 and 844×390. The harness serves the actual campus source and six GLBs,
pins PlayCanvas, stubs API/Supabase and blocks other off-origin traffic. No
production runtime is contacted and no authenticated backend writes occur.

A written test or passing Node suite alone is not a browser acceptance result.
Use the exact-head CI artifact/PR report for observed status and screenshots.
Viewport emulation can be verified; real mobile touch, WebGPU hardware, online
multiplayer, live deployed gameplay and all collision consumers remain separate
unverified states. No Production deploy or merge is part of this PR.
