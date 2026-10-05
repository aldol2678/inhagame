-- Progression P1c: the first campus walk completion (stage 4 → 5 on talk_001) runs the existing
-- reward.quest.first_campus (badge.main_gate + 100 EXP) once, in the same transaction.
-- Concurrent final calls through PostgREST live in
-- supabase/tests/integration/first-campus-reward.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('c1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'p1c-a@example.test', now(), false),
 ('c1000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'p1c-b@example.test', now(), false),
 ('c1000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'p1c-c@example.test', now(), false),
 ('c1000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'p1c-d@example.test', now(), false),
 ('c1000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'p1c-e@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('c1000000-0000-4000-8000-0000000000a1', '탐방A', false),
 ('c1000000-0000-4000-8000-0000000000b2', '탐방B', false),
 ('c1000000-0000-4000-8000-0000000000c3', '탐방C', false),
 ('c1000000-0000-4000-8000-0000000000d4', '탐방D', false),
 ('c1000000-0000-4000-8000-0000000000e5', '탐방E', false);

create function pg_temp.q(p uuid, e text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  v := public.advance_world_quest_v1(p, e);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;
create function pg_temp.walk_to_4(p uuid) returns void language plpgsql as $f$
declare e text;
begin
  foreach e in array array['start', 'visit_main_hall', 'visit_inkyung', 'talk_002'] loop
    perform pg_temp.q(p, e);
  end loop;
end;
$f$;
create function pg_temp.prog(p uuid) returns text language sql as $f$
  select (s ->> 'totalExp') || '/Lv.' || (s ->> 'level') from (select private.world_progression_snapshot_v1(p) s) x;
$f$;
create function pg_temp.n(t regclass, p uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  execute format('select count(*) from %s where user_id = $1', t) into v using p;
  return v;
end;
$f$;

-- ---- 1-3. stages 0-4 unchanged: order, duplicates, no reward before completion ----
select is(pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'status'), '{"quest_id":"campus_first_walk_v1","stage":0}'::jsonb, 'status before start: stage 0, no reward key');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'talk_001') ->> 'stage')::int, 0, 'final talk before start does nothing');
select is(pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'start'), '{"quest_id":"campus_first_walk_v1","stage":1}'::jsonb, 'start: stage 1, shape unchanged');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'start') ->> 'stage')::int, 1, 'duplicate start stays');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'talk_001') ->> 'stage')::int, 1, 'out-of-order final talk stays');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'visit_main_hall') ->> 'stage')::int, 2, 'main hall');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'visit_main_hall') ->> 'stage')::int, 2, 'duplicate visit stays');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'visit_inkyung') ->> 'stage')::int, 3, 'pond');
select is(pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'talk_002'), '{"quest_id":"campus_first_walk_v1","stage":4}'::jsonb, 'Ga-yudam: stage 4, no reward key');
select is(pg_temp.n('private.world_reward_transactions', 'c1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'no reward before completion');
select is(pg_temp.prog('c1000000-0000-4000-8000-0000000000a1'), '0/Lv.1', 'fresh account at 0 EXP / Lv.1');
select is((select coalesce(sum(balance), 0) from private.world_wallets where user_id = 'c1000000-0000-4000-8000-0000000000a1'), 0::numeric, 'wallet empty before');

-- ---- 4-8. the completing call runs reward.quest.first_campus ----
select set_config('test.final', pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'talk_001')::text, true);
select results_eq($$select r->>'quest_id', (r->>'stage')::int, r->'reward'->>'rewardId', (r->'reward'->>'rewardVersion')::int,
    r->'reward'->>'status', (r->'reward'->>'replayed')::boolean from (select current_setting('test.final')::jsonb r) x$$,
  $$values ('campus_first_walk_v1'::text, 5, 'reward.quest.first_campus'::text, 2, 'SUCCESS'::text, false)$$,
  'talk_001 at stage 4 → stage 5 plus a fresh v2 First Campus reward');
select results_eq($$select e->>'grantType', e->>'targetId', (e->>'granted')::bigint, e->>'status'
    from jsonb_array_elements(current_setting('test.final')::jsonb->'reward'->'entries') e$$,
  $$values ('ITEM'::text, 'badge.main_gate'::text, 1::bigint, 'GRANTED'::text), ('EXP', 'exp.campus', 100, 'GRANTED')$$,
  'entries: badge.main_gate ×1 and +100 EXP');
select ok(not (current_setting('test.final')::jsonb->'reward' ?| array['userId', 'idempotencyKey', 'sourceId', 'attempts'])
  and not exists (select 1 from jsonb_array_elements(current_setting('test.final')::jsonb->'reward'->'entries') e
                   where e ?| array['childIdempotencyKey', 'childTransactionId', 'grantEntryId']),
  'no server-only fields in the quest reward payload');
select is(pg_temp.prog('c1000000-0000-4000-8000-0000000000a1'), '100/Lv.2', 'progression 0 → 100, Lv.1 → Lv.2');
select ok(exists (select 1 from private.world_player_items i where i.user_id = 'c1000000-0000-4000-8000-0000000000a1' and i.item_id = 'badge.main_gate'), 'badge.main_gate owned');
select is((select coalesce(sum(balance), 0) from private.world_wallets where user_id = 'c1000000-0000-4000-8000-0000000000a1'), 0::numeric, 'wallet unchanged (no currency)');
select is(pg_temp.n('private.world_currency_transactions', 'c1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'no wallet ledger row');
select results_eq($$select t.idempotency_key, t.source_type, t.source_id, t.reward_version, t.status
    from private.world_reward_transactions t where t.user_id = 'c1000000-0000-4000-8000-0000000000a1'$$,
  $$values ('grant:quest.first_campus:c1000000-0000-4000-8000-0000000000a1'::text, 'QUEST'::text, 'quest.first_campus'::text, 2, 'SUCCESS'::text)$$,
  'one RewardTransaction with the stable key, source QUEST / quest.first_campus');
select results_eq($$select x.amount, x.source_type, x.idempotency_key
    from private.world_exp_transactions x where x.user_id = 'c1000000-0000-4000-8000-0000000000a1'$$,
  $$values (100::bigint, 'reward'::text, 'reward/grant:quest.first_campus:c1000000-0000-4000-8000-0000000000a1/exp.campus'::text)$$,
  'one EXP ledger row through the P0-F1 adapter');

-- ---- 9. replays move nothing and carry no reward ----
select is(pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'talk_001'), '{"quest_id":"campus_first_walk_v1","stage":5}'::jsonb, 'repeat final talk: stage 5, no reward key');
select is(pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'status'), '{"quest_id":"campus_first_walk_v1","stage":5}'::jsonb, 'status after completion: no reward key');
select is(pg_temp.q('c1000000-0000-4000-8000-0000000000a1', 'start'), '{"quest_id":"campus_first_walk_v1","stage":5}'::jsonb, 'start after completion: no reward key');
select results_eq($$select pg_temp.prog('c1000000-0000-4000-8000-0000000000a1'),
    pg_temp.n('private.world_exp_transactions', 'c1000000-0000-4000-8000-0000000000a1'),
    pg_temp.n('private.world_item_grants', 'c1000000-0000-4000-8000-0000000000a1'),
    pg_temp.n('private.world_reward_transactions', 'c1000000-0000-4000-8000-0000000000a1')$$,
  $$values ('100/Lv.2'::text, 1::bigint, 1::bigint, 1::bigint)$$, 'replays: EXP +0, no duplicate grant or reward');

-- ---- 11. account isolation ----
select is(pg_temp.prog('c1000000-0000-4000-8000-0000000000b2'), '0/Lv.1', 'B untouched');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000b2', 'status') ->> 'stage')::int, 0, 'B quest untouched');
select ok(not exists (select 1 from private.world_player_items i where i.user_id = 'c1000000-0000-4000-8000-0000000000b2' and i.item_id = 'badge.main_gate'), 'B has no badge');

-- ---- 12. reward failure rolls the completion back; the retry completes once ----
select pg_temp.walk_to_4('c1000000-0000-4000-8000-0000000000c3');
create temp table p1c_badge as select status from private.world_item_catalog where item_id = 'badge.main_gate';
update private.world_item_catalog set status = 'DISABLED' where item_id = 'badge.main_gate';
select throws_ok($$select pg_temp.q('c1000000-0000-4000-8000-0000000000c3', 'talk_001')$$,
  'P0001', 'QUEST_REWARD_FAILED', 'a failing reward child aborts the completion');
select is((pg_temp.q('c1000000-0000-4000-8000-0000000000c3', 'status') ->> 'stage')::int, 4, 'C is still at stage 4 (retry possible)');
select results_eq($$select pg_temp.prog('c1000000-0000-4000-8000-0000000000c3'),
    pg_temp.n('private.world_reward_transactions', 'c1000000-0000-4000-8000-0000000000c3'),
    pg_temp.n('private.world_exp_transactions', 'c1000000-0000-4000-8000-0000000000c3')$$,
  $$values ('0/Lv.1'::text, 0::bigint, 0::bigint)$$, 'the failed attempt left no reward, EXP or ledger row');
update private.world_item_catalog set status = (select status from p1c_badge) where item_id = 'badge.main_gate';
select results_eq($$select (r->>'stage')::int, r->'reward'->>'status' from (select pg_temp.q('c1000000-0000-4000-8000-0000000000c3', 'talk_001') r) x$$,
  $$values (5, 'SUCCESS'::text)$$, 'the retry completes with the reward');
select is(pg_temp.prog('c1000000-0000-4000-8000-0000000000c3'), '100/Lv.2', 'C: EXP granted exactly once');

-- ---- 13. badge already owned → PARTIAL_SUCCESS, EXP once ----
select pg_temp.walk_to_4('c1000000-0000-4000-8000-0000000000d4');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1('c1000000-0000-4000-8000-0000000000d4', 'badge.main_gate', 1, 'SHOP', 'qa.earlier', 'p1c:d4:earlier-badge') ->> 'status',
  'GRANTED', 'D owned the badge before completing');
