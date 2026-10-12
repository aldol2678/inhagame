# First living furniture acquisition candidate

Status: Draft PR #354, original independent base `af532a53c433479e12354f88a5a1c234075de5e7`.
The validation branch incorporates current main `07ad0db0255164feff1f9125a46dbdf6f18f9f25`
without changing its MENU-01 Phone integration.
The user subsequently approved remote validation, sale of exactly books 120 / sofa 480 coins
at Lv1, and a dedicated room-local shopkeeper. The Public migration remains LOCKED staging;
the separately guarded operation in `docs/ops/sql/20261012_starter_furniture_open.sql` is the
only proposed live stock write. As of this revision no Production write/merge/deploy has run.
Exact-head remote browser and full DB acceptance are required before that operation.

## Two existing items, one existing acquisition path

- `furniture.study_books_set` / Study Books Set: five books and one notebook, placed together on the fixed desk.
- `furniture.dorm_single_sofa` / 생활관 1인 소파: floor placement, existing room-local sitting interaction.

The seven-item F0 migration `20261009142600_world_personal_room_f0_furniture.sql` already supplied
identity, ownership policy and placement. It did not supply an acquisition listing or price.
This candidate adds exactly two **LOCKED** rows to the existing `shop.dorm_furniture` catalog.
The other five F0 items remain unchanged and have no new acquisition route. No new currency,
paid payment, free grant, plant-growing function or furniture/inventory engine is introduced.

### Approved two-item sale values; pacing remains an estimate

| Item | Proposal | Level proposal | Reason |
|---|---:|---:|---|
| Study Books Set | 120 인덕코인 | 1 | An accessible first desk decoration, below the existing 220 cushion and 280 lamp |
| 생활관 1인 소파 | 480 인덕코인 | 1 | A visible next furnishing goal, modestly above the existing 420 desk chair and below the 650 figure |

Both levels are 1 so this starter path adds no progression barrier. Existing chair (420/Lv3)
and rug (360/Lv3) establish a possible Lv3 alignment, but it is **not selected** here because
it burdens a first-furniture goal. If 480 is too slow for the desired first-session experience,
360/Lv1 is a review alternative; no second price is wired into the client or migration.
The user approved opening the two displayed 120/480 Lv1 values. The alternative is not selected.

Repository evidence, not a claim about the deployed economy:

- `20261001213132_public_baseline.sql`: dorm cushion 220/Lv1, lamp 280/Lv2, chair 420/Lv3,
  rug 360/Lv3, mini figure 650/Lv5, campus map poster 250/Lv2.
- The same baseline defines attendance 10 coins/day and completed daily quiz 50 coins + 25 EXP.
- At a hypothetical 60 coins/day, starting from zero and spending nothing else, books cost
  2 days, sofa costs 8 days, and both together cost 10 days. These are arithmetic comparisons,
  not promised acquisition dates or measured player behavior.
- Attendance milestones in the repo add 30/50/100/150 coins at 3/7/14/21 days. They are excluded
  from the simple 60/day comparison. Month boundaries, missed days, eligibility, other spending,
  existing balances, quest rewards and all live settings can change actual timing.
- No new income amount or claim that any income candidate is deployed is made.

## Preserved authority and UI sequence

1. Existing dorm vendor/route opens `get_world_shop_v1('shop.dorm_furniture')`.
2. The returned offer controls price, level, locked state and availability. The client never
   manufactures an offer from the item catalog. A LOCKED offer is visible but cannot be bought.
3. The existing shop client sends only listing ID and idempotency key to v1, or adds shop ID
   for the server-selected v2. The legacy compatibility route now admits the already-existing
   dorm shop as well as the combined student-center shop; fashion/department split remains closed.
   Missing capability must be its exact function-cache miss. Network/malformed/auth failures still
   fail closed. Existing uncertain requests retain their original RPC/key. V2 still delegates
   money/item movement to the original v1 transaction.
