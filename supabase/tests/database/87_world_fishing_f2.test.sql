begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select has_table('private','world_fishing_runtime','server-only runtime exists');
select has_table('private','world_fishing_attempt_snapshots','immutable fishing snapshots exist');
select has_table('private','world_fishing_settlements','one receipt per attempt exists');
select col_is_pk('private','world_fishing_settlements',array['attempt_id'],'attempt settlement primary key');
select col_is_unique('private','world_fishing_settlements',array['result_ref'],'result cannot settle twice');
select is((select enabled from private.world_fishing_runtime),false,'runtime defaults disabled');
select ok((select policy is null and minimum_start_interval_ms is null from private.world_fishing_runtime),
  'no balance or cooldown default is silently activated');
select is((select status from private.world_life_skill_catalog where skill_id='life.fishing'),'COMING_SOON',
  'fishing skill remains coming soon');
select is((select status from private.world_collection_entry_catalog where entry_id='collection.fish.carp'),'COMING_SOON',
  'carp discovery remains coming soon');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_fishing_runtime'::regclass,'private.world_fishing_attempt_snapshots'::regclass,
  'private.world_fishing_settlements'::regclass)), 'all fishing tables have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.world_fishing_runtime','private.world_fishing_attempt_snapshots','private.world_fishing_settlements']) t,
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
select throws_ok($$select public.world_fishing_read_v1(gen_random_uuid(),null)$$,
  '42501','SERVER_ONLY','execute alone cannot bypass service claim guard');
select * from finish();
rollback;
