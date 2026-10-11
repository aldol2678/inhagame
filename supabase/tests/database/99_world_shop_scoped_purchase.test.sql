-- Shop-scoped requests preserve v1 authority and historical idempotency after relocation.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is(pg_get_function_identity_arguments('public.purchase_world_shop_listing_v2'::regproc),
  'p_shop_id text, p_listing_id text, p_idempotency_key text', 'v2 accepts routing, listing and retry key only');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc
  where oid = 'public.purchase_world_shop_listing_v2(text,text,text)'::regprocedure), 'v2 pins an empty definer search path');
select ok(has_function_privilege('authenticated', 'public.purchase_world_shop_listing_v2(text,text,text)', 'execute'), 'signed-in execution granted');
select ok(not has_function_privilege(r, 'public.purchase_world_shop_listing_v2(text,text,text)', 'execute'), r || ' cannot execute v2')
from unnest(array['anon', 'service_role']) r;
select results_eq($$select shop_id, item_id, currency_id, price, quantity, required_level, status,
  purchase_limit, start_at, end_at from private.world_shop_listings
  where listing_id = 'offer.student_center.campus_map_poster'$$,
  $$values ('shop.dorm_furniture'::text, 'furniture.campus_map_poster'::text,
    'currency.induck_coin'::text, 250::bigint, 1, 2, 'ACTIVE'::text, null::int,
    null::timestamptz, null::timestamptz)$$,
  'poster moves with original identity, price, level, status and limits');
select is((select count(*) from private.world_shop_listings l join private.world_item_catalog c using(item_id)
  where l.shop_id = 'shop.student_center' and c.category = 'FURNITURE'), 0::bigint,
  'student center no longer sells furniture');

select is((select status from private.world_shops where shop_id = 'shop.student_center_fashion'),
  (select status from private.world_shops where shop_id = 'shop.student_center'), 'fashion inherits existing shop availability');
select is((select vendor_id from private.world_shops where shop_id = 'shop.student_center_fashion'),
  'vendor.student_center_fashion', 'fashion binds the approved existing shop worker route');
select is((select vendor_id from private.world_shops where shop_id = 'shop.student_center'),
  'vendor.student_center_souvenir', 'souvenirs bind the approved existing shop worker route');
select is((select display_name from private.world_shops where shop_id = 'shop.student_center'),
  '학생회관 기념품점', 'existing shop is presented as souvenirs');
select results_eq($$select listing_id, item_id, price, required_level, status from private.world_shop_listings
  where shop_id = 'shop.student_center_fashion' order by position$$,
  $$values ('offer.student_center.induck_cap'::text, 'head.induck_cap'::text, 180::bigint, 1, 'ACTIVE'::text),
    ('offer.student_center.campus_sneakers', 'shoes.campus_sneakers', 240, 2, 'ACTIVE'),
    ('offer.student_center.induck_hoodie', 'top.induck_hoodie', 320, 2, 'ACTIVE'),
    ('offer.student_center.induck_backpack', 'back.induck_backpack', 420, 3, 'ACTIVE')$$,
  'four existing fashion listings retain IDs, prices, levels and statuses');
select is(array(select listing_id from private.world_shop_listings where shop_id = 'shop.student_center'),
  array['offer.student_center.campus_mug'], 'souvenir shop retains only its existing mug');

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('b8100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'shop-v2-a@example.test', now(), false),
 ('b8100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'shop-v2-b@example.test', now(), false),
 ('b8100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', null, null, true);
insert into public.profiles(user_id, nickname, is_banned) values
 ('b8100000-0000-4000-8000-000000000001', '상점범위A', false),
 ('b8100000-0000-4000-8000-000000000002', '상점범위B', false),
 ('b8100000-0000-4000-8000-000000000003', '상점범위게스트', false);
insert into private.world_item_catalog values ('memorabilia.shop_scope_ticket', 'MEMORABILIA', 'STACKABLE', 99, 'ACTIVE');
insert into private.world_shops(shop_id, display_name, status) values
 ('shop.scope_old', 'Original test shop', 'ACTIVE'), ('shop.scope_new', 'New test shop', 'ACTIVE');
insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status) values
 ('offer.scope_old.ticket', 'shop.scope_old', 0, 'memorabilia.shop_scope_ticket', 'currency.induck_coin', 10, 'ACTIVE');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('b8100000-0000-4000-8000-000000000001', 'currency.induck_coin', 100, 'REWARD', 'test', 'seed', 'scope:seed');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000001","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.student_center','offer.student_center.induck_cap','scope:oldfashion')$$,
 'P0001', 'SHOP_LISTING_MISMATCH', 'fresh fashion purchase from old souvenir route is rejected');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.student_center_fashion','offer.student_center.campus_sneakers','scope:fashionlevel')$$,
 'P0001', 'LEVEL_REQUIRED', 'correct fashion route retains the server level gate');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_new','offer.scope_old.ticket','scope:wrong')$$,
 'P0001', 'SHOP_LISTING_MISMATCH', 'cross-shop request refused before debit');
