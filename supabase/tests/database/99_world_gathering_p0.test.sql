-- INHA WORLD Gathering P0 closed authority contract.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_table('private','world_gathering_runtime','Gathering runtime exists');
select has_table('private','world_gathering_source_catalog','Gathering source catalog exists');
select has_table('private','world_gathering_attempt_snapshots','Gathering frozen attempts exist');

select is((select enabled from private.world_gathering_runtime),false,'Gathering runtime is closed by default');
select is((select policy from private.world_gathering_runtime),null::jsonb,'closed runtime has no balance policy');
select is((select minimum_harvest_interval_ms from private.world_gathering_runtime),null::bigint,'closed runtime has no cooldown');
select is((select count(*) from private.world_gathering_source_catalog),1::bigint,'one semantic Gathering source is published');
select results_eq($$
  select source_ref,activity_id,item_id,collection_entry_id,skill_id,quantity,status,definition_version
    from private.world_gathering_source_catalog
$$,$$values (
  'gathering.campus.leaf_pile_01'::text,
  'activity.gathering.campus'::text,
  'material.campus_leaf'::text,
  'collection.plant.campus_leaf'::text,
  'life.gathering'::text,
  1,
  'COMING_SOON'::text,
  1
)$$,'DB source mirror matches Gathering P0 semantics');

select is((select status from private.world_life_skill_catalog where skill_id='life.gathering'),'COMING_SOON',
  'Gathering Life Skill stays closed');
select is((select status from private.world_collection_entry_catalog where entry_id='collection.plant.campus_leaf'),'COMING_SOON',
  'leaf Collection entry stays closed');
select is((select count(*) from private.world_gathering_attempt_snapshots),0::bigint,
  'migration creates no player Gathering state');

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_gathering_runtime'::regclass,
  'private.world_gathering_source_catalog'::regclass,
  'private.world_gathering_attempt_snapshots'::regclass
)),'Gathering tables all have RLS');

select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
  unnest(array[
    'private.world_gathering_runtime',
    'private.world_gathering_source_catalog',
    'private.world_gathering_attempt_snapshots'
  ]) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

select ok(not has_function_privilege(r,'public.world_gathering_harvest_v1(uuid,text,uuid)','execute'),
  format('%s cannot call Gathering harvest',r))
from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role','public.world_gathering_harvest_v1(uuid,text,uuid)','execute'),
  'trusted server can call Gathering harvest');
select ok(not has_function_privilege(r,'private.world_gathering_policy_validate_v1(jsonb)','execute'),
  format('%s cannot call Gathering policy validator',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,'private.world_gathering_snapshot_guard_v1()','execute'),
  format('%s cannot call Gathering snapshot guard',r))
from unnest(array['anon','authenticated','service_role']) r;

select throws_ok($$select public.world_gathering_harvest_v1(
  gen_random_uuid(),'gathering.campus.leaf_pile_01',gen_random_uuid())$$,
  '42501','SERVER_ONLY','SQL EXECUTE alone cannot bypass the trusted-server claim');

select lives_ok($$select private.world_gathering_policy_validate_v1(
  '{"policyVersion":"gathering.fixture.v1","lifeXp":10}'::jsonb)$$,
  'valid Gathering policy passes');
select throws_ok($$select private.world_gathering_policy_validate_v1(
  '{"policyVersion":"gathering.fixture.v1","lifeXp":0}'::jsonb)$$,
  '22023','GATHERING_POLICY_INVALID','zero XP policy is refused');
select throws_ok($$select private.world_gathering_policy_validate_v1(
  '{"policyVersion":"gathering.fixture.v1","lifeXp":10,"quantity":1}'::jsonb)$$,
  '22023','GATHERING_POLICY_INVALID','client/output shape cannot enter runtime policy');

select * from finish();
rollback;
