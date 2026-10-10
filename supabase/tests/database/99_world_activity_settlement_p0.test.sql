-- INHA WORLD Activity Settlement P0 (Authority Map 7.4). Activations below are fixtures and roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9900000-0000-4000-8000-0000000000a9','authenticated','authenticated','settle-a@example.test',now(),false),
 ('b9900000-0000-4000-8000-0000000000b9','authenticated','authenticated','settle-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9900000-0000-4000-8000-0000000000a9','정산A',false),
 ('b9900000-0000-4000-8000-0000000000b9','정산B',false);

-- ---- schema / privileges ----
select has_table('private','world_activity_settlements','settlement receipts exist');
select col_is_pk('private','world_activity_settlements',array['attempt_id'],'one receipt per attempt');
select col_is_unique('private','world_activity_settlements',array['result_ref'],'one receipt per result');
select ok((select relrowsecurity from pg_class where oid='private.world_activity_settlements'::regclass),
  'settlement receipts have RLS');
select ok(not has_table_privilege(r,'private.world_activity_settlements',p),format('%s cannot %s receipts',r,p))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot call %s',r,f))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['private.world_activity_settle_v1(uuid,uuid,jsonb)',
       'private.world_activity_settlement_plan_validate_v1(jsonb)']) f;
select ok(to_regprocedure('public.world_activity_settle_v1(uuid,uuid,jsonb)') is null,
  'no generic public settlement RPC exists');

-- ---- plan shape ----
select throws_ok($$select private.world_activity_settlement_plan_validate_v1('{"items":[],"discoveries":[]}')$$,
  '22023','SETTLEMENT_PLAN_INVALID','plan needs exactly items / discoveries / lifeXp');
select throws_ok($$select private.world_activity_settlement_plan_validate_v1(
  '{"items":[],"discoveries":[],"lifeXp":[],"coins":[]}')$$,
  '22023','SETTLEMENT_PLAN_INVALID','unknown output kinds are refused');
select throws_ok($$select private.world_activity_settlement_plan_validate_v1(
  '{"items":[{"itemId":"material.fish_carp","quantity":0}],"discoveries":[],"lifeXp":[]}')$$,
  '22023','SETTLEMENT_PLAN_INVALID','item quantity must be positive');
select throws_ok($$select private.world_activity_settlement_plan_validate_v1(
  '{"items":[{"itemId":"material.fish_carp","quantity":1.5}],"discoveries":[],"lifeXp":[]}')$$,
  '22023','SETTLEMENT_PLAN_INVALID','item quantity must be integral');
select throws_ok($$select private.world_activity_settlement_plan_validate_v1(
  '{"items":[{"itemId":"material.fish_carp","quantity":1,"userId":"x"}],"discoveries":[],"lifeXp":[]}')$$,
  '22023','SETTLEMENT_PLAN_INVALID','entries have no extra fields');
select throws_ok($$select private.world_activity_settlement_plan_validate_v1(
  '{"items":[],"discoveries":[],"lifeXp":[{"skillId":"life.fishing","amount":1},{"skillId":"life.fishing","amount":2}]}')$$,
  '22023','SETTLEMENT_PLAN_INVALID','one entry per skill');
select lives_ok($$select private.world_activity_settlement_plan_validate_v1(
  '{"items":[],"discoveries":[],"lifeXp":[]}')$$,'an empty plan is a valid no-output settlement');

-- ---- fixtures ----
update private.world_collection_entry_catalog set status='ACTIVE' where entry_id='collection.fish.carp';
update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';

create temp table settle_fixture(name text primary key, attempt_id uuid) on commit drop;
insert into settle_fixture
select 'ok',(private.world_activity_start_v1('a9900000-0000-4000-8000-0000000000a9',
  'activity.fishing.inkyung','fishing.inkyung.north_01','11990000-0000-4000-8000-000000000001',1,1)
  ->'attempt'->>'attemptId')::uuid;
insert into settle_fixture
select 'failed',(private.world_activity_start_v1('a9900000-0000-4000-8000-0000000000a9',
  'activity.fishing.inkyung','fishing.inkyung.south_01','11990000-0000-4000-8000-000000000002',1,1)
  ->'attempt'->>'attemptId')::uuid;
select private.world_activity_finalize_v1('a9900000-0000-4000-8000-0000000000a9',
  (select attempt_id from settle_fixture where name='ok'),'SUCCEEDED','CAUGHT','test_result:settle_ok');
select private.world_activity_finalize_v1('a9900000-0000-4000-8000-0000000000a9',
  (select attempt_id from settle_fixture where name='failed'),'FAILED','MISSED_BITE',null);

create temp table settle_plan(plan jsonb) on commit drop;
insert into settle_plan values (
  '{"items":[{"itemId":"material.fish_carp","quantity":1}],
    "discoveries":[{"entryId":"collection.fish.carp"}],
    "lifeXp":[{"skillId":"life.fishing","amount":120}]}');

