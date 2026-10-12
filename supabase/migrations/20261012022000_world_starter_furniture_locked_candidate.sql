-- First living furniture: LOCAL CANDIDATE, not an approval to apply to any database.
-- Both listings remain LOCKED. Prices and level gates are review proposals only.
-- A later, separately approved rollout must verify the reachable dorm vendor and
-- decide activation; neither catalog status nor any player's possessions change here.
-- Existing purchase v2/v1, UNIQUE ownership, wallet, grant and retry contracts are reused.

do $$
begin
  if (select count(*) from private.world_item_catalog
      where item_id in ('furniture.study_books_set', 'furniture.dorm_single_sofa')
        and category = 'FURNITURE' and ownership_policy = 'UNIQUE' and max_stack is null
        and status = 'COMING_SOON') <> 2 then
    raise exception 'STARTER_FURNITURE_CATALOG_PREREQUISITE';
  end if;
end;
$$;

-- Allocate after current stock; never move/reprice existing listings or overwrite IDs.
with last_position as (
  select coalesce(max(position), -1) as value from private.world_shop_listings
  where shop_id = 'shop.dorm_furniture'
), candidates(listing_id, item_id, price, required_level, offset_position) as (values
  ('offer.dorm_furniture.study_books_set', 'furniture.study_books_set', 120, 1, 1),
  ('offer.dorm_furniture.dorm_single_sofa', 'furniture.dorm_single_sofa', 480, 1, 2)
)
insert into private.world_shop_listings
  (listing_id, shop_id, position, item_id, currency_id, price, quantity,
   required_level, purchase_limit, start_at, end_at, status)
select c.listing_id, 'shop.dorm_furniture', p.value + c.offset_position, c.item_id,
  'currency.induck_coin', c.price, 1, c.required_level, null, null, null, 'LOCKED'
from candidates c cross join last_position p;
