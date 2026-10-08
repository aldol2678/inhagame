# Fixed-before asynchronous PNG validation diagnostic

This is a new, explicitly versioned experiment. The original [v1 alpha-witness comparison](CAMPUS_PNG_READBACK_COMPARISON.md) remains readable with its original receipt rules and baseline; its workflow is manual-only to avoid duplicate PR experiment cost. The new workflow is `.github/workflows/campus-png-async-comparison.yml`.

## Source and sampler identity

- BEFORE application is `be2e683e5c18637327648b54da45dc2182a94a3e`, tree `a29becf3a727ce83a3a362e22649558128907912`, the approved exact 1×1 alpha witness implementation. The local engineering checkout `550f21610a6af3c4b742eabca7339159b1d6a80e` has that same tree; it is not represented as the remote commit.
- CANDIDATE application is the immutable PR head SHA, not the synthetic merge SHA. Dispatch uses its event SHA only when available.
- Both arms run the exact CANDIDATE sampler from clean checkouts. BEFORE therefore has distinct application and sampler pins. This is allowed only by `CAMPUS_REPRO_MODE=async-v2`; v1 still requires one application/sampler revision.
- There is no production-source overlay. The existing fixed-clock main-module seam is unchanged and its original/replacement hashes are checked. Review the independent full PR diff as well: the receipt source checks cover only their explicitly recorded files.
- Both common sampler SHA/tree identities and every recorded sampler/dependency hash must match. The application hashes may differ only for `src/photo/photo-capture.js` and the new `src/photo/photo-alpha-worker.js`. The baseline records the absent worker as explicit null, from a filesystem `ENOENT`; no missing-module request is injected into its runtime. The candidate records the worker source and served SHA-256. Every other recorded application source must match. As before, this does not prove that unrecorded repository files are identical.
- Browser version, PlayCanvas version/hash, Node version, platform/architecture, and hosted `ImageOS`/`ImageVersion` are required and must match. A missing or different runner image invalidates the comparison. Matching reported software and GPU names still does not establish identical physical hardware.

## Unchanged bounded measurements

The complete existing fixed-scene protocol is preserved: day/clear, frozen world clock, 1280×720 viewport, HIGH quality, render scale 1, medium shadows, 30 FPS cap, fixed player/orbit and actual camera transform/FOV, three naturally completed renders, one normal PNG request, and the unchanged 2500 ms raw postrender/update window.

The application deadline remains 10000 ms and each host-owned measurement phase remains 15000 ms. Each arm has at most two preregistered attempts, no retries, eight-minute process bound and 15-minute job bound. BEFORE finishes on one isolated runner before CANDIDATE starts on another. Unproven cleanup can stop an arm; it cannot erase the independent candidate evidence. Both arm artifacts and the final report preserve complete, partial and missing evidence with seven-day retention. No deployment or merge is performed.

The existing same-source diagnostic and Photo Mode regression workflows remain separate. Their observations are not additional attempts to pool into this A/B experiment.

## Evidence fields and interpretation

The v2 comparer keeps complete original receipts and existing terminal PNG, readback rectangles, raw pacing, late callbacks, recovered diagnostics and cleanup status. It adds `asyncValidationSummary` per capture record:

- `workerUsed` is true for the selected worker path, false for an explicit legacy fallback, and null when no path observation exists. A selected path alone is not successful worker completion.
- Encoding retains `callStartElapsedMs`, `callReturnElapsedMs`, and `callbackElapsedMs`; the report separately derives call duration, callback delay after return, and total callback delay after call. Missing/reversed intervals are null, never zero.
- Worker-local `decodeMs`, `readbackMs`, and `scanMs` remain separate. Readback includes worker canvas setup/drawing and full-resolution ImageData read. These clocks are durations and are never directly subtracted from main-thread timestamps.
- `asyncEvidence.workerValidated` requires both candidate captures to finish successfully on the actual worker path with complete encoding and worker-local timing. Fallback captures can be structurally comparable, but do not validate the worker path. Missing proof on successful candidate captures makes the comparison incomplete. A measured timeout remains evidence with missing observations retained as null.

`COMPARABLE` is structural evidence only. Fixed order, separate VMs, unknown hardware/thermal/GPU state, two attempts per arm and diagnostic browser conditions prevent a general performance, timeout-fix or real-device 30 FPS claim. The old baseline does not contain the newly added encoder/worker fields; their absence is not a measured zero. Before encoding phase-to-terminal elapsed is not equivalent to a native toBlob call-return or callback timing.

## PNG accuracy and failure coverage

`photo-mode-png-smoke.mjs` now runs the original 68 native alpha cases with a forced legacy path and the same 68 cases requiring the actual worker path. Coverage includes 1×1, one row/column, desktop/portrait/landscape native dimensions; alpha 0/1/127/255 at every corner; transparent rejection; exact decoded RGBA equality; original Blob identity/bytes; zero main-thread ImageData reads on successful worker use; and separate encoder/worker metrics. A worker fallback fails the worker correctness arm instead of silently counting as worker coverage.

Three additional bounded checks use a native module worker to reject corrupt PNG bytes and mismatched expected dimensions, and simulate a worker-constructor SecurityError to verify exact legacy witness fallback and original PNG retention. The simulated constructor error is not a real CSP-policy test.

The existing full-framebuffer-vs-download equality and UI lifecycle cases remain. Their independent framebuffer-read hook is correctness instrumentation, not the campus performance benchmark. These new browser cases are prepared for the existing hosted Chromium job; local contract tests do not establish their execution. WebKit worker behavior and physical-device gallery behavior remain untested.

## Commands

Contract tests, no browser:

```sh
node --test apps/world/tests/campus-render-reproduction.test.mjs apps/world/tests/campus-png-readback-comparison.test.mjs
```

After authorized hosted execution, analyze preserved receipts without launching a browser:

```sh
node apps/world/tests/browser/campus-png-readback-comparison.mjs \
  /absolute/path/before/receipt.json /absolute/path/candidate/receipt.json \
  '<exact-candidate-full-sha>' --async-v2 > /absolute/path/comparison.json
```

For an explicitly authorized clean executor, each collection command uses the same immutable sampler checkout, `CAMPUS_REPRO_MODE=async-v2`, the arm's exact `CAMPUS_REPRO_APP_SHA`, common `CAMPUS_REPRO_SAMPLER_SHA`, separate `CAMPUS_REPRO_WORLD_ROOT`, `WORLD_SMOKE_DISABLE_WEBGPU=1`, and separate output directory. The workflow is the reference for deadlines and dependency setup. Do not bypass a local browser/socket restriction to run these commands.
