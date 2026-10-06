# Main3 first-style: guide → Student Center visit (M3.2)

Scope: local implementation candidate on public main `d82bb69502239aedb8ee2ad718d0736a995c4926`.
Design scope verified against the current Main3 first-style specification on 2026-10-05.

## Behavior

- The existing back-gate guide offers **굿즈샵 가보기** after Main2 is complete and Main3's server status is available.
- Start calls the existing quest HTTP endpoint with `campus_first_style_v1 / start`. It never buys an item.
- The same Quest Registry, journal and single tracked HUD display Main3. Main3 availability is never inferred from the local Main2 snapshot.
- Stage 1 points to the canonical Student Center shop entry. Entering that existing world interaction (F or the shared mobile button) calls `visit_student_center`.
- Walking nearby and opening the menu shop do not count as world-entry evidence.
- The service-role-only RPC advances only an eligible account's stage 1 → 2. It requires a nonbanned profile, a permanent auth account, and persisted Main2 stage 9.
- The client changes stage only after a validated server response. Duplicate events are safe; reload reads the stored stage; account changes invalidate pending requests and reset the HUD together.
- Shop opens independently of quest availability. A quest failure produces a retry message without blocking Shop.
- Pending status/start/visit requests are serialized within the account generation. A completion-triggered refresh reads again after an older status request. A valid entry during retry backoff attempts status recovery.
- Guide dismissal/reopening invalidates an older CTA result. Account switches close the guide.

## Deliberate stopping point

This slice ends at stage 2. Purchase-derived and Loadout-derived sync, Reward settlement, and Main4 discovery are not implemented here. Stage 2 guide copy says that purchase/equip verification is pending and that already purchased items need not be bought again. No `sync`, `purchase_done`, or `equip_done` event is accepted. The registry has no speculative reward reference. No price, coin, EXP, level, inventory, or loadout calculation is duplicated.

The existing Quest trust boundary is retained: a visit is a client-observed interaction; the server validates eligibility and order, not the player's physical position. This is not authoritative world-position evidence.

## Deployment prerequisites

The repository's current Cloud Run composition is `npc-ai-cloud-run.mjs` → `createQuestCloudHandler` → `createSupabaseQuestStore` → `advance_world_first_style_quest_v1`. Handler and Store import the shared Main3 event allowlist. Before this change, that allowlist and RPC accepted only `status` and `start`.

The new append-only migration is `20261005052900_world_quest_main3_shop_visit_m32.sql`; function signature remains `(uuid,text)`, so generated database types do not change. Both the new SQL function body and the server event contract must be present before the frontend can persist a visit. A frontend-only deployment is insufficient.

No operational database or deployed Cloud Run state was changed or claimed verified. Repository migrations target disposable local databases under CONTRIBUTING.md; this file does not authorize applying them to Production. PostgreSQL replay/pgTAP and actual browser acceptance remain release gates.

## Checks

- New Node tests were observed failing before their corresponding implementation changes, then passing
- Client tests cover server-only stage updates, single-flight actions, locked/guest/disabled users, response loss/readback, stale-account results, malformed results/rewards, status/entry overlap, completion-refresh races, and server-unavailable HUD gating
- Contract tests cover all ordered transitions, Local Store account isolation, Supabase RPC routing, HTTP event validation, duplicate/out-of-order requests, and rejection of later-stage client assertions
- New pgTAP tests cover permanent-account/role guards, ordered persistence, duplicate visits, isolation, and untouched reward/economy/inventory/loadout state; execution requires disposable Supabase tooling
- Existing Main1/Main2 tests remain unchanged in behavior; exact-source integration expectations now include the third client
- `node apps/world/tests/browser/main3-guide-null-smoke.mjs` uses real PlayCanvas 2.22.4 and the real guide runtime for close/reopen/stale response/Escape checks. It uses NullGraphicsDevice and is not rendered browser evidence
- `.github/workflows/main3-shop-visit.yml` checks out the immutable PR head with read-only permissions. Separate jobs retain source SHA/tree receipts, run disposable database replay against the immutable PR base, and capture browser evidence without deployment or live accounts.
- `node apps/world/tests/browser/main3-campus-smoke.mjs` is GitHub-hosted-only full-campus acceptance at desktop and touch portrait sizes. Synthetic identity/RPC and player placement fixtures are explicit; the real guide, shared HUD, shop entry, input owners and renderer run unchanged. It checks actual F/touch actions, menu nonvisit, held-response authority, reload and settled account switching. Screenshots still require independent pixel review.
- `node apps/world/tests/browser/main3-shop-visit-smoke.mjs` is a narrow browser fixture using actual client/HUD/guide components and the local HTTP handler/store, with PC F and mobile button cases, menu nonvisit, reload and logout. It blocks off-origin requests. `MAIN3_BROWSER_PATH` can select an already installed Chromium. It is not a full-campus 3D test

## Smallest remaining acceptance

1. Replay migrations and run `bash scripts/public-db.sh` in a disposable Supabase environment
2. Run the component browser fixture at desktop 1280×720 and mobile 390×844; require stage0 → CTA → stage1 → canonical entry → stage2, refresh recovery and sign-out hiding
3. On an authorized nonproduction full-campus environment with matching backend, verify the existing guide is reachable, the journal's canonical Student Center route, shared F/touch entry and input ownership, close/reopen, reload, and account switch
4. Keep stage2 incomplete; do not claim purchase/equip/reward completion until their server-authority slices ship
