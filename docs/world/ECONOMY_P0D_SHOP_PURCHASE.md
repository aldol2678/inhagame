# INHA WORLD Economy P0-D · Shop Purchase Vertical Slice

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

> **P1-C B4 TRANSFORM (public-safe):** Privilege maps, role GRANT/REVOKE matrices, and server-only EXECUTE details are redacted. Product model and player-facing reads remain.

Design sources (Notion CURRENT DESIGN): `Economy E0–E5 상세설계 v0.1` §3, §10.2, §11.1, §12;
`Collection / Economy / Quest Framework v0.1` §6. Migrations: `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043312_world_shop_purchase_p0d`)
(P0-D) and `supabase/migrations/20261001213132_public_baseline.sql` (private `20260929043323_world_shop_level_gate_p0f2`) (P0-F2 Level gate).
Builds on P0-A Wallet, P0-B Inventory (docs alongside). P0-C Reward is **not** used: a purchase pays value,
a reward gives it.

`ItemDefinition ≠ ShopListing ≠ Wallet ≠ Ownership ≠ PurchaseTransaction`

## Shop authority

The DB is the single canon: `private.world_shops` and `private.world_shop_listings`, seeded by migrations.
The purchase runs in the database next to the Wallet and Inventory write paths, so there is no code
copy. **Prices live only on listings**, and the item catalog has no price. A trigger checks that each
listing sells a real catalog item in a quantity its policy allows. Currency and shop are foreign keys.

Shop status: `ACTIVE / DISABLED (visible, sells nothing) / HIDDEN (not found)`.
Listing status: `ACTIVE / LOCKED (visible, not purchasable) / DISABLED / HIDDEN`.

| shop | listing | item | price | level | status |
| --- | --- | --- | --- | --- | --- |
| `shop.student_center` 학생회관 굿즈샵 | `offer.student_center.campus_mug` | `memorabilia.campus_mug` | 120 | – | ACTIVE, no level gate |
| | `offer.student_center.induck_cap` | `head.induck_cap` | 180 | 1 | ACTIVE, Lv gate |
| | `offer.student_center.campus_sneakers` | `shoes.campus_sneakers` | 240 | 2 | ACTIVE, Lv gate |
| | `offer.student_center.campus_map_poster` | `furniture.campus_map_poster` | 250 | 2 | ACTIVE, Lv gate |
| | `offer.student_center.induck_hoodie` | `top.induck_hoodie` | 320 | 2 | ACTIVE, Lv gate |
| | `offer.student_center.induck_backpack` | `back.induck_backpack` | 420 | 3 | ACTIVE, Lv gate |
| `shop.dorm_furniture` 생활관 가구점 | `offer.dorm_furniture.induck_cushion` | `furniture.induck_cushion` | 220 | 1 | ACTIVE, Lv gate |
| | `offer.dorm_furniture.dorm_desk_lamp` | `furniture.dorm_desk_lamp` | 280 | 2 | ACTIVE, Lv gate |
| | `offer.dorm_furniture.campus_rug_blue` | `furniture.campus_rug_blue` | 360 | 3 | ACTIVE, Lv gate |
| | `offer.dorm_furniture.induck_chair` | `furniture.induck_chair` | 420 | 3 | ACTIVE, Lv gate |
| | `offer.dorm_furniture.mini_induck` | `furniture.mini_induck` | 650 | 5 | ACTIVE, Lv gate |
| `shop.department_mcm` 문콘경 학과 상점 | `offer.department_mcm.mcm_jacket` | `top.mcm_jacket` | 480 | 4 | ACTIVE, Lv gate |

## Level gate (P0-F2)

Level = Eligibility, Coin = Cost. `required_level` holds the canonical levels from Economy E0–E5
§10.2.1 (mug none; Lv.1 cap/cushion; Lv.2 sneakers/poster/lamp/hoodie; Lv.3 rug/backpack/chair;
Lv.4 과잠; Lv.5 mini figure). P0-F2 replaced the P0-D placeholder `LEVEL_AUTHORITY_UNAVAILABLE` with
a real comparison against the buyer's **server-derived** Level:

```
P0-F0 total EXP (private.world_player_progression, 0 if no row yet)
    ↓ private.world_level_for_exp_v1 over immutable private.world_level_thresholds
buyer Level (private.world_player_level_v1, computed per call)
    ↓
required_level is null or Level >= required_level  → allowed
otherwise                                          → LEVEL_REQUIRED
```

- The shop stores, caches and copies no Level; there is no Level column anywhere. Neither RPC takes a
  level argument and JWT claims (`level`, `app_metadata`, `user_metadata`) are never consulted.
- **Read:** `get_world_shop_v1` derives the caller's Level once and evaluates every offer against it.
  An offer above that Level reads `purchasable: false, unavailableReason: 'LEVEL_REQUIRED'`, with its
  `requiredLevel` alongside. The response also carries an additive, server-derived `playerLevel`, so a
  UI can render "Lv.N 필요" without inferring anything. The read never provisions a progression row.
- **Purchase:** `purchase_world_shop_listing_v1` re-derives the Level at purchase time, in the
  preflight, under the per-account lock and before the debit or the grant. It never trusts the read.
  A refusal raises `LEVEL_REQUIRED` and rolls back like every other refusal: no wallet ledger row,
  no ownership, no grant log, no purchase row, and the idempotency key stays unused (the same key
  succeeds after the Level is reached).
