-- Economy P0-D: Shop Purchase (20260927130000) + P0-F2 Shop Level Gate (20260928090000).
-- Shop/listing definitions, the player read, price authority, success / insufficient funds / already
-- owned, every preflight refusal, purchase limit, idempotency, rollback after the debit, the
-- server-derived Level gate (LEVEL_REQUIRED) and the client boundary. Concurrency and
-- cross-connection readback live in supabase/tests/integration/shop.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a6000000-0000-4000-8000-0000000000a6', 'authenticated', 'authenticated', 'shop-a@example.test', now(), false),
 ('b6000000-0000-4000-8000-0000000000b6', 'authenticated', 'authenticated', 'shop-b@example.test', now(), false),
 ('c6000000-0000-4000-8000-0000000000c6', 'authenticated', 'authenticated', null, null, true),
 ('d6000000-0000-4000-8000-0000000000d6', 'authenticated', 'authenticated', 'shop-d@example.test', now(), false),
 ('e6000000-0000-4000-8000-0000000000e6', 'authenticated', 'authenticated', 'shop-e@example.test', now(), false),
 ('f6000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'shop-f@example.test', now(), false),
 ('a7000000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated', 'shop-g@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a6000000-0000-4000-8000-0000000000a6', '상점A', false),
 ('b6000000-0000-4000-8000-0000000000b6', '상점B', false),
 ('c6000000-0000-4000-8000-0000000000c6', '상점게스트', false),
 ('d6000000-0000-4000-8000-0000000000d6', '상점정지', true),
 ('e6000000-0000-4000-8000-0000000000e6', '상점E', false),
 ('f6000000-0000-4000-8000-0000000000f6', '상점F', false),
 ('a7000000-0000-4000-8000-0000000000a7', '상점G', false);

-- ---- A. shop definitions ----
select has_table('private', t, format('%s exists', t))
from unnest(array['world_shops', 'world_shop_listings', 'world_purchase_transactions']) t;
select results_eq($$select shop_id, display_name, status from private.world_shops
  where shop_id in ('shop.student_center', 'shop.dorm_furniture', 'shop.department_mcm') order by shop_id$$,
  $$values ('shop.department_mcm'::text, '문콘경 학과 상점'::text, 'ACTIVE'::text),
           ('shop.dorm_furniture', '생활관 가구점', 'ACTIVE'), ('shop.student_center', '학생회관 굿즈샵', 'ACTIVE')$$,
  'the three first shops');
select results_eq($$select listing_id, shop_id, item_id, currency_id, price, quantity, required_level, status
  from private.world_shop_listings where shop_id <> 'shop.room_finishes' order by listing_id$$,
  $$values
    ('offer.department_mcm.mcm_jacket'::text, 'shop.department_mcm'::text, 'top.mcm_jacket'::text, 'currency.induck_coin'::text, 480::bigint, 1, 4, 'ACTIVE'::text),
    ('offer.dorm_furniture.campus_rug_blue', 'shop.dorm_furniture', 'furniture.campus_rug_blue', 'currency.induck_coin', 360, 1, 3, 'ACTIVE'),
    ('offer.dorm_furniture.dorm_desk_lamp', 'shop.dorm_furniture', 'furniture.dorm_desk_lamp', 'currency.induck_coin', 280, 1, 2, 'ACTIVE'),
    ('offer.dorm_furniture.induck_chair', 'shop.dorm_furniture', 'furniture.induck_chair', 'currency.induck_coin', 420, 1, 3, 'ACTIVE'),
    ('offer.dorm_furniture.induck_cushion', 'shop.dorm_furniture', 'furniture.induck_cushion', 'currency.induck_coin', 220, 1, 1, 'ACTIVE'),
    ('offer.dorm_furniture.mini_induck', 'shop.dorm_furniture', 'furniture.mini_induck', 'currency.induck_coin', 650, 1, 5, 'ACTIVE'),
    ('offer.student_center.campus_map_poster', 'shop.student_center', 'furniture.campus_map_poster', 'currency.induck_coin', 250, 1, 2, 'ACTIVE'),
    ('offer.student_center.campus_mug', 'shop.student_center', 'memorabilia.campus_mug', 'currency.induck_coin', 120, 1, null, 'ACTIVE'),
    ('offer.student_center.campus_sneakers', 'shop.student_center', 'shoes.campus_sneakers', 'currency.induck_coin', 240, 1, 2, 'ACTIVE'),
    ('offer.student_center.induck_backpack', 'shop.student_center', 'back.induck_backpack', 'currency.induck_coin', 420, 1, 3, 'ACTIVE'),
    ('offer.student_center.induck_cap', 'shop.student_center', 'head.induck_cap', 'currency.induck_coin', 180, 1, 1, 'ACTIVE'),
    ('offer.student_center.induck_hoodie', 'shop.student_center', 'top.induck_hoodie', 'currency.induck_coin', 320, 1, 2, 'ACTIVE')$$,
  'the 12 canonical listings: prices, canonical levels (E0–E5 §10.2.1) and statuses');
select is(array(select listing_id from private.world_shop_listings where shop_id <> 'shop.room_finishes' and required_level is null order by 1),
  array['offer.student_center.campus_mug'], 'only the mug has no level gate; the other 11 carry a canonical required level');
select is((select count(*) from private.world_shop_listings l join private.world_item_catalog c using (item_id)
  where l.shop_id <> 'shop.room_finishes'), 12::bigint,
  'every listing points to a real catalog item');
select hasnt_column('private', 'world_item_catalog', 'price', 'the item catalog carries no price');
select throws_ok($$insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status)
  values ('offer.student_center.sword', 'shop.student_center', 9, 'weapon.sword', 'currency.induck_coin', 10, 'ACTIVE')$$,
  '23503', 'LISTING_UNKNOWN_ITEM', 'a listing must sell a catalog item');
