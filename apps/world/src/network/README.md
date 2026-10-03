# INHA WORLD · Online P0 Network Foundation

> Online P0 integration: `SupabaseRealtimeTransport` is live behind this core and wired through
> `src/online/` (see `docs/world/ONLINE_P0_INTEGRATION.md`). The core itself still never imports
> Supabase, PlayCanvas, render chunks or PlayerController.
> There is no live multiplayer, no Supabase Realtime channel and no schema change.
> Design authority: Notion *INHA WORLD · Online Architecture v0.1 [CURRENT DESIGN]*.

## Architecture

```
World (after the Place Zone PR)                     Network core (this folder)                     Transport (swappable)
────────────────────────────────                    ─────────────────────────────────              ─────────────────────
PlayerController ── plain pose sample ─────────▶  NetworkManager.update(sample)                  NetworkTransport
PlaceZoneChanged ── placeZoneId ───────────────▶  NetworkManager.setPlaceZone(id)  ───────────▶  ├ FakeNetworkTransport (tests)
jump / teleport  ───────────────────────────────▶  reportJump / reportTeleport                   └ SupabaseRealtimeTransport (next PR)
RemotePlayer renderer ◀── sampleRemotes() ──────  RemotePlayerManager + SnapshotInterpolator
HUD "● ONLINE · N명" ◀── state / onlineCount ────  ConnectionStateMachine
```

| Module | Role |
| --- | --- |
| `protocol.js` | Packet shapes, encoders, validators, `classifyAnim`, suggested topic name |
| `privacy.js` | Deep scan for private keys / email / JWT values |
| `transport.js` | `NetworkTransport` contract and conformance check |
| `connection-state.js` | `OFFLINE → CONNECTING → ONLINE ⇄ RECONNECTING → OFFLINE`, retry backoff |
| `pose-publisher.js` | When to send a pose (rate, distance, yaw, anim, forced) |
| `interpolation.js` | Per-remote snapshot buffer, yaw wrap, snap, bounded extrapolation |
| `remote-player-manager.js` | Pure remote-player model: presence, poses, actions, dedupe |
| `network-manager.js` | Orchestrator; the only object the World will talk to |
| `fake-transport.js` | Deterministic hub + transport on a fake scheduler (tests only) |

The core imports nothing from `zone-registry.js`, `zone-streaming-manager.js`, render chunks,
PlayCanvas or Supabase.

## Transport boundary

The core talks only to this shape (full comments in `transport.js`):

```
connect({ sessionId, credentials })   disconnect()
joinPlaceZone(placeZoneId, presence)   leavePlaceZone(placeZoneId)
publishPresence(placeZoneId, presence) publishPose(placeZoneId, packet) publishAction(placeZoneId, packet)
subscribePresence(h) subscribePose(h) subscribeAction(h) subscribeStatus(h)   → each returns unsubscribe
```

- Methods may be sync or async. The core never awaits; throws and rejections are caught into
  `NetworkManager.errors`.
- Outcomes come back as events: status `connected | disconnected | error`, presence
  `sync | join | leave` (sync = full zone membership, may include self), pose/action
  `{ placeZoneId, sessionId, packet }` with the sender identified by the transport.
- `credentials` is opaque to the core and is only for authenticating the transport. It must never
  be copied into a payload.

## Packets (protocol v1)

**Presence** (allowlist; everything else is dropped):
`{ v, sessionId, userId, displayName, placeZoneId, joinedAt }`, plus optional `guest: true`.
A guest's `displayName` is always derived from its `sessionId` (`게스트 XXXX`), never taken from
the packet. Guests may only send `jump` and `teleport` (`GUEST_ACTION_TYPES`); `NetworkManager`
refuses the rest for a guest identity and `RemotePlayerManager` drops them from guest presences.
`displayName` must pass the campus nickname rule (`[가-힣A-Za-z0-9_ ]{2,12}`), otherwise it becomes
`인덕이`. That means an email can never be shown as a name.