reset role;
select set_config('test.d', pg_temp.q('c1000000-0000-4000-8000-0000000000d4', 'talk_001')::text, true);
select results_eq($$select e->>'targetId', e->>'status', e->>'reason', (e->>'granted')::bigint
    from jsonb_array_elements(current_setting('test.d')::jsonb->'reward'->'entries') e$$,
  $$values ('badge.main_gate'::text, 'SKIPPED'::text, 'ALREADY_OWNED'::text, 0::bigint), ('exp.campus', 'GRANTED', null, 100)$$,
  'owned badge SKIPPED, EXP granted');
select results_eq($$select (r->>'stage')::int, r->'reward'->>'status' from (select current_setting('test.d')::jsonb r) x$$,
  $$values (5, 'PARTIAL_SUCCESS'::text)$$, 'PARTIAL_SUCCESS completes the quest');
select is(pg_temp.prog('c1000000-0000-4000-8000-0000000000d4'), '100/Lv.2', 'D: +100 EXP exactly once');

-- ---- 14. an existing final (v1) transaction on the stable key replays unchanged ----
create temp table p1c_saved as select * from private.world_reward_grants where reward_id = 'reward.quest.first_campus' and grant_type = 'EXP';
delete from private.world_reward_grants where reward_id = 'reward.quest.first_campus' and grant_type = 'EXP';
update private.world_reward_definitions set version = 1 where reward_id = 'reward.quest.first_campus';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_reward_grant_v1('c1000000-0000-4000-8000-0000000000e5', 'reward.quest.first_campus', 'QUEST', 'quest.first_campus',
  'grant:quest.first_campus:c1000000-0000-4000-8000-0000000000e5') ->> 'status', 'SUCCESS', 'E holds a v1 (badge only) transaction');
