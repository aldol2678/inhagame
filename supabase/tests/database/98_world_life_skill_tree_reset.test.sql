-- INHA WORLD Life Skill Tree reset (20261004137000): free, per skill, adjustable cooldown.
-- Activations, fixture nodes and policy changes below roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9830000-0000-4000-8000-0000000000a9','authenticated','authenticated','reset-a@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9830000-0000-4000-8000-0000000000a9','리셋A',false);

-- ---- schema / policy / privileges ----
select has_table('private','world_life_tree_resets','reset ledger exists');
select has_table('private','world_life_tree_reset_policy','reset policy exists');
select col_is_pk('private','world_player_life_nodes',array['user_id','node_id','epoch','rank'],
  'acquired ranks are keyed by epoch');
select is((select cooldown_seconds from private.world_life_tree_reset_policy where policy_id='life.tree_reset.v1'),
  86400,'default cooldown is 24 hours');
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot call %s',r,f))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['private.world_life_tree_reset_v1(uuid,text,text)',
       'private.world_life_tree_epoch_v1(uuid,text)',
       'private.world_life_tree_reset_state_v1(uuid,text)']) f;
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['private.world_life_tree_resets','private.world_life_tree_reset_policy']) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

-- ---- fixtures ----
update private.world_life_skill_catalog set status='ACTIVE' where skill_id in ('life.fishing','life.mining');
update private.world_life_skill_tree_catalog set status='ACTIVE' where skill_id='life.fishing';
insert into private.world_life_skill_tree_catalog(
  node_id,skill_id,status,sp_cost,max_rank,required_life_level,required_skill_level)
values ('life.node.mining.reset_fixture','life.mining','ACTIVE',1,1,1,1);
select is(private.world_life_skill_xp_apply_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing',1000,
  'activity','activity.fishing.inkyung:reset','reset:xp:fishing')->>'status','SUCCESS','fishing Lv5 (5 SP)');
select is(private.world_life_skill_xp_apply_v1('a9830000-0000-4000-8000-0000000000a9','life.mining',100,
  'activity','activity.mining.campus:reset','reset:xp:mining')->>'status','SUCCESS','mining Lv2 (1 SP)');

-- ---- nothing to refund ----
select throws_ok($$select private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.fishing','reset:empty')$$,'P0001','LIFE_TREE_RESET_EMPTY','an empty reset is refused');
select is((select count(*) from private.world_life_tree_resets),0::bigint,'an empty reset starts no cooldown');

-- ---- spend, then reset ----
select private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9','life.node.fishing.steady_hands','reset:u:' || g)
  from generate_series(1,3) g;
select is(private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.node.fishing.fish_sense','reset:u:sense')->>'spAfter','1','4 of 5 fishing SP spent');

select is(private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing','reset:1')
  - array['resetId','sp','reset'],
  jsonb_build_object('status','SUCCESS','skillId','life.fishing','epochBefore',0,'epoch',1,'refundedSp',4,'cost',0,
    'clearedRanks',jsonb_build_array(
      jsonb_build_object('nodeId','life.node.fishing.fish_sense','rank',1),
      jsonb_build_object('nodeId','life.node.fishing.steady_hands','rank',3))),
  'free reset refunds exactly the spent SP and records the cleared ranks');
select is(private.world_life_skill_sp_snapshot_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing')
  - array['skillId','curveId','nextLevelEarnedSp'],
  jsonb_build_object('skillLevel',5,'earnedSp',5,'spentSp',0,'availableSp',5),'all fishing SP is available again');
select is((select count(*) from jsonb_array_elements(private.world_life_skill_tree_snapshot_v1(
  'a9830000-0000-4000-8000-0000000000a9','life.fishing')->'nodes') n where (n->>'rank')::int > 0),0::bigint,
  'every fishing node is back to rank 0');
select results_eq($$
  select (select count(*) from private.world_life_sp_transactions where user_id='a9830000-0000-4000-8000-0000000000a9'),
         (select count(*) from private.world_player_life_nodes where user_id='a9830000-0000-4000-8000-0000000000a9')
$$,$$values (4::bigint,4::bigint)$$,'reset deletes nothing: old spends and ranks stay as epoch-0 history');
select ok((private.world_life_skill_tree_snapshot_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing')
  ->'reset'->>'nextResetAt') is not null,'tree snapshot reports when the next reset is allowed');

-- ---- the new epoch is a clean tree ----
select throws_ok($$select private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.node.fishing.fish_sense','reset:u:e1:sense')$$,
  'P0001','LIFE_NODE_PREREQUISITE_LOCKED','prerequisites read the current epoch only (old rank 3 no longer counts)');
select is(private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','reset:u:e1')->>'rankAfter','1','ranks restart at 1 in the new epoch');

-- ---- cooldown is per skill ----
select throws_ok($$select private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.fishing','reset:2:early')$$,'P0001','LIFE_TREE_RESET_COOLDOWN','one fishing reset per cooldown');
select is(private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.node.mining.reset_fixture','reset:u:mining')->>'status','SUCCESS','mining SP spent');
select is(private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9','life.mining','reset:mining')
  ->>'refundedSp','1','another skill is not blocked by the fishing cooldown');

-- ---- idempotency ----
select is(private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing','reset:1')
  ->>'status','ALREADY_PROCESSED','exact replay returns the committed reset, even inside the cooldown');
select throws_ok($$select private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.mining','reset:1')$$,'23505','IDEMPOTENCY_CONFLICT','a reset key cannot move to another skill');
select is(private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','reset:u:1')->>'epoch','0','an old unlock key still replays its epoch-0 rank');

-- ---- the cooldown is adjustable without a code change ----
update private.world_life_tree_reset_policy set cooldown_seconds=0, updated_at=now();
select is(private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing','reset:2')
  ->>'epoch','2','after ops shortens the cooldown, the next reset is allowed');
select is((select cooldown_seconds from private.world_life_tree_resets where idempotency_key='reset:2'),0,
  'each reset records the cooldown it was granted under');

-- ---- a disabled tree still refunds ----
select private.world_life_node_unlock_v1('a9830000-0000-4000-8000-0000000000a9','life.node.fishing.steady_hands','reset:u:e2');
update private.world_life_skill_tree_catalog set status='DISABLED' where skill_id='life.fishing';
update private.world_life_skill_catalog set status='DISABLED' where skill_id='life.fishing';
select is(private.world_life_tree_reset_v1('a9830000-0000-4000-8000-0000000000a9','life.fishing','reset:3')
  ->>'refundedSp','1','reset refunds even after the skill and its nodes are disabled');

-- ---- append-only ----
select throws_ok($$update private.world_life_tree_resets set refunded_sp=99$$,
  '42501','LIFE_TREE_RESET_APPEND_ONLY','resets are immutable');
select throws_ok($$delete from private.world_life_tree_resets$$,
  '42501','LIFE_TREE_RESET_APPEND_ONLY','a live account''s resets cannot be deleted');
select lives_ok($$delete from auth.users where id='a9830000-0000-4000-8000-0000000000a9'$$,
  'account deletion cascades through resets, spends and ranks');
select is((select count(*) from private.world_life_tree_resets),0::bigint,'resets left with the account');

select * from finish();
rollback;
