# Neutral backgate shopfront browser QA

This is a prepared, bounded GitHub-hosted QA job, not evidence that a browser run
has passed. Do not launch it locally after a denied local-browser attempt. A push
or pull request is a separate publication action and needs the owner's approval.

## Comparison contract

- Candidate: the exact pull-request head, checked out with no persisted credentials
- Current app preservation baseline: `413d984fcb59216e7f07bafed1fffc618351a109`
- Old facade sources: pinned commit `d9cbd3948e4e5acf359313824387dc8695c3e672`
- Only `/src/back-street-geometry.js`, `/src/culture-street-geometry.js`, and
  `/src/culture-street-signs.js` are served from `git show` on the old page
- Every other module, including renderer, materials, current student-center/Life
  features, PlayerController, layout, collision and ground heights, stays current
- The existing offline harness supplies pinned PlayCanvas, stubs Supabase and
  `/api/*`, and blocks all other off-origin requests. No Production login or API
  is used. No new dependency or runtime debug API is added

Both variants boot the actual campus. The fixture freezes update callbacks,
retains the actual persistent BASE and all target-owned chunk layers, and hides
actors/non-chunk props/UI. The sky is hidden behind a fixed blue diagnostic
background. These are explicit QA view changes, not changes to runtime source.

## Evidence and gates

The 48 PNGs cover old/new × desktop 1280×720, portrait 390×844 and landscape
844×390 × four views × two layer states. The views are back street, both opposing
culture sides, and the culture terminal's actual local `v=1` front. Each pair
uses the identical camera, measured from unchanged layout facts. Orthographic
facade-inspection cameras remain within the narrow street rather than backing
through the opposite building in portrait mode.

Layer states are ALL (BASE/NEAR/DETAIL) and BASE-only. Assertions cover:

1. Exactly 37 layout targets owned once by actual chunks; all target tier meshes
   have finite positions, normals and world bounds
2. WebGL2, correct drawing-buffer dimensions for the unchanged active graphics
   profile, zero GL errors/context loss. CSS screenshot dimensions are separate:
   mobile LOW retains its 0.8 maximum pixel ratio (312×675 and 675×312 backing
   buffers at DPR 1), while PNGs remain 390×844 and 844×390 CSS pixels
3. Fully framed target facade bounds, visible target contribution within that
   facade's projected rectangle, exact repeated stationary pixel hashes, and
   exact hide/restore and ALL→BASE→ALL restoration
4. Different old/new raw-frame hashes and more than eight changed RGB samples
   in a fixed 32×32 projected-facade sample grid
5. Eight representative actual-PlayerController routes per page: forward/reverse
   along a capsule-clear segment for back street, both culture sides and terminal.
   Every tick must remain finite, collision-clear and on the current height
   surface; old/new traces must match exactly. Route selection never drops an area
6. The separate real-engine NullGraphicsDevice lifecycle gate checks renderer
   ownership, fade copies, repeated cleanup and shared material-cache stability
7. A second pinned-engine null-device gate exercises the actual fixture, all 12
   cameras, positive camera-forward depth, projected bounds and layer restoration

`report.json` includes exact commit identities, baseline module hashes, selected
camera/plot data, disabled roots, per-tier mesh counts, controller traces, pixel
receipts and screenshot hashes. `SHA256SUMS` additionally hashes every PNG and the
final report. Partial evidence and a FAIL report are retained on normal failure.
The workflow uploads the exact-head-named artifact for seven days. It uses
read-only contents permission, a pull_request path filter, full history, a
12-minute process timeout and an 18-minute overall job limit. The script has an
11-minute watchdog, bounded boot/operations/frame waits and bounded cleanup.

## Commands

Safe local non-browser contracts:

```sh
node --check apps/world/tests/browser/backgate-shopfront-smoke.mjs
node --check apps/world/tests/browser/backgate-shopfront-fixture.mjs
node --check apps/world/tests/browser/backgate-shopfront-walking.mjs
node --check apps/world/tests/browser/backgate-shopfront-qa-plan.mjs
node --test apps/world/tests/backgate-shopfront*.test.mjs
node apps/world/tests/browser/backgate-shopfront-null-smoke.mjs
node apps/world/tests/browser/backgate-shopfront-fixture-null-smoke.mjs
```

Only the approved GitHub-hosted pull-request job may run the browser command:

```sh
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome \
WORLD_SMOKE_TIMEOUT_MS=60000 WORLD_SHOPFRONT_QA_OUTPUT=test-results/backgate-shopfronts \
EXPECTED_SHOPFRONT_HEAD="$PR_HEAD_SHA" \
timeout --signal=TERM --kill-after=15s 12m node apps/world/tests/browser/backgate-shopfront-smoke.mjs
```

The script also requires genuine hosted-runner environment fields. Do not spoof
them to run locally. Full-history checkout and the existing browser package's
`npm ci --ignore-scripts --no-audit --no-fund` are handled by the workflow.

## Limits

This does not establish real-world facade accuracy, image/reference fidelity,
measured shop dimensions, brands, interiors, textures, production sky, chase-camera
framing, FPS/performance, WebGPU, hardware-device behavior or real keyboard/touch
input. Only four representative facade views are rendered; 37-plot geometry,
layout/collision preservation and resource lifecycle are separate unit/null-engine
gates. A diagnostic pixel difference proves visible change, not aesthetic quality.
The screenshots require human visual review before a visual-quality conclusion.
No push, PR creation, merge, release or deployment is performed by preparing this QA.
