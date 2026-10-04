# Main Hall + Jeongseok local integration

This local candidate combines the Main Hall exterior refinement and the
recovered Jeongseok exterior mount on the shared photo-landmark baseline
`316c8ff95f7a12618ec8db61342d153f3cbb29ea`, the head of
[Draft PR #108](https://github.com/aldol2678/inhagame/pull/108).

## What is actually added

- **Main Hall (`bldg_01`)**: the same building owner, strengthened with bounded
  stone-core heads, physical window reveals/sills and entrance framing. The
  four window rows remain an inherited visual estimate. No interior is made.
- **Jeongseok (`bldg_jungseok`)**: the complete available #108 front/roof/canopy
  renderer is recovered through a lifecycle-safe opt-in mount. This is reuse
  and integration, not a newly authored whole-building model. West-side work
  and changed approaches are still outside this candidate.
- **Single presentation selection**: a caller can select either the existing
  or candidate representation of either building for each BASE/NEAR/DETAIL
  tier. Changing selection destroys the old owned tier before the replacement
  is attached and made visible. Repeated selection reuses the same group.

Student Center work and its published candidate are separate and untouched.

## Try the combined local view

From the repository root, run:

```
node apps/world/dev-server.mjs
```

Open the server's local address with the path:

```
/tests/browser/campus-landmark-candidate-harness.html
```

The harness shows the two buildings together or individually at their existing
campus coordinates. The `후보` / `기존 #108` menu uses the real shared selector;
it never renders both variants of a tier simultaneously. `외피만` hides the
NEAR/DETAIL layers. Source photos, login, telemetry and production APIs are
not needed. The harness imports the repository-pinned PlayCanvas version.

## Runtime seam

```
selectCampusLandmark(parent, 'bldg_01', 'BASE', {mode:'candidate'});
selectCampusLandmark(parent, 'bldg_jungseok', 'BASE', {mode:'candidate'});
```

Repeat for the required `NEAR` and `DETAIL` tiers. The return value is an
identity-transform, caller-owned tier group. `mode` defaults to `existing`.
Only `bldg_01` and `bldg_jungseok` are accepted. Invalid arguments do not change
the current scene. A detached live group remounts; an externally reparented
group is left with its new owner. Destroy/recreate is supported.

For an actual campus binding, route the selected IDs through this seam instead
of also calling the old renderer for those same IDs. The local harness is the
only consumer added here: default campus startup remains unchanged. There is
no additional geometry loader, asset copy, source polygon, collision authority,
metre conversion, or Z reflection in the selector.

## Verification and limits

- `campus-landmark-selection-null-smoke.mjs` exercises six building/tier cases
  across three create/destroy cycles, exact legacy restoration, repeated calls,
  detach/remount, invalid input, per-tier destruction and shared materials.
- Main Hall's focused tests and both standalone real-engine Null suites remain
  part of the local verification.
- The five Jeongseok files are copied byte-identically from its reviewed
  candidate; no private reference implementation is imported.
- Null-device verification proves engine/lifecycle behavior, not visual pixels.
  The new combined view has not received graphical browser verification.
- No default activation, remote publication, merge, release, deployment,
  database migration, account or permission change is included.
