# OSS Adoption PoC: Zod + glTF Transform

This directory is an isolated evaluation package. It does **not** change the deployed INHA WORLD runtime, production validation path, model import path, or asset files.

## Baseline

- Repository: `aldol2678/inhagame`
- Base branch: `main`
- Current rebased baseline: `37c13f24bb8b92543a26890e9936e280f3aa4729`
- Node in public CI: `24.19.0`
- Production PlayCanvas contract sampled here: `2.22.4`

## Candidate A: Zod

The PoC mirrors `validateActivityStartRequest()` from `apps/world/src/activity/activity-contract.js` and checks representative acceptance/rejection parity, canonical output parity, shallow freezing behavior and relative throughput.

Zod remains a boundary-contract candidate only. Domain semantic checks such as graph cycles, asset references and geometry rules stay explicit.

## Candidate B: glTF Transform

Representative assets:

- `induck-v3.glb`
- `induck-backpack-v1.glb`
- `p0-qa-building.glb`

Optimization pipeline:

`read -> dedup -> prune -> write -> re-read`

The first gate records byte savings and structural round-trip evidence.

## Renderer-neutral visual gate

The Three.js gate renders original and optimized GLBs with a fixed 512×512 viewport, lighting and camera. It stores original/optimized screenshots plus pixel-diff and bounds evidence.

## PlayCanvas production-engine gate

The PlayCanvas gate uses the same core runtime contract as INHA WORLD:

- `playcanvas@2.22.4`
- `AppBase`
- WebGL2 graphics device
- `RenderComponentSystem`, `CameraComponentSystem`, `LightComponentSystem`
- `TextureHandler` and `ContainerHandler`
- GLB loaded as a `container` asset and instantiated with `instantiateRenderEntity()`

For each sampled GLB it requires:

1. original and optimized files both load successfully,
2. PlayCanvas reports WebGL2,
3. render-component / mesh-instance / material counts remain equivalent,
4. model bounds remain within `1e-6`,
5. changed pixels remain <= 1%,
6. mean absolute RGB channel difference remains <= 0.5/255,
7. no page or console errors are observed.

This gate is still isolated from deployed INHA WORLD and never replaces production assets.

## Dependencies

Pinned for reproducibility:

- `zod@4.6.5`
- `@gltf-transform/core@4.5.1`
- `@gltf-transform/extensions@4.5.1`
- `@gltf-transform/functions@4.5.1`
- `playcanvas@2.22.4`
- `playwright@1.63.0`
- `three@0.186.0`

## Run

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run benchmark
npm run visual
npm run playcanvas
```

Evidence is written to `poc-results.json` and `.visual-output/`.

## Rollback

Delete this directory and its PoC workflow. No deployed code path depends on it.
