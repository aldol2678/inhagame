begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,is_anonymous) values ('44444444-4444-4444-8444-444444444444',false);
create function pg_temp.learning_fixture() returns jsonb language sql as $$
 select '{"version":1,"completed":{},"masteries":{},"wrong":{},"skillScores":[40,40,40],"languageSkills":{"zh":40,"ja":40},"learningHistory":{},"bosses":{},"languageBosses":{},"speech":{}}'::jsonb;
$$;
select ok(not private.learning_validate_progress(jsonb_set(pg_temp.learning_fixture(),'{version}','"1"')),'JSON string version rejected');
select ok(private.learning_validate_progress(jsonb_set(pg_temp.learning_fixture(),'{version}','1.0')),'JSON numeric 1.0 equals version 1');
select ok(not private.learning_validate_progress(jsonb_set(pg_temp.learning_fixture(),'{learningHistory}','{"2025-02-29":{"answered":1,"correct":1}}')),'invalid calendar key rejected');
select ok(private.learning_validate_progress(jsonb_set(pg_temp.learning_fixture(),'{learningHistory}','{"2024-02-29":{"answered":1,"correct":1}}')),'leap day accepted');
select ok(not private.learning_valid_day('1900-02-29'),'century leap exception');
select ok(private.learning_valid_day('2000-02-29'),'400-year leap rule');
select ok(not private.learning_valid_day('0000-01-01'),'year zero rejected');
select ok(private.learning_progress_weight(('1.'||repeat('0',1000))::jsonb)>=1002,'alternate numeric spelling is charged at actual serialized size');
select ok(not private.learning_validate_progress(jsonb_set(pg_temp.learning_fixture(),'{masteries}',
 (select jsonb_object_agg('qv:test.numeric.'||i||'@1',jsonb_build_object('level',1,'errors',('0.'||repeat('0',10000))::jsonb,'streak',0,'intervalDays',1,'correctDays',0,'lastCorrectDay',null,'dueDate',null,'needsRecheck',false)) from generate_series(1,35) i))),
 'long numeric spellings cannot bypass per-request payload ceiling');
select ok(not has_function_privilege('authenticated','private.learning_progress_weight(jsonb)','EXECUTE'),'new helper has no authenticated execute');
select ok(not has_function_privilege('anon','private.learning_valid_day(text)','EXECUTE'),'new calendar helper has no anon execute');
select is((select pg_get_userbyid(proowner) from pg_proc where oid='public.world_learning_save_v1(uuid,bigint,jsonb)'::regprocedure),'postgres','save wrapper owner remains migration postgres');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.world_learning_save_v1(uuid,bigint,jsonb)'::regprocedure),'definer pins empty search_path');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$insert into public.world_learning_progress(user_id,revision,progress) values(auth.uid(),1,pg_temp.learning_fixture())$$,'42501',null,'owner cannot bypass RPC with direct SQL');
select throws_ok($$select private.learning_save(gen_random_uuid(),0,pg_temp.learning_fixture())$$,'42501',null,'private RPC helper not callable');
select is(public.world_learning_save_v1('aaaaaaaa-4444-4444-8444-444444444444',0,pg_temp.learning_fixture())->>'revision','1','first request accepted');
select lives_ok($$do $b$ begin for i in 1..11 loop perform public.world_learning_save_v1(gen_random_uuid(),i,pg_temp.learning_fixture()); end loop; end $b$;$$,'12 requests in rolling minute accepted');
select throws_ok($$select public.world_learning_save_v1(gen_random_uuid(),12,pg_temp.learning_fixture())$$,'PT429','learning request rate exceeded','13th request throttled');
select is(public.world_learning_read_v1()->>'revision','12','throttle did not mutate progress');
select is(public.world_learning_save_v1('aaaaaaaa-4444-4444-8444-444444444444',0,pg_temp.learning_fixture())->>'duplicate','true','same UUID succeeds even while throttled');
select throws_ok($$select public.world_learning_save_v1('aaaaaaaa-4444-4444-8444-444444444444',0,pg_temp.learning_fixture() || '{"completed":{"e01":true}}')$$,'22023','request identity reused','same UUID different payload rejected before quotas');
reset role;
select is((select count(*) from private.world_learning_requests where user_id='44444444-4444-4444-8444-444444444444'),12::bigint,'retries and throttle do not add receipts');
update private.world_learning_requests set created_at=statement_timestamp()-interval '1 hour' where user_id='44444444-4444-4444-8444-444444444444';
insert into private.world_learning_requests(user_id,request_id,expected_revision,committed_revision,progress,created_at)
 select '44444444-4444-4444-8444-444444444444',gen_random_uuid(),0,1,pg_temp.learning_fixture(),statement_timestamp()-interval '1 hour' from generate_series(1,228);
