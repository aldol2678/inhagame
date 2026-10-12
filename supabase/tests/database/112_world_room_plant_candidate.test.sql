-- Disposable fixtures only. Every candidate activation and synthetic user is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select is(private.world_room_plant_enabled_v1(),false,'server candidate defaults CLOSED');
select is((select status from private.world_item_catalog where item_id='furniture.indoor_planter'),'COMING_SOON','starter not activated');
select is((select ownership_policy from private.world_item_catalog where item_id='furniture.indoor_planter'),'UNIQUE','one owned planter');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.world_room_plants'::regclass,'private.world_room_plant_receipts'::regclass)),'new tables have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r, unnest(array['private.world_room_plants','private.world_room_plant_receipts']) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege('anon','public.claim_my_room_planter_v1(uuid)','execute'),'anon cannot claim');
select ok(not has_function_privilege('authenticated','private.world_room_plant_command_v1(uuid,uuid,integer,uuid,text)','execute'),'private generic command unavailable');
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1120000-0000-4000-8000-000000000001','authenticated','authenticated','plant-a@example.test',now(),false),
 ('a1120000-0000-4000-8000-000000000002','authenticated','authenticated','plant-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a1120000-0000-4000-8000-000000000001','화분A',false),('a1120000-0000-4000-8000-000000000002','화분B',false);
insert into public.world_player_rooms(id,owner_user_id) values
 ('b1120000-0000-4000-8000-000000000001','a1120000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims='{"sub":"a1120000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.claim_my_room_planter_v1('b1120000-0000-4000-8000-000000000001')$$,'P0001','PLANT_UNAVAILABLE','closed claim writes nothing');
reset role;
-- Local transaction fixture only; independent ACTIVE catalog is also required.
create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select true$$;
set local role authenticated;
select throws_ok($$select public.claim_my_room_planter_v1('b1120000-0000-4000-8000-000000000001')$$,'P0001','PLANT_UNAVAILABLE','item gate also required');
reset role;
update private.world_item_catalog set status='ACTIVE' where item_id='furniture.indoor_planter';
set local role authenticated;
select is(public.claim_my_room_planter_v1('b1120000-0000-4000-8000-000000000001')->'inventory'->>'status','GRANTED','one free grant');
select is(public.claim_my_room_planter_v1('b1120000-0000-4000-8000-000000000001')->'inventory'->>'status','ALREADY_PROCESSED','stable server key');
select throws_ok($$select public.plant_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001','d1120000-0000-4000-8000-000000000001')$$,
 '42501','PLANTER_REQUIRED','unsaved object cannot plant');
select lives_ok($$select public.save_my_room_furniture_v1('b1120000-0000-4000-8000-000000000001',0,
 '[{"id":"c1120000-0000-4000-8000-000000000001","itemId":"furniture.indoor_planter","surface":"floor","x":-6,"z":0,"yaw":0}]')$$,'real H2 accepts owned candidate');
select is(public.plant_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001','d1120000-0000-4000-8000-000000000001')->>'plantRevision','1','plant once');
select is(public.plant_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001','d1120000-0000-4000-8000-000000000001')->>'plantRevision','1','same request replay');
select throws_ok($$select public.plant_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001','d1120000-0000-4000-8000-000000000009')$$,
 'P0001','PLANT_ALREADY_PLANTED','no replant');
select is(public.care_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001',1,'d1120000-0000-4000-8000-000000000002')->>'plantRevision','2','first care');
select throws_ok($$select public.care_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001',1,'d1120000-0000-4000-8000-000000000003')$$,
 '40001','PLANT_CONFLICT','new request cannot reuse prior revision');
select throws_ok($$select public.care_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000001',2,'d1120000-0000-4000-8000-000000000003')$$,
 'P0001','PLANT_NOT_READY','no early watering');
reset role;
select is((select count(*)::integer from private.world_room_plant_receipts where user_id='a1120000-0000-4000-8000-000000000001'),2,'no-op/error creates no receipt');
select throws_ok($$update private.world_room_plant_receipts set receipt=receipt$$,'42501','PLANT_RECEIPT_APPEND_ONLY','immutable proof');
select is(private.world_room_plant_growth_v1('2026-10-01 00:00Z',null,'2026-10-01 19:59:59.999Z')->>'stage','SPROUT','before exact deadline');
select is(private.world_room_plant_growth_v1('2026-10-01 00:00Z',null,'2026-10-01 20:00Z')->>'stage','BUD','exact 20h');
select is(private.world_room_plant_growth_v1('2026-10-01 00:00Z',null,'2036-10-01 20:00Z')->>'stage','BUD','late care waits forever');
select is(private.world_room_plant_growth_v1('2026-10-01 00:00Z','2026-10-01 20:00Z','2026-10-02 16:00Z')->>'stage','BLOOM','second exact 20h');
select is(private.world_room_plant_growth_v1('2026-10-01 00:00Z','2026-10-01 20:00Z','2036-10-02 16:00Z')->>'stage','BLOOM','flower never decays');
set local role authenticated;
select public.save_my_room_furniture_v1('b1120000-0000-4000-8000-000000000001',1,'[]');
select is(public.get_world_room_plants_v1('b1120000-0000-4000-8000-000000000001')->'plant'->>'objectId',null::text,'recall removes visible target');
select is(public.get_world_room_plants_v1('b1120000-0000-4000-8000-000000000001')->'plant'->>'revision','2','recall preserves growth');
select public.save_my_room_furniture_v1('b1120000-0000-4000-8000-000000000001',2,
 '[{"id":"c1120000-0000-4000-8000-000000000002","itemId":"furniture.indoor_planter","surface":"floor","x":-6,"z":0,"yaw":0}]');
select is(public.get_world_room_plants_v1('b1120000-0000-4000-8000-000000000001')->'plant'->>'objectId','c1120000-0000-4000-8000-000000000002','new placement UUID has old flower');
set local request.jwt.claims='{"sub":"a1120000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.get_world_room_plants_v1('b1120000-0000-4000-8000-000000000001')$$,'42501','PLANT_ACCESS_DENIED','stranger cannot read owner state');
select throws_ok($$select public.care_my_room_plant_v1('b1120000-0000-4000-8000-000000000001','c1120000-0000-4000-8000-000000000002',2,'d1120000-0000-4000-8000-000000000008')$$,
 '42501','PLANT_ACCESS_DENIED','other user cannot care');
reset role;
select * from finish();
rollback;
