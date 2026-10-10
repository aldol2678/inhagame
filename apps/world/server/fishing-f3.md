# Fishing F3 — trusted position gate and atomic spot occupancy

Migration: `20261005021000_world_fishing_f3_trusted_presence.sql`.

## Current delivery boundary

The DB consumer and server-only observation contract are implemented. An authoritative world
position producer is **not connected**. Current browser `pose-source.js` / Realtime poses and
`touch_world_online_session_v2` are not trusted position evidence. Deploying this change does not
establish authoritative movement. With `presence_required=true` (the migration default), new
casts and active HOOK commands fail closed until a trusted producer supplies evidence.

An isolated input-driven producer experiment is documented in
[`fishing-position-authority-prototype.md`](../../../docs/implementation/fishing-position-authority-prototype.md).
It exercises this contract against a disposable DB; it is not connected to production movement.

Keep Production `WORLD_FISHING_API_ENABLED` unset. Production SQL application, authoritative
producer integration and player exposure are separate work. See
[`fishing-production-migration-plan.md`](../../../docs/implementation/fishing-production-migration-plan.md).

## Trusted issuer contract

`public.world_fishing_observe_position_v1(user, session_id, revision, x, y, z, space, mode,
observed_at)` grants EXECUTE only to `service_role` and checks the server claim and permanent,
non-banned account. All F3 tables have RLS and no direct player or service-role table grants.
There is no player HTTP observation operation. No service credential belongs in browser code.

The issuer must derive location and eligibility from authoritative movement/state. Relaying a
browser pose through a service credential does not satisfy this contract. It must:

- Emit local coordinates in the same CampusCoordinateFrame as the canonical world landmarks.
- Bind a server-owned session identity to the account and keep one strictly increasing revision
  sequence per account across session changes; restarting revision at 1 is not supported.
- Mark only eligible outdoor campus locomotion `CAMPUS` / `ON_FOOT`. Indoor, mounted, seated,
  combat, airborne or disconnected states must become `OTHER` / `INELIGIBLE` as appropriate.
- Publish a server observation timestamp with clocks coordinated to DB time. Future observations
  are refused. New observations aged 5 seconds or more are refused; consumption applies the same
  age limit. A production producer must update at a cadence that meets that budget.
- Retry an identical revision with the identical full payload and timestamp. Replays return
  `ALREADY_PROCESSED` without refreshing evidence; conflicting reuse is rejected and older
  revisions return `STALE` without overwriting the current position.

Positions are finite and bounded within ±10,000 local units. Server-only enum values are a
narrow eligibility contract, not proof that a trusted producer currently exists.

## Cast and hook gates

Two server-owned spot definitions match `fishing-spots.js`; the cross-layer test fails when
canonical geometry drifts. Acceptance is a 3-unit horizontal radius with y between −1 and 4
inclusive. These are candidate gates for current shore geometry, not final movement tuning.
Capacity is **one account per bank**, with one occupied spot per account.

New casts retain the existing account Activity lock, account eligibility, cooldown and active
attempt checks. They require fresh eligible in-range evidence, acquire the semantic spot lock,
recheck freshness after waiting, remove only expired occupancy and atomically create the attempt,
frozen timing snapshot and lease. The lease expires at that attempt's TTL and binds the issuer's
session. Two accounts cannot both acquire the same unexpired spot. The other bank is independent.

Active HOOK rechecks fresh eligible in-range evidence plus that account's matching unexpired
attempt lease and session. Rejected commands create no success or reward. Cancellation does not
require live position. Terminal replay, reads, TTL expiry and already-earned settlement remain
recoverable without evidence. Success, failed/early HOOK, cancellation and read/input expiry
release only their own attempt lease in the same outcome transaction. Expired occupancy can be
reclaimed; the old attempt cannot remove a newer account's lease.

Fishing still uses the existing Activity → Life/Creature outcome and shared Activity settlement
path. F3 creates no direct Inventory, Discovery or XP writer. Position/lease checks add no browser
grant authority and are not an anti-bot system.

`presence_required=false` is an explicit operator-owned legacy exception, used only by disposable
F2 conformance fixtures in this PR. It is not a client option and is not a production rollout step.
Do not toggle it with active attempts. HTTP exposure remains an independent gate.

## Verification

- `99_world_fishing_f3.test.sql`: default gate, RLS and privilege boundaries.
- `fishing-f3.integration.test.mjs`: missing/stale/invalid/remote observations, server-only issuance,
  monotonic/replay semantics, competing account leases, independent banks, HOOK rechecks, session
  change, missing lease, expiry reclamation, cancellation, account deletion and exactly-once settlement.
- `fishing-client.integration.test.mjs`: real browser client → production handler → local Data API
  → DB with the F3 gate enabled and an explicitly trusted server fixture.
- `fishing-f3.test.mjs`: server/client canonical spot geometry, ID-only API and sanitized errors.

Run DB tests only through `scripts/public-db.sh` on a disposable local stack. Its fixtures reject
remote DB URLs. Current schema compile and primitive-caller guards run with the rest of pgTAP.
