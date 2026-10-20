# INHA WORLD Economy P0-F1 · Reward EXP Adapter

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043320_world_reward_exp_adapter_p0f1`).

P0-F1 connects the existing P0-C Reward Orchestrator to the P0-F0 EXP / Level authority. It changes
the execution contract, not the balance table: no production RewardDefinition receives a new EXP
amount merely because this adapter exists.

## Authority flow

```
verified source
    ↓
world_reward_grant_v1
    ↓
RewardDefinition EXP grant
    ↓
RewardTransaction entry + stable child idempotency key
    ↓
private.world_exp_apply_v1
    ↓
P0-F0 append-only EXP ledger
    ↓
derived Level projection
```

Reward never writes `private.world_player_progression` or `private.world_exp_transactions` directly.

## Executable grant types

- `CURRENCY` → P0-A Wallet
- `ITEM` → P0-B Inventory
- `EXP` → P0-F0 Progression
- `COLLECTION` → still reserved; preflight returns `REWARD_UNSUPPORTED_GRANT`

The RewardTransaction snapshot now permits `EXP` entries, so retries resume from the original
definition snapshot exactly like the existing currency/item adapters.

## EXP child contract

For an EXP entry, Reward calls:

`private.world_exp_apply_v1(user, requested, 'reward', sourceId, childIdempotencyKey)`

The child key remains:

`reward/<parent idempotency key>/<grant entry id>`

The EXP ledger source id is:

`<rewardId>:<rewardTransactionId>:<grantEntryId>`

This preserves direct provenance from the EXP ledger back to the parent reward and the exact grant
entry that produced it.

A fresh child returns `SUCCESS`; a retry of the identical child key may return
`ALREADY_PROCESSED`. Both settle the Reward entry as `GRANTED` only after the adapter confirms the
amount and transaction identity. The entry stores the P0-F0 EXP transaction id in
`childTransactionId`.

## Failure and recovery

The adapter executes inside the same per-entry subtransaction used by P0-C.

- an EXP adapter error rolls back that child only;
- sibling grants may remain GRANTED;
- the parent RewardTransaction becomes FAILED and is resumable;
- retrying the same parent key re-runs only FAILED entries;
- P0-F0 child idempotency prevents a repeated EXP transfer.

P0-C's per-account advisory lock still serializes concurrent reward executions; P0-F0's progression
row lock independently protects the EXP projection from lost updates.

## Security

> `[REDACTED: GRANT/REVOKE EXECUTE matrix and SECURITY DEFINER hardening checklist]`

Authoritative writes are server-only. Player reads are own-uid scoped. Internal helpers are not part of the public client contract.
No new player-facing write surface is added. The public Reward RPC remains service-role only, the
internal Reward and EXP helpers remain unavailable to Data API roles, and clients never supply the
EXP amount.

## Verification

- `supabase/tests/database/70_world_reward_orchestrator.test.sql`
  - CURRENCY + EXP composite Reward
  - Reward entry → EXP transaction identity
  - P0-F0 ledger provenance
  - parent replay moves no EXP
  - COLLECTION remains unsupported
- `supabase/tests/integration/reward.integration.test.mjs`
  - eight concurrent retries of one CURRENCY + ITEM + EXP reward
  - one RewardTransaction
  - one wallet ledger row
  - one item grant
  - one EXP ledger row
  - one final progression increment

P0-F0's own pgTAP and progression integration suites remain the authority tests for threshold
derivation, ledger immutability, direct EXP idempotency, account isolation, and concurrent progression
writes.

## Deferred

- P0-F2 (Shop `required_level` → derived server Level) is now implemented separately; see
  `docs/world/ECONOMY_P0D_SHOP_PURCHASE.md` § Level gate (P0-F2). Reward-granted EXP raises the
  same derived Level the Shop reads.
- P0-F3a progression HUD is implemented (`docs/world/PROGRESSION_P0F3A_HUD.md`) and re-reads
  progression after an MCM reward claim; P0-F3b Student Center shop UI is implemented; the reward EXP
  detail line (`+N EXP` from the settled Reward entry) is implemented in Progression P1a
  (`docs/world/PROGRESSION_REWARD_FEEDBACK_P1A.md`)
- the first production EXP amounts are implemented in Progression P1b
  (`docs/world/PROGRESSION_CONTENT_P1B_EARLY_EXP.md`: first_campus 100, landlord first clear 50,
  MCM main clear 150); further quest / exploration / achievement EXP stays a follow-up that needs its
  own content/balance approval
- level-up rewards, Prestige, seasonal levels, EXP spending, boosters and caps
