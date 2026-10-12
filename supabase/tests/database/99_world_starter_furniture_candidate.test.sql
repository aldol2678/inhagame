-- Local/public replay acceptance only. Activation is rolled back with every test row.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select results_eq($$select item_id,price,required_level,status,quantity,currency_id
  from private.world_shop_listings where listing_id in
  ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa') order by item_id$$,
  $$values ('furniture.dorm_single_sofa'::text,480::bigint,1,'LOCKED'::text,1,'currency.induck_coin'::text),
    ('furniture.study_books_set'::text,120::bigint,1,'LOCKED'::text,1,'currency.induck_coin'::text)$$,
  'only two proposed starter prices, both LOCKED at Lv1');
select is((select count(*) from private.world_shop_listings where item_id in
  ('furniture.dorm_side_table_low','furniture.dorm_bookshelf_slim','furniture.dorm_plant_medium','furniture.dorm_monitor','furniture.dorm_trophy_shelf')),
  0::bigint, 'other F0 furniture has no acquisition listing');
select is((select count(*) from private.world_item_catalog where item_id in
  ('furniture.dorm_single_sofa','furniture.study_books_set') and status='COMING_SOON' and ownership_policy='UNIQUE'),
  2::bigint,'catalog status and UNIQUE policy are preserved');
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
  ('b8300000-0000-4000-8000-000000000001','authenticated','authenticated','starter-furniture@example.test',now(),false),
  ('b8300000-0000-4000-8000-000000000002','authenticated','authenticated','starter-poor@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
  ('b8300000-0000-4000-8000-000000000001','첫가구테스트',false),
  ('b8300000-0000-4000-8000-000000000002','가구잔고테스트',false);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('b8300000-0000-4000-8000-000000000001','currency.induck_coin',600,'REWARD','test','starter','starter:seed');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8300000-0000-4000-8000-000000000001","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.study_books_set','starter:locked')$$,
  'P0001','LISTING_LOCKED','new stock is not purchasable by default');
reset role;
update private.world_shop_listings set status='ACTIVE' where listing_id in
  ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa');
set local role authenticated;
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.student_center','offer.dorm_furniture.study_books_set','starter:wrong-shop')$$,
  'P0001','SHOP_LISTING_MISMATCH','fresh purchase uses dorm shop binding');
select is(public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.study_books_set','starter:books')->'wallet'->>'balanceAfter',
  '480','books use server price and debit once');
select is(public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.study_books_set','starter:books')->>'replayed',
  'true','same key replays');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.study_books_set','starter:books-again')$$,
  'P0001','ITEM_ALREADY_OWNED','new key cannot buy a second UNIQUE copy');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.dorm_single_sofa','starter:books')$$,
  '23505','IDEMPOTENCY_CONFLICT','key cannot be reused for another product');
select is(public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.dorm_single_sofa','starter:sofa')->'wallet'->>'balanceAfter',
  '0','sofa has no new level barrier and spends exact remaining balance');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8300000-0000-4000-8000-000000000002","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.study_books_set','starter:poor')$$,
  'P0001','INSUFFICIENT_FUNDS','unfunded account receives no item');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture','offer.dorm_furniture.study_books_set','starter:books')$$,
  '23505','IDEMPOTENCY_CONFLICT','account cannot replay another account receipt');
reset role;
select is((select count(*) from private.world_player_items where user_id='b8300000-0000-4000-8000-000000000001' and quantity=1),2::bigint,
  'one owned copy of each new furniture item');
select is((select count(*) from private.world_purchase_transactions where idempotency_key like 'starter:%'),2::bigint,
  'only two purchase records, no replay or refusal debit');
select is((select count(*) from private.world_player_items where user_id='b8300000-0000-4000-8000-000000000002'),0::bigint,
  'failed account remains empty');
select lives_ok($$select private.validate_world_room_furniture_v1('b8300000-0000-4000-8000-000000000001',
  '[{"id":"b8300000-0000-4000-8000-000000000010","itemId":"furniture.study_books_set","surface":"desk","x":2.5,"z":1.5,"yaw":0},
  {"id":"b8300000-0000-4000-8000-000000000011","itemId":"furniture.dorm_single_sofa","surface":"floor","x":-2,"z":0,"yaw":0}]')$$,
  'purchased books and sofa pass existing server placement validator');
select throws_ok($$select private.validate_world_room_furniture_v1('b8300000-0000-4000-8000-000000000002',
  '[{"id":"b8300000-0000-4000-8000-000000000010","itemId":"furniture.study_books_set","surface":"desk","x":2.5,"z":1.5,"yaw":0}]')$$,
  '42501','ITEM_NOT_OWNED','non-owner cannot place borrowed purchase');
select * from finish();
rollback;