- Refusal order is unchanged from P0-D: listing status → time window → **Level** → catalog item
  availability → purchase limit → UNIQUE ownership → funds. A Lv.1 buyer with too few coins for a Lv.2
  listing therefore sees `LEVEL_REQUIRED`, not `INSUFFICIENT_FUNDS`.
- Idempotency replay stays ahead of the gate: a completed purchase always replays.
- EXP is positive-only in P0-F0, so a Level never drops between the check and the commit; a purchase
  racing a level-up either sees the old Level (`LEVEL_REQUIRED`, nothing moved) or the new one.
- `LOCKED` remains in the status model for visible-but-unsold listings; no canonical listing uses it.

## Contract

- Player read `get_world_shop_v1(p_shop_id)` (permanent accounts) returns `{shopId, displayName,
  status, playerLevel, offers[]}` (`playerLevel` added by P0-F2). Each offer is `{listingId, itemId,
  currencyId, price, quantity, requiredLevel, purchaseLimit, startAt, endAt, status, purchasable,
  unavailableReason}`; `purchasable` reflects the listing and the caller's Level, not the wallet or
  ownership. HIDDEN and DISABLED listings are omitted, a HIDDEN shop is `SHOP_NOT_FOUND`, and no
  purchase counts are exposed.
- Purchase `purchase_world_shop_listing_v1(p_listing_id, p_idempotency_key)`. The buyer is
  `auth.uid()`; price, item, currency and quantity come from the listing. Success returns
  `{status: SUCCESS, replayed, purchaseId, shopId, listingId, idempotencyKey,
  item{itemId, quantity, grantId, acquiredAt}, wallet{currencyId, price, balanceBefore, balanceAfter,
  transactionId}, createdAt}`, all read from the final server state.
- Refusals (the exception message is the stable code): `PERMANENT_ACCOUNT_REQUIRED`,
  `ACCOUNT_UNAVAILABLE`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_CONFLICT`, `INVALID_LISTING`
  (unknown, hidden, or in a hidden shop), `SHOP_INACTIVE`, `LISTING_INACTIVE`, `LISTING_LOCKED`,
  `LISTING_NOT_STARTED`, `LISTING_EXPIRED` (server time), `LEVEL_REQUIRED` (P0-F2; replaced
  `LEVEL_AUTHORITY_UNAVAILABLE`, which is no longer raised),
  `ITEM_UNAVAILABLE`, `PURCHASE_LIMIT_REACHED`, `ITEM_ALREADY_OWNED`, `INSUFFICIENT_FUNDS`.

## Atomicity

One call is one DB transaction:

1. Per-account advisory lock.
2. Idempotency lookup.
3. Preflight: every structural refusal, the server-derived Level gate (P0-F2) and the UNIQUE
   ownership check, before any value moves.
4. Debit through `private.world_wallet_apply_v1` (P0-A core: row lock, balance, ledger).
5. Grant through `private.world_inventory_grant_v1` (P0-B core: lock, ownership, grant log).
6. In-transaction readback of ownership and balance.
7. Insert the `COMPLETED` purchase row.

Any refusal or failure at any step, including a grant failure after the debit, rolls everything back,
so failed purchases leave no row, no ledger entry and no ownership.

Why the cores are called directly: the public `world_wallet_debit_v1` and
> `[REDACTED: privileged role / EXECUTE detail]`
player. So it calls the same cores those wrappers delegate to, instead of spoofing a server role.
No shop code writes wallet or ownership tables.

## Idempotency and concurrency

- **Parent:** the purchase `idempotency_key` is unique. A same-key retry replays the stored purchase
  (`replayed: true`) without moving value. The same key used for a different listing or account is
  refused with `IDEMPOTENCY_CONFLICT`.
- **Children:** `purchase/<key>/wallet` and `purchase/<key>/item`, passed to the P0-A and P0-B cores.
- The per-account lock serializes purchases. Concurrent same-key retries converge on one purchase;
  different keys racing for one UNIQUE item produce one winner, and the rest get `ITEM_ALREADY_OWNED`
  without being charged. Different items bought from one wallet chain their debits with no lost update.
- `purchase_limit` (nullable) is counted per account and listing under the same lock. UNIQUE items are
  limited by ownership itself.

## Verification

- `supabase/tests/database/71_world_shop_purchase.test.sql`: definitions, read, purchase, refusals,
  idempotency, rollback, and the P0-F2 gate across every canonical listing from Lv.1 to Lv.5 (refusals
  move nothing, a refused key later succeeds, forged JWT level claims and a client level argument are
  refused, account isolation).
- `supabase/tests/integration/shop.integration.test.mjs`: the same through PostgREST, plus concurrency
  (a level-up racing purchases) and forgery attempts on progression and listings.

Player UI: P0-F3b implements the Student Center shop panel on this contract
(`docs/world/SHOP_P0F3B_STUDENT_CENTER_UI.md`), also opened in the World in front of 학생회관
(`docs/world/SHOP_WORLD_ENTRY_P0.md`); the other two shops and a Shop NPC are follow-ups. P0-F1 (Reward → EXP,
implemented) is the gameplay source of EXP; this gate reads the derived Level however EXP was granted
and never writes EXP itself.

Out of scope: Shop/NPC UI, event shops and tokens, refunds/resale,
trading/gifts, premium or real money, random boxes, dynamic/AI pricing.