select throws_ok($$insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status)
  values ('offer.student_center.free_hat', 'shop.student_center', 9, 'head.inha_cap', 'currency.induck_coin', 0, 'ACTIVE')$$,
  '23514', null, 'price must be > 0');
select throws_ok($$insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, quantity, status)
  values ('offer.student_center.two_hats', 'shop.student_center', 9, 'head.inha_cap', 'currency.induck_coin', 10, 2, 'ACTIVE')$$,
  '23514', 'LISTING_INVALID_QUANTITY', 'a UNIQUE item is sold one at a time');
select throws_ok($$insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status)
  values ('offer.student_center.gold_hat', 'shop.student_center', 9, 'head.inha_cap', 'currency.gold', 10, 'ACTIVE')$$,
  '23503', null, 'a listing must use a known currency');
select throws_ok($$insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status)
  values ('OFFER_MUG', 'shop.student_center', 9, 'head.inha_cap', 'currency.induck_coin', 10, 'ACTIVE')$$,
  '23514', null, 'listing ids are lowercase offer.<shop>.<name>');
select throws_ok($$insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status)
  values ('offer.student_center.campus_mug', 'shop.student_center', 9, 'head.inha_cap', 'currency.induck_coin', 10, 'ACTIVE')$$,
  '23505', null, 'duplicate listing id is refused');
select is(pg_get_function_identity_arguments('public.purchase_world_shop_listing_v1'::regproc),
  'p_listing_id text, p_idempotency_key text', 'a purchase carries only the listing and a key: no price, item, currency, quantity, user or level');
select is(pg_get_function_identity_arguments('public.get_world_shop_v1'::regproc),
  'p_shop_id text', 'the shop read carries only the shop: no client level');
select hasnt_column('private', 'world_shop_listings', 'player_level', 'the shop stores no player level');
select hasnt_column('private', 'world_player_progression', 'level', 'progression stores EXP, not a level (P0-F0)');
select hasnt_function('private', 'world_shop_listing_block_v1', 'the P0-D LEVEL_AUTHORITY_UNAVAILABLE placeholder is gone');

-- ---- authority ----
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_shops'::regclass, 'private.world_shop_listings'::regclass, 'private.world_purchase_transactions'::regclass)),
  'shop tables have RLS');
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_shops', 'private.world_shop_listings', 'private.world_purchase_transactions']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(has_function_privilege('authenticated', f, 'execute'), format('player can execute %s', f))
from unnest(array['public.get_world_shop_v1(text)', 'public.purchase_world_shop_listing_v1(text,text)']) f;
select ok(not has_function_privilege('anon', f, 'execute'), format('guest cannot execute %s', f))
from unnest(array['public.get_world_shop_v1(text)', 'public.purchase_world_shop_listing_v1(text,text)']) f;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_player_level_v1(uuid)',
                  'private.world_shop_listing_block_v2(private.world_shop_listings,timestamp with time zone,integer)']) f;

-- ---- fixtures (rolled back with this test) ----
insert into private.world_item_catalog values ('memorabilia.p0d_test_ticket', 'MEMORABILIA', 'STACKABLE', 99, 'ACTIVE');
insert into private.world_shops(shop_id, display_name, status) values
  ('shop.p0d_test', '테스트 상점', 'ACTIVE'), ('shop.p0d_disabled', '닫힌 상점', 'DISABLED'), ('shop.p0d_hidden', '숨은 상점', 'HIDDEN');
insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, purchase_limit, start_at, end_at, status) values
  ('offer.p0d_test.cushion', 'shop.p0d_test', 0, 'furniture.induck_cushion', 'currency.induck_coin', 180, null, null, null, 'ACTIVE'),
  ('offer.p0d_test.hidden_rug', 'shop.p0d_test', 1, 'furniture.campus_rug_blue', 'currency.induck_coin', 10, null, null, null, 'HIDDEN'),
  ('offer.p0d_test.future_lamp', 'shop.p0d_test', 2, 'furniture.dorm_desk_lamp', 'currency.induck_coin', 10, null, now() + interval '1 day', null, 'ACTIVE'),
  ('offer.p0d_test.expired_chair', 'shop.p0d_test', 3, 'furniture.induck_chair', 'currency.induck_coin', 10, null, null, now() - interval '1 hour', 'ACTIVE'),
  ('offer.p0d_test.disabled_hoodie', 'shop.p0d_test', 4, 'top.induck_hoodie', 'currency.induck_coin', 10, null, null, null, 'DISABLED'),
  ('offer.p0d_test.ticket', 'shop.p0d_test', 5, 'memorabilia.p0d_test_ticket', 'currency.induck_coin', 10, 2, null, null, 'ACTIVE'),
  ('offer.p0d_test.locked_mug', 'shop.p0d_test', 6, 'memorabilia.campus_mug', 'currency.induck_coin', 10, null, null, null, 'LOCKED'),
  ('offer.p0d_disabled.backpack', 'shop.p0d_disabled', 0, 'back.induck_backpack', 'currency.induck_coin', 10, null, null, null, 'ACTIVE'),
  ('offer.p0d_hidden.mini', 'shop.p0d_hidden', 0, 'furniture.mini_induck', 'currency.induck_coin', 10, null, null, null, 'ACTIVE');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('a6000000-0000-4000-8000-0000000000a6', 'currency.induck_coin', 200, 'REWARD', 'test', 'seed', 'p0d:a6:seed');
select public.world_wallet_credit_v1('b6000000-0000-4000-8000-0000000000b6', 'currency.induck_coin', 100, 'REWARD', 'test', 'seed', 'p0d:b6:seed');
select public.world_wallet_credit_v1('e6000000-0000-4000-8000-0000000000e6', 'currency.induck_coin', 300, 'REWARD', 'test', 'seed', 'p0d:e6:seed');
select public.world_wallet_credit_v1('f6000000-0000-4000-8000-0000000000f6', 'currency.induck_coin', 1000, 'REWARD', 'test', 'seed', 'p0d:f6:seed');
-- Fault for user E: the grant key the next purchase will derive is already used for another item.
select public.world_inventory_grant_item_v1('e6000000-0000-4000-8000-0000000000e6', 'furniture.induck_chair', 1, 'SYSTEM', 'fault',
  'purchase/purchase:e6:cushion/item');
reset role;

-- ---- B. player read ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a6000000-0000-4000-8000-0000000000a6","is_anonymous":false}';
select results_eq($$select o->>'listingId', (o->>'price')::bigint, (o->>'requiredLevel')::int, (o->>'purchasable')::boolean, o->>'unavailableReason'
  from jsonb_array_elements(public.get_world_shop_v1('shop.student_center')->'offers') o$$,
  $$values ('offer.student_center.campus_mug'::text, 120::bigint, null::int, true, null::text),
           ('offer.student_center.induck_cap', 180, 1, true, null),
           ('offer.student_center.campus_sneakers', 240, 2, false, 'LEVEL_REQUIRED'),
           ('offer.student_center.campus_map_poster', 250, 2, false, 'LEVEL_REQUIRED'),
           ('offer.student_center.induck_hoodie', 320, 2, false, 'LEVEL_REQUIRED'),
           ('offer.student_center.induck_backpack', 420, 3, false, 'LEVEL_REQUIRED')$$,
  'Lv.1 (0 EXP): the mug and the Lv.1 cap are purchasable, Lv.2+ offers read LEVEL_REQUIRED');
select is((public.get_world_shop_v1('shop.student_center')->>'playerLevel')::int, 1, 'the read carries the server-derived Lv.1');
reset role;
select is((select count(*) from private.world_player_progression where user_id = 'a6000000-0000-4000-8000-0000000000a6'),
  0::bigint, 'reading the shop provisions no progression row');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a6000000-0000-4000-8000-0000000000a6","is_anonymous":false}';
