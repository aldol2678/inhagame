# INHA WORLD · Student Center Shop wallet balance (read-only UI follow-up)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| P0-F3a Progression HUD | **IMPLEMENTED** (`docs/world/PROGRESSION_P0F3A_HUD.md`) |
| P0-F3b Student Center Shop | **IMPLEMENTED** (`docs/world/SHOP_P0F3B_STUDENT_CENTER_UI.md`) |
| Student Center Shop wallet balance read | **IMPLEMENTED** (this document) |
| Reward EXP detail toast | FOLLOW-UP |
| Inventory read-only UI P0 | **IMPLEMENTED** (`docs/world/INVENTORY_UI_P0.md`) |
| Student Center world entry | **IMPLEMENTED** (`docs/world/SHOP_WORLD_ENTRY_P0.md`) |
| Other shops / Shop NPC | FOLLOW-UP |

This is a UI follow-up to P0-F3b, not a new economy phase. The Student Center Shop header shows the
player's own 인덕코인 balance from the existing P0-A player read `get_my_world_wallet_v1()`
(`docs/world/ECONOMY_P0A_WALLET_LEDGER.md` § Player read). No migration, no new RPC, no new Supabase
client, and no change to the Wallet, Shop or Reward authority.

## Modules

| File | Responsibility |
| --- | --- |
| `apps/world/src/wallet/wallet-client.js` | Read-model: calls `get_my_world_wallet_v1()` only on `online.supabase`, validates `{currencies:[{id,balance}]}` (`parseWalletSnapshot`, `walletBalance`), tracks `SIGNED_OUT / LOADING / READY / UNAVAILABLE`. No DOM, no Shop logic; reusable by later UI. |
| `apps/world/src/shop/shop-panel.js` | `walletLine()` and the header line `.shop-panel-wallet`. The optional `wallet` option is the read-model; the panel never calls a wallet RPC. |
| `apps/world/src/main.js` | Wiring only: identity, shop panel, MCM reward, `pageshow`. |

`shop-client.js` is unchanged and carries no wallet logic.

## Authority

The balance shown is only what `get_my_world_wallet_v1()` returned. The client never subtracts a price,
adds a reward, reads a balance from the purchase response, stores a balance locally or shows an
optimistic value. A missing wallet row is the server's `0`, shown as `🪙 인덕코인 0`. Only
`currency.induck_coin` is shown; other currencies in the read are ignored. A malformed read (any bad
entry, duplicate id, negative or non-integer balance) is rejected as a whole.

| Wallet state | Header line |
| --- | --- |
| `SIGNED_OUT` (guest, signed out) | hidden; no wallet RPC |
| `LOADING` | `🪙 인덕코인 …` |
| `READY` | `🪙 인덕코인 1,234` (thousands separators) |
| `UNAVAILABLE`, or no 인덕코인 entry | `잔액을 불러오지 못했어요` (the raw server message is never shown) |

Shop and wallet availability are independent: a wallet failure leaves the offer list and the buy
buttons as the Shop RPC served them, and the server still decides funds on purchase.

## Refresh (no polling)

| Trigger | Wiring |
| --- | --- |
| Permanent identity, sign-in, account switch, sign-out | `online.onIdentity` → `wallet.setAccount(identity ? online.userId : null)` |
| Shop panel opened | `shopPanel.setOpen(true)` → `wallet.refresh("open")` |
| Purchase `SUCCESS` or `INSUFFICIENT_FUNDS` | panel → `wallet.refresh("purchase")` (the Shop client re-reads the shop as before) |
| MCM 2026 reward claim finished | MCM `onReward` → `progression.refresh("reward")` (unchanged) + `wallet.refresh("reward")`; Reward code unchanged |
| Page restored from back/forward cache | `pageshow` with `persisted` → progression + wallet refresh |

During a re-read the last server balance stays on screen until the new server answer arrives; it is
never replaced by a computed value. A balance update rewrites only the header line, so the offer list
and its scroll position are untouched.

## Stale responses

Same as P0-F3a / P0-F3b: every account change bumps a generation counter and drops the snapshot at
once; a read that returns for an older generation or account is discarded; refreshes coalesce to one in
flight plus one follow-up.

## Verification

- `apps/world/tests/wallet-client.test.mjs`: 0 / 120 / 1,234, malformed reads, unknown currencies,
  signed-out and guest (0 RPCs), account switch, stale responses, coalescing, no computed balance,
  `main.js` wiring (member client, identity, reward, resume).
- `apps/world/tests/shop-panel.test.mjs`: header line states, purchase success re-reads shop and wallet
  and never shows `old - price`, `INSUFFICIENT_FUNDS` re-read, wallet failure does not block the shop,
  header-only update, guest, account switch; the P0-F3b tests unchanged.
- `apps/world/qa.mjs`: member-client reuse, hidden line, shrinkable header.
- Browser QA (local, real `/campus/` boot on WebGPU with a fake member session) at 1280×720 and 360×740:
  0 coins, 1,234, purchase success shows the server's re-read balance, `INSUFFICIENT_FUNDS`, wallet RPC
  error with the shop still usable, guest (0 wallet/shop RPCs), no header or page overflow at 360px, list
  scroll and every visible buy button hit-tested; P0-F3a and P0-F3b browser QA re-run.

## Not in scope

Wallet screen, ledger / transaction history, Inventory and Collection UI, other currencies, other
shops, Shop NPC, DB migrations, Wallet / Shop / Reward authority changes.
