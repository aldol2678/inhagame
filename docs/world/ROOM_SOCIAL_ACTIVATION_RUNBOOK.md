# Room social: minimal coordinated activation plan

## Current boundary

PR #353 is a draft. Code publication, isolated CI, the up-to-three-day chat transport retention,
opening in principle, H3 visitor changes and automatic finite cleanup were approved. Actual
hosted SQL, scheduler writes, feature enabling, merge and deployment wait for the final coordinated
execution step. This document is a plan, not evidence that those actions happened.

The user will also check physical devices after merge. Missing physical-device evidence alone
is not a release hold; known failed security, regression or exact-head CI checks remain holds.

## Read-only facts and required preflight

On 2026-10-12, the GAMES project had the older D2 `world_room_access_v1`, with friendship,
visibility and bilateral-block checks but no H3 owner-presence/knock check. Its H3 knock/presence
and proposed club/chat tables were absent. pg_cron 1.6.4 was already installed and six unrelated
retention jobs were active. Nothing was changed by that read.

Immediately before application, repeat the read-only checks for:

1. Correct project, current migration receipts, exact existing room helper definitions/security
   attributes, table existence, and the reviewed dependency delta. Do not assume a stale read.
2. Existing pg_cron and job availability. Reuse it; do not install a new production extension or
   add credentials/grants. Abort if the environment differs from the reviewed plan.
3. Real Realtime `send` is SECURITY INVOKER, messages RLS is enabled, client roles are not
   superuser/BYPASSRLS, and unrelated policies remain intact. A provider call returning normally
   is not proof of insertion; check row/delivery effects.
4. No pre-existing data in the new candidate/H3 tables. If tables or earlier variant receipts
   exist, stop and review an explicit upgrade/data plan. Never drop a pre-existing ledger or
   purge unrelated rows as a shortcut.

Do not perform a blanket `supabase db push`: unrelated unapplied migrations are outside scope.

## Exact minimal SQL set and staging order

The final reviewed hashes and exact-head CI receipts must accompany these four files:

1. `20261005022000_world_personal_room_knock_h3.sql` (existing repository prerequisite, absent in
   the read-only production snapshot). Installs knock/presence and replaces visitor access.
2. `20261012023000_world_club_room_multiplayer.sql` (six seats, fresh server admissions, finite
   rate metadata, provider safety, private inbox RLS and cleanup job).
3. `20261012023100_world_room_chat_candidate.sql` (CLOSED chat config, server-identified chat,
   exact-admission binding, restrictive inbox policies and finite chat cleanup).
4. `20261012025000_world_room_h3_authority_retention_candidate.sql` (current-time H3 checks,
   finite H3 cleanup and private visitor CARE lease validator).

Stage the complete reviewed set with both chat and club feature gates CLOSED. The new cron job
is `world-room-social-cleanup-v1`, every minute, and calls only
`private.world_room_cleanup_v1()`. It does not require a network token. Inspect the installed
objects, policies, helper fingerprint and CLOSED behavior before any feature-enable operation.
Existing unrelated functions and migration receipts must remain unchanged except the explicit
H3/room-social definitions in this set.

Because H3 changes existing friend-room entry behavior, do not claim that CLOSED chat leaves all
visitor behavior unchanged. This prerequisite was separately disclosed and approved.

## Entry and revocation behavior

- The owner is unchanged. Friends still need current friendship, permitted visibility and no
  bilateral block or sanction.
- When the owner is present (12-second heartbeat), a visitor needs a current accepted/open
  knock within the existing two-hour window. Pending knocks expire after 30 seconds. A recent
  decline blocks for ten minutes. The five-per-two-minute request limit is preserved.
- When the owner is absent, the existing H3 contract permits a qualifying friend to open/enter.
  This plan does not silently change that rule into an always-owner-present requirement.
- There is no explicit accepted-knock cancellation API in H3. Block, unfriend and private
  visibility revoke access on the next server check. Owner departure alone is not such a revoke.
