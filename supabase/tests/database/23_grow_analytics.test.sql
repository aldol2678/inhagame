begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is(public.log_induck_grow_analytics_v1(
  '91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  'landing',null,null,null,'everytime',null),true,'landing accepted');

select is(public.log_induck_grow_analytics_v1(
  '91000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',
  'play_start',null,null,null,'everytime',null),true,'play accepted');

select is(public.log_induck_grow_analytics_v1(
  '91000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001',
  'semester_start',1::smallint,'culture',null,'everytime',null),true,'semester start accepted');

select is(public.log_induck_grow_analytics_v1(
  '91000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001',
  'week_checkpoint',1::smallint,'culture',null,'everytime',null),true,'week 1 accepted');

select is(public.log_induck_grow_analytics_v1(
  '91000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000001',
  'week_checkpoint',8::smallint,'culture',null,'everytime',null),true,'week 8 accepted');

select is(public.log_induck_grow_analytics_v1(
  '91000000-0000-4000-8000-000000000006','92000000-0000-4000-8000-000000000001',
  'semester_result',15::smallint,'culture',3.75,'everytime',null),true,'result accepted');

select is(public.log_induck_grow_analytics_v1(
  gen_random_uuid(),'92000000-0000-4000-8000-000000000002',
  'week_checkpoint',16::smallint,'culture',null,'direct',null),false,'week 16 rejected');

select is(public.log_induck_grow_analytics_v1(
  gen_random_uuid(),'92000000-0000-4000-8000-000000000002',
  'semester_result',15::smallint,'culture',5.00,'direct',null),false,'GPA over 4.5 rejected');

select results_eq(
  $$select count(*)::bigint from public.induck_grow_analytics_events where session_id='92000000-0000-4000-8000-000000000001'$$,
  $$values (6::bigint)$$,'six valid rows stored');

select results_eq(
  $$select (public.get_induck_grow_ops_v1()->'funnel'->>'semester_starts')::bigint$$,
  $$values (1::bigint)$$,'OPS sees semester start');

select results_eq(
  $$select (public.get_induck_grow_ops_v1()->'funnel'->>'week_8')::bigint$$,
  $$values (1::bigint)$$,'OPS sees week 8 reach');

select results_eq(
  $$select public.get_induck_grow_ops_v1()->'results'->>'avg_gpa'$$,
  $$values ('3.75'::text)$$,'OPS reports GPA');

select * from finish();
rollback;
