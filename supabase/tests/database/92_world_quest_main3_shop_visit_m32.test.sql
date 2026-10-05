begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('e3200000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'main3-visit-a@example.test', now(), false),
 ('e3200000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'main3-visit-b@example.test', now(), false),
 ('e3200000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'main3-visit-c@example.test', now(), false),
 ('e3200000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'main3-visit-d@example.test', null, true),
 ('e3200000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'main3-visit-e@example.test', now(), false),
 ('e3200000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'main3-visit-f@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('e3200000-0000-4000-8000-0000000000a1', '방문A', false),
 ('e3200000-0000-4000-8000-0000000000b2', '방문B', false),
 ('e3200000-0000-4000-8000-0000000000c3', '방문C', true),
 ('e3200000-0000-4000-8000-0000000000d4', '방문D', false),
 ('e3200000-0000-4000-8000-0000000000e5', '방문E', false);

insert into private.world_quest_progress_v1(user_id, quest_id, stage) values
 ('e3200000-0000-4000-8000-0000000000a1', 'campus_navigation_intro_v1', 9),
 ('e3200000-0000-4000-8000-0000000000b2', 'campus_navigation_intro_v1', 8),
 ('e3200000-0000-4000-8000-0000000000c3', 'campus_navigation_intro_v1', 9),
 ('e3200000-0000-4000-8000-0000000000d4', 'campus_navigation_intro_v1', 9),
 ('e3200000-0000-4000-8000-0000000000e5', 'campus_navigation_intro_v1', 9),
 ('e3200000-0000-4000-8000-0000000000b2', 'campus_first_style_v1', 1),
 ('e3200000-0000-4000-8000-0000000000c3', 'campus_first_style_v1', 1),
 ('e3200000-0000-4000-8000-0000000000d4', 'campus_first_style_v1', 1),
 ('e3200000-0000-4000-8000-0000000000e5', 'campus_first_style_v1', 1);

-- Snapshot all owner domains which this visit-only slice must leave untouched.
create function pg_temp.main3_other_domains() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_array(domain, row_data) order by domain, row_data::text), '[]'::jsonb)
  from (
    select 'reward' domain, to_jsonb(t) row_data from private.world_reward_transactions t
    union all select 'wallet', to_jsonb(t) from private.world_wallets t
    union all select 'currency', to_jsonb(t) from private.world_currency_transactions t
    union all select 'inventory', to_jsonb(t) from private.world_player_items t
    union all select 'progression', to_jsonb(t) from private.world_player_progression t
    union all select 'exp', to_jsonb(t) from private.world_exp_transactions t
    union all select 'purchase', to_jsonb(t) from private.world_purchase_transactions t
    union all select 'loadout', to_jsonb(t) from private.world_player_appearance_loadout t
  ) snapshots;
$$;
create temporary table main3_before as select pg_temp.main3_other_domains() as state;

select ok(not has_function_privilege('anon', 'public.advance_world_first_style_quest_v1(uuid,text)', 'execute'),
  'guest cannot execute the Main 3 RPC');
select ok(not has_function_privilege('authenticated', 'public.advance_world_first_style_quest_v1(uuid,text)', 'execute'),
  'player cannot execute the Main 3 RPC');
select ok(has_function_privilege('service_role', 'public.advance_world_first_style_quest_v1(uuid,text)', 'execute'),
  'server retains execute permission');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center'),
  '{"quest_id":"campus_first_style_v1","stage":0,"available":true}'::jsonb,
  'visiting before the guide starts Main 3 does not advance or create progress');
select is((select count(*) from private.world_quest_progress_v1
  where user_id = 'e3200000-0000-4000-8000-0000000000a1' and quest_id = 'campus_first_style_v1'),
  0::bigint, 'an out-of-order visit leaves no persisted Main 3 row');

select is((public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'start')->>'stage')::int, 1,
  'the guide starts Main 3 for an eligible account');
select is(public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center'),
  '{"quest_id":"campus_first_style_v1","stage":2,"available":true}'::jsonb,
  'the shop visit advances stage 1 to 2 with no reward payload');
select is(public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'status'),
  '{"quest_id":"campus_first_style_v1","stage":2,"available":true}'::jsonb,
  'status restores the persisted shop visit after reconnect');

update private.world_quest_progress_v1 set updated_at = '2000-01-01T00:00:00Z'
where user_id = 'e3200000-0000-4000-8000-0000000000a1' and quest_id = 'campus_first_style_v1';
select is((public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center')->>'stage')::int, 2,
  'duplicate visits are idempotent');
select is((public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'start')->>'stage')::int, 2,
  'revisiting the guide cannot regress the completed visit');
select is((select updated_at from private.world_quest_progress_v1
  where user_id = 'e3200000-0000-4000-8000-0000000000a1' and quest_id = 'campus_first_style_v1'),
  '2000-01-01T00:00:00Z'::timestamptz, 'idempotent events do not rewrite the progress timestamp');

select is(public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000b2', 'visit_student_center'),
  '{"quest_id":"campus_first_style_v1","stage":1,"available":false}'::jsonb,
  'Main 2 stage 8 cannot advance a visit even if a Main 3 row already exists');
select is((public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000e5', 'status')->>'stage')::int, 1,
  'another eligible account does not inherit the visit');

select throws_ok(format('select public.advance_world_first_style_quest_v1(%L::uuid,%L)', user_id, event),
  '22023', 'ACCOUNT_UNAVAILABLE', description || ' cannot use ' || event)
from (values
  ('e3200000-0000-4000-8000-0000000000c3', 'banned account'),
  ('e3200000-0000-4000-8000-0000000000d4', 'anonymous account'),
  ('e3200000-0000-4000-8000-0000000000f6', 'account without a profile'),
  ('e3200000-0000-4000-8000-0000000000ff', 'missing account'),
  (null, 'null account')
) accounts(user_id, description)
cross join (values ('status'), ('start'), ('visit_student_center')) events(event);

select throws_ok(format('select public.advance_world_first_style_quest_v1(%L::uuid,%L)',
  'e3200000-0000-4000-8000-0000000000a1', event),
  '22023', 'INVALID_QUEST_EVENT', coalesce(event, 'null') || ' is not visit evidence')
from (values ('purchase_done'), ('equip_done'), ('complete'), ('visit_back_gate'), (null)) events(event);

update private.world_quest_progress_v1 set stage = 3
where user_id = 'e3200000-0000-4000-8000-0000000000a1' and quest_id = 'campus_first_style_v1';
select is((public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center')->>'stage')::int, 3,
  'a visit cannot complete future purchase or loadout stages');
update private.world_quest_progress_v1 set stage = 4
where user_id = 'e3200000-0000-4000-8000-0000000000a1' and quest_id = 'campus_first_style_v1';
select is((public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center')->>'stage')::int, 4,
  'a visit does not change an already completed quest');

reset role;
select is(pg_temp.main3_other_domains(), (select state from main3_before),
  'visit-only quest progression cannot mutate Reward, Wallet, Inventory, EXP, Shop, or Loadout');
select is((select stage::int from private.world_quest_progress_v1
  where user_id = 'e3200000-0000-4000-8000-0000000000c3' and quest_id = 'campus_first_style_v1'),
  1, 'the banned account retains its original progress');
select is((select stage::int from private.world_quest_progress_v1
  where user_id = 'e3200000-0000-4000-8000-0000000000d4' and quest_id = 'campus_first_style_v1'),
  1, 'the anonymous account retains its original progress');

set local request.jwt.claims = '{"role":"authenticated","sub":"e3200000-0000-4000-8000-0000000000a1","is_anonymous":false}';
select throws_ok($$select public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center')$$,
  '42501', 'SERVER_ONLY', 'the function rejects nonserver claims even for an eligible account');
set local request.jwt.claims = '{}';
select throws_ok($$select public.advance_world_first_style_quest_v1(
  'e3200000-0000-4000-8000-0000000000a1', 'visit_student_center')$$,
  '42501', 'SERVER_ONLY', 'missing role claims fail closed');

select * from finish();
rollback;
