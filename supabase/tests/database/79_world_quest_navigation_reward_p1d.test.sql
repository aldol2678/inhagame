-- Progression / Economy P1d: Main2 (campus_navigation_intro_v1) completion (stage 8 → 9 on
-- visit_back_gate) runs reward.quest.navigation_intro (+180 인덕코인, +100 EXP) once, in the same
-- transaction. Concurrent final calls through PostgREST live in
-- supabase/tests/integration/navigation-reward.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('d1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'p1d-a@example.test', now(), false),
 ('d1000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'p1d-b@example.test', now(), false),
 ('d1000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'p1d-c@example.test', now(), false),
 ('d1000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'p1d-d@example.test', now(), false),
 ('d1000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'p1d-e@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('d1000000-0000-4000-8000-0000000000a1', '길찾기A', false),
 ('d1000000-0000-4000-8000-0000000000b2', '길찾기B', false),
 ('d1000000-0000-4000-8000-0000000000c3', '길찾기C', false),
 ('d1000000-0000-4000-8000-0000000000d4', '길찾기D', false),
 ('d1000000-0000-4000-8000-0000000000e5', '길찾기E', false);

create function pg_temp.nav(p uuid, e text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  v := public.advance_world_navigation_quest_v1(p, e);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;
create function pg_temp.main1(p uuid) returns void language plpgsql as $f$
declare e text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  foreach e in array array['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001'] loop
    perform public.advance_world_quest_v1(p, e);
  end loop;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$f$;
create function pg_temp.walk_to_8(p uuid) returns void language plpgsql as $f$
declare e text;
begin
  foreach e in array array['start', 'set_building5_destination', 'start_auto_building5', 'pause_auto_building5',
      'resume_auto_building5', 'visit_building5', 'set_back_gate_destination', 'start_auto_back_gate'] loop
    perform pg_temp.nav(p, e);
  end loop;
end;
$f$;
create function pg_temp.prog(p uuid) returns text language sql as $f$
  select (s ->> 'totalExp') || '/Lv.' || (s ->> 'level') from (select private.world_progression_snapshot_v1(p) s) x;
$f$;
create function pg_temp.coins(p uuid) returns bigint language sql as $f$
  select coalesce((select w.balance from private.world_wallets w
                   where w.user_id = p and w.currency_id = 'currency.induck_coin'), 0);
$f$;
create function pg_temp.n(t regclass, p uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  execute format('select count(*) from %s where user_id = $1', t) into v using p;
  return v;
end;
$f$;
create function pg_temp.navtx(p uuid) returns bigint language sql as $f$
  select count(*) from private.world_reward_transactions t
   where t.user_id = p and t.reward_id = 'reward.quest.navigation_intro';
$f$;

-- ---- 1-4. RewardDefinition ----
select results_eq($$select d.status, d.version, d.event_id, d.tags, d.description
    from private.world_reward_definitions d where d.reward_id = 'reward.quest.navigation_intro'$$,
  $$values ('ACTIVE'::text, 1, null::text, array['quest', 'tutorial', 'navigation']::text[], '길찾기 익히기 완료 보상'::text)$$,
  'reward.quest.navigation_intro exists, ACTIVE, version 1');
select results_eq($$select g.position, g.grant_entry_id, g.grant_type, g.target_id, g.amount
    from private.world_reward_grants g where g.reward_id = 'reward.quest.navigation_intro' order by g.position$$,
  $$values (0::smallint, 'currency.induck_coin'::text, 'CURRENCY'::text, 'currency.induck_coin'::text, 180::bigint),
           (1::smallint, 'exp.campus', 'EXP', 'exp.campus', 100)$$,
  'grants: +180 인덕코인, +100 EXP, no item');
select results_eq($$select listing_id, price, required_level from private.world_shop_listings
    where item_id = 'head.induck_cap'$$,
  $$values ('offer.student_center.induck_cap'::text, 180::bigint, 1)$$, 'head.induck_cap still costs 180 (Lv.1)');

-- ---- 5-7. stage 1..8 progression unchanged: availability, order, duplicates ----
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'status'),
  '{"quest_id":"campus_navigation_intro_v1","stage":0,"available":false}'::jsonb, 'unavailable before Main 1, no reward key');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'start') ->> 'stage')::int, 0, 'cannot start before Main 1');
select pg_temp.main1('d1000000-0000-4000-8000-0000000000a1');
select is(pg_temp.prog('d1000000-0000-4000-8000-0000000000a1'), '100/Lv.2', 'First Campus: 100 EXP / Lv.2');
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'start'),
  '{"quest_id":"campus_navigation_intro_v1","stage":1,"available":true}'::jsonb, 'start: stage 1, shape unchanged');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'start') ->> 'stage')::int, 1, 'duplicate start stays');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_back_gate') ->> 'stage')::int, 1, 'out-of-order final visit stays');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_building5') ->> 'stage')::int, 1, 'cannot skip destination setup');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'set_building5_destination') ->> 'stage')::int, 2, 'Building 5 destination');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'set_building5_destination') ->> 'stage')::int, 2, 'duplicate destination stays');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'start_auto_building5') ->> 'stage')::int, 3, 'Building 5 auto-move');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_building5') ->> 'stage')::int, 3, 'cannot skip pause/resume');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'pause_auto_building5') ->> 'stage')::int, 4, 'pause');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'resume_auto_building5') ->> 'stage')::int, 5, 'resume');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_building5') ->> 'stage')::int, 6, 'Building 5 arrival');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'set_back_gate_destination') ->> 'stage')::int, 7, 'Back Gate destination');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_back_gate') ->> 'stage')::int, 7, 'return cannot complete without auto-move');
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'start_auto_back_gate'),
  '{"quest_id":"campus_navigation_intro_v1","stage":8,"available":true}'::jsonb, 'stage 8, no reward key');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000a1'), pg_temp.navtx('d1000000-0000-4000-8000-0000000000a1'),
    pg_temp.prog('d1000000-0000-4000-8000-0000000000a1')$$,
  $$values (0::bigint, 0::bigint, '100/Lv.2'::text)$$, 'nothing granted before completion');