Optional **`equipment`** (Multiplayer Equipment Projection P0, still protocol v1): a sparse object
`{ HEAD: { itemId, catalogStatus }, BACK: {...} }` over the nine appearance slots
(`EQUIPMENT_WIRE_SLOTS`, no BADGE); an empty loadout sends no field. `sanitizeEquipment()` reads only
those nine keys, keeps exactly `itemId` + `catalogStatus` (`EQUIPMENT_WIRE_STATUSES`) and drops a bad
entry on its own: malformed equipment never rejects a presence. Guests never send it and receivers
drop it from guest presences. Old clients rebuild presence from the allowlist and simply ignore it.
It is **visual-only, client-declared state**: never a reward, achievement, quest, ranking, trade,
purchase, access-control, stat or ownership input. `NetworkManager.setEquipment()` stores it and
republishes Presence (`publishPresence`) only when its canonical value changes while a zone is
joined; joins, zone changes and reconnects carry the latest value. Details:
`docs/world/MULTIPLAYER_EQUIPMENT_PROJECTION_P0.md`.

**Pose** (Notion §6 minimum): `{ v, seq, x, y, z, yaw, vx, vz, anim }`.
- Positions in metres in the canonical campus frame (`player.getLocalPosition()` under
  `CampusCoordinateFrame`, not the reflected world transform). They are rounded to 1 cm, `yaw` is
  in degrees in (-180, 180] rounded to 0.1°, and velocities are in m/s.
- `anim` ∈ `idle | walk | run | air | fly`.
- `seq` is a non-negative integer that increases for each session.
- The receiver rejects malformed or missing fields, `v ≠ 1`, NaN/±Infinity, |coord| > 1e5,
  a stale `seq` (lower than the last) and a duplicate `seq`.

**Action** (sent at once, independent of pose): `{ v, id, type, payload }`.
- `jump` has payload `{}`.
- `teleport` has payload `{ x, y, z, yaw, poseSeq }`. The receiver snaps immediately and treats
  every pose below `poseSeq` as stale.
- `emote` has payload `{ emote: [a-z0-9_]{1,24} }`. This is a contract placeholder only; there is
  no UI.

A typical pose envelope `{ sid, p }` is about 105 bytes of JSON.

### Non-authoritative coordinates

Pose data is **visual state only**. Never use it as evidence for rewards, discoveries, ranking,
currency or competitive outcomes. Valuable results need a separate server-verified contract.
There is deliberately no cheat validation here.

## Connection state machine

```
OFFLINE ──start──▶ CONNECTING ──connected──▶ ONLINE
                        │ error/timeout          │ lost
                        ▼                        ▼
                    RECONNECTING ◀──retry failed──┘
                        │ connected ──▶ ONLINE
                        │ backoff exhausted (500, 1000, 2000, 4000, 8000 ms) ──▶ OFFLINE
any live state ──stop──▶ OFFLINE
```

- A connect with no status within `connectTimeoutMs` (5 s) counts as a failure.
- **RECONNECTING:** remotes are frozen (`presence: "suspect"`), not deleted.
- **ONLINE again:** the zone presence `sync` reconciles membership, so there are no duplicates.
- **OFFLINE:** remotes are cleared and the world keeps running (Offline Mode). Calling `start()`
  again retries.

### Offline fallback

`NetworkManager` never holds `PlayerController` or any entity. It only reads plain samples passed
to `update()`. `update()` never throws. A transport that throws on every call, or a network that is
down for 40 s, leaves local movement untouched (see `online-connection-state` and
`online-two-client-spike` tests).

## Place Zone integration point

The network consumes only an abstract semantic **Place Zone ID** (e.g. `AREA_MAIN_HALL`). The
spatial layer is the authority. Legacy `C01/C02/C03` zone IDs and render chunks are not network
concepts.

```js
// Wired in src/online/place-zone-bridge.js (400 ms debounce after the first zone):
placeZones.on("placeZoneChanged", (prev, next) => network.handlePlaceZoneChanged(prev, next));
```

`setPlaceZone(next)` immediately drops remotes from the old zone. When ONLINE, it also calls
`leavePlaceZone(old)`, then `joinPlaceZone(next, presence)`, and forces a pose snapshot. While not
online it only records the target and joins on (re)connect. Each place zone is its own channel;
the campus is never one channel (Notion §5). `placeZoneTopic(id)` is
`world:campus:<AREA_ID>`, identical to `PlaceZoneRegistry`'s `futureRealtimeChannelKey`; anything that
is not an `AREA_*` ID (render chunks such as `RC_0_0`) is rejected.

