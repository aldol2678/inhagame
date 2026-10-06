begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select has_table('private','world_fishing_runtime','server-only runtime exists');
select has_table('private','world_fishing_attempt_snapshots','immutable fishing snapshots exist');
select hasnt_table('private','world_fishing_settlements','fishing has no per-activity settlement table');
select has_table('private','world_activity_settlements','fishing settles through the shared Activity path');
select is((select bridge.activity_id from private.world_life_creature_bridge_catalog bridge
  where bridge.life_skill_id='life.fishing'),'activity.fishing.inkyung',
  'fishing activity is the mapped Life -> Creature bridge activity');
-- 20261004161000_world_fishing_first_life_skill activates Fishing with a CANDIDATE policy.
select is((select enabled from private.world_fishing_runtime),true,'runtime is enabled');
select is((select policy from private.world_fishing_runtime),
  '{"policyVersion":"fishing.candidate.v1","minWaitMs":3000,"maxWaitMs":9000,"responseWindowMs":1500,"attemptTtlMs":30000,"lifeXp":20}'::jsonb,
  'the candidate policy is explicit');
select is((select minimum_start_interval_ms from private.world_fishing_runtime),2000::bigint,
  'the candidate start interval is explicit');
select lives_ok($$select private.world_fishing_policy_validate_v1((select policy from private.world_fishing_runtime))$$,
  'the candidate policy passes the validator');
select is((select status from private.world_life_skill_catalog where skill_id='life.fishing'),'ACTIVE',
  'fishing skill is active');
select is((select status from private.world_collection_entry_catalog where entry_id='collection.fish.carp'),'ACTIVE',
  'carp discovery is active');
select is((select count(*) from private.world_life_skill_tree_catalog where status='ACTIVE'),2::bigint,
  'only the two implemented Fishing timing nodes are active');
select is((select status from private.world_creature_activity_bridge_catalog where bridge_id='creature.bridge.activity.fishing'),'COMING_SOON',
  'the fishing Creature bridge stays inactive');
select is((select count(*) from private.world_life_skill_catalog where status <> 'COMING_SOON'),1::bigint,
  'Fishing is the only active Life Skill');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_fishing_runtime'::regclass,'private.world_fishing_attempt_snapshots'::regclass)),
  'all fishing tables have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.world_fishing_runtime','private.world_fishing_attempt_snapshots']) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot call %s',r,f))
from unnest(array['anon','authenticated']) r,
  unnest(array['public.world_fishing_start_v1(uuid,text,uuid)',
    'public.world_fishing_input_v1(uuid,uuid,text,uuid,text)',
    'public.world_fishing_settle_v1(uuid,uuid)','public.world_fishing_read_v1(uuid,uuid)']) f;
select ok(has_function_privilege('service_role',f,'execute'),format('server may call %s',f))
from unnest(array['public.world_fishing_start_v1(uuid,text,uuid)',
    'public.world_fishing_input_v1(uuid,uuid,text,uuid,text)',
    'public.world_fishing_settle_v1(uuid,uuid)','public.world_fishing_read_v1(uuid,uuid)']) f;
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot call internal %s',r,f))
from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.world_fishing_finish_v1(jsonb,text,text,text,bigint)',
    'private.world_fishing_commit_v1(uuid,uuid,jsonb)',
    'private.world_fishing_policy_validate_v1(jsonb)',
    'private.world_fishing_resolve_v1(jsonb,text,bigint)']) f;
select throws_ok($$select private.world_fishing_policy_validate_v1(null)$$,
  '22023','FISHING_POLICY_INVALID','missing policy refused');
select throws_ok($$select private.world_fishing_policy_validate_v1(
  '{"policyVersion":"test.f2","minWaitMs":1,"maxWaitMs":1,"responseWindowMs":10,"attemptTtlMs":11,"lifeXp":1}')$$,
  '22023','FISHING_POLICY_INVALID','TTL must exceed final response window');
select throws_ok($$select private.world_fishing_policy_validate_v1(
  '{"policyVersion":"test.f2","minWaitMs":1,"maxWaitMs":1,"responseWindowMs":10,"attemptTtlMs":12,"lifeXp":-1}')$$,
  '22023','FISHING_POLICY_INVALID','negative XP refused');
select throws_ok($$select private.world_fishing_policy_validate_v1(
  '{"policyVersion":"test.f2","minWaitMs":1,"maxWaitMs":1,"responseWindowMs":10,"attemptTtlMs":12,"lifeXp":1000001}')$$,
  '22023','FISHING_POLICY_INVALID','XP above the settlement plan cap refused');
select throws_ok($$select public.world_fishing_read_v1(gen_random_uuid(),null)$$,
  '42501','SERVER_ONLY','execute alone cannot bypass service claim guard');
select * from finish();
rollback;
