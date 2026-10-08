# Photo PNG diagnostics (QA only)

The existing Preview/local host gate plus the explicit photoDiagnostics=1 query
enables a bounded in-memory capture history. It is off by default on every host.
Canonical Production does not collect it or expose its getter. The existing
*.vercel.app gate includes immutable deployment URLs, so the explicit query is
required there too; this is a host gate, not a deployment-environment detector.
Opted-in QA can inspect
`window.__INHAGAME_P0__.getPhotoCaptureDiagnostics()`; this returns a copy of the
latest eight accepted capture requests, including an in-progress request.

Each record contains:
- `code`: null while pending, then success / timeout / unavailable / encoding / cancelled.
- `phase`: last reached working stage (request / frame / readback / encoding).
- `postrenderObservedSinceRequest`: whether PlayCanvas emitted postrender after
  this request. This is also sampled in each event, so a later render during
  encoding cannot rewrite what was observed at frameend. This is not GPU completion.
- `exceptionKind`: an allowlisted exception name or Other, never a message/stack.
- `events`: request, actual frameend callback, readback start, toBlob start, and
  terminal complete/failed. Each has monotonic elapsed milliseconds from request
  and visibility, contextLost, postrender observation, autoRender, renderNextFrame,
  canvas width/height.

frameend can occur on a render-skipped tick; autoRender/renderNextFrame values
alone do not establish whether rendering happened. Opted-in requests observe
postrender without changing rendering and remove that listener at every terminal
outcome.

The difference between adjacent event times measures the preceding stage. A
timeout in request means no accepted frame callback reached capture; a timeout in
encoding means readback finished and toBlob was invoked but no accepted encoding
completion arrived before the existing 10-second limit. This is phase evidence,
not a conclusion about why a browser failed. JS main-thread blocking can delay
both callbacks and timers beyond the nominal deadline.

No images, pixel samples, names, account IDs, tokens, raw URLs, exception text,
persistent storage, console logging or external telemetry are added. Diagnostic
clock/observer failures cannot reject an otherwise successful capture. The capture
algorithm, timeout, render request, errors, and user-visible copy remain unchanged.

The mounted-photo browser smoke saves a separate
`<viewport>-<mount>-diagnostics.json` in its output directory in a finally block,
before closing each photo page, on both success and failure. A crashed/unreadable
page produces an explicit unavailable receipt; it is not treated as success.
Collection has an independent five-second Node deadline, with fixed reasons
evaluation-timeout, evaluation-failed, or api-unavailable. This is unrelated to the
app's capture timeout. Reports are saved before page/context cleanup; cleanup is
also bounded. Only a failed cleanup invokes the optional harness abort hook,
which stops that harness's owned dev-server before independently attempting
browser closure. Normal shared harness.close ordering is unchanged. A cleanup
failure ends the QA process after evidence is saved.
The report links these receipts. Readback/security/null-blob/timeout/cancellation
unit injections validate instrumentation, not reproduction of the earlier natural
desktop-ground failure. A later normal PNG success also does not establish its cause.

Run focused checks:
`node --test apps/world/tests/photo-capture*.test.mjs apps/world/tests/photo-mode-wiring.test.mjs`

Run normal mounted browser QA with the existing offline harness:
`WORLD_SMOKE_DISABLE_WEBGPU=1 MOUNTED_PHOTO_QA_CASES=desktop node apps/world/tests/browser/mounted-photo-maps-smoke.mjs`

No performance threshold or capture timeout should be relaxed based on these logs.