set local role authenticated;
select throws_ok($$select public.world_learning_save_v1(gen_random_uuid(),12,pg_temp.learning_fixture())$$,'PT429','learning request rate exceeded','rolling 24-hour cap enforced');
reset role;
update private.world_learning_requests set created_at=statement_timestamp()-interval '365 days' where user_id='44444444-4444-4444-8444-444444444444';
set local role authenticated;
select is(public.world_learning_save_v1('aaaaaaaa-4444-4444-8444-444444444444',0,pg_temp.learning_fixture())->>'duplicate','true','year-old UUID still replays original acknowledgement');
select is(public.world_learning_save_v1(gen_random_uuid(),12,pg_temp.learning_fixture())->>'revision','13','new request succeeds when rolling window expires');
reset role;
insert into private.world_learning_requests(user_id,request_id,expected_revision,committed_revision,progress,created_at)
 select '44444444-4444-4444-8444-444444444444',gen_random_uuid(),0,1,pg_temp.learning_fixture(),statement_timestamp()-interval '365 days' from generate_series(1,1807);
set local role authenticated;
select throws_ok($$select public.world_learning_save_v1(gen_random_uuid(),13,pg_temp.learning_fixture())$$,'PT413','learning retention capacity reached','2048 lifetime receipts limit enforced even after one year');
select is(public.world_learning_save_v1('aaaaaaaa-4444-4444-8444-444444444444',0,pg_temp.learning_fixture())->>'revision','1','lifetime cap cannot break old idempotency');
reset role;
-- Synthetic local fixtures exercise the cumulative byte cap separately from row count.
delete from private.world_learning_requests where user_id='44444444-4444-4444-8444-444444444444';
create function pg_temp.large_progress() returns jsonb language sql as $$
 select jsonb_set(pg_temp.learning_fixture(),'{masteries}',
 (select jsonb_object_agg('qv:test.synthetic.'||i||'@1','{"level":1,"errors":0,"streak":1,"intervalDays":1,"correctDays":1,"lastCorrectDay":null,"dueDate":null,"needsRecheck":false}'::jsonb) from generate_series(1,200) i));
$$;
select ok(private.learning_validate_progress(pg_temp.large_progress()),'large realistic synthetic progress satisfies request bound');
insert into private.world_learning_requests(user_id,request_id,expected_revision,committed_revision,progress,created_at)
 select '44444444-4444-4444-8444-444444444444',gen_random_uuid(),0,1,pg_temp.large_progress(),statement_timestamp()-interval '365 days'
 from generate_series(1,(16777216/private.learning_progress_weight(pg_temp.large_progress()))::int);
set local role authenticated;
select throws_ok($$select public.world_learning_save_v1(gen_random_uuid(),13,pg_temp.large_progress())$$,'PT413','learning retention capacity reached','16 MiB retained payload-weight ceiling enforced');
select is(public.world_learning_read_v1()->>'revision','13','byte capacity refusal preserves latest progress');
reset role;
select * from finish();
rollback;
