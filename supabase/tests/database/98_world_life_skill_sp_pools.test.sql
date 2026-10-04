-- INHA WORLD Life Skill curve v1 + per-skill SP pools (Authority Map 7.1).
-- Every node, activation and extra curve row below is a test fixture and rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9800000-0000-4000-8000-0000000000a9','authenticated','authenticated','sp-a@example.test',now(),false),
 ('b9800000-0000-4000-8000-0000000000b9','authenticated','authenticated','sp-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9800000-0000-4000-8000-0000000000a9','풀A',false),
 ('b9800000-0000-4000-8000-0000000000b9','풀B',false);

-- ---- schema ----
select has_column('private','world_life_skill_thresholds','cumulative_sp','skill curve carries cumulative SP');
select has_column('private','world_life_sp_transactions','skill_id','SP ledger carries the pool');
select col_not_null('private','world_life_sp_transactions','skill_id','every SP spend names its pool');
select fk_ok('private','world_life_sp_transactions',array['node_id','skill_id'],
  'private','world_life_skill_tree_catalog',array['node_id','skill_id'],
  'SP spend pool is pinned to the node''s own skill');
select ok(not has_function_privilege(r,'private.world_life_skill_sp_snapshot_v1(uuid,text)','execute'),
  format('%s cannot call the private SP snapshot',r))
from unnest(array['anon','authenticated','service_role']) r;

-- ---- curve contracts ----
select throws_ok($$
  insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp,cumulative_sp)
  values ('life.sp_test.v1',1,0,1)
$$,'23514','LIFE_SKILL_CURVE_INVALID','a curve starts with 0 SP at Lv1');
insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp,cumulative_sp)
values ('life.sp_test.v1',1,0,0),('life.sp_test.v1',2,10,3);
select throws_ok($$
  insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp,cumulative_sp)
  values ('life.sp_test.v1',3,20,2)
$$,'23514','LIFE_SKILL_CURVE_INVALID','cumulative SP never decreases');
select throws_ok($$
  update private.world_life_skill_thresholds set cumulative_sp=99
   where curve_id='life.common.v1' and level=20
$$,'42501','LIFE_SKILL_CURVE_IMMUTABLE','published SP awards cannot be rewritten');

select throws_ok($$
  insert into private.world_life_progression_thresholds(curve_id,level,min_total_skill_xp,cumulative_sp)
  values ('life.progression.v1',2,100,1)
$$,'23514','LIFE_PROGRESSION_CURVE_INVALID','the aggregate Life Level is no longer an SP source');
select lives_ok($$
  insert into private.world_life_progression_thresholds(curve_id,level,min_total_skill_xp,cumulative_sp)
  values ('life.progression.v1',2,100,0)
$$,'the aggregate display curve can still append levels with 0 SP');

-- ---- reads ----
select is(private.world_life_skill_sp_snapshot_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing'),
  jsonb_build_object('skillId','life.fishing','curveId','life.common.v1','skillLevel',1,
    'earnedSp',0,'spentSp',0,'availableSp',0,'nextLevelEarnedSp',1),
  'fresh pool is Lv1 / 0 SP without provisioning state');
select is((select count(*) from private.world_player_life_skills
  where user_id='a9800000-0000-4000-8000-0000000000a9'),0::bigint,'SP read provisions no player row');
select ok(not (private.world_life_progression_snapshot_v1('a9800000-0000-4000-8000-0000000000a9') ?| array[
  'earnedSp','spentSp','availableSp']),'aggregate snapshot exposes no shared SP pool');

-- ---- fixtures: test-only activation and nodes ----
update private.world_life_skill_catalog set status='ACTIVE' where skill_id in ('life.fishing','life.mining');
insert into private.world_life_skill_tree_catalog(
  node_id,skill_id,status,sp_cost,required_life_level,required_skill_level) values
  ('life.node.fishing.steady_hands','life.fishing','ACTIVE',1,1,2),
  ('life.node.fishing.fish_sense','life.fishing','ACTIVE',2,1,3),
  ('life.node.fishing.deep_sea','life.fishing','ACTIVE',1,1,10),
  ('life.node.mining.root','life.mining','ACTIVE',1,1,1);
insert into private.world_life_skill_tree_edges(node_id,prerequisite_node_id) values
  ('life.node.fishing.fish_sense','life.node.fishing.steady_hands');

select is(private.world_life_skill_tree_snapshot_v1(
  'a9800000-0000-4000-8000-0000000000a9','life.fishing')->'sp'->>'availableSp','0',
  'tree snapshot carries the owning pool');

