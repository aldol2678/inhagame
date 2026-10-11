# RUNTIME-DIAGNOSTICS-P0

Base: `03f4aafaedc4c3168a963a84d7a4a285f9f85985` (main checked before implementation
and again before submission). PR #337 (boot recovery), #336 (NPC shops), and #314
(collision validation) were open and were not incorporated. No equivalent
player-facing report UI existed on main.

## Player flow

Open **☰ → 설정 → 진단 · 버그 보고**, from either the lobby or campus HUD. The
native modal works with mouse, keyboard and mobile touch; its close button stays
visible while the content scrolls. InputFocus owns the movement/camera/shortcut
block and text-input permission. Closing releases only this panel's claim and
returns focus to the appropriate menu. Other systems continue running.

The status section refreshes once per second while open and has a manual refresh
button. Write a problem description, reproduction steps and context, then choose
**보고서 만들기**. The JSON preview is the exact text used by **텍스트 복사** and
**JSON 파일 저장**. Merely opening, refreshing or generating a report does not
export or send anything. Clipboard denial leaves a selected preview for manual
copy; failed download gives an explanation. Editing the description invalidates
its previous preview. The clear button discards the draft and error history.

## Collection boundary

The runtime composition reads existing public graphics getters, network state,
public place-zone registry, and coarse world mode. It never calls the broad
`__INHAGAME_P0__.getStatus()` or `online.status()`, which contain unrelated/private
information. `__INHA_WORLD_RUNTIME_DIAGNOSTICS__.status()` exposes only this fixed
projection:

| Field | Allowed content |
| --- | --- |
| `buildId` | 40-character source commit SHA, or explicit `development` |
| `renderer` | WebGPU / WebGL2 / UNKNOWN |
| `rendererState` | AVAILABLE / LOST / UNKNOWN |
| `quality`, `qualityPreference` | low / medium / high; preference also auto; UNKNOWN fallback |
| `worldId` | CAMPUS / BIRYONG / LOBBY / INTERIOR / EDITOR / UNKNOWN |
| `zoneId` | Exact ID from the existing public Campus/Biryong zone registries; otherwise null |
| `network` | ONLINE / CONNECTING / RECONNECTING / OFFLINE / UNKNOWN |
| `fps`, `frameTimeMs` | Rendered frames per second and average frame interval, or null |
| `recentErrors` | At most 10 `{ code }` records from the fixed error-code vocabulary |

FPS/frame interval use an aggregate one-second window of actual `postrender`
events, independent of whether the existing FPS HUD is visible. This is frame
pacing, not GPU execution duration. Hidden tabs reset sampling; stopped/stale or
lost-device samples are not shown as live FPS. There is no unbounded frame array
or resource/performance trace collection.

Allowed error codes are `RUNTIME_SCRIPT_ERROR`, `RUNTIME_PROMISE_REJECTION`,
`RENDERER_DEVICE_LOST`, `NETWORK_OFFLINE`, `NETWORK_RECONNECTING`, and
`DIAGNOSTICS_READ_FAILED`. Global errors and rejections contribute only their
category, never message, stack, reason, filename, URL or exception object.
PlayCanvas's existing device-lost/restored events are observed without taking over
renderer recovery. Network failures are observed without retries or multiplayer
mutations. Readback failure produces a fixed code and permits subsequent reads.

No account ID, email, auth token, cookie, chat, friend list, identity object,
precise coordinates, personal-room ID, user-authored editor-world ID, or whole
runtime snapshot is retained. The identity callback **ignores its argument** and
clears diagnostics, draft, preview and pending UI completions on every identity
notification, including switch/sign-out. Pagehide also clears them; BFCache restore
starts empty. The exported/readback schema does not contain an identity key.

Drafts exist only in the three bounded textareas (1000 characters each). User
text is not silently harvested from other UI. Common email, UUID, JWT, credential
assignment, Bearer token, URL and long identifier patterns are redacted in the
preview/export. This cannot infer every possible identifying detail in arbitrary
prose: the UI explicitly asks players not to enter private information and to
review the preview. It never automatically imports an error log or conversation.
Previously authorized files/clipboard contents belong to the user and are not
silently deleted on logout.

No persistence, fetch, telemetry, server endpoint, DB or external service is added.
The source-build SHA is stamped into a static module by the **existing** World
build script. A raw source checkout shows `development`; it does not falsely claim
a deployed SHA or query a potentially newer server for the old tab's build ID.
Build stamping validates the SHA and fails on invalid input.

## Validation and reproduction

```sh
node --test apps/world/tests/runtime-diagnostics.test.mjs
node --test apps/world/tests/input-focus-*.test.mjs apps/world/tests/hud-*.test.mjs apps/world/tests/graphics-settings-panel.test.mjs apps/world/tests/settings-registry.test.mjs
node apps/world/qa.mjs
bash scripts/public-ci.sh
npm ci --ignore-scripts --prefix apps/world/tests/browser
(cd apps/world/tests/browser && npx playwright install chromium)
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/runtime-diagnostics-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/mobile-hud-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/lobby-layout-smoke.mjs
```

Local results:

- `public-ci.sh`: PASS, including World 4,119/4,119, Recast acceptance, app tests
  and builds, edge tests and migration linters. No DB change/replay is required.
- Focused diagnostics + InputFocus/HUD/settings regression: 99/99 PASS.
- Static World QA, mobile HUD and lobby layout browser regression: PASS.
- Desktop 1280×800, touch/mobile 360×800 and 800×360: PASS. Tests execute real
  diagnostic/panel/InputFocus modules with synthetic state and account notifications.
- Uncaught script exceptions and rejected promises, graphics loss, reconnect/offline,
  continued update ticks, protected typing, native focus trapping, account-switch
  and logout cleanup, stale clipboard completion, clipboard denial, exact downloaded
  JSON and privacy tripwires: PASS.
- Real campus lobby/settings and gameplay HUD/settings integration, real render
  metrics, trusted touch and native Clipboard API copy: PASS.

The browser harness stubs backend traffic and blocks off-origin requests. Only
synthetic account/error data is used. Screenshots and scenario receipts are written
to `test-results/runtime-diagnostics/` and uploaded by the read-only PR workflow.
The graphics-loss fixture tests the event contract, not recovery of a physical GPU.
This is Chromium coverage; Safari and physical-device certification are not claimed.

## Scope

Production changes are new diagnostic modules/style/build stamping, one settings
button/link, and the narrow composition at the end of main. Boot recovery modules,
NPC/shop logic, collision code, economic/quest/multiplayer authority, DB, deployment
configuration and server permissions are unchanged. No main merge or Production
deployment is part of this work.
