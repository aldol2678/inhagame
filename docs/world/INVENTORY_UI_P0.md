# INHA WORLD · Inventory UI P0 (read-only owned items)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| P0-F3a Progression HUD | **IMPLEMENTED** (`docs/world/PROGRESSION_P0F3A_HUD.md`) |
| P0-F3b Student Center Shop | **IMPLEMENTED** (`docs/world/SHOP_P0F3B_STUDENT_CENTER_UI.md`) |
| Shop Wallet balance read | **IMPLEMENTED** (`docs/world/SHOP_WALLET_BALANCE_UI.md`) |
| Student Center World Entry | **IMPLEMENTED** (`docs/world/SHOP_WORLD_ENTRY_P0.md`) |
| Inventory read-only UI P0 | **IMPLEMENTED** (this document) |
| Inventory category tabs V1 | **IMPLEMENTED** (전체 / 장비 / 소비 / 재료 / 생활 / 기타) |
| Inventory ownership authority | unchanged, P0-B (`docs/world/ECONOMY_P0B_INVENTORY_CATALOG.md`) |
| Appearance / Loadout Authority P0 (server) | **IMPLEMENTED** (`docs/world/APPEARANCE_LOADOUT_AUTHORITY_P0.md`) |
| Wardrobe UI P0 (equip / unequip) | **IMPLEMENTED** (`docs/world/WARDROBE_UI_P0.md`) |
| Local / multiplayer appearance projection | FOLLOW-UP |
| Furniture placement | FOLLOW-UP |
| Collection Book | FOLLOW-UP |
| Dorm Furniture Shop | FOLLOW-UP |
| Department MCM Shop | FOLLOW-UP |
| Reward EXP detail toast | FOLLOW-UP |

The player can see the items their account owns: ☰ → `🎒 인벤토리` opens a read-only panel on the
existing P0-B player read `get_my_world_inventory_v1()`. No migration, no new RPC, no new Supabase
client, no catalog change, and no write path of any kind (no equip, use, discard, trade or placement).

## Modules

| File | Responsibility |
| --- | --- |
| `apps/world/src/inventory/inventory-client.js` | Calls `get_my_world_inventory_v1()` only, on `online.supabase`. Validates the documented shape, keeps the server order, tracks `SIGNED_OUT / LOADING / READY / UNAVAILABLE`, generation-guards reads, coalesces refreshes. No DOM. |
| `apps/world/src/inventory/inventory-panel.js` | `itemView`, `summaryText`, `createInventoryPanel`: joins server rows with catalog presentation and renders the modal. No RPC. |
| `apps/world/src/main.js` | Wiring: member client, identity, menu button, modal input gate, refresh triggers. |
| `apps/world/src/shop/shop-panel.js` | New `onPurchase` callback (after a `SUCCESS` purchase) so the inventory can re-read. |

## Authority: server ownership vs local presentation

- **Ownership** (whether, how many, since when, from where, catalog status) is only the server row:
  `itemId`, `quantity`, `acquiredAt`, `updatedAt`, `sourceType`, `sourceRef`, `eventId`, `catalogStatus`.
- **Presentation** (name, description, category, rarity) comes from `getItemDefinition(itemId)` in
  `apps/world/src/collection/item-catalog.js`.
- A local catalog miss never removes ownership. The row is shown with its `itemId` as the name,
  `아이템 정보를 불러올 수 없어요` as the description and the `정보 없음` (`UNKNOWN_ITEM`) chip.
- The server `catalogStatus` is shown as a small chip (`잠김`, `준비 중`, `사용 중지`, `숨김`, `정보 없음`);
  non-ACTIVE items are dimmed but always listed.
- A malformed row or a duplicate `itemId` rejects the whole read (`UNAVAILABLE`) rather than showing a
  partial or doubled inventory. `sourceRef` and other internal ids are never shown.
- Summary `보유 아이템 N종` counts distinct items, not the quantity sum.

Card: name · `보유 N` · description · `착용 아이템 · 일반` · `획득 · 상점` (+ status chip). `sourceType`
labels: 상점, 이벤트, 퀘스트, 탐험, 업적, 미니게임, 기본 지급, INHAGAME 보상, 지급; anything else `기타`.

## Category tabs V1

The read-only panel now adds a local presentation registry above the existing Collection catalog. It does
**not** change ownership, the server read model, DB catalog mirror, grant rules, prices or item semantic
categories. The compact visible tabs are `전체 / 장비 / 소비 / 재료 / 생활 / 기타`.

