# INHA WORLD · Online P0 Integration

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Live shared presence on semantic Place Zones. Built on the Online P0 Network Foundation
(`apps/world/src/network/`, private #89) and the Place Zone / Render Chunk split (private #87).
Design authority: Notion *INHA WORLD · Online Architecture v0.1*.

## Layers

```
PlayerController ─(read only)─▶ pose-source ─┐
PlaceZoneRegistry.onPlaceZoneChanged ─▶ place-zone-bridge (debounce) ─┤
                                                     ▼
                                   NetworkManager (protocol, publisher, remote model)
                                                     ▼
                                   NetworkTransport ◀── SupabaseRealtimeTransport
RemotePlayerView ◀─ sampleRemotes() ─┘        remote-avatar (PlayCanvas + nameplate)
online-hud  "● ONLINE · N명"
```

| File | Role |
| --- | --- |
| `src/online/world-online.js` | Bootstrap: auth, session lifecycle, frame hook, guest/offline fallback |
| `src/online/place-zone-bridge.js` | AREA_* place changes → network; 400 ms debounce after the first zone |
| `src/online/pose-source.js` | Samples the local player (position, quaternion yaw, velocity, anim, jump) |
| `src/online/remote-player-view.js` | One avatar per remote session; spawn / update / remove |
| `src/online/remote-avatar.js` | PlayCanvas avatar (existing character model) + DOM nameplate |
| `src/online/online-hud.js` | HUD text |
| `src/network/supabase-realtime-transport.js` | Supabase Realtime adapter |

`main.js` adds one guarded call; `player-controller.js`, the place registry and the render chunk
modules are unchanged. Online code never imports render chunks, streaming or view distance.

## Channel convention

`world:campus:<AREA_ID>` (e.g. `world:campus:AREA_MAIN_HALL`), identical to
`PlaceZoneRegistry.futureRealtimeChannelKey`. One private channel per Place Zone; never a
campus-wide channel, never `RC_*`. View distance and chunk residency do not change membership.

## Authorization

Private channels (`config.private = true`) checked by RLS on `realtime.messages`
(`supabase/migrations/20261001213132_public_baseline.sql` (private `20260926020000_inhagame_world_online_realtime_p0`), widened to guests by
`20261001213132_public_baseline.sql` (private `20260927140000_world_online_guest_realtime`)):

- role `authenticated` with a signed-in `auth.uid()`: permanent members **and anonymous guests**
  (the `anon` role, i.e. signed-out, stays closed),
- `extension in ('broadcast', 'presence')`,
- topic matches `^world:campus:AREA_[A-Z0-9_]{1,60}$`.

The browser uses the existing publishable key and the user's own session; no service key.
The migration installs policies through `private.install_world_online_realtime_policies()` when
`realtime.messages` exists; `supabase/tests/database/60_world_online_realtime.test.sql` exercises
the same policies on a stand-in table in database CI (which runs without the Realtime service).

## Guests

A visitor without a permanent INHAGAME account joins the **same** Place Zone channels as a guest:

- `world-online.js` signs in anonymously on a separate supabase-js client
  (`auth.storageKey = "inhagame-world-guest-auth-v1"`), so the shared member session used by the
  hub is never replaced. The anonymous session is reused across reloads. A member sign-in (any
  tab) replaces the guest session; a member sign-out falls back to a guest session.
- Guests **only move and jump**: poses (including `sit`), `jump` and `teleport`
  (`GUEST_ACTION_TYPES`). No chat, no emote, no profile, no friend/follow/accompany, no member
  activity. `online.userId`, `online.supabase` and `online.identity` stay `null` for a guest,
  so every social surface keeps treating the visitor as signed out.
- Presence carries `guest: true`. Receivers ignore the sent `displayName` for guests and derive
  `게스트 XXXX` from the session id, so a guest cannot choose a member nickname. Remote guests
  are rendered and appear on the mini-map but are not inspectable and not listed in Nearby.
- Enforcement is **client-side**: Realtime Authorization is per channel, not per payload.
  Honest clients never send chat/emote as a guest, and receivers drop chat/emote from guest
  presences. A modified client can still omit `guest: true` or claim another `userId` — the same
  trust level presence already had for members, now reachable without an account. Server-signed
  presence is the follow-up if that matters.
- Operations: Anonymous sign-ins must be enabled in the Supabase project (otherwise guests stay
  OFFLINE as before). Keep the anonymous sign-in rate limit / CAPTCHA on, and clean up stale
  anonymous users periodically. `startWorldOnline({ allowGuests: false })` restores members-only.

## Presence and wire contract

Presence: `{ v, sessionId, userId, displayName, placeZoneId, joinedAt }`, plus `guest: true` for
guest sessions only. `displayName` is the
INHAGAME `profiles.nickname` (nickname rule enforced, fallback `인덕이`). `sessionId` is a fresh
UUID per page load; a reload is a new session and the newer join replaces the older one for the
same user, so reloads leave no duplicate. Pose/action Broadcast payload: `{ sid, p }` with the
protocol v1 packets. No email, token, JWT, student ID or profile field is sent.
Members may add an optional, visual-only `equipment` field (sparse slot → `{ itemId, catalogStatus }`,
never for guests, never game authority); see `docs/world/MULTIPLAYER_EQUIPMENT_PROJECTION_P0.md`.

## HUD

`● ONLINE · N명` once the zone channel has synced (`● GUEST · N명` for a guest session, with a
login hint as tooltip), `◌ CONNECTING`, `◌ RECONNECTING`, `OFFLINE`. **N includes the local player** (N = 1 means you
are alone in this Place Zone).

## Fallback and lifecycle

- Anonymous sign-in unavailable, missing supabase-js or failed auth: no network session, World
  fully playable.
- Realtime failure: RECONNECTING with local play continuing; remotes frozen, then reconciled on
  recovery; after the retry budget (0.5/1/2/4/8 s) OFFLINE and remotes removed.
- Tab close / navigation: `pagehide` stops the session best-effort; correctness relies on
  Presence dropping the closed socket.
- Sign-out stops the member session and starts a guest one; sign-in replaces the guest session.

## Known P0 limits

- Coordinates, `userId`, `displayName` and `sid` in packets are client-declared and not verified
  per sender by Realtime; they are visual only (non-authoritative) and never used for rewards,
  ranking or achievements. A malicious member could spoof another member's visuals in a zone.
- No player-player collision, no AOI, no persistence of world sessions.
- Realtime message quotas of the shared project bound concurrency; measured load is in the PR.
