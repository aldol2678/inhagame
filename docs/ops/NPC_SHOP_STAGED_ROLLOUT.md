# NPC shop staged rollout candidate

Status: code/Draft review only. This document does not authorize deployment, database changes, account changes, or additional Production reads. Nothing here has been applied to Production. Each operational stage needs a separately approved target, exact SQL/change set, preflight, verification, and rollback plan.

## Public development lineage is not a Production runbook

The published public development migrations remain immutable:

- `20261011023000_world_shop_scoped_purchase_v2.sql` moves furniture **and** adds v2.
- `20261011023100_world_student_center_shop_split.sql` creates fashion, moves four existing listings, and binds the approved vendors.
- The new append-only `20261011040000_world_shop_capabilities_v1.sql` adds **only** the read-only capability RPC and permissions. It does not undo the earlier catalog changes.

A clean public disposable database therefore finishes in the split state. Do not run the public migration directory, `supabase db push`, or either combined candidate migration unchanged against Production to perform the API preparation stage. Production has its own lineage. The independent API-only and catalog-only changes below are operational SQL candidates to prepare and review separately, not instructions to execute now.

## Capability contract

`get_world_shop_capabilities_v1()` takes no arguments and returns exactly:

```json
{"version":1,"purchaseRpc":"purchase_world_shop_listing_v2","catalogLayout":"split"}
```

- `purchaseRpc` is v2 when that exact function exists and `authenticated` has EXECUTE, otherwise v1 when it is executable. Neither available raises `SHOP_API_UNAVAILABLE`.
- `catalogLayout` is `legacy` when all six durable student-center listings still belong to `shop.student_center`; `split` when the mug remains there, the four fashion listings belong to `shop.student_center_fashion`, and the poster belongs to `shop.dorm_furniture`; otherwise `mixed`. Missing listings are `mixed`.
- Availability, prices, level gates, purchase limits, item status and hidden-shop visibility remain controlled by the existing read/purchase authorities. Layout does not activate inventory. The capability is not a claim that the UI has shipped or that a player is near an NPC.
- The function is STABLE, SECURITY DEFINER with an empty search path, and restricted to authenticated permanent accounts in good standing. It does not provision player state or expose balances/receipts.

Client interpretation:

| Capability | Client behavior |
|---|---|
| RPC definitively absent | Old-API compatibility policy: retain original shop UI and v1. This is **not proof** that the catalog is physically legacy. |
| legacy + v1 | Original shop UI and v1 |
| legacy + v2 | Original catalog/UI route with scoped v2 available; API-prepared stage |
| split + v2 | Enable split routing after UI is prepared |
| split + v1, mixed, unknown/malformed response | Lock purchasing/split activation; do not pretend readiness |
| Network, timeout, auth, permission or server error | Fail closed/retry read; never silently downgrade to v1 |

The missing-function exception must specifically identify this RPC (PGRST202 with the exact public.get_world_shop_capabilities_v1() function named). Broad matching on an arbitrary 404 or any RPC error is unsafe. Capability cache must be account-scoped; refresh after relevant account or routing changes. This handshake is compatibility metadata, not an authorization token. Every purchase is still checked by the server.

## Independent operational stages

### 0. Legacy DB / existing application

Keep the existing shop/read/v1 behavior. No new shop/vendor, no stock move, no price/status/level change. The capability call being absent selects the documented old-API compatibility UI policy only.

### 1. API prepared, catalog untouched

Prepare a separately reviewed **API-only SQL candidate** containing:

1. The definition, REVOKE/GRANT and comment for `purchase_world_shop_listing_v2` from the published candidate, excluding its furniture-moving CTE entirely.
2. The definition, REVOKE/GRANT and comment for `get_world_shop_capabilities_v1` from the new append-only migration.
3. Explicit prerequisite checks for the existing v1, private authority helpers/tables and required ownership/permissions. Preserve v1's signature, grants and implementation.

No listing, shop, vendor, wallet, inventory or receipt writes belong in this candidate. Do not automatically replace an unexpected existing v2/capability definition: inspect its approved contract during a separately authorized preflight and reconcile before execution. PostgREST schema visibility must be verified before a UI rollout; a missing endpoint during schema-cache propagation is not catalog-readiness evidence.

Expected result on the intended unchanged catalog: `legacy + v2`. V1 callers continue to work. The stage requires explicit operational approval before any execution.

### 2. UI prepared, catalog untouched

