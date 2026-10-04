begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('e3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'main3-a@example.test', now(), false),
 ('e3000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'main3-b@example.test', now(), false),
 ('e3000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'main3-c@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('e3000000-0000-4000-8000-0000000000a1', '메인3A', false),
 ('e3000000-0000-4000-8000-0000000000b2', '메인3B', false),
 ('e3000000-0000-4000-8000-0000000000c3', '메인3C', true);

select ok(not has_function_privilege('anon', 'public.advance_world_first_style_quest_v1(uuid,text)', 'execute'),
  'guest cannot advance Main 3');
select ok(not has_function_privilege('authenticated', 'public.advance_world_first_style_quest_v1(uuid,text)', 'execute'),
  'player cannot advance Main 3 directly');
select ok(has_function_privilege('service_role', 'public.advance_world_first_style_quest_v1(uuid,text)', 'execute'),
  'server can advance Main 3');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- A has completed Main 2; B is still at stage 8.
insert into private.world_quest_progress_v1(user_id, quest_id, stage) values
 ('e3000000-0000-4000-8000-0000000000a1', 'campus_first_walk_v1', 5),
 ('e3000000-0000-4000-8000-0000000000a1', 'campus_navigation_intro_v1', 9),
 ('e3000000-0000-4000-8000-0000000000b2', 'campus_first_walk_v1', 5),
 ('e3000000-0000-4000-8000-0000000000b2', 'campus_navigation_intro_v1', 8);

select is(public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','status'),
  '{"quest_id":"campus_first_style_v1","stage":0,"available":true}'::jsonb,
  'Main 2 completion unlocks Main 3 without auto-starting it');

select is(public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000b2','status'),
  '{"quest_id":"campus_first_style_v1","stage":0,"available":false}'::jsonb,
  'Main 2 stage 8 does not unlock Main 3');

select is((public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000b2','start')->>'stage')::int, 0,
  'locked account cannot start Main 3');

select is((public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','start')->>'stage')::int, 1,
  'eligible account starts Main 3 at stage 1');

select is((public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','start')->>'stage')::int, 1,
  'duplicate start is idempotent');

select is(public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','status'),
  '{"quest_id":"campus_first_style_v1","stage":1,"available":true}'::jsonb,
  'status restores persisted Main 3 stage after reconnect');

select is((public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000b2','status')->>'stage')::int, 0,
  'second account remains isolated');

select throws_ok($$select public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','purchase_done')$$,
  '22023', 'INVALID_QUEST_EVENT',
  'M3.1 refuses client-asserted purchase completion');

select throws_ok($$select public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000c3','status')$$,
  '22023', 'ACCOUNT_UNAVAILABLE',
  'banned account cannot read or advance Main 3');

-- Future M3.2-M3.5 stages already fit the persisted quest contract without a schema rewrite.
update private.world_quest_progress_v1
set stage = 4
where user_id = 'e3000000-0000-4000-8000-0000000000a1'
  and quest_id = 'campus_first_style_v1';
select is((public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','status')->>'stage')::int, 4,
  'Main 3 persistence accepts and restores the defined terminal-stage range for later slices');

reset role;

set local request.jwt.claims = '{"role":"authenticated","sub":"e3000000-0000-4000-8000-0000000000a1","is_anonymous":false}';
select throws_ok($$select public.advance_world_first_style_quest_v1(
  'e3000000-0000-4000-8000-0000000000a1','status')$$,
  '42501', null, 'authenticated player cannot call the Main 3 RPC directly');

select * from finish();
rollback;