reset role;
insert into private.world_reward_grants select * from p1c_saved;
update private.world_reward_definitions set version = 2 where reward_id = 'reward.quest.first_campus';
select pg_temp.walk_to_4('c1000000-0000-4000-8000-0000000000e5');
select set_config('test.e', pg_temp.q('c1000000-0000-4000-8000-0000000000e5', 'talk_001')::text, true);
select results_eq($$select (r->>'stage')::int, (r->'reward'->>'replayed')::boolean, (r->'reward'->>'rewardVersion')::int, jsonb_array_length(r->'reward'->'entries')
    from (select current_setting('test.e')::jsonb r) x$$,
  $$values (5, true, 1, 1)$$, 'completion replays the stored v1 result (badge only)');
select is(pg_temp.prog('c1000000-0000-4000-8000-0000000000e5'), '0/Lv.1', 'no retroactive EXP for the v1 snapshot');
select is(pg_temp.n('private.world_reward_transactions', 'c1000000-0000-4000-8000-0000000000e5'), 1::bigint, 'no second reward transaction');

-- ---- boundary: players still cannot call the quest or Reward RPCs ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-0000000000b2","is_anonymous":false}';
select throws_ok($$select public.advance_world_quest_v1('c1000000-0000-4000-8000-0000000000b2', 'talk_001')$$, '42501', null, 'player cannot call the quest RPC');
select throws_ok($$select public.world_reward_grant_v1('c1000000-0000-4000-8000-0000000000b2', 'reward.quest.first_campus', 'QUEST', 'quest.first_campus', 'grant:quest.first_campus:c1000000-0000-4000-8000-0000000000b2')$$,
  '42501', null, 'player cannot run the Reward RPC');
reset role;

select * from finish();
rollback;
