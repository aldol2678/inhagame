# Shared club room: server candidate

## Status and authorization boundary

This is the unactivated implementation in draft PR #353. Publication and isolated remote validation are authorized. Production application must follow the coordinated [activation runbook](ROOM_SOCIAL_ACTIVATION_RUNBOOK.md); this document does not perform it. The client fails closed when authority, cleanup health or required RPCs/policies are unavailable.

Files:

- `supabase/migrations/20261012023000_world_club_room_multiplayer.sql`
- `supabase/tests/database/99_world_club_room_multiplayer.test.sql`

Baseline head `8bde3d4` passed full disposable Supabase replay, pgTAP, actual multi-connection races, and browser acceptance with synthetic delivery. The fresh-admission/finite-retention revision needs its own exact-head remote evidence. Local PGlite and deterministic client doubles do not establish live WebSocket delivery.

## Room, identity, and authority

There is one common room, `ROOM_CLUBHOUSE_01`, with at most six admitted users. No club creation, club membership, invitations, currency, inventory, reward, or progression feature is added.

`private.world_club_room_access_v1(p_viewer uuid, p_room_id text)` returns only `MEMBER` or `DENIED`. It accepts an existing permanent `auth.users` account with a non-banned profile and no currently active `interaction_restriction_24h`. Unknown rooms, null viewers, anonymous accounts, missing profiles, bans, and restrictions fail closed. Public calls additionally require `auth.uid()` and a non-anonymous JWT. A client-provided user ID never supplies authority.

Private RLS-enabled tables have no direct client/service-role grants:

- `world_club_rooms`: fixed room, capacity 6, monotonically increasing revision and independent server `enabled` flag (default false).
- `world_club_room_sessions`: unique room/user and client pose `session_id`, server-generated `admission_id`, live lease, seat, nonce, equipment and last pose. The admission ID is not the client pose UUID.
- `world_club_room_admission_limits`: only user UUID and admission timestamp, with account-deletion cascade. No room, pose session, inbox or content is retained in this rate record.
- `world_room_cleanup_state`: one non-identifying last-success timestamp.

There is **no permanent session-ID tombstone**. Joining a still-live owned client UUID is idempotent. After leave, expiry or replacement, the same client UUID can join again but receives a fresh server-random admission UUID and inbox. Every heartbeat, leave, seat and visual publication names that admission, so a delayed old mutation cannot affect its replacement. UUID collision resistance, rather than a permanent user-linked ledger, prevents old topic reuse. Club chat leases additionally reference the exact admission with deletion cascade.

Every actual new admission/replacement is also bounded per account, across all previous session UUIDs: at least **one second between successes**, and at most **60 successes in any rolling hour**. An indexed `(user_id, created_at DESC)` rate-timestamp lookup and the same fixed-room lock make both checks atomic with insertion. A retry for the same still-live UUID returns before these checks and does not consume quota. Leave, expiry, a new browser tab, or replacement does not reset the account's admission history. Rejections return `allowed:false` with `JOIN_COOLDOWN` or `RATE_LIMITED`, add no rate record, and preserve any old live session/seat.

This intentionally affects fast fresh-UUID re-entry: a BFCache restore, reload, immediate leave/re-enter, or switch back to the same account within one second of its last successful admission can fail closed rather than enter automatically. A different account has its own quota. Clients should show the denial and permit a later deliberate retry; do not spin fresh UUIDs or automatically retry every frame. Already admitted users can continue heartbeat/same-UUID reconnect even when their new-admission hourly quota is exhausted.

All session changes advance the room revision through a trigger. Clients must discard any snapshot with a lower revision than the latest accepted snapshot, including reordered heartbeat/seat responses. Revisions are JSON integers and must be handled as nonnegative safe integers; the expected mutation volume is far below JavaScript's safe-integer ceiling.

## RPC contract

All RPCs are executable only by `authenticated`; their private helpers are not. Parameters are named exactly as below for PostgREST calls.

| RPC | Parameters | Outcome |
| --- | --- | --- |
| `join_world_club_room_v1` | `p_room text, p_session uuid` | Admit/replace, renew a same-session lease, return snapshot |
| `heartbeat_world_club_room_v1` | `p_room text, p_admission uuid` | Renew only that exact owned live session; return snapshot |
| `leave_world_club_room_v1` | `p_room text, p_admission uuid` | Remove only that exact owned session, release its seat; return `LEFT` |
| `claim_world_club_room_seat_v1` | `p_room text, p_admission uuid, p_seat text` | Atomically claim/transfer a chair; snapshot plus `claimed` |
| `release_world_club_room_seat_v1` | `p_room text, p_admission uuid, p_seat text` | Compare-and-release exact chair; snapshot plus `released` |
| `publish_world_club_room_v1` | `p_room text, p_admission uuid, p_event text, p_packet jsonb` | Validate/canonicalize a visual packet and fan out to current receivers |
| `can_access_world_club_room_realtime_v1` | `p_topic text` | Whether the caller owns that exact currently authorized live inbox |

