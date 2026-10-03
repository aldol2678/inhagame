# INHA WORLD Economy P0-A · Wallet + Transaction Ledger

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Design source: Notion `INHA WORLD · Economy E0–E5 상세설계 v0.1 [CURRENT DESIGN]` §2, §10.1, §11.2.
Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260928011408_world_wallet_ledger_p0a`).

## Model

- **Ledger = what happened.** `private.world_currency_transactions`, append-only (an UPDATE trigger
  raises `LEDGER_APPEND_ONLY`), one row per applied change, `idempotency_key` globally unique.
  `amount` is signed (credit > 0, debit < 0) and the row must satisfy
  `balance_after = balance_before + amount`.
- **Wallet = what the balance is now.** `private.world_wallets`, primary key `(user_id, currency_id)`,
  `balance bigint >= 0`, `version` = number of applied ledger rows. Created lazily on the first change.
- **Currency.** `private.world_currencies`; P0-A seeds only `currency.induck_coin` (표시명 인덕코인).
  The ID follows the Catalog `<category>.<name>` form used by the design (`badge.main_gate`,
  `material.campus_leaf`); the earlier candidate `currency.campus` predates the name decision.
- Types: `REWARD`, `REFUND` (credit only), `PURCHASE` (debit only), `ADMIN`, `ADJUSTMENT`
  (either direction, `reason` required).

## Server contract (server-authoritative; client-noncallable)

> `[REDACTED: role EXECUTE privilege map — service boundary only]`
| WalletService | RPC |
| --- | --- |
| `getBalance(userId, currencyId)` | `world_wallet_get_balance_v1(p_user, p_currency_id)` |
| `credit({...})` | `world_wallet_credit_v1(p_user, p_currency_id, p_amount, p_type, p_source_type, p_source_id, p_idempotency_key, p_reason?)` |
| `debit({...})` | `world_wallet_debit_v1(...same...)` |

Credit/debit return `{status, transactionId, userId, currencyId, type, amount, balanceBefore,
balanceAfter, sourceType, sourceId, idempotencyKey, createdAt}`, where `status` is `SUCCESS` or
`ALREADY_PROCESSED` (a replay of the same key returns the original transaction and moves no value).

Errors (exception message): `SERVER_ONLY`, `INVALID_AMOUNT`, `INVALID_TRANSACTION_TYPE`,
`INVALID_CURRENCY`, `INVALID_SOURCE`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_REASON`, `REASON_REQUIRED`,
`ACCOUNT_UNAVAILABLE` (guest, banned or unknown account), `INSUFFICIENT_FUNDS`, `IDEMPOTENCY_CONFLICT`
(same key, different user/currency/amount/type/source). A refused call changes neither table.

Every change runs in one transaction: lazy wallet insert → `SELECT … FOR UPDATE` on the wallet row →
idempotency check under that lock → balance check → ledger INSERT → wallet UPDATE.

## Player read

`get_my_world_wallet_v1()` (authenticated, permanent, non-banned; caller = `auth.uid()`):
`{"currencies":[{"id":"currency.induck_coin","balance":120}]}`. It never creates a wallet.

Player UI: the Student Center Shop header shows this read as served
(`apps/world/src/wallet/wallet-client.js`, `docs/world/SHOP_WALLET_BALANCE_UI.md`); the client never
computes a balance. A full wallet screen and transaction history are not implemented.

## Authority

> `[REDACTED: table/role privilege matrix]`

State tables live outside client Data API write reach. Mutations are server-authoritative; player reads use authenticated own-uid helpers where documented above. Account deletion cascades wallet and ledger rows.

## Tests

- `supabase/tests/database/68_world_wallet_ledger.test.sql`: credit/debit sequence, negative
  prevention, ledger rows, idempotency, validation, integrity, authority, player read.
- `supabase/tests/integration/wallet-ledger.integration.test.mjs`: parallel credits/debits on separate
  connections, concurrent same-key retries, cross-connection and cross-session readback, Data API
  client write/read refusal, account deletion.

Out of scope for P0-A: Inventory, Reward Orchestrator, Quest coin payout, Shop, prices, UI, Event
Token, Crafting, P2P/auction, premium currency, daily rewards, economy dashboard.
