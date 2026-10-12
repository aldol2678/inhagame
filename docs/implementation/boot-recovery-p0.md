# BOOT-RECOVERY-P0: current-main integration

Integration base: `af532a53c433479e12354f88a5a1c234075de5e7`.
Original candidate: PR #337, `505ff16fe1f8b9ba25def0e8ff4566d13e65ffff`.
This candidate needs its own checks. The old PR's successful hosted CI is historical
context, not evidence that this integrated version passed a browser test.

## Scope

A dependency-free classic script runs before the loader and main ES module graphs.
It displays Korean diagnostics and a manual retry even if an entry module or its
imports cannot load. The existing boot diagnostics API attaches to this supervisor.
No new account/auth operation, cloud write, performance profiler, progress
percentage, network byte-progress inference, or runtime-error policy is introduced.
The observed production 98% stall's root cause is **not established** by this work.

- Entry/dependency request errors, pre-entry script failures, required-model failures,
  graphics failures, and initial-render failures get distinct diagnostic codes.
- Fifteen seconds without an actual phase change or eligible initial-render frame
  shows a nonfatal `DELAYED` hint. Slow work may still finish naturally. Repeating
  the same phase or receiving an ineligible scene frame is not progress.
- The existing 60,000ms combined asset/initial-render hard deadline and 10,000ms
  graphics initialization deadline are retained. The old PR removed both default
  protections; that removal is deliberately not carried into this integration.
- Hard timeouts have explicit `ASSET_LOADING_TIMEOUT`, `INITIAL_RENDER_TIMEOUT`, or
  `GRAPHICS_INIT_TIMEOUT` codes. A timeout is not presented as proven missing
  content or unsupported graphics hardware. The 15s warning is a separate idle
  diagnostic, not an extension of either hard deadline.
- The idle hint pauses in a hidden document. The existing hard deadline semantics
  are unchanged: hiding a tab does not grant an unbounded boot. A stalled module
  graph has no hard failure inference; its independent 15s hint keeps retry usable.

There is no reliable byte progress signal in the current required-model path. This
patch therefore does not claim that a download exceeding 60s is broken, or that the
60s bound solves every slow-network case. Replacing that bound with a per-phase or
active-time policy needs separate measurements and review. A blocked main thread
cannot run a JavaScript watchdog until it yields.

## Readback and readiness

`__INHA_WORLD_BOOT_RECOVERY__.status()` is available before modules execute. Normal
and failed boot readbacks include the same snapshot at
`__INHAGAME_P0__.getStatus().bootRecovery`.

| Code | Meaning | State |
| --- | --- | --- |
| BOOT_MODULE_ERROR | Marked entry/dependency module request failed | ERROR |
| BOOT_SCRIPT_ERROR | Pre-entry script evaluation or parse error | ERROR |
| BOOT_PROMISE_REJECTION | Unhandled pre-entry rejection | ERROR |
| ASSET_LOAD_FAILED | A required model settled without a GLB | ERROR |
| GRAPHICS_INIT_FAILED | Graphics initialization rejected | ERROR |
| INITIAL_RENDER_FAILED | First render or GPU completion rejected | ERROR |
| BOOT_INIT_FAILED | Other caught boot failure | ERROR |
| ASSET_LOADING_TIMEOUT | Asset/render gate's 60s deadline passed before assets settled | ERROR |
| INITIAL_RENDER_TIMEOUT | Same 60s gate expired after assets settled | ERROR |
| GRAPHICS_INIT_TIMEOUT | Existing 10s graphics deadline expired | ERROR |
| BOOT_ENTRY_DELAY | Module entry has not started after the idle window | DELAYED |
| ASSET_LOADING_DELAY | Required models remain pending | DELAYED |
| GRAPHICS_INIT_DELAY | Graphics stage has not progressed within the idle window | DELAYED |
| INITIAL_RENDER_DELAY | Scene/frame/GPU/paint gate remains pending | DELAYED |
| BOOT_PROGRESS_DELAY | Another boot phase remains pending | DELAYED |

The graphics default deadline normally precedes its 15s idle hint. That hint is
kept for the supervisor API but does not change the graphics default.

Required Induck and Annyongi GLBs must settle, streaming must empty, three eligible
real frames must render, queued WebGPU work must complete, and two paint
opportunities must run before READY. Existing phase percentages are untouched.
`setPhase('READY')` cannot bypass the readiness flags. Confirmed errors are sticky.

## Retry, cancellation, and focus

Retry reloads the same document URL exactly once. It does not clear localStorage,
sessionStorage, accounts, caches, or saved game data. There is no auto-retry. The
old document's loader is cancelled and its pending render gate is aborted before
reload; late assets, GPU callbacks, or readiness setters cannot expose that page.
Abort, completion, and timeout remove postrender/timer/paint/signal listeners.
Repeated script installation, destroy, and retry clicks are safe.

The lobby is inert in the initial HTML, including module-failure paths. The retry
button has a minimum 44px height; the overlay scrolls and uses compact landscape
spacing. When progress hides a focused retry button, focus moves to the loading
container. A completed loader transfers its own focus to the lobby without
stealing focus from another surface. Account, Phone/Photo, room, HUD, and input
ownership remain with their current main modules.

## Checks and browser gate

```sh
node --test apps/world/tests/boot-recovery.test.mjs apps/world/tests/world-boot-diagnostics.test.mjs apps/world/tests/world-loading-render.test.mjs apps/world/tests/graphics-presets.test.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
bash scripts/public-ci.sh
```

Browser checks use the real local campus, pinned PlayCanvas/Playwright, isolated
backend stubs, and blocked off-origin traffic. They must be run on this candidate:

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix apps/world/tests/browser
(cd apps/world/tests/browser && npx playwright install chromium)
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/mobile-boot-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/loading-render-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=0 node apps/world/tests/browser/unsupported-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/boot-recovery-smoke.mjs
```

The recovery smoke covers entry/loading/transitive module failure, parse failure,
held entry and natural recovery, each required GLB 404, graphics failure, render
stall recovery, same-URL manual retry, synthetic local/session storage retention,
loader-owned focus, and 360×800 / 320×568 / 800×360 retry bounds. It emits screenshots
and diagnostic snapshots. These scripts being present is not proof they ran.

Before publication, the unchanged existing Phone, Photo, and stability browser
workflows should also pass for this exact candidate. Physical Android/iOS and
Safari behavior must not be inferred from Chromium viewport coverage.

Database changes, Production deployment, and merging are outside this integration.
Publication to the existing Draft PR and exact-head hosted CI require explicit
authorization; the checked-in browser workflow preserves source hashes alongside
readable Korean screenshots for that verification.