-- ---- earning SP from the owning skill only ----
select is(private.world_life_skill_xp_apply_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing',100,
  'activity','activity.fishing.inkyung:sp_001','sp:a:fishing:001')->>'status','SUCCESS','fishing reaches Lv2');
select is((private.world_life_skill_sp_snapshot_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing')->>'earnedSp')::int,
  1,'fishing Lv2 earns 1 fishing SP');
select is((private.world_life_skill_sp_snapshot_v1('a9800000-0000-4000-8000-0000000000a9','life.mining')->>'earnedSp')::int,
  0,'fishing XP earns no mining SP');

select throws_ok($$
  select private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
    'life.node.mining.root','sp:a:unlock:mining:early')
$$,'P0001','LIFE_SP_INSUFFICIENT','fishing SP cannot unlock a mining node');

select is(private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','sp:a:unlock:steady')->>'status','SUCCESS',
  'fishing SP unlocks a fishing node');
select results_eq($$
  select skill_id,node_id,sp_cost,sp_before,sp_after from private.world_life_sp_transactions
   where idempotency_key='sp:a:unlock:steady'
$$,$$values ('life.fishing'::text,'life.node.fishing.steady_hands'::text,1,1,0)$$,
  'ledger records the pool and per-pool balances');
select is(private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','sp:a:unlock:steady')->>'status','ALREADY_PROCESSED',
  'same unlock key replays');
select throws_ok($$
  select private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
    'life.node.fishing.steady_hands','sp:a:unlock:steady:again')
$$,'23505','LIFE_NODE_ALREADY_UNLOCKED','a node unlocks once');

-- mining earns its own SP; fishing stays at its own balance.
select is(private.world_life_skill_xp_apply_v1('a9800000-0000-4000-8000-0000000000a9','life.mining',100,
  'activity','activity.mining.campus:sp_001','sp:a:mining:001')->>'status','SUCCESS','mining reaches Lv2');
select is(private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
  'life.node.mining.root','sp:a:unlock:mining')->>'status','SUCCESS','mining SP unlocks the mining node');
select is(private.world_life_skill_sp_snapshot_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing')
  - array['skillId','curveId','nextLevelEarnedSp'],
  jsonb_build_object('skillLevel',2,'earnedSp',1,'spentSp',1,'availableSp',0),
  'spending mining SP leaves the fishing pool untouched');

-- ---- gates on the owning skill level ----
select is(private.world_life_skill_xp_apply_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing',200,
  'activity','activity.fishing.inkyung:sp_002','sp:a:fishing:002')->>'status','SUCCESS','fishing reaches Lv3');
select throws_ok($$
  select private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
    'life.node.fishing.fish_sense','sp:a:unlock:sense:short')
$$,'P0001','LIFE_SP_INSUFFICIENT','Lv3 fishing has 1 available SP, the node costs 2');
select is(private.world_life_skill_xp_apply_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing',700,
  'activity','activity.fishing.inkyung:sp_003','sp:a:fishing:003')->>'status','SUCCESS','fishing reaches Lv5');
select is((private.world_life_skill_sp_snapshot_v1('a9800000-0000-4000-8000-0000000000a9','life.fishing')->>'availableSp')::int,
  4,'Lv5 earns 5 cumulative fishing SP, 1 already spent');
select is(private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
  'life.node.fishing.fish_sense','sp:a:unlock:sense')->>'spAfter','2','prerequisite + SP met: node unlocks');
select throws_ok($$
  select private.world_life_node_unlock_v1('a9800000-0000-4000-8000-0000000000a9',
    'life.node.fishing.deep_sea','sp:a:unlock:deep')
$$,'P0001','LIFE_SKILL_LEVEL_REQUIRED','the gate is the owning skill''s level');

-- ---- account isolation and ledger integrity ----
select is((private.world_life_skill_sp_snapshot_v1('b9800000-0000-4000-8000-0000000000b9','life.fishing')->>'availableSp')::int,
  0,'another account has its own pool');
select throws_ok($$
  insert into private.world_life_sp_transactions(
    user_id,skill_id,node_id,sp_cost,sp_before,sp_after,idempotency_key)
  values ('b9800000-0000-4000-8000-0000000000b9','life.mining','life.node.fishing.deep_sea',1,1,0,'sp:b:forged')
$$,'23503',null,'a spend cannot be booked against another skill''s pool');
select throws_ok($$
  update private.world_life_sp_transactions set sp_cost=0 where idempotency_key='sp:a:unlock:steady'
$$,'42501','LIFE_SP_APPEND_ONLY','SP ledger stays append-only');

select * from finish();
rollback;
