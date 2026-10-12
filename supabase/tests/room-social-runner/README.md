# Room social database verification

Local synthetic SQL checks, with an exact dev-only dependency:

```sh
npm ci --ignore-scripts --prefix supabase/tests/room-social-runner
npm test --prefix supabase/tests/room-social-runner
```

This runs harness unit tests and PGlite 0.3.14 against the actual room migrations,
with synthetic auth/provider and cron metadata objects. PGlite strips only CREATE EXTENSION pg_cron; it does not claim a scheduler ran. It proves neither a full Supabase replay nor
multiple PostgreSQL backends nor WebSocket delivery.

The existing required `Public CI / database` job runs `scripts/public-db.sh` on a
fresh GitHub-hosted runner. Supabase CLI starts the disposable local stack, replays
the complete migration lineage, runs all pgTAP files, then automatically discovers
`supabase/tests/integration/room-social.integration.test.mjs` and
`supabase/tests/integration/room-social-realtime.integration.test.mjs`. No separate remote
database URL, project credentials, migration push, or production connection is used.

The real integration runner accepts only loopback port 54322 and the checked-in
local database. Every race uses independent psql processes. A held row lock is
released only after `pg_stat_activity` proves each distinct contender backend is
waiting for a lock; the returned backend PIDs must match that evidence. Tests cover
seven-way capacity, two contenders for the final slot, two-account races for all
six chairs, account replacement/old leave, expired leases, four-way chat rate
limiting, production numeric actions through actual provider SQL insertion, same client UUID
reuse with new server admissions, old mutation/chat-lease denial, account deletion cascade,
and the actual pg_cron worker deleting expired application metadata with no user activity.

The raw WebSocket regression establishes a receiver on both old club/chat topics and proves
baseline delivery. It keeps that socket subscribed while the same account leaves and rejoins
with the exact same client pose UUID, subscribes a second socket to the fresh server topics,
and verifies new publications arrive there with zero raw future frames or provider rows on
either old inbox. No client decoder, nonce filter, or UI is in the observation path. Evidence
contains only aggregate counts, never JWTs, signing keys, inbox nonces or raw payloads.

pgTAP uses the real provider table and publisher without replacing protected
Realtime functions. Missing-publisher fault injection is confined to PGlite's
synthetic schema. The two pre-existing exact policy-list assertions now include
the six committed room policies when a real provider table exists; their stand-in
case retains exactly the original campus policies.

All identities are synthetic. Both club and chat start independently CLOSED. pgTAP activation/data/policies are rolled back.
Integration fixtures restore the default CLOSED chat switch and remove their own
identities/topics. Supabase is stopped with `--no-backup` by the job's existing trap.

Supabase DB Broadcast retains messages in `realtime.messages` for up to three days
as documented by the provider. These short tests check private transport metadata
and lack of application transcript columns; they cannot verify a three-day cleanup
window. Real browser behavior beyond the isolated raw WebSocket scenarios, provider retention
disclosure approval, and explicit activation remain separate release gates. A passing PGlite run must never be reported as passing those gates.

Provider references:
- https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database
- https://supabase.com/docs/guides/realtime/authorization

## Finite application metadata retention

No permanent session/inbox tombstone is created. A server-generated admission UUID supplies
the club topic and mutation capability; a separate client UUID remains in visual presence.
Chat club leases bind that exact admission and cascade on its deletion. Account deletion
cascades active club/chat state and account rate timestamps.

The candidate reuses/installs pg_cron in disposable replay and registers exactly one minute
job. Under a healthy scheduler, admission-rate timestamps are removed within approximately
61 minutes, expired club/chat rows within lease expiry + one minute, and chat-rate timestamps
within approximately 65 seconds. Scheduler outage can retain rows until recovery. A missing,
inactive or mismatched job, or a success timestamp older than 90 seconds, closes admission
and publication. This is not a promise of deletion while the scheduler/database is down.
Production job registration and any dependency/activation changes require separate approval.

Personal chat additionally requires the exact reviewed H3 access/owner-presence function
bodies, SECURITY DEFINER with empty search_path, and H3 tables. The chat migration 20261012023100 never installs or alters H3 helpers. The separately
reviewed forward-only 20261012025000 migration hardens existing H3 clocks/writes/cleanup and
updates the reviewed fingerprints; the original historical H3 migration remains untouched. An older D2 installation or a future legitimate helper edit fails closed
until the new implementation is reviewed and its fingerprint updated. Before any approved
activation, verify private.world_room_chat_personal_authority_ready_v1() is true. PGlite
fault-injects missing dependencies and a weaker same-name helper only in its synthetic schema.

## H3 and private friend-CARE bridge

The forward-only H3 candidate uses wall clock after room/knock locks, preserving existing
owner-away access and idempotent answered requests. Responding false to ACCEPTED does not
cancel approval; no approval-cancellation endpoint is introduced. New knock, owner-presence
write and pending response fail closed when cleanup is unhealthy. Narrow H3 write authority
also checks account status and active moderation against wall clock after acquiring locks.
Existing read authority still evaluates real expiry rather than transaction-start time.

The same minute cleanup job removes ACCEPTED/OPEN receipts after created_at + 2 hours,
DECLINED after both responded_at + 10 minutes and created_at + 2 minutes, PENDING/EXPIRED
when both expires_at and created_at + 2 minutes have elapsed, and owner presence after
seen_at + 12 seconds. Healthy-scheduler approximate maxima are 121 minutes / 11 minutes /
3 minutes / 72 seconds. An outage may retain rows until recovery.

private.world_room_chat_plant_lease_v1(user, room, clientSession, lease) is private-only. It
acquires the exact lease FOR SHARE, then checks authenticated caller, personal room/session,
30-second expiry, chat feature/cleanup health, active moderation and fresh H3 VISITOR access.
It is independent of the CLOSED club flag. Plant owner's own CARE does not use this helper.
The caller must acquire owner-inventory and personal-room locks before invoking it. Cleanup
also takes affected personal-room locks before chat-lease deletion, preventing reverse order.

room-social-h3.integration.test.mjs adds real independent-backend lock evidence for a pending
response expiring while blocked, lease/H3 expiry during CARE's row-lock wait, SHARE blocking
leave until transaction completion, room privacy changing while CARE waits, and cleanup
waiting behind CARE without reversing room/lease locks. These are executable CI gates, not
claims that local PGlite ran concurrent PostgreSQL or a live provider.
