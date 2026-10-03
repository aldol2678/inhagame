-- INHA WORLD Life Progression / Skill Tree player read-model v1.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9000000-0000-4000-8000-0000000000a9','authenticated','authenticated','life-read-a@example.test',now(),false),
 ('b9000000-0000-4000-8000-0000000000b9','authenticated','authenticated','life-read-b@example.test',now(),false),
 ('c9000000-0000-4000-8000-0000000000c9','authenticated','authenticated',null,null,true),
 ('d9000000-0000-4000-8000-0000000000d9','authenticated','authenticated','life-read-d@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9000000-0000-4000-8000-0000000000a9','생활조회A',false),
 ('b9000000-0000-4000-8000-0000000000b9','생활조회B',false),
 ('c9000000-0000-4000-8000-0000000000c9','생활조회게스트',false),
 ('d9000000-0000-4000-8000-0000000000d9','생활조회정지',true);

insert into private.world_player_life_progression(
  user_id,total_xp,skill_points_earned,skill_points_spent,version
) values ('a9000000-0000-4000-8000-0000000000a9',4500,8,1,2);

insert into private.world_player_life_skill_nodes(user_id,node_id,rank,version)
values (
  'a9000000-0000-4000-8000-0000000000a9',
  'life_node.fishing.steady_hands',1,1
);

-- ---- privilege / shape ----
select ok(has_function_privilege('authenticated',
  'public.get_my_world_life_progression_v1()','execute'),
  'authenticated can read own aggregate Life progression');
select ok(has_function_privilege('authenticated',
  'public.get_my_world_life_skill_tree_v1(text)','execute'),
  'authenticated can read own Life Skill Tree');
select ok(not has_function_privilege(r,
  'public.get_my_world_life_progression_v1()','execute'),
  format('%s cannot call Life progression read',r))
from unnest(array['anon','service_role']) r;
select ok(not has_function_privilege(r,
  'public.get_my_world_life_skill_tree_v1(text)','execute'),
  format('%s cannot call Life Skill Tree read',r))
from unnest(array['anon','service_role']) r;
select ok(to_regprocedure('public.get_my_world_life_progression_v1(uuid)') is null,
  'progression read has no client-supplied user id');
select ok(to_regprocedure('public.get_my_world_life_skill_tree_v1(uuid,text)') is null,
  'tree read has no client-supplied user id');

-- ---- aggregate dashboard ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a9000000-0000-4000-8000-0000000000a9","is_anonymous":false}';

select results_eq($$
  select (r->>'level')::int,(r->>'totalXp')::bigint,
         (r->>'skillPointsEarned')::int,(r->>'skillPointsSpent')::int,
         (r->>'skillPointsBalance')::int,jsonb_array_length(r->'trees')
  from (select public.get_my_world_life_progression_v1() r) s
$$,$$values (10,4500::bigint,8,1,7,4)$$,
  'dashboard returns server-derived Life Lv10, XP, SP and the four defined trees');

select results_eq($$
  select x->>'treeId',x->>'status',(x->>'nodeCount')::int,(x->>'spentPoints')::int
  from jsonb_array_elements(public.get_my_world_life_progression_v1()->'trees') x
  order by x->>'treeId'
$$,$$values
  ('life_tree.farming'::text,'COMING_SOON'::text,6,0),
  ('life_tree.fishing'::text,'ACTIVE'::text,6,1),
  ('life_tree.sailing'::text,'COMING_SOON'::text,6,0),
  ('life_tree.woodcutting'::text,'COMING_SOON'::text,6,0)
$$,'tree summaries expose server status and invested SP only for the caller');

-- ---- active Fishing read ----
select results_eq($$
  select r->>'treeId',r->>'status',(r->>'spentPoints')::int,
         (r->>'nodeCount')::int,(r->>'canReset')::boolean,
         jsonb_array_length(r->'nodes')
  from (select public.get_my_world_life_skill_tree_v1('life_tree.fishing') r) s
$$,$$values ('life_tree.fishing'::text,'ACTIVE'::text,1,6,true,6)$$,
  'Fishing read returns one active six-node tree with one invested SP');

