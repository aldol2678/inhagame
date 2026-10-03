-- INHA WORLD Life Skill Tree mutation authority v1.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a8900000-0000-4000-8000-0000000000a8','authenticated','authenticated','life-tree-a@example.test',now(),false),
 ('b8900000-0000-4000-8000-0000000000b8','authenticated','authenticated','life-tree-b@example.test',now(),false),
 ('c8900000-0000-4000-8000-0000000000c8','authenticated','authenticated',null,null,true),
 ('d8900000-0000-4000-8000-0000000000d8','authenticated','authenticated','life-tree-d@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a8900000-0000-4000-8000-0000000000a8','트리A',false),
 ('b8900000-0000-4000-8000-0000000000b8','트리B',false),
 ('c8900000-0000-4000-8000-0000000000c8','트리게스트',false),
 ('d8900000-0000-4000-8000-0000000000d8','트리정지',true);

insert into private.world_player_life_progression(
  user_id,total_xp,skill_points_earned,skill_points_spent,version
) values
 ('a8900000-0000-4000-8000-0000000000a8',19000,23,0,1),
 ('b8900000-0000-4000-8000-0000000000b8',100,0,0,1);

-- ---- API surface / privilege boundary ----
select ok(has_function_privilege('authenticated',
  'public.rank_up_my_world_life_skill_node_v1(text,text)','execute'),
  'authenticated can rank up own Life Skill node');
select ok(has_function_privilege('authenticated',
  'public.reset_my_world_life_skill_tree_v1(text,text)','execute'),
  'authenticated can reset own Life Skill tree');
select ok(not has_function_privilege(r,
  'public.rank_up_my_world_life_skill_node_v1(text,text)','execute'),
  format('%s cannot call rank-up RPC',r))
from unnest(array['anon','service_role']) r;
select ok(not has_function_privilege(r,
  'public.reset_my_world_life_skill_tree_v1(text,text)','execute'),
  format('%s cannot call reset RPC',r))
from unnest(array['anon','service_role']) r;
select ok(to_regprocedure('public.rank_up_my_world_life_skill_node_v1(uuid,text,text)') is null,
  'rank-up RPC has no client-supplied user id');
select ok(to_regprocedure('public.rank_up_my_world_life_skill_node_v1(text,integer,text)') is null,
  'rank-up RPC has no client-supplied point amount');

select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array[
       'private.world_player_life_progression',
       'private.world_player_life_skill_nodes',
       'private.world_life_skill_point_transactions',
       'private.world_life_skill_tree_transactions'
     ]) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

-- ---- inactive tree gate ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select throws_ok($
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.sailing.seamanship','life-tree:a:prelive')
$,'P0001','LIFE_SKILL_NODE_INACTIVE','COMING_SOON trees cannot spend SP');
reset role;

-- Fishing is the first committed ACTIVE tree in the later read/UI migration.

-- ---- rank-up / replay / prerequisites / cost ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';

