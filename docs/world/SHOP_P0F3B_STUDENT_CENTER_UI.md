# INHA WORLD P0-F3b · Student Center Shop + Level-lock UI

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| P0-F3a Progression HUD | **IMPLEMENTED** (`docs/world/PROGRESSION_P0F3A_HUD.md`) |
| P0-F3b Student Center Shop + Level-lock UI | **IMPLEMENTED** (this document) |
| Student Center Shop wallet balance read | **IMPLEMENTED** (`docs/world/SHOP_WALLET_BALANCE_UI.md`) |
| Inventory read-only UI P0 | **IMPLEMENTED** (`docs/world/INVENTORY_UI_P0.md`) |
| Reward EXP detail toast | FOLLOW-UP |
| Other shops (`shop.dorm_furniture`, `shop.department_mcm`) | FOLLOW-UP |
| Student Center world entry (terrace front, F / context button) | **IMPLEMENTED** (`docs/world/SHOP_WORLD_ENTRY_P0.md`) |
| Shop NPC | FOLLOW-UP |

First player-facing shop: `shop.student_center`, opened from the ☰ HUD menu (`🛍 상점`). It uses the
P0-D Shop and P0-F2 Level gate RPCs as they are. No migration, no new RPC, no new Supabase client.

## Modules

| File | Responsibility |
| --- | --- |
| `apps/world/src/shop/shop-client.js` | `get_world_shop_v1('shop.student_center')` and `purchase_world_shop_listing_v1(listingId, key)` on `online.supabase`. Validates the documented shapes, tracks `SIGNED_OUT / LOADING / READY / UNAVAILABLE`, generation-guards reads and purchases. No DOM. |
| `apps/world/src/shop/shop-panel.js` | Presentation: `offerView`, `purchaseMessage`, `createShopPanel`. No RPC. |
| `apps/world/src/main.js` | Wiring: member client, `online.onIdentity` → `shop.setAccount`, menu button, modal input gate. |

## Authority

The server offer is the only source of the lock state:

- `purchasable === true` → `구매 가능`, buy button enabled.
- `purchasable === false` and `unavailableReason === "LEVEL_REQUIRED"` → locked card, `🔒 Lv.N 필요`,
  buy button disabled. `N` is the offer's `requiredLevel`, used as text only.
- Any other `unavailableReason` → `판매 예정` / `판매 종료` / `🔒 잠김` / `구매 불가`, disabled.

The client never compares `playerLevel` with `requiredLevel`; a contradictory snapshot is shown as
served. Item names and descriptions come from `apps/world/src/collection/item-catalog.js`
(presentation only); price, currency, required Level, purchasability, limits and listing status come
from the Shop RPC.

## Purchase

Every buy click calls `purchase_world_shop_listing_v1`; the server re-validates Level, funds,
ownership and limits. One purchase per listing is in flight at a time.

- **Idempotency:** each attempt uses `shop:<uuid>`. A server answer (success or refusal) retires the
  key; an unknown outcome (network failure) keeps it, so the retry replays instead of buying twice.
- **Success:** `구매 완료 · {상품명}` in the panel and via `showWorldStatus()`, then the shop is re-read.
- **Refusal:** mapped to short text. Refusals that mean the open snapshot is stale re-read the shop.

| Server code | Text | Re-read |
| --- | --- | --- |
| `LEVEL_REQUIRED` | `Lv.N이 필요해요` | yes |
| `INSUFFICIENT_FUNDS` | `인덕코인이 부족해요` | no |
| `ITEM_ALREADY_OWNED` | `이미 보유한 아이템이에요` | yes |
| `PURCHASE_LIMIT_REACHED` | `구매 한도에 도달했어요` | yes |
| `LISTING_*`, `SHOP_INACTIVE`, `ITEM_UNAVAILABLE`, `INVALID_LISTING` | `지금은 구매할 수 없어요` | yes |
| `PERMANENT_ACCOUNT_REQUIRED` | `로그인한 계정만 구매할 수 있어요` | no |
| `ACCOUNT_UNAVAILABLE` | `현재 이 계정으로는 상점을 이용할 수 없어요` | no |
| anything else | `구매하지 못했어요. 잠시 후 다시 시도해 주세요.` | no |

Raw server or transport messages are never shown.

## Accounts and stale responses

- Guests and signed-out players see `로그인한 INHAGAME 계정만 상점을 이용할 수 있어요.`; no Shop RPC is made.
- `setAccount` bumps a generation counter, drops the snapshot, pending purchases and unresolved keys.
- A read or purchase that returns after the account changed is discarded (a purchase resolves `STALE`
  and shows nothing, not even a success toast).
- Reads coalesce: one in flight plus at most one follow-up.

## Panel

`#shop-panel` is a modal (`role="dialog"`, `aria-modal`, z-index 70 so the fixed event chip cannot
cover it). While open, World movement and camera input are off and world actions are suspended; ×,
Escape or opening the full map closes it. The offer list scrolls inside the panel. Buy buttons are at
least 44px tall. The panel is hidden in the lobby shell.

While the ☰ menu is open the fixed 좀비대학교 event chip is hidden; before this it covered a menu row
(`키보드 조작` on desktop, `1인칭으로` at 360px) and swallowed its click.

## Verification

- `apps/world/tests/shop-client.test.mjs` (14) and `apps/world/tests/shop-panel.test.mjs` (15).
- `apps/world/qa.mjs`: menu entry, single modal target, lobby hiding, 44px buttons, z-index, member
  client reuse, event chip rule.
- Browser QA (local, real `/campus/` boot on WebGPU with a fake member session) at 1280×720 and
  360×740: open/close, locked and buyable offers, success, `INSUFFICIENT_FUNDS`, stale `LEVEL_REQUIRED`,
  scrolling, no horizontal overflow, every visible buy button hit-tested, World input off while open,
  P0-F3a progression HUD still shown, guest makes zero Shop RPCs.
