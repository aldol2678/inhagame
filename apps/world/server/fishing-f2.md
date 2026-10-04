# Fishing F2 — server settlement and self read (development candidate)

F2 extends the merged F1 pure timing contract to a disposable DB fixture for one
carp. It is not production activation. Two allowlisted source IDs remain semantic
identities; world placement, range/occupancy evidence and the player UI are F3.
There is no browser grant API, growth curve tuning, weather modifier, coin reward,
Campus World EXP or Quest write in this slice.

## Authority and transactions

- `POST /api/world-fishing` verifies a permanent Supabase account with the existing
  server verifier. The server supplies `p_user`; the browser cannot supply an actor.
  Anonymous/banned accounts are also refused by the DB account guard.
  The shared verifier imports public config directly, avoiding browser/world module
  dependencies in the server entry point without changing its verification rule.
- A server-only RPC starts the attempt under the existing Activity account lock, through the
  Life -> Creature bridge (`world_life_activity_start_with_creature_v1`), which requires
  `life.fishing` ACTIVE and binds the Creature party revision. Finalize likewise goes through
  `world_life_activity_finalize_with_creature_v1`, so any Creature growth is decided in the same
  transaction as the outcome (the fishing bridge row is still COMING_SOON, so it records NOOP).
  It samples DB time, random bite delay and a configured policy once, then stores
  the full snapshot alongside the Activity owner row. One account may have one
  ACTIVE fishing attempt across both spots. A configured cooldown applies to new
  keys; a matching key replays its original attempt even after disable/timeout.
- Input checks actor ownership, source, nonce and action before replay. The same
  account lock and row lock serialize HOOK/CANCEL. One terminal result commits
  together with the Activity outcome; repeated matching input returns that result.
  Conflicting actions fail. TTL takes priority over cancellation and hook timing.
  Bite is inclusive; hook deadline and TTL are exclusive.
- A separate settlement transaction uses the shared Activity settlement path
  (`private.world_activity_settle_v1`, Authority Map 7.4). Fishing only derives the output plan
  from the frozen server catch: exactly one `material.fish_carp`, `collection.fish.carp`, and the
  start snapshot's Life XP for `life.fishing`. The settlement path applies the Inventory,
  Discovery and Life Skill primitives and one immutable receipt in
  `private.world_activity_settlements` together. Overflow or a disabled downstream catalog rolls
  the entire settlement back, leaving the already committed outcome available for an explicit
  retry. Zero XP omits the XP output. Attempt-derived idempotency keys and the receipt PK prevent
  duplicates; a different plan for a settled attempt is refused.
- Reads return only the verified account's requested/latest attempt and current
  carp quantity, discovery and skill projections. They may reconcile a stale ACTIVE
  attempt to EXPIRED. `settlement` is `PENDING` for an unsettled success, `SETTLED`
  when a receipt exists, and `NOT_REQUIRED` otherwise (including ACTIVE/no attempt).
  Current projections can differ from the historical receipt after later writes.
  Consuming all carp does not erase Discovery; replay never grants again.

The generic service-only Activity API must not be used as a second resolver for
fishing. A conflicting terminal Activity outcome is refused. Its generic expiry
can be reconciled into a fishing expiry; it cannot create a fishing success.
Fishing tables and settlement receipts have RLS and no direct grants for anon/authenticated/service
roles. Only the four public RPCs grant service-role EXECUTE, with a service claim
guard; internal helpers are revoked. Browser roles cannot promote themselves by
submitting a forged claim. The service credential belongs only in server env.

## Request shapes

| op | Exact remaining fields |
|---|---|
| `start` | `activityId: activity.fishing.inkyung`, allowlisted `sourceRef`, UUID `clientAttemptKey` |
| `input` | UUID `attemptId`, same `sourceRef`, UUID `nonce`, `action: HOOK\|CANCEL` |
| `settle` | UUID `attemptId` |
| `read` | Optional UUID `attemptId`; omit for latest own attempt |

Unknown fields (including user, result, policy, XP, quantities, time and weather)
fail closed. The endpoint accepts only JSON POST, caps bodies at 8 KiB, checks
browser Origin, sets no-store and returns sanitized errors. An ambiguous network
failure has no automatic mutation retry: read/replay with the same identity.

## Repository activation candidate (20261004139000)

On a database where this migration has been applied, Fishing is the first ACTIVE Life Skill.
The migration activates `life.fishing`,
`collection.fish.carp` and this runtime with the candidate policy `fishing.candidate.v1`
(3–9 s wait, 1.5 s response window, 30 s TTL, 20 Life XP, 2 s between starts). These are
candidate values, not tuned balance; they live in the one runtime row. The tree nodes and the
Creature bridge stay COMING_SOON. The browser path is `src/activity/fishing-client.js` /
`fishing-panel.js` / `fishing-spots.js`. Production play still needs
`WORLD_FISHING_API_ENABLED=1`; until then the endpoint answers 404 and no 🎣 action is shown.
World distance/occupancy checks (F3) are still not implemented: the spots only decide where
the action is offered.

### Production deployment prerequisites

Merging this repository does **not** apply SQL to Production. `public-db.sh` validates a
disposable local database only; the Vercel Git deployment publishes the client and handler.
Before exposing fishing, reconcile the Production schema with the required Life curve/SP,
Activity settlement, Fishing F2, tree/reset and Life Skill Book migrations, apply approved
forward migrations in dependency order, then read back the catalog, runtime policy and RPC
grants. Do not replay the public baseline onto an existing Production database.

Keep `WORLD_FISHING_API_ENABLED` unset until those database postconditions and the exposure
review are satisfied. F3 remains the default prerequisite for player exposure; using the
T1 prototype without authoritative position/occupancy requires an explicit owner exception.
The candidate timing/XP values also require owner acceptance before exposure.

## F2 defaults and validation (historical)

Both switches are deliberately off: HTTP requires `WORLD_FISHING_API_ENABLED=1`
and the private runtime row defaults `enabled=false`, `policy=null`, cooldown=null.
No deployment env or production DB is changed by this PR. F1 registries and DB
Discovery/Life Skill mirrors stay COMING_SOON. No official balance is seeded.
The test fixture alone temporarily enables carp Discovery, fishing Life Skill,
an explicit timing/XP policy and cooldown on a loopback disposable DB; it restores
catalog/runtime state and removes fixture users in teardown.

Code tests exercise strict authority allowlists, auth failure, HTTP gates,
sanitized errors and disabled entry point. PgTAP checks disabled defaults, RLS,
privileges, policy rejection and the service guard. Integration tests run multiple
independent DB connections for concurrent start/input/settlement and opposing
commands, rollback/retry, overflow, cross-account and unavailable accounts,
expiry, cooldown, zero XP and durable Discovery after consumption. Exact boundary
decisions and JSON snapshots are compared to F1 JS for both sources.

Run code tests with `node --test apps/world/tests/fishing-core.test.mjs
apps/world/tests/fishing-service.test.mjs`. The repository `scripts/public-db.sh`
starts local Supabase, runs all PgTAP/integration tests and checks generated type
coverage; its local runner rejects remote DB/API URLs and removes remote secrets.
The existing full public CI discovers these new tests automatically.

F3 must establish authoritative world distance/occupancy checks and review exposure
before any player activation. F4 species/growth/device work and production
migration/deployment remain separate steps.