-- ---- 8-10. stage 8 + visit_back_gate → 9 runs the reward ----
select set_config('test.final', pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_back_gate')::text, true);
select results_eq($$select r->>'quest_id', (r->>'stage')::int, (r->>'available')::boolean, r->'reward'->>'rewardId',
    (r->'reward'->>'rewardVersion')::int, r->'reward'->>'status', (r->'reward'->>'replayed')::boolean
    from (select current_setting('test.final')::jsonb r) x$$,
  $$values ('campus_navigation_intro_v1'::text, 9, true, 'reward.quest.navigation_intro'::text, 1, 'SUCCESS'::text, false)$$,
  'visit_back_gate at stage 8 → stage 9 plus a fresh navigation reward');
select results_eq($$select e->>'grantType', e->>'targetId', (e->>'granted')::bigint, e->>'status'
    from jsonb_array_elements(current_setting('test.final')::jsonb->'reward'->'entries') e$$,
  $$values ('CURRENCY'::text, 'currency.induck_coin'::text, 180::bigint, 'GRANTED'::text), ('EXP', 'exp.campus', 100, 'GRANTED')$$,
  'entries: +180 인덕코인, +100 EXP');
select ok(not (current_setting('test.final')::jsonb->'reward' ?| array['userId', 'idempotencyKey', 'sourceId', 'attempts'])
  and not exists (select 1 from jsonb_array_elements(current_setting('test.final')::jsonb->'reward'->'entries') e
                   where e ?| array['childIdempotencyKey', 'childTransactionId', 'grantEntryId']),
  'no server-only fields in the quest reward payload');
select is(pg_temp.coins('d1000000-0000-4000-8000-0000000000a1'), 180::bigint, 'wallet 0 → 180');
select is(pg_temp.prog('d1000000-0000-4000-8000-0000000000a1'), '200/Lv.2', 'progression 100 → 200, still Lv.2');
select results_eq($$select t.idempotency_key, t.source_type, t.source_id, t.reward_version, t.status
    from private.world_reward_transactions t
   where t.user_id = 'd1000000-0000-4000-8000-0000000000a1' and t.reward_id = 'reward.quest.navigation_intro'$$,
  $$values ('grant:quest.navigation_intro:d1000000-0000-4000-8000-0000000000a1'::text, 'QUEST'::text, 'quest.navigation_intro'::text, 1, 'SUCCESS'::text)$$,
  'one RewardTransaction with the stable key, source QUEST / quest.navigation_intro');
select results_eq($$select c.type, c.amount, c.balance_after, c.source_type, c.idempotency_key
    from private.world_currency_transactions c where c.user_id = 'd1000000-0000-4000-8000-0000000000a1'$$,
  $$values ('REWARD'::text, 180::bigint, 180::bigint, 'reward'::text,
           'reward/grant:quest.navigation_intro:d1000000-0000-4000-8000-0000000000a1/currency.induck_coin'::text)$$,
  'one currency ledger row');
select results_eq($$select x.amount, x.idempotency_key from private.world_exp_transactions x
   where x.user_id = 'd1000000-0000-4000-8000-0000000000a1' order by x.idempotency_key$$,
  $$values (100::bigint, 'reward/grant:quest.first_campus:d1000000-0000-4000-8000-0000000000a1/exp.campus'::text),
           (100::bigint, 'reward/grant:quest.navigation_intro:d1000000-0000-4000-8000-0000000000a1/exp.campus'::text)$$,
  'EXP ledger: First Campus + Main2, one row each');

-- ---- 12. replays move nothing and carry no reward ----
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'visit_back_gate'),
  '{"quest_id":"campus_navigation_intro_v1","stage":9,"available":true}'::jsonb, 'repeat final visit: stage 9, no reward key');
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'status'),
  '{"quest_id":"campus_navigation_intro_v1","stage":9,"available":true}'::jsonb, 'status after completion: no reward key');
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000a1', 'start'),
  '{"quest_id":"campus_navigation_intro_v1","stage":9,"available":true}'::jsonb, 'start after completion: no reward key');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000a1'), pg_temp.prog('d1000000-0000-4000-8000-0000000000a1'),
    pg_temp.navtx('d1000000-0000-4000-8000-0000000000a1'),
    pg_temp.n('private.world_currency_transactions', 'd1000000-0000-4000-8000-0000000000a1'),
    pg_temp.n('private.world_exp_transactions', 'd1000000-0000-4000-8000-0000000000a1')$$,
  $$values (180::bigint, '200/Lv.2'::text, 1::bigint, 1::bigint, 2::bigint)$$, 'replays: coin +0, EXP +0');

