# INHA WORLD · Activity / Outcome Authority P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Canonical design: `INHA WORLD · P0 Activity / Outcome Technical Contract v0.1 [CANDIDATE]`.

This implementation slice adds only the shared **Activity meaning / attempt / terminal outcome** authority.
It does not implement Fishing, Gathering or Archaeology gameplay and does not grant Inventory, Collection,
Life Skill, Wallet, EXP, Quest or Event state.

## Scope

Code:

- `apps/world/src/activity/activity-contract.js`
  - Activity Registry
  - T0 / T1 / T2 authority tier vocabulary
  - INSTANT / INTERACTIVE / SESSION mode vocabulary
  - attempt state transition validation
  - client start-request authority-field rejection
  - semantic event envelope validation
  - three P1-A definitions registered as `COMING_SOON`

Database:

- `private.world_activity_attempts`
- `private.world_activity_start_v1(...)`
- `private.world_activity_finalize_v1(...)`
- service-role public wrappers:
  - `public.world_activity_start_v1(...)`
  - `public.world_activity_finalize_v1(...)`

Player-facing read/resume RPCs are deliberately deferred until the thin Activity Client and
account-generation/stale-callback contract are implemented.

## Attempt lifecycle

Pure contract:

`CREATED → ACTIVE → SUCCEEDED | FAILED | CANCELLED | EXPIRED`

The M2 server start API creates an `ACTIVE` row directly. `CREATED` remains part of the shared state
vocabulary for future adapters but is not exposed as a persistent intermediate state in this slice.

Terminal states are immutable.

## Identity / idempotency

- `attempt_id`: server UUID
- `client_attempt_key`: UUID supplied by the trusted adapter, unique per account
- `activity_id`: semantic Activity ID
- `source_ref`: semantic world/source ID, never raw XYZ
- `definition_version` / `resolver_version`: fixed when the attempt starts

Start behavior:

- same account + same client key + same identity → `ALREADY_PROCESSED`
- same account + same client key + different identity → `IDEMPOTENCY_CONFLICT`
- new key while the same semantic source is ACTIVE → `ATTEMPT_ALREADY_ACTIVE`
- stale ACTIVE attempt with an expired server timestamp → old attempt finalizes as `EXPIRED`, then a new key may start

Finalize behavior:

- first valid terminal transition → `SUCCESS`
- exact terminal replay → `ALREADY_PROCESSED`
- different result after finalization → `OUTCOME_CONFLICT`
- finalize after server expiry → `STALE_ATTEMPT`, with the attempt finalized as `EXPIRED`

## Authority boundary

The client never submits authoritative:

- reward ID / amount
- output item / quantity
- rarity
- Life Skill XP
- Collection completion
- Quest completion
- price
- server time

The DB attempt row does not contain settlement status.

A successful Activity outcome must later be consumed by domain adapters:

`Validated Outcome → Inventory / Collection Discovery / Life Skill`

and independently:

`Validated Outcome → Quest / Event → optional Reward Eligibility → existing Reward Core`

## Security

- raw `private.world_activity_attempts` table privileges are revoked from anon/authenticated/service_role
- RLS is enabled
- internal helpers have no Data API execute grants
- public start/finalize wrappers are service-role only
- permanent non-banned account validation is server-side
- account-scoped advisory locking serializes start/finalize for one account

## Tests

Pure Node contract:

- `apps/world/tests/activity-contract.test.mjs`

Database pgTAP:

- `supabase/tests/database/82_world_activity_authority_p0.test.sql`

Coverage includes:

- registry identity / T1 classification / `COMING_SOON` status
- definition validation
- forbidden client authority fields
- state transitions
- semantic event envelope
- schema / RLS / function privileges
- same-key replay
- idempotency conflict
- duplicate active-source prevention
- terminal replay / conflict
- terminal immutability
- stale attempt expiry
- guest / banned rejection
- account deletion cascade

A separate cross-connection concurrency integration test was not added in this slice because the
repository-write tool rejected that file payload during authoring. Database serialization is still
implemented with the account advisory lock and is covered structurally; real multi-connection
concurrency remains a merge gate before this slice can be called fully verified.

## Implementation status

- Branch implementation only.
- Not merged.
- Production migration not applied.
- Activity gameplay adapters not implemented.
- Player-facing Activity client not implemented.