select is(public.get_world_shop_v1('shop.student_center')->>'displayName', '학생회관 굿즈샵', 'shop display name');
select is(array(select o->>'listingId' from jsonb_array_elements(public.get_world_shop_v1('shop.p0d_test')->'offers') o),
  array['offer.p0d_test.cushion', 'offer.p0d_test.future_lamp', 'offer.p0d_test.expired_chair', 'offer.p0d_test.ticket', 'offer.p0d_test.locked_mug'],
  'HIDDEN and DISABLED listings are not shown');
select is(array(select o->>'unavailableReason' from jsonb_array_elements(public.get_world_shop_v1('shop.p0d_test')->'offers') o),
  array[null, 'LISTING_NOT_STARTED', 'LISTING_EXPIRED', null, 'LISTING_LOCKED'], 'time windows use server time; LOCKED is shown but not sold');
select is(public.get_world_shop_v1('shop.p0d_disabled')->'offers'->0->>'unavailableReason', 'SHOP_INACTIVE', 'a DISABLED shop sells nothing');
select throws_ok($$select public.get_world_shop_v1('shop.p0d_hidden')$$, 'P0001', 'SHOP_NOT_FOUND', 'a HIDDEN shop is not found');
select ok(not exists (select 1 from jsonb_array_elements(public.get_world_shop_v1('shop.student_center')->'offers') o
  where o ? 'purchaseCount' or o ? 'createdAt'), 'no purchase counts or internal metadata in the player read');

-- ---- C. purchase success (A: 200 -> buy 120 -> 80) ----
select results_eq($$select r->>'status', (r->>'replayed')::boolean, r->'item'->>'itemId', (r->'item'->>'quantity')::int,
    (r->'wallet'->>'balanceBefore')::bigint, (r->'wallet'->>'balanceAfter')::bigint, (r->'wallet'->>'price')::bigint
  from (select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:a6:mug') r) s$$,
  $$values ('SUCCESS'::text, false, 'memorabilia.campus_mug'::text, 1, 200::bigint, 80::bigint, 120::bigint)$$,
  'mug bought: 200 -> 80, owned, result from server state');

-- ---- F. same-key idempotency ----
select results_eq($$select r->>'status', (r->>'replayed')::boolean, (r->'wallet'->>'balanceAfter')::bigint
  from (select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:a6:mug') r) s$$,
  $$values ('SUCCESS'::text, true, 80::bigint)$$, 'same key -> the stored purchase is replayed');

-- ---- E. already owned: no debit ----
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:a6:mug-again')$$,
  'P0001', 'ITEM_ALREADY_OWNED', 'buying an owned UNIQUE item again is refused');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.induck_cap', 'purchase:a6:mug')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'a key cannot be reused for another listing');

-- ---- K. purchase limit (STACKABLE fixture, limit 2) ----
select is(public.purchase_world_shop_listing_v1('offer.p0d_test.ticket', 'purchase:a6:ticket1')->'wallet'->>'balanceAfter', '70', 'ticket 1');
select is(public.purchase_world_shop_listing_v1('offer.p0d_test.ticket', 'purchase:a6:ticket2')->'wallet'->>'balanceAfter', '60', 'ticket 2');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.ticket', 'purchase:a6:ticket3')$$,
  'P0001', 'PURCHASE_LIMIT_REACHED', 'the per-account purchase limit is enforced');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.world_wallet_get_balance_v1('a6000000-0000-4000-8000-0000000000a6', 'currency.induck_coin')->>'balance')::bigint,
  60::bigint, 'A wallet: 200 - 120 - 10 - 10');
select is(public.world_inventory_get_item_v1('a6000000-0000-4000-8000-0000000000a6', 'memorabilia.p0d_test_ticket')->'item'->>'quantity',
  '2', 'two tickets owned');
select results_eq($$select x->>'sourceType', x->>'sourceRef'
  from (select public.world_inventory_get_item_v1('a6000000-0000-4000-8000-0000000000a6', 'memorabilia.campus_mug')->'item' x) s$$,
  $$values ('SHOP'::text, 'offer.student_center.campus_mug'::text)$$, 'the mug carries the listing as provenance');
reset role;
select results_eq($$select type, amount, source_type, source_id, idempotency_key from private.world_currency_transactions
  where user_id = 'a6000000-0000-4000-8000-0000000000a6' and type = 'PURCHASE' and source_id = 'offer.student_center.campus_mug'$$,
  $$values ('PURCHASE'::text, -120::bigint, 'shop'::text, 'offer.student_center.campus_mug'::text, 'purchase/purchase:a6:mug/wallet'::text)$$,
  'the debit went through the P0-A ledger once');
