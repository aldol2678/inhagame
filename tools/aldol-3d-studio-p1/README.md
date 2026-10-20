# ALDOL 3D Studio P1 v0.3.0-dev (isolated GitHub candidate)

**Status:** development candidate, not a release and not authorized for deployment/merging.
This branch descends from the previous verified `chore/aldol-3d-studio-p0-real-integration-20261020` branch, leaving INHA WORLD `main`, its production world files, auth, databases and deployments untouched.

## Candidate provenance

- Local reference artifact: `ALDOL-3D-Studio-P1-v0.3.0-dev.zip`
- Full local ZIP SHA-256: `6ec71b25a4188ff7127fbce66720cb66d1ff13377d01b4a6a63d383a50a2d2a5`
- Core source transport: `transport/chunk-00.b64` ... `chunk-06.b64` concatenated as base64-encoded Brotli-compressed tar.
- **Compressed core SHA-256**: `9c18dd09f6310c37402fb694cb560b78dbce429ee9abf6022dc57c51f8bef5f9`
- Core source includes `bin/`, `src/`, `tests/*.mjs`, `web/`, `package.json`. It excludes optional Playwright Python QA harness, screenshots, and docs. The full user-facing ZIP retains those extras.
- Editable reference files in this branch: `web/interaction.mjs` and `tests/interaction.test.mjs`. CI compares these byte-for-byte to the decoded source.

## Build/reproduce the exact core locally

Requires Node 22+ and GNU tar, without installing external packages:

```sh
mkdir -p /tmp/aldol-studio-p1
cat tools/aldol-3d-studio-p1/transport/chunk-{00..06}.b64 | base64 --decode > /tmp/aldol-studio-p1.tar.br
echo '9c18dd09f6310c37402fb694cb560b78dbce429ee9abf6022dc57c51f8bef5f9  /tmp/aldol-studio-p1.tar.br' | sha256sum --check -
node -e "const fs=require('node:fs'),z=require('node:zlib');fs.writeFileSync('/tmp/aldol-studio-p1.tar',z.brotliDecompressSync(fs.readFileSync('/tmp/aldol-studio-p1.tar.br')))"
tar -xf /tmp/aldol-studio-p1.tar -C /tmp/aldol-studio-p1
cd /tmp/aldol-studio-p1
npm run check
npm test
```

For actual INHA WORLD integration, on the checked-out `inhagame` repository:

```sh
INHA_WORLD_EDITOR_DIR=/path/to/inhagame/apps/world/src/editor npm run test:real
```

This requires exactly 8 PASS, 2 SKIP, 0 FAIL; C13 PlayCanvas and C14 browser regression remain unverified. The GitHub Actions workflow additionally checks the full core's 30 mock/MCP/HTTP/interaction tests.

## Risk and release gates

This is a **code transport staging format**, not the final readable Git source layout. Before any PR for merging to `main`, expand reviewed source files into tracked `src/`, `bin/`, `web/`, `tests/` in a dedicated package. Remove the compressed transport only after an exact readback and new CI pass.

The server binds to 127.0.0.1 and has no public authentication. It MUST NOT be exposed to the internet. Local `--allow-write` is intentional opt-in. No persistent multi-user session, GLB import, SDK-verified MCP compatibility, production PlayCanvas or real-device mobile E2E is claimed.

No automatic deployment, release, PR merge, or changes to legacy INHA WORLD editor source are part of this branch.
