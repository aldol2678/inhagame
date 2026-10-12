-- JSL policy confirmation: the public lobby needs no pass. Beyond its entrance gate,
-- Inha mail verified permanent accounts enter free; other eligible permanent accounts
-- can buy a game-only, account-bound visitor pass from the lobby information NPC.
-- Mail verification proves mailbox ownership, not enrollment or real facility access.
--
-- Confirmed terms: 100 Induck Coin for 86,400 seconds from purchase.
-- This is a forward-only data change. Preserve both existing rollout statuses:
-- the gate and product still ship COMING_SOON. Confirmation does not activate sales
-- or access; activation requires a separate authorized rollout.
-- The original JSL-A migration, RPCs, grants, Wallet authority, advisory lock and
-- idempotency contract remain unchanged. Disposable local databases only, never Production.

update private.world_jeongseok_pass_catalog
   set duration_seconds = 86400,
       currency_id = 'currency.induck_coin',
       price = 100,
       price_basis = 'CONFIRMED'
 where pass_type = 'jeongseok.visitor.day';
