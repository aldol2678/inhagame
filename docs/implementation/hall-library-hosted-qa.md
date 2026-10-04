# Hall and library candidate: hosted QA boundary

## Dependency and frozen source

This separate Draft targets the branch of [#108](https://github.com/aldol2678/inhagame/pull/108)
at `316c8ff95f7a12618ec8db61342d153f3cbb29ea`, which depends on
[#97](https://github.com/aldol2678/inhagame/pull/97) at
`d2b201d8baa8294069498a793102c92fde411e48`. The Student Center work in
[#135](https://github.com/aldol2678/inhagame/pull/135) is not a dependency and
is unchanged. Main was observed at `9af65bca63b9bd0f97f247fec346d08b15ec7099`;
#97 was still not mergeable with main. This candidate does not resolve that
separate integration conflict or automatically rebase any dependency.

The 17 files in `tests/fixtures/hall-library-candidate-source-manifest.json`
remain byte-identical to the reviewed local candidate. Original local
documents remain a historical record of the then-unverified graphical stage.
New files add only hosted verification and its documentation, not new
building features, geometry, collision or default campus activation.

Main Hall preserves its original footprint, body height and old facade
envelope while adding bounded visual depth. Counts and dimensions remain
illustrative; exterior photos do not establish a surveyed floor plan.
Jeongseok reuses the #108 front/roof/canopy. No private Naver-derived west
facade or altered approach/terrain geometry is added.

## Read-only graphical verification

The workflow checks out the exact PR head and makes the pinned #108 source
available as an offline baseline. The real PlayCanvas renderer compares that
baseline with the existing selector mode and the candidate selector mode.
The baseline is read from Git; it is not a second maintained runtime model.

Three Chromium viewports (1280×720, 390×844, 844×390), reflected and control
coordinates, both buildings, and BASE/NEAR/DETAIL ownership are covered.
The fixture verifies actual pixels, full-silhouette framing, stationary
stability, single selected presentation, rebuild/detach behavior and engine
errors. A small set of screenshots supports the numeric receipts. Explicit
operation deadlines, progress messages and incremental receipts bound the
run and preserve evidence when a graphical step fails.

Only the new selector is used for candidate/existing ownership. Default campus
startup is not changed. The fixture has no account, production API, telemetry,
database, credential or user-data dependency. Off-origin requests are blocked;
the pinned engine is supplied from runner-local dependencies. Source photos,
PDFs, private file identifiers and unrelated implementation artifacts are not
published.

The workflow uses `contents: read`; it does not deploy or write repository
content. Its output artifact contains test receipts and rendered screenshots.
No merge, auto-merge, Production deployment, production database action,
WorldForge promotion, account or permission change is included.

## Interpretation of results

Read the exact-commit workflow result and artifact receipt for graphical status.
A Null-device pass is not graphical proof. Simulated mobile viewports are not
physical-device performance tests. Static coplanar-face checks and stable
frames are bounded regression evidence, not a claim that every viewpoint is
artifact-free or that the model exactly reproduces the real building.

The frozen Main Hall source has four small cross-tier coplanar intersections:
DETAIL window-sill fronts meet NEAR entrance-mullion fronts, each over
0.06×0.055 WU and with the same pale trim color. Earlier per-tier checks did
not include these pairs. The new guard records exactly these four and rejects
additional intersections; graphical evidence must report their behavior
without claiming zero overlap or silently modifying the reviewed source.
