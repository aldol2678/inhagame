# Personal Room V2 · visual foundation candidate

This is the first visual-foundation slice from `PERSONAL_ROOM_V2_VISUAL_QUALITY.md`.
It is not the full V2 milestone or a release approval.

## Scope

- Keep C / Creative Open Creator shell dimensions, the open center, and the existing fixed fixture anchors.
- Replace placeholder bed geometry with an oak frame, rounded mattress, pillow, teal duvet and sewn edges.
- Give the desk recognizable joinery/legs, and reinterpret the existing storage footprint as a west-facing cabinet with doors and shelving.
- Add a recessed north window, frame, glass, shallow exterior layers, rail and softly folded open curtains.
- Use one room-owned paint / oak / linen / metal / glass palette. Small deterministic wood and weave maps add surface variation without remote asset requests.
- Frame the existing two practical lights. Keep their non-shadowed budget and the optional decor layer.

The uploaded bedroom photograph is a visual-quality reference. It is not a measured layout or a source texture; no pixels from it are shipped.

## Gameplay and editing seams

`personal-room-layout.js`, all saved placement schemas, collision boxes, room UUID/session/privacy behavior, spawn, exit and the 32-object limit are unchanged.
The storage upgrade fits the old 0.6 × 1.25 × 1.5 collider. A separate full-height wardrobe would need an explicitly reviewed footprint/collision change; none is silently placed in walkable floor.

`personal-room-renderer.js` is the composition root. `personal-room-fixtures-v2.js` creates one stable `personal_<id>` anchor at each existing fixed-furniture transform. Future default-furniture move/rotate editing should move these anchors only after its own ownership, collision and persistence design is approved. Visual meshes do not create placement authority.

The new material factory owns only its own materials and procedural textures; it never destroys shared campus materials or AssetRegistry resources. Each procedural fixture/window mesh follows its entity lifecycle. The fixed chair now uses a self-authored oak/linen GLB and a geometry-identical fallback. Successful GLB loads bind the same room-owned materials, so the old chair style cannot return. Optional decor retains its existing imported models and fallbacks. The original floor loader and its color-only recovery override remain intact.

No new permanent sofa, monitor, bookshelf catalog item, trophy shelf, Study Books set or other F0 grant is added. Existing desk/bed placement surfaces and chair position/support height remain authoritative. The fixed chair now faces the desk in both its rendered orientation and seated-avatar pose, with a separately validated room-side approach/stand corridor. Collection-owned chair rotations remain unchanged.

## Deliberately later

World-time lighting, curtain/light controls, mirrors, avatar reflection, new collision footprints and default-furniture editing are separate slices. Curtains are fixed open in this candidate. The small switch is visual only. The exterior is a shallow stylized view, not a second campus render.

## Reproduce validation

- `node --test apps/world/tests/*.test.mjs`
- `npm_config_cache=/tmp/room-v2-npm-cache bash scripts/public-ci.sh`
- `cd apps/world/tests/browser && npm ci --ignore-scripts`
- `node apps/world/tests/browser/personal-room-v2-null-smoke.mjs`
- `node apps/world/tests/browser/personal-room-chair-container-null-smoke.mjs`
- `node tools/world-assets/generate-personal-room-chair.mjs --check`
- `node apps/world/tests/browser/personal-room-visual-foundation-smoke.mjs`

The NullGraphicsDevice check uses the pinned real PlayCanvas engine for geometry, asset-failure, re-entry, budget and teardown checks. It cannot establish pixels, GPU performance or touch usability.

The browser harness uses a synthetic local room with no account, API or persistence. It captures entry, sleep/study and diagnostic cutaway views at desktop and mobile viewports. See the smoke script for output and alternate-source options. Use the same engine, assets, cameras and viewport for both sides of a visual comparison.

An offline Blender image generated from extracted source geometry is useful for design inspection, but must be labeled as an offline geometry preview. Its lighting, tone mapping and material approximation are not PlayCanvas game-screen evidence. Before release, actual supported WebGL/WebGPU browser screenshots, enter/exit/editor/seat regression and mobile performance still need to pass.