select is((select count(*) from private.world_purchase_transactions where user_id = 'a6000000-0000-4000-8000-0000000000a6'),
  3::bigint, 'mug + 2 tickets recorded; replay and refusals added nothing');
select is((select count(*) from private.world_item_grants where grant_id = 'purchase/purchase:a6:mug/item'), 1::bigint,
  'one grant through the P0-B path');

-- ---- D + I + J. refusals move nothing (B: 100 coins) ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b6000000-0000-4000-8000-0000000000b6","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:b6:mug')$$,
  'P0001', 'INSUFFICIENT_FUNDS', '100 coins cannot buy a 120 mug');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_sneakers', 'purchase:b6:sneakers')$$,
  'P0001', 'LEVEL_REQUIRED', 'Lv.1 buying a Lv.2 listing is refused by the level gate, ahead of the funds check');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.induck_cap', 'purchase:b6:cap')$$,
  'P0001', 'INSUFFICIENT_FUNDS', 'a met Lv.1 gate falls through to the funds check (100 < 180)');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.locked_mug', 'purchase:b6:locked')$$,
  'P0001', 'LISTING_LOCKED', 'a LOCKED listing is not sold');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.nowhere.nothing', 'purchase:b6:unknown')$$,
  'P0001', 'INVALID_LISTING', 'unknown listing');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.hidden_rug', 'purchase:b6:hidden')$$,
  'P0001', 'INVALID_LISTING', 'HIDDEN listing');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.disabled_hoodie', 'purchase:b6:disabled')$$,
  'P0001', 'LISTING_INACTIVE', 'DISABLED listing');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_disabled.backpack', 'purchase:b6:closed')$$,
  'P0001', 'SHOP_INACTIVE', 'DISABLED shop');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_hidden.mini', 'purchase:b6:hiddenshop')$$,
  'P0001', 'INVALID_LISTING', 'listing in a HIDDEN shop');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.future_lamp', 'purchase:b6:future')$$,
  'P0001', 'LISTING_NOT_STARTED', 'not started (server time)');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.expired_chair', 'purchase:b6:expired')$$,
  'P0001', 'LISTING_EXPIRED', 'expired (server time)');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', null)$$,
  '22023', 'INVALID_IDEMPOTENCY_KEY', 'key is required');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:a6:mug')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'another account''s key is refused');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 120, 'purchase:b6:price')$$,
  '42883', null, 'a client-chosen price is not even a callable signature');
reset role;
update private.world_item_catalog set status = 'DISABLED' where item_id = 'furniture.induck_cushion';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b6000000-0000-4000-8000-0000000000b6","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.cushion', 'purchase:b6:cushion')$$,
  'P0001', 'ITEM_UNAVAILABLE', 'a DISABLED catalog item is not sold');
reset role;
update private.world_item_catalog set status = 'COMING_SOON' where item_id = 'furniture.induck_cushion';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.world_wallet_get_balance_v1('b6000000-0000-4000-8000-0000000000b6', 'currency.induck_coin')->>'balance')::bigint,
  100::bigint, 'B still has 100 after every refusal');
select is((public.world_inventory_list_v1('b6000000-0000-4000-8000-0000000000b6')->'items'), '[]'::jsonb, 'B owns nothing');
reset role;
select is((select count(*) from private.world_purchase_transactions where user_id = 'b6000000-0000-4000-8000-0000000000b6'),
  0::bigint, 'no purchase rows for refusals');
select is((select count(*) from private.world_currency_transactions where user_id = 'b6000000-0000-4000-8000-0000000000b6'),
  1::bigint, 'only the seed credit in B''s ledger');

-- ---- P0-F2 level gate: every canonical listing, Lv.1 -> Lv.5 (F: 5000 coins) ----
-- Level comes only from P0-F0 EXP (service_role grants); the player never supplies it.
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('f6000000-0000-4000-8000-0000000000f6', 'currency.induck_coin', 4000, 'REWARD', 'test', 'seed', 'p0f2:f6:seed');
reset role;
create temp table p0f2_levels(listing_id text primary key, required_level int, price bigint) on commit drop;
insert into p0f2_levels select listing_id, required_level, price from private.world_shop_listings
  where required_level is not null and shop_id in ('shop.student_center', 'shop.dorm_furniture', 'shop.department_mcm');
