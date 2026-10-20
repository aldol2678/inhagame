# INHA WORLD · Appearance / Loadout Authority P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Migration: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043327_world_appearance_loadout_p0`).

| Item | Status |
| --- | --- |
| Inventory ownership authority (P0-B) | **IMPLEMENTED** (`docs/world/ECONOMY_P0B_INVENTORY_CATALOG.md`) |
| Inventory UI P0 | **IMPLEMENTED** (`docs/world/INVENTORY_UI_P0.md`) |
| Appearance / Loadout Authority P0 | **IMPLEMENTED** (this document) |
| Wardrobe UI P0 | **IMPLEMENTED** (`docs/world/WARDROBE_UI_P0.md`) — equip UI only, no avatar change |
| Local avatar projection | FOLLOW-UP |
| Multiplayer Appearance Projection | FOLLOW-UP |
| Starter auto-equip | FOLLOW-UP |
| Profile Badge Decoration | separate scope (BADGE is not an appearance slot) |

The server answer to "what does this account wear, per appearance slot?". This is the source of truth
the Appearance Projection (P0-B: "Multiplayer appearance is the Appearance Projection's job") will read;
it renders nothing and broadcasts nothing. Planned order: Authority → Wardrobe UI → local projection →
multiplayer projection.

## Slots

Exactly the C0 `APPEARANCE_SLOTS` (`apps/world/src/collection/item-catalog.js`):
`BODY FACE HAIR HEAD TOP BOTTOM SHOES BACK ACCESSORY`. BADGE (profile decoration), FURNITURE,
MEMORABILIA, EMOTE, MOUNT and MOUNT_COSMETIC are not appearance and can never be equipped here.

**Slot of an item.** The C0 canon (`validateCatalog`) requires a WEARABLE's `equipSlot` to be its id
prefix upper-cased (`head.induck_cap` → `HEAD`). The server derives the slot from the item id and the
category from the P0-B catalog mirror, so no item metadata is copied into this feature. The integration
test checks the code catalog still satisfies this rule for every WEARABLE.

## Storage

| Table | Content |
| --- | --- |
| `private.world_player_appearance_loadout` | `user_id`, `slot`, `item_id`, `updated_at`; PK `(user_id, slot)`. No Level, no metadata, no ownership copy. |
| `private.world_appearance_transactions` | Append-only change log: `transaction_id`, `idempotency_key` (unique), `user_id`, `action` (`EQUIP` / `UNEQUIP`), `slot`, `requested_item_id`, `previous_item_id`, `next_item_id`, `created_at`. |

Integrity:

- `slot` must be one of the nine slots and must equal the item id's prefix (CHECK), so no row can hold
  a cross-slot item.
- `(user_id, item_id)` references the P0-B ownership row `private.world_player_items` (`ON DELETE
  CASCADE`): an equipped item is always owned. P0-B has no path that removes ownership today; if one is
  added, the slot empties with it instead of dangling.
- No foreign key to the catalog (same as ownership): catalog drift never deletes a loadout.
- `user_id` cascades from `auth.users`: account deletion removes the loadout and the log.
> `[REDACTED: privileged role / EXECUTE detail]`

## Player RPCs (authenticated only; caller = `auth.uid()`)

### `get_my_world_appearance_loadout_v1()`

Read-only; never creates a row. Every slot key is always present:

```json
{"slots": {
  "BODY": null, "FACE": null, "HAIR": null,
  "HEAD": {"itemId": "head.induck_cap", "catalogStatus": "COMING_SOON", "equippedAt": "2026-09-28T…"},
  "TOP": null, "BOTTOM": null, "SHOES": null, "BACK": null, "ACCESSORY": null}}
```

`catalogStatus` is the item's current catalog status (`UNKNOWN_ITEM` if the catalog no longer has it).

### `equip_my_world_item_v1(p_slot text, p_item_id text, p_idempotency_key text)`

Checks, in order: permanent account → account not banned → key → slot → item id format → (account
lock) → idempotency → catalog entry exists → category `WEARABLE` → derived slot = `p_slot` → status
not `DISABLED` / `HIDDEN` → the caller owns the item → write. The client's word is never taken for
category, slot or ownership.

### `unequip_my_world_item_v1(p_slot text, p_idempotency_key text)`

Empties one slot. Ownership is untouched. Unequipping an empty slot is a successful no-op.

### Result (both writes)

```json
{"status": "SUCCESS", "replayed": false, "transactionId": "…", "action": "EQUIP", "slot": "HEAD",
 "previousItemId": "head.inha_cap", "itemId": "head.induck_cap", "changed": true, "createdAt": "…",
 "loadout": {"slots": {…}}}
```

`loadout` is the loadout at response time (on a replay: now, not at the original call). Equipping
what is already worn, or unequipping an empty slot, returns `changed: false`.

## Error codes (exception message)

