begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is(public.log_induck_grow_analytics_v1(
  '97000000-0000-4000-8000-000000000001'::uuid,
  '98000000-0000-4000-8000-000000000001'::uuid,
  'landing',null::smallint,null::text,null::numeric,'everytime',null::text
),true,'P2A test landing accepted');

select is(public.log_induck_grow_analytics_v1(
  '97000000-0000-4000-8000-000000000002'::uuid,
  '98000000-0000-4000-8000-000000000001'::uuid,
  'semester_start',1::smallint,'culture',null::numeric,'everytime',null::text
),true,'P2A test semester start accepted');

select is(public.log_induck_grow_resource_checkpoint_v1(
  '97000000-0000-4000-8000-000000000003'::uuid,
  '98000000-0000-4000-8000-000000000001'::uuid,
  4::smallint,'culture',61::smallint,47::smallint,32500,6::smallint,'everytime',null::text
),true,'week 4 resource checkpoint accepted');

select is(public.log_induck_grow_resource_checkpoint_v1(
  gen_random_uuid(),
  '98000000-0000-4000-8000-000000000001'::uuid,
  5::smallint,'culture',61::smallint,47::smallint,32500,6::smallint,'everytime',null::text
),false,'non-milestone resource checkpoint rejected');

select is(public.log_induck_grow_resource_checkpoint_v1(
  gen_random_uuid(),
  '98000000-0000-4000-8000-000000000099'::uuid,
  4::smallint,'culture',61::smallint,47::smallint,32500,6::smallint,'direct',null::text
),false,'resource checkpoint without semester start rejected');

select is(public.log_induck_grow_session_end_v1(
  '97000000-0000-4000-8000-000000000004'::uuid,
  '98000000-0000-4000-8000-000000000001'::uuid,
  4::smallint,'screen-recap',420,false,'pagehide','culture',null::numeric,'everytime',null::text
),true,'pagehide session end accepted');

select is((select completed from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),false,'initial session end is incomplete');
select is((select end_reason from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),'pagehide'::text,'initial session end reason is pagehide');
select is((select last_week from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),4::smallint,'initial session end records week 4');
select is((select duration_sec from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),420,'initial session duration stored');

select is(public.log_induck_grow_session_end_v1(
  '97000000-0000-4000-8000-000000000005'::uuid,
  '98000000-0000-4000-8000-000000000001'::uuid,
  15::smallint,'screen-final',1800,true,'completed','culture',3.75::numeric,'everytime',null::text
),true,'completion upgrades prior exit');

select is((select completed from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),true,'completion is canonical');
select is((select end_reason from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),'completed'::text,'completion reason is canonical');
select is((select last_week from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),15::smallint,'completion advances last week');
select is((select final_gpa from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),3.75::numeric,'completion stores final GPA');

select is(public.log_induck_grow_session_end_v1(
  gen_random_uuid(),
  '98000000-0000-4000-8000-000000000001'::uuid,
  15::smallint,'screen-final',1900,false,'pagehide','culture',null::numeric,'everytime',null::text
),true,'later pagehide remains idempotently accepted');

select is((select completed from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),true,'completed outcome cannot be downgraded');
select is((select end_reason from public.induck_grow_session_ends
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),'completed'::text,'completed reason cannot be downgraded');

select is(public.log_induck_grow_session_end_v1(
  gen_random_uuid(),
  '98000000-0000-4000-8000-000000000099'::uuid,
  4::smallint,'screen-recap',120,false,'pagehide','culture',null::numeric,'direct',null::text
),false,'session end without landing rejected');

select is((select count(*)::bigint from public.induck_grow_resource_checkpoints
  where session_id='98000000-0000-4000-8000-000000000001'::uuid),1::bigint,'one resource milestone stored');

select is(public.get_induck_grow_ops_v1()->'p2a'->'session_ends'->>'completed','1'::text,'OPS counts completed session');
select is(public.get_induck_grow_ops_v1()->'p2a'->'resources'->0->>'avg_stress','47.0'::text,'OPS exposes resource stress');
select is(public.get_induck_grow_ops_v1()->'p2a'->'outcome_resources'->0->>'outcome','completed'::text,'OPS joins resources to final outcome');

select * from finish();
rollback;