-- ---- 15. account isolation ----
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000b2', 'status') ->> 'stage')::int, 0, 'B quest untouched');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000b2'), pg_temp.prog('d1000000-0000-4000-8000-0000000000b2'),
    pg_temp.navtx('d1000000-0000-4000-8000-0000000000b2')$$,
  $$values (0::bigint, '0/Lv.1'::text, 0::bigint)$$, 'B wallet / EXP / reward untouched');

-- ---- 11. Main2-only fixture (Main 1 recorded without its reward): 0 → 100 EXP / Lv.2 ----
insert into private.world_quest_progress_v1 (user_id, quest_id, stage)
values ('d1000000-0000-4000-8000-0000000000b2', 'campus_first_walk_v1', 5);
select pg_temp.walk_to_8('d1000000-0000-4000-8000-0000000000b2');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000b2', 'visit_back_gate') -> 'reward' ->> 'status'), 'SUCCESS', 'B completes Main2');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000b2'), pg_temp.prog('d1000000-0000-4000-8000-0000000000b2')$$,
  $$values (180::bigint, '100/Lv.2'::text)$$, 'Main2 alone: 0 → 100 EXP (Lv.2), 0 → 180 coin');

-- ---- 14. reward failure rolls the completion back; the retry completes once ----
select pg_temp.main1('d1000000-0000-4000-8000-0000000000c3');
select pg_temp.walk_to_8('d1000000-0000-4000-8000-0000000000c3');
create function public.p1d_fail_coin_v1() returns trigger language plpgsql as $f$
begin
  if new.user_id = 'd1000000-0000-4000-8000-0000000000c3' then raise exception 'P1D_TEST_WALLET_DOWN'; end if;
  return new;
