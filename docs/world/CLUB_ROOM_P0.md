# INHA WORLD · Club Room P0 · Main Hall Interior

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

First playable interior: 본관 입구 → 🚪 동아리방 들어가기 → `ROOM_CLUBHOUSE_01` → 🚪 본관으로 나가기 →
back outside the main hall. A precursor to Social S1-D (Room); it is not S1-D.

## Spaces

- Campus Place Zones stay `AREA_*`. A room is its own space id (`ROOM_*`), never a Place Zone.
- `src/rooms/room-registry.js`: `ROOMS` (one entry today), `ROOM_ENTRANCES` and `RETURN_ANCHORS`.
  - `CLUB_ROOM_ENTRANCE`: the top entry step in front of the rendered hall doors (`hall_entry_glass`), radius 1.8 units, facing the doors.
  - `MAIN_HALL_ROOM_EXIT_RETURN`: flat apron 3.2 units out, facing away from the doors. It is walkable, outside every collider, in `AREA_MAIN_HALL`, and outside the entrance radius.
- `src/rooms/club-room-layout.js`: the room's own frame, centred at (0, 0, 0) with the floor at y = 0. The room is about 18 m × 13 m with a 3.2 m ceiling. The file defines the spawn, the exit door, the furniture, the colliders (walls, ceiling, table, sofa, side table, bookshelf, cabinet, plant) and the bounds. Chairs, the rug, the noticeboard and the Induck plush are non-colliding decoration.

## Scene switch (same PlayCanvas app, no reload)

- `club-room-renderer.js` builds the room once, as a sibling of the campus root with the same canonical frame. It has 3 unshadowed lights plus emissive panels.
- `room-transition.js` (engine-free) owns the state: `enter`, `exit`, `contextAction`, `currentSpace`, `insideRoom`, a return context, and an 800 ms door cooldown.
- `room-world-adapter.js` does the world work:
  - **Enter:**
    - End Follow, stand up, stop the emote, close panels, pause campus online.
    - Disable the campus root and the sun, enable the room root, and reparent the player to it.
    - Switch to room lighting, room collision and bounds (no mount), and the indoor camera.
    - Spawn with a clean movement state.
  - **Exit:** the reverse at the return anchor, then resolve the Place Zone, resume campus online and update streaming.
- A 150 ms fade covers the switch; it is instant with `prefers-reduced-motion`.
- While inside, `main.js` does not update Place Zones, streaming or the tour. It publishes no seat or NPC context actions, and the tour compass is hidden.

## Movement, camera

- `PlayerController.setMovementSpace()` swaps obstacles, ground height, bounds and mount permission. The campus is the default; collision itself is unchanged.
- `OrbitCameraController.setIndoor()` is a temporary indoor preset (2.2 / 1.1–3.2). The room's walls and ceiling become camera obstacles. The outdoor distance and pitch are restored on exit. First person works indoors.

## Online (local-only room)

- `startWorldOnline().pauseCampus()` commits the Place Zone channel to none immediately. Other players see us leave (no ghost), remotes and avatars are cleared, the chat feed is cleared, and no pose leaves while inside. The session stays signed in.
- `resumeCampus()` rejoins the Place Zone the player now stands in.
- The HUD shows `동아리방 · LOCAL`, and chat says the room is not connected yet.
- There is no room channel, no room Presence and no protocol change.

**Future seam:** Club Room P1 / S1-D Room Session attaches a dedicated room channel to the room id (not `world:campus:*`).

## Context Action (private #140)

`🚪 동아리방 들어가기` / `🚪 본관으로 나가기` use the shared slot at priority 150: NPC 300 > seat 260–280 > Follow stop 200 > room door 150 > mount 100–120. There is no shortcut and no new button. The action is hidden while mounted, airborne, far from the door, in the cooldown, or while panels suspend the slot.

## Guest / signed in

Guests enter the same local room. Signed-in users pause their campus presence while inside and keep their account and friend data.

## Not in P0

Room multiplayer, furniture interaction or editing, persistence, DB tables, membership or permissions, room telemetry (`room_enter`/`room_exit` go with the Social telemetry patch), and full camera wall avoidance near the door (the camera may sit close to the avatar there; P1 polish).
