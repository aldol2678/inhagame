# Fixed-before campus PNG readback A/B diagnostic

This bounded comparison prepares evidence for the [1×1 alpha witness change](PHOTO_READBACK_PROBE.md). It does not establish that the optimization improves native browser performance, fixes the original timeout, or reaches real-device 30 FPS.

## Source identity

- BEFORE is immutable `aa35d922716e726beb92d53d359c357f6276296c`.
- CANDIDATE is the triggering PR's exact `github.event.pull_request.head.sha`, never its synthetic merge SHA. The optional manual fallback uses the dispatch event SHA.
- Each arm checks out its own application and its own sampler from the same exact revision. The existing sampler verifies clean checkouts and records application SHA/tree, sampler SHA/tree, application hashes, sampler/dependency hashes, served hashes, and fixed-clock original/replacement hashes independently.
- The comparison requires identical sampler/dependency bytes and identical recorded non-capture source hashes. Only `src/photo/photo-capture.js` may differ among the sampler's recorded application files. It does not assert that every unrecorded application file is identical; inspect the PR diff separately.
- Different full application trees are expected. They must never be presented as one identical-source before/after run, or conflated with historical 66695573, e49419c3, or 2f991bb evidence.

## Hosted execution without merging

The original `.github/workflows/campus-png-readback-comparison.yml` is manual-only: its `pull_request` trigger remains removed to avoid repeating the completed alpha-witness experiment. Its `workflow_dispatch`, baseline, experiment and measurement rules are preserved. The existing same-source and Photo Mode regression workflows remain unchanged.

The asynchronous PNG candidate was reverted after its bounded hosted observations did not establish improved stability or performance. Candidate commit `088dbeb9ceaf27eb93436809231e829935934673` and its historical workflow artifacts retain that experiment; this rollback does not change or delete those receipts. Its new worker, async-v2 sampler extensions and automatic comparison workflow are removed together. The retained production capture matches `be2e683e5c18637327648b54da45dc2182a94a3e` exactly.

The original experiment initially used a PR trigger, without depending on dispatch of a workflow absent from the default branch. GitHub documents the [PR event and exact-head checkout](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request) and the [manual dispatch availability restriction](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch). Manual execution remains subject to workflow availability and repository permissions.

1. BEFORE runs on one GitHub-hosted runner using its unchanged sampler.
2. CANDIDATE waits for BEFORE to finish, then runs on a fresh independent runner, even if BEFORE failed. Cancellation is respected. The isolated runner prevents a stuck BEFORE browser from overlapping CANDIDATE resources or erasing its evidence.
3. A read-only comparison job retrieves each arm independently and writes `comparison.json`, retaining available evidence even if the other arm is absent or partial.

Each arm keeps the existing 15-minute job bound, eight-minute process bound, two preregistered attempts maximum, and no retries. The total comparison is at most four attempted captures. The unchanged sampler can stop an arm before attempt two when its owned cleanup is uncertain. Each arm and the combined report upload complete or partial artifacts with seven-day retention. There is no production deployment, merge, release, acceptance gate relaxation, or external communication.

The old same-source diagnostic workflow remains untouched and may also run for a capture-source PR. Its results are separate evidence; they are not extra attempts in this A/B report and must not be silently pooled into the preregistered comparison.

## Fixed scene and unchanged deadlines

Both samplers use the [existing campus protocol](CAMPUS_RENDER_REPRODUCTION.md): fixed world clock, day/clear weather, 1280×720 viewport, HIGH quality, render scale 1, medium shadows, 30 FPS cap, fixed initial player/orbit, natural three-render warmup, normal PNG request, and the same 2500 ms postrender/update pacing window. The application capture deadline remains 10000 ms. No forced GPU finish, extra waiting for a late encoding callback, retry, synthetic FPS, or alternate canvas capture is added.

The comparer invokes the existing `assertSameCampusScene` for every available before-PNG, before-pacing, and after-pacing scene across both arms and both attempts. Missing scene keys are rejected. Camera transform/FOV, actual settled position, viewport/DPR, drawing buffer, graphics, environment, fixed clock, visibility, photo-active state, and reported GPU driver must match. Runtime/engine and browser versions must also match. Drift yields `INVALID`; absent or partial measurements yield `INCOMPLETE`, not a successful reproduction search.

## Read-only local comparison

After downloading both artifacts, run without a browser:

```sh
node apps/world/tests/browser/campus-png-readback-comparison.mjs \
  /absolute/path/before/receipt.json \
  /absolute/path/candidate/receipt.json \
  '<exact-candidate-full-sha>' > /absolute/path/comparison.json
```

The tool only reads receipt files and writes JSON to stdout; shell redirection selects the new report file. Exit zero means structurally comparable observations, not performance acceptance. Invalid/missing evidence produces exit one with the available evidence still in the JSON. The report preserves the complete original receipts.

- `arms.*.measurements` retains terminal PNG records, later post-pacing diagnostics, recovered diagnostics and raw pacing separately.
- `readbackSummary` aggregates all `getImageData` durations within each terminal capture record. A fallback has two operations (1×1, then full frame); do not compare only the first duration. Original operations and rectangles remain unchanged. Missing or unfinished durations yield a null aggregate, never a fabricated zero. Old records without rectangle metadata have null requested-pixel totals.
- `arms.*.cleanup` and `cleanupStatus` remain independent of `measurementStatus`. A close/abort failure can coexist with complete PNG/pacing observations. It does not rewrite the PNG terminal result. Each artifact's `process.json` retains the arm exit status separately.
- Timeout callback skew is scheduling-delay evidence. An observed late callback does not change the terminal timeout; an absent late callback does not prove encoding never completed.

## Interpretation limits

BEFORE runs first and CANDIDATE uses a different VM. Fixed order and machine differences are confounds even when runner image, browser, engine and reported GPU names match. Matching names do not establish identical physical hardware, GPU queues, animation phase, thermal history, or native encoder idleness. Two observations per arm cannot establish a general improvement. Keep durations, timeout/failure codes, PNG validity, pacing and cleanup side by side without declaring a fix from a green workflow or synthetic unit tests.

Contract tests use synthetic receipts and prove analysis/control-flow behavior only:

```sh
node --test apps/world/tests/campus-png-readback-comparison.test.mjs
```
