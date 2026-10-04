# Student center: detailed blockout and photo presentation combined

## Status

This is an **isolated local PlayCanvas candidate**, based on photo-refinement PR108
at `316c8ff95f7a12618ec8db61342d153f3cbb29ea`. It is not active in the campus
facility, collision, ground-height, shop, NPC, portal or WorldForge import paths.
PR97/108 and their older working copies have not been edited. Main was observed at
`91aab3b9ea4c53f2576794596c6d9dd5ea412d36`; no main integration was attempted.
The PR108-only photo modules and material hook are absent from that main tree;
this is an unmerged dependency boundary, not evidence of a deletion on main.

## What was integrated

- The actual earlier v09 HTML supplied 326 numeric primitives: 159 exterior,
  80 first-floor and 87 second-floor elements. Its 20 layer-specific collision
  rectangles are retained as immutable source data
- Six-level stepped massing, rounded culture/core volumes, deep second-floor
  terrace, sixteen outside treads, interior Core A stairs, service/culture/public
  areas and two food-hall inspection regions are preserved
- The accompanying candidate JSON supplies the opposite core box and narrow
  muted-red stair accent. The photo-detail runtime supplies the material palette
- New photo-inspired pale stair bands wrap the red accent's actual surfaces;
  opposite rounded-core glazing is faceted to remain outside the source core
- The current `FacilityMeshBatch`, shared campus/photo materials, BASE/NEAR/DETAIL
  conventions and entity-owned mesh lifecycle are reused. No new engine or dependency

The source snapshot is numeric geometry, not the original document. No photograph,
PDF, private file identifier, real business branding or texture is included.
The reconstruction remains a historical/gameplay interpretation. The old plan's
1986 room program and advertised enlarged interior are not current tenant claims,
a measured floor plan or authority to replace the current campus envelope.

## Coordinates and binding boundary

Source units are meters; the documented conversion is 2 meters per world unit.
Local +Y is up and +Z faces the pond. The adapter uses the existing bldg_07 center
and terrace-edge outward normal, with a right-handed +X basis. The edge tangent
and outward normal alone form a reflected basis, so copying both directly would
reverse the model. Production negative-Z reflection remains solely at the render
parent. The red end then reads screen-left and rounded glazing screen-right.

The original v09 geometry reaches 22.55m / 11.275 world units, compared with the
current 13-unit envelope. Its terrace is near 4m / 2 units, compared with the
current 0.6-unit five-step terrace data. Part of the candidate lies outside the
current polygon. Uniform anchor placement cannot preserve both authorities.
Stretching the source into that polygon would erase its proportions.

The owner approved the original-orientation comparison pose at offset
`[2.2,-7.15]` world units for isolated connected implementation. This translates
the source by 14.9616 m without rotating or scaling it. The phase-one snapshot
remains available unchanged; only the new connected preview uses this placement.
Production binding/publication still requires its own review and approval.

## Phase-one source inspection and walking limits

Interior1/Interior2 are separate inspection views, hiding the opaque v09 macro
mass so the historical layout can be inspected. They are not production interiors
or connected portals. The isolated walk function preserves layer transitions but
conservatively restricts support to source floor slabs, rather than v09's overly
broad upper bounding box. It also restricts outside stair ascent to the actual
12m treads and blocks their solid side cheeks. These fixes leave source data intact.

A 0.26m actor-contact tolerance spans the inherited 0.5m terrace/food-hall seam;
it is below the 0.48m actor radius. The larger Core A/terrace gap is not bridged.
Floors and stair tops retain the small original vertical offsets. The walkthrough
checks are sampled mathematical checks of this historical candidate, not visual
or production-character collision certification. Source opaque masses, conceptual
walls and furniture are not a fully reconciled current building interior.

## Verify the source inspection snapshot

```sh
node --test apps/world/tests/student-center-candidate.test.mjs
node apps/world/tests/browser/student-center-candidate-null-smoke.mjs
bash scripts/public-ci.sh
```

Preview page: `apps/world/tests/browser/student-center-candidate-harness.html`.
Serve through the existing dev server with the browser-test dependencies available.
It exposes exterior/1F/2F, reflected/control, near-detail and stair-walk controls.
No online service, production API, sign-in, deployment or database action is used.

