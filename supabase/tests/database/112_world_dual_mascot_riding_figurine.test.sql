-- Disposable local acceptance only. All activation, users and value movement roll back.
-- The shipped candidate stays COMING_SOON/LOCKED until separately approved delivery.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select results_eq($$select item_id, category, ownership_policy, max_stack, status
  from private.world_item_catalog where item_id = 'furniture.dual_mascot_riding_figurine'$$,
  $$values ('furniture.dual_mascot_riding_figurine'::text, 'FURNITURE'::text,
    'UNIQUE'::text, null::integer, 'COMING_SOON'::text)$$,
  'R5 has its own closed UNIQUE furniture identity');
select results_eq($$select listing_id, shop_id, item_id, currency_id, price, quantity,
    required_level, purchase_limit, start_at, end_at, status
  from private.world_shop_listings where item_id = 'furniture.dual_mascot_riding_figurine'$$,
  $$values ('offer.dorm_furniture.dual_mascot_riding_figurine'::text,
    'shop.dorm_furniture'::text, 'furniture.dual_mascot_riding_figurine'::text,
    'currency.induck_coin'::text, 500::bigint, 1, 6, null::integer,
    null::timestamptz, null::timestamptz, 'LOCKED'::text)$$,
  'one distinct dorm listing carries the confirmed 500-coin Lv.6 contract while locked');
select is((select position::integer from private.world_shop_listings
    where listing_id = 'offer.dorm_furniture.dual_mascot_riding_figurine'),
  (select max(position) + 1 from private.world_shop_listings
    where shop_id = 'shop.dorm_furniture'
      and listing_id <> 'offer.dorm_furniture.dual_mascot_riding_figurine'),
  'new stock is appended without moving existing listings');
select results_eq($$select width, height, depth, surfaces, solid, flat
  from private.world_room_furniture_v1() where item_id = 'furniture.dual_mascot_riding_figurine'$$,
  $$values (.32::float8, .42::float8, .34::float8, array['desk','floor'], true, false)$$,
  'server placement safely encloses the approved asymmetric R5 asset');
select is((select count(*) from private.world_player_items
  where item_id = 'furniture.dual_mascot_riding_figurine'), 0::bigint,
  'catalog registration grants no figurine');
select is((select count(*) from private.world_item_grants
  where item_id = 'furniture.dual_mascot_riding_figurine'), 0::bigint,
  'catalog registration writes no item grant');
select is((select count(*) from private.world_purchase_transactions
  where item_id = 'furniture.dual_mascot_riding_figurine'), 0::bigint,
  'catalog registration creates no purchase receipt');

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
  ('b8400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'figurine-buyer@example.test', now(), false),
  ('b8400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'figurine-poor@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
  ('b8400000-0000-4000-8000-000000000001', '피규어구매자', false),
  ('b8400000-0000-4000-8000-000000000002', '피규어잔고테스트', false);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('b8400000-0000-4000-8000-000000000001',
  'currency.induck_coin', 500, 'REWARD', 'test', 'figurine', 'figurine:seed:buyer');
select public.world_wallet_credit_v1('b8400000-0000-4000-8000-000000000002',
  'currency.induck_coin', 499, 'REWARD', 'test', 'figurine', 'figurine:seed:poor');
select is(public.world_exp_grant_v1('b8400000-0000-4000-8000-000000000001',
  1499, 'test', 'figurine', 'figurine:exp:buyer')->>'levelAfter', '5',
  'buyer starts one authoritative EXP below Lv.6');
select is(public.world_exp_grant_v1('b8400000-0000-4000-8000-000000000002',
  1500, 'test', 'figurine', 'figurine:exp:poor')->>'levelAfter', '6',
  'unfunded fixture meets the authoritative level gate');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000001","is_anonymous":false}';
select results_eq($$select o->>'listingId', (o->>'price')::bigint,
    (o->>'requiredLevel')::integer, (o->>'purchasable')::boolean, o->>'unavailableReason'
  from jsonb_array_elements(public.get_world_shop_v1('shop.dorm_furniture')->'offers') o
  where o->>'itemId' = 'furniture.dual_mascot_riding_figurine'$$,
  $$values ('offer.dorm_furniture.dual_mascot_riding_figurine'::text, 500::bigint,
    6, false, 'LISTING_LOCKED'::text)$$,
  'shop exposes authoritative price and level but cannot sell staged stock');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:locked')$$,
  'P0001', 'LISTING_LOCKED', 'default listing refuses direct purchase');
select set_config('figurine.room', public.get_or_create_my_personal_room_v1()->>'roomId', true);
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 0,
  '[{"id":"b8400000-0000-4000-8000-000000000010","itemId":"furniture.dual_mascot_riding_figurine","surface":"desk","x":2.5,"z":1.75,"yaw":0}]')$$,
  '42501', 'ITEM_NOT_OWNED', 'preview/catalog registration cannot authorize placement');
