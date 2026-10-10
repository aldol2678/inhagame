# Main Hall and Jeongseok: narrow main integration

## Scope and source

Base: `1c6f43b36962f65f75cddd55b8661bb3aa4a268d` (reconciled current main).
Initial preparation used `ad89daf0a190ea6b8664da0459822d1084aef247`.
This is a narrow forward-port, not a merge of the full PR97 → PR108 → PR144 stack.
It supersedes only the Hall/library portion of PR144; those PRs remain open.

The shared Hall/library photo geometry comes from PR108 at
`316c8ff95f7a12618ec8db61342d153f3cbb29ea`. The candidate and its owner/selector
come from PR144 at `68d64e7466a2971256485b74e76c89a31e91547a`.
The latter was reviewed as an isolated opt-in candidate. This integration
intentionally adds production call-site wiring and a bounded entrance correction;
it does not claim to be the unchanged 17-file historical snapshot.

Six renderer modules are reused. The neutral facility generator, WorldForge
manifest, photo student-center override and PR135 are excluded. The current-main
batch implementation, other facilities, environment/night-window systems,
Building5, duck companion, input/transport authority and production links are
preserved. No schema, API, database, environment-variable or domain changes.

## Ownership and activation

`buildCampusLandmarks(root, ids, tier)` routes only `bldg_01` and
`bldg_jungseok` to `selectCampusLandmark(..., {mode:'candidate'})`. It deduplicates
selected IDs and sends only unselected IDs to the original builder.

The two normal-campus call sites are persistent BASE creation and streamed
NEAR/DETAIL creation in `CampusChunkRenderer`. The place-preview call uses the
same router. The selected geometry is built under the existing tier parent,
before its material-fade collection. Coordinate reflection, residency, fades,
mesh cleanup and material ownership remain with the current runtime.

The low-level selector retains explicit `existing`/`candidate` support and its
default `existing` mode. Here, `existing` is the PR108 Hall/library presentation,
not the pre-integration main presentation. The normal-campus router explicitly
selects the approved candidate. Do not also call the legacy builder for these IDs.

Jeongseok geometry is deliberately identical to the recovered PR108 geometry.
Both landmarks use the current-main semantic material producer unchanged. Its western
details and approaches are not recovered from withheld third-party imagery.

## Entrance correction and geometry limits

The historical candidate added lower window sills across the entrance glazing.
Four same-plane intersections with the entry mullions were visible as a low
horizontal bar. First-row added reveals and sills now stop outside the existing
entry frame at facade-local `u = ±1.75`. Inherited photo panes, the entrance frame,
other rows and the overall building envelope are unchanged.

Regression tests first reproduced all four intersections, then passed with zero
positive-area coplanar intersections across combined NEAR and DETAIL facade quads.
They also assert that new first-row detail does not cross the entry opening.
These numeric checks do not establish a universal absence of visual artifacts;
actual hosted near/oblique rendering and campus/preview integration are separate
verification gates.

Exterior colors and depths are illustrative. The inherited four window rows and
nine piers are estimates, not surveyed counts. No interior or actual floor plan is
inferred. Original footprint, body height, decoration envelope, collider and
navigation authority are retained.

## Verification gates

- Pure Hall/library geometry and entrance regressions
- Actual PlayCanvas owner/tier lifecycle and fade-material tests
- Current-main source-preservation manifest for unrelated runtime and authority
- Exact-head hosted WebGL rendering at desktop, portrait and landscape dimensions
- Actual campus chunk lifecycle and real place-preview route coverage
- Historical entry before/after screenshots and independent pixel review
- Current-main full public CI, including isolated CI database verification

Do not equate the earlier PR144 fixture pass with activation verification.
Attach exact-commit results in the integration PR after its workflows complete.

Actual-consumer frames use bounds-fitted diagnostic cameras and target-visible /
hidden / restored pixel checks. They verify the real chunk and route-created
preview renderers, not a full gameplay walkthrough or default preview framing.
The close entrance crop validates its doorway region and stationary pixels; its
bottom-left sample can be apron rather than sky, so it is not a silhouette mask.
Strict silhouette comparison remains in the fitted full-building views.

Current-main reconciliation preserves all upstream material-profile, sky, combat
and NPC files byte-for-byte. Literal #108/#144 comparison namespaces remain
unchanged. Separate, explicitly labeled current-material controls use historical
geometry/data and replace only `src/campus-render-kit.js` and
`src/campus-material-profile.js` with pinned current-main bytes. Resolved commits
and hashes are recorded per namespace. Exact library pixel equality and Hall
silhouette equality use those same-material controls; literal historical renders
remain evidence of the earlier appearance, including both old entrance crops.
The complete matrix has 12 cells and 20 screenshots.

Diagnostic bounds are projected after a bounded real postrender frame, because
PlayCanvas refreshes cached camera matrices during prerender. A real-engine null
regression reproduces the stale-camera failure and covers landmark changes and
portrait fitting. It proves matrix/lifecycle behavior, not browser resizing or
pixels; hosted WebGL remains authoritative for those. Shared material optics and
their fade clones are checked across residency/destruction cycles.

## Release boundary

This PR is prepared as a Draft. Merging main can automatically publish to
`inhagame.app` through the existing Vercel Git integration. Exact-SHA merge and
Production impact require a separate final approval. Recheck main drift and the
active production deployment immediately before that decision. An approved
rollback should restore the last verified production deployment and then handle
the source revert separately; routing rollback does not revert data.
