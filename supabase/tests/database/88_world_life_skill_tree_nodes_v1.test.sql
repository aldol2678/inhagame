-- INHA WORLD Life Skill Tree v1 node balance and graph contracts.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is((select count(*) from private.world_life_skill_nodes),24::bigint,
  'four initial Life Skill trees define 24 nodes');
select is((select count(*) from private.world_life_skill_node_prerequisites),25::bigint,
  'initial Life Skill trees define 25 prerequisite edges');
select is((select count(*) from private.world_life_skill_nodes where status='COMING_SOON'),24::bigint,
  'all initial Life Skill nodes remain pre-activation');
select is((select count(*) from private.world_life_skill_nodes where status='ACTIVE'),0::bigint,
  'node definition does not activate Life gameplay');

select results_eq($$
  select tree_id,count(*)::bigint,sum((max_rank * point_cost)::bigint)::bigint
    from private.world_life_skill_nodes
   where tree_id in ('life_tree.fishing','life_tree.woodcutting','life_tree.farming','life_tree.sailing')
   group by tree_id
   order by tree_id
$$,$$values
  ('life_tree.farming'::text,6::bigint,17::bigint),
  ('life_tree.fishing'::text,6::bigint,17::bigint),
  ('life_tree.sailing'::text,6::bigint,17::bigint),
  ('life_tree.woodcutting'::text,6::bigint,17::bigint)
$$,'each v1 specialization has six nodes and costs 17 SP at full rank');

select results_eq($$
  select node_id,required_life_level,point_cost,max_rank
    from private.world_life_skill_nodes
   where node_id in (
     'life_node.fishing.deep_sea_fishing',
     'life_node.woodcutting.master_forester',
     'life_node.farming.smart_farm',
     'life_node.sailing.deep_sea_navigation'
   )
   order by node_id
$$,$$values
  ('life_node.farming.smart_farm'::text,15,3,1),
  ('life_node.fishing.deep_sea_fishing'::text,15,3,1),
  ('life_node.sailing.deep_sea_navigation'::text,15,3,1),
  ('life_node.woodcutting.master_forester'::text,15,3,1)
$$,'every v1 capstone is a 3-SP Life Lv15 one-rank node');

select is((select count(*) from private.world_life_skill_nodes
  where required_skill_id is not null or required_skill_level is not null),0::bigint,
  'v1 nodes do not invent per-skill level gates before the per-skill XP curve is tuned');

select is((select count(*)
  from private.world_life_skill_node_prerequisites e
  join private.world_life_skill_nodes child on child.node_id=e.node_id
  join private.world_life_skill_nodes parent on parent.node_id=e.prerequisite_node_id
  where child.tree_id <> parent.tree_id),0::bigint,
  'no prerequisite crosses Life Skill Tree boundaries');

select is((select count(*)
  from private.world_life_skill_node_prerequisites e
  join private.world_life_skill_nodes parent on parent.node_id=e.prerequisite_node_id
  where e.required_rank > parent.max_rank),0::bigint,
  'every prerequisite rank is reachable');

select is((select count(*) from private.world_life_skill_nodes
  where node_id like 'life_node.sailing.%submarine%'),0::bigint,
  'Sailing tree does not own submarine technology');

select * from finish();
rollback;
