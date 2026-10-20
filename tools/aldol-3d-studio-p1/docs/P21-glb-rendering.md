# P2.1: verified local GLB rendering

P2.1 renders actual static GLB geometry in the Studio viewport using the existing pinned PlayCanvas **2.22.4** dependency. It retains the P2 local file picker, SHA-256/size verification, WorldDocument/EditorCommands, serializer and byte-preserving ZIP. Production game files and deployed bundles are untouched.

## Run locally

From the repository root (Node 24.19.0 used for verification):

```sh
npm ci --prefix apps/world/tests/browser --ignore-scripts --no-audit --no-fund
node tools/aldol-3d-studio-p1/bin/dev-server.mjs --editor-dir apps/world/src/editor --allow-write --port 4173
```

Open the printed loopback URL. Choose the original GLB and Factory manifest, import, then choose **모델 배치**. The GLB status must finish without diagnostics. The fixed `/vendor/playcanvas.mjs` route serves only the installed pinned engine; there is no CDN or general node_modules file server. Missing/wrong engine installation returns HTTP 503 and a visible load failure.

Download **씬+에셋 ZIP**. Reopen the downloaded archive in a separate server process:

```sh
node tools/aldol-3d-studio-p1/bin/dev-server.mjs --editor-dir apps/world/src/editor --package /absolute/path/studio-assets.zip --allow-write --port 4174
```

The ZIP reader accepts only this Studio's uncompressed ZIP format, verifies CRC, exact paths, offsets, sizes, duplicate/missing/extra entries, schema and original SHA-256. It parses in memory and never extracts archive paths. World JSON alone cannot restore local bytes. ZIP reopen is a local CLI operation; drag-and-drop ZIP import is not implemented.

## Rendering and supported profile

`web/model-viewport.mjs` dynamically creates a separate PlayCanvas device when the scene has `core.renderable.assetId`. All primitives and models in that viewport share its camera/depth buffer. The existing input canvas, gizmos and commands drive local transforms, hierarchy and inherited enabled state. Primitive-only scenes retain their previous renderer. Failed GLBs are absent with diagnostics, never silently replaced by successful-looking cubes. Selection still uses the existing node-origin proximity picker, not mesh raycasting.

The browser recalculates the full hash and size, validates the render profile, then supplies the same ArrayBuffer through the supported `Asset.file.contents` API. `container.resource.instantiateRenderEntity()` preserves glTF node hierarchy/materials. Instances are destroyed before shared resources are unloaded; in-flight parsing finishes before device disposal. Read-only `window.__ALDOL_MODEL_EVIDENCE__()` exposes diagnostic snapshots, not the Application or commands.

The shared `web/glb-contract.mjs` accepts a deliberately bounded subset:

- glTF 2.0 GLB, one embedded BIN, static triangle meshes, indexed or unindexed; FLOAT positions/normals/tangents, UV0 and vertex colors (also normalized unsigned byte/short UV/color).
- PBR materials and embedded **PNG bufferView** textures, local TRS/matrices and hierarchy. PNG decode remains an engine/browser gate after header/dimension validation.
- Rejects all URI fields (including data URIs), all declared/inline extensions including optional ones, Draco/Meshopt/KTX, JPEG, skins, animation, morphs, sparse accessors and non-triangle primitives with explicit errors. These are unsupported, not claimed to render.
- Bounds accessor/view/BIN ranges, finite floats and index values; 1M source vertices / 3M indices, 512 nodes, depth 64, bounded accessor work; 2M instanced vertices / 2,048 primitives per model and visible Studio scene allocation. Textures: 4096 per dimension, 16M pixels per GLB, 32M across loaded containers. The existing 20 MiB/file and 80 MiB/session byte budgets remain.

Legacy P2 JSON-only synthetic fixtures can still be registered/exported for compatibility. They cannot render and receive a visible validation diagnostic. Actual geometry is validated at import as well as immediately before engine load. GPU context loss is explicitly reported; refresh is available to retry. Recovery on every hardware driver is not certified.

## Evidence and reproduction

```sh
npm run check --prefix tools/aldol-3d-studio-p1
npm test --prefix tools/aldol-3d-studio-p1
INHA_WORLD_EDITOR_DIR="$PWD/apps/world/src/editor" npm run test:real --prefix tools/aldol-3d-studio-p1
INHA_WORLD_EDITOR_DIR="$PWD/apps/world/src/editor" node --test tools/aldol-3d-studio-p1/tests/factory-real-p2.mjs
npx --prefix apps/world/tests/browser --no-install playwright install chromium
node tools/aldol-3d-studio-p1/tests/browser-glb-p21.mjs
node tools/aldol-3d-studio-p1/tests/browser-runtime-p12.mjs
node tools/aldol-3d-studio-p1/tests/browser-mobile-p12.mjs
node tools/aldol-3d-studio-p1/tests/browser-p11.mjs
node tools/aldol-3d-studio-p1/tests/browser-factory-p2.mjs
node --test apps/world/tests/world-runtime-adapter.test.mjs
```

`glb-fixture.mjs` builds original deterministic pyramid geometry with real float vertex/normal/UV accessors, uint16 indices, two material assignments, an embedded 2×2 PNG and four glTF nodes. SHA-256: `08606df88f864f950d43266a676742d4f8438e784544d0ee068bc36b8414a51b`. Each mesh instance has 18 vertices and 18 indices. This is a geometry-bearing engineering fixture, not an artist asset or a proxy/JSON-header-only fixture.

Committed local evidence: [`evidence/p21/`](evidence/p21/). CI uploads full screenshots, world JSON, original GLB, exported ZIP, report and log for 30 days. Local Chromium 153.0.8010.12 / WebGL2 SwiftShader produced **43,475 changed pixels**, including **17,602 red material pixels**, when the actual model was moved offscreen via a document command. Full glTF hierarchy and embedded texture dimensions are recorded in the report. The second server plus fresh browser context independently reloaded ZIP world/bytes and reproduced the model state (floating-point tolerance 1e-6).

Mobile GLB tests cover 320×568, 390×844, 740×360 and 844×390, selection, pinch, move/rotate/scale gizmos, Undo and overflow. Separate P1.2 mobile regression retains placement cancellation, multitouch interruption, orbit, orientation and Redo. Negative browser cases show errors for tampered bytes, missing bytes, broken embedded PNG decode and WebGL context loss.

## Remaining boundaries

- **C14 physical Android/iOS/Safari BLOCKED:** no connected device or device-provider access. Chromium emulation and software GPU evidence are not physical-device or hardware-GPU certification.
- Factory `capabilities` was re-read: adapter 0.2.1, read-only metadata, no upload/storage/network calls; installed Python plugin unchanged 0.3.4. `rights_qa`, `visual_qa`, `engine_import_qa` remain UNKNOWN. This fixture's render success is not blanket approval of Factory assets.
- GLB reopen was verified in a new Studio PlayCanvas session. Existing campus P1.2 runtime tests pass separately; this work does not add Factory asset-cache plumbing to the production campus loader.
- No authenticated remote byte transfer, official MCP SDK certification, persistence service, main merge, deployment, licensing or existing PR changes.
- Next authorized local task: evaluate a representative user-provided GLB against the documented profile and add targeted compatibility cases. P2.2 authenticated transfer design can follow; credentials, permissions, costs and deployment require separate approval.

See [`ASTRA_SESSION_HANDOFF.md`](ASTRA_SESSION_HANDOFF.md) and the new stacked PR body for the latest exact HEAD/CI checkpoint. Re-read GitHub before continuing.