4. Success waits for a fresh account-bound Inventory read. A failed/missing Inventory read offers
   read-only recovery; it does not repurchase or infer ownership from a receipt.
5. From the dorm lobby, the receipt points to the existing own-room door. It does not teleport,
   enter another person's room or auto-place a purchased item. In the room, the existing owner,
   server layout and live room-session gates protect opening the editor.
6. The player adds the owned book set to the desk and the sofa to the floor, then explicitly saves.
   Newly added sofas now search for a valid suggestion with a clear existing seat approach.
   Previously, the first bounds-valid location could face into the south wall and be unsittable.
   This filter only rejects unusable initial suggestions; it never relaxes ownership or geometry
   validation, auto-saves, or changes manually authored placements.
7. After closing the editor, the existing seat controller supports sitting at the saved sofa and
   standing back at its safe approach point. New item-specific shop copy explains these steps.

`main.js` adds only the approved room-local vendor greeting/input/lifecycle wiring. Room
session/chat/transport, seat execution, server purchase RPCs, wallet code, grant code, item
catalog status and existing stock are untouched. The generic placement helper
adds an optional rejecting predicate, used only for a new sofa's editor suggestion.

### Duplicate requests, recovery, refunds and resale

- Existing v1/v2 per-account locking, idempotency conflicts, historical replay, UNIQUE ownership,
  authoritative wallet debit and grant/readback atomicity remain unchanged.
- Listing IDs are durable. The candidate appends after current dorm positions and refuses an
  unexpected F0 catalog prerequisite; it does not upsert/reprice preexisting listings.
- Same-key retries replay the original receipt even if the listing is later paused. Another
  account or product cannot reinterpret the key. A new key for already owned furniture is refused.
- A grant failure rolls back its debit and grant logs. This is transaction failure handling,
  not a new user-facing refund workflow.
- Current main contains no furniture self-service resale or refund UI/RPC. The wallet ledger's
  generic REFUND support is not a furniture-return contract. This candidate adds no sell/refund
  button, resale price, automatic currency credit, deletion or return promise.

## Validation and limits

- Node interaction acceptance exercises the real shop panel/client, inventory client, handoff,
  editor/client, placement validation, anchor selection and seat controller with synthetic RPC/DOM.
  It proves the logical sequence and stale/duplicate-click gates, not rendered browser behavior.
- `supabase/tests/starter-furniture-sql-candidate.mjs` executes 18 actual checkout SQL functions
  and 11 actual table definitions/constraints in memory-only PGlite, with synthetic identity.
  The test activates the two rows **inside a rollback transaction**, checks purchase/readback,
  then verifies rollback restored LOCKED and removed every test ownership/purchase.
  It has no database connection URL or production transport.
- SQL acceptance checks default locks, unchanged old stock, absent pre-grants/wallets,
  shop mismatch, guest denial, insufficient funds, disabled item, authoritative 120/480 debits,
  exact two grants, UNIQUE duplicate rejection, conflicting/cross-account keys, historical replay,
  fresh inventory, server-owned placement/count/surface and debit rollback on injected grant failure.
- Initial remote head `62b53132` passed the new starter pgTAP and full source CI. Existing
  shop tests exposed five old fixed-list/count/sum expectations; they now enumerate both new
  LOCKED rows and keep the original ACTIVE level-gate purchase set. The full remote replay is
  rerun rather than treating the initial partial failure as a pass.
- `starter-furniture.integration.test.mjs` exercises eight simultaneous actual v1/v2 PostgREST
  requests for one listing/key, exact debit/grant counts, UNIQUE/key/account conflicts, guests
  and insufficient balances. `starter-furniture-rollout.integration.test.mjs` executes the exact
  guarded live-operation SQL inside a disposable rollback transaction.
