# First living furniture acquisition candidate

Status: local review candidate, based on `af532a53c433479e12354f88a5a1c234075de5e7`.
This document does not authorize a push, PR, CI run, merge, deployment, database application,
price finalization, or live sale activation. No connected database was read or changed.

## Two existing items, one existing acquisition path

- `furniture.study_books_set` / Study Books Set: five books and one notebook, placed together on the fixed desk.
- `furniture.dorm_single_sofa` / 생활관 1인 소파: floor placement, existing room-local sitting interaction.

The seven-item F0 migration `20261009142600_world_personal_room_f0_furniture.sql` already supplied
identity, ownership policy and placement. It did not supply an acquisition listing or price.
This candidate adds exactly two **LOCKED** rows to the existing `shop.dorm_furniture` catalog.
The other five F0 items remain unchanged and have no new acquisition route. No new currency,
paid payment, free grant, plant-growing function or furniture/inventory engine is introduced.

### Candidate prices, not decided economic values

| Item | Proposal | Level proposal | Reason |
|---|---:|---:|---|
| Study Books Set | 120 인덕코인 | 1 | An accessible first desk decoration, below the existing 220 cushion and 280 lamp |
| 생활관 1인 소파 | 480 인덕코인 | 1 | A visible next furnishing goal, modestly above the existing 420 desk chair and below the 650 figure |

Both levels are 1 so this starter path adds no progression barrier. Existing chair (420/Lv3)
and rug (360/Lv3) establish a possible Lv3 alignment, but it is **not selected** here because
it burdens a first-furniture goal. If 480 is too slow for the desired first-session experience,
360/Lv1 is a review alternative; no second price is wired into the client or migration.
The user must decide price and pacing before any activation.

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
3. In a separately approved activated fixture, the existing shop client sends only shop ID,
   listing ID and idempotency key to v2. Existing capability selection and legacy compatibility
   are unchanged; v2 delegates money/item movement to the original v1 transaction.
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

`main.js`, room session/chat/transport, seat execution, server purchase RPCs, wallet code,
grant code, item catalog status and existing stock are untouched. The generic placement helper
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
- `99_world_starter_furniture_candidate.test.sql` adds full local-stack pgTAP coverage, but was
  **not run** here because Supabase CLI/Docker/psql are absent. PGlite subset success is not a full
  Supabase migration replay, PostgREST proof, or real parallel transaction/lock proof.
- World is served as static modules; there is no `apps/world/package.json` build script.
  Node World suite, `qa.mjs`, syntax and migration lint are the applicable available checks.
- Actual housing browser smoke was attempted with pinned Playwright. Chrome channel was absent;
  the installed `/usr/bin/chromium` then aborted with `socket() failed: Operation not permitted`.
  Browser pixels, physical-device touch/keyboard interaction, avatar/sofa contact and visual
  naturalness remain **UNKNOWN**. No screenshot or browser pass is claimed.

## Approval-required next steps

1. Decide the final two prices and Lv1 proposal, after reviewing desired first-furniture pacing.
2. Approve any external publication independently. Rebase/check against the then-current main,
   especially if another furniture/editor change lands. This candidate does not need the parallel
   room-social or mobile-boot patches.
3. Before activation, approve a concrete target and narrowly scoped database preflight. Verify
   actual catalog/item states, balance sources, existing prices, reachable dorm vendor, purchase
   API/capability compatibility, grants and rollback snapshot. The Public development lineage
   is not a Production runbook; follow `docs/ops/NPC_SHOP_STAGED_ROLLOUT.md`.
4. Run the full disposable Supabase replay, concurrency/receipt tests, and exact candidate browser
   acceptance at desktop/portrait/landscape: buy → fresh ownership → own-room door → add/save →
   reload → sit/stand, plus interrupted inventory reads, duplicate taps and account changes.
5. A later approved stock-status change may enable the two listings. Stopping sales should retain
   durable receipts, inventory and all ledgers; it must not revoke already owned furniture.
