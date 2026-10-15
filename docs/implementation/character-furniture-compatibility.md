# Character furniture: local compatibility candidate

All three character asset descriptors remain `enabled: false`. No catalog, SQL,
RPC, ownership, saved UUID/revision, or production asset allowlist changes are
required by this candidate. The private GLB/PNG bytes are not in this repository.

## Placement and fallback

The existing saved-layout validator remains authoritative. A second, deterministic
UUID-ordered visual policy evaluates exact transformed GLB bounds, including the
bookshelf's off-centre Z extent. It checks room limits, exit reservations, fixed
facilities/decor, other legacy placements and previously selected expanded bounds.
If a larger visual cannot fit, that placement keeps its original geometry and
shows a rearrangement notice. It is never moved or removed automatically. A chair
also needs a collision-clear front landing point or retains its original visual.

Collision and chair anchors switch only when the new GLB is actually visible.
Loading, context loss and disabled/procedural modes retain legacy collision.
Seat IDs remain stable; a local geometry key safely invalidates an occupied anchor
when its active visual changes. The character chair uses [0, .34, -.155], transformed
by placement yaw. Editor outlines and showroom framing use the active bounds.

## Reproduction

- `node --test apps/world/tests/*.test.mjs`
- `node apps/world/qa.mjs`
- `node apps/world/tests/browser/housing-sofa-glb-null.mjs`
- `node --test apps/world/tests/browser/furniture-preview-ownership.test.mjs`
- `node apps/world/tests/browser/personal-room-preparation-null.mjs`
- `CHARACTER_FURNITURE_DIR=<private-parent-directory> node apps/world/tests/browser/character-furniture-compatibility-null.mjs`

The optional final test enables exact trusted descriptors only in its Node process.
It validates real private payloads, eight chair yaws, 32-placement persistence,
deterministic order, loading/context-loss fallback, five layer reactivations,
five whole-room entry/exit cycles, account cancellation and resource cleanup.

## Evidence limits

PlayCanvas 2.22.4 NullGraphicsDevice proves engine CPU/entity/resource contracts,
not screen appearance or GPU performance. Texture decoding uses placeholders;
postrender events are driven by the fixture. Local-ready times exclude network
transfer, actual browser painting and shader/GPU work. Browser/mobile appearance,
GPU FPS, full avatar-mesh contact and global room route connectivity remain unknown.
A clear landing point is not a proof that every room exit route is traversable.
The original dense assets are unchanged. Existing loading-stage timeouts must be
re-evaluated against real transport progress before any large-asset activation.
