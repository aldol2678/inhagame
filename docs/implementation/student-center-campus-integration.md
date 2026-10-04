# Student center: current-campus integration

## Scope and source

This candidate is based on main `3b1bcbaddf1e2bd506206d8c67727c11dfd0a47c`
and reuses the reviewed connected student center from PR #135
(`d0c4e0d0444476477b02750acc2f760cf54f46d8`). It does not merge PR #97,
#108 or #135 wholesale. Only the student numeric geometry, connected cutouts,
material cues and walk contract are carried forward.

The original 326 v09 primitives and 20 historical collision rectangles are
byte-identical to #135 (`student-center-candidate-data.js` Git blob
`dfd91ad4ffb660ca9b590949e4a3299cd54e5340`). The production variant derives
362 convex render prisms, including 45 support pieces; 352 physical prisms
exclude diagnostic/wayfinding markers from collision.

The six-level stepped mass, rounded core, original 16-tread exterior stair,
interior Core A stair, dimensions and orientation remain unchanged. Placement
is the previously reviewed world translation `[2.2, -7.15]`, about 14.96 m.
Source meters convert once at 2 m/WU; the existing render parent alone reflects Z.
The red core and rounded glass therefore retain their intended screen sides.

The interior is a historical/gameplay interpretation with inferred openings,
not a surveyed current floor plan or a claim about current room tenants. No
original photographs, PDF, private file IDs, textures or private map data are
included. Existing color cues remain neutral procedural materials, assigned to
the current main glass/brick/concrete/paint/wood/metal optical profiles.

## Current runtime binding

- `facility-blockout.js` selects the connected student renderer before legacy
  body/roof/facade generation. Existing campus streaming and place preview both
  use this same facility owner. The #151 Hall/Jeongseok selector is untouched
- Pure frame/derived-data modules avoid a campus-layout import cycle
- `campus-layout.js` replaces only `bldg_07_0` with the static physical prisms;
  all 854 other obstacles remain. Camera, occupancy, navigation and flying
  mounts see the same walls, slabs, guards and roof as the renderer
- `player-controller.js` invokes the student full-footprint walk step before
  the ordinary collision sweep, only for unmounted campus walking. Ordinary
  movement and combat displacement use actual supported elevations
- Airborne motion retains the full static collision set. Support is queried
  from actual surfaces below the actor, never cached from airborne altitude.
  First/second-floor resume validates real support and body clearance
- Legacy `STUDENT_TERRACES` data remain only as stable shop/NPC anchor metadata;
  their invisible 0.6-WU ramps no longer affect grounding
- New mounts/summons are unavailable while standing on the building's raised
  floors/treads/terrace, preserving its walking-only contract. Existing flights
  retain terrain-only dismount rules and physical roof collision
- Student camera prisms use the already-tested finite polygon-boundary sweep.
  This avoids false hits caused by expanding thin triangulation tips. When a
  real student wall compresses the camera into the local body, the existing
  avatar-visibility guard also applies in this bounded area. For a real
  collision-compressed portrait camera it uses the current lens/aspect and
  actor radius to keep the local body from filling half the viewport width.
  Intentional uncompressed close zoom remains visible. Perspective, zoom,
  collision and other actors are unchanged
- Night panes derive from actual v09 stepped glass bands, with the existing
  deterministic night-light tier budgets. Old-footprint floating panes are gone
- Current mesh batching/material profiles/fades remain authoritative. Scoped
  detail-material clones preserve #135 depth bias without reviving its old
  shared-batch material hook; streamed fade clones and meshes dispose normally

The shop/NPC approach stays at `(144.31744749160396, 34.0443831395582)`.
Authored roads, pond, routes, outdoor NPC destinations, benches and other
buildings are not relocated. The closest C-building gap is about 0.7396 WU
(1.48 m); the historical model-to-promenade boundary gap is not a walk width.

## Verification and release gate

Run:

```sh
node --test apps/world/tests/student-center-*.test.mjs
node apps/world/tests/browser/student-center-campus-null-smoke.mjs
bash scripts/public-ci.sh
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome \
  node apps/world/tests/browser/student-center-campus-smoke.mjs
```

The focused regressions cover source preservation; complete real default
PlayerController traversal both ways; real glass openings, stairs, ceilings,
full-footprint support, unsupported-floor rejection, jump/landing, combat,
1F/2F resume, walking-only mounts, camera clear rays/real blockers, immutable
surroundings and full-body navigation clearance sampled every 0.1 WU. Existing
online pose coverage now walks/jumps on the actual terrace rather than the
retired invisible ramp. Ground movement keeps the same 0.15-WU maximum step,
0.275-WU footprint vertical spread and 0.02-WU swept increments.

The null-engine gate uses real PlayCanvas 2.22.4, real CampusChunkRenderer and
PlaceScenePreview: three load/fade/unload cycles, exactly one student owner,
exactly one reflection, no old monolith, current material optics, and resource
disposal. Null-device evidence proves lifecycle/geometry, not rendered pixels.

The separate hosted gate boots the actual offline `/campus/` app, checks all
three viewports, trusted keyboard input through its default PlayerController,
production orbit views, exterior framing, visibility deltas and source/commit
receipts. It must pass on the final published commit before claiming visual
acceptance. Local Chromium in the preparation environment was blocked by OS
socket restrictions, including the authorized escalation attempt; no local
browser pass is claimed.

Public CI and graphical checks are separate from disposable-database checks.
No schema, migration or production database file changes are included. The
preparation environment has neither Supabase CLI nor Docker; database execution
is therefore a hosted check, not a locally verified result.

## Deliberate limits and rollback

Floors above 2F remain exterior massing; the unfinished 2F-to-3F source stair is
collidable decoration. This change does not add interior NPC schedules, shop
relocation, new navigation destinations or height-aware companion pathfinding.
The existing decorative duck companion follows its ground-only behavior; its
multi-level movement is not a certified consumer of this change.

Graphics/mobile coverage is desktop Chromium viewport simulation, not physical
phone certification. Existing conceptual interior details and seams still need
review in the exact-commit screenshots; no photorealistic likeness claim is made.

Rollback is a revert of this self-contained integration commit. It restores the
old student renderer/collider/grounding, leaving #151 and all other campus work
unchanged. Publishing a draft, merge, deployment and production changes remain
separate owner decisions.
