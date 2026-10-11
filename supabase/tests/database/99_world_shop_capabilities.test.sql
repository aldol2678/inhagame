begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select ok((select prosecdef and provolatile = 's' and proconfig = array['search_path=""']
  from pg_proc where oid = 'public.get_world_shop_capabilities_v1()'::regprocedure),
  'capability is STABLE with a pinned empty definer search path');
select ok(has_function_privilege('authenticated', 'public.get_world_shop_capabilities_v1()', 'execute'), 'authenticated can read capability');
select ok(not has_function_privilege(r, 'public.get_world_shop_capabilities_v1()', 'execute'), r || ' has no capability permission')
from unnest(array['anon', 'service_role']) r;
insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('b8200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'shop-capability@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('b8200000-0000-4000-8000-000000000001', '상점호환', false);
create temp table catalog_before_read on commit drop as
  select jsonb_agg(to_jsonb(l) order by listing_id) as value from private.world_shop_listings l;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8200000-0000-4000-8000-000000000001","is_anonymous":false}';
select is(public.get_world_shop_capabilities_v1(),
 '{"version":1,"purchaseRpc":"purchase_world_shop_listing_v2","catalogLayout":"split"}'::jsonb,
 'fully replayed development catalog reports split plus executable v2');
reset role;
select is((select jsonb_agg(to_jsonb(l) order by listing_id) from private.world_shop_listings l),
 (select value from catalog_before_read), 'capability read does not change the catalog');
select is((select count(*) from private.world_wallets where user_id = 'b8200000-0000-4000-8000-000000000001'), 0::bigint,
 'capability read provisions no wallet');
select is((select count(*) from private.world_player_items where user_id = 'b8200000-0000-4000-8000-000000000001'), 0::bigint,
 'capability read grants no item');

-- Availability remains authoritative in the regular shop read, independent of layout.
update private.world_shops set status = 'HIDDEN' where shop_id = 'shop.student_center_fashion';
update private.world_shop_listings set status = 'DISABLED' where listing_id = 'offer.student_center.induck_cap';
set local role authenticated;
select is(public.get_world_shop_capabilities_v1()->>'catalogLayout', 'split', 'inactive stock is never activated by layout detection');
reset role;
-- v1-only with split catalog must be rejected by the client; the capability reports facts.
revoke execute on function public.purchase_world_shop_listing_v2(text,text,text) from authenticated;
set local role authenticated;
select is(public.get_world_shop_capabilities_v1(),
 '{"version":1,"purchaseRpc":"purchase_world_shop_listing_v1","catalogLayout":"split"}'::jsonb,
 'function existence alone is insufficient: revoked v2 selects v1 metadata');
reset role;
grant execute on function public.purchase_world_shop_listing_v2(text,text,text) to authenticated;

-- Reconstruct API-prepared, catalog-not-yet-moved stage without changing durable IDs.
update private.world_shop_listings set shop_id = 'shop.student_center' where shop_id = 'shop.student_center_fashion';
update private.world_shop_listings set shop_id = 'shop.student_center', position = 3
 where listing_id = 'offer.student_center.campus_map_poster';
set local role authenticated;
select is(public.get_world_shop_capabilities_v1(),
 '{"version":1,"purchaseRpc":"purchase_world_shop_listing_v2","catalogLayout":"legacy"}'::jsonb,
 'API prepared leaves the original six-listing catalog intact');
reset role;
drop function public.purchase_world_shop_listing_v2(text,text,text);
set local role authenticated;
select is(public.get_world_shop_capabilities_v1(),
 '{"version":1,"purchaseRpc":"purchase_world_shop_listing_v1","catalogLayout":"legacy"}'::jsonb,
 'capability can describe a legacy database with no v2 installed');
reset role;
update private.world_shop_listings set shop_id = 'shop.student_center_fashion'
 where listing_id = 'offer.student_center.induck_cap';
set local role authenticated;
select is(public.get_world_shop_capabilities_v1()->>'catalogLayout', 'mixed', 'partial split fails closed');
reset role;
delete from private.world_shop_listings where listing_id = 'offer.student_center.induck_hoodie';
set local role authenticated;
select is(public.get_world_shop_capabilities_v1()->>'catalogLayout', 'mixed', 'missing durable listing cannot masquerade as a ready layout');
reset role;
revoke execute on function public.purchase_world_shop_listing_v1(text,text) from authenticated;
set local role authenticated;
select throws_ok($$select public.get_world_shop_capabilities_v1()$$, 'P0001', 'SHOP_API_UNAVAILABLE', 'no executable purchase API is not falsely advertised');
reset role;
grant execute on function public.purchase_world_shop_listing_v1(text,text) to authenticated;
update public.profiles set is_banned = true where user_id = 'b8200000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_world_shop_capabilities_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot probe capabilities');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8200000-0000-4000-8000-000000000001","is_anonymous":true}';
select throws_ok($$select public.get_world_shop_capabilities_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous account cannot probe capabilities');
set local request.jwt.claims = '{}';
select throws_ok($$select public.get_world_shop_capabilities_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'missing account cannot probe capabilities');
reset role;
select * from finish();
rollback;
