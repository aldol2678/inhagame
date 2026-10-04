# Main Hall exterior integration candidate

## Status and activation

This is a local, opt-in `bldg_01` exterior candidate on top of the photo-landmark
branch. It does not activate itself in the campus, edit canonical geometry,
publish a model, add a loader, or define an interior.

Call `buildMainHallCandidate(parent, tier)` for `BASE`, `NEAR`, and `DETAIL`.
It returns a caller-owned identity-transform group. Select this **instead of**
the normal `bldg_01` renderer for each tier. The adapter delegates to the same
`buildMainHallBlockout` owner with `{mainHallDetail:'candidate'}`. The default
owner call still selects `existing`, and the Jeongseok path is unchanged.

Repeated calls for the same parent/tier reuse the group. A detached live group
is remounted; a group moved under another owner is not reclaimed. Destroying a
group invalidates its cache entry. Mesh destruction and shared material lifetime
remain with the existing `FacilityMeshBatch`/campus render contracts.

## Source reconciliation

- Earlier September 24 WebGL campus artifacts used two abstract rectangular
  blocks for Main Hall. Their relative game positions are not campus placement
  authority and are not imported.
- The September 25 Stage 2 Main Hall artifact is a survival-game hall with
  attendance points, columns, and a conceptual corridor. It is not a surveyed
  floor plan and is not imported as an interior.
- The historical World exterior code already established the source polygon,
  southwest front frame, nine piers, window bays, two tall glazing strips,
  entrance, and stair approach. These are the current owner's lineage.
- The October 1 field-reference views support a pale facade, deep framing,
  paired taller stone-framed glazing, and a framed entrance. They do not supply
  measured dimensions, an interior plan, or permission to alter placement.
- The photo-landmark branch already refines pane/joint colors. Its pure
  `fillPhotoMainHallFacade` output is reused once inside the candidate, rather
  than layered with a second copy of the existing facade.

## Bounded design delta

1. `BASE`: the nine original pier dimensions and locations are unchanged.
   The old continuous entablature/coping is replaced by a batched segmented
   header with two subtly raised end-core heads. All pieces fit the old facade
   envelope: the building remains 10.5 WU, and the pre-existing decorative
   maximum remains 10.97 WU.
2. `DETAIL`: existing photo panes and joints remain. Physical side/top/bottom
   window reveals, shallow sills, and pale end-core collars add depth inside
   the existing column projection.
3. `NEAR`: the original entry dimensions receive batched exterior framing and
   reveals. The building body stays closed; this is not a walk-through doorway.

Four window rows and nine piers are inherited illustrative counts, not a claim
about the actual building's floors. Depths, collar widths, and core-head offsets
are qualitative estimates. The source polygon, body height, building center,
approach steps, navigation anchors, collisions, ground, and other buildings
are unchanged. Photos, private identifiers, textures, and unrelated source
artifacts are not included in the patch.

## Verification commands

```
node --test apps/world/tests/main-hall-candidate.test.mjs apps/world/tests/photo-hall-library.test.mjs
node apps/world/tests/browser/main-hall-candidate-null-smoke.mjs
node apps/world/tests/browser/photo-landmarks-null-smoke.mjs
node --test apps/world/tests/*.test.mjs
bash scripts/public-ci.sh
```

`tests/browser/main-hall-candidate-harness.html` supports same-camera
existing/candidate full and entry-close comparisons. Its smoke runner covers
desktop/portrait and normal/reflected coordinates. A null-device pass is not
pixel verification. In the local executor the graphical run could not start
because the pinned Chromium executable was absent; no browser was installed
and no remote publication was performed to work around that limit.
