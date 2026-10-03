# INHA WORLD Economy P0-F0 · EXP / Level Progression Authority

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043316_world_progression_exp_level_p0f0`).

P0-F0 adds the server authority for account progression. Its consumers today:

| Phase | Consumer | Status |
| --- | --- | --- |
| P0-F1 | Reward → EXP adapter: P0-C `EXP` grants write through this authority | **IMPLEMENTED** |
| P0-F2 | Shop Level gate: P0-D `required_level` is checked against the Level derived here | **IMPLEMENTED** |
| P0-F3a | World progression HUD + level-up toast, read-only via `get_my_world_progression_v1` | **IMPLEMENTED** |
| P0-F3b | Student Center Shop panel + Level-lock UI (`get_world_shop_v1` / `purchase_world_shop_listing_v1`) | **IMPLEMENTED** |
| P0-F3b UI follow-up | Student Center Shop wallet balance, read-only via `get_my_world_wallet_v1` (`docs/world/SHOP_WALLET_BALANCE_UI.md`) | **IMPLEMENTED** |
| P0-F3 follow-up | Reward EXP detail toast ("+N EXP") | FOLLOW-UP |
| P0-F3b UI follow-up | Student Center shop world entry in front of 학생회관 (`docs/world/SHOP_WORLD_ENTRY_P0.md`) | **IMPLEMENTED** |
| Economy UI | Inventory read-only UI P0 via `get_my_world_inventory_v1` (`docs/world/INVENTORY_UI_P0.md`) | **IMPLEMENTED** |
| P0-F3 follow-up | Other shops, Shop NPC | FOLLOW-UP |

P0-F1 writes EXP through `private.world_exp_apply_v1`; P0-F2 only reads the derived Level and never
writes EXP. Details are under [Follow-up phases](#follow-up-phases).

## Authority model

```
verified source
    ↓
server EXP grant
    ↓
append-only EXP ledger
    ↓
total EXP projection
    ↓
