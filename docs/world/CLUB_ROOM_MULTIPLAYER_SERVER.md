# Shared club room: server candidate

## Status and authorization boundary

This is a **local-only implementation candidate**. Nothing in this document or the SQL files applies a migration, changes a connected database, enables Realtime, creates a PR, or deploys a service. A database replay, race test, migration application, or production activation needs its own explicit approval. The client must remain fail-closed when these RPCs/policies are unavailable.

Files:

- `supabase/migrations/20261012010000_world_club_room_multiplayer.sql`
- `supabase/tests/database/99_world_club_room_multiplayer.test.sql`

Static migration/append-only checks were run. PostgreSQL/Supabase executables were unavailable in the implementation environment; **SQL replay, pgTAP execution, two-connection concurrency, and real Realtime delivery were not run**. Static lint is not a substitute for those gates. An independent review also executed the candidate in an isolated, synthetic, in-memory PGlite fixture: six-user capacity/sequential seat contention, Realtime send grants, same-UUID retry/new-UUID cooldown, canonical presence/pose validation, and actual `encodeAction` → SQL publication → `validateAction` roundtrips for jump and all five emotes passed. Invalid string/negative/fractional/unsafe action IDs were rejected. This is limited fixture evidence, not a full migration-lineage replay, pgTAP run, concurrent PostgreSQL proof, or real Realtime network test.

## Room, identity, and authority

There is one common room, `ROOM_CLUBHOUSE_01`, with at most six admitted users. No club creation, club membership, invitations, currency, inventory, reward, or progression feature is added.

`private.world_club_room_access_v1(p_viewer uuid, p_room_id text)` returns only `MEMBER` or `DENIED`. It accepts an existing permanent `auth.users` account with a non-banned profile and no currently active `interaction_restriction_24h`. Unknown rooms, null viewers, anonymous accounts, missing profiles, bans, and restrictions fail closed. Public calls additionally require `auth.uid()` and a non-anonymous JWT. A client-provided user ID never supplies authority.

Three private, RLS-enabled tables have no direct client/service-role grants:

- `world_club_rooms`: the fixed room row, capacity 6, and monotonically increasing `revision`.
- `world_club_room_sessions`: unique `(room_id,user_id)`, globally unique `session_id`, unique `(room_id,seat_id)`, lease, seat, canonical equipment, and last pose.
- `world_club_room_session_ids`: immutable used-UUID ledger. Entries survive leave, expiry, replacement, and account deletion. This is a topic-nonreuse security requirement, not just deduplication. Do not TTL-delete it. It has no account-deletion FK deliberately; it stores only admission UUID/user UUID/room/time, never credentials or messages.

A new join supplies a fresh client-generated random UUID and atomically invalidates that user's previous session. Joining with the same still-live owned UUID is idempotent. An expired, left, replaced, or another user's UUID returns `SESSION_REUSED`; reconnecting after lease loss requires a fresh admission UUID. A failed capacity check does not reserve a UUID.

Every actual new admission/replacement is also bounded per account, across all previous session UUIDs: at least **one second between successes**, and at most **60 successes in any rolling hour**. An indexed `(user_id, created_at DESC)` ledger lookup and the same fixed-room lock make both checks atomic with insertion. A retry for the same still-live UUID returns before these checks and does not consume quota. Leave, expiry, a new browser tab, or replacement does not reset the account's admission history. Rejections return `allowed:false` with `JOIN_COOLDOWN` or `RATE_LIMITED`, add no ledger entry, and preserve any old live session/seat.

This intentionally affects fast fresh-UUID re-entry: a BFCache restore, reload, immediate leave/re-enter, or switch back to the same account within one second of its last successful admission can fail closed rather than enter automatically. A different account has its own quota. Clients should show the denial and permit a later deliberate retry; do not spin fresh UUIDs or automatically retry every frame. Already admitted users can continue heartbeat/same-UUID reconnect even when their new-admission hourly quota is exhausted.

All session changes advance the room revision through a trigger. Clients must discard any snapshot with a lower revision than the latest accepted snapshot, including reordered heartbeat/seat responses. Revisions are JSON integers and must be handled as nonnegative safe integers; the expected mutation volume is far below JavaScript's safe-integer ceiling.

