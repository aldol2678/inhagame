# Official furniture loader candidate

Baseline: main 1770491d0834bed8b191b38400c36155210576ac. Builds on the existing merged showroom; does not reintroduce prior showroom branches.

## Activation and scope

All five official replacement descriptors are **disabled**. Publishing this code alone does not replace any furniture. Enable only after separately approved private canonical asset publication, exact-byte verification, room/preview visual QA and device validation. No private PDF, PNG, GLB or base64 payload belongs in this repository.

Existing catalog IDs, quantities, ownership, room/account boundaries, database/RPC, dimensions, seat definitions and collision logic remain unchanged. Four owned items select code-owned descriptors; the basic bed is a fixed fixture, never a new purchasable item. A bed source-head orientation correction is explicitly declared in the manifest. Failure retains visible procedural geometry.

## Contract

- Only immutable registry object identities can acquire runtime transport. Layout/RPC data cannot introduce URLs, transforms or manifests.
- Byte length and SHA-256 are exact per asset. GLB structure is checked before engine parsing; external buffers/images, animation, skin/morph and node transforms are rejected.
- Material counts, primitive counts and triangle counts are exact. Runtime bounds are checked before placement transforms. Rug alone permits its pinned KHR_materials_specular extension.
- Sources are shared per application/URL; entity hierarchy ownership, late cancellation, last-release disposal and context-loss fallback are retained.
- Shop preview still uses the existing renderer. Captures wait for generation readiness, reject stale revisions, and key actual visual versions rather than a sofa-only version.
- Personal-room diagnostics account unique source bytes separately from per-placement triangle/primitive submissions, including the existing 32-owned-placement contract. Targets are unvalidated design hypotheses, not rejection thresholds. Shell/avatar/effect/frame/GPU totals remain unknown.

## Verification commands

- node --test apps/world/tests/*.test.mjs
- node apps/world/qa.mjs
- node apps/world/tests/browser/housing-sofa-glb-null.mjs
- node --test apps/world/tests/browser/furniture-preview-ownership.test.mjs
- OFFICIAL_FURNITURE_DIR=/private/furniture node apps/world/tests/browser/official-furniture-null.mjs

The optional private fixture reads approved payloads outside the checkout. It activates staged manifests in that Node test process only; source files remain disabled. It uses the real pinned PlayCanvas parser, materials, mesh entities and NullGraphicsDevice, with 1x1 placeholder textures via the image hook. It verifies geometry/lifecycle rather than embedded image decoding, rendered pixels, real GPU costs or device performance. Same-source 32 placements and five-source mixed 32 placements are distinct cases. No browser or GPU pass may be inferred.

The full cross-game/database public-ci aggregate is separate from the world Node suite and must be run by normal CI before merge. Production publication is a separate approval and is not performed by these tests.
