begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is(public.log_induck_grow_analytics_v1(
  'a3000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'landing',null::smallint,null::text,null::numeric,'everytime',null::text
),true,'decision test landing accepted');

select is(public.log_induck_grow_decision_v1(
  'a3000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000001'::uuid,
  1::smallint,'culture','orientation','ot','academic','everytime',null::text
),true,'orientation decision accepted');

select is(public.log_induck_grow_decision_v1(
  gen_random_uuid(),
  'a4000000-0000-4000-8000-000000000001'::uuid,
  1::smallint,'culture','not_allowed','ot','academic','everytime',null::text
),false,'unknown decision category rejected');

select is(public.log_induck_grow_decision_v1(
  gen_random_uuid(),
  'a4000000-0000-4000-8000-000000000099'::uuid,
  1::smallint,'culture','orientation','ot','academic','direct',null::text
),false,'decision without landing rejected');

select is(public.log_induck_grow_session_end_v1(
  'a3000000-0000-4000-8000-000000000003'::uuid,
  'a4000000-0000-4000-8000-000000000001'::uuid,
  15::smallint,'screen-final',1500,true,'completed','culture',4.00::numeric,'everytime',null::text
),true,'decision session completion accepted');

select is((select count(*)::bigint from public.induck_grow_decision_events
  where session_id='a4000000-0000-4000-8000-000000000001'::uuid),1::bigint,'one decision stored');

select is(public.get_induck_grow_ops_v1()->'p2b'->>'decision_events','1'::text,'OPS counts decision events');
select is(public.get_induck_grow_ops_v1()->'p2b'->'categories'->0->>'category','orientation'::text,'OPS groups decision category');
select is(public.get_induck_grow_ops_v1()->'p2b'->'choices'->0->>'choice_id','academic'::text,'OPS groups choice');
select is(public.get_induck_grow_ops_v1()->'p2b'->'choices'->0->>'completion_rate_pct','100.0'::text,'OPS reports ended-session completion rate');
select is(public.get_induck_grow_ops_v1()->'p2b'->'choices'->0->>'avg_final_gpa','4.00'::text,'OPS reports completed GPA');

select * from finish();
rollback;
