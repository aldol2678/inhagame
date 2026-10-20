# INHA WORLD · Social S1-C1 · Player Inspect + Friends

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Product: Notion *Social S1 v0.2* (플레이어 카드 / 친구 / 차단 / 신고). Follow/같이 가기 is S1-C2.
Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260926030000_inhagame_world_social_s1c1`).

## Public profile contract

`get_world_public_profile(p_target uuid)` is the only way the World reads another player's
profile. `profiles` itself stays self-read only (`profiles_self_read`, since 20260922115529); no
broad SELECT was added.

| Field | Source | Notes |
| --- | --- | --- |
| `userId` | `profiles.user_id` | target identity; never a nickname |
| `nickname` | `profiles.nickname` | INHAGAME profile is the only nickname authority |
| `title` | `profiles.title` | optional |
| `avatar` | `profiles.avatar_key` | classic / scholar / explorer / star |
| `available`, `relationship` | computed | from the caller's side |

Never returned: email, student id, Inha-mail state, department (deferred), created/joined dates,
game records, rankings, ban metadata, auth claims. Banned or missing targets are
`TARGET_UNAVAILABLE`. When the other side has blocked the caller the answer is only
`{ userId, available: false, relationship: "unavailable" }`.

## Friendship model

`world_friendships`: one row per unordered pair, `user_low < user_high` (CHECK + PK), `status`
`pending | accepted`, `requested_by` (must be a member), `accepted_at` iff accepted.

| From → action | Caller | Result |
| --- | --- | --- |
| NONE → request | A | PENDING(A→B), A sees `outgoing`, B `incoming` |
| PENDING → request again | A | unchanged (idempotent) |
| PENDING(A→B) → request | B (crossed) | unchanged, B sees `incoming`; never auto-accepts |
| PENDING(A→B) → accept / reject | B only | ACCEPTED / NONE (row deleted) |
| PENDING(A→B) → accept | A or anyone else | unchanged |
| PENDING(A→B) → cancel | A only | NONE |
| ACCEPTED → remove | either | NONE |
| any → block | either | block row + pair row deleted |

Every write takes a per-pair advisory transaction lock, so double clicks, two tabs and crossed
requests serialize. The caller is always `auth.uid()`; the browser only sends the target UUID.

## Block contract

`world_user_blocks(blocker_id, blocked_id)` is directional; mutual blocks are two rows, so one side
unblocking never lifts the other's block.

- A block deletes any pending/accepted row and refuses requests in both directions (`NOT_ALLOWED`).
- The blocked side sees the generic `unavailable` state, never "blocked you", and does not see the
  blocker's card details. `get_my_world_social().blocked` lists only people the caller blocked.
- Unblock: only the blocker; the relationship returns to NONE (friendship is not restored).
- Local Chat: `SocialClient.isBlocked` feeds `ChatFeed` moderation, so new lines from a blocked user
  are dropped, and blocking immediately removes that user's feed entries and speech bubble.
- Not in S1-C1: presence hiding or physical separation. A blocked avatar is still drawn.

## Reports

`report_world_user(p_target, p_category, p_place_zone_id)` with categories `spam | harassment |
inappropriate_name | other` and an optional semantic `AREA_*` zone (never `RC_*`). There's no free
text and no chat content. Self reports are refused. The same (target, category) within 24 h returns
`duplicate` without a new row; more than 10 per hour returns `RATE_LIMITED`. `world_user_reports`
has RLS with no policies and no client grants, so players cannot read report rows. Review happens
through service/admin paths only.

## RPC surface (all `authenticated`, SECURITY DEFINER, `search_path = ''`)

`get_world_public_profile`, `get_world_relationship`, `send_world_friend_request`,
`respond_world_friend_request(uuid, boolean)`, `cancel_world_friend_request`,
`remove_world_friend`, `block_world_user`, `unblock_world_user`, `get_my_world_social`,
`report_world_user`. Anonymous (guest) sessions get `PERMANENT_ACCOUNT_REQUIRED`; banned callers
get `ACCOUNT_UNAVAILABLE`. The helpers in `private.*` are not executable by client roles. The
tables have no client privileges at all.

## Client

- `src/social/social-client.js`: RPC-only wrapper with runtime validators (`parseCard` keeps only
  allowlisted fields, clips nickname/title), UUID-only targets (a nickname never reaches an RPC),
  in-flight dedupe per `op:target`, and the local blocked set.
- `src/social/player-card.js`: opens from a remote nameplate tap (click / Enter), resolving the
  target from the Presence model by session id. It never opens for self, never for guests and
  never while the chat input is open. Esc or an outside tap closes it. Actions follow the relationship: 친구 요청 /
  요청 취소 / 수락·거절 / 친구 삭제 / 쪽지 보내기 / 차단 / 차단 해제 / 신고 (category buttons).
  P0-M3's message action hands the server-resolved user id to the Hub through short-lived same-origin
  sessionStorage; profile editing stays at `/profile/`.
- `src/social/friend-panel.js`: `👥 친구` panel with 받은 요청 / 친구 / 보낸 요청 / 차단한 사용자.
  It refreshes on open, after every mutation and when the tab returns to the foreground, and polls
  every 30 s while open (paused when closed). It uses no realtime channel.
- Nameplates become tappable (`pointer-events: auto`); a tap on a plate never starts a camera drag.
  The card fits a 375 px screen (`min(300px, 100vw − 32px)`, scrolls within `100dvh − 140px`).

## Network

Unchanged. Pose/presence packets carry no friendship or block data. Presence already carries
`userId`, which is what the card inspects.

## Trust boundaries

- Presence `userId` and chat sender ids are client-declared (Realtime presence). A spoofed id only
  changes *which* card is shown; every server action still uses `auth.uid()` as the actor and
  re-derives the relationship.
- Local chat blocking is presentation-side filtering for the blocker; it is not delivery
  suppression.

## Types

`supabase/database.types.ts` is was intentionally stale at the time
(`check-types-coverage` then listed missing objects without failing; Public CI now enforces coverage). The new RPCs are called through
`supabase.rpc` from plain JS and validated at runtime, so types were not regenerated here.

## Tests

- pgTAP `61_world_social.test.sql`: schema/RLS/PK and constraints, anon/guest/banned boundaries,
  direct table access denied, the card allowlist, the full state machine (idempotency, crossed,
  wrong acceptor), block semantics, reports (duplicate, rate limit, allowlists, no free text) and
  private helpers. `00`/`01` contracts pin the new functions and their grants.
- `apps/world/tests/social-friends.test.mjs` (11 groups covering the 32 client cases) with
  `tests/support/fake-social-server.mjs`, an in-memory fake mirroring the SQL rules. Its cards
  include extra private fields that the client must drop.

## Deferred

Follow/같이 가기 (S1-C2), party, voice, rooms, presence hiding for blocks, richer report
evidence capture, social telemetry (`friend_request_sent` etc. join the pending Social telemetry patch).
Admin report review is an operational tool maintained outside this repository.
