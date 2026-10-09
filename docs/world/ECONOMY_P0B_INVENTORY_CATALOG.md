# INHA WORLD Economy/Collection P0-B · Inventory + Item Catalog

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Design sources (Notion CURRENT DESIGN): `Collection C0–C2 상세설계 v0.1` §1–2, §10–12,
`Inventory UI v0.1` §8, §15–16, `Economy E0–E5 상세설계 v0.1` §11.
Code catalog: `apps/world/src/collection/item-catalog.js`.
Base migration: `supabase/migrations/20261001213132_public_baseline.sql`.
Life M1 compatibility extension: `supabase/migrations/20261002131000_world_material_catalog_m1.sql`.
Housing F0 catalog extension: `supabase/migrations/20261009142600_world_personal_room_f0_furniture.sql`.

`Catalog ≠ Ownership ≠ Inventory View ≠ Loadout ≠ Room Placement`. P0-B closes Catalog + Ownership only.

## C0 Catalog (code canon)

36 items: the 6 VS01 pilot fixtures (kept unchanged) + the Starter Catalog 20 + seven Housing F0
furniture identities + three Life M1 `MATERIAL` fixtures. IDs are lowercase `<category>.<name>`; the prefix must match the category (and,
for wearables, the equip slot). The 33 collection/cosmetic items remain `cosmeticOnly` + `UNIQUE`. Life M1 materials are gameplay items (`cosmeticOnly: false`) with `STACKABLE`, `maxStack: 99`
and `ACCOUNT_BOUND`; prices still belong to Shop Listings. Furniture carries a placement `subtype`
(`WALL_DECOR / FLOOR_DECOR / CHAIR / LIGHT / DECOR`) but no position. `validateCatalog()` enforces the
C0 rules; `describeOwnedItem()` turns a catalog miss into an `UNKNOWN_ITEM` placeholder instead of
dropping it.

Statuses: the three DEFAULT pilots and the three Life M1 material fixtures are `ACTIVE`; legacy
non-default collection items remain `COMING_SOON` until their source goes live. New grants are refused
only for `DISABLED` / `HIDDEN`. Life M1 also extends acquisition/grant source vocabulary with
`ACTIVITY / CRAFTING / EQUIPMENT / RESEARCH`.

**DB mirror.** The design keeps C0 as a static code catalog. A server-authoritative grant still has
to know whether an item exists, its ownership policy and its status, so the DB holds only that
subset: `private.world_item_catalog(item_id, category, ownership_policy, max_stack, status)`. The
integration test fails if it differs from the code catalog. Changing an item's status or adding an
item therefore needs a code change and a migration.

## C1 Ownership (server DB authority)

- `private.world_player_items`: `UNIQUE(user_id, item_id)`, `quantity >= 1`, first-acquisition
  provenance (`source_type`, `source_ref`, `event_id`, `grant_id`, `acquisition_metadata`,
  `acquired_at`, `updated_at`). There is deliberately no foreign key to the catalog, so a catalog miss or
  status change can never delete ownership.
- `private.world_item_grants`: append-only log, one row per accepted grant key (`grant_id` = the
  idempotency key), with `result`, `quantity_before/granted/after` and the source.
- Every grant runs under a per-account advisory lock: idempotency lookup → catalog/policy check →
  grant log INSERT → ownership INSERT (or STACKABLE top-up).

## Server contract (server-authoritative; client-noncallable)

> `[REDACTED: role EXECUTE privilege map — service boundary only]`
| InventoryService | RPC |
| --- | --- |
| `grantItem({userId,itemId,quantity,source,idempotencyKey})` | `world_inventory_grant_item_v1(p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_idempotency_key, p_event_id?, p_metadata?)` |
| `listOwnedItems(userId)` | `world_inventory_list_v1(p_user)` |
| `getOwnedItem(userId,itemId)` | `world_inventory_get_item_v1(p_user, p_item_id)` |
| `hasItem(userId,itemId)` | `world_inventory_has_item_v1(p_user, p_item_id)` |
| `ensureDefaultItems(userId)` | `world_inventory_ensure_default_items_v1(p_user)` (`head.inha_cap`, `top.inha_basic`, `back.freshman_bag`; key `default:<item>:<user>`) |

A grant returns `{status, originalStatus, grantId, userId, itemId, quantityBefore, quantityGranted,
quantityAfter, sourceType, sourceRef, eventId, grantedAt, acquiredAt}`. `status` is one of:
- `GRANTED`
- `ALREADY_OWNED`: a UNIQUE item that is already owned. Nothing changes, and there is no coin refund.
- `ALREADY_PROCESSED`: a replay of the same key, which returns the original result.

Sources: `DEFAULT QUEST EXPLORATION ACHIEVEMENT EVENT MINIGAME SHOP INHAGAME_REWARD SYSTEM ADMIN`.

Errors: `SERVER_ONLY`, `INVALID_ITEM_ID`, `INVALID_QUANTITY` (UNIQUE ≠ 1), `INVALID_SOURCE`,
`INVALID_EVENT_ID`, `INVALID_METADATA`, `INVALID_IDEMPOTENCY_KEY`, `ACCOUNT_UNAVAILABLE`
(guest, banned or unknown account), `UNKNOWN_ITEM`, `ITEM_UNAVAILABLE` (DISABLED/HIDDEN),
`MAX_STACK_EXCEEDED`, `IDEMPOTENCY_CONFLICT`.

## Player read

`get_my_world_inventory_v1()` returns the rows owned by the caller's permanent, non-banned account
(caller = `auth.uid()`), most recent first:
`{"items":[{"itemId","quantity","acquiredAt","updatedAt","sourceType","sourceRef","eventId","catalogStatus"}]}`.
`catalogStatus` is the catalog status, or `UNKNOWN_ITEM` when the catalog no longer has the item. The
grant id and server metadata are not exposed. Multiplayer appearance is the Appearance Projection's
job, not the Inventory's. What an account currently wears is the Appearance / Loadout Authority
(`docs/world/APPEARANCE_LOADOUT_AUTHORITY_P0.md`), which references these ownership rows and never
changes them; the projection itself is a follow-up.

Player UI: the read-only Inventory panel (☰ → 🎒 인벤토리) shows this read as served, including items
the local catalog cannot describe (`docs/world/INVENTORY_UI_P0.md`). Ownership stays in this authority.

## Boundaries

- No Data API role has any privilege on the three tables. Only the server grants.
- Guests get no ownership. Account deletion cascades ownership and the grant log.
- Not in P0-B: Wallet changes, coin + item orchestration (P0-C), Shop/prices/purchase (P0-D),
  Room Placement, Wardrobe/Loadout (loadout authority: `APPEARANCE_LOADOUT_AUTHORITY_P0.md`), the Inventory UI, Human Avatar starter items, mount ownership,
  Material/Crafting, trading/gifts.
