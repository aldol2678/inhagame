# Same-source campus PNG / frame pacing diagnostic

This is evidence collection, not a performance or release acceptance gate.

## Identities and historical separation

- Application source: `CAMPUS_REPRO_APP_SHA`, a required full immutable commit SHA, in a clean separate checkout. CI resolves it from the PR's exact head (or the workflow-dispatch event commit), never the PR's synthetic merge commit.
- Sampler: separately pinned by `CAMPUS_REPRO_SAMPLER_SHA`, with its own verified clean checkout, exact HEAD/tree, and actual sampler and dependency file hashes. Both explicit pins must select the same instrumented revision; neither is inferred from `GITHUB_SHA` at runtime.
- Instrumentation is part of that committed app source, not an overlay. The earlier `66695573c8857d05a761b987411c6812ea158984` run lacked split readback instrumentation. This run cannot be claimed as identical application source to that earlier run. “Same-source” here means PNG and pacing within this diagnostic use one verified instrumented application.
- The app's original file hashes and browser-served hashes are compared. The test-only fixed-clock replacement records both original and served main.js hashes and the exact replacement.
- The existing rendering trace is still pinned to old main `e49419c39d884515f2402a2f3a23fe4c754b8882`; it is not current-app evidence. Earlier PNG evidence at `2f991bb` must not be combined with graphics evidence at `66695573` as one same-source experiment.
- A Preview URL or production URL alone never proves the deployed SHA. Match verified application SHA/tree and source hashes before comparison.

## Fixed, bounded protocol

Two planned fresh offline browser launches, sequentially, without retries (at most two). Both outcomes are preregistered in the receipt; if owned cleanup cannot finish, the process exits with partial evidence and the remaining attempt stays NOT_ATTEMPTED rather than overlapping a hung browser. Each uses campus with fixed world clock at epoch + 10 minutes, day/clear environment, 1280 × 720 viewport, HIGH quality, render scale 1, medium shadows and 30 FPS cap. The initial player position is `[0, 1.15, -98]`, orbit yaw 0, pitch 0.4, distance 3.5, third person. Physics settles naturally before photo entry; the receipt records the actual settled position and exact active camera transform/FOV.

After three natural completed renders, normal photo-mode UI opens. Photo mode stays active throughout both PNG and pacing measurements so the same production camera remains fixed. This deliberately differs from gameplay-mode graphics acceptance; it does not replace that test.

1. Observe three natural postrender events; export camera, position, viewport/DPR, drawing buffer, graphics, environment, clock, visibility and renderer identity.
2. Request one normal production PNG capture. Keep the application's 10-second timeout unchanged. Preserve terminal diagnostic records, PNG bytes/hash and decoded dimensions, opacity and nonblank color evidence.
3. After capture terminal state, UI busy=false and optional PNG decode, observe three more natural postrender events. This is a fixed settling rule, not a retry. No artificial renderNextFrame, forced FPS, forced GPU finish or benchmark budget change.
4. Recheck exact scene invariants, then sample actual app postrender/update events for the existing 2500 ms window. Keep minimum three rendered frames, simulation updates >= renders, and <=34 FPS ceiling unchanged.
5. Recheck scene invariants again, preserve raw sample and separate diagnostic assessment. Cross-attempt fixed scene invariants must also match. Reread photo diagnostics once in the normal bounded phase after pacing, storing them separately as `photoDiagnosticsAfterPacing`; preserve the original terminal records unchanged. Do not poll, wait extra or retry capture for a late callback.

PNG records separate synchronous `drawImage`, `getImageData` and alpha scanning as `readbackOperations`, each with start/end elapsed time and duration. Timeout records include the nominal deadline, actual callback time and callback skew; skew is scheduling delay evidence rather than proof of GPU latency. A timeout may retain one `lateEncodingCallback` observed within 30 seconds after timeout while its diagnostic record remains retained and the capture controller is alive. That observation cannot alter the terminal result or trigger a download. The post-pacing reread can capture such an observation naturally, but absent late callback evidence does not prove the callback never ran: it may arrive after the reread, outside the limit, after disposal, or after record eviction. No new waiting period, app timer or retry is introduced.

The fixed warmup excludes an active application capture request from the sample but cannot establish that native PNG encoding or GPU/driver work is idle after a timeout. It also cannot establish equal GPU queue state, driver behavior, animation phase or thermal history. A ~1 FPS CI renderer cannot establish real-device 30 FPS behavior. The diagnostic must report natural failure not reproduced as unresolved, never fixed.

Each phase persists its receipt and deadline before browser work. Startup has a separate 15-second server bound, 90-second browser/context bound and up-to-5-second partial cleanup; subsequent diagnostic phases use 15 seconds unless the receipt records otherwise. An uncertain startup cleanup stops remaining attempts. A Node-side deadline bounds renderer/protocol stalls; it does not lengthen the application's capture deadline or sampler window. On failure, the partial receipt is already durable before bounded diagnostics and screenshot. Normal close is attempted first, followed only by the harness's owned-resource abort when necessary.

## Run

Use clean app and sampler checkouts of the same instrumented commit and the sampler's pinned Playwright dependencies. Supply the reviewed full commit SHA for both explicit pins:

```sh
CAMPUS_REPRO_APP_SHA='<full-instrumented-commit-sha>' \
CAMPUS_REPRO_SAMPLER_SHA='<same-full-instrumented-commit-sha>' \
CAMPUS_REPRO_WORLD_ROOT=/absolute/path/to/instrumented-app/apps/world \
CAMPUS_REPRO_OUTPUT=/absolute/path/to/evidence \
WORLD_SMOKE_DISABLE_WEBGPU=1 \
node apps/world/tests/browser/campus-render-reproduction.mjs
```

The dedicated CI workflow checks out both identities and uploads the receipt, PNGs, optional failure screenshots and log. Its eight-minute process bound and fifteen-minute job bound preserve partial artifacts; a green collection is not acceptance. Do not substitute a different application SHA or loosen timeouts, sample minimums, trace limits or FPS ceilings to obtain green results.

For later physical-device comparison, export the receipt's actual scene and source identity, reproduce its camera/settings, and record device/browser/GPU and thermal conditions separately. CI measurements do not satisfy the existing physical-device 60-second × 3 route protocol.
