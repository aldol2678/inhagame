-- Account deletion cascades through every append-only ledger that guards DELETE
-- (20261004133000 Creature / Activity settlement, 20261004134000 Biryong / Life SP / Life nodes).
-- Activations and tree nodes below are fixtures and roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,last_sign_in_at) values
 ('dc100000-0000-4000-8000-0000000000c1','authenticated','authenticated','cascade-a@example.test',now(),false,now(),now()),
 ('dc200000-0000-4000-8000-0000000000c2','authenticated','authenticated','cascade-b@example.test',now(),false,now(),now());
insert into public.profiles(user_id,nickname,is_banned) values
 ('dc100000-0000-4000-8000-0000000000c1','연쇄삭제A',false),
 ('dc200000-0000-4000-8000-0000000000c2','연쇄삭제B',false);

-- ---- history in every guarded ledger for account A ----
select is(private.world_biryong_relationship_advance_v1('dc100000-0000-4000-8000-0000000000c1','BR_NPC_001',2::smallint,
  'QUEST','quest.test.cascade','quest-result:cascade:2','relationship:cascade:2')->>'status','ADVANCED',
  'fixture: Biryong relationship event');
select is(private.world_campus_npc_relationship_apply_v1(
  'dc100000-0000-4000-8000-0000000000c1','INKYUNG-NPC-001',1,'FIRST_MEETING',null,1,2::smallint,
  'SYSTEM','account-delete:cascade','campus-relationship:cascade')->>'status','APPLIED',
  'fixture: Campus NPC relationship event');

update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';
update private.world_collection_entry_catalog set status='ACTIVE' where entry_id='collection.fish.carp';
insert into private.world_life_skill_tree_catalog(
  node_id,skill_id,status,sp_cost,required_life_level,required_skill_level)
values ('life.node.fishing.cascade_test','life.fishing','ACTIVE',1,1,1);

select is(private.world_life_activity_start_with_creature_v1('dc100000-0000-4000-8000-0000000000c1',
  'activity.fishing.inkyung','fishing.inkyung.north_01','dc110000-0000-4000-8000-0000000000c1',1,1)
  ->'creatureContext'->>'status','SUCCESS','fixture: Creature bridge context');
select is(private.world_life_activity_finalize_with_creature_v1('dc100000-0000-4000-8000-0000000000c1',
  (select attempt_id from private.world_activity_attempts where user_id='dc100000-0000-4000-8000-0000000000c1'),
  'SUCCEEDED','CAUGHT','fishing_result:cascade')->'creatureBridge'->>'status','NOOP_INACTIVE',
  'fixture: Creature bridge decision');
select is(private.world_activity_settle_v1('dc100000-0000-4000-8000-0000000000c1',
  (select attempt_id from private.world_activity_attempts where user_id='dc100000-0000-4000-8000-0000000000c1'),
  '{"items":[{"itemId":"material.fish_carp","quantity":1}],"discoveries":[{"entryId":"collection.fish.carp"}],"lifeXp":[{"skillId":"life.fishing","amount":100}]}')
  ->>'status','SETTLED','fixture: settlement receipt, discovery and Life XP');
select is(private.world_life_node_unlock_v1('dc100000-0000-4000-8000-0000000000c1',
  'life.node.fishing.cascade_test','cascade:unlock')->>'status','SUCCESS','fixture: Life SP spend and unlocked node');

-- ---- direct deletes of a live account's history stay refused ----
select throws_ok($sql$delete from private.world_biryong_npc_relationship_events$sql$,
  '42501','BIRYONG_RELATIONSHIP_EVENT_APPEND_ONLY','live Biryong history cannot be deleted');
select throws_ok($sql$delete from private.world_campus_npc_relationship_events$sql$,
  '42501','CAMPUS_NPC_RELATIONSHIP_EVENT_APPEND_ONLY','live Campus NPC relationship history cannot be deleted');
select throws_ok($$delete from private.world_player_life_nodes$$,
  '42501','LIFE_NODE_APPEND_ONLY','live unlocked nodes cannot be deleted');
select throws_ok($$delete from private.world_life_sp_transactions$$,
  '42501','LIFE_SP_APPEND_ONLY','live SP spends cannot be deleted');
select throws_ok($$update private.world_biryong_npc_relationship_events set source_ref='x'$$,
  '42501','BIRYONG_RELATIONSHIP_EVENT_APPEND_ONLY','Biryong history stays immutable');

-- ---- the real self-service RPC deletes the account and every ledger row ----
set local role authenticated;
set local request.jwt.claims='{"sub":"dc100000-0000-4000-8000-0000000000c1","role":"authenticated","is_anonymous":false}';
select is(public.delete_my_inhagame_account_v1('탈퇴'),'{"deleted": true}'::jsonb,
  'account with Biryong, Creature, settlement and Life SP history is deleted');
reset role;

select is((select count(*) from auth.users where id='dc100000-0000-4000-8000-0000000000c1'),0::bigint,'auth user removed');
select is((
  select count(*) from (
    select user_id from private.world_biryong_npc_relationship_events
    union all select user_id from private.world_player_biryong_npc_relationships
    union all select user_id from private.world_campus_npc_relationship_events
    union all select user_id from private.world_player_campus_npc_relationships
    union all select user_id from private.world_life_creature_activity_contexts
    union all select user_id from private.world_life_creature_bridge_decisions
    union all select user_id from private.world_activity_settlements
    union all select user_id from private.world_life_sp_transactions
    union all select user_id from private.world_player_life_nodes
    union all select user_id from private.world_life_skill_xp_transactions
    union all select user_id from private.world_activity_attempts
  ) rows where user_id='dc100000-0000-4000-8000-0000000000c1'),0::bigint,
  'no guarded history row survives the account');

-- ---- another account is untouched ----
select is((select count(*) from auth.users where id='dc200000-0000-4000-8000-0000000000c2'),1::bigint,
  'other accounts are not affected');

select * from finish();
rollback;
