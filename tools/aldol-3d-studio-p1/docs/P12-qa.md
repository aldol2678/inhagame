# P1.2 actual PlayCanvas runtime and mobile regression

Development candidate stacked on P1.1 `e7b5a113c648f0dc808ace55c2e8f1601766d6dc`, PR #437. No main merge or deployment. Package remains UNLICENSED. Existing production sources, world files, authentication and databases are unchanged.

## What changed

- `web/studio.js`: tracks touches across canvas and gizmo handles. A second finger cancels an active gizmo instead of accidentally saving its partial transform. A viewport resize cancels pending drags and clears stale pointer coordinates.
- `web/studio.css`: keeps the inspector within short portrait screens and uses three columns for short landscape screens. Previously the fixed pane heights pushed the inspector below the visible viewport.
- `tests/real-integration.mjs`: explicitly requests TAP. Node 24 otherwise produced spec output and falsely rejected an actual 8 PASS / 2 SKIP run.
- `tests/runtime-fixture.mjs`, `tests/browser-runtime-p12.mjs`: use real editor classes, serializer, saved-world loading and the running game PlayCanvas Application. No replacement engine or production adapter was needed.
- `tests/browser-mobile-p12.mjs`: drives Chromium CDP touch against the real editor HTTP adapter, checks persisted transforms, captures screenshots, JSON and a Playwright trace.
- `package.json`, `README.md`, `tests/real.test.mjs`: reproduction commands and accurate separation of the Node class SKIPs from browser results.
- `.github/workflows/aldol-3d-studio-p1-2.yml`: pull-request-only execution against the exact PR head; pinned existing dependencies; artifacts retained for 30 days. No redundant push trigger.

## Actual runtime path and scope

1. Studio `WorldSceneAdapter.exportWorld()` calls the existing `apps/world/src/editor/world-serialization.js` serializer. Fixture commands run through `WorldDocument` and `EditorCommands` via `createLegacyPort`.
2. In a **fresh disposable browser context on loopback**, the test writes that JSON through the existing `EditorBrowserStore.writeCanonicalVerified()`. This touches only the test profile's temporary IndexedDB, never an existing user's browser or operational DB.
3. Navigating to `/campus/?editorWorld=1` executes the actual `apps/world/src/main.js` saved-editor-world path, not a substitute loader. It reads the canonical JSON and calls `src/runtime-adapter/load-world.js` with `createPlayCanvasRuntimeContext`.
4. The game root applies `1 / metersPerUnit = 0.5`; its parent `campusRoot` applies `[1,1,-1]`. The test confirms local positions, quaternions and nonuniform scales, out-of-order parent/child creation, and the child world position `[8,4,-2]` from those transforms. Disabled parents suppress descendants.
5. `world.structure` produces real PlayCanvas render components. `user.keep` deliberately has no runtime adapter: the loader returns `ready-with-warnings` and exactly `R_UNKNOWN_COMPONENT`, while its source payload remains intact.
6. After confirming normal campus boot and advancing frames, a temporary camera/layer isolates enabled fixture meshes **inside the same running game Application**. HTML HUDs are hidden for the before/after pixel assertion; this is separate from the standalone Studio WebGL renderer.

The existing offline World browser harness serves PlayCanvas **2.22.4** from the pinned npm dependency. Supabase and telemetry are stubbed and other off-origin requests are blocked. Renderer: **WebGL2 / software SwiftShader**. Local environment: Linux, Node **24.19.0**, Playwright **1.63.0**, Chromium **153.0.8010.12**; CI uses Node 22. Neither hardware GPU nor production networking is certified.

## Results

