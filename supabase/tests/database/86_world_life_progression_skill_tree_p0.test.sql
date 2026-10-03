-- INHA WORLD P0 aggregate Life progression + Skill Tree foundation.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a8600000-0000-4000-8000-0000000000a8','authenticated','authenticated','life-prog-a@example.test',now(),false),
 ('b8600000-0000-4000-8000-0000000000b8','authenticated','authenticated','life-prog-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a8600000-0000-4000-8000-0000000000a8','생활성장A',false),
 ('b8600000-0000-4000-8000-0000000000b8','생활성장B',false);

-- ---- schema / seed contracts ----
select has_table('private','world_life_progression_thresholds','aggregate Life Level thresholds exist');
select has_table('private','world_player_life_progression','aggregate Life progression projection exists');
select has_table('private','world_life_xp_transactions','aggregate Life XP ledger exists');
select has_table('private','world_life_skill_point_transactions','Life SP ledger exists');
select has_table('private','world_life_skill_tree_catalog','Life Skill Tree catalog exists');
select has_table('private','world_life_skill_nodes','Life Skill node catalog exists');
select has_table('private','world_life_skill_node_prerequisites','Life Skill node prerequisite graph exists');
select has_table('private','world_player_life_skill_nodes','player Life Skill node ranks exist');

select col_is_pk('private','world_life_progression_thresholds',array['curve_id','level'],
  'Life Level curve key is immutable curve + level');
select col_is_pk('private','world_player_life_progression',array['user_id'],
  'one aggregate Life projection per account');
select col_is_unique('private','world_life_xp_transactions',array['idempotency_key'],
  'aggregate Life XP idempotency key is globally unique');
select col_is_unique('private','world_life_skill_point_transactions',array['idempotency_key'],
  'Life SP idempotency key is globally unique');
select col_is_pk('private','world_player_life_skill_nodes',array['user_id','node_id'],
  'one purchased rank row per account/node');

select results_eq($$
  select level,min_total_xp,skill_points_reward
    from private.world_life_progression_thresholds
   where curve_id='life.progression.v1' and level=1
$$,$$values (1,0::bigint,0)$$,
  'Life progression foundation keeps the canonical Lv1 origin at 0 XP / 0 SP');

select is((select count(*) from private.world_life_skill_catalog),12::bigint,
  'Sailing extends the long-term Life Skill catalog to 12');
select is((select status from private.world_life_skill_catalog where skill_id='life.sailing'),
  'COMING_SOON','Sailing is modeled but not activated');

select is((select count(*) from private.world_life_skill_tree_catalog),13::bigint,
  'one shared tree plus one tree for each of 12 Life Skills are mirrored');
select is((select count(*) from private.world_life_skill_tree_catalog where status='COMING_SOON'),12::bigint,
  'only Fishing is activated by the later read/UI migration');
select is((select status from private.world_life_skill_tree_catalog where tree_id='life_tree.fishing'),
  'ACTIVE','Fishing is the first active Life Skill Tree');
-- Node seed state belongs to later forward migrations; this foundation test only owns table shape.

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_life_progression_thresholds'::regclass,
  'private.world_player_life_progression'::regclass,
  'private.world_life_xp_transactions'::regclass,
  'private.world_life_skill_point_transactions'::regclass,
  'private.world_life_skill_tree_catalog'::regclass,
  'private.world_life_skill_nodes'::regclass,
  'private.world_life_skill_node_prerequisites'::regclass,
  'private.world_player_life_skill_nodes'::regclass
)), 'all Life progression/tree tables have RLS');

select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array[
       'private.world_life_progression_thresholds',
       'private.world_player_life_progression',
       'private.world_life_xp_transactions',
       'private.world_life_skill_point_transactions',
       'private.world_life_skill_tree_catalog',
       'private.world_life_skill_nodes',
       'private.world_life_skill_node_prerequisites',
       'private.world_player_life_skill_nodes'
     ]) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

