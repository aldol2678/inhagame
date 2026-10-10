# Closed catalog integration: Room Finish P0 + Cooking B2

## Candidate lineage

This integration is based on Cooking B2 PR #331 at
`7e5cbc288b29dd3ead0d016b92c5e93441d8486b`, including PR #329, and imports
Room Finish P0 PR #330 at `06c3a908e4ebccfbd6a64dea6b4311ebc7df68a0`.
The release/main baseline is `4f7320a1ac360e9162b59aa9d9527a412dedfef7`.
The source PR branches remain independent and unchanged by this integration.

## Migration repair boundary

All 42 migrations present on the release/main baseline are immutable. The earlier
Cooking B2 migration is also unchanged from PR #331. The finish migration is new
to both bases; its integration-candidate copy adds `CONSUMABLE` to the category
check before PostgreSQL validates existing rows. All four finish definitions,
the shop, the two 1,500-coin LOCKED offers and conflict guards are unchanged.

This is a correction of an **unapplied candidate**, not a recipe for rewriting
an applied migration. A new migration after the finish migration cannot repair
fresh replay: the original finish constraint would reject the already inserted
grilled carp before that later file could run. Do not apply this candidate to an
existing database whose migration history differs; reconcile that history and
authorize a separate forward migration plan first. Public CI uses a fresh,
disposable local Supabase stack only.

## Preserved boundaries and checks

- The catalog is exactly 42 identities: all 36 baseline members, both cooking
  definitions and all four finish definitions. SQL and client fixtures assert
  this exact union, and the existing Inventory integration compares every
  client authority row to the actual database mirror.
- The final SQL category constraint and client category registry contain both
  `CONSUMABLE` and `ROOM_FINISH`, retaining all earlier categories.
- Generated database declarations use `category: string` for this text column,
  not a TypeScript enum. They have no competing category union to merge. The
  Cooking B2 table/RPC declarations are preserved; generated-type coverage is
  still required, and coverage alone is not exact generated-file equality.
- All six new items and the recipe remain `COMING_SOON`; both finish offers
  remain `LOCKED`. Cooking runtime availability stays false. No grant, price
  change, purchase, equip/save activation or food-use/combat effect is added.
- `96_world_catalog_category_union.test.sql` probes all ten categories in the
  actual PostgreSQL constraint and checks unknown-category refusal, closed
  recipe status and zero ownership grants. Static Node checks complement it;
  they are not evidence of database replay.

## Verification required before release admission

Run `bash scripts/public-ci.sh` and `bash scripts/public-db.sh` against this exact
candidate, including the full migration replay, all pgTAP files, cross-connection
integration races and generated-type coverage. Run the inherited cooking and
life/housing browser workflows. Record exact-head results separately; this
document does not claim that those checks have run or passed. Publication does
not authorize merge, deployment, Production SQL or feature activation.