| Code | SQLSTATE | When |
| --- | --- | --- |
| `PERMANENT_ACCOUNT_REQUIRED` | 42501 | no caller, or a guest (anonymous) session |
| `ACCOUNT_UNAVAILABLE` | 42501 | banned account or no profile |
| `INVALID_IDEMPOTENCY_KEY` | 22023 | key missing or not `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$` |
| `INVALID_APPEARANCE_SLOT` | 22023 | not one of the nine slots (includes `BADGE`) |
| `INVALID_ITEM_ID` | 22023 | item id missing or malformed |
| `UNKNOWN_ITEM` | 22023 | not in the catalog |
| `ITEM_NOT_EQUIPPABLE` | P0001 | category is not `WEARABLE` (badge, furniture, memorabilia, emote, mount, mount cosmetic) |
| `SLOT_MISMATCH` | P0001 | the item's slot is not `p_slot` |
| `ITEM_UNAVAILABLE` | P0001 | catalog status `DISABLED` or `HIDDEN` |
| `ITEM_NOT_OWNED` | P0001 | the caller does not own the item |
| `IDEMPOTENCY_CONFLICT` | 23505 | the key was used for a different request or by another account |

Refused calls write nothing and do not consume the key.

## Idempotency

Each accepted equip / unequip is one row in the change log keyed by `idempotency_key`. The same key
with the same caller, action, slot and (for equip) item replays the original transaction (`replayed:
true`, same `transactionId`, no second write). Any other reuse of the key, including by another
account, is `IDEMPOTENCY_CONFLICT`. Clients should use one key per user intent and reuse it only for
a retry after an unknown outcome.

## Concurrency

Every write takes `pg_advisory_xact_lock(hashtextextended('world_appearance:' || user_id, 0))` (the
P0-B / shop pattern) before the idempotency lookup, then row-locks the slot. Writes for one account are
serialized: two equips racing on one slot both succeed in some order, the later one's
`previousItemId` is the earlier one's item, and the final row is the later item. `created_at` is
`clock_timestamp()` at the write, so the log orders changes as they were applied. A same-key race
applies once and replays for the rest. Different accounts never block each other.

## Catalog status policy

Equip follows the same rule as a new grant (C0 `GRANT_BLOCKED_STATUSES`): **`DISABLED` and `HIDDEN`
cannot be equipped; `ACTIVE`, `COMING_SOON` and `LOCKED` can**, as long as the account owns the item.
An ACTIVE-only rule would contradict the canon: `COMING_SOON` means "its source is not live yet", and
items that players already bought (for example `head.induck_cap` from the Student Center shop) are
still `COMING_SOON` in the catalog. Ownership of such an item proves its source was live for that player.

An item that is already worn when its status later becomes `DISABLED` / `HIDDEN` is **not** removed
(no migration, no trigger). The read keeps the row and reports the current `catalogStatus`; the item can
be unequipped but not equipped again. Projections should treat `DISABLED` / `HIDDEN` / `UNKNOWN_ITEM`
slots as not shown. Removing such rows is a separate decision, not part of P0.

## Fresh and default state

No row = empty slot. A fresh account reads nine `null` slots. P0 does not auto-equip anything: the
default 인덕이 look stays the client/avatar default, and P0-B DEFAULT ownership (`head.inha_cap`,
`top.inha_basic`, `back.freshman_bag`) is not treated as worn. Starter auto-equip is a follow-up.

## Verification

- `supabase/tests/database/76_world_appearance_loadout.test.sql` (pgTAP): schema and FKs, RLS and grants,
  fresh read, read provisions nothing, HEAD / TOP equip, replace, no-op, unequip, ownership unchanged,
  unowned / unknown / malformed / slot mismatch / BADGE / furniture / memorabilia / emote / mount /
  mount cosmetic / invalid slots, DISABLED / HIDDEN refused and LOCKED allowed, worn-then-disabled
  kept, idempotent replay and conflicts (item, slot, action, other account), refused calls not logged,
  guest / signed-out / banned, account isolation, direct table / helper access and forged ownership
  refused, table invariants, append-only log, account deletion cascade.
- `supabase/tests/integration/appearance-loadout.integration.test.mjs` (local Supabase, Data API with
  minted JWTs): C0 canon vs server slot rule, cross-session readback, two simultaneous equips on one
  slot (5 rounds; consistent chain), same-key concurrent retries (8 parallel → 1 applied, 7 replays),
  four slots changed concurrently, `auth.uid()` actor (no user argument, no cross-account change, no
  Data API table access, anon refused).
- `supabase/tests/database/01_grants_contract.test.sql`: the three RPCs added to the signed-in surface.

## Not in scope

Wardrobe UI, inventory equip buttons, avatar rendering, local or multiplayer projection, Realtime
payloads, profile badge decoration, lobby character summary, starter auto-equip, item catalog changes,
ownership / grant policy, Shop, Wallet, Reward, EXP / Level.
