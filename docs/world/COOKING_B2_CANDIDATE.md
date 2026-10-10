# Cooking B2 candidate

Draft implementation candidate only. No acquisition, Shop listing, Production migration, deployment or player activation is included.

## Delivered

- `furniture.cooking_station`: COMING_SOON, UNIQUE FURNITURE, floor-only 1.00 × 0.90 × 0.65 m, mirrored H2 validator and fallback renderer. Saved JSON remains `{id,itemId,surface,x,z,yaw}`.
- `consumable.grilled_carp`: COMING_SOON, gameplay CONSUMABLE, stack 20 candidate.
- `private.world_recipe_catalog`: semantic recipe, definition version, mutation type, required capability/item, status and server-owned Inventory plan.
- `recipe.carp_grill`: COMING_SOON; carp ×1 → grilled carp ×1; COOK / CRAFTING.
- `cook_my_world_recipe_v1(recipe_id,request_id)`: caller from `world_room_caller_v1`, stored permanent/non-banned account check, own saved room and actual station ownership, then Inventory mutation. No user, room, output, quantity or plan arguments.
- Append-only `world_recipe_receipts`: exact original response, recipe version and layout revision. Same actor/request replays this receipt even after recipe closure/rebalance or station recall. A different recipe on that request is rejected. The current account guard still applies. Account deletion cascades.
- Client/panel/feature: default closed, exact cost, single pending request, same-id transport retry, stale account/room/role protection, accessible focus/close/Escape and canonical Inventory refresh. A confirmed cooking receipt stays SUCCESS even when Inventory readback fails. Until canonical Inventory refresh explicitly returns READY, further cooking is locked and the panel offers only a read-only Inventory retry; it never auto-retries a cook. Historical receipt totals never replace current inventory. Retry identity is retained across panel close/reopen in the current runtime; it is not persisted across page reload. Reload does not auto-submit and must refresh canonical Inventory before a new user action.

## Activation boundary

`COOKING_AVAILABLE = false`. Shared B1 furniture registry remains COMING_SOON and requires explicit cook handler and availability injection. The migration keeps the server recipe COMING_SOON. Isolated tests may inject client availability and activate a synthetic/transaction-local server recipe; this is not player activation.

There is deliberately no food-use RPC or button, no pending meal state, no Life Cooking XP, and no effect on local Building 5 training. B3 still needs an authoritative Combat resolver and start-time effect consumer. Consuming food now would strand an item or falsely imply a working server combat effect.

## Locking and receipts

Cooking takes the per-account Inventory advisory lock, then its own room row, saved layout row and owned station row before calling Inventory. H2 save locks room then layout and only reads Inventory without a row/advisory lock, so it cannot wait for Cooking's Inventory lock. Exact replays return before the room locks. Inventory's existing preflight/transaction guarantees apply to insufficient input, unavailable outputs, full stacks and downstream grant failures. The receipt insert is in the same transaction, so an insert failure rolls back value movement too.

The server checks ownership and the saved station, not trusted interior proximity; distance is currently B1 presentation only. No client pose is treated as authority.

## Integration contract

Create `createCookingFeature({getClient,getUserId,getRoomState,inventory,onOpenChange})` once beside room UI. `getRoomState` must return the shared B1 saved-layout state, not editor drafts. Add `handlers.cook = cooking.handler` and OR the provider's explicit availability callback with `cooking.isAvailable(feature)`. Call `cooking.update()` when room, layout or account changes, and `cooking.reset()` when leaving/unbinding. Use `onOpenChange` to apply the existing modal input lock. Keep default availability; do not add URL, localStorage or player-controlled activation flags.

Runtime wiring is included in `main.js`, stacked on the life/housing candidate. Shared `roomFunctionAccountId` comes from explicit identity events and must agree with the online getter before B1 interaction. The wiring adds the modal input owner, shared B1 handler/availability callback, close-on-competing-focus, saved-layout/account/room updates and transition/pagehide reset. Duplicate identity events preserve the current request ID; actual identity changes clear it. Default availability stays false. The full gameplay loop is not complete.

When merging the renderer hunk, keep the trophy worker's separation: `setObjects` owns collision rebuilding; `setDisplays` only rebuilds presentation. The cooking branch only adds meshes.

## Verification and release gates

Included tests:
- Node client/UI/content/placement regression tests, including interrupted/repeated operations.
- `110_world_cooking_b2_candidate.test.sql`: real H2 placement, closed recipe, account guards, saved/owned station, replay and definition change, rollback on insufficient/overflow, append-only receipts and account cascade.
- `cooking.integration.test.mjs`: twelve independent same-request connections, last-input contention, concurrent H2 save/COOK and exact serial outcomes. Strict loopback DB guard; only synthetic catalog activation; canonical recipe remains closed.
- Updated 01 grant surface, 93 primitive/writer/reachability allowlists and Authority Map. Existing 94 compile/security-definer checks automatically cover new functions. Types include the new public command and private tables; generated type comparison still requires the DB.

Real PostgreSQL replay, pgTAP, multi-connection tests and generated-type comparison must pass on the disposable local stack before approval to apply this migration. They were not run in this task environment because psql, Docker and Supabase CLI are absent. Browser smoke source now covers seventeen candidate models; browser execution is not claimed because the existing Chromium socket restriction was not bypassed.

## Hosted candidate UI verification

`Cooking candidate browser QA` runs the real cooking feature, client and panel against an explicitly synthetic offline fixture at the exact PR head. It checks closed-default availability, native desktop/mobile clicks, immutable same-request receipt replay, read-only Inventory recovery, and stale room/account completions plus modal focus/close behavior. It records screenshots, served-source hashes and logs. The fixture has no live account or DB, is never imported by the app and does not activate production cooking. Execution results remain pending until observed in CI.