server-derived Level
```

**EXP is stored authority. Level is derived.** There is no mutable player `level` column and the
client never supplies EXP, Level or a level-up flag.

Fresh permanent accounts read as `0 EXP / Lv.1` without creating a projection row. The row is
created lazily on the first successful EXP grant.

## Level curve v1

| Level | Minimum total EXP |
| ---: | ---: |
| 1 | 0 |
| 2 | 100 |
| 3 | 300 |
| 4 | 600 |
| 5 | 1,000 |
| 6 | 1,500 |
| 7 | 2,100 |
| 8 | 2,800 |
| 9 | 3,600 |
| 10 | 4,500 |

The DB table `private.world_level_thresholds` is the single canon. Existing rows cannot be updated
or deleted. A later migration may append only the next sequential level with a strictly higher EXP
threshold. EXP above the highest currently defined threshold is retained, so adding a future level
can immediately promote an account without rewriting its history.

## Storage

### `private.world_player_progression`

Current projection only:

- `user_id` primary key, cascades with account deletion.
- `total_exp bigint >= 0`.
- `version` counts applied EXP transactions.
- no stored Level.

### `private.world_exp_transactions`

Append-only grant ledger:

- positive `amount` only;
- `exp_after = exp_before + amount`;
- historical `level_before / level_after`;
- server source type/id;
- globally unique `idempotency_key`.

Ledger updates raise `LEDGER_APPEND_ONLY`.

## Write contract

Internal authority:

`private.world_exp_apply_v1(user, amount, sourceType, sourceId, idempotencyKey)`

One grant is one database transaction:

1. validate amount/source/key/account;
2. lazily create the projection;
3. `SELECT ... FOR UPDATE` the account progression row;
4. resolve idempotency under that lock;
5. derive before/after Level from the canonical thresholds;
6. insert one ledger row;
7. update total EXP and version.

This is the same lost-update prevention shape used by the Wallet authority. A same-key replay returns
the original transaction as `ALREADY_PROCESSED`; reuse with different parameters is
`IDEMPOTENCY_CONFLICT`.

> `[REDACTED: privileged role / EXECUTE detail]`

`world_exp_grant_v1(user, amount, sourceType, sourceId, idempotencyKey)`

Result:

```json
{
  "status": "SUCCESS",
  "transactionId": "...",
  "userId": "...",
  "amount": 100,
  "expBefore": 240,
  "expAfter": 340,
  "levelBefore": 2,
  "levelAfter": 3,
  "leveledUp": true,
  "sourceType": "reward",
  "sourceId": "...",
  "idempotencyKey": "...",
  "createdAt": "..."
}
```

## Reads

Server-only:

`world_progression_get_v1(user)`

Player:

`get_my_world_progression_v1()`

The player function has no user argument and derives the caller from `auth.uid()`. Guests and banned
accounts are refused.

Example player result:

```json
{
  "totalExp": 340,
  "level": 3,
  "currentLevelStartExp": 300,
  "nextLevelExp": 600,
  "progressExp": 40,
  "progressRequired": 300,
  "maxDefinedLevel": 10,
  "isMaxLevel": false
}
```

At the highest defined Level, `nextLevelExp` and `progressRequired` are null while overflow EXP
remains stored.

## Security

> `[REDACTED: GRANT/REVOKE EXECUTE matrix and SECURITY DEFINER hardening checklist]`

Authoritative writes are server-only. Player reads are own-uid scoped. Internal helpers are not part of the public client contract.
- all three state tables are in `private`, RLS-enabled, and have no Data API table privileges;
> `[REDACTED: privileged role / EXECUTE detail]`

## Stable errors

- `PERMANENT_ACCOUNT_REQUIRED`
- `ACCOUNT_UNAVAILABLE`
- `INVALID_AMOUNT`
- `INVALID_SOURCE`
- `INVALID_IDEMPOTENCY_KEY`
- `IDEMPOTENCY_CONFLICT`
- `PROGRESSION_CONFIG_INVALID`
- `PROGRESSION_CONFIG_IMMUTABLE`
- `LEDGER_APPEND_ONLY`

## Verification

- `supabase/tests/database/75_world_progression_exp_level.test.sql`: schema, permissions, threshold
  boundaries, progression read/write, idempotency, ledger/config immutability, account isolation and
  deletion.
- `supabase/tests/integration/progression.integration.test.mjs`: real multi-connection races,
  concurrent same-key retries, cross-session PostgREST readback and client forgery attempts.

## Follow-up phases

### P0-F1 — implemented
Migration `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043320_world_reward_exp_adapter_p0f1`). P0-C Reward now
executes `grant_type = EXP` by delegating to `private.world_exp_apply_v1` with the Reward child
idempotency key. Reward records the EXP ledger transaction id and parent retries do not double-award
EXP. `COLLECTION` remains unsupported. See `docs/world/ECONOMY_P0F1_REWARD_EXP_ADAPTER.md`.

### P0-F2 — implemented
Migration `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043323_world_shop_level_gate_p0f2`). P0-D Shop compares
`required_level` to the Level derived here (`private.world_player_level_v1` → total EXP →
`private.world_level_for_exp_v1`) on every read and again at purchase time, and refuses with
`LEVEL_REQUIRED` before any value moves. `LEVEL_AUTHORITY_UNAVAILABLE` is gone. The Shop stores no
Level and reads no client Level; this authority stays the only source. Contract and verification:
`docs/world/ECONOMY_P0D_SHOP_PURCHASE.md` § Level gate (P0-F2).

### P0-F3a — implemented
World HUD shows the player's own progression, read-only, from `get_my_world_progression_v1()` on the
signed-in member client. See `docs/world/PROGRESSION_P0F3A_HUD.md`. The client never derives a Level
or keeps a threshold table; a short `LEVEL UP · Lv.N` status line appears only when the same
account's server Level rises between two reads.

### P0-F3b — implemented
Student Center Shop panel (☰ → 🛍 상점) with the Level lock rendered from the server offer only
(`purchasable` / `unavailableReason`; `requiredLevel` and `playerLevel` are display text). Purchases go
through `purchase_world_shop_listing_v1`, which re-validates the Level. See
`docs/world/SHOP_P0F3B_STUDENT_CENTER_UI.md`.

### P0-F3 follow-ups — not implemented
- Reward EXP detail toast ("+N EXP" per reward).
- Other shops (`shop.dorm_furniture`, `shop.department_mcm`) and a Shop NPC. (The Student Center world
  entry is implemented: `docs/world/SHOP_WORLD_ENTRY_P0.md`.)
- Inventory UI.

The Student Center Shop header shows the 인덕코인 balance from the P0-A player read (UI follow-up of
P0-F3b, implemented; `docs/world/SHOP_WALLET_BALANCE_UI.md`). It is not part of this authority.

Out of scope: Level-up rewards, Prestige, seasonal levels, EXP spending, boosters, daily caps,
client-written progression and retroactive threshold rewrites.
