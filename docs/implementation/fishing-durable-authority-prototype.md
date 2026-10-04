# Fishing durable owner / revision / outbox — disposable DB prototype

Implemented for **disposable loopback DB validation only**. This is not a production
migration, public API, provisioned movement service or completed admission implementation.
The normal migration sequence, F3 issuer and server/browser entry points are unchanged.

## Installation boundary

`supabase/prototypes/fishing-authority-prototype.sql` creates the isolated
`fishing_authority_prototype` schema. Only its integration test installs it, after rejecting
non-loopback DB_URL and checking the schema does not already exist. No installer replaces
existing state. Creation is transactional; successful installation is tracked before cleanup.
The test restores runtime policy, deletes fixture users and drops/rechecks the schema.
Normal pgTAP and type generation run without this schema. It is not a PostgREST-exposed schema
and has no HTTP route. Run through `bash scripts/public-db.sh` on the disposable local stack.
The installer lives outside `supabase/tests`: the Supabase CLI recursively treats SQL under
that directory as pgTAP tests, so placing installation SQL there would run it prematurely.

The SQL fixture could technically be executed by a privileged operator elsewhere; the
loopback enforcement belongs to its test installer, not a SQL hostname heuristic. Do not
apply it to Production. No Supabase project/branch or paid service is created by this work.

## Persistent state and functions

| State | Durable contract |
| --- | --- |
| owners | One row/account: DB-owned session/token, increasing owner epoch, lease, high-water revision, ACTIVE/RELEASED |
| claims | Immutable account/request identity and assigned epoch/token/session; old request cannot reacquire ownership |
| outbox | Unique account/operation and account/revision; original full position tuple/timestamp and committed receipt |

All tables have RLS and no direct anon/authenticated/service_role grants. Only six explicit
entry functions grant service_role EXECUTE and schema USAGE; helper EXECUTE is revoked.
Every entry checks the existing server-role/permanent/non-banned-account guard and acquires
the existing `world_activity:<user>` advisory transaction lock before row locks or F3 calls.
No new Inventory, Collection, Life XP, Activity or spot-lease writer exists here.

- `acquire(user, requestId)` serializes competing workers. A live different owner is BUSY.
  A released/expired owner may be replaced with new DB UUIDs and incremented epoch. Old
  pending records become FENCED. Replacement atomically publishes an INELIGIBLE observation
  in its new session and records that receipt before returning ownership. Initial revision
  starts above both the stored watermark and existing F3 evidence; it never restarts at 1
  on owner/session changes. Replaying a claim returns its original capability/session and
  current status; it does not renew the lease or mint another owner. Old claims return
  FENCED/EXPIRED/RELEASED as applicable.
- `renew(user, epoch, token)` renews only the still-live current owner. An expired owner
  cannot revive its lease by sending a delayed heartbeat. This prototype's fixed lease is
  three seconds; production tuning/heartbeat budgets remain separate acceptance work.
- `enqueue(user, epoch, token, operationId, XYZ, space, mode, observedAt)` persists an immutable
  server-calculated observation and allocates its revision under the account lock. Session
  and revision come from DB ownership; caller cannot override them. XYZ/state/original
  observedAt are trusted producer inputs, never player payloads. Coordinates/enums and
  nonfuture age <5s are validated. A repeated operation must have the identical epoch/token/
  tuple/time; changing its timestamp or position is a conflict. Existing terminal operations
  may be read/replayed without reviving expired ownership. A new operation requires a live
  owner. Invalid data allocates nothing.
- `pending(user, epoch, token)` reads the live owner's queued records in revision order so
  a new process/connection can recover work without JS memory. It does not resample clocks
  or make persisted coordinates fresh. This is not a persisted locomotion checkpoint.
- `publish(user, epoch, token, operationId)` checks the stored owner and invokes the actual
  F3 issuer with the persisted tuple. F3 evidence and outbox receipt/status commit in the
  **same PostgreSQL transaction**. A lost successful response retries a durable DELIVERED
  receipt without another observation call or freshness renewal. A transaction rollback
  retains neither the F3 write nor its acknowledgement. EXPIRED/FENCED records never become
  eligible. Out-of-order lower revisions become SUPERSEDED when F3 returns STALE. Revision
  ordering, not delivery timing, prevents old state from replacing newer evidence.
