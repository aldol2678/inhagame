# NPC Shop Routing Candidate

Local implementation candidate based on `03f4aafaedc4c3168a963a84d7a4a285f9f85985`.
Prepared for Draft PR review and exact-head CI. No production migration, product activation,
merge or deployment is included.

## Catalog routing

| Region | Department | Authoritative shop ID | Existing listings |
| --- | --- | --- | --- |
| 학생회관 | 기념품 | `shop.student_center` | Campus mug |
| 학생회관 | 패션 | `shop.student_center_fashion` | Cap, sneakers, hoodie, backpack |
| 생활관 | 가구 | `shop.dorm_furniture` | Existing five furniture offers plus campus map poster |
| 인경호 | 낚시 | None; planned | None invented |
| 정석권역 | 사진 | None; planned | None invented |
| 문콘경 학과 거점 | 학과 굿즈 | `shop.department_mcm` | Existing MCM jacket |

`shop.room_finishes` and its LOCKED offers remain separate and unchanged. No listing ID,
item ID, currency, price, quantity, level, purchase limit, timing or status is changed.
Poster position is appended to the dorm list to respect the unique shop/position constraint.
The fashion shop inherits the original shop's status, rather than promoting inactive stock.
Historical listing ID prefixes remain unchanged intentionally.

`shop-routes.js` is a routing contract, not a sale authority. READY means a catalog-backed
route exists in this candidate; it does not imply a backend spatial authorization policy.
Fishing/photo have no shop ID and cannot instantiate a purchase client.

## Direct shop access

- INKYUNG-NPC-003 나수현 → `vendor.student_center_souvenir` → `shop.student_center`.
- INKYUNG-NPC-012 가지안 → `vendor.student_center_fashion` → `shop.student_center_fashion`.
- The two existing shop-worker avatars are assigned to distinct Student Center interior
  counters. This is a new assignment, not a claim that their previous outdoor schedules
  already represented these stores. Their old movement, two-person social script and
  outdoor conversation/observation participation are suppressed; no avatar is cloned and
  no quest NPC is repurposed. Nameplates identify each department and hide across floors.
- Existing HUD and exterior entry shortcuts guide to the Student Center, not remote
  purchases. NPC interaction opens only the assigned shop; there are no cross-shop tabs.
- Dorm furniture opens at the existing first-dorm lobby reception counter via F/mobile
  interaction. No student is turned into a merchant and no dorm vendor identity is invented.
- The MCM catalog route remains available in the contract, but its dedicated vendor/entry
  remains unassigned. Fishing/photo are planned only. Do not call all five NPC shops done.
- Exact NPC-to-vendor-to-shop binding is required; a `shop_worker` role alone grants no
  route. Server v2 checks shop/listing binding and economics, not physical proximity.

NPC access rechecks real avatar readiness, body clearance, distance, floor and live input
state. Dorm access checks room, grounded state, counter approach and account availability.
An open panel closes on invalid location, room/realm transition, lobby entry, mount or combat.
Main production enables existing NPCs automatically; localhost/preview QA needs the existing
NPC opt-in such as `?npcTest=a-r1`.

## Transaction and UI isolation

- Each shop owns a client with independent read generation, pending operations and uncertain
  keys; every account switch clears all clients, including hidden shops.
- `purchase_world_shop_listing_v2(shop, listing, key)` validates authentication, key, account
  and listing/shop binding on the server, then calls the existing atomic v1 authority.
- The v2 wrapper shares v1's account advisory lock and holds the listing FOR SHARE through
  debit/grant, preventing a concurrent listing move from racing the binding check.
- A completed receipt is replayed only for its original user/listing/shop. Moving a listing
  does not rewrite a purchase, wallet transaction or inventory grant. Legacy v1 remains
  callable; it still enforces canonical listing/shop availability and all economic rules.
- An uncertain response retains its original shop/key even when another shop now lists the
  same item. Global pending checks prevent a fresh key from bypassing that retry. If the
  original shop no longer displays the listing, a recovery control remains available.
- Successful purchases refresh Wallet, Inventory and Loadout. Furniture ownership and room
  permissions are still read back before the existing room-editor handoff.
- A late purchase still refreshes authorities but cannot replace a newer NPC/shop's title,
  hint or focus. Close/reopen retains confirmed furniture receipts; account changes erase them.
- Current retry state is in memory, as before. This work does not promise reload-persistent
  recovery or implement a durable phone-order ledger.

## Rollout prerequisites and order

1. Validate the appended migrations against a disposable local Supabase database, including
   grants, authority allowlists, legacy v1 regressions and v2 replay/relocation tests.
2. Visually verify the two indoor NPC counters and dorm reception entry in a working
   browser, including mobile, camera/nameplate occlusion and input return. The dorm route
   must ship with the poster relocation, and fashion access with the student-center split.
3. Coordinate schema/client release: v2 must exist before a client using scoped purchases
   goes live. Do not expose category routes against an older database that lacks the split.
4. Obtain separate approval for production migration, publication and deployment. Verify
   production catalog, statuses and permissions at that time; they were not inspected here.

## Future smartphone Delivery (design only)

Direct World Shop remains location + vendor conversation + immediate receipt. Phone
`delivery` is a separate app, shown only when implemented, with discovered delivery-capable
shops. It shares Shop Listing prices and eligibility, adding only server-calculated delivery
cost. Existing adopted P0 design is one shop + one listing + quantity one per order; Student
Center pickup costs zero and room delivery costs 20 coins, with no minimum order. Room
furniture uses room delivery as a default, not an invented blanket restriction.

Orders would progress ORDERED → PREPARING → DELIVERING → DELIVERED/FAILED with idempotent
payment, order creation, inventory settlement/readback and reconnect recovery. Timing remains
candidate policy (pickup 15–30 seconds, room 45–75 seconds) with server `readyAt`. Per-product
delivery eligibility is not finalized. No delivery fees, timers, order service, placeholder
Home icon, cancellation/refund UI, random stock, live delivery NPC, current-position shipping
or multi-item cart is implemented by this candidate.

## Validation boundary

Node geometry/interaction tests cover both counter approaches and return paths using the
actual Student Center walking/collision model, wrong-floor/shelf blocking, retained callbacks,
account switching, cross-shop lost-response recovery and dorm furniture inventory/handoff.
Final local verification: all 4,129 World tests passed, `apps/world/qa.mjs` passed,
18 migration-lint self-tests passed, migration lint against HEAD and schema-contract lint
passed for 46 migrations, syntax checks and `git diff --check` passed. Independent read-only
review found no remaining major issue. The repository-wide Public CI script was not run to
completion; these results are specifically the World suite and the stated static checks.

Actual SQL execution is unverified in this environment: Supabase CLI, Docker and psql are
absent. Chromium smoke execution was attempted but aborts with local `socket()` EPERM before
loading the fixture, including the approved retry outside the shell sandbox. Therefore there
is no browser pixel/mobile gameplay pass and no production-state verification. Run these
checks in a supported local/CI environment before publication or release.

## Draft CI gates

`npc-shop-routing-browser.yml` checks the exact PR head with read-only repository permission:
synthetic-RPC routing/receipt races at desktop/mobile sizes, existing furniture readback/handoff,
and actual offline full-campus vendor avatars, changed rendered pixels and signed-out interaction
gates. Initial player placements are fixtures; this is not an authenticated real-backend purchase
or a walking acceptance claim. Public local checks independently run the disposable Supabase
suite, including `shop-migration-preservation.integration.test.mjs`, which executes these exact
migration files inside a rolled-back transaction around real synthetic-account purchases and
compares complete historical economy records. CI results must be read separately before release.
