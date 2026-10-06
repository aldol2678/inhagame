# Housing H2 / D3 — Collection furniture editing and save

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Owner room HUD → **꾸미기** opens a room plan with a live 3D preview. Add an owned item, select it in
the plan/list, tap a location or use movement buttons, rotate by 45°, change its mounting surface,
or recall it. **저장** persists the complete snapshot; **완료** closes the editor. A dirty close asks
whether to keep editing or discard. A failed save keeps the draft; a revision conflict never
overwrites another tab's saved layout. Identity/room changes discard old drafts and late responses.

The six existing DORM_1_BASIC fixtures remain fixed template decorations. The editor supports the
nine existing `furniture.*` Collection IDs: campus map poster, Induck cushion, dorm desk lamp,
Induck chair, mini Induck, campus blue rug, dorm resident plate, MCM landlord figure and MCM poster.
Desk props fit around the fixed laptop; bed cushions fit around the pillow; wall decor avoids the
window and entrance. Inventory quantities stay unchanged when placing or recalling objects. This
feature adds no grants, currency, shop listings or new acquisition routes. An account without owned
furniture sees an explicit empty state.

## Persistence and authority

- Migration: `20261002136000_world_personal_room_furniture_d3.sql`, created with Supabase CLI.
- `private.world_room_layouts`: one JSON snapshot per existing room UUID, integer revision.
- `get_world_room_furniture_v1(p_room)`: D2 OWNER/VISITOR access, no stranger/unknown UUID disclosure.
- `save_my_room_furniture_v1(p_room,p_revision,p_objects)`: owner derived from `auth.uid()`, full
  validation and replacement under a row lock. Identical retries return the existing revision.
- Placements: `{id,itemId,surface,x,z,yaw}`; UUID instances, max 32 / 16 KiB; height is derived.
- Server checks Collection ownership/quantity, allowed surfaces, quarter-unit grid, 45° rotation,
  bounds, reserved entrance/spawn corridor, fixed facilities and same-surface overlaps. Rugs may
  sit under owned solid objects. Client/server dimensions are covered by the catalog mirror test.
- No direct anon/authenticated table access; RPC EXECUTE is authenticated only. SECURITY DEFINER
  functions use an empty search path and qualified relations. Guest and banned accounts fail closed.
- Saved visitor layouts refresh through the access-checked read RPC every 15 seconds. Unsaved owner
  previews never leave the editor. A layout update also rebuilds geometry/collision and the room map;
  a player caught by newly saved floor furniture returns to the reserved clear spawn.

## Validation and release boundary

Node contracts cover geometry, ownership, editor controls, dirty-close handling, save retry/conflict,
in-flight operations, visitor read-only behavior and late replies across room/account changes.
Disposable pgTAP covers real RPCs, RLS/grants, all nine placements, atomicity, retries, conflicting
revisions, invalid snapshots, friend/stranger/guest/private access and unchanged inventory quantities.
The existing Housing Database CI includes the new test. Shared migration history remains append-only.
The existing offline housing browser smoke also exercises native editor controls and all nine real
PlayCanvas primitive models with an isolated in-memory authority, including lost-response retry,
reload, recall, visitor refusal and entity/material cleanup on desktop/portrait/landscape. This is
module integration evidence; it does not verify real Auth tokens or real two-account WebSockets.

Actual two-account browser/WebSocket integration QA is deferred until after furniture implementation
at the user's request. Production migration and merge/deployment are separate release steps; no
production data is used by these tests. Old generic-catalog private #211 is not a dependency.
