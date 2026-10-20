# Renderer R1: static main hall facade batching

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

## Change

The main hall and library DETAIL layers previously created one PlayCanvas render entity per static window pane, mullion, end grid segment and library front rail. `main-hall-blockout.js` now builds these surfaces through the existing `FacilityMeshBatch`, grouping each building's windows separately and keeping the hall and library details within their existing chunk DETAIL layer. Geometry, colors, shadow casting and the NEAR entry door remain as before. Chunk creation, fade and destruction continue to own the batches.

No gameplay object, collision, interaction, NPC, map data or view-distance setting changes.

## Measurement

Compared the `origin/main` version at `015fd37` of `main-hall-blockout.js` with this change in the same local offline World harness. Windows Edge 154, NVIDIA Lovelace WebGPU, 1280×720/DPR 1, AUTO → HIGH, mounted camera at the main hall location from `qa-view-distance-runtime.mjs`, NORMAL view distance. For each fresh page, waited for streaming to settle, then sampled 240 animation frames. Two baseline/candidate pairs had identical residency counts (9 UNLOADED, 6 VISTA, 6 NEAR, 8 ACTIVE).

| Metric at main hall | Baseline | R1 |
| --- | ---: | ---: |
| Draw calls, median | 1,288 | 903 |
| Resident mesh buffer bytes | 15,057,972 | 15,284,484 |
| WebGPU timestamp frame time, median pair 1 | 0.309 ms | 0.296 ms |
| WebGPU timestamp frame time, median pair 2 | 0.295 ms | 0.288 ms |

Draw calls fell by **385 (29.9%)** in both pairs. Resident mesh buffers rose by 226,512 bytes (1.5%) because the static batches contain their own vertices. GPU timestamp times are close and variable; this sample does not establish an FPS or GPU-time improvement. The draw-call reduction is the confirmed outcome.

A six-location pass (gate, hall, pond, agora, sports, building 5 west) saw lower draw calls at every location, but those sequential samples inherited different residency histories. The paired main-hall result above is the controlled comparison.

## Verification

- `node apps/world/qa.mjs` passed.
- `node --test apps/world/tests/*.test.mjs`: 530 passed, 0 failed.
- Real Edge WebGPU offline `boot-smoke.mjs` and `graphics-smoke.mjs` passed; the latter exercised LOW/MEDIUM/HIGH, persistence, AUTO and unsupported WebGPU handling.
- Before/after main-hall screenshots were inspected for missing panes, color changes and shadow artifacts. No visible regression was found.
- `git diff --check` passed.

This is one targeted R1 optimization. Further changes should profile the current scene and preserve chunk residency boundaries rather than batching unrelated facilities together.