- The dedicated exact-head workflow starts only a loopback disposable Supabase stack, runs the
  complete pgTAP/integration suite, then renders the production vendor/shop/editor/room with
  actual PostgREST purchases and SQL readback at desktop/portrait/landscape. Published screenshots
  use the clearly labeled Public_QA_Avatar placeholder, not the private Induck model. Synthetic accounts and their initial 600 coins exist only in that disposable stack. Browser evidence does not
  prove physical-device behavior or private realtime transport.
- Head `49cbd386` passed all 3,750 pgTAP assertions and 155 actual PostgREST integration tests,
  including simultaneous starter v1/v2 requests and the exact stock-open SQL preservation test.
  Subsequent UI fixes must pass those checks again at their final head.
- A second CI-only pass fetches the already-approved canonical Induck bytes, verifies SHA-256
  `8aede8fd595dd84fda5460e375a18df49f6a91ba813ab7a952f75e768e8964eb`, and records aggregate
  mesh bounds, seat/root alignment and pose metadata only. Every screenshot path is disabled
  in this mode; the upload allowlist includes only its JSON. No GLB, base64 model, private render
  or manual is published. Actual private-character pixels remain **UNKNOWN**, and an AABB/contact
  envelope is not exact mesh collision or visual naturalness proof.
- World is served as static modules; there is no `apps/world/package.json` build script.
  Node World suite, `qa.mjs`, syntax and migration lint are the applicable available checks.
- Actual housing browser smoke was attempted with pinned Playwright. Chrome channel was absent;
  the installed `/usr/bin/chromium` then aborted with `socket() failed: Operation not permitted`.
  Local browser pixels remain **UNKNOWN**. Remote artifacts must be reviewed before any pass is
  claimed; physical-device testing remains outside the hosted Chromium acceptance.

## Production preflight and bounded rollout

Read-only preflight on 2026-10-12 identifies Supabase **GAMES** (`oosshdsthgpqabjmbkjo`).
Its lineage differs from the Public baseline. It has the two F0 catalog/placement definitions,
ACTIVE `shop.dorm_furniture` with five original listings, original combined student-center
stock, v1 read/purchase, no v2 or capabilities RPC, and no two starter listings. The existing
production v1 definition retains advisory locking, authoritative level/price, debit/grant
atomicity, UNIQUE checks and durable receipt replay. No new RPC or permission is necessary.

The legacy dorm exception is intentionally narrow. It does not move the poster, create fashion,
change shop/vendor DB bindings, enable a shared NPC schedule, or activate another F0 item. The
new fictional shopkeeper 윤가온 is procedural room-owned presentation; existing desk approach,
permanent-account, input, distance, room and lifecycle gates still control the F/mobile greeting.
Only choosing “가구 둘러보기” opens the existing shop panel. DB `vendor_id` stays unchanged.

1. Finish exact-head CI, review actual PC/portrait/landscape pixels and receipts, and recheck main.
2. Merge only this reviewed PR and let the existing main-only deployment run. `vercel.json`
   still disables all non-main deploys. No database deployment workflow or `db push` exists here.
3. Re-read the target definitions/stock. Run only the guarded operation above after the approved
   client is live. It rejects preexisting target rows or unexpected prerequisites, inserts exactly
   two ACTIVE offers after current positions, and asserts all other stock and shops unchanged.
   It neither rewrites existing ownership/wallets/ledgers nor applies any migration directory.
4. Verify exactly two prices/levels/statuses and unchanged other listings. A live real-player
   purchase is not fabricated for evidence; transactions are proven with disposable test accounts.
5. If a post-release issue requires pausing sale, change only those two listing statuses to LOCKED
   after the necessary approval. Retain durable IDs, all purchased furniture and receipt ledgers.

Public LOCKED staging and the targeted Production operation are distinct lineages. Never replay
the former blindly on a Production database where the two durable listing IDs already exist.
The earlier `docs/ops/NPC_SHOP_STAGED_ROLLOUT.md` split/API stages are not prerequisites for this
approved dorm-only exception and are not executed as part of it.
