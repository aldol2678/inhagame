-- INHA WORLD Life Skill Tree ranks + published-definition guards (20261004135000).
-- Every node, edge and activation below is a fixture and rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9810000-0000-4000-8000-0000000000a9','authenticated','authenticated','rank-a@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9810000-0000-4000-8000-0000000000a9','랭크A',false);

-- ---- schema ----
select has_column('private','world_life_skill_tree_catalog','max_rank','nodes carry a max rank');
select has_column('private','world_life_skill_tree_edges','required_rank','edges carry a required prerequisite rank');
select has_column('private','world_player_life_nodes','rank','acquired ranks are rows');
select has_column('private','world_life_sp_transactions','rank','each spend records the rank it bought');
select col_is_pk('private','world_player_life_nodes',array['user_id','node_id','epoch','rank'],'one row per acquired rank (per reset epoch)');
select ok(not has_function_privilege(r,'private.world_life_node_rank_v1(uuid,text)','execute'),
  format('%s cannot call the private rank read',r))
from unnest(array['anon','authenticated','service_role']) r;

-- ---- fixtures ----
update private.world_life_skill_catalog set status='ACTIVE' where skill_id in ('life.fishing','life.mining');
insert into private.world_life_skill_tree_catalog(
  node_id,skill_id,status,sp_cost,max_rank,required_life_level,required_skill_level) values
  ('life.node.fishing.rank_root','life.fishing','ACTIVE',1,3,1,2),
  ('life.node.fishing.rank_child','life.fishing','ACTIVE',2,1,1,3),
  ('life.node.mining.rank_other','life.mining','ACTIVE',1,1,1,1);
insert into private.world_life_skill_tree_edges(node_id,prerequisite_node_id,required_rank) values
  ('life.node.fishing.rank_child','life.node.fishing.rank_root',2);

-- ---- published definitions are immutable ----
select throws_ok($$update private.world_life_skill_tree_catalog set sp_cost=2 where node_id='life.node.fishing.rank_root'$$,
  '42501','LIFE_TREE_DEFINITION_IMMUTABLE','a published node cost cannot change');
select throws_ok($$update private.world_life_skill_tree_catalog set max_rank=5 where node_id='life.node.fishing.rank_root'$$,
  '42501','LIFE_TREE_DEFINITION_IMMUTABLE','a published max rank cannot change');
select throws_ok($$delete from private.world_life_skill_tree_catalog where node_id='life.node.mining.rank_other'$$,
  '42501','LIFE_TREE_DEFINITION_IMMUTABLE','a published node cannot be deleted');
select lives_ok($$update private.world_life_skill_tree_catalog set status='COMING_SOON' where node_id='life.node.mining.rank_other'$$,
  'status alone may change');
select throws_ok($$update private.world_life_skill_tree_edges set required_rank=1$$,
  '42501','LIFE_TREE_DEFINITION_IMMUTABLE','a published edge cannot change');
select throws_ok($$delete from private.world_life_skill_tree_edges$$,
  '42501','LIFE_TREE_DEFINITION_IMMUTABLE','a published edge cannot be deleted');
select throws_ok($$insert into private.world_life_skill_tree_edges(node_id,prerequisite_node_id)
  values ('life.node.fishing.rank_root','life.node.mining.rank_other')$$,
  '23514','LIFE_TREE_EDGE_INVALID','cross-skill edges are refused in the database');
select throws_ok($$insert into private.world_life_skill_tree_edges(node_id,prerequisite_node_id,required_rank)
  values ('life.node.fishing.rank_root','life.node.fishing.rank_child',2)$$,
  '23514','LIFE_TREE_EDGE_INVALID','an edge cannot require more than the prerequisite max rank');

-- ---- rank acquisition ----
select is(private.world_life_skill_xp_apply_v1('a9810000-0000-4000-8000-0000000000a9','life.fishing',300,
  'activity','activity.fishing.inkyung:rank_001','rank:a:xp:001')->>'status','SUCCESS','fishing reaches Lv3 (2 SP)');

select is(private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_root','rank:a:root:1')->>'rankAfter','1','first unlock acquires rank 1');
select throws_ok($$select private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_child','rank:a:child:early')$$,
  'P0001','LIFE_NODE_PREREQUISITE_LOCKED','child needs rank 2 of its prerequisite');
select is(private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_root','rank:a:root:2')->>'rankAfter','2','next unlock acquires rank 2');
select throws_ok($$select private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_root','rank:a:root:3:early')$$,
  'P0001','LIFE_SP_INSUFFICIENT','each rank costs its own SP');

select is(private.world_life_skill_xp_apply_v1('a9810000-0000-4000-8000-0000000000a9','life.fishing',700,
  'activity','activity.fishing.inkyung:rank_002','rank:a:xp:002')->>'status','SUCCESS','fishing reaches Lv5 (5 SP)');
select is(private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_child','rank:a:child')->>'spAfter','1','prerequisite rank met: child unlocks');
select is(private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_root','rank:a:root:3')->>'rankAfter','3','rank 3 acquired');
select throws_ok($$select private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_root','rank:a:root:4')$$,
  '23505','LIFE_NODE_MAX_RANK','no rank above max rank');

select results_eq($$
  select rank,sp_cost,sp_before,sp_after from private.world_life_sp_transactions
   where node_id='life.node.fishing.rank_root' order by rank
$$,$$values (1,1,2,1),(2,1,1,0),(3,1,1,0)$$,'one spend per rank with per-pool balances');
select results_eq($$
  select rank from private.world_player_life_nodes
   where user_id='a9810000-0000-4000-8000-0000000000a9' and node_id='life.node.fishing.rank_root' order by rank
$$,$$values (1),(2),(3)$$,'one append-only row per acquired rank');
select is((select n->>'rank' from jsonb_array_elements(private.world_life_skill_tree_snapshot_v1(
  'a9810000-0000-4000-8000-0000000000a9','life.fishing')->'nodes') n
  where n->>'nodeId'='life.node.fishing.rank_root'),'3','tree snapshot reports the current rank');
select is((select n->'prerequisites' from jsonb_array_elements(private.world_life_skill_tree_snapshot_v1(
  'a9810000-0000-4000-8000-0000000000a9','life.fishing')->'nodes') n
  where n->>'nodeId'='life.node.fishing.rank_child'),
  '[{"nodeId":"life.node.fishing.rank_root","requiredRank":2}]'::jsonb,'tree snapshot reports required ranks');
select is((private.world_life_skill_sp_snapshot_v1('a9810000-0000-4000-8000-0000000000a9','life.fishing')->>'spentSp')::int,
  5,'spent SP = sum of every rank and node in the pool');

-- ---- replay and disable ----
update private.world_life_skill_tree_catalog set status='DISABLED' where node_id='life.node.fishing.rank_root';
select is(private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_root','rank:a:root:1')->>'rankAfter','1',
  'exact replay returns the committed rank even after the node is disabled');
select throws_ok($$select private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.mining.rank_other','rank:a:other')$$,
  'P0001','LIFE_NODE_INACTIVE','a node that is not ACTIVE cannot be unlocked');
select throws_ok($$select private.world_life_node_unlock_v1('a9810000-0000-4000-8000-0000000000a9',
  'life.node.fishing.rank_child','rank:a:root:1')$$,
  '23505','IDEMPOTENCY_CONFLICT','a key cannot be reused for another node');

select * from finish();
rollback;