- Every authorization time is evaluated from current wall-clock time after relevant lock waits.
  Cleanup never recreates a request; a late response to a deleted/expired knock cannot approve
  a new one. Existing two-hour/ten-minute/rate windows are not shortened by cleanup.
- Client pose UUIDs and physical coordinates are not certified location. Club uses a separate
  fresh server admission/inbox for every new stay; old admissions cannot mutate a replacement.

## Finite storage and availability tradeoff

No permanent account-linked session tombstone is created. Club quota metadata is only user UUID
and timestamp, cascades on account deletion, and is needed for a rolling one-hour quota.

With the every-minute job healthy, expected upper bounds are:

| Record | Authority window | Normal cleanup bound |
| --- | --- | --- |
| Club quota timestamp | One rolling hour | About 61 minutes |
| Club/chat live lease | 20 / 30 seconds, renewed while admitted | Expiry + up to one minute |
| Chat rate row | Five seconds | About 65 seconds |
| Accepted/open knock | Two hours from creation | About 121 minutes |
| Declined knock | Ten minutes from response and at least two-minute rate window | About 11 minutes after response |
| Pending/expired knock | Thirty-second pending expiry, two-minute rate evidence | About three minutes from creation |
| Owner presence | Twelve seconds | About 72 seconds from last heartbeat |

These are healthy-scheduler bounds, not guarantees during outages. Existing rows can remain
until cleanup recovers. A non-identifying last-success timestamp and exact active cron-job
contract guard admission/renewal/publication; after 90 seconds without cleanup success those
paths close. H3 new knock/presence writes close too, while existing read decisions still expire
according to current time. Alert on cleanup lag before this availability cutoff. Do not disable
the job as a feature rollback.

Provider Database Broadcast payloads are separate: Supabase documents removal after three days.
The approved retention includes text/name/sender/session/room in that delivery transport. There
is no application message-history API, persistent browser transcript or E2EE guarantee. UI feeds
clear on leaving, switching, account change and reconnect; bubbles keep their normal four seconds.

## Friend plant CARE coupling

The separately reviewed plant candidate uses
`private.world_room_chat_plant_lease_v1(user, room, session, lease)` after its room lock.
The helper locks/rechecks the own personal 30-second lease, H3, chat gate, cleanup health and
current identity. It is private and not directly executable by client roles.

Room entry obtains this lease without opening the chat composer or sending. The club enabled flag is independent of personal chat and visitor CARE. Leaving/expiry,
account change, a different room/session, revoked friendship/visibility/block, a now-invalid
knock decision, disabled chat or cleanup outage rejects visitor CARE. Owner CARE remains
independent. This proves server admission, not continuous physical presence. Plant integration
must test the actual room-chat helper, not only a hand-written Boolean stub.

## Verification and opening

Before operational application: exact-head full required CI, actual disposable migration replay,
pgTAP/type coverage, observed real PostgreSQL races, actual loopback Realtime stale-subscriber
raw-payload exclusion, independent security review, and refreshed desktop/portrait/landscape
browser artifacts. Preserve previous failures and distinguish synthetic browser authority from
real disposable Realtime and hosted production.

After CLOSED staging and parent coordination, enable only the reviewed room gates. With two
existing authorized test accounts, verify owner/friend entry, knock decline/expiry, text and
bubbles, mutual club avatars/seats, block/revoke/leave/rejoin, disabled-gate denial, and unrelated
campus/Phone/ZIP-room/photo behavior. Never publish JWTs, lease/nonces or raw private payloads
in logs/artifacts. Confirm cleanup success and metadata age bounds after the first scheduled run.

Rollback closes chat and club flags independently. Keep the cleanup job running. Do not delete
user data, drop tables, restore looser D2 access, loosen provider grants/RLS or extend lease/bubble
lifetimes to mask a failure. Report the exact failing layer and obtain a separate plan if a
rollback would need a destructive or permission-changing action.
