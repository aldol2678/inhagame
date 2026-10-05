-- Fishing Life Skill Effects P1. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9950000-0000-4000-8000-0000000000a9','authenticated','authenticated','fishing-effects@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9950000-0000-4000-8000-0000000000a9','낚시효과',false);

select results_eq($$
  select node_id from private.world_life_skill_tree_catalog
   where skill_id='life.fishing' and status='ACTIVE' order by node_id
$$,$$values
  ('life.node.fishing.fish_sense'::text),
  ('life.node.fishing.steady_hands'::text)
$$,'only real Fishing timing effects are ACTIVE');

select is(
  private.world_life_skill_xp_apply_v1(
    'a9950000-0000-4000-8000-0000000000a9',
    'life.fishing',1500,'activity','activity.fishing.inkyung:effects','fishing-effects:xp'
  )->>'status',
  'SUCCESS',
  'fixture reaches Fishing Lv6 with 6 SP'
);

select is(private.world_life_node_unlock_v1(
  'a9950000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','fishing-effects:steady:1')->>'status','SUCCESS','steady hands rank 1');
select is(private.world_life_node_unlock_v1(
  'a9950000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','fishing-effects:steady:2')->>'status','SUCCESS','steady hands rank 2');
select is(private.world_life_node_unlock_v1(
  'a9950000-0000-4000-8000-0000000000a9',
  'life.node.fishing.steady_hands','fishing-effects:steady:3')->>'status','SUCCESS','steady hands rank 3');
select is(private.world_life_node_unlock_v1(
  'a9950000-0000-4000-8000-0000000000a9',
  'life.node.fishing.fish_sense','fishing-effects:sense:1')->>'status','SUCCESS','fish sense rank 1');
select is(private.world_life_node_unlock_v1(
  'a9950000-0000-4000-8000-0000000000a9',
  'life.node.fishing.fish_sense','fishing-effects:sense:2')->>'status','SUCCESS','fish sense rank 2');
select is(private.world_life_node_unlock_v1(
  'a9950000-0000-4000-8000-0000000000a9',
  'life.node.fishing.fish_sense','fishing-effects:sense:3')->>'status','SUCCESS','fish sense rank 3');

select is(
  private.world_fishing_skill_effects_v1('a9950000-0000-4000-8000-0000000000a9'),
  jsonb_build_object(
    'version','fishing.skill_effects.v1',
    'steadyHandsRank',3,
    'fishSenseRank',3,
    'responseWindowBonusMs',750,
    'waitReductionMs',750
  ),
  'current tree epoch produces bounded Fishing effects'
);

select is(
  private.world_fishing_apply_skill_effects_v1(
    jsonb_build_object(
      'policyVersion','fishing.candidate.v1',
      'minWaitMs',3000,
      'maxWaitMs',9000,
      'responseWindowMs',1500,
      'attemptTtlMs',30000,
      'lifeXp',20
    ),
    private.world_fishing_skill_effects_v1('a9950000-0000-4000-8000-0000000000a9')
  ),
  jsonb_build_object(
    'policyVersion','fishing.candidate.v1',
    'minWaitMs',2250,
    'maxWaitMs',8250,
    'responseWindowMs',2250,
    'attemptTtlMs',30000,
    'lifeXp',20
  ),
  'rank 3 effects alter only wait and response timing'
);

select throws_ok($$
  select private.world_fishing_apply_skill_effects_v1(
    jsonb_build_object(
      'policyVersion','fishing.candidate.v1',
      'minWaitMs',3000,'maxWaitMs',9000,'responseWindowMs',1500,'attemptTtlMs',30000,'lifeXp',20
    ),
    jsonb_build_object(
      'version','fishing.skill_effects.v1',
      'steadyHandsRank',3,'fishSenseRank',3,'responseWindowBonusMs',751,'waitReductionMs',750
    )
  )
$$,'22023','FISHING_SKILL_EFFECT_INVALID','forged effect numbers are refused');

select ok(
  not (private.world_fishing_project_v1(jsonb_build_object(
    'attemptId',gen_random_uuid(),
    'policy',jsonb_build_object('policyVersion','fixture'),
    'skillEffects',private.world_fishing_skill_effects_v1('a9950000-0000-4000-8000-0000000000a9')
  )) ? 'skillEffects'),
  'server-private effect snapshot is not projected to the browser'
);

select is(
  private.world_life_tree_reset_v1(
    'a9950000-0000-4000-8000-0000000000a9',
    'life.fishing','fishing-effects:reset'
  )->>'status',
  'SUCCESS',
  'Fishing tree reset opens a new epoch'
);

select is(
  private.world_fishing_skill_effects_v1('a9950000-0000-4000-8000-0000000000a9'),
  jsonb_build_object(
    'version','fishing.skill_effects.v1',
    'steadyHandsRank',0,
    'fishSenseRank',0,
    'responseWindowBonusMs',0,
    'waitReductionMs',0
  ),
  'respec immediately removes effects for the next cast'
);

select * from finish();
rollback;
