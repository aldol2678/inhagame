begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('c2000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'main2-a@example.test', now(), false),
 ('d2000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'main2-b@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('c2000000-0000-4000-8000-0000000000c2', '메인2A', false),
 ('d2000000-0000-4000-8000-0000000000d2', '메인2B', false);

select ok(not has_function_privilege('anon', 'public.advance_world_navigation_quest_v1(uuid,text)', 'execute'),
  'guest cannot advance Main 2');
select ok(not has_function_privilege('authenticated', 'public.advance_world_navigation_quest_v1(uuid,text)', 'execute'),
  'player cannot advance Main 2 directly');
select ok(has_function_privilege('service_role', 'public.advance_world_navigation_quest_v1(uuid,text)', 'execute'),
  'server can advance Main 2');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','status')->>'available')::boolean,
  false, 'Main 2 stays unavailable before Main 1 completion');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','start')->>'stage')::int,
  0, 'Main 2 cannot start before Main 1');

select public.advance_world_quest_v1('c2000000-0000-4000-8000-0000000000c2','start');
select public.advance_world_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_main_hall');
select public.advance_world_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_inkyung');
select public.advance_world_quest_v1('c2000000-0000-4000-8000-0000000000c2','talk_002');
select public.advance_world_quest_v1('c2000000-0000-4000-8000-0000000000c2','talk_001');

select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','status')->>'available')::boolean,
  true, 'Main 1 completion unlocks Main 2');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','start')->>'stage')::int,1,'Back Gate starts Main 2');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_building5')->>'stage')::int,1,'cannot skip destination setup');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','set_building5_destination')->>'stage')::int,2,'Building 5 destination advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','start_auto_building5')->>'stage')::int,3,'Building 5 auto-move advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_building5')->>'stage')::int,3,'cannot skip pause/resume tutorial');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','pause_auto_building5')->>'stage')::int,4,'Building 5 auto-move pause advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','resume_auto_building5')->>'stage')::int,5,'Building 5 auto-move resume advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_building5')->>'stage')::int,6,'Building 5 arrival advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','set_back_gate_destination')->>'stage')::int,7,'Back Gate destination advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_back_gate')->>'stage')::int,7,'return cannot complete without auto-move');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','start_auto_back_gate')->>'stage')::int,8,'Back Gate auto-move advances');
select is((public.advance_world_navigation_quest_v1('c2000000-0000-4000-8000-0000000000c2','visit_back_gate')->>'stage')::int,9,'Back Gate arrival completes Main 2');
select is((public.advance_world_navigation_quest_v1('d2000000-0000-4000-8000-0000000000d2','status')->>'stage')::int,0,'second account remains untouched');

reset role;
select * from finish();
rollback;
