# Student center connected candidate: hosted QA boundary

## Dependency chain

This Draft is based on photo-detail PR #108 at
`316c8ff95f7a12618ec8db61342d153f3cbb29ea`, which depends on neutral-facade
PR #97 at `d2b201d8baa8294069498a793102c92fde411e48`. Neither dependency is
modified by this candidate. Main was observed at
`33dc4834c8930be6171f5b3339153794be12a889`; no automatic main rebase is included.
PR #97 was not mergeable into main at this observation, so this stack is not a
claim of main readiness. PR108's photo modules and material hook are absent from
that main tree because they are unmerged dependencies, not an established deletion.

The prior 13-file source snapshot is preserved byte-for-byte. The approved
translation remains `[2.2,-7.15]` world units (14.9616 m) with no new rotation or
scale. The historical/gameplay interior, inferred doorways, slab apertures and
actor clearances are documented in `student-center-integrated-candidate.md`.
That document records the earlier local verification stage; this companion adds
the separate hosted verification scope.

## Fixture versus live campus

The default campus, global collision/navigation, shops, NPC destinations and
portals do not import this candidate. The hosted page is a standalone QA fixture.
It uses the actual reviewed PlayCanvas geometry and connected movement adapter,
with a radius 0.48 m / diameter 0.96 m / height 1.75 m actor. Frozen nearby context
is a reference overlay, not a redesign of the rest of campus.

The read-only GitHub Actions workflow runs an offline loopback dev server and
Chromium, using the already-pinned PlayCanvas/Playwright dependencies. Off-origin
requests are blocked. No game account, production endpoint, secrets, deployment
or database mutation is used by this fixture. The repository's separate existing
public CI may run its disposable local-database regression suite; it does not
change Production.

Actual keyboard movement and actual rendered pixel receipts are reported
separately from programmatic geometry/collision probes. A passing numerical test
alone is not a pixel pass. Screenshots and receipts are retained in the workflow
artifact for the exact tested commit. Full-campus interactive integration,
photogrammetric accuracy, browser/device coverage beyond the recorded matrix and
Production FPS remain outside this fixture's claim.

No original HTML, source photographs/PDF, private file identifiers, image textures,
current tenant claims or credentials are published. The retained numerical v09
snapshot is explicitly historical/conceptual, not a surveyed current floor plan.
