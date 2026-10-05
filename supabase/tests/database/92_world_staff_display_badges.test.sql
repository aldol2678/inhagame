begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Synthetic identities only. The query never writes assignments in real deployments.
insert into auth.users(id,aud,role,email,is_anonymous) values
 ('bb100000-0000-4000-8000-000000000001','authenticated','authenticated','badge-player@example.test',false),
 ('bb200000-0000-4000-8000-000000000002','authenticated','authenticated','badge-admin@example.test',false),
 ('bb300000-0000-4000-8000-000000000003','authenticated','authenticated','badge-sound@example.test',false),
 ('bb400000-0000-4000-8000-000000000004','authenticated','authenticated','badge-retired@example.test',false);
insert into private.world_staff_assignments(user_id,role,active) values
 ('bb200000-0000-4000-8000-000000000002','world_admin',true),
 ('bb300000-0000-4000-8000-000000000003','sound_gm',true),
 ('bb400000-0000-4000-8000-000000000004','world_admin',false);

select ok(not has_function_privilege('anon','public.get_world_staff_badges_v1(uuid[])','execute'),'unauthenticated calls are sealed');
select ok(has_function_privilege('authenticated','public.get_world_staff_badges_v1(uuid[])','execute'),'World sessions can read display markers');
select ok(not has_table_privilege('authenticated','private.world_staff_assignments','select'),'role table stays private');
select set_config('request.jwt.claims','{}',true);
select is((select count(*) from public.get_world_staff_badges_v1(array['bb200000-0000-4000-8000-000000000002'::uuid])),0::bigint,'missing auth identity reveals nothing');

select set_config('request.jwt.claims','{"sub":"bb100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
select results_eq(
 $$select * from public.get_world_staff_badges_v1(array[
 'bb100000-0000-4000-8000-000000000001'::uuid,'bb200000-0000-4000-8000-000000000002'::uuid,
 'bb300000-0000-4000-8000-000000000003'::uuid,'bb400000-0000-4000-8000-000000000004'::uuid,
 'bb200000-0000-4000-8000-000000000002'::uuid])$$,
 $$values ('bb200000-0000-4000-8000-000000000002'::uuid,'gm'::text),('bb300000-0000-4000-8000-000000000003'::uuid,'gm'::text)$$,
 'only requested active staff get one generic display marker');
select is((select count(*) from public.get_world_staff_badges_v1(array['bb100000-0000-4000-8000-000000000001'::uuid])),0::bigint,'ordinary caller cannot give itself a badge');
select is((select count(*) from public.get_world_staff_badges_v1(null)),0::bigint,'null cannot enumerate staff');
select is((select count(*) from public.get_world_staff_badges_v1('{}'::uuid[])),0::bigint,'empty input cannot enumerate staff');
select is((select count(*) from public.get_world_staff_badges_v1(array_fill('bb200000-0000-4000-8000-000000000002'::uuid,array[65]))),0::bigint,'oversized lookup reveals nothing');
select is((select count(*) from public.get_world_staff_badges_v1(array_fill('bb200000-0000-4000-8000-000000000002'::uuid,array[64]))),1::bigint,'maximum bounded lookup works');
select is(public.get_my_world_admin_access_v1()->>'isAdmin','false','display lookup never grants admin access');

-- Anonymous Supabase users join World through the authenticated database role.
select set_config('request.jwt.claims','{"sub":"bb100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
select is((select badge_code from public.get_world_staff_badges_v1(array['bb200000-0000-4000-8000-000000000002'::uuid])),'gm','World guests can see existing staff nameplates');
reset role;
select is((select count(*) from private.world_staff_assignments where user_id::text like 'bb%'),3::bigint,'display reads do not assign staff');
select * from finish();
rollback;
