# ALDOL 3D Studio · P1 v0.3.0-dev

**Status: reviewed development candidate. Not a production release, not merged to `main`.**

This is an independent browser scene-editor prototype, a typed `WorldSceneAdapter`, and a local MCP stdio prototype. It uses existing INHA WORLD editor classes but does **not** change the production editor, saved worlds, authentication or deployment.

## Source and reproducibility

The tracked `bin/`, `src/`, `web/`, `tests/` and `package.json` are **ordinary, human-readable source files**. The previously staged seven-part compressed transport was removed **after exact byte-for-byte parity and integration tests passed**.

- Local reference package: `ALDOL-3D-Studio-P1-v0.3.0-dev.zip`
- Reference ZIP SHA-256: `6ec71b25a4188ff7127fbce66720cb66d1ff13377d01b4a6a63d383a50a2d2a5`
- Former core transport SHA-256: `9c18dd09f6310c37402fb694cb560b78dbce429ee9abf6022dc57c51f8bef5f9`
- Source parent: `chore/aldol-3d-studio-p0-real-integration-20261020`
- Main world snapshot originally audited: `81b3fa793b6155d50e1bb30bb3611732b8c79f9f`
- License: `UNLICENSED` (no open-source publication or relicensing authorized).

## Run locally

Requires Node.js 20 or later. No third-party npm installation required for the current prototype.

```bash
cd tools/aldol-3d-studio-p1
npm run check
npm test
npm run studio -- --demo --allow-write
```

Open `http://127.0.0.1:4173` on **that same computer**. This demo uses an ephemeral mock world; use the UI's World JSON export to retain work before stopping the server.

For the real, separately checked-out editor:

```bash
export INHA_WORLD_EDITOR_DIR=/path/to/inhagame/apps/world/src/editor
npm run test:real
npm run studio -- --editor-dir "$INHA_WORLD_EDITOR_DIR" --allow-write
# Optional local MCP stdio:
node bin/mcp-stdio.mjs --editor-dir "$INHA_WORLD_EDITOR_DIR"
```

Local MCP defaults to **read-only**. Explicit `--allow-write` is required for scene edits. Web editor and MCP processes are separate, non-persistent sessions and do not yet share a scene.

## What P1 can do

- Create primitives (box, column, floor), duplicate, rename and delete.
- X/Y/Z translate, rotate and scale gizmos, grid snapping and orbit/zoom controls.
- Scene hierarchy, parent-change validation and cycle prevention.
- Preview/commit/cancel, Undo/Redo, and legacy `world.json` export.
- Mobile touch-friendly handles and placement; Canvas projection fallback when WebGL is unavailable.
- Typed allowlisted ScenePort operations and MCP JSON-RPC `scene_read`, `scene_validate`, `scene_export_world`, plus opt-in write tools.

## Automated verification

```bash
npm run check           # Node syntax validation
npm test                # 30 mock, command, geometry, HTTP, MCP regression tests
INHA_WORLD_EDITOR_DIR=/path/to/inhagame/apps/world/src/editor npm run test:real
                       # Exactly 8 PASS, 2 SKIP and 0 FAIL required
```

`.github/workflows/aldol-3d-studio-p1.yml` runs these commands against the **tracked, readable source**, not archived transport. A separate one-time GitHub Actions migration verified archive parity and ran the same tests **before** committing the readable files and later retiring the compressed archive.

The two real-source SKIPs are **C13 PlayCanvas runtime** and **C14 full browser regression**. The existing browser emulation QA did not prove full hosted PlayCanvas, real-device touch or production HTTP behavior.

## Security and release constraints

- The development HTTP service binds to `127.0.0.1`, lacks remote authentication/TLS and **MUST NOT** be opened to the Internet.
- The MCP stdio protocol is a prototype and has not passed official MCP SDK/Inspector compliance.
- The demo keeps work only in memory; there is no remote multi-user session or persistent save service.
- Reparent currently preserves local transforms, not global/world-space transforms.
- No live GLB importer, Blender-class modeling, rigging, Asset Factory connection or public deployment exists.
- Asset handoff, licensing/provenance, 3D runtime and real-device tests remain subsequent phases.
- Do not merge to `main` or deploy without independent code review, PlayCanvas/mobile E2E and a release decision.

This branch is for **isolated development and review**, not official publication.