reset role;

-- Only this rolled-back fixture opens stock. COMING_SOON is intentionally not an
-- ownership/purchase gate in the existing authority, so LOCKED must remain in release SQL.
update private.world_shop_listings set status = 'ACTIVE'
where listing_id = 'offer.dorm_furniture.dual_mascot_riding_figurine';
set local role authenticated;
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.student_center',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:wrong-shop')$$,
  'P0001', 'SHOP_LISTING_MISMATCH', 'new figurine is bound to its dorm vendor');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:purchase')$$,
  'P0001', 'LEVEL_REQUIRED', 'Lv.5 with enough coins cannot buy a Lv.6 item');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000001","is_anonymous":false,"level":99,"app_metadata":{"level":99},"user_metadata":{"level":99}}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:forged-level')$$,
  'P0001', 'LEVEL_REQUIRED', 'forged JWT level cannot bypass the server-derived Lv.6 gate');
select is(public.get_world_shop_v1('shop.dorm_furniture')->>'playerLevel', '5',
  'shop still reads the actual Lv.5 after forged claims');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000002","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:poor')$$,
  'P0001', 'INSUFFICIENT_FUNDS', 'Lv.6 with 499 coins cannot buy the 500-coin figurine');
reset role;
select is((select balance from private.world_wallets
  where user_id = 'b8400000-0000-4000-8000-000000000001' and currency_id = 'currency.induck_coin'),
  500::bigint, 'locked, route and level refusals never debit the buyer');
select is((select balance from private.world_wallets
  where user_id = 'b8400000-0000-4000-8000-000000000002' and currency_id = 'currency.induck_coin'),
  499::bigint, 'insufficient funds preserves the entire balance');
select is((select count(*) from private.world_purchase_transactions where idempotency_key like 'figurine:%'),
  0::bigint, 'all refusals leave no receipt or reserved retry key');
select is((select count(*) from private.world_player_items
  where item_id = 'furniture.dual_mascot_riding_figurine'), 0::bigint,
  'all refusals leave ownership empty');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1('b8400000-0000-4000-8000-000000000001',
  1, 'test', 'figurine', 'figurine:exp:unlock')->>'levelAfter', '6',
  'one real EXP reaches the exact Lv.6 threshold');
reset role;
create temp table figurine_receipt(receipt jsonb) on commit drop;
grant select, insert on figurine_receipt to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000001","is_anonymous":false}';
insert into figurine_receipt select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:purchase');
select results_eq($$select receipt->>'status', (receipt->>'replayed')::boolean,
    receipt->'item'->>'itemId', (receipt->'item'->>'quantity')::integer,
    receipt->'wallet'->>'currencyId', (receipt->'wallet'->>'price')::bigint,
    (receipt->'wallet'->>'balanceBefore')::bigint, (receipt->'wallet'->>'balanceAfter')::bigint
  from figurine_receipt$$,
  $$values ('SUCCESS'::text, false, 'furniture.dual_mascot_riding_figurine'::text, 1,
    'currency.induck_coin'::text, 500::bigint, 500::bigint, 0::bigint)$$,
  'Lv.6 purchase spends exact server price and grants one separately identified figurine');
select is(public.purchase_world_shop_listing_v2('shop.dorm_furniture',
    'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:purchase'),
  (select jsonb_set(receipt, '{replayed}', 'true') from figurine_receipt),
  'same key returns the original receipt without another debit');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:duplicate')$$,
  'P0001', 'ITEM_ALREADY_OWNED', 'new key cannot buy a second UNIQUE figurine');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.mini_induck', 'figurine:purchase')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'retry key cannot be redirected to another product');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000002","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:purchase')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'another account cannot replay the buyer receipt');
reset role;
select is((select count(*) from private.world_purchase_transactions where idempotency_key like 'figurine:%'),
  1::bigint, 'exactly one durable purchase receipt');
