begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a2000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'quest-a@example.test', now(), false),
 ('b2000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'quest-b@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a2000000-0000-4000-8000-0000000000a2', '퀘스트A', false),
 ('b2000000-0000-4000-8000-0000000000b2', '퀘스트B', false);

select has_table('private', 'world_quest_progress_v1', 'account quest table exists');
select ok((select relrowsecurity from pg_class where oid = 'private.world_quest_progress_v1'::regclass), 'quest table has RLS');
select ok(not has_function_privilege('anon', 'public.advance_world_quest_v1(uuid,text)', 'execute'), 'guest cannot advance');
select ok(not has_function_privilege('authenticated', 'public.advance_world_quest_v1(uuid,text)', 'execute'), 'player cannot advance directly');
select ok(has_function_privilege('service_role', 'public.advance_world_quest_v1(uuid,text)', 'execute'), 'server can advance');
select ok(not has_table_privilege('authenticated', 'private.world_quest_progress_v1', 'select'), 'player cannot read quest table');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a2000000-0000-4000-8000-0000000000a2"}';
select throws_ok($$select public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'start')$$,
  '42501', null, 'authenticated role cannot invoke quest RPC');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'status')->>'stage')::int, 0, 'quest is initially unstarted');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'visit_main_hall')->>'stage')::int, 0, 'visit cannot start quest');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'start')->>'stage')::int, 1, 'Nana-yul starts quest');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'start')->>'stage')::int, 1, 'duplicate start is idempotent');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'talk_002')->>'stage')::int, 1, 'guide cannot be skipped to');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'visit_main_hall')->>'stage')::int, 2, 'main hall advances');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'visit_inkyung')->>'stage')::int, 3, 'pond advances');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'talk_002')->>'stage')::int, 4, 'Ga-yudam hands off');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'talk_001')->>'stage')::int, 5, 'Nana-yul completes');
select is((public.advance_world_quest_v1('a2000000-0000-4000-8000-0000000000a2', 'talk_001')->>'stage')::int, 5, 'duplicate completion stays complete');
select is((public.advance_world_quest_v1('b2000000-0000-4000-8000-0000000000b2', 'status')->>'stage')::int, 0, 'second account stays unstarted');
select throws_ok($$select public.advance_world_quest_v1('b2000000-0000-4000-8000-0000000000b2', 'grant_reward')$$,
  '22023', null, 'unknown event is rejected');
reset role;

select * from finish();
rollback;
