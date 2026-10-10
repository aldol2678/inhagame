# INHA WORLD Economy P0-C · Reward Orchestrator

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Design sources (Notion CURRENT DESIGN): `Economy E0–E5 상세설계 v0.1` §1, §11, `Collection / Economy /
Quest Framework v0.1` §11.4, §14. Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260928011418_world_reward_orchestrator_p0c`).
Builds on P0-A Wallet (`docs/world/ECONOMY_P0A_WALLET_LEDGER.md`) and P0-B Inventory
(`docs/world/ECONOMY_P0B_INVENTORY_CATALOG.md`).

```
Verified source (Quest / Event / Minigame, later) → RewardDefinition → RewardService
   CURRENCY → world_wallet_credit_v1 (P0-A)      ITEM → world_inventory_grant_item_v1 (P0-B)
   EXP → private.world_exp_apply_v1 (P0-F0)
   → RewardTransaction + per-grant entries → result
```

Reward converts an already-verified result into value. It does not re-judge quest, event or minigame
eligibility, and it never writes Wallet or Inventory tables itself.

## RewardDefinition authority

The DB is the single canon: `private.world_reward_definitions` and `private.world_reward_grants`, seeded
by migrations. The orchestrator runs in the database next to the Wallet and Inventory RPCs, so it
reads definitions there. There is no code copy, so there's no second source that could drift. The
C0 item catalog keeps a code canon (P0-B) because clients render it; nothing outside the server
needs reward definitions yet.

A trigger validates every grant: the currency must exist, the item must be in the catalog, and the
quantity must fit the item's ownership policy (UNIQUE = 1). Grant entry ids and targets are unique
within a reward.

| rewardId | version | grants |
| --- | --- | --- |
| `reward.quest.first_campus` | 2 | ITEM `badge.main_gate` ×1 (Q01 `quest.tutorial.first_campus`, per Quest Q0–Q3 / Economy E0–E5), EXP `exp.campus` +100 |
| `reward.event.mcm_2026_main_clear` (event `event.mcm_2026`) | 2 | CURRENCY `currency.induck_coin` +80, ITEM `top.mcm_2026_survivor`, ITEM `furniture.mcm_2026_poster`, EXP `exp.campus` +150 |
| `reward.minigame.landlord_first_clear` (event `event.mcm_2026`) | 2 | ITEM `badge.mcm_2026_landlord` ×1, EXP `exp.campus` +50 |

The EXP grants and the version 1 → 2 bump come from Progression P1b
(`docs/world/PROGRESSION_CONTENT_P1B_EARLY_EXP.md`). A definition change bumps `version`: each
RewardTransaction records the version and snapshots the grants it was created with, so version 1
transactions keep replaying (and resuming) without the EXP entry.

P0-C itself does not own source verification. The MCM 2026 definitions are wired by P0-E after
server-verified completion; other source adapters (including the first-campus quest reward) remain
separate work.

Grant types: `CURRENCY`, `ITEM`, and `EXP` are executable. P0-F1 connects `EXP` to the P0-F0
Progression authority through `private.world_exp_apply_v1`; Reward never writes progression state
or the EXP ledger directly. `COLLECTION` remains reserved and receives `REWARD_UNSUPPORTED_GRANT`
because no Collection Book authority exists.

## Server contract (server-authoritative; client-noncallable)

> `[REDACTED: role EXECUTE privilege map — service boundary only]`
- `world_reward_get_result_v1(p_idempotency_key)`: stored result readback, or null.

The result is `{rewardTransactionId, rewardId, rewardVersion, userId, eventId, sourceType, sourceId,
idempotencyKey, status, replayed, attempts, createdAt, completedAt, entries[]}`. Each entry is
`{grantEntryId, grantType, targetId, requested, granted, status, reason, childIdempotencyKey,
childTransactionId, attempts}`.

Preflight refusals (nothing is written): `INVALID_IDEMPOTENCY_KEY`, `INVALID_SOURCE`,
`ACCOUNT_UNAVAILABLE`, `UNKNOWN_REWARD`, `REWARD_INACTIVE`, `REWARD_EMPTY`, `REWARD_UNSUPPORTED_GRANT`,
`IDEMPOTENCY_CONFLICT` (same key with a different user/reward/source).

## Status rules

- Entry: `GRANTED`; `SKIPPED` (reason `ALREADY_OWNED`: an already-owned UNIQUE item, never refunded
  in coins); `FAILED` (reason = the adapter error, for example `ITEM_UNAVAILABLE`).
- Transaction: any FAILED → `FAILED` (resumable); otherwise any SKIPPED → `PARTIAL_SUCCESS`;
  otherwise `SUCCESS`. SUCCESS and PARTIAL_SUCCESS are final (a trigger refuses updates), and
  so are GRANTED/SKIPPED entries.

## Idempotency and recovery

- **Parent:** `idempotency_key` is unique. Executions per account are serialized by an advisory lock,
  so concurrent retries wait and then replay (`replayed: true`) without moving value.
- **Child:** `reward/<parent key>/<grant_entry_id>` is passed to the Wallet and Inventory RPCs. It is
  derived from the stable grant entry id, not the position, so reordering a definition can't re-key a
  child.
- **Atomicity:** one attempt is one DB transaction, so a crash or kill rolls the whole attempt back,
  including the reward record. Each child grant runs in its own subtransaction: an adapter error
  undoes only that child, marks its entry FAILED, and lets the siblings commit. No cross-authority
  atomicity is claimed beyond that.
- **Resume:** retrying a FAILED reward with the same key reuses the same RewardTransaction and
  re-runs only the FAILED entries, from the grant snapshot recorded on the first attempt (not today's
  definition). Child idempotency means already-granted children are never repeated.
- **Readback:** each ITEM entry checks ownership after the grant. CURRENCY and EXP entries record the
  child ledger transaction id. EXP accepts both a fresh `SUCCESS` and the same child key's
  `ALREADY_PROCESSED` response as one granted child, so parent recovery cannot double-award EXP.

## Boundaries

No Data API role has any privilege on the reward tables. Players cannot run or read rewards
(a player-facing reward summary is a later step). Account deletion cascades reward records, just as
it does wallet and inventory rows.

Out of scope for this layer: additional source adapters, Shop/Purchase/prices, Reward Summary UI,
Collection Book, Event Token, Crafting, trading, dynamic or AI-generated rewards. P0-F1 EXP execution
is now implemented; choosing EXP amounts for individual production RewardDefinitions remains content
and balance work rather than an authority change.
