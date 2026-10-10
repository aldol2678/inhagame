-- The combined Cooking B2 + Room Finish P0 release must replay before this runs.
-- Probe the actual PostgreSQL check, rather than relying on its source spelling.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select lives_ok(format(
  'insert into private.world_item_catalog(item_id,category,ownership_policy,max_stack,status) values (%L,%L,%L,null,%L)',
  'memorabilia.category_union_' || lower(category), category, 'UNIQUE', 'COMING_SOON'),
  format('combined category constraint accepts %s', category))
from unnest(array[
  'WEARABLE','BADGE','EMOTE','FURNITURE','MOUNT','MOUNT_COSMETIC',
  'MEMORABILIA','MATERIAL','CONSUMABLE','ROOM_FINISH'
]) category;

select throws_ok($$insert into private.world_item_catalog values
  ('memorabilia.category_union_unknown','UNKNOWN_CATEGORY','UNIQUE',null,'COMING_SOON')$$,
  '23514', null, 'union expansion still rejects an unknown category');
select is((select status from private.world_recipe_catalog where recipe_id='recipe.carp_grill'),
  'COMING_SOON'::text, 'the combined release does not activate the cooking recipe');
select is((select count(*) from private.world_player_items where item_id in (
  'furniture.cooking_station','consumable.grilled_carp',
  'finish.wall_basic','finish.wall_white_plaster_02','finish.floor_basic','finish.floor_wood_051')),
  0::bigint, 'combined catalog registration does not create ownership grants');

select * from finish();
rollback;