- Existing semantic catalog categories are mapped by item purpose: `WEARABLE → 장비`, `MATERIAL → 재료`,
  `FURNITURE → 기타(HOUSING)`, `MOUNT / MOUNT_COSMETIC → 기타(PET_MOUNT)`; badges, emotes and
  memorabilia currently fall back to `기타(MISC)`.
- Acquisition source is deliberately not a category signal. A fish obtained through a life activity remains
  `MATERIAL`; event furniture remains `HOUSING`.
- Unknown owned items are never hidden. A catalog miss maps to `MISC → 기타` and keeps the existing
  `UNKNOWN_ITEM` presentation.
- Filtering is local-only and preserves the server order inside every tab. No RPC is added when a tab changes.
- The registry already reserves `CONSUMABLE / LIFE / QUEST / EVENT` purpose categories for future item types,
  while `HOUSING / PET_MOUNT / QUEST / EVENT / MISC` are grouped into the compact `기타` tab for V1.

## Refresh (no polling)

| Trigger | Wiring |
| --- | --- |
| Permanent identity, sign-in, account switch, sign-out | `online.onIdentity` → `inventory.setAccount(identity ? online.userId : null)` |
| Panel opened | `inventoryPanel.setOpen(true)` → `inventory.refresh("open")` |
| Student Center purchase `SUCCESS` | shop panel `onPurchase` → `inventory.refresh("purchase")` (shop and wallet re-reads unchanged) |
| MCM reward claim finished | MCM `onReward` → progression + wallet (unchanged) + `inventory.refresh("reward")`; Reward code unchanged |
| Page restored from back/forward cache | `pageshow` with `persisted` → progression + wallet + inventory |

Neither the purchase response nor the reward result is read for ownership; the list only changes when
the inventory RPC answers.

## Accounts and stale responses

Same as P0-F3a / shop / wallet: every account change bumps a generation counter and drops the snapshot
at once (an open panel switches to loading or the login message immediately); a read that returns for
an older generation or account is discarded; refreshes coalesce to one in flight plus one follow-up.
Guests and signed-out players see `로그인한 INHAGAME 계정만 인벤토리를 볼 수 있어요.` and make no RPC.

## Panel

`#inventory-panel` reuses the shop modal shell (`.shop-panel`: z-index 70, flex column, scrolling body)
and adds text-only cards. While open, World movement and camera input are off and world actions (the
F / context slot) are suspended. ×, Escape, the full map and room transitions close it. The shop and
the inventory are one-at-a-time: opening either closes the other. Close button 44 × 44 px; ☰ menu
entries keep a 44 px height on touch devices (they were 42 px before). Hidden in the lobby shell.

## Verification

- `apps/world/tests/inventory-client.test.mjs` (11) and `apps/world/tests/inventory-panel.test.mjs` (13):
  empty / one / many (server order), quantity, catalog join, unknown items, `UNKNOWN_ITEM` and non-ACTIVE
  statuses kept, signed-out and guest (0 RPCs), account switch, stale responses, malformed and duplicate
  rows, purchase → one re-read and no optimistic item, refused purchase → no re-read, inventory failure
  does not block shop / wallet, `main.js` reward / resume / identity wiring.
- `apps/world/tests/inventory-category-tabs.test.mjs`: purpose mapping, fish/material precedence over life
  acquisition tags, compact six-tab contract, local filtering, server-order preservation, empty-category state,
  and unknown-owned-item retention under `기타`.
- `apps/world/qa.mjs`: menu entry, single panel, member client, single read RPC, purchase / reward wiring.
- Browser QA (local, real `/campus/` boot on WebGPU with a fake member session) at 1280×720 and 360×740:
  ☰ → 🎒 인벤토리, empty state, 8 items (unknown and non-ACTIVE included), scroll, no horizontal
  overflow, header clear of ×, 44 px close; World input off while open and restored by × / Escape;
  Student Center purchase → wallet 1,234 → 1,054 and inventory re-read with the new item first;
  shop ↔ inventory ↔ full map one at a time; MCM minigame clear → real reward claim → inventory re-read
  with the new item; account switch while open renders no previous-account item; inventory RPC failure
  leaves shop, wallet and progression working; guest shows the login message with zero inventory RPCs.
  P0-F3a, P0-F3b, wallet and world-entry browser QA re-run.

## Not in scope

Equip, wardrobe, loadout, furniture placement, use, discard, trade, gift, sell, crafting, sort / search /
rarity filters, Collection Book, inventory DB changes, starter item policy.