-- ---- refusals ----
select throws_ok(format($$select private.world_activity_settle_v1(%L,%L,%L)$$,
  'b9900000-0000-4000-8000-0000000000b9',(select attempt_id from settle_fixture where name='ok'),
  (select plan from settle_plan)),'P0002','ATTEMPT_NOT_FOUND','another account cannot settle the attempt');
select throws_ok(format($$select private.world_activity_settle_v1(%L,%L,%L)$$,
  'a9900000-0000-4000-8000-0000000000a9',(select attempt_id from settle_fixture where name='failed'),
  (select plan from settle_plan)),'P0001','ACTIVITY_NOT_SUCCEEDED','a failed outcome never settles');

-- Atomicity: the Life Skill write fails last, so the item and discovery must roll back with it.
update private.world_life_skill_catalog set status='COMING_SOON' where skill_id='life.fishing';
select throws_ok(format($$select private.world_activity_settle_v1(%L,%L,%L)$$,
  'a9900000-0000-4000-8000-0000000000a9',(select attempt_id from settle_fixture where name='ok'),
  (select plan from settle_plan)),'P0001','LIFE_SKILL_INACTIVE','an unavailable output fails the whole settlement');
select is((select count(*) from private.world_item_grants
  where user_id='a9900000-0000-4000-8000-0000000000a9'),0::bigint,'rolled-back settlement grants no item');
select is((select count(*) from private.world_collection_discovery_events
  where user_id='a9900000-0000-4000-8000-0000000000a9'),0::bigint,'rolled-back settlement records no discovery');
select is((select count(*) from private.world_activity_settlements),0::bigint,'rolled-back settlement writes no receipt');
update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';

-- ---- success / replay ----
select is(private.world_activity_settle_v1('a9900000-0000-4000-8000-0000000000a9',
  (select attempt_id from settle_fixture where name='ok'),(select plan from settle_plan))->>'status',
  'SETTLED','a verified success settles once');
select results_eq($$
  select (select quantity from private.world_player_items
           where user_id='a9900000-0000-4000-8000-0000000000a9' and item_id='material.fish_carp'),
         (select count(*) from private.world_collection_discovery_events
           where user_id='a9900000-0000-4000-8000-0000000000a9'),
         (select total_xp from private.world_player_life_skills
           where user_id='a9900000-0000-4000-8000-0000000000a9' and skill_id='life.fishing')
$$,$$values (1,1::bigint,120::bigint)$$,'item, discovery and Life Skill XP all land');
select is((select source_id from private.world_life_skill_xp_transactions
  where user_id='a9900000-0000-4000-8000-0000000000a9'),'test_result:settle_ok',
  'Life Skill XP cites the verified result_ref');
select is((select receipt->>'resultRef' from private.world_activity_settlements
  where attempt_id=(select attempt_id from settle_fixture where name='ok')),'test_result:settle_ok',
  'receipt is keyed by the verified result');

select is(private.world_activity_settle_v1('a9900000-0000-4000-8000-0000000000a9',
  (select attempt_id from settle_fixture where name='ok'),(select plan from settle_plan))->>'status',
  'ALREADY_PROCESSED','same plan replays the stored receipt');
select is((select quantity from private.world_player_items
  where user_id='a9900000-0000-4000-8000-0000000000a9' and item_id='material.fish_carp'),1,
  'replay grants nothing');
select throws_ok(format($$select private.world_activity_settle_v1(%L,%L,%L)$$,
  'a9900000-0000-4000-8000-0000000000a9',(select attempt_id from settle_fixture where name='ok'),
  '{"items":[{"itemId":"material.fish_carp","quantity":5}],"discoveries":[],"lifeXp":[]}'),
  '23505','SETTLEMENT_PLAN_CONFLICT','a settled result cannot be re-settled with a different plan');
select throws_ok($$update private.world_activity_settlements set plan='{}'::jsonb$$,
  '42501','ACTIVITY_SETTLEMENT_APPEND_ONLY','receipts are immutable');
select throws_ok($$delete from private.world_activity_settlements$$,
  '42501','ACTIVITY_SETTLEMENT_APPEND_ONLY','a live account''s receipt cannot be deleted');

-- ---- account deletion cascades through receipts and Creature bridge history ----
select is(private.world_life_activity_start_with_creature_v1('a9900000-0000-4000-8000-0000000000a9',
  'activity.fishing.inkyung','fishing.inkyung.north_01','11990000-0000-4000-8000-000000000003',1,1)
  ->'creatureContext'->>'status','SUCCESS','a bridged start records Creature context history');
select throws_ok($$delete from private.world_life_creature_activity_contexts$$,
  '42501','CREATURE_LEDGER_APPEND_ONLY','a live account''s Creature history cannot be deleted');
select lives_ok($$delete from auth.users where id='a9900000-0000-4000-8000-0000000000a9'$$,
  'account deletion is not blocked by settlement or Creature append-only history');
select is((select count(*) from private.world_activity_settlements),0::bigint,'receipts cascade with the account');
select is((select count(*) from private.world_life_creature_activity_contexts
  where user_id='a9900000-0000-4000-8000-0000000000a9'),0::bigint,'Creature contexts cascade with the account');

select * from finish();
rollback;
