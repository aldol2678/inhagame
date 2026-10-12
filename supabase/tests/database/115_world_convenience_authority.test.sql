-- Disposable fixture only. No claim of real browser movement; actual HTTP/reducer integration is separate.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select ok(not (select enabled from private.world_convenience_runtime),'convenience runtime defaults CLOSED');
select ok(private.world_convenience_state_ok_v1(jsonb_build_object('version','durable-campus-walk-v1','revision',1,'sequence',0,'lastCommand',null,'intentReceivedAt',null,'simulatedAt',1,'observedAt',1,'position',jsonb_build_object('x',0,'y',1.15,'z',-98),'geometryRevision',repeat('a',64)),repeat('a',64)),'exact nine-field reducer initial state accepted');
select ok(private.world_convenience_state_ok_v1('{}'::jsonb,repeat('a',64)) is distinct from true,'missing typed state cannot pass via SQL NULL');
select is((select giver_id from private.world_income_definitions where kind='SHIFT'),'BACKGATE-NPC-001','versioned fictional employer mapping');
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f)
from unnest(array['anon','authenticated']) r,unnest(array[
 'public.world_convenience_authority_v1(uuid,uuid,uuid,text,uuid,bigint,bigint,jsonb,text,boolean)',
 'public.world_convenience_income_v2(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid,text,text,integer)',
 'private.world_income_core_v1(uuid,text,uuid,uuid,text,text,text,text,integer)']) f;
select ok(not has_table_privilege(r,t,p),r||' cannot '||p||' '||t)
from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.world_convenience_runtime','private.world_convenience_authority','private.world_convenience_bindings']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1150000-0000-4000-8000-000000000001','authenticated','authenticated','convenience-a@example.test',now(),false),
 ('a1150000-0000-4000-8000-000000000002','authenticated','authenticated','convenience-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a1150000-0000-4000-8000-000000000001','편의점A',false),('a1150000-0000-4000-8000-000000000002','편의점B',false);
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b1150000-0000-4000-8000-000000000001','a1150000-0000-4000-8000-000000000001',now(),now());
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.world_convenience_authority_v1('a1150000-0000-4000-8000-000000000001','b1150000-0000-4000-8000-000000000001','c1150000-0000-4000-8000-000000000001','OPEN',p_geometry=>repeat('a',64))$$,'P0001','CONVENIENCE_CLOSED','closed prevents authority creation');
update private.world_convenience_runtime set enabled=true;
select throws_ok($$select public.world_convenience_authority_v1('a1150000-0000-4000-8000-000000000002','b1150000-0000-4000-8000-000000000001','c1150000-0000-4000-8000-000000000001','OPEN',p_geometry=>repeat('a',64))$$,'42501','CONVENIENCE_AUTH_REVOKED','auth session is bound to actor');
create temp table convenience_test(response jsonb);
insert into convenience_test select public.world_convenience_authority_v1('a1150000-0000-4000-8000-000000000001','b1150000-0000-4000-8000-000000000001','c1150000-0000-4000-8000-000000000001','OPEN',p_geometry=>repeat('a',64));
select is((select response->>'spawnId' from convenience_test),'MAIN_GATE','new account cannot claim back-gate spawn');
select is((select response->>'fence' from convenience_test),'1','first durable fencing epoch');
select throws_ok($$select public.world_convenience_authority_v1('a1150000-0000-4000-8000-000000000001','b1150000-0000-4000-8000-000000000001','c1150000-0000-4000-8000-000000000002','OPEN',p_geometry=>repeat('a',64))$$,'P0001','CONVENIENCE_SESSION_ACTIVE','second tab cannot replace active session');
select throws_ok($$select public.world_income_start_v1('a1150000-0000-4000-8000-000000000001','quest.side.convenience_help','BACKGATE-NPC-001',gen_random_uuid())$$,'P0001','INCOME_USE_AUTHORITY_V2','legacy API never starts unverified shift');
update convenience_test set response=jsonb_set(response,'{nowMs}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint));
select throws_ok($$select public.world_convenience_authority_v1('a1150000-0000-4000-8000-000000000001','b1150000-0000-4000-8000-000000000001','c1150000-0000-4000-8000-000000000001','COMMIT',(select (response->>'sessionId')::uuid from convenience_test),1,0,jsonb_build_object('version','durable-campus-walk-v1','revision',1,'sequence',0,'lastCommand',null,'intentReceivedAt',null,'simulatedAt',(select (response->>'nowMs')::bigint from convenience_test),'observedAt',(select (response->>'nowMs')::bigint from convenience_test),'geometryRevision',repeat('a',64),'position',jsonb_build_object('x',153.18967351484042,'y',1.15,'z',111.37716454636742)))$$,'P0001','CONVENIENCE_SPAWN_MISMATCH','server worker cannot initialize arbitrary store pose');
select is((select count(*) from private.world_income_sessions where user_id='a1150000-0000-4000-8000-000000000001'),0::bigint,'all refused work leaves zero sessions');
delete from auth.sessions where id='b1150000-0000-4000-8000-000000000001';
select throws_ok($$select public.world_convenience_authority_v1('a1150000-0000-4000-8000-000000000001','b1150000-0000-4000-8000-000000000001','c1150000-0000-4000-8000-000000000001','READ',(select (response->>'sessionId')::uuid from convenience_test),1)$$,'42501','CONVENIENCE_AUTH_REVOKED','deleted auth session invalidates live authority');
select * from finish();
rollback;
