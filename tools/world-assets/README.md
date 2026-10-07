# INHAGAME World Asset Optimizer

Build-time wrapper around glTF Transform for validated INHA WORLD GLB assets.

## Contract

The optimizer never mutates files under `apps/world/assets`.

Current adoption covers all six World GLBs. Character semantic pivots are preserved explicitly for the duck and Annyongi assets:

- `induck-v3.glb` (preserve empty semantic leaf pivots)
- `annyongi-flight-v1.glb` (preserve empty semantic leaf pivots)
- `induck-cap-v1.glb`
- `induck-backpack-v1.glb`
- `induck-hoodie-v1.glb`
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

## Annyongi reconstruction

`python3 tools/world-assets/build-annyongi.py` deterministically rebuilds the
newly authored official-reference model. It uses the Python standard library,
vertex colors and one rough nonmetallic material; no source images or textures.
`node apps/world/assets/check_characters.mjs` validates the real production
geometry/semantic contract and provenance SHA (not the former QA generator).
`DragonWing_L/R` remain empty; `CloudWing_L/R` are small fixed design details.
The invisible `RiderAnchor` is preserved through optimization.

Vercel now serves Annyongi's canonical and optimized paths from source/build
output. Other brand assets continue through the unchanged Supabase proxy.
Direct legacy brand API calls still refer to the old upstream and are not the
authority for the new Annyongi. No Supabase deployment is needed for this switch.
The build fails on optimizer fallback and invalid source metadata.
Design review is pending; see `docs/implementation/annyongi-3d-redesign-01/`.