| Gate | PASS | FAIL | SKIP / BLOCKED |
| --- | ---: | ---: | --- |
| Existing Studio logic / HTTP / MCP / geometry | 31 | 0 | 0 |
| Real editor Node class suite | 8 | 0 | 2 retained (browser-only C13, physical C14) |
| Existing World runtime adapter Node suite | 4 | 0 | 0 |
| P1.1 served browser renderer and mobile smoke | 2 groups | 0 | physical devices not covered |
| P1.2 actual campus PlayCanvas | 5 groups | 0 | hardware GPU / production not covered |
| P1.2 mobile touch / layout | 17 groups | 0 | physical Android and iOS BLOCKED |
| Syntax / diff whitespace | PASS | 0 | — |

The five runtime groups cover serialization/undo/redo/data preservation, real game boot, entity transforms/hierarchy/visibility, rendered pixels, and unchanged source/no browser errors. See [runtime JSON](evidence/p12/runtime-report.json) for measured pixels and entity values, [runtime log](evidence/p12/runtime.log), [campus screenshot](evidence/p12/campus-runtime.png), and [isolated before](evidence/p12/playcanvas-before.png) / [after](evidence/p12/playcanvas-after.png).

The 17 mobile groups cover placement cancellation, pointercancel, placement/selection, move/rotate/scale with undo/redo, cancelled gizmos, second-finger cancellation, camera orbit, pinch, no ghost placement, deselection/picking, rotation during a drag, four viewport sizes, and browser errors. Portrait **320×568 / 390×844**, landscape **740×360 / 844×390**. The layout assertions include both side panes fitting above the footer, not just horizontal overflow. [Mobile JSON](evidence/p12/mobile-report.json), [log](evidence/p12/mobile.log), [portrait](evidence/p12/mobile-390x844.png), [small portrait](evidence/p12/mobile-320x568.png), [landscape](evidence/p12/mobile-740x360.png), [wide landscape](evidence/p12/mobile-844x390.png).

Local committed evidence is a snapshot; the PR body provides the final SHA and exact-head CI URLs. CI artifacts additionally contain the complete mobile trace and fresh run evidence. Prior failure screenshots are not included in passing-run evidence.

## Reproduction

From repository root:

```sh
npm ci --prefix apps/world/tests/browser --ignore-scripts --no-audit --no-fund
npx --prefix apps/world/tests/browser --no-install playwright install --with-deps chromium
npm --prefix tools/aldol-3d-studio-p1 run check
npm --prefix tools/aldol-3d-studio-p1 test
INHA_WORLD_EDITOR_DIR="$PWD/apps/world/src/editor" npm --prefix tools/aldol-3d-studio-p1 run test:real
node --test apps/world/tests/world-runtime-adapter.test.mjs
node tools/aldol-3d-studio-p1/tests/browser-p11.mjs
npm --prefix tools/aldol-3d-studio-p1 run test:runtime
npm --prefix tools/aldol-3d-studio-p1 run test:mobile
```

Outputs are under `test-results/aldol-studio-p1-2/`. Browser scripts fail with a nonzero exit code on an assertion; runtime/mobile reports mark failure. The inherited Node suite keeps its original two SKIPs instead of inferring PASS from other suites.

## Remaining work

- **C14 physical devices BLOCKED**: no BrowserStack/Sauce connection found, no provider credentials in this environment, no adb/xcrun/iOS device tools. Chromium's CDP touch and viewport changes are emulation, not physical Android or Safari. Next step requires an authorized device/provider session and rerunning the same touch/cancel/orientation cases with device/OS/browser evidence. WebKit/Safari, virtual keyboard and OS gesture interruption remain unverified.
- **C13 PASS within the offline actual-game runtime scope** above. Production host/network, hardware rendering, GLB/Asset Factory integration and broad game feature E2E are not certified. The standalone Studio itself still renders with its existing renderer; P1.2 validates its exported scene in the actual game.
- No automatic persistent Studio-to-game live link, remote write server or official MCP SDK work was added. Reparent continues to preserve local transforms as before.
- No PR merges, PR closures, production deployments, authentication/DB changes, license changes or visibility changes were performed.
