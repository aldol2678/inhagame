begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'npc-a@example.test', now(), false),
 ('b1000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'npc-b@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a1000000-0000-4000-8000-0000000000a1', 'NPC테스트A', false),
 ('b1000000-0000-4000-8000-0000000000b1', 'NPC테스트B', false);

select has_table('private', 'world_npc_ai_daily_calls', 'durable quota table exists');
select ok((select relrowsecurity from pg_class where oid = 'private.world_npc_ai_daily_calls'::regclass), 'quota table has RLS');
select ok(not has_function_privilege('anon', 'public.claim_world_npc_ai_call_v1(uuid)', 'execute'), 'guest cannot claim');
select ok(not has_function_privilege('authenticated', 'public.claim_world_npc_ai_call_v1(uuid)', 'execute'), 'player cannot claim');
select ok(has_function_privilege('service_role', 'public.claim_world_npc_ai_call_v1(uuid)', 'execute'), 'server can claim');
select ok(not has_table_privilege('authenticated', 'private.world_npc_ai_daily_calls', 'select'), 'player cannot read quota');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-4000-8000-0000000000a1"}';
select throws_ok($$select public.claim_world_npc_ai_call_v1('a1000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'authenticated role cannot invoke quota RPC');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.claim_world_npc_ai_call_v1('a1000000-0000-4000-8000-0000000000a1'), 'OK', 'first call accepted');
select is(public.claim_world_npc_ai_call_v1('a1000000-0000-4000-8000-0000000000a1'), 'OK', 'second call accepted');
select is(public.claim_world_npc_ai_call_v1('a1000000-0000-4000-8000-0000000000a1'), 'OK', 'third call accepted');
select is(public.claim_world_npc_ai_call_v1('a1000000-0000-4000-8000-0000000000a1'), 'USER_LIMIT', 'fourth call denied');
select is(public.claim_world_npc_ai_call_v1('b1000000-0000-4000-8000-0000000000b1'), 'OK', 'second user has separate allowance');
reset role;

select is((select calls from private.world_npc_ai_daily_calls where scope = 'global'), 4, 'denied claim did not increment total');
update private.world_npc_ai_daily_calls set calls = 49 where scope = 'global';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.claim_world_npc_ai_call_v1('b1000000-0000-4000-8000-0000000000b1'), 'OK', 'fiftieth global call accepted');
select is(public.claim_world_npc_ai_call_v1('b1000000-0000-4000-8000-0000000000b1'), 'GLOBAL_LIMIT', 'fifty-first call denied');
reset role;
select is((select calls from private.world_npc_ai_daily_calls where scope = 'global'), 50, 'global total stays at cap');

select * from finish();
rollback;
