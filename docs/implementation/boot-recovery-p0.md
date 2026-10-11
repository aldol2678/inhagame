# BOOT-RECOVERY-P0

Base: `03f4aaf` (latest main when implementation began).

## Existing path and changes

`campus/index.html` schedules `lobby-loading.js` and the large static graph rooted
at `main.js`. Previously, the error listeners were installed by the loader ES
module itself, so failure of that module could leave the initial screen without
diagnostics. The listeners stopped reporting once `boot()` entered. Boot failures
had no retry action. The render gate rejected after 60 seconds including asset
loading time, and graphics initialization rejected after 10 seconds.

A small dependency-free **classic script**, `src/lobby/boot-recovery.js`, now runs
before either module. Capturing resource-error listeners recognize the two marked
entry scripts (including failure in their dependency graphs). The existing
`installWorldBootDiagnostics` API attaches the loader to this supervisor and retains
its non-page fallback for existing consumers/tests. No boot profiler, ResourceTiming,
Long Task observation, or telemetry upload is added. PR #292 is still a separate
open performance-measurement change; its code is not copied here. PR #314, collision,
NPC and shop implementations are unchanged.

The supervisor warns after 15 seconds without a phase change/eligible initial
frame. A warning is `DELAYED`, never `ERROR`; pending work continues and can finish
naturally. Phase progress resets the warning. Hidden documents suspend the warning
and resume with a fresh interval. A generic asset wait has no reliable byte progress
signal, so its copy explicitly says loading continues. The previous 60-second render
deadline is now only an optional diagnostic callback. Graphics initialization has
no default deadline (explicit callers can still opt in). Actual rejections fail.

## Readback and recovery

`window.__INHA_WORLD_BOOT_RECOVERY__.status()` exists even before modules execute.
Once boot publishes its normal status, the same snapshot is available at
`__INHAGAME_P0__.getStatus().bootRecovery`, including the failure path.

| Code | Meaning | State |
| --- | --- | --- |
| `BOOT_MODULE_ERROR` | Entry/dependency module request failed | ERROR |
| `BOOT_SCRIPT_ERROR` | Pre-entry script evaluation/parse error | ERROR |
| `BOOT_PROMISE_REJECTION` | Unhandled pre-entry rejection | ERROR |
| `ASSET_LOAD_FAILED` | A required character model settled as unavailable | ERROR |
| `GRAPHICS_INIT_FAILED` | Graphics initialization rejected/failed | ERROR |
| `INITIAL_RENDER_FAILED` | Initial render/GPU completion rejected | ERROR |
| `BOOT_INIT_FAILED` | Other caught boot failure | ERROR |
| `BOOT_ENTRY_DELAY` | Boot has not entered yet | DELAYED |
| `ASSET_LOADING_DELAY` | Required models still pending | DELAYED |
| `GRAPHICS_INIT_DELAY` | Graphics initialization still pending | DELAYED |
| `INITIAL_RENDER_DELAY` | Scene/frame/GPU/paint gate still pending | DELAYED |
| `BOOT_PROGRESS_DELAY` | Another boot phase still pending | DELAYED |

`phase`, `bootEntered` and `retrying` accompany the code. Confirmed failures are
sticky: later phases, slow timers and readiness setters cannot clear them. Both
errors and warnings show a Korean explanation, diagnostic code and a 44px-minimum
manual retry button. Retry reloads the current document once, preserving query/hash,
accounts and saved data. There is no automatic retry, cache deletion, or READY bypass.

The loader keeps the lobby inert from initial HTML. Both Induck and Annyongi must
have `glb` state after `character.ready`; the character subsystem's handled primitive
fallback is not counted as required boot readiness. Streaming must settle, three
eligible scene frames must render, WebGPU queued work must complete when present,
and two animation-frame paint opportunities must occur before `finish()` can reveal
the world. `setPhase('READY')` cannot bypass these readiness flags.

## Local reproduction

All browser tests serve this checkout locally, stub backend calls, and block other
off-origin traffic using the existing harness. They do not contact Production.

```sh
npm ci --ignore-scripts --prefix apps/world/tests/browser
(cd apps/world/tests/browser && npx playwright install chromium)
node --test apps/world/tests/boot-recovery.test.mjs apps/world/tests/world-boot-diagnostics.test.mjs apps/world/tests/world-loading-render.test.mjs apps/world/tests/graphics-presets.test.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/mobile-boot-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/loading-render-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=0 node apps/world/tests/browser/unsupported-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/boot-recovery-smoke.mjs
```

The unsupported smoke owns its own navigator/context overrides, so it does not use
the harness's second `navigator.gpu` override. Recovery smoke uses actual 15-second
warning windows, not shortened product settings. It writes diagnostic snapshots
and screenshots to `test-results/boot-recovery/`; the new read-only PR workflow
runs these tests and uploads the evidence.

Verified scenarios in local Chromium:

- Normal mobile boot reaches READY with required assets and real rendering.
- Loader module, main entry and a transitive module aborted: `BOOT_MODULE_ERROR`.
- Invalid main-module syntax: `BOOT_SCRIPT_ERROR`.
- Held main entry: `BOOT_ENTRY_DELAY`, then natural READY after release.
- Either required GLB returns 404: `ASSET_LOAD_FAILED`, no essential/READY bypass.
- Both graphics backends disabled: `GRAPHICS_INIT_FAILED` with retry.
- Initial frame gate held: `INITIAL_RENDER_DELAY`, then READY only after real frames.
- Manual retry after removing the main-request fault: clean boot, same query/hash.
- 360×800 mobile, 320×568 portrait and 800×360 landscape: retry remains in viewport.
- Held Induck request crosses the warning threshold without failure, then loads and
  renders before the lobby becomes interactive.

Node tests also cover sticky late errors, irrelevant resource failures, unhandled
rejections, background suspension, long asset/GPU waits, graphics initialization
past 120 seconds with a fake clock, GPU rejection, and repeated retry clicks.

This is Chromium software-rendering/mobile-viewport coverage, not physical-device
or Safari certification. A blocked browser main thread cannot execute a JavaScript
watchdog until it yields; delays alone deliberately never certify a failure.

Validation: `bash scripts/public-ci.sh` passed (World, Recast WASM acceptance,
static QA, other app tests/builds, edge tests and migration linters). The focused
boot/graphics tests passed 16/16. No database changes were made, so the separate
local database replay was not needed. Production deployment, main merge and server
configuration changes are outside this PR.