select ok(not has_function_privilege(r,
  'private.world_life_progression_level_for_xp_v1(text,bigint)','execute'),
  format('%s cannot call private Life Level derivation',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,
  'private.world_life_progression_snapshot_v1(uuid)','execute'),
  format('%s cannot call private aggregate Life snapshot',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(to_regprocedure('public.get_my_world_life_progression_v1()') is null,
  'P0 exposes no player-facing Life progression RPC yet');

-- ---- fresh read is derived and does not provision state ----
select is((private.world_life_progression_snapshot_v1(
  'a8600000-0000-4000-8000-0000000000a8')->>'totalXp')::bigint,0::bigint,
  'fresh aggregate Life snapshot reads 0 XP');
select is((private.world_life_progression_snapshot_v1(
  'a8600000-0000-4000-8000-0000000000a8')->>'level')::integer,1,
  'fresh aggregate Life snapshot derives Lv1');
select is((private.world_life_progression_snapshot_v1(
  'a8600000-0000-4000-8000-0000000000a8')->>'skillPointsBalance')::integer,0,
  'fresh aggregate Life snapshot reads 0 SP');
select is((select count(*) from private.world_player_life_progression
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'read-only snapshot creates no player projection');

-- ---- Life Level curve remains immutable after the later balance migration ----
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',150),2,
  'foundation snapshot uses the committed Life curve without storing Level');
select throws_ok($$
  update private.world_life_progression_thresholds
     set min_total_xp=90
   where curve_id='life.progression.v1' and level=2
$$,'42501','LIFE_PROGRESSION_CURVE_IMMUTABLE','committed Life Level thresholds cannot be rewritten');

-- ---- projection and SP ledger shape ----
insert into private.world_player_life_progression(
  user_id,total_xp,skill_points_earned,skill_points_spent,version
) values ('a8600000-0000-4000-8000-0000000000a8',150,3,1,1);

select results_eq($$
  select total_xp,skill_points_earned,skill_points_spent,skill_points_balance,version
    from private.world_player_life_progression
   where user_id='a8600000-0000-4000-8000-0000000000a8'
$$,$$values (150::bigint,3,1,2,1::bigint)$$,
  'SP balance is generated from earned minus spent');

select is((private.world_life_progression_snapshot_v1(
  'a8600000-0000-4000-8000-0000000000a8')->>'level')::integer,2,
  '150 aggregate Life XP derives committed Life Lv2');
select is((private.world_life_progression_snapshot_v1(
  'a8600000-0000-4000-8000-0000000000a8')->>'skillPointsBalance')::integer,2,
  'aggregate snapshot returns generated SP balance');

insert into private.world_life_xp_transactions(
  user_id,amount,xp_before,xp_after,level_before,level_after,skill_points_awarded,
  source_type,source_id,idempotency_key
) values (
  'a8600000-0000-4000-8000-0000000000a8',150,0,150,1,2,1,
  'activity','activity.fishing.inkyung:test','life-total-xp:a:001'
);

-- Test-only node definitions prove tree ownership and prerequisite shape.
insert into private.world_life_skill_nodes(
  node_id,tree_id,max_rank,point_cost,required_life_level,
  required_skill_id,required_skill_level,effect_key,status,definition_version
) values
 ('life_node.fishing.test_foundation_root','life_tree.fishing',3,1,2,
  'life.fishing',2,'fishing.test_foundation_root.v1','ACTIVE',1),
 ('life_node.fishing.test_foundation_child','life_tree.fishing',1,2,3,
  'life.fishing',3,'fishing.test_foundation_child.v1','ACTIVE',1);

insert into private.world_life_skill_node_prerequisites(
  node_id,prerequisite_node_id,required_rank
) values ('life_node.fishing.test_foundation_child','life_node.fishing.test_foundation_root',2);

insert into private.world_player_life_skill_nodes(
  user_id,node_id,rank,version
) values (
  'a8600000-0000-4000-8000-0000000000a8',
  'life_node.fishing.test_foundation_root',1,1
);

insert into private.world_life_skill_point_transactions(
  user_id,delta,balance_before,balance_after,reason_type,source_id,node_id,tree_id,idempotency_key
) values (
  'a8600000-0000-4000-8000-0000000000a8',
  -1,2,1,'NODE_RANK_UP','life_node.fishing.test_foundation_root:rank:1',
  'life_node.fishing.test_foundation_root','life_tree.fishing','life-sp:a:test-foundation:1'
);

select results_eq($$
  select delta,balance_before,balance_after,reason_type,node_id
    from private.world_life_skill_point_transactions
   where idempotency_key='life-sp:a:test-foundation:1'
$$,$$values (-1,2,1,'NODE_RANK_UP'::text,'life_node.fishing.test_foundation_root'::text)$$,
  'node purchase SP transaction preserves before/after audit state');

select throws_ok($$
  update private.world_life_skill_point_transactions
     set balance_after=0
   where idempotency_key='life-sp:a:test-foundation:1'
$$,'42501','LIFE_PROGRESSION_LEDGER_APPEND_ONLY','SP ledger is append-only');
select throws_ok($$
  update private.world_life_xp_transactions
     set amount=999
   where idempotency_key='life-total-xp:a:001'
$$,'42501','LIFE_PROGRESSION_LEDGER_APPEND_ONLY','aggregate Life XP ledger is append-only');

-- ---- account lifecycle and progression isolation ----
select is((select count(*) from private.world_exp_transactions
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'aggregate Life XP creates no Campus World EXP');
select is((select count(*) from private.world_player_life_skills
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'aggregate Life progression does not fabricate per-skill XP');

delete from auth.users where id='a8600000-0000-4000-8000-0000000000a8';
select is((select count(*) from private.world_player_life_progression
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes aggregate Life projection');
select is((select count(*) from private.world_life_xp_transactions
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes aggregate Life XP history');
select is((select count(*) from private.world_life_skill_point_transactions
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes SP history');
select is((select count(*) from private.world_player_life_skill_nodes
  where user_id='a8600000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes purchased node ranks');

select * from finish();
rollback;