Ship only an approved capability-aware UI candidate while the catalog remains legacy. Preserve the original combined shop access. Do not enable the new fashion route from function presence alone. The client may use v2 for fresh purchases only when the capability says so.

For every uncertain purchase, retain its original shop, RPC version and idempotency key across retries and capability refreshes. Resolve that original request before creating a key through another shop. Authentication/account-generation protection still applies. No buying attempt is a capability probe.

DB state cannot verify UI preparation. A separate approved UI/browser acceptance must establish reachability, account switching, network-failure behavior and old-receipt retry behavior before stock moves.

### 3. Catalog split after UI acceptance

Prepare a separately reviewed **catalog-only SQL candidate**. It must not redefine the purchase APIs. Its approved transaction should:

1. Verify expected pre-split binding, existing API grants, destination shop uniqueness and unchanged approved product metadata; capture an authorized rollback snapshot. Abort on partial/unexpected state rather than silently overwriting it.
2. Create the fashion shop using the existing student-center status, not a hard-coded activation.
3. Move only the approved four fashion listings and existing furniture listing while preserving durable listing IDs, item IDs, prices, quantities, requirements, time windows, purchase limits and status. Append the poster position to avoid the destination's `(shop_id, position)` unique constraint.
4. Set the approved souvenir/fashion vendor metadata and display names. Preserve the dorm vendor and all other shop fields.
5. Verify exact final bindings and `split + v2`; commit only when all checks pass. Purchase receipts, wallet ledgers, inventory grants/ownership and historical shop IDs must be unchanged.

The approved concrete routes are `INKYUNG-NPC-003` → `vendor.student_center_souvenir` → `shop.student_center` and `INKYUNG-NPC-012` → `vendor.student_center_fashion` → `shop.student_center_fashion`. The dorm route must already be reachable. No fishing/photo products, prices, activation, new vendor registry or spatial-access authorization are introduced by this rollout.

## Compatibility and rollback limits

- A legacy v1 request whose response was lost retains its original RPC/key. If the first request never reached the server, retrying after the split can execute that original purchase for the first time under v1. This is not a receipt-only read and does not add a shop-binding check that v1 never had. Price, level, ownership and shared idempotency checks still apply. Fresh split purchases use v2; a failed v2 purchase is never resent through v1.
- V1 remains callable and can still buy canonical listing IDs after relocation; its authoritative price/level/funds/ownership checks are preserved. **V1 does not check the caller's shop context.** Keeping it is deliberate old-caller compatibility, not a claim of universal shop isolation. Removing v1 requires a separate caller migration and approval.
- An old client reading only `shop.student_center` after catalog split sees only the retained mug. A legacy UI rollback alone cannot restore discoverability of fashion/furniture. Keep a capability-aware rollback UI ready; do not call this rollout fully backward-compatible merely because direct v1 purchase still works.
- API/UI preparation failure before catalog split: retain the unchanged catalog and known-working UI. Prefer leaving additive APIs installed; dropping APIs/grants can strand in-flight retries and requires a separately approved change.
- Partial catalog state: fail closed as `mixed`, investigate under approved read access, and either complete or reverse the authorized catalog transaction. Do not auto-repair Production from a capability response.
- After a committed split, catalog rollback is a separately approved compensating migration using the preflight snapshot. Restore only bindings, positions and relevant shop metadata after conflict checks. **Never rewrite or delete purchases, wallet rows, inventory grants or original receipt shop IDs.** Keep v2 available so retries against either historically recorded shop still resolve with their original key.
- If a move races with a new v2 purchase, the wrapper's listing `FOR SHARE` lock holds binding stable through v1's transaction. Historical replay is checked before current binding, under the same per-account advisory lock as v1.

## Disposable verification

No Production access is required for these tests:

- `99_world_shop_capabilities.test.sql`: split/legacy/mixed, absent/revoked v2, unavailable APIs, missing listing, auth boundaries, read-only state, and inactive stock.
- `99_world_shop_scoped_purchase.test.sql`: original-shop replay and mismatch rejection, authority/availability boundaries.
- `shop-migration-preservation.integration.test.mjs`: exact published migration SQL in one local transaction, real pre-move purchases, complete receipt/wallet/inventory snapshots, original-shop replay, and rollback.
- Client/browser tests must cover legacy absent capability, API-prepared legacy, full split, partial mixed, malformed/network/permission failures and RPC/key pinning across phase transitions.

Run via `scripts/public-db.sh` only against its disposable local stack. Successful CI proves the candidate against that fixture, not Production schema compatibility or approval to deploy.
