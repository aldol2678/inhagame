# BOOT-PROFILE-01

Status: measurement-only instrumentation for INHA WORLD startup.

## Purpose

Measure the existing `/campus/?lobby=1` boot critical path before changing any loading behavior. This change must not lazy-load Annyongi, split feature modules, change graphics quality, alter cache policy, or change Production availability.

Pre-release policy remains unchanged: Annyongi is available to all players. The current baseline intentionally keeps `character.ready = Promise.all([duckReady, dragonReady])` so this profile can measure how much that existing requirement costs before a later optimization changes it.

## Readback

After the loading overlay reaches READY:

```js
window.__INHA_WORLD_BOOT_PROFILE__.status()
```

The same snapshot is exposed as:

```js
window.__INHAGAME_P0__.getStatus().bootProfile
```

The READY snapshot freezes resource totals before optional post-boot runtimes begin loading.

## Captured milestones

- navigation-relative total time to READY
- loading phases: BOOT, RENDERER, WORLD, CHARACTER, STREAMING, ONLINE, ASSETS, RENDERING, READY
- graphics-device creation
- asset-canary initial gate
- shared world-time synchronization and RTT
- local Induck model load/instantiate
- Annyongi model load/instantiate
- initial render-chunk update and pending count
- streaming settled
- first rendered frame
- three-frame readiness gate
- WebGPU queue drain, when available
- final paint opportunity
- online initialization
- long-task count/duration when the browser exposes Long Tasks
- NavigationTiming summary
- aggregate resource request/transfer/encoded/decoded bytes
- resource counts by coarse type only (script/style/model/image/media/api/other)

No resource URLs, account identifiers, chat content, or other user data are retained by the profiler. The profile is local readback only; it is not sent to telemetry.

## Measurement matrix

Run five samples for each lane and report median/min/max.

| Lane | Viewport | Cache |
| --- | --- | --- |
| D-COLD | 1280×800 | fresh browser context/cache |
| D-WARM | 1280×800 | normal reload after one completed boot |
| M-COLD | 390×844 | fresh browser context/cache |
| M-WARM | 390×844 | normal reload after one completed boot |

Use guest mode and `?lobby=1`; do not interact before READY.

Cold/warm production numbers are not claimed until this exact instrumented head is executed in a real browser against the intended hosted environment. Offline or CI browser measurements are validation evidence, not Production network-performance evidence.