grant select on p0f2_levels to authenticated;
select is((select count(*) from p0f2_levels), 11::bigint, '11 level-gated canonical listings');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f6000000-0000-4000-8000-0000000000f6","is_anonymous":false}';
-- Lv.1: everything above Lv.1 is refused, including by the purchase RPC called directly.
select throws_ok(format('select public.purchase_world_shop_listing_v1(%L, %L)', listing_id, 'purchase:f6:' || listing_id),
  'P0001', 'LEVEL_REQUIRED', format('Lv.1: %s (Lv.%s) is refused', listing_id, required_level))
from p0f2_levels where required_level > 1 order by listing_id;
reset role;
select is((select balance from private.world_wallets where user_id = 'f6000000-0000-4000-8000-0000000000f6'), 5000::bigint,
  'no coin moved for any LEVEL_REQUIRED refusal');
select is((select count(*) from private.world_currency_transactions
  where user_id = 'f6000000-0000-4000-8000-0000000000f6' and type = 'PURCHASE'), 0::bigint, 'no debit ledger row for refusals');
select is((select count(*) from private.world_player_items where user_id = 'f6000000-0000-4000-8000-0000000000f6'), 0::bigint,
  'no ownership from refused listings');
select is((select count(*) from private.world_item_grants where user_id = 'f6000000-0000-4000-8000-0000000000f6'), 0::bigint,
  'no grant log row from refused listings');
select is((select count(*) from private.world_purchase_transactions where user_id = 'f6000000-0000-4000-8000-0000000000f6'), 0::bigint,
  'no purchase rows from refused listings');

-- Forged client "level": JWT claims are not a level source.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f6000000-0000-4000-8000-0000000000f6","is_anonymous":false,"level":99,"app_metadata":{"level":99},"user_metadata":{"level":99}}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.dorm_furniture.mini_induck', 'purchase:f6:forged-claims')$$,
  'P0001', 'LEVEL_REQUIRED', 'a forged level claim in the JWT does not pass the gate');
select is((public.get_world_shop_v1('shop.dorm_furniture')->>'playerLevel')::int, 1, 'a forged claim does not change the read level');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.dorm_furniture.mini_induck', 'purchase:f6:arg', 5)$$,
  '42883', null, 'a client-chosen level is not even a callable signature');
select throws_ok($$select public.world_exp_grant_v1('f6000000-0000-4000-8000-0000000000f6', 1000, 'client', 'x', 'p0f2:f6:self-grant')$$,
  '42501', null, 'a player cannot grant itself EXP');
select throws_ok($$select private.world_exp_apply_v1('f6000000-0000-4000-8000-0000000000f6', 1000, 'client', 'x', 'p0f2:f6:self-apply')$$,
  '42501', null, 'a player cannot reach the EXP core');
select throws_ok($$insert into private.world_player_progression(user_id, total_exp) values ('f6000000-0000-4000-8000-0000000000f6', 1000)$$,
  '42501', null, 'a player cannot write its EXP projection');
select throws_ok($$select private.world_player_level_v1('f6000000-0000-4000-8000-0000000000f6')$$,
  '42501', null, 'a player cannot call the level helper');
select is((public.get_my_world_progression_v1()->>'level')::int, 1, 'still Lv.1 after every forgery attempt');

-- Lv.1 listings are purchasable at Lv.1.
select is(public.purchase_world_shop_listing_v1('offer.student_center.induck_cap', 'purchase:f6:offer.student_center.induck_cap')->>'status',
  'SUCCESS', 'Lv.1 buys the Lv.1 cap');
select is(public.purchase_world_shop_listing_v1('offer.dorm_furniture.induck_cushion', 'purchase:f6:offer.dorm_furniture.induck_cushion')->>'status',
  'SUCCESS', 'Lv.1 buys the Lv.1 cushion');
reset role;

-- Lv.2 (100 EXP): the same keys that were refused at Lv.1 now buy, so a refusal stored nothing.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1('f6000000-0000-4000-8000-0000000000f6', 100, 'test', 'p0f2', 'p0f2:f6:exp1')->>'levelAfter',
  '2', '100 EXP -> Lv.2');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f6000000-0000-4000-8000-0000000000f6","is_anonymous":false}';