The null-device test creates/destroys all three views three times and checks
shared material reuse, cloned decal bias and exactly-once vertex-buffer disposal.
It does not generate pixels. Graphical verification remains pending: the local
Chromium process was blocked by an OS socket restriction and the dot cloud
browser rejected localhost with `ERR_BLOCKED_BY_CLIENT`. No visual pass is claimed.


## Connected preview (approved local continuation)

Use `student-center-connected-renderer.js` and `createStudentConnectedMovementSpace()`
only in an isolated fixture. The production import graph does not reference them.
`student-center-connected.js` derives 362 convex prisms and 45 support pieces from
raw v09 geometry. Rendering and collision use these same adjusted prisms.

The explicit inferred adjustments are:

- Hollow the 1F macro blocks in their existing historical floor regions and the
  2F main block in its food-hall region; retain the source outer silhouettes
- Widen 1F and 2F glass openings to 1.8 m, with 2.5 m clear opening height
- Carve the exterior terrace rim at the original 12 m stair flight; do not rotate
  or move any source tread. Its actual top is 3.95 m, then terrace 4.045 m
- Cut the full Core A flight aperture in its floor, with side guards; add a new
  inferred rear Core A/café doorway at z≈−17 m, 2.4 m wide/high. This avoids the
  unsupported 3 m front gap and the narrow side passage
- Add the missing entry apron and 0.5 m café/terrace seam slab. Clip source public
  floor overhang to the unchanged outer wing; this restores the external gap
- Clip rounded photo glazing by the exact same Core A cutout as its backing wall

Raw snapshot counts, six stepped masses, original 16+16 treads, coordinates,
orientation and broad external proportions are preserved. The connected adapter
is an inferred gameplay layout, not a measured current interior. The unfinished
2F→3F flight is retained as collidable decoration, not an accessible third floor.

### Grounding and actor contract

The real `WALK_SHAPE` is used: radius 0.24 WU = 0.48 m, diameter 0.96 m,
height 0.875 WU = 1.75 m. `canOccupy`, `moveAroundObstacles`, and `resolveHeight`
remain the collision authority. A conservative 0.96 × 0.96 m radius-square must
be fully covered by the union of actual support rectangles, including every
swept strip, not merely waypoint centers or sampled radial points. No horizontal
seam tolerance is used. A 0.30 m per-step rise and 0.55 m under-foot vertical spread
allow the original 0.85 m treads to support a body footprint spanning two 0.25 m
risers. This is a discrete stair-footing convention, not an invisible ramp.

The surrounding campus uses its existing flat-ground y=0 contract. Approach
routes traverse that land, not newly constructed global roads. The isolated
movement space preserves confirmed support during a jump, supplies real overhead
colliders, and never promotes airborne feet to ground. Mounts are disabled.
The default initializes at ground entry. For a fresh 2F spawn, pass a world-space
`initialState: {x,z,elevation}`; both actual support and body clearance are
validated, and a floating or obstructed spawn throws.

### Frozen context and test scope

All 362 prisms clear the frozen context: 854 obstacles, 46 road corridors, 24
path corridors, pond, 572 actual promenade cells, 72 seats/exit sweeps, and the
actual 48-NPC population's 186 snapshots/159 purposeful destinations plus shop.
Closest C-building gap is 0.739630 WU ≈ 1.479 m. Closest model-to-promenade boundary
is 0.297838 WU ≈ 0.596 m; that number is not the walkway width.

The accessible test loop is 1F entry → Core A → rear café doorway → left café
aisle → front café door → terrace → original exterior stairs → ground entry.
Both directions, local/world coordinates, door side-pane collisions, headroom,
phantom floors, high-speed sweeps, shop approach, jump grounding, and lifecycle
are tested. Collision coordinates are never pre-reflected; the render parent
alone applies −Z. Tests with NullGraphicsDevice verify buffers/materials, not
pixels. Browser/photo-likeness QA remains unverified under the prior environment
restriction. No publishing or fresh browser bypass was attempted.

The initial connected defects (public-floor overhang, pane/cutout mismatch,
airborne cache) are covered by regressions. The final package includes exact
patch, source manifest and validation receipts. No source photos/PDFs, private
Library identifiers, current business-name claims or credentials are included.

Connected preview verification:

```sh
node --test apps/world/tests/student-center-{candidate,connected}.test.mjs
node apps/world/tests/browser/student-center-connected-null-smoke.mjs
```

Connected fixture: `apps/world/tests/browser/student-center-connected-harness.html`.
