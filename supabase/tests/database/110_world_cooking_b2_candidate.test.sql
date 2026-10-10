-- Disposable fixtures only. Activation is rolled back with the test transaction.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1100000-0000-4000-8000-000000000001','authenticated','authenticated','cook-a@example.test',now(),false),
 ('a1100000-0000-4000-8000-000000000002','authenticated','authenticated','cook-b@example.test',now(),false),
 ('a1100000-0000-4000-8000-000000000003','authenticated','authenticated',null,null,true),
 ('a1100000-0000-4000-8000-000000000004','authenticated','authenticated','cook-ban@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a1100000-0000-4000-8000-000000000001','조리A',false),
 ('a1100000-0000-4000-8000-000000000002','조리B',false),
 ('a1100000-0000-4000-8000-000000000003','조리손님',false),
 ('a1100000-0000-4000-8000-000000000004','조리정지',true);
insert into public.world_player_rooms(id,owner_user_id) values
 ('b1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001'),
 ('b1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002');
select is((select status from private.world_recipe_catalog where recipe_id='recipe.carp_grill'),'COMING_SOON','recipe default is closed');
select is((select status from private.world_item_catalog where item_id='furniture.cooking_station'),'COMING_SOON','station is not activated');
select is((select category from private.world_item_catalog where item_id='consumable.grilled_carp'),'CONSUMABLE','food category is semantic');
select is((select max_stack from private.world_item_catalog where item_id='consumable.grilled_carp'),20,'food stack candidate is 20');
select ok(not has_function_privilege('anon','public.cook_my_world_recipe_v1(text,uuid)','execute'),'anon has no cooking RPC');
select ok(has_function_privilege('authenticated','public.cook_my_world_recipe_v1(text,uuid)','execute'),'narrow self-only RPC');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.world_recipe_catalog','private.world_recipe_receipts']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.world_recipe_catalog'::regclass,'private.world_recipe_receipts'::regclass)),'new tables use RLS');

set local role authenticated;
set local request.jwt.claims='{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')$$,
 'P0001','RECIPE_UNAVAILABLE','closed candidate cannot move value');
reset role;
-- This fixture activates only the server recipe, never commits it.
update private.world_recipe_catalog set status='ACTIVE' where recipe_id='recipe.carp_grill';
select private.world_inventory_grant_v1('a1100000-0000-4000-8000-000000000001','material.fish_carp',3,'SYSTEM','cook.test','cook-test:fish',null,null);
select private.world_inventory_grant_v1('a1100000-0000-4000-8000-000000000001','furniture.cooking_station',1,'SYSTEM','cook.test','cook-test:station',null,null);
set local role authenticated;
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill',null)$$,'22023','INVALID_RECIPE_REQUEST','null request fails closed');
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')$$,
 '42501','COOKING_STATION_REQUIRED','owned but unsaved station is insufficient');
select lives_ok($$select public.save_my_room_furniture_v1('b1100000-0000-4000-8000-000000000001',0,
 '[{"id":"d1100000-0000-4000-8000-000000000001","itemId":"furniture.cooking_station","surface":"floor","x":-6,"z":0,"yaw":0}]')$$,'station passes real H2 validation');
reset role;
create temp table cooking_original(receipt jsonb);
grant select,insert on cooking_original to authenticated;
set local role authenticated;
insert into cooking_original select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001');
select is((select receipt->>'status' from cooking_original),'SUCCESS','owner cooks with owned saved station');
select is(public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001'),
 (select receipt from cooking_original),'same request returns exact immutable historical receipt');
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.other','c1100000-0000-4000-8000-000000000001')$$,
 '23505','IDEMPOTENCY_CONFLICT','same request cannot change recipe');
