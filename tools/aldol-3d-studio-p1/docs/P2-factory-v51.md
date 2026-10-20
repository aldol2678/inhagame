# ALDOL 3D Studio P2 · Asset Factory Studio v5.1 local handoff

## Status / ownership
An isolated **development candidate** stacked on `feat/aldol-3d-studio-p1-2-runtime-mobile-20261020` (P1.2 PR #438).
INHA WORLD production, the v5.1 private Factory Site, installed connectors, databases and real assets remain unchanged.
No `main` merge, official MCP registration or public deployment is authorized.

## Factory v5.1 verified interface
- Private Site: https://aldol-asset-factory-studio.al-dori.chatgpt.site
- Deployed v5.1 known from 2026-10-21 verification report; deployed source version 6 and adapter 0.2.1.
- Connected tools `capabilities`, `inventory_preview`, `audit_preview` are **metadata-only and read-only**. `inventory_preview`/`audit_preview` were called as part of this work using a safe synthetic `assets/sample.glb` entry; both accepted the request. No bytes are uploaded or read by the plugin.
- Separate Python plugin remains 0.3.4; a 0.3.5 candidate is **not** the installed plugin. No assumption of Python parity.

The Studio must not use the MCP tool's `metadata_structure:PASS` as byte, rendering, game-engine or copyright clearance.
The current interface is **manual user-selected local transfer**, not an authenticated Site-to-Studio remote download or live MCP client.

## Accepted handoff metadata
Pass the JSON arguments originally given to Factory `inventory_preview` or `audit_preview`:
```json
{"project_id":"my_project","assets":[
 {"id":"sample","file":"assets/sample.glb","byte_size":124,
  "sha256":"<64 lowercase hex characters of the ACTUAL GLB bytes>","status":"PASS"}
]}
```
Do not literally reuse the placeholder hash or byte_size. Exact file paths are basename under `assets/`; no user-provided URL. Supports an `{"arguments":{...}}` wrapper. Currently allows one GLB or PNG at a time, selected with the browser's local file picker. v5.1's SVG metadata can be audited but Studio does **not** auto-preview or import SVG, to preserve the v5.1 sanitizer boundary.

## User flow
1. In private Asset Factory v5.1 validate assets, export the original GLB/PNG and handoff JSON metadata. Factory's output has no automatic access to Studio.
2. Start Studio with `npm run studio -- --demo --allow-write` or a local read/write legacy editor session. This uses 127.0.0.1 ONLY.
3. Choose a local GLB/PNG and Factory metadata JSON, then press **바이트 검증 후 등록**. Both must match exact `file`, `byte_size`, and `sha256`, as recomputed from actual bytes in Node. File count and per-file/total declared size limits match Factory MCP: 500 metadata entries, 20 MiB each, 80 MiB total.
4. Locally accepted GLB gets `assetId=factory.<hash-prefix>`, `uri=assets/<sha256>.glb`, registration in `world.assets` using legacy EditorCommands.addAsset for undo. A 2D/3D box-like **placeholder/proxy**, not the imported GLB geometry, may be placed using `core.renderable.assetId` (manual action only).
5. **씬+에셋 ZIP** produces `world.json` + original verified `assets/<sha256>.glb/png` with CRC-32 in a stored ZIP. Existing unresolved legacy asset references BLOCK full bundle export. The original "World JSON" export alone cannot carry byte contents; users should download the ZIP.

## Security and limitations
- Local-only 127.0.0.1 server, `--allow-write`, same-origin POST guard, JSON body limit, no remote fetch/SSRF, SHA-256 size verification, GLB magic/version/JSON and unsupported remote buffer/image URI rejection.
- PNG check is **signature/IHDR/dimension only**; it does not claim browser/codec decode or full CRC validation. SVG is not auto-loaded.
- GLB structural inspection is not a full glTF validator; compressed extensions and referenced external URIs are rejected. Browser does not directly render imported meshes.
- Asset integrity PASS refers only to matching caller-declared checksum, not a trusted Factory signature; caller `status=PASS` is not proof of approval. `visual_qa`, `engine_import_qa`, `rights_qa` remain UNKNOWN throughout, even after import.
- In-memory session only. ZIP is the portable handoff; no persistent asset library, game deployment or actual asset CDN upload.
- No automatic installation into INHA WORLD, no private Factory Site changes, no public MCP read-write endpoints, no open-source license change (UNLICENSED).

## Automated gates
```bash
cd tools/aldol-3d-studio-p1
npm run check
npm test
INHA_WORLD_EDITOR_DIR=/path/to/inhagame/apps/world/src/editor npm run test:real
```
CI `.github/workflows/aldol-3d-studio-p2-factory.yml` also runs pinned Playwright Chromium actual loopback-served handoff, proxy placement, ZIP content, and mobile layout.

## Subsequent work
To preview **actual** GLB meshes in the Studio rather than a proxy, add a trusted GLB decoding and PlayCanvas asset-loading/render pipeline; verify material/texture dependencies and game import plus real Android/iOS. Separate explicit user approval will be required before any production deployment.