- `release(user, epoch, token, operationId)` atomically stops ownership, fences its pending
  records and writes newer INELIGIBLE evidence with a durable idempotent receipt. An expired
  but unreplaced owner may revoke itself; a replaced owner cannot revoke the new session.
  Replaying an old release receipt after takeover does not rewrite the new position.

Epochs and revisions are bigint internally and **decimal strings** in JSON views. This avoids
losing precision beyond JavaScript's safe integer range. Issuer receipt payload is retained
verbatim as historical evidence; callers use the outer decimal-string revision field rather
than parsing a large numeric revision from the original F3 receipt. High-water exhaustion
raises and rolls back instead of wrapping. Claims/outbox currently retain history until
account deletion; production retention/compaction and capacity limits are not implemented.

## What restart and fencing mean here

Every integration query launches a fresh psql connection. Claim replay and pending recovery
therefore depend on persisted rows, not a process Map or connection-local revision. An owner
can recover its pending work during the same lease; after expiry it must take a new claim,
session and epoch. It cannot relabel expired old evidence as newly observed. DB acquire/renew/
publish serialization prevents an old publication from racing past a completed takeover:
either it commits before the takeover, or the takeover fences it before it can publish.

This protection applies **only to these prototype entry functions**. The existing service-role
`public.world_fishing_observe_position_v1` still accepts raw trusted observations, and privileged
SQL can bypass any fixture. Production integration must make fenced ownership the sole trusted
issuer path, with reviewed issuer ACL/epoch checks. Do not claim system-wide fencing from this
experiment or hand these owner capabilities/service credentials to the browser.

The fixture movement test adapts the existing input-driven producer's server-calculated XYZ,
mode and original timestamp into the durable enqueue/publish path. Its ephemeral session/
revision is discarded; DB ownership supplies those fields. That adapter is test-only and does
not establish production transport, admission/READY, durable movement-state recovery or client
root ownership. Lease renewal, liveness, auth renewal, map/session transitions and admission
lookup must still follow the [v1 handoff contract](fishing-admission-handoff-v1.md).

Release here is **producer revocation only**, not the complete handoff EXITED postcondition.
It does not cancel an active attempt or delete its spot lease. The future admission coordinator
must recover/cancel/expire Activity and persist its own exit tombstone. Earned settlement remains
recoverable after release. If a worker disappears without release, accepted F3 evidence can
remain usable for its existing five-second TTL until takeover/invalidation; lease expiry itself
does not alter the F3 consumer. No immediate-revocation claim is made during DB/network outage.

Server observation clocks still need coordination with DB time. Enqueue retains the producer's
original observedAt instead of assigning a fresh DB timestamp to delayed movement data. DB-clock
timestamps are used only for DB-owned acquire/release INELIGIBLE transitions. A production
producer must never enqueue arbitrary client poses through its service credential.

## Verification and next acceptance boundary

The dedicated integration file verifies:

- RLS/table/function privilege denial, fake role claims and account eligibility;
- competing owner claims, stable replay/session/lease and independent account tokens;
- pending recovery over fresh DB connections, immutable tuple conflicts and lost-response replay;
- concurrent monotonic revision allocation and out-of-order supersession;
- expired owner replacement, pending fencing, ineligible proof and old renew/release rejection;
- actual five-second evidence/outbox ageing while renewing owner lease, with no retry freshness;
- nonfinite/invalid/old/future observations and exact revisions beyond 2^53;
- publisher/receipt rollback, idempotent release and replacement-session protection;
- actual input simulation → durable outbox → F3 cast/hook → release → exactly-once earned settlement;
- account-delete cascades and schema cleanup before the remaining integration/type checks.

Before live use, implement/review the sole fenced issuer, durable admission/exit coordinator,
bounded history retention and publication cadence/cost, producer state/clock recovery, real
transport and controller handoff. Rehearse on a disposable Production-schema copy before any
separate Production DB application or exposure approval. No such copy/branch is provisioned
in this work. Automatic Preview is unnecessary for this DB-only prototype.

See [producer prototype](fishing-position-authority-prototype.md),
[F3 contract](../../apps/world/server/fishing-f3.md),
[Production migration plan](fishing-production-migration-plan.md).
