# INHA WORLD · MCM 2026 P0-E · Live Reward Claim Wiring

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260928011435_world_mcm_2026_reward_claims_p0e`). This builds on
P0-E0 completion authority (`MCM_2026_COMPLETION_AUTHORITY_E0.md`), P0-C Reward, P0-A Wallet and
P0-B Inventory.

```
verified completion (P0-E0) → claim → P0-C Reward Orchestrator → Wallet / Inventory → final claim
```

P0-E0 still decides **whether** something is complete, and P0-E does not redefine that. P0-C decides
**what** is paid, and the claim code names only Reward IDs. The grant lists (80 coin, survivor top,
poster, landlord badge) live only in the P0-C RewardDefinitions.

## Claims

| claim | verified source (server only) | reward | P0-C source | stable key |
| --- | --- | --- | --- | --- |
| `MAIN_CLEAR` | `world_event_progress.completed_at` (stage COMPLETED) | `reward.event.mcm_2026_main_clear` | `EVENT` / `event.mcm_2026:main_clear` | `event:mcm_2026:<userId>:main_clear` |
| `LANDLORD_FIRST_CLEAR` | a `world_landlord_first_clears` row | `reward.minigame.landlord_first_clear` | `MINIGAME` / `event.mcm_2026:landlord_first_clear` | `minigame:landlord:<userId>:first_clear` |

The player API takes **no arguments** (claimant = `auth.uid()`, permanent accounts only):
- `claim_my_mcm_2026_main_reward_v1()`
- `claim_my_mcm_landlord_first_clear_reward_v1()`

The client cannot supply a user, completion, reward, amount, item, currency or quantity.
localStorage, `save_my_game_progress` JSON, URL flags and UI state are not evidence. A later
landlord run never re-opens the badge claim: eligibility is the first-clear row, not a run.

## Claim state: COMPLETED ≠ CLAIMED

`private.world_mcm_reward_claims` has one row per `(user_id, claim_type)`, with these columns:
- `event_id`, `reward_id`, `idempotency_key`
- `reward_transaction_id`, which references the P0-C RewardTransaction
- `reward_status`, which is `SUCCESS` or `PARTIAL_SUCCESS`
- `source_completed_at`, which records the completion it paid for
- `claimed_at`

The table holds only **final** claims. A trigger refuses every update (`CLAIM_FINAL`). Completion rows
are never touched. RLS is on and no Data API role has any privilege; account deletion cascades.

## Flow (one DB transaction)

1. Account check: `PERMANENT_ACCOUNT_REQUIRED` or `ACCOUNT_UNAVAILABLE` (guest, banned).
2. Per-account lock `world_mcm_claim:<userId>`.
3. A final claim already exists → `ALREADY_CLAIMED` (idempotent success, `replayed: true`). No reward
   runs.
4. Server completion read. If there is none, `CLAIM_NOT_ELIGIBLE`.
5. `private.world_reward_grant_v1` (the P0-C core) runs with the stable key.
> `[REDACTED: privileged role / EXECUTE detail]`
   - There is no role spoofing and no direct reward, wallet or inventory write.
6. The P0-C readback decides the outcome:
   - `SUCCESS` / `PARTIAL_SUCCESS` → insert the final claim → `CLAIMED`.
   - `FAILED` → `REWARD_FAILED`: no claim row. P0-C's resumable FAILED transaction and its granted
     siblings commit, and completion is untouched. Retrying resumes the same RewardTransaction.

**P0-C core delegation change.** Before this change, the P0-C core reached Wallet and Inventory
through `public.world_wallet_credit_v1`, `world_inventory_grant_item_v1` and
`world_inventory_has_item_v1`. Those wrappers admit only `auth.role() = server role (redacted)`, so every entry
FAILED with `SERVER_ONLY` when the core ran inside a player RPC.
- The wrappers are only a role gate, plus the wallet's amount > 0 and known-type checks, which every
  P0-C grant already meets (`amount >= 1` constraint, type `REWARD`). Behind them sit
  `private.world_wallet_apply_v1` and `private.world_inventory_grant_v1`.
- This migration redefines `private.world_reward_grant_v1` so it calls those cores directly and does
  the ownership readback in SQL. This is the P0-D pattern.
- The rest of the body is P0-C verbatim: idempotency, snapshot resume, per-entry subtransactions,
  readback and statuses.
- Service callers see identical behaviour, and the P0-C pgTAP and integration suites still pass.
> `[REDACTED: privileged role / EXECUTE detail]`

Player result: `{claimType, status: CLAIMED | ALREADY_CLAIMED | REWARD_FAILED, replayed, rewardId,
rewardStatus, rewardTransactionId, claimedAt, rewardResult{status, completedAt, entries[{grantType,
targetId, requested, granted, status, reason}]}}`.
- It has no user id, idempotency keys or child transaction ids.
- `replayed: true` means this call moved no value.

## Recovery

- **Response lost after commit:** the retry returns `ALREADY_CLAIMED` with the same transaction and
  `claimedAt`.
- **Reward committed, claim missing** (a server path ran the reward with the canonical key, or the
  claim row was lost):
  - The retry reaches P0-C with the same key, and P0-C replays its stored result.
  - The claim is finalized (`CLAIMED`, `replayed: true`), and no wallet or item mutation happens.
- **Crash mid-claim:** the whole transaction rolls back, and the retry claims once.
- **PARTIAL_SUCCESS** (for example the survivor top is already owned): +80 and the poster are granted,
  and the top is `SKIPPED / ALREADY_OWNED` with its earlier provenance untouched. This is a **final**
  claim and is never retried.

## After the event

The P0-E0 window gates **new** completions only (no new progress and no new runs after `ENDED`). A
completion earned while ACTIVE stays claimable, and recoverable, after the event ends. Claims do not
read the window. The reward kill switch is the P0-C RewardDefinition `status` (`REWARD_INACTIVE`).

Canon (Notion Economy E0–E5 §5 and §13, clarified 2026-09-27):
- After ENDED, no new Quest/Event completion, minigame run, reward eligibility or purchase is created.
- A server-verified completion or eligibility earned while ACTIVE can still be claimed after ENDED,
  and a failed claim can still be recovered. This is settlement/recovery of a right already earned,
  not new earning.
- RewardDefinition `DISABLED` is a separate operational kill switch.
- COMPLETED ≠ CLAIMED.

## Deferred

- Participation wristband: participation authority is undefined, and `start` is not participation.
- Repeat landlord coins: no RewardLimit or daily reset authority exists.
- EXP.
- Event token and event shop.
- A claim-state read for the UI.
- The event, minigame, NPC, room and HUD client (private #215 content).