select is((select count(*) from private.world_currency_transactions
  where user_id in ('b8400000-0000-4000-8000-000000000001', 'b8400000-0000-4000-8000-000000000002')
    and type = 'PURCHASE'), 1::bigint, 'exactly one debit across retries and refusals');
select results_eq($$select user_id, item_id, quantity, source_type, source_ref
  from private.world_player_items where item_id = 'furniture.dual_mascot_riding_figurine'$$,
  $$values ('b8400000-0000-4000-8000-000000000001'::uuid,
    'furniture.dual_mascot_riding_figurine'::text, 1, 'SHOP'::text,
    'offer.dorm_furniture.dual_mascot_riding_figurine'::text)$$,
  'the only owned copy records authoritative shop provenance');
select is((select count(*) from private.world_item_grants
  where item_id = 'furniture.dual_mascot_riding_figurine'), 1::bigint,
  'exactly one grant after successful purchase and replay');

-- Recall/replacement/re-entry use the existing room snapshot contract, never a client grant.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000001","is_anonymous":false}';
select set_config('figurine.desk',
  '[{"id":"b8400000-0000-4000-8000-000000000010","itemId":"furniture.dual_mascot_riding_figurine","surface":"desk","x":2.5,"z":1.75,"yaw":0}]', true);
select set_config('figurine.floor',
  '[{"id":"b8400000-0000-4000-8000-000000000010","itemId":"furniture.dual_mascot_riding_figurine","surface":"floor","x":-2,"z":0,"yaw":45}]', true);
select is(public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 0,
  current_setting('figurine.desk')::jsonb)->>'revision', '1', 'purchased R5 saves on the desk');
select is(public.get_world_room_furniture_v1(current_setting('figurine.room')::uuid)->'objects',
  current_setting('figurine.desk')::jsonb, 're-entry reads the exact separately identified R5 placement');
select is(public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 0,
  current_setting('figurine.desk')::jsonb)->>'revision', '1', 'lost-response save retry is idempotent');
select is(public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 1,
  current_setting('figurine.floor')::jsonb)->>'revision', '2', 'same owned figurine can move to the floor');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 2,
  current_setting('figurine.floor')::jsonb ||
    jsonb_set(current_setting('figurine.desk')::jsonb, '{0,id}', '"b8400000-0000-4000-8000-000000000011"'))$$,
  '42501', 'ITEM_NOT_OWNED', 'one owned copy cannot be placed on desk and floor simultaneously');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 2,
  jsonb_set(current_setting('figurine.floor')::jsonb, '{0,surface}', '"bed"'))$$,
  '22023', 'INVALID_LAYOUT', 'R5 cannot be placed on an unapproved surface');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 2,
  jsonb_set(current_setting('figurine.floor')::jsonb, '{0,x}', '7'))$$,
  '22023', 'ROOM_BOUNDS', 'R5 placement enforces the full enclosing footprint');
select is(public.get_world_room_furniture_v1(current_setting('figurine.room')::uuid)->'objects',
  current_setting('figurine.floor')::jsonb, 'rejected placements cannot overwrite the saved layout');
select is(public.save_my_room_furniture_v1(current_setting('figurine.room')::uuid, 2, '[]')->>'revision',
  '3', 'recall clears placement without selling or deleting the figurine');
reset role;
select is((select quantity from private.world_player_items
  where user_id = 'b8400000-0000-4000-8000-000000000001'
    and item_id = 'furniture.dual_mascot_riding_figurine'), 1,
  'placement, movement and recall preserve purchased ownership');
select throws_ok($$select private.validate_world_room_furniture_v1('b8400000-0000-4000-8000-000000000002',
  current_setting('figurine.desk')::jsonb)$$,
  '42501', 'ITEM_NOT_OWNED', 'non-owner cannot borrow the buyer figurine');

update private.world_shop_listings set status = 'LOCKED'
where listing_id = 'offer.dorm_furniture.dual_mascot_riding_figurine';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000001","is_anonymous":false}';
select is(public.purchase_world_shop_listing_v2('shop.dorm_furniture',
    'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:purchase')->>'replayed',
  'true', 're-closing stock preserves historical purchase replay');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8400000-0000-4000-8000-000000000002","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.dorm_furniture',
  'offer.dorm_furniture.dual_mascot_riding_figurine', 'figurine:reclosed')$$,
  'P0001', 'LISTING_LOCKED', 'LOCKED blocks even a real Lv.6 account');
reset role;
select * from finish();
rollback;
