# INHA WORLD · Life Skill Authority P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Canonical design: `INHA WORLD · P0 Life Skill Technical Contract v0.1 [CANDIDATE]`.

This slice adds the shared **Life Skill XP / derived Level authority** without activating any gameplay
skill or deciding Fishing/Gathering/Archaeology balance.

## Scope

Pure Registry:

- `apps/world/src/life-skills/life-skill-registry.js`
- 11 long-term Life Skill definitions
- one common curve identity: `life.common.v1`
- code → DB authority-row projection
- fresh Lv1 / 0 XP snapshot contract

Initial Registry:

- P1-A: Fishing / Gathering / Archaeology
- P1-B: Woodcutting / Mining
- future: Woodworking / Cooking / Crafting / Farming / Photography / Research

All are `COMING_SOON` in M5.

## Persistence

### Skill mirror

`private.world_life_skill_catalog`

Minimal write-authority mirror:

- skill ID
- curve ID
- status

The code Registry remains product-semantic canon.

### Thresholds

`private.world_life_skill_thresholds`

Per-curve immutable thresholds.

M5 permanently seeds only:

- `life.common.v1 · Lv1 · 0 XP`

Lv2..10 are **not** committed here. The contract requires immutable published thresholds while the
P1-A design still says final XP numbers must be tuned from actual play frequency. Therefore an
activation/balance migration must append the approved Lv2..10 thresholds before any P1-A skill becomes
`ACTIVE`.

The database enforces:

- each new curve starts at Lv1 = 0
- levels append sequentially inside that curve
- XP thresholds strictly increase
- existing threshold rows cannot update/delete

### Player projection

`private.world_player_life_skills`

One row per `(user, skill)`:

- total XP
- version
- timestamps

Level is deliberately not stored.

### XP ledger

`private.world_life_skill_xp_transactions`

Append-only positive XP transactions:

- amount
- XP before/after
- server-derived Level before/after
- source identity
- global idempotency key

## XP authority

`private.world_life_skill_xp_apply_v1(...)`

Write prerequisites:

1. permanent non-banned account
2. valid skill ID
3. positive XP
4. allowed server source vocabulary
5. idempotency key
6. skill exists
7. skill status is `ACTIVE`
8. referenced curve has a valid threshold base

Behavior:

- projection lazy-created on first accepted XP
- one account/skill projection row locked for update
- Level derived from server thresholds
- exact retry → `ALREADY_PROCESSED`
- same key + different identity → `IDEMPOTENCY_CONFLICT`
- Level may jump multiple steps if the verified XP amount crosses multiple thresholds
- XP above the highest currently defined threshold is retained

## Read contract

`private.world_life_skill_snapshot_v1(user, skill)`

Fresh account / absent projection reads:

- totalXp = 0
- level = 1
- version = 0

Read does not provision a row.

`private.world_life_skills_list_v1(user)` returns all mirrored skills with:

- status
- XP
- derived Level
- current threshold
- next threshold
- progress
- max defined Level

No player-facing public RPC is added in M5. The authenticated Life Skill Book API belongs with the
actual Activity adapter/UI phase.

## World Progression boundary

Life Skill XP never calls or mutates:

- `world_exp_apply_v1`
- `world_player_progression`
- Campus World Level thresholds

The pgTAP contract explicitly verifies that Life Skill XP creates no Campus EXP ledger/projection rows.

## Source vocabulary

M5 accepts only server-semantic sources:

- `activity`
- `crafting`
- `research`
- `farming`
- `system`
- `admin`

Raw button clicks, AFK ticks or local movement are not source types.

## Security

- four new private tables use RLS
- raw privileges revoked from anon/authenticated/service_role
- private write/read helpers have no Data API grants
- no generic public Life Skill XP write RPC
- account and ban checks are server-side

## Tests

Pure:

- `apps/world/tests/life-skill-registry.test.mjs`

Database:

- `supabase/tests/database/85_world_life_skill_authority_p0.test.sql`

Integration parity:

- `supabase/tests/integration/life-skill.integration.test.mjs`

The DB test temporarily appends Lv2/Lv3/Lv4 values inside its rolled-back transaction only. Those
numbers are test fixtures, not balance canon.

Coverage includes:

- code Registry / DB mirror shape
- fresh Lv1 / 0 XP without row creation
- COMING_SOON write refusal
- curve sequential append
- threshold immutability
- first XP grant
- level-up
- multi-level jump
- max-defined overflow
- same-key retry / conflict
- skill isolation
- account isolation
- guest / banned rejection
- append-only XP ledger
- World EXP separation
- account-delete cascade

## Explicitly deferred

- final Lv2..10 XP numbers
- P1-A skill activation
- Activity Result → Life Skill XP policy adapters
- Fishing/Gathering/Archaeology XP amounts
- player-facing Life Skill Book RPC/UI
- tool/recipe unlock adapters
- achievements/titles
- boosters/caps/prestige/mastery

## Status

Branch implementation only.

- Not merged
- Not deployed
- Not migrated to Production
- No Life Skill is live