select results_eq($$
  select r->>'status',(r->>'rankBefore')::int,(r->>'rankAfter')::int,
         (r->>'pointsDelta')::int,(r->>'balanceBefore')::int,(r->>'balanceAfter')::int
  from (select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.steady_hands','life-tree:a:steady:1') r) s
$$,$$values ('SUCCESS'::text,0,1,-1,23,22)$$,
  'first root rank spends the server-defined 1 SP');

select results_eq($$
  select r->>'status',(r->>'rankAfter')::int,(r->>'balanceAfter')::int
  from (select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.steady_hands','life-tree:a:steady:1') r) s
$$,$$values ('ALREADY_PROCESSED'::text,1,22)$$,
  'same rank-up key replays the exact committed rank and balance');

select throws_ok($$
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.fish_sense','life-tree:a:steady:1')
$$,'23505','IDEMPOTENCY_CONFLICT','one mutation key cannot name a different node');

select is(public.rank_up_my_world_life_skill_node_v1(
  'life_node.fishing.fish_sense','life-tree:a:sense:1')->>'status',
  'SUCCESS','root prerequisite unlocks Fish Sense rank 1');
select throws_ok($$
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.rare_fish_sense','life-tree:a:rare:blocked')
$$,'P0001','LIFE_SKILL_PREREQUISITE_REQUIRED','Rare Fish Sense needs Fish Sense rank 2');
select is(public.rank_up_my_world_life_skill_node_v1(
  'life_node.fishing.fish_sense','life-tree:a:sense:2')->>'status',
  'SUCCESS','Fish Sense can reach rank 2');
select results_eq($$
  select (r->>'rankAfter')::int,(r->>'pointsDelta')::int,(r->>'balanceAfter')::int
  from (select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.rare_fish_sense','life-tree:a:rare:1') r) s
$$,$$values (1,-2,18)$$,'Rare Fish Sense spends its immutable 2-SP cost');

select is(public.rank_up_my_world_life_skill_node_v1(
  'life_node.fishing.boat_fishing','life-tree:a:boat:1')->>'status',
  'SUCCESS','Boat Fishing unlocks after Fish Sense rank 2');
select throws_ok($$
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.boat_fishing','life-tree:a:boat:2')
$$,'P0001','LIFE_SKILL_NODE_MAX_RANK','one-rank node cannot be bought twice');

reset role;

select results_eq($$
  select skill_points_earned,skill_points_spent,skill_points_balance
    from private.world_player_life_progression
   where user_id='a8900000-0000-4000-8000-0000000000a8'
$$,$$values (23,7,16)$$,'rank-ups spend 7 of A account 23 SP');
select is((select count(*) from private.world_life_skill_point_transactions
  where user_id='a8900000-0000-4000-8000-0000000000a8'
    and reason_type='NODE_RANK_UP'),5::bigint,
  'five successful rank-up operations create five SP ledger rows');

-- ---- server-owned gates: Life Level and SP ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"b8900000-0000-4000-8000-0000000000b8","is_anonymous":false}';
select throws_ok($$
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.fish_sense','life-tree:b:level')
$$,'P0001','LIFE_LEVEL_REQUIRED','server-derived Life Lv2 cannot buy a Life Lv3 node');
select throws_ok($$
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.fishing.steady_hands','life-tree:b:no-sp')
$$,'P0001','INSUFFICIENT_LIFE_SKILL_POINTS','client cannot spend SP it does not own');
reset role;

-- Sailing remains COMING_SOON and cannot be bypassed.
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select throws_ok($$
  select public.rank_up_my_world_life_skill_node_v1(
    'life_node.sailing.seamanship','life-tree:a:sailing-prelive')
$$,'P0001','LIFE_SKILL_NODE_INACTIVE','inactive tree/node status is server enforced');
reset role;

-- ---- tree reset / exact refund / replay ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select results_eq($$
  select r->>'status',(r->>'pointsDelta')::int,
         (r->>'balanceBefore')::int,(r->>'balanceAfter')::int,
         jsonb_array_length(r->'resetNodes')
  from (select public.reset_my_world_life_skill_tree_v1(
    'life_tree.fishing','life-tree:a:reset:1') r) s
$$,$$values ('SUCCESS'::text,7,16,23,4)$$,
  'tree reset refunds exact immutable costs and reports four reset nodes');

select is(public.reset_my_world_life_skill_tree_v1(
  'life_tree.fishing','life-tree:a:reset:1')->>'status',
  'ALREADY_PROCESSED','same reset key replays without another refund');
reset role;

select results_eq($$
  select skill_points_earned,skill_points_spent,skill_points_balance
    from private.world_player_life_progression
   where user_id='a8900000-0000-4000-8000-0000000000a8'
$$,$$values (23,0,23)$$,'reset restores all 7 spent SP');
select is((select count(*) from private.world_player_life_skill_nodes
  where user_id='a8900000-0000-4000-8000-0000000000a8'
    and node_id like 'life_node.fishing.%'),0::bigint,
  'reset removes all purchased ranks in the selected tree');
select is((select count(*) from private.world_life_skill_point_transactions
  where user_id='a8900000-0000-4000-8000-0000000000a8'
    and reason_type='NODE_RESET'),1::bigint,
  'reset replay does not duplicate the positive SP ledger entry');

-- Empty reset is recorded as a deterministic zero-delta mutation.
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select results_eq($$
  select r->>'status',(r->>'pointsDelta')::int,
         (r->>'balanceBefore')::int,(r->>'balanceAfter')::int
  from (select public.reset_my_world_life_skill_tree_v1(
    'life_tree.fishing','life-tree:a:reset:empty') r) s
$$,$$values ('SUCCESS'::text,0,23,23)$$,'empty reset is an idempotent zero-delta success');
reset role;

-- Reset stays available after the tree is disabled, so invested points cannot become trapped.
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select is(public.rank_up_my_world_life_skill_node_v1(
  'life_node.fishing.steady_hands','life-tree:a:disable:buy')->>'status',
  'SUCCESS','buy one rank before disable');
reset role;
update private.world_life_skill_tree_catalog set status='DISABLED' where tree_id='life_tree.fishing';
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"a8900000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select is((public.reset_my_world_life_skill_tree_v1(
  'life_tree.fishing','life-tree:a:disable:reset')->>'pointsDelta')::int,1,
  'disabled tree still permits exact refund');
reset role;

-- ---- account boundary ----
set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"c8900000-0000-4000-8000-0000000000c8","is_anonymous":true}';
select throws_ok($$
  select public.reset_my_world_life_skill_tree_v1('life_tree.fishing','life-tree:guest')
$$,'42501','PERMANENT_ACCOUNT_REQUIRED','anonymous accounts cannot mutate permanent Life SP');
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"d8900000-0000-4000-8000-0000000000d8","is_anonymous":false}';
select throws_ok($$
  select public.reset_my_world_life_skill_tree_v1('life_tree.fishing','life-tree:banned')
$$,'42501','ACCOUNT_UNAVAILABLE','banned account cannot mutate Life SP');
reset role;

-- ---- immutable economics and append-only audit ----
select throws_ok($$
  update private.world_life_skill_nodes
     set point_cost=9
   where node_id='life_node.fishing.steady_hands'
$$,'42501','LIFE_SKILL_NODE_DEFINITION_IMMUTABLE','published node cost cannot be rewritten');
select lives_ok($$
  update private.world_life_skill_nodes
     set status='COMING_SOON'
   where node_id='life_node.fishing.steady_hands'
$$,'node status remains the one mutable definition field');
select throws_ok($$
  update private.world_life_skill_node_prerequisites
     set required_rank=1
   where node_id='life_node.fishing.rare_fish_sense'
     and prerequisite_node_id='life_node.fishing.fish_sense'
$$,'42501','LIFE_SKILL_PREREQUISITE_IMMUTABLE','published prerequisite semantics are immutable');
select throws_ok($$
  update private.world_life_skill_tree_transactions
     set balance_after=999
   where idempotency_key='life-tree:a:steady:1'
$$,'42501','LIFE_SKILL_TREE_TRANSACTION_APPEND_ONLY','mutation result ledger is append-only');

-- Life Skill mutations remain separate from Campus World EXP.
select is((select count(*) from private.world_exp_transactions
  where user_id in (
    'a8900000-0000-4000-8000-0000000000a8',
    'b8900000-0000-4000-8000-0000000000b8'
  )),0::bigint,'Life Skill mutation creates no Campus World EXP');

select * from finish();
rollback;
