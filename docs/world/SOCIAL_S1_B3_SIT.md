# INHA WORLD · Social S1-B · Sit (tree-seat benches)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Product: Notion *Social S1 v0.2* §14 (벤치 / 앉기). Network: *Online Architecture* pose contract.

## Seat anchors

- Source geometry: the Inkyung pond east-bank tree seats from private #106 (4 trees × 8 slabs). Their
  layout now lives in `roadview-layout.js` (`POND_TREE_SEATING`, `pondSeatTrees()`), used by both
  the renderer and the anchors, so seats always line up with what is drawn.
- `src/seat-anchors.js` → `SEAT_ANCHORS` (32): `{ id, interactableId, type: "seat", placeZoneId,
  position, yaw, standPoint }`, IDs `SEAT_INKYUNG_TREE_<n>_<A..H>`, all in
  `AREA_INKYUNG_STUDENT_CENTER`. Game interaction data, not surveyed coordinates.
- Add benches by appending anchor records; nothing else changes.

Constants (world units, 1 unit ≈ 2 m): interact range 1.5 (~3 m), occupied radius 0.35,
hip-to-seat 0.1, stand-up clearance 0.6.

## Interaction

- Contextual `🪑 앉기` / `🧍 일어나기` button (bottom centre above chat; only near a free seat,
  never while mounted or airborne) and **F** (was unused; ignored while typing in a field).
- `src/seat-interaction.js`: sit aligns position and yaw to the anchor; while seated the
  PlayerController does not translate the player. Move, jump, mount, a Place Zone change or an
  explicit stand returns the player to the anchor's `standPoint` with locomotion restored.
- An emote while seated stands up first, then plays (no seated emote variants in S1).
- Chat works while seated; keys typed into the chat input never reach the controller, so typing
  never stands the player up.

## Network

Sitting is pose **state**, not a one-off action: `Anim.SIT = "sit"`. Sitting and standing force a
pose snapshot (seat position, yaw, anim), so late joiners see a seated player through the existing
join/sync snapshot. Remote avatars render the seated pose; no collision. Leaving the zone or
disconnecting removes the remote (and frees the seat). Nothing is stored.

## Occupancy

Best-effort from what this client sees: a remote pose with `anim: "sit"` within 0.35 of an anchor
holds it, and the prompt offers the nearest free seat instead. Two clients can still claim the same
seat at the same moment; there is no distributed lock in S1.

## Pose and camera

Procedural pose on the per-frame rest pose (legs forward, slight lean back); exact return to rest
after any number of sit/stand cycles. First person works seated (eye follows the seated character).
The private #106 tree seats are tall (seat top ≈ 1.1 m) for the human-scale duck from private #108, so a seated
player looks perched and the seated eye is higher than standing — geometry polish candidate.

## Guest / offline

Guests sit and stand locally and broadcast nothing. View distance changes never stand the player or
change the Place Zone.

## Analytics

`bench_sit`, `emote_used` and `chat_sent` stay deferred to one Social telemetry patch (event
allowlist in the API and a DB constraint).