select throws_ok($$select public.purchase_world_shop_listing_v2(null,'offer.scope_old.ticket','scope:null')$$,
 'P0001', 'SHOP_LISTING_MISMATCH', 'null shop does not bypass binding');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.missing','scope:missing')$$,
 'P0001', 'INVALID_LISTING', 'unknown listing refused');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket',null)$$,
 '22023', 'INVALID_IDEMPOTENCY_KEY', 'invalid retry key refused');
select is(public.purchase_world_shop_listing_v1('offer.scope_old.ticket','scope:legacy')->>'status', 'SUCCESS', 'legacy v1 remains callable');
select is(public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:legacy')->>'replayed', 'true', 'v2 can replay a legacy v1 purchase');
select is(public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:v2')->>'replayed', 'false', 'new v2 purchase succeeds');
reset role;
update private.world_shop_listings set shop_id = 'shop.scope_new', status = 'DISABLED' where listing_id = 'offer.scope_old.ticket';
set local role authenticated;
select is(public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:legacy')->>'replayed', 'true', 'original shop replays legacy purchase after moving and disabling listing');
select is(public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:v2')->>'replayed', 'true', 'original shop replays v2 purchase after moving and disabling listing');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_new','offer.scope_old.ticket','scope:v2')$$,
 '23505', 'IDEMPOTENCY_CONFLICT', 'new shop cannot reinterpret an old key');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.student_center.campus_mug','scope:v2')$$,
 '23505', 'IDEMPOTENCY_CONFLICT', 'same key with another listing is refused');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_new','offer.scope_old.ticket','scope:disabled')$$,
 'P0001', 'LISTING_INACTIVE', 'v1 availability guard still applies to new purchases');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:stale')$$,
 'P0001', 'SHOP_LISTING_MISMATCH', 'fresh key from old shop is refused after relocation');
reset role;
update private.world_shop_listings set status = 'ACTIVE' where listing_id = 'offer.scope_old.ticket';
set local role authenticated;
select is(public.purchase_world_shop_listing_v2('shop.scope_new','offer.scope_old.ticket','scope:new')->'wallet'->>'balanceAfter', '70', 'new shop purchase uses unchanged authoritative price');
select is(public.purchase_world_shop_listing_v1('offer.scope_old.ticket','scope:new')->>'replayed', 'true', 'v1 can replay a new v2 purchase');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000002","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:v2')$$,
 '23505', 'IDEMPOTENCY_CONFLICT', 'another account cannot replay an existing key');
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_new','offer.scope_old.ticket','scope:poor')$$,
 'P0001', 'INSUFFICIENT_FUNDS', 'v1 rejects insufficient funds without a purchase');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000003","is_anonymous":true}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:v2')$$,
 '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous account cannot inspect replay');
reset role;
select is((select count(*) from private.world_purchase_transactions where idempotency_key like 'scope:%'), 3::bigint, 'replays and failures create no extra purchase records');
select is((select shop_id from private.world_purchase_transactions where idempotency_key = 'scope:legacy'), 'shop.scope_old', 'historical shop is never rewritten');
select is((select balance from private.world_wallets where user_id = 'b8100000-0000-4000-8000-000000000001' and currency_id = 'currency.induck_coin'), 70::bigint, 'exactly three authoritative debits');
update public.profiles set is_banned = true where user_id = 'b8100000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8100000-0000-4000-8000-000000000001","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:v2')$$,
 '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot replay its former purchase');
set local request.jwt.claims = '{}';
select throws_ok($$select public.purchase_world_shop_listing_v2('shop.scope_old','offer.scope_old.ticket','scope:v2')$$,
 '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'missing auth uid cannot inspect replay');
reset role;
select * from finish();
rollback;