select results_eq($$select o->>'listingId', (o->>'purchasable')::boolean, o->>'unavailableReason'
  from jsonb_array_elements(public.get_world_shop_v1('shop.dorm_furniture')->'offers') o$$,
  $$values ('offer.dorm_furniture.induck_cushion'::text, true, null::text),
           ('offer.dorm_furniture.dorm_desk_lamp', true, null),
           ('offer.dorm_furniture.campus_rug_blue', false, 'LEVEL_REQUIRED'),
           ('offer.dorm_furniture.induck_chair', false, 'LEVEL_REQUIRED'),
           ('offer.dorm_furniture.mini_induck', false, 'LEVEL_REQUIRED')$$,
  'Lv.2: the read re-evaluates every offer against the new server level');
select is((public.get_world_shop_v1('shop.dorm_furniture')->>'playerLevel')::int, 2, 'the read shows Lv.2');
select is(public.purchase_world_shop_listing_v1(listing_id, 'purchase:f6:' || listing_id)->>'status', 'SUCCESS',
  format('Lv.2: %s (Lv.2) bought with the key refused at Lv.1', listing_id))
from p0f2_levels where required_level = 2 order by listing_id;
select throws_ok(format('select public.purchase_world_shop_listing_v1(%L, %L)', listing_id, 'purchase:f6:' || listing_id),
  'P0001', 'LEVEL_REQUIRED', format('Lv.2: %s (Lv.%s) still refused', listing_id, required_level))
from p0f2_levels where required_level > 2 order by listing_id;
-- Replay of a level-gated purchase: same result, nothing moves again.
select results_eq($$select r->>'status', (r->>'replayed')::boolean
  from (select public.purchase_world_shop_listing_v1('offer.student_center.campus_sneakers', 'purchase:f6:offer.student_center.campus_sneakers') r) s$$,
  $$values ('SUCCESS'::text, true)$$, 'a completed level-gated purchase replays');
reset role;

-- Lv.3 (300), Lv.4 (600), Lv.5 (1000): each tier unlocks exactly its listings.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1('f6000000-0000-4000-8000-0000000000f6', 200, 'test', 'p0f2', 'p0f2:f6:exp2')->>'levelAfter', '3', '300 EXP -> Lv.3');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f6000000-0000-4000-8000-0000000000f6","is_anonymous":false}';
select is(public.purchase_world_shop_listing_v1(listing_id, 'purchase:f6:' || listing_id)->>'status', 'SUCCESS',
  format('Lv.3: %s bought', listing_id))
from p0f2_levels where required_level = 3 order by listing_id;
select throws_ok(format('select public.purchase_world_shop_listing_v1(%L, %L)', listing_id, 'purchase:f6:' || listing_id),
  'P0001', 'LEVEL_REQUIRED', format('Lv.3: %s (Lv.%s) still refused', listing_id, required_level))
from p0f2_levels where required_level > 3 order by listing_id;
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1('f6000000-0000-4000-8000-0000000000f6', 300, 'test', 'p0f2', 'p0f2:f6:exp3')->>'levelAfter', '4', '600 EXP -> Lv.4');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f6000000-0000-4000-8000-0000000000f6","is_anonymous":false}';
select is(public.purchase_world_shop_listing_v1('offer.department_mcm.mcm_jacket', 'purchase:f6:offer.department_mcm.mcm_jacket')->>'status',
  'SUCCESS', 'Lv.4: 과잠 bought');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.dorm_furniture.mini_induck', 'purchase:f6:offer.dorm_furniture.mini_induck')$$,
  'P0001', 'LEVEL_REQUIRED', 'Lv.4: the Lv.5 mini figure is still refused');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1('f6000000-0000-4000-8000-0000000000f6', 400, 'test', 'p0f2', 'p0f2:f6:exp4')->>'levelAfter', '5', '1000 EXP -> Lv.5');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f6000000-0000-4000-8000-0000000000f6","is_anonymous":false}';
select is(public.purchase_world_shop_listing_v1('offer.dorm_furniture.mini_induck', 'purchase:f6:offer.dorm_furniture.mini_induck')->>'status',
  'SUCCESS', 'Lv.5: the mini figure is bought');
select ok(not exists (select 1 from jsonb_array_elements(public.get_world_shop_v1(s)->'offers') o
  where o->>'unavailableReason' = 'LEVEL_REQUIRED'), format('Lv.5: nothing in %s is level-locked', s))
from unnest(array['shop.student_center', 'shop.dorm_furniture', 'shop.department_mcm']) s;
reset role;
select is((select balance from private.world_wallets where user_id = 'f6000000-0000-4000-8000-0000000000f6'),
  (5000 - (select sum(price) from p0f2_levels))::bigint, 'F paid exactly the 11 listing prices, once each');
select is((select count(*) from private.world_purchase_transactions where user_id = 'f6000000-0000-4000-8000-0000000000f6'),
  11::bigint, 'one purchase row per level-gated listing; refusals and the replay added none');
