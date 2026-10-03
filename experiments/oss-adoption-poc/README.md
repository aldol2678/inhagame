# OSS Adoption PoC: Zod + glTF Transform

This directory is an isolated evaluation package. It does **not** change the deployed INHA WORLD runtime, production validation path, model import path, or asset files.

## Baseline

- Repository: `aldol2678/inhagame`
- Base branch: `main`
- Base commit: `84448a7285bfda56aa466b5bf6f1ce374a584e14`
- Node in public CI: `24.19.0`

## Candidate A: Zod

The PoC mirrors `validateActivityStartRequest()` from:

`apps/world/src/activity/activity-contract.js`

It checks:

- acceptance/rejection parity for representative valid and invalid inputs,
- canonical output parity,
- shallow freezing behavior,
- relative validation throughput.

This is deliberately a narrow contract. It does not claim that Zod should replace semantic checks such as world graph cycles, asset references, geometry validation, or domain-specific warnings.

### Zod adoption gate

Proceed to a broader WRAP trial only if:

1. selected-contract parity is 100%,
2. absolute per-parse cost is acceptable for non-hot-path boundary validation,
3. schemas reduce duplicated hand-written structural validation,
4. domain semantics remain explicit functions rather than being hidden in schema refinements.

## Candidate B: glTF Transform

The PoC evaluates three existing world assets:

- `induck-v3.glb`
- `induck-backpack-v1.glb`
- `p0-qa-building.glb`

Pipeline:

`read -> dedup -> prune -> write -> re-read`

Recorded evidence includes:

- input/output bytes,
- percentage size change,
- elapsed time,
- scene/node/mesh/primitive/material/texture/accessor counts,
- round-trip readability,
- SHA-256 values.

### Visual regression gate

The follow-up gate generates optimized GLBs without replacing the originals, then renders original and optimized versions with:

- the same 512×512 viewport,
- the same fixed light rig,
- the original asset's camera reused for the optimized asset,
- deterministic pixel ratio and no antialiasing.

It saves both screenshots and computes:

- significant changed-pixel percentage,
- mean absolute RGB channel difference,
- maximum channel difference,
- model bounds before/after.

Current gate thresholds:

- significant channel delta: > 8/255,
- changed pixels: <= 1.0%,
- mean absolute channel difference: <= 0.5/255.

The renderer-neutral gate uses `three@0.186.0` in headless Chrome. Passing it demonstrates visual-data equivalence for the sampled assets, not full production PlayCanvas compatibility. A production-engine loading gate remains separate.

### glTF Transform adoption gate

Proceed to an asset-pipeline WRAP trial only if:

1. all representative assets round-trip successfully,
2. scene count is preserved,
3. optimized output is useful or neutral in size,
4. deterministic visual regression passes,
5. a later PlayCanvas-specific loading/appearance gate passes,
6. integration remains build-time/tooling-only unless a runtime need is proven.

## Dependencies

Pinned for reproducibility of this experiment:

- `zod@4.6.5`
- `@gltf-transform/core@4.5.1`
- `@gltf-transform/extensions@4.5.1`
- `@gltf-transform/functions@4.5.1`
- `playwright@1.63.0`
- `three@0.186.0`

All are evaluated only inside this experiment package.

## Run

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run benchmark
npm run visual
```

The benchmark writes `poc-results.json`. Visual evidence is written under `.visual-output/`.

## Rollback

Delete this directory and its PoC workflow. No deployed code path depends on it.
