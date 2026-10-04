begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select is((select presence_required from private.world_fishing_runtime),true,
  'authoritative position is required by default');
select is((select count(*) from private.world_fishing_spots),2::bigint,'two shore spots have server geometry');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_fishing_spots'::regclass,'private.world_fishing_positions'::regclass,
  'private.world_fishing_spot_leases'::regclass)),'F3 tables all have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.world_fishing_spots','private.world_fishing_positions','private.world_fishing_spot_leases']) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,
  'public.world_fishing_observe_position_v1(uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamptz)',
  'execute'),format('%s cannot publish positions',r)) from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role',
  'public.world_fishing_observe_position_v1(uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamptz)',
  'execute'),'only the trusted server can publish positions');
select ok(not has_function_privilege(r,'private.world_fishing_require_position_v1(uuid,text)','execute'),
  format('%s cannot call the internal position gate',r)) from unnest(array['anon','authenticated','service_role']) r;
select throws_ok($$select public.world_fishing_observe_position_v1(
  gen_random_uuid(),gen_random_uuid(),1,0,0,0,'CAMPUS','ON_FOOT',clock_timestamp())$$,
  '42501','SERVER_ONLY','SQL EXECUTE alone cannot bypass service claim guard');
select * from finish();
rollback;
