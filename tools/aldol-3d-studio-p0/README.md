# ALDOL 3D Studio P0.2 real-source integration gate

This folder belongs exclusively to the **non-production** branch
`chore/aldol-3d-studio-p0-real-integration-20261020`.

## Provenance

- Original local candidate: `ALDOL-3D-Studio-P0.2.0-dev.zip` (2026-10-20).
- Source snapshot: four source/test files from the candidate; the transport
  `ci-source.tar.gz.b64` is a deterministic tar.gz, not a replacement for
  readable source files in a future PR.
- Archive SHA-256: `5ab2d1a5825c5457799e87fe65e34ebb47fef59077d2a9aef2dcf7e30405213c`.
- Included: `src/command-schema.mjs`, `src/world-scene-adapter.mjs`,
  `tests/real.test.mjs`, `tests/real-integration.mjs`.
- Baseline INHA WORLD `main`: `81b3fa793b6155d50e1bb30bb3611732b8c79f9f`.

## Integration contract

The GitHub Actions workflow checks out the actual repository, verifies the
archive checksum, extracts the candidate to `RUNNER_TEMP` and runs
`node tests/real-integration.mjs` with `INHA_WORLD_EDITOR_DIR` targeting
the original `apps/world/src/editor/` checkout.

Required: 8 PASS, 2 SKIP, 0 FAIL; the two skips are explicitly C13 PlayCanvas
runtime and C14 interactive browser regression. These are **not** called PASS.

This diagnostic branch intentionally does not modify existing editor files,
world.json, deployment configs, auth, or database. No production deployment,
merge, or release is authorized by the integration gate.

## Follow-up

Once real integration passes, replace the compressed transport with reviewed,
readable source files in a standalone repository or deliberate subpackage.
Do not merge this diagnostic transport into `main`.