A successful snapshot contains:

```json
{
  "allowed": true,
  "reason": "OK",
  "roomId": "ROOM_CLUBHOUSE_01",
  "sessionId": "<client pose UUID>",
  "admissionId": "<fresh server UUID>",
  "topic": "world:club:ROOM_CLUBHOUSE_01:<fresh server UUID>",
  "userId": "<auth.uid UUID>",
  "capacity": 6,
  "revision": 42,
  "leaseMs": 19999,
  "participants": [
    { "v": 1, "sessionId": "<UUID>", "userId": "<UUID>", "displayName": "닉네임", "placeZoneId": "ROOM_CLUBHOUSE_01", "joinedAt": 1791766800000 }
  ],
  "seats": [{ "seatId": "chair_s0", "sessionId": "<UUID>", "userId": "<UUID>" }],
  "poses": [{ "sessionId": "<UUID>", "packet": { "v": 1, "seq": 3, "x": -0.7, "y": 1.3, "z": -0.34, "yaw": 0, "vx": 0, "vz": 0, "anim": "sit" } }]
}
```

`joinedAt` is server epoch milliseconds. `displayName` comes from the server profile, normalized to the protocol character/length allowlist with the fallback `인덕이`. Optional equipment is visual-only and explicitly has no ownership, reward, or access authority. Private profile fields, emails, JWTs, and tokens never enter the presence.

The lease is renewed to 20 seconds by join/heartbeat; the client should heartbeat every 5 seconds. `leaseMs` in every successful snapshot is **remaining server lease time**, rounded down. Claim/release/publish do not renew it. Clients should conservatively subtract request round-trip time and fail closed on expiry, denial, failed RPC, or transport loss. `LEFT` has an empty roster, current revision, and zero remaining lease.

Denied snapshots contain empty `participants`, `seats`, and `poses`, with no foreign roster leakage. Reasons include `INVALID_ROOM`, `INVALID_SESSION`, `DENIED`, `ROOM_FULL`, `SESSION_EXPIRED`, `SESSION_REPLACED`, `JOIN_COOLDOWN`, and `RATE_LIMITED`. A denied snapshot is not an empty-but-authorized room.

A taken chair is nonfatal: `allowed:true, claimed:false, reason:SEAT_TAKEN`. Invalid chairs similarly produce `INVALID_SEAT`. A stale release returns `released:false` without freeing a newer chair.

## Seats and ordered visual state

The six seat IDs and positions mirror `apps/world/src/rooms/club-room-layout.js`:

| Seat | x | y (sitting origin) | z | yaw |
| --- | ---: | ---: | ---: | ---: |
| chair_s0 | -0.7 | 1.30 | -0.34 | 0 |
| chair_n0 | -0.7 | 1.30 | 1.14 | 180 |
| chair_s1 | 0 | 1.30 | -0.34 | 0 |
| chair_n1 | 0 | 1.30 | 1.14 | 180 |
| chair_s2 | 0.7 | 1.30 | -0.34 | 0 |
| chair_n2 | 0.7 | 1.30 | 1.14 | 180 |

Each session owns at most one chair; the unique room/seat constraint prevents two owners even if a future writer omits the lock. Claim/transfer first checks the target seat, preserving the old seat if the target is occupied. Expiry, leave, replacement, or loss of account access releases the row and chair together.

Successful claim immediately stores a canonical sitting pose. While the seat is owned, valid incoming poses are snapped to that seat with `anim:sit`, zero x/z velocity, and canonical yaw. A stale in-flight walking pose cannot undo the sitting state. A sit packet without an owned seat is rejected. Release immediately stores an idle pose at y 1.15, just outside the chair (south z -0.94; north z 1.74), so remote late joiners do not depend on another client frame to see the transition.

Client `seq` is checked against `last_client_pose_seq`. Published/snapshot `packet.seq` uses a separate, monotonically increasing `pose_revision`. Server claim/release transitions increment the latter without consuming client input sequence IDs. This avoids client/server sequence collisions and lets receivers use one ordered stream. A successful publish response is an acknowledgement, not a mirror of the client's original seq.

Heartbeat snapshots provide current roster, seats, and latest poses. They are the authoritative reconciliation mechanism for late join, missed packets, and seat changes; do not use untrusted client Realtime presence tracking as the roster. A release generated pose and the local client's precise movement exit animation may differ briefly until its next accepted pose.

## Publication, limits, and Realtime revocation

The only club subscription topic is the recipient-specific private inbox:

`world:club:ROOM_CLUBHOUSE_01:<recipient server admission UUID>`

Use the `club-packet` broadcast event. Each envelope is:

```json
{ "roomId": "ROOM_CLUBHOUSE_01", "sid": "<sender session UUID>", "event": "pose", "p": {}, "presence": {} }
```