reset role;
select is((select quantity from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000001' and item_id='material.fish_carp'),2,'only one carp consumed');
select is((select quantity from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000001' and item_id='consumable.grilled_carp'),1,'only one meal granted');
select is((select count(*) from private.world_recipe_receipts where user_id='a1100000-0000-4000-8000-000000000001'),1::bigint,'one domain receipt');
select throws_ok($$update private.world_recipe_receipts set recipe_id='recipe.other' where user_id='a1100000-0000-4000-8000-000000000001'$$,
 '42501','RECIPE_RECEIPT_APPEND_ONLY','receipt cannot be rewritten');
select throws_ok($$delete from private.world_recipe_receipts where user_id='a1100000-0000-4000-8000-000000000001'$$,
 '42501','RECIPE_RECEIPT_APPEND_ONLY','live-account receipt cannot be removed');
-- Change catalog, then remove station: replay still returns historical counts/version, new work fails.
update private.world_recipe_catalog set status='DISABLED',definition_version=2,
 plan='{"consumes":[{"itemId":"material.fish_carp","quantity":2}],"grants":[{"itemId":"consumable.grilled_carp","quantity":2}]}'
 where recipe_id='recipe.carp_grill';
set local role authenticated;
select public.save_my_room_furniture_v1('b1100000-0000-4000-8000-000000000001',1,'[]');
select is(public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001'),
 (select receipt from cooking_original),'replay survives recipe change/closure and station recall');
reset role;
update private.world_recipe_catalog set status='ACTIVE',definition_version=1,
 plan='{"consumes":[{"itemId":"material.fish_carp","quantity":1}],"grants":[{"itemId":"consumable.grilled_carp","quantity":1}]}'
 where recipe_id='recipe.carp_grill';
set local role authenticated;
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000002')$$,
 '42501','COOKING_STATION_REQUIRED','new request after recall fails');
select public.save_my_room_furniture_v1('b1100000-0000-4000-8000-000000000001',2,
 '[{"id":"d1100000-0000-4000-8000-000000000001","itemId":"furniture.cooking_station","surface":"floor","x":-6,"z":0,"yaw":0}]');
set local request.jwt.claims='{"sub":"a1100000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')$$,
 '42501','COOKING_STATION_REQUIRED','another account cannot replay owner receipt or borrow their room');
reset role;
select private.world_inventory_grant_v1('a1100000-0000-4000-8000-000000000002','material.fish_carp',1,'SYSTEM','cook.test','cook-test:b-fish',null,null);
select private.world_inventory_grant_v1('a1100000-0000-4000-8000-000000000002','furniture.cooking_station',1,'SYSTEM','cook.test','cook-test:b-station',null,null);
set local role authenticated;
select public.save_my_room_furniture_v1('b1100000-0000-4000-8000-000000000002',0,
 '[{"id":"d1100000-0000-4000-8000-000000000002","itemId":"furniture.cooking_station","surface":"floor","x":-6,"z":0,"yaw":0}]');
select is(public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')->>'userId',
 'a1100000-0000-4000-8000-000000000002','same request UUID is independently scoped to the second actor');
reset role;
select is((select count(*) from private.world_recipe_receipts where request_id='c1100000-0000-4000-8000-000000000001'),2::bigint,'two accounts have separate same-key receipts');
select is((select count(*) from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000002' and item_id='material.fish_carp'),0::bigint,'second actor consumed only its own carp');
select is((select quantity from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000001' and item_id='material.fish_carp'),2,'first actor inventory unchanged by second actor');
update public.profiles set is_banned=true where user_id='a1100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')$$,
 '42501','ACCOUNT_UNAVAILABLE','a successful actor banned later cannot replay its historical receipt');
set local request.jwt.claims='{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')$$,
 '42501','ACCOUNT_UNAVAILABLE','stored anonymous account is rejected even if claim says permanent');
set local request.jwt.claims='{"sub":"a1100000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000001')$$,
 '42501','ACCOUNT_UNAVAILABLE','banned account is rejected');
reset role;
-- Fill output through Inventory authority. Overflow must roll back input and recipe receipt.
select private.world_inventory_grant_v1('a1100000-0000-4000-8000-000000000001','consumable.grilled_carp',19,'SYSTEM','cook.test','cook-test:full',null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000002')$$,
 'P0001','MAX_STACK_EXCEEDED','full output rolls back atomically');
reset role;
select is((select quantity from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000001' and item_id='material.fish_carp'),2,'overflow leaves input unchanged');
select is((select count(*) from private.world_recipe_receipts where user_id='a1100000-0000-4000-8000-000000000001'),1::bigint,'overflow leaves no extra receipt');
-- Release one output and consume all remaining input through the owner primitive.
select private.world_inventory_mutate_v1('a1100000-0000-4000-8000-000000000001','CONSUME','SYSTEM','cook.test','cook-test:empty',
 '{"consumes":[{"itemId":"material.fish_carp","quantity":2},{"itemId":"consumable.grilled_carp","quantity":1}],"grants":[]}');
set local role authenticated;
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000002')$$,
 'P0001','INSUFFICIENT_QUANTITY','insufficient input creates no output');
reset role;
select is((select quantity from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000001' and item_id='consumable.grilled_carp'),19,'insufficient input leaves output unchanged');
-- No consuming station is allowed by the Inventory UNIQUE policy. An unowned saved fixture must fail.
delete from private.world_player_items where user_id='a1100000-0000-4000-8000-000000000001' and item_id='furniture.cooking_station';
set local role authenticated;
select throws_ok($$select public.cook_my_world_recipe_v1('recipe.carp_grill','c1100000-0000-4000-8000-000000000003')$$,
 '42501','COOKING_STATION_REQUIRED','a stale saved layout does not replace actual ownership');
reset role;
select lives_ok($$delete from auth.users where id='a1100000-0000-4000-8000-000000000001'$$,'account deletion cascades append-only receipts');
select is((select count(*) from private.world_recipe_receipts where user_id='a1100000-0000-4000-8000-000000000001'),0::bigint,'deleted account has no retained receipt');
select * from finish();
rollback;
