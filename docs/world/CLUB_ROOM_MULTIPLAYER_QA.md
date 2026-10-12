# Shared club room candidate: client validation

Base: `af532a53c433479e12354f88a5a1c234075de5e7` (main verified on 2026-10-12).

This is a draft implementation candidate. Remote PR/CI validation is authorized; production
migration application, activation, release and deployment are not. The original local checks below
are historical; exact-head remote evidence is described in [Room social remote QA](ROOM_SOCIAL_REMOTE_QA.md). The client requires the accompanying server
contract; deploying the client alone makes shared-room admission fail closed and return to campus.
The existing personal-room owner/visitor UUID contract is unchanged.

## Implemented

- One shared `ROOM_CLUBHOUSE_01`, six admitted accounts and six existing authored chairs.
- Separate club admission/heartbeat/leave/seat RPCs and server-only per-session Realtime inbox.
- Existing network interpolation and real remote-avatar renderer; server-confirmed seat ownership.
- Room-local sit/stand, locomotion release, emotes, shared occupancy HUD, profile inspection.
- Async seat claims recheck room/session, movement, overlays and input ownership before moving.
- Failed admission, revocation, account switching, lease loss, pagehide and reconnect cleanup.
- Shared room-chat getter integration; the private-room chat change owns the chat UI and routing.
- No club creation/join feature, shared furniture editing, currency or reward changes.

## Executed checks

- `node --test apps/world/tests/*.test.mjs`: 4,256 passed against the final client candidate.
- `node --test apps/world/tests/club-room-session.test.mjs`: 12 passed after the final client changes.
- `node apps/world/qa.mjs`: passed.
- `node --check` for main and both new browser scripts: passed.
- `git diff --check`: passed.
- Migration naming/append-only and schema-contract lints: passed; see server report for SQL gates.

The client tests use the production `ClubRoomSession`, `ClubRoomTransport`, `NetworkManager`,
`RemotePlayerView`, and `SeatInteraction` with a deterministic server double. They establish:

1. Mutual avatar creation/cleanup and emote delivery between two client sessions.
2. No campus/private-room topic or RPC substitution; no direct client broadcast/presence tracking.
3. Server refusal/full capacity and one seat winner from simultaneous client intents in the double.
4. Permission loss, account switch, session replacement/expiry and reconnect teardown/revalidation.
5. Reordered heartbeat snapshots cannot erase a later seat claim.
6. An approved seat cannot move the player after an exit, input/overlay change, movement or emote.
7. A room-chat getter installed before admission reaches the rendered sample and clears correctly.

These doubles do **not** prove PostgreSQL transaction races, PostgREST wire behavior, Supabase
Realtime policies, or live account authorization. Independent in-memory SQL checks are a separate
layer and must not be relabeled as a deployed Supabase test.

Independent review also executed the actual migration in PGlite with synthetic auth/Realtime
objects. It verified capacity, canonical seat poses, recipient revocation, dual-topic RLS guards,
blocked direct `realtime.send`, and admission cooldown. Crucially, production `encodeAction`
packets for jump and all five emotes round-tripped through SQL and production `validateAction`
with numeric IDs preserved; four invalid ID forms were rejected. This was an in-memory targeted
smoke, not the full Supabase migration lineage, pgTAP suite or real multi-connection concurrency.

## Browser attempt: blocked, not passed

Prepared a two-page desktop/mobile fixture using the actual club scene, avatars, controller,
session and transport against an injected synthetic server:

```sh
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_EXECUTABLE=/usr/bin/chromium \
  node apps/world/tests/browser/club-room-multiplayer-smoke.mjs
```

Chromium failed before page creation with `process_singleton_posix.cc:297`,
`socket() failed: Operation not permitted (1)`, including the approved expanded-execution attempt.
No screenshot or browser success is claimed. Both script files passed syntax checks only.

Before activation, run this fixture in a supported browser environment, then perform the server
document's real two-account Realtime and two-connection PostgreSQL gates. Cover desktop and mobile,
six seats, late joins, repeat entry/exit, Photo/Phone ownership, chat isolation, account switching,
same-account replacement, reconnect, full capacity and revocation with an old channel left open.

## Integration

`main.js` changes are limited to club session/seat construction, room-local routing, equipment,
room/account/page lifecycle, and per-frame updates. Existing PersonalRoomSession, Photo, Phone,
owner furniture and visitor access remain owned by their existing modules. Updated source-wiring
tests add the club branch without removing the personal-room behavior assertions.

The integrated private-room chat candidate must install `clubRoomSession.setChatBubbles(getBubble)`
and route chat only to a READY club session's `{kind:'club',roomId,sessionId}`. Stop/room/identity
changes clear that chat source; no club message is sent through the campus chat transport.
