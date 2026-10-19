begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,is_anonymous) values
 ('11111111-1111-4111-8111-111111111111',false),
 ('22222222-2222-4222-8222-222222222222',false),
 ('33333333-3333-4333-8333-333333333333',true) on conflict(id) do nothing;
create function pg_temp.learning_fixture() returns jsonb language sql as $$
 select '{"version":1,"completed":{"e01":true},"masteries":{"qv:test.synthetic@1":{"level":1,"errors":1,"streak":0,"intervalDays":1,"correctDays":0,"lastCorrectDay":null,"dueDate":"2026-10-19","needsRecheck":false}},"wrong":{"qv:test.synthetic@1":true},"skillScores":[40,40,40],"languageSkills":{"zh":40,"ja":40},"learningHistory":{"2026-10-19":{"answered":1,"correct":0}},"bosses":{},"languageBosses":{},"speech":{}}'::jsonb;
$$;
select ok((select relrowsecurity from pg_class where oid='public.world_learning_progress'::regclass),'progress RLS enabled');
select ok((select relrowsecurity from pg_class where oid='private.world_learning_requests'::regclass),'receipts RLS enabled');
select ok(not has_table_privilege('authenticated','public.world_learning_progress','UPDATE'),'direct owner update denied: cannot bypass CAS');
select ok(not has_table_privilege('anon','public.world_learning_progress','SELECT'),'anon select denied');
select ok(not has_function_privilege('anon','public.world_learning_save_v1(uuid,bigint,jsonb)','EXECUTE'),'anon RPC denied');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select is(public.world_learning_read_v1()->>'revision','0','A has no initial record');
select is(public.world_learning_save_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,pg_temp.learning_fixture())->>'revision','1','A creates revision 1');
select is(public.world_learning_save_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,pg_temp.learning_fixture())->>'duplicate','true','same request idempotent');
select is(public.world_learning_read_v1()->'progress',pg_temp.learning_fixture(),'separate readback matches exact progress');
select throws_ok($$select public.world_learning_save_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,jsonb_set(pg_temp.learning_fixture(),'{completed}','{}'))$$,'22023','request identity reused','request payload cannot be changed');
select throws_ok($$select public.world_learning_save_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',0,pg_temp.learning_fixture())$$,'PT409','revision conflict','stale revision rejected');
select throws_ok($$select public.world_learning_save_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,pg_temp.learning_fixture() || '{"answer":"forbidden"}')$$,'22023','invalid progress','raw answer field rejected');
select throws_ok($$select public.world_learning_save_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,jsonb_set(pg_temp.learning_fixture(),'{version}','2'))$$,'22023','invalid progress','future schema rejected');
select throws_ok($$select public.world_learning_save_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,jsonb_set(pg_temp.learning_fixture(),'{skillScores}','[999,40,40]'))$$,'22023','invalid progress','invalid skill rejected');
select throws_ok($$select public.world_learning_save_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,jsonb_set(pg_temp.learning_fixture(),'{masteries,qv:test.synthetic@1,answer}','"secret"'))$$,'22023','invalid progress','nested content rejected');
select throws_ok($$select public.world_learning_save_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,pg_temp.learning_fixture() || '{"coins":99,"campusXp":99,"rank":100}')$$,'22023','invalid progress','economy and league fields rejected');
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
select is((select count(*) from public.world_learning_progress where user_id='11111111-1111-4111-8111-111111111111'),0::bigint,'B direct query sees zero A records');
select throws_ok($$update public.world_learning_progress set revision=99 where user_id='11111111-1111-4111-8111-111111111111'$$,'42501',null,'B direct modification denied');
select throws_ok($$insert into public.world_learning_progress values('11111111-1111-4111-8111-111111111111',99,pg_temp.learning_fixture(),now())$$,'42501',null,'B forged owner insert denied');
select throws_ok($$delete from public.world_learning_progress where user_id='11111111-1111-4111-8111-111111111111'$$,'42501',null,'B deletion denied');
select throws_ok($$select * from private.world_learning_requests$$,'42501',null,'receipts not exposed');
select is(public.world_learning_read_v1()->>'revision','0','B RPC does not read A');
select is(public.world_learning_save_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,pg_temp.learning_fixture())->>'owner','22222222-2222-4222-8222-222222222222','same request ID across accounts is separate');
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.world_learning_read_v1()$$,'42501','permanent account required','anonymous auth cannot read');
select throws_ok($$select public.world_learning_save_v1('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,pg_temp.learning_fixture())$$,'42501','permanent account required','anonymous auth cannot write');
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false,"user_metadata":{"is_anonymous":false}}',true);
select throws_ok($$select public.world_learning_save_v1('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,pg_temp.learning_fixture())$$,'42501','permanent account required','Auth user record verifies permanence even with forged claims in SQL test');
select set_config('request.jwt.claims','{"role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.world_learning_read_v1()$$,'42501','permanent account required','missing uid denied');
reset role;
select is((select revision from public.world_learning_progress where user_id='11111111-1111-4111-8111-111111111111'),1::bigint,'all attacks left A unchanged');
select is((select count(*) from private.world_learning_requests where user_id='11111111-1111-4111-8111-111111111111'),1::bigint,'one committed receipt despite repeat');
select * from finish();
rollback;
