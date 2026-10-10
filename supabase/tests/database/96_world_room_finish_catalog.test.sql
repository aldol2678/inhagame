-- Housing Finish P0, disposable DB only: identities and LOCKED price offers.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select results_eq($$
  select item_id, category, ownership_policy, status
  from private.world_item_catalog where item_id like 'finish.%' order by item_id
$$, $$
  values
    ('finish.floor_basic'::text,'ROOM_FINISH'::text,'UNIQUE'::text,'COMING_SOON'::text),
    ('finish.floor_wood_051','ROOM_FINISH','UNIQUE','COMING_SOON'),
    ('finish.wall_basic','ROOM_FINISH','UNIQUE','COMING_SOON'),
    ('finish.wall_white_plaster_02','ROOM_FINISH','UNIQUE','COMING_SOON')
$$, 'exactly four locked-stage finish identities');

select results_eq($$
  select listing_id, item_id, price, quantity, purchase_limit, status
  from private.world_shop_listings where shop_id='shop.room_finishes' order by "position"
$$, $$
  values
    ('offer.room_finishes.wall_white_plaster_02'::text,'finish.wall_white_plaster_02'::text,1500::bigint,1,1,'LOCKED'::text),
    ('offer.room_finishes.floor_wood_051','finish.floor_wood_051',1500,1,1,'LOCKED')
$$, 'two 1500-coin UNIQUE locked offers');

select is((select count(*) from private.world_player_items where item_id like 'finish.%'),
  0::bigint, 'catalog migration has no ownership grant');
select is((select count(*) from private.world_purchase_transactions
  where listing_id like 'offer.room_finishes.%'), 0::bigint, 'no new purchase ledger rows');
select ok((select bool_and(private.world_shop_listing_block_v2(l,now(),1)='LISTING_LOCKED')
  from private.world_shop_listings l where l.shop_id='shop.room_finishes'),
  'server authority rejects both locked listings');

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
 values ('e4000000-0000-4000-8000-000000000004','authenticated','authenticated',
   'finish-locked-fixture@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned)
 values ('e4000000-0000-4000-8000-000000000004','마감재테스트',false);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":false}',true);
select throws_ok(
  $$select public.purchase_world_shop_listing_v1('offer.room_finishes.wall_white_plaster_02','finish-p0:wall')$$,
  'P0001','LISTING_LOCKED','locked wall cannot charge');
select throws_ok(
  $$select public.purchase_world_shop_listing_v1('offer.room_finishes.floor_wood_051','finish-p0:floor')$$,
  'P0001','LISTING_LOCKED','locked floor cannot charge');
reset role;
select is((select count(*) from private.world_purchase_transactions
  where user_id='e4000000-0000-4000-8000-000000000004'),0::bigint,
  'refused purchases leave purchase ledger unchanged');
select is((select count(*) from private.world_player_items
  where user_id='e4000000-0000-4000-8000-000000000004'),0::bigint,
  'refused purchases do not grant items');
select * from finish();
rollback;
