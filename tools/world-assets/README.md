# INHAGAME World Asset Optimizer

Build-time wrapper around glTF Transform for validated INHA WORLD GLB assets.

## Contract

The optimizer never mutates files under `apps/world/assets`.

Current adoption is allowlist-only. Only the three assets that passed both renderer-neutral and PlayCanvas 2.22.4 PoC gates are eligible:

- `induck-v3.glb`
- `induck-backpack-v1.glb`
- `p0-qa-building.glb`

Each asset produces one explicit status:

- `OPTIMIZED`: transformed output met the configured minimum saving.
- `PASSTHROUGH_COPY`: transform succeeded but did not meet the saving threshold, so source bytes were copied.
- `FALLBACK_COPY`: transform failed, so source bytes were copied.

Local/default mode preserves continuity through `FALLBACK_COPY`.

CI uses `--strict`, where any `FALLBACK_COPY` fails the gate after writing an `optimization-report.json` receipt. This prevents a copied source from being mistaken for successful optimization.

## Dependency reproducibility

`package-lock.json` is committed and CI installs with `npm ci`.

The lockfile was bootstrapped from the successful optimizer Actions environment and then promoted into the repository. CI has no repository write permission in the steady state.

## Default output

`apps/world/.generated/assets-optimized/`

The generated directory is ignored by Git.

## Commands

```bash
cd tools/world-assets
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run optimize
npm run verify -- --output-root /tmp/inhagame-world-assets
```

## Adoption boundary

```text
source GLB
  -> optimizer wrapper
  -> explicit receipt
  -> structural / visual compatibility gates
  -> generated optimized GLB
  -> existing PlayCanvas asset path
```

The wrapper is build tooling. It is not a runtime dependency.
