# Biryong CPU/render diagnostic (not an acceptance gate)

## Approved scope

Investigate why the immutable main control and PR301 LOW/Visual OFF both produced
~533 ms p95 on the same SwiftShader runner. This sampler uses the existing offline
harness and its selectable worldRoot, pinned PlayCanvas 2.22.4, Chromium Chrome,
and the exact LOW/OFF camera/player/day/clear setup from
`biryong-performance-smoke.mjs`. Application runtime, quality thresholds (85/160 ms),
frame-limit preferences, production, and existing browser gates are unchanged.

The source must be a clean tracked checkout of
`e49419c39d884515f2402a2f3a23fe4c754b8882`. The receipt independently verifies its
HEAD/tree and records the sampler SHA. This intentionally remains the historical
control even if main advances; changing that control requires a separate decision.

Run the dedicated `Biryong rendering diagnostic only` GitHub workflow on the
approved QA branch. Publishing or dispatching it is a separate authorized step.
It uses read-only contents, no secrets, ephemeral offline local services, a fresh
browser context with no account, and always uploads artifacts for seven days.
No screenshots, video, network-payload capture, or user data are collected.
Trace categories are explicitly allowlisted and screenshots/network categories
are omitted. All app off-origin requests remain handled by the existing offline
harness (local PlayCanvas response, empty Supabase script, remote requests blocked).

## Controlled sequence and artifacts

After the existing fixed scene and a 12-RAF settling period:

1. `baseline-before`: original LOW drawing buffer (normally 1024 × 576)
2. `half-resolution`: each drawing-buffer dimension halved (normally 512 × 288),
   one quarter of the pixel area
3. `baseline-after`: restore the original drawing buffer

Only the temporary test page's device maxPixelRatio changes. CSS viewport,
preferences, frame limit, shadows, camera, player position, environment targets,
and render-component count are checked before/after each window; drawing-buffer
size is recorded per engine frame. Camera transform and player position have a
0.01 numerical tolerance; other invariants are exact. Dynamic animated world
contents are not frozen: normal app simulation continues in every phase. The
sequence can detect some order effects but cannot eliminate shader/cache/warmup,
NPC animation, weather interpolation, or shared-runner variance.

Each host-timed window is 8 seconds with at most 120 retained samples per stream:
- RAF timestamps, observed counts, intervals, and summary
- postrender timestamps, observed counts, intervals, and summary
- frameupdate → framerender CPU-wall elapsed span
- framerender → frameend CPU-wall elapsed render-submission span, plus whether
  rendering actually occurred (null span for skipped renders)
- raw engine update/render/script/animation/cull/sort/forward counters and draw calls
- drawing buffer, driver, browser version, scene snapshots, page clock/timeOrigin
- DevTools trace JSON and a V8 CPU profile sampled every 2 ms

Trace: 8 MiB browser buffer and 8 MiB / 50,000-event output cap per window, valid
partial JSON on truncation; browser buffer saturation/data loss is reported as partial;
CPU profile: 4 MiB cap per window (oversize profile omitted and reported).
Sample caps retain the first samples and report observed counts/capping. The full
8-second profile can therefore cover more frames than the retained frame samples
at high frame rates. `performance.mark` start/end names delimit each measurement
inside the trace; profiler and trace start before those marks and stop after the
ending scene snapshot, so analysis must align to those marks rather than treating
the whole artifact as precisely the sample window.

New diagnostic phases have 15-second host deadlines; existing boot TIMEOUT_MS and
all existing smoke deadlines are untouched. The command has a six-minute process-group
bound (TERM, then KILL after ten seconds), and the workflow a ten-minute outer bound. `receipt.json` persists before/after phases; trace/profile flush and sample
recovery are separately bounded even after a fatal page error. Partial diagnostics
are nonzero-exit, not silently green. A green job only means collection completed:
`measurementClass=DIAGNOSTIC_ONLY`, `performanceAcceptance=NOT_EVALUATED`.

## Interpretation

Load each `.trace.json` in a local DevTools Performance viewer; inspect marked
windows, main-thread tasks, renderer/compositor/GPU-process scheduling and raster
work. Load `.cpuprofile` in a local DevTools JavaScript profiler to inspect the
application update callbacks, PlayCanvas traversal/culling/submission, V8 and GC.
Profiles may include code paths/URLs only from this synthetic offline browser.
Do not upload profiles to third-party services without approval.

The pinned production PlayCanvas bundle does not maintain every profiling field:
`updateTime` can remain zero and `renderTime` can use an uninitialized `renderStart`.
Raw stats are retained, but **are not authoritative CPU timings**. Hook spans
measure elapsed wall time on the JS thread (including waiting/stalls), not on-CPU
execution exclusively. Draw calls can lag a frame in engine stats. Use the sampled
CPU profile and trace to explain rather than simply add these counters.

Compare baseline-before/after first. Large baseline drift makes the half-resolution
comparison inconclusive. With stable controls, a strong half-resolution interval
improvement plus unchanged app-update CPU evidence supports a pixel/raster/driver
bottleneck hypothesis. A matching fall in render-submission elapsed time may also
reflect blocking/backpressure. Unchanged intervals with expensive CPU stacks supports
a CPU/update/submission hypothesis. Neither establishes a physical-GPU bottleneck
or precise GPU cost: **no GPU timer query is performed**, and SwiftShader raster
executes on CPU workers. Frame intervals and submission spans must never be named
GPU milliseconds. Profiling overhead and one short sequence preclude acceptance,
causal proof, Android/PC battery/thermal conclusions, or threshold changes.

## Local verification without a browser

- `node --test apps/world/tests/biryong-render-trace.test.mjs`
- `node --test apps/world/tests/*.test.mjs`
- `node apps/world/qa.mjs`
- `node --check apps/world/tests/browser/biryong-render-trace.mjs`

Browser execution belongs in the approved GitHub QA route when local sockets or
localhost access are restricted. Do not route around those restrictions.

## Emergency cleanup integration dependency

The sampler uses the optional owned-resource `startSmoke().abort()` hook included
with PNG diagnostics in this integrated change. The common harness keeps its
existing normal `close()` path; successful normal close performs no additional
cleanup. Only close rejection/timeout calls `abort()` under the same
host-bounded diagnostic phase deadline. The hook stops this harness's own
dev-server, then attempts browser close. If abort also rejects/times out (or the
hook is missing), the sampler persists the final partial receipt before explicitly
exiting with status 1, allowing artifact upload. It never kills unrelated processes.
The workflow process-group timeout remains an outer safeguard.

## Continue controls after output-only trace truncation

A trace JSON reaching the unchanged 8 MiB/50,000-event output cap is recoverable
only when frame/scene validation and CDP profile/trace shutdown all succeeded.
That window remains PARTIAL with its cap warning; the sequence continues through
baseline-after. Any partial window keeps the final receipt DIAGNOSTIC_PARTIAL and
process exit 1, even if baseline-after succeeds. Empty traces, browser buffer
saturation/data loss, CPU-profile failures, CDP cleanup failures, and collection
or scene-validation errors still abort the sequence. Trace categories, durations,
sample limits, host deadlines, and performance acceptance gates are unchanged.