The server binds `sid` and canonical `presence` to the caller's verified session. `p` is a sanitized protocol packet. It sends to currently live, currently `MEMBER` receivers other than the sender. Session cleanup, room membership checks, and the recipient set are recomputed on every publication. No packet is published to a shared room-wide topic.

Realtime commonly caches channel authorization; therefore a SELECT check alone does not revoke an existing subscription. After revocation/expiry/replacement, the server stops publishing to that inbox. A future join receives a fresh server-generated inbox even if the client deliberately reuses its old pose UUID; the retired inbox is never selected by new fanout. A packet authorized and already enqueued before revocation can still be in transit; this design stops subsequent publications, not bytes already transmitted.

The separately installed club policies preserve the existing campus/personal-room installer:

- Permissive SELECT allows a live owned inbox, broadcast only, with stored `realtime.messages.topic` equal to `realtime.topic()`.
- Restrictive SELECT checks **both** the stored row topic and the subscription topic. A campus topic cannot be supplied to read stored club rows through the existing campus permissive policy.
- Restrictive INSERT rejects club topics in **either** field. There is no client club INSERT policy, no direct club broadcast, and no client presence-tracking grant.
- Provider-owned `realtime.send` grants are unchanged. SECURITY INVOKER plus restrictive anonymous/authenticated INSERT guards enforce server-only publication; a normal-looking provider call may still have inserted zero rows. An unsafe-definer/RLS/client-bypass gate closes application access. Admission-only recipient capabilities additionally protect cached client channels; see `ROOM_CHAT_CANDIDATE.md`.

If the Realtime service/schema is absent in a stripped replay fixture, the installer emits a notice instead of replacing unrelated policy installers. Delivery explicitly returns `allowed:false, sent:false, reason:REALTIME_UNAVAILABLE` when the send function is absent. A real deployment must verify the function, its grants, and all club policies after Realtime is available; merely creating these SQL functions is not activation evidence.

Packet limits (in addition to the finite account-scoped admission bounds above):

- Packet object serialized size at most 4096 bytes.
- Pose at most 10 accepted updates per second per session; client cadence 120 ms is suitable. No render-frame RPC loop.
- Presence at most once per second per session; optional equipment reads only nine known slots and known status/item ID patterns. Claimed identity/name/zone/join time are ignored.
- Actions at most twice per second per session; only `jump` and `emote` are allowed. Emotes: `wave`, `clap`, `laugh`, `dance`, `photo_pose`. Action IDs are JSON numeric safe integers 0..9007199254740991, matching `encodeAction`/`validateAction`; strings are rejected and published IDs remain numeric. Extra payload fields are dropped.
- No mounts, `fly`, teleport, or chat through this RPC. Chat has a separate authorization/normalization contract.
- Pose numeric fields must be JSON numbers; x ±4.5, z ±3.25, y 0..3.2, x/z velocity ±10, yaw ±100000 before normalization, integer client seq 0..9007199254740991. These are visual sanity bounds, not reward/combat anti-cheat.

Accepted publication returns `allowed:true, sent:true, reason:OK, recipients:<count>`. Zero other occupants is still a valid publication. Invalid packets, replayed client seq, and rate limits return `allowed:true, sent:false` with `INVALID_PACKET`, `STALE_PACKET`, or `RATE_LIMITED`; these are not lost-admission signals. Access/session loss returns `allowed:false`.

## Validation gates before use

The pgTAP suite checks actual provider transport rows in a rollback-isolated fixture, not a replacement of the protected provider function. It covers canonical identity/action protocols, admission, RLS, quotas, seats and caller restrictions. Multi-connection integration tests separately observe distinct PostgreSQL backend PIDs and actual lock waits before testing capacity, seats, replacement, send-rate and lock-expiry races.

The new isolated loopback WebSocket test verifies a baseline club/chat delivery, leaves and rejoins with the same client pose UUID, then requires the new socket to receive while the still-open retired sockets receive zero raw post-rejoin payloads. Provider transport rows must likewise be absent for retired topics. It is actual disposable Supabase Realtime, not hosted production; until that exact-head test runs, this layer remains unverified.

## Finite retention and cleanup health

A one-minute `world-room-social-cleanup-v1` pg_cron job removes rate timestamps older than one hour, expired club/chat leases and five-second chat limiter rows. With a healthy scheduler, rate timestamps last at most about 61 minutes; expired leases can remain up to one additional minute; chat limiter metadata up to 65 seconds. All account-linked rows cascade on account deletion. The health row contains no identity.

If cleanup stops, already stored rows may remain until recovery. After 90 seconds without a successful scheduled cleanup, admission, renewal and publication close. Owner-bound leave can still remove an exact admission. This is an availability tradeoff, not an unconditional deletion deadline. Provider payload retention is separate and can be up to three days.

Before wider rollout, measure six-user serialized RPC/fanout latency and monitor cleanup lag and table sizes. Do not claim real delivery or race success from a sequential double. See the runbook for the exact production prerequisites and approval boundary.