select is((select count(*) from private.world_currency_transactions
  where user_id = 'f6000000-0000-4000-8000-0000000000f6' and type = 'PURCHASE'), 11::bigint, 'one debit per purchase');
select is((select count(*) from private.world_player_items where user_id = 'f6000000-0000-4000-8000-0000000000f6'),
  11::bigint, 'all 11 level-gated items owned');
select is((select total_exp from private.world_player_progression where user_id = 'f6000000-0000-4000-8000-0000000000f6'),
  1000::bigint, 'the shop never touched EXP');

-- ---- P0-F2 account isolation: F's Lv.5 does not lift G (Lv.1, 1000 coins) ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('a7000000-0000-4000-8000-0000000000a7', 'currency.induck_coin', 1000, 'REWARD', 'test', 'seed', 'p0f2:a7:seed');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7000000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select is((public.get_world_shop_v1('shop.student_center')->>'playerLevel')::int, 1, 'G reads its own Lv.1, not F''s Lv.5');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_sneakers', 'purchase:a7:sneakers')$$,
  'P0001', 'LEVEL_REQUIRED', 'G is still gated at Lv.1');
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_sneakers', 'purchase:f6:offer.student_center.campus_sneakers')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'G cannot ride F''s completed level-gated purchase key');
reset role;
select is((select balance from private.world_wallets where user_id = 'a7000000-0000-4000-8000-0000000000a7'), 1000::bigint,
  'G''s coins are unchanged');
select is((select count(*) from private.world_player_items where user_id = 'a7000000-0000-4000-8000-0000000000a7'), 0::bigint,
  'G owns nothing');

-- ---- atomic rollback: the grant fails after the debit ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e6000000-0000-4000-8000-0000000000e6","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.p0d_test.cushion', 'purchase:e6:cushion')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'the ownership grant fails after the debit');
reset role;
select is((select balance from private.world_wallets where user_id = 'e6000000-0000-4000-8000-0000000000e6'), 300::bigint,
  'the debit was rolled back with the failed grant');
select is((select count(*) from private.world_currency_transactions where idempotency_key = 'purchase/purchase:e6:cushion/wallet'),
  0::bigint, 'no debit ledger row survived');
select is((select count(*) from private.world_player_items where user_id = 'e6000000-0000-4000-8000-0000000000e6'
  and item_id = 'furniture.induck_cushion'), 0::bigint, 'no ownership');
select is((select count(*) from private.world_purchase_transactions where user_id = 'e6000000-0000-4000-8000-0000000000e6'),
  0::bigint, 'no purchase row');

-- ---- guests, banned accounts, forgery ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c6000000-0000-4000-8000-0000000000c6","is_anonymous":true}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:c6:mug')$$,
  '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous sessions cannot buy');
set local request.jwt.claims = '{"role":"authenticated","sub":"d6000000-0000-4000-8000-0000000000d6","is_anonymous":false}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:d6:mug')$$,
  '42501', 'ACCOUNT_UNAVAILABLE', 'banned accounts cannot buy');
set local request.jwt.claims = '{"role":"authenticated","sub":"a6000000-0000-4000-8000-0000000000a6","is_anonymous":false}';
select throws_ok($$update private.world_shop_listings set price = 1$$, '42501', null, 'player cannot change a price');
select throws_ok($$insert into private.world_shops(shop_id, display_name, status) values ('shop.mine', 'x', 'ACTIVE')$$,
  '42501', null, 'player cannot create a shop');
select throws_ok($$insert into private.world_purchase_transactions(user_id, shop_id, listing_id, item_id, quantity, currency_id, price,
  balance_before, balance_after, wallet_transaction_id, inventory_grant_id, idempotency_key)
  values ('a6000000-0000-4000-8000-0000000000a6', 'shop.student_center', 'offer.student_center.campus_mug', 'memorabilia.campus_mug', 1,
  'currency.induck_coin', 120, 120, 0, gen_random_uuid(), 'x', 'forged')$$, '42501', null, 'player cannot forge a purchase');
select throws_ok($$select * from private.world_purchase_transactions$$, '42501', null, 'player cannot read raw purchases');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.purchase_world_shop_listing_v1('offer.student_center.campus_mug', 'purchase:anon:mug')$$,
  '42501', null, 'guest cannot buy');
reset role;
select throws_ok($$update private.world_purchase_transactions set price = 1$$, '42501', 'PURCHASE_APPEND_ONLY',
  'purchase records are never updated');

select * from finish();
rollback;