select results_eq($$
  select x->>'nodeId',(x->>'rank')::int,(x->>'canRankUp')::boolean,x->>'unavailableReason'
  from jsonb_array_elements(public.get_my_world_life_skill_tree_v1('life_tree.fishing')->'nodes') x
  order by x->>'nodeId'
$$,$$values
  ('life_node.fishing.baitcraft'::text,0,true,null::text),
  ('life_node.fishing.boat_fishing'::text,0,false,'PREREQUISITE_REQUIRED'::text),
  ('life_node.fishing.deep_sea_fishing'::text,0,false,'LIFE_LEVEL_REQUIRED'::text),
  ('life_node.fishing.fish_sense'::text,0,true,null::text),
  ('life_node.fishing.rare_fish_sense'::text,0,false,'PREREQUISITE_REQUIRED'::text),
  ('life_node.fishing.steady_hands'::text,1,true,null::text)
$$,'Fishing availability is derived from server Life Level, SP and prerequisite ranks');

select results_eq($$
  select p->>'nodeId',(p->>'requiredRank')::int,(p->>'currentRank')::int
  from jsonb_array_elements(
    (select x->'prerequisites'
       from jsonb_array_elements(public.get_my_world_life_skill_tree_v1('life_tree.fishing')->'nodes') x
      where x->>'nodeId'='life_node.fishing.fish_sense')
  ) p
$$,$$values ('life_node.fishing.steady_hands'::text,1,1)$$,
  'prerequisite read includes only caller-owned current rank');

-- ---- inactive trees are browseable but never locally unlockable ----
select is(public.get_my_world_life_skill_tree_v1('life_tree.farming')->>'status',
  'COMING_SOON','Farming remains browseable as coming soon');
select is((
  select bool_and(not (x->>'canRankUp')::boolean)
    from jsonb_array_elements(public.get_my_world_life_skill_tree_v1('life_tree.farming')->'nodes') x
),true,'every Farming node is server-blocked before activation');
select is((
  select count(*)
    from jsonb_array_elements(public.get_my_world_life_skill_tree_v1('life_tree.farming')->'nodes') x
   where x->>'unavailableReason'='INACTIVE'
),6::bigint,'inactive tree reports a stable INACTIVE reason');

select throws_ok($$
  select public.get_my_world_life_skill_tree_v1('life_tree.not_real')
$$,'P0002','LIFE_SKILL_TREE_NOT_FOUND','unknown tree is rejected');
select throws_ok($$
  select public.get_my_world_life_skill_tree_v1('bad')
$$,'22023','INVALID_LIFE_SKILL_TREE','malformed tree id is rejected');
reset role;

-- ---- fresh read is side-effect free ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"b9000000-0000-4000-8000-0000000000b9","is_anonymous":false}';
select results_eq($$
  select (r->>'level')::int,(r->>'totalXp')::bigint,(r->>'skillPointsBalance')::int
  from (select public.get_my_world_life_progression_v1() r) s
$$,$$values (1,0::bigint,0)$$,'fresh account reads Life Lv1 / 0 XP / 0 SP');
reset role;
select is((select count(*) from private.world_player_life_progression
  where user_id='b9000000-0000-4000-8000-0000000000b9'),0::bigint,
  'read-only dashboard does not provision progression state');

-- ---- account boundary ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"c9000000-0000-4000-8000-0000000000c9","is_anonymous":true}';
select throws_ok($$select public.get_my_world_life_progression_v1()$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED','anonymous account cannot read permanent Life progression');
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"d9000000-0000-4000-8000-0000000000d9","is_anonymous":false}';
select throws_ok($$select public.get_my_world_life_progression_v1()$$,
  '42501','ACCOUNT_UNAVAILABLE','banned account cannot read Life progression');
reset role;

-- Fishing tree activation does not activate per-skill XP authority prematurely.
select is((select status from private.world_life_skill_catalog where skill_id='life.fishing'),
  'COMING_SOON','Fishing per-skill XP stays pre-activation until its own curve is tuned');

select * from finish();
rollback;