end;
$f$;
create trigger p1d_fail_coin before insert on private.world_currency_transactions
  for each row execute function public.p1d_fail_coin_v1();
select throws_ok($$select pg_temp.nav('d1000000-0000-4000-8000-0000000000c3', 'visit_back_gate')$$,
  'P0001', 'QUEST_REWARD_FAILED', 'a failing reward child aborts the completion');
select is((pg_temp.nav('d1000000-0000-4000-8000-0000000000c3', 'status') ->> 'stage')::int, 8, 'C is still at stage 8 (retry possible)');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000c3'), pg_temp.prog('d1000000-0000-4000-8000-0000000000c3'),
    pg_temp.navtx('d1000000-0000-4000-8000-0000000000c3'), pg_temp.n('private.world_exp_transactions', 'd1000000-0000-4000-8000-0000000000c3')$$,
  $$values (0::bigint, '100/Lv.2'::text, 0::bigint, 1::bigint)$$, 'the failed attempt left no coin, EXP or reward row');
drop trigger p1d_fail_coin on private.world_currency_transactions;
drop function public.p1d_fail_coin_v1();
select results_eq($$select (r->>'stage')::int, r->'reward'->>'status' from (select pg_temp.nav('d1000000-0000-4000-8000-0000000000c3', 'visit_back_gate') r) x$$,
  $$values (9, 'SUCCESS'::text)$$, 'the retry completes with the reward');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000c3'), pg_temp.prog('d1000000-0000-4000-8000-0000000000c3'),
    pg_temp.n('private.world_currency_transactions', 'd1000000-0000-4000-8000-0000000000c3')$$,
  $$values (180::bigint, '200/Lv.2'::text, 1::bigint)$$, 'C: coin and EXP granted exactly once');

-- ---- 16. an account already at stage 9 before P1d gets no retroactive reward ----
select pg_temp.main1('d1000000-0000-4000-8000-0000000000d4');
insert into private.world_quest_progress_v1 (user_id, quest_id, stage)
values ('d1000000-0000-4000-8000-0000000000d4', 'campus_navigation_intro_v1', 9);
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000d4', 'visit_back_gate'),
  '{"quest_id":"campus_navigation_intro_v1","stage":9,"available":true}'::jsonb, 'existing stage 9: final visit returns no reward');
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000d4', 'status') ? 'reward', false, 'existing stage 9: status has no reward');
select results_eq($$select pg_temp.coins('d1000000-0000-4000-8000-0000000000d4'), pg_temp.prog('d1000000-0000-4000-8000-0000000000d4'),
    pg_temp.navtx('d1000000-0000-4000-8000-0000000000d4')$$,
  $$values (0::bigint, '100/Lv.2'::text, 0::bigint)$$, 'no retroactive coin or EXP');

-- ---- Main 1 is still required; the navigation reward is not the BG01 event reward ----
select pg_temp.walk_to_8('d1000000-0000-4000-8000-0000000000e5');
select is(pg_temp.nav('d1000000-0000-4000-8000-0000000000e5', 'visit_back_gate'),
  '{"quest_id":"campus_navigation_intro_v1","stage":0,"available":false}'::jsonb, 'without Main 1 nothing starts or pays');
select is(pg_temp.navtx('d1000000-0000-4000-8000-0000000000e5'), 0::bigint, 'E: no reward');

-- ---- boundary: players still cannot call the quest or Reward RPCs ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"d1000000-0000-4000-8000-0000000000e5","is_anonymous":false}';
select throws_ok($$select public.advance_world_navigation_quest_v1('d1000000-0000-4000-8000-0000000000e5', 'visit_back_gate')$$,
  '42501', null, 'player cannot call the Main2 RPC');
select throws_ok($$select public.world_reward_grant_v1('d1000000-0000-4000-8000-0000000000e5', 'reward.quest.navigation_intro', 'QUEST', 'quest.navigation_intro', 'grant:quest.navigation_intro:d1000000-0000-4000-8000-0000000000e5')$$,
  '42501', null, 'player cannot run the Reward RPC');
reset role;

select * from finish();
rollback;