## RPC contract

All RPCs are executable only by `authenticated`; their private helpers are not. Parameters are named exactly as below for PostgREST calls.

| RPC | Parameters | Outcome |
| --- | --- | --- |
| `join_world_club_room_v1` | `p_room text, p_session uuid` | Admit/replace, renew a same-session lease, return snapshot |
| `heartbeat_world_club_room_v1` | same | Renew only that exact owned live session; return snapshot |
| `leave_world_club_room_v1` | same | Remove only that exact owned session, release its seat; return `LEFT` |
| `claim_world_club_room_seat_v1` | same plus `p_seat text` | Atomically claim/transfer a chair; snapshot plus `claimed` |
| `release_world_club_room_seat_v1` | same plus `p_seat text` | Compare-and-release exact chair; snapshot plus `released` |
| `publish_world_club_room_v1` | same plus `p_event text, p_packet jsonb` | Validate/canonicalize a visual packet and fan out to current receivers |
| `can_access_world_club_room_realtime_v1` | `p_topic text` | Whether the caller owns that exact currently authorized live inbox |

A successful snapshot contains:

```json
{
  "allowed": true,
  "reason": "OK",
  "roomId": "ROOM_CLUBHOUSE_01",
  "sessionId": "<owned UUID>",
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

Denied snapshots contain empty `participants`, `seats`, and `poses`, with no foreign roster leakage. Reasons include `INVALID_ROOM`, `INVALID_SESSION`, `DENIED`, `ROOM_FULL`, `SESSION_REUSED`, `SESSION_EXPIRED`, `SESSION_REPLACED`, `JOIN_COOLDOWN`, and `RATE_LIMITED`. A denied snapshot is not an empty-but-authorized room.

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

`world:club:ROOM_CLUBHOUSE_01:<recipient session UUID>`

Use the `club-packet` broadcast event. Each envelope is:

```json
{ "roomId": "ROOM_CLUBHOUSE_01", "sid": "<sender session UUID>", "event": "pose", "p": {}, "presence": {} }
```

The server binds `sid` and canonical `presence` to the caller's verified session. `p` is a sanitized protocol packet. It sends to currently live, currently `MEMBER` receivers other than the sender. Session cleanup, room membership checks, and the recipient set are recomputed on every publication. No packet is published to a shared room-wide topic.

Realtime commonly caches channel authorization; therefore a SELECT check alone does not revoke an existing subscription. After revocation/expiry/replacement, the server stops publishing to that inbox. The used-UUID ledger prevents a future join from accidentally reactivating an old authorized channel. A packet authorized and already enqueued before revocation can still be in transit; this design stops subsequent publications, not bytes already transmitted.

The separately installed club policies preserve the existing campus/personal-room installer:

- Permissive SELECT allows a live owned inbox, broadcast only, with stored `realtime.messages.topic` equal to `realtime.topic()`.
- Restrictive SELECT checks **both** the stored row topic and the subscription topic. A campus topic cannot be supplied to read stored club rows through the existing campus permissive policy.
- Restrictive INSERT rejects club topics in **either** field. There is no client club INSERT policy, no direct club broadcast, and no client presence-tracking grant.
- Client execution (`public`, `anon`, `authenticated`) of `realtime.send(jsonb,text,text,boolean)` is revoked when that function is present. Trusted definer RPCs call it as their owner.

If the Realtime service/schema is absent in a stripped replay fixture, the installer emits a notice instead of replacing unrelated policy installers. Delivery explicitly returns `allowed:false, sent:false, reason:REALTIME_UNAVAILABLE` when the send function is absent. A real deployment must verify the function, its grants, and all club policies after Realtime is available; merely creating these SQL functions is not activation evidence.

Packet limits (in addition to the durable account-scoped admission bounds above):

- Packet object serialized size at most 4096 bytes.
- Pose at most 10 accepted updates per second per session; client cadence 120 ms is suitable. No render-frame RPC loop.
- Presence at most once per second per session; optional equipment reads only nine known slots and known status/item ID patterns. Claimed identity/name/zone/join time are ignored.
- Actions at most twice per second per session; only `jump` and `emote` are allowed. Emotes: `wave`, `clap`, `laugh`, `dance`, `photo_pose`. Action IDs are JSON numeric safe integers 0..9007199254740991, matching `encodeAction`/`validateAction`; strings are rejected and published IDs remain numeric. Extra payload fields are dropped.
- No mounts, `fly`, teleport, or chat through this RPC. Chat has a separate authorization/normalization contract.
- Pose numeric fields must be JSON numbers; x ±4.5, z ±3.25, y 0..3.2, x/z velocity ±10, yaw ±100000 before normalization, integer client seq 0..9007199254740991. These are visual sanity bounds, not reward/combat anti-cheat.

Accepted publication returns `allowed:true, sent:true, reason:OK, recipients:<count>`. Zero other occupants is still a valid publication. Invalid packets, replayed client seq, and rate limits return `allowed:true, sent:false` with `INVALID_PACKET`, `STALE_PACKET`, or `RATE_LIMITED`; these are not lost-admission signals. Access/session loss returns `allowed:false`.

## Validation gates before use

The candidate pgTAP suite uses synthetic accounts and a transaction-local `realtime.send` spy. It records exact private recipient topics/envelopes without contacting live channels, and rolls back all fixture changes. It covers access, direct grants, pinned search paths, capacity, replacement/idempotence, account admission cooldown/hourly quota, UUID nonreuse, seat contention/transfer/stale release, canonical sit/stand, pose validation, equipment sanitization, impersonation, rate limits, server/client sequence separation, recipient revocation, remaining TTL, room revision, policy shape, and missing Realtime delivery.

After explicit approval for an isolated disposable local stack:

1. Replay the migration lineage, run `supabase test db`, and run existing schema-validity/plpgsql-check tests. The send-spy tests require the normal Realtime schema/policies for policy assertions; an intentionally stripped fixture is not a complete integration environment.
2. Run **real two-connection races** (not sequential pgTAP assertions):
   - Admit five fixture users. In connection A begin and hold the fixed room row `FOR UPDATE`. Start joins for users 6 and 7 in separate connections B/C, confirm both wait, release A, and assert exactly one succeeds, the other receives `ROOM_FULL`, and exactly six live unique users remain.
   - With two admitted users, hold the same room row; start both claiming `chair_s0`; release the barrier; assert one `claimed:true`, one `claimed:false/SEAT_TAKEN`, and one matching stored owner. Repeat with reversed scheduling.
   - Race two new UUIDs from the same user; verify one active row, only the last committed UUID can heartbeat, and neither replaced inbox ever receives future publications.
   - Race an old session's leave/release against new admission; verify the new UUID and any new seat survive stale calls.
3. Use two authenticated browser clients and real private Realtime: mutual visibility, canonical nickname/equipment, movement, emote, all six seats, late join while seated, leave/reconnect, capacity, and recoverable packet rate limiting.
4. Keep a recipient's existing channel open, then ban/restrict/expire/replace it server-side in the disposable fixture. Publish after the change and prove no new payload reaches the old channel; prove old UUID reuse fails. Include malicious INSERT/direct-send attempts and cross-topic stored-message SELECT/INSERT attempts.
5. Verify existing campus and personal-room channels retain their intended access and both clients return cleanly to campus without club ghosts.
6. Load-test six users at the configured pose cadence, measure serialized row-lock/RPC latency and Realtime fanout, and verify that changing UUIDs cannot bypass account admission limits. The ledger still grows durably, now capped per account at 60 rows per rolling hour (up to 1,440 per day; approximately 525,600 per year under continuous maximal churn, plus index overhead). This is a growth-rate bound, not a storage-retention solution. Before wider rollout, establish storage budget/monitoring and a reviewed retention/topic-generation design that preserves nonreuse for cached inbox authorization. Do not delete old tombstones merely because their admission quota window expired.

Do not report concurrency, revocation delivery, or production readiness as passed until these gates have actually been run and their results recorded.