## Remote players

`RemotePlayerManager` keys players by `sessionId`, with these rules:

- **Local player is never remote:** own `sessionId` and own `userId` (other tabs, reload ghosts)
  are ignored.
- **One avatar per user:** the newest `joinedAt` wins, and an older session is removed with reason
  `superseded`.
- **Pose before presence:** a pose that arrives before its presence join is held for up to 2 s and
  applied on join.
- **Jump without waiting:** a `jump` shows `anim: "air"` for 600 ms without waiting for a pose.
- **Rendering:** `sample(now)` returns render-ready `{ sessionId, displayName, placeZoneId,
  presence, pose, anim }` for the future PlayCanvas adapter (avatar, nameplate, profile proxy).

## Interpolation

- **Buffer:** snapshots are buffered by local receive time and rendered at `now − 200 ms`
  (Notion 150–250 ms), independent of render FPS.
- **Yaw:** interpolated along the shortest arc (170° → −170° passes 180°).
- **Large jumps:** a jump > 10 m between snapshots snaps. An explicit `teleport` action always
  snaps.
- **Packet gaps:** past the newest snapshot it dead-reckons for at most 250 ms, then holds. It
  never extrapolates forever.
- **Ordering:** stale and duplicate packets never enter the buffer, because the sequence check
  runs first.

## Publishing (3–4 Hz)

`POSE_PUBLISH_DEFAULTS = { minIntervalMs: 250, minDistanceM: 0.15, minYawDeg: 8 }`.

- A pose is sent when anim changes, or the player moved > 0.15 m, or turned > 8°, and at least
  250 ms have passed.
- Forced snapshots (join, new peer, reconnect, teleport) skip both checks.
- An idle player sends nothing.
- Measured at 60 fps, a moving player sends **3.82 Hz**. See `online-load.test.mjs` for the
  4- and 10-player regression numbers plus the deterministic 25 / 50 / 100-player single-zone
  capacity probe. The larger probe measures protocol fan-out on the fake transport; it does not
  claim hosted Supabase quota or browser-rendering validation.

## `SupabaseRealtimeTransport` (implemented)

`supabase-realtime-transport.js`, with an injected supabase-js client:

1. `connect` requires a permanent (non-anonymous) session, or any signed-in session when built
   with `{ allowGuest: true }`, calls `realtime.setAuth(token)` and emits `connected`; otherwise
   `error`. The browser `offline` event emits `disconnected`.
2. `joinPlaceZone(id, presence)` opens
   `channel(placeZoneTopic(id), { config: { private: true, presence: { key: sessionId }, broadcast: { self: false, ack: false } } })`,
   subscribes, then `track(presence)` on `SUBSCRIBED`. `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`
   emit `disconnected`. A re-join of the same zone replaces the channel (one live subscription).
3. Presence `sync` sends `presenceState()` flattened (without `presence_ref`), `join`/`leave` send
   `newPresences`/`leftPresences`. Realtime delivers them in order per channel. A re-track
   (`publishPresence`) arrives as join(new) then leave(old) for the same key; the adapter drops a
   leave whose key is still present, so an update is never reported as a leave.
4. Pose and action are Broadcast events `pose` / `action` with payload `{ sid, p }`.
5. `leavePlaceZone` does `untrack()` + `removeChannel()`; `disconnect` removes all channels.
6. Authorization: RLS policies on `realtime.messages`
   (in the public baseline `supabase/migrations/20261001213132_public_baseline.sql`; originally
   private migrations `20260926020000_inhagame_world_online_realtime_p0` and
   `20260927140000_world_online_guest_realtime`, which opened them to anonymous guests).

Two core rules exist because of this adapter: the first presence `sync` of a joined zone forces a
pose snapshot (a pose sent while the channel was still subscribing is dropped), and the retry
budget resets only after that sync (a connect that succeeds while every join fails still reaches
OFFLINE instead of looping).
