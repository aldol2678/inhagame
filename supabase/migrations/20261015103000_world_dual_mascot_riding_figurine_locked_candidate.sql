-- R5 dual-mascot riding figurine: append-only LOCAL CANDIDATE.
-- This file is not approval to apply SQL to any database or to activate Production stock.
-- Confirmed commercial contract: UNIQUE furniture, Lv.6, 500 Induck Coins, one copy.
-- Keep the item COMING_SOON and its listing LOCKED until the exact approved R5 asset
-- has verified delivery and both preview/room rendering have passed release acceptance.
-- A separately approved rollout must verify the reachable dorm vendor, then activate
-- the listing. COMING_SOON alone is not a purchase gate; LOCKED is the enforced guard.
-- No player grants, wallet changes, purchase RPC changes or existing stock changes.

insert into private.world_item_catalog(item_id, category, ownership_policy, max_stack, status)
values ('furniture.dual_mascot_riding_figurine', 'FURNITURE', 'UNIQUE', null, 'COMING_SOON');

-- Retain all seventeen existing placements, including the closed cooking candidate.
-- The R5 Y-up asset spans x [-.155,.155], y [0,.419], z [-.169,.141].
-- The symmetric .32 x .42 x .34 envelope encloses that asymmetric origin footprint.
-- Match the client placement definition; desk/floor placement uses existing ownership,
-- collision, room revision and snapshot authority without adding a new grant path.
create or replace function private.world_room_furniture_v1()
returns table(item_id text, width double precision, height double precision, depth double precision, surfaces text[], solid boolean, flat boolean)
language sql stable security definer set search_path = ''
as $$
  select * from (values
    ('furniture.campus_map_poster', .9::float8, .65::float8, .04::float8, array['north','east','south','west'], false, false),
    ('furniture.induck_cushion', .45, .14, .4, array['floor','bed'], true, false),
    ('furniture.dorm_desk_lamp', .22, .45, .22, array['desk','floor'], true, false),
    ('furniture.induck_chair', .6, .65, .65, array['floor'], true, false),
    ('furniture.mini_induck', .22, .28, .22, array['desk','floor'], true, false),
    ('furniture.campus_rug_blue', 2, .02, 1.5, array['floor'], false, true),
    ('furniture.dorm_resident_plate', .6, .22, .04, array['north','east','south','west'], false, false),
    ('furniture.mcm_2026_landlord_figure', .32, .35, .32, array['desk','floor'], true, false),
    ('furniture.mcm_2026_poster', 1, .75, .04, array['north','east','south','west'], false, false),
    ('furniture.dorm_single_sofa', 1.10, .72, .78, array['floor'], true, false),
    ('furniture.dorm_side_table_low', .65, .38, .65, array['floor'], true, false),
    ('furniture.dorm_bookshelf_slim', .75, 1.25, .35, array['floor'], true, false),
    ('furniture.dorm_plant_medium', .55, .80, .55, array['floor'], true, false),
    ('furniture.dorm_monitor', .52, .36, .18, array['desk'], true, false),
    ('furniture.dorm_trophy_shelf', .90, 1.10, .32, array['floor'], true, false),
    ('furniture.study_books_set', .38, .18, .22, array['desk'], true, false),
    ('furniture.cooking_station', 1.00, .90, .65, array['floor'], true, false),
    ('furniture.dual_mascot_riding_figurine', .32, .42, .34, array['desk','floor'], true, false)
  ) as furniture(item_id, width, height, depth, surfaces, solid, flat);
$$;
revoke all on function private.world_room_furniture_v1() from public, anon, authenticated;

-- Append after current stock. IDs must be new; do not overwrite or reprice any listing.
insert into private.world_shop_listings
  (listing_id, shop_id, position, item_id, currency_id, price, quantity,
   required_level, purchase_limit, start_at, end_at, status)
select 'offer.dorm_furniture.dual_mascot_riding_figurine', 'shop.dorm_furniture',
  coalesce(max(position), -1) + 1, 'furniture.dual_mascot_riding_figurine',
  'currency.induck_coin', 500, 1, 6, null, null, null, 'LOCKED'
from private.world_shop_listings where shop_id = 'shop.dorm_furniture';
