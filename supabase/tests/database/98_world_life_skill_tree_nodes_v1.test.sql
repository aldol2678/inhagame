-- INHA WORLD Life Skill Tree v1 nodes (20261004136000 + later activation migrations). Test-only extra activations roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9820000-0000-4000-8000-0000000000a9','authenticated','authenticated','tree-v1@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9820000-0000-4000-8000-0000000000a9','트리V1',false);

-- ---- published shape ----
select is((select count(*) from private.world_life_skill_tree_catalog where node_id like 'life.node.%'),18::bigint,
  '18 tree v1 nodes are published');
select is((select count(*) from private.world_life_skill_tree_catalog where status = 'ACTIVE'),2::bigint,
  'only two implemented Fishing timing nodes are active');
select results_eq($$
  select node_id from private.world_life_skill_tree_catalog where status='ACTIVE' order by node_id
$$,$$values ('life.node.fishing.fish_sense'::text),('life.node.fishing.steady_hands'::text)$$,
  'active tree nodes are exactly fish_sense and steady_hands');
select results_eq($$
  select skill_id,count(*),sum(max_rank*sp_cost)::int,max(required_skill_level),min(required_life_level),max(required_life_level)
    from private.world_life_skill_tree_catalog group by skill_id order by skill_id
$$,$$values ('life.farming'::text,6::bigint,17,15,1,1),('life.fishing',6,17,15,1,1),('life.woodcutting',6,17,15,1,1)$$,
  'three trees of 6 nodes, 17 SP each, gated on skill level up to Lv15');
select is((select count(*) from private.world_life_skill_tree_edges),18::bigint,'18 prerequisite edges');
select is((select array_agg(skill_id) from private.world_life_skill_catalog where status <> 'COMING_SOON'),
  array['life.fishing'],'Fishing remains the only active Life Skill');

-- ---- a full fishing tree is reachable at skill Lv15 with exactly its 17 SP (test activation) ----
update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';
update private.world_life_skill_tree_catalog set status='ACTIVE' where skill_id='life.fishing';
select is(private.world_life_skill_xp_apply_v1('a9820000-0000-4000-8000-0000000000a9','life.fishing',10500,
  'activity','activity.fishing.inkyung:tree_v1','tree-v1:xp')->>'status','SUCCESS','fishing reaches Lv15');

create temp table tree_v1_order(step int primary key, node_key text) on commit drop;
insert into tree_v1_order values
 (1,'steady_hands'),(2,'steady_hands'),(3,'steady_hands'),
 (4,'fish_sense'),(5,'fish_sense'),(6,'fish_sense'),
 (7,'baitcraft'),(8,'baitcraft'),
 (9,'rare_fish_sense'),(10,'rare_fish_sense'),
 (11,'boat_fishing'),(12,'deep_sea_fishing');
select is(private.world_life_node_unlock_v1('a9820000-0000-4000-8000-0000000000a9',
  'life.node.fishing.' || node_key,'tree-v1:unlock:' || step)->>'status','SUCCESS',
  format('step %s: %s',step,node_key))
from tree_v1_order order by step;

select is(private.world_life_skill_sp_snapshot_v1('a9820000-0000-4000-8000-0000000000a9','life.fishing')
  - array['skillId','curveId','nextLevelEarnedSp'],
  jsonb_build_object('skillLevel',15,'earnedSp',17,'spentSp',17,'availableSp',0),
  'maxing the fishing tree spends exactly the 17 SP earned by Lv15');
select is((select count(*) from private.world_player_life_nodes
  where user_id='a9820000-0000-4000-8000-0000000000a9'),12::bigint,'12 acquired ranks');
select throws_ok($$select private.world_life_node_unlock_v1('a9820000-0000-4000-8000-0000000000a9',
  'life.node.woodcutting.clean_cut','tree-v1:wood')$$,
  'P0001','LIFE_NODE_INACTIVE','other trees stay COMING_SOON');

select * from finish();
rollback;
