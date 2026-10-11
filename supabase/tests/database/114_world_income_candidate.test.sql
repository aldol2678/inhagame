-- Disposable transaction fixture only: activation and synthetic accounts roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1140000-0000-4000-8000-000000000001','authenticated','authenticated','income-a@example.test',now(),false),
 ('a1140000-0000-4000-8000-000000000002','authenticated','authenticated','income-b@example.test',now(),false),
 ('a1140000-0000-4000-8000-000000000003','authenticated','authenticated',null,null,true);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a1140000-0000-4000-8000-000000000001','수입A',false),
 ('a1140000-0000-4000-8000-000000000002','수입B',false),
 ('a1140000-0000-4000-8000-000000000003','수입손님',false);
select ok(not (select enabled from private.world_income_runtime),'runtime CLOSED');
select is((select count(*) from private.world_income_definitions where status='CLOSED'),2::bigint,'both definitions CLOSED');
select is((select count(*) from private.world_reward_definitions where reward_id like 'reward.income.%' and status='DISABLED'),2::bigint,'reward definitions DISABLED');
select ok(not has_function_privilege(r,f,'execute'),r || ' cannot execute ' || f)
from unnest(array['anon','authenticated']) r,unnest(array[
 'public.world_income_start_v1(uuid,text,text,uuid)','public.world_income_status_v1(uuid,uuid,text)',
 'public.world_income_action_v1(uuid,uuid,uuid,text,text,integer)','public.world_income_finish_v1(uuid,uuid,uuid)']) f;
select ok(has_function_privilege('service_role',f,'execute'),'service can execute ' || f)
from unnest(array['public.world_income_start_v1(uuid,text,text,uuid)','public.world_income_status_v1(uuid,uuid,text)',
 'public.world_income_action_v1(uuid,uuid,uuid,text,text,integer)','public.world_income_finish_v1(uuid,uuid,uuid)']) f;
select ok(not has_table_privilege(r,t,p),r || ' cannot ' || p || ' ' || t)
from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.world_income_runtime','private.world_income_definitions','private.world_income_sessions','private.world_income_requests']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.world_income_runtime'::regclass,'private.world_income_definitions'::regclass,'private.world_income_sessions'::regclass,'private.world_income_requests'::regclass)),'RLS enabled');
set local request.jwt.claims='{"role":"authenticated"}';
select throws_ok($$select public.world_income_status_v1('a1140000-0000-4000-8000-000000000001')$$,'42501','SERVICE_ROLE_REQUIRED','body rejects non-service claim');
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.world_income_status_v1('a1140000-0000-4000-8000-000000000003')$$,'42501','ACCOUNT_UNAVAILABLE','stored anonymous account rejected');
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.taerin_carp','INKYUNG-NPC-013',gen_random_uuid())$$,'P0001','INCOME_CLOSED','closed candidate cannot start');
delete from private.world_income_runtime;
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.taerin_carp','INKYUNG-NPC-013',gen_random_uuid())$$,'P0001','INCOME_CLOSED','missing runtime row fails closed');
insert into private.world_income_runtime(singleton,enabled) values(true,true);
update private.world_income_definitions set status='ACTIVE';
update private.world_reward_definitions set status='ACTIVE' where reward_id like 'reward.income.%';
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.taerin_carp','INKYUNG-NPC-003',gen_random_uuid())$$,'42501','INCOME_GIVER_MISMATCH','shop staff is not a delivery giver');
select is(public.world_income_status_v1('a1140000-0000-4000-8000-000000000001',null,'quest.side.taerin_carp')->'inventory',
 '{"itemId":"material.fish_carp","requiredQuantity":1,"ownedQuantity":0}'::jsonb,'delivery preview reads owned input without writes');
select is(public.world_income_status_v1('a1140000-0000-4000-8000-000000000001',null,'quest.side.taerin_carp')->'budget'->>'remainingDeliveries','1','fresh daily delivery slot');
create temp table income_test(name text primary key, response jsonb);
insert into income_test values('delivery',public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.taerin_carp','INKYUNG-NPC-013','b1140000-0000-4000-8000-000000000001'));
select is(public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.taerin_carp','INKYUNG-NPC-013','b1140000-0000-4000-8000-000000000001'),(select response from income_test where name='delivery'),'start exact replay');
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.convenience_help','npc.authored.convenience_employer','b1140000-0000-4000-8000-000000000001')$$,'23505','IDEMPOTENCY_CONFLICT','request cannot change quest');
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='delivery'),gen_random_uuid())$$,'P0001','INSUFFICIENT_QUANTITY','missing carp does not settle');
select is((select count(*) from private.world_reward_transactions where reward_id like 'reward.income.%'),0::bigint,'failed consume rolls back earlier reward ledger');
select is((select count(*) from private.world_currency_transactions where user_id='a1140000-0000-4000-8000-000000000001'),0::bigint,'failed consume rolls back earlier wallet transaction');
select is(coalesce((select balance from private.world_wallets where user_id='a1140000-0000-4000-8000-000000000001' and currency_id='currency.induck_coin'),0),0::bigint,'failed consume leaves no wallet credit');
select is((select state from private.world_income_sessions where user_id='a1140000-0000-4000-8000-000000000001'),'READY_TO_SETTLE','failed consume leaves session retryable');
select private.world_inventory_grant_v1('a1140000-0000-4000-8000-000000000001','material.fish_carp',2,'SYSTEM','income.fixture','income-test:fish',null,null);
-- Simulate expiry after downstream Wallet work; final gate must roll back reward and consumption.
create function pg_temp.expire_income_during_wallet() returns trigger language plpgsql as $$begin
 perform pg_sleep(1.1); return new; end$$;
update private.world_income_sessions set expires_at=clock_timestamp()+interval '1 second' where user_id='a1140000-0000-4000-8000-000000000001';
create trigger income_test_expire before insert on private.world_currency_transactions for each row execute function pg_temp.expire_income_during_wallet();
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='delivery'),gen_random_uuid())$$,'P0001','INCOME_SESSION_EXPIRED','expiry during settlement rolls back everything');
select is((select quantity from private.world_player_items where user_id='a1140000-0000-4000-8000-000000000001' and item_id='material.fish_carp'),2,'late expiry restores consumed carp');
select is((select count(*) from private.world_reward_transactions where reward_id like 'reward.income.%'),0::bigint,'late expiry rolls back reward ledger');
drop trigger income_test_expire on private.world_currency_transactions;
update private.world_income_sessions set expires_at=clock_timestamp()+interval '10 minutes' where user_id='a1140000-0000-4000-8000-000000000001';
-- A Wallet failure must abort before consuming Inventory; a failed CONSUME above rolls back earlier Wallet work.
create function pg_temp.reject_income_wallet() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_WALLET_FAILURE'; end$$;
create trigger income_test_wallet_failure before insert on private.world_currency_transactions for each row execute function pg_temp.reject_income_wallet();
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='delivery'),gen_random_uuid())$$,'P0001','INCOME_REWARD_FAILED','failed reward rolls back whole domain command');
select is((select quantity from private.world_player_items where user_id='a1140000-0000-4000-8000-000000000001' and item_id='material.fish_carp'),2,'failed Wallet leaves all carp');
select is((select count(*) from private.world_inventory_mutations where source_ref='quest.side.taerin_carp'),0::bigint,'failed Wallet leaves no consume receipt');
drop trigger income_test_wallet_failure on private.world_currency_transactions;
insert into income_test values('delivery-finish',public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='delivery'),'b1140000-0000-4000-8000-000000000002'));
select is((select response->>'state' from income_test where name='delivery-finish'),'SETTLED','delivery settled');
select is((select quantity from private.world_player_items where user_id='a1140000-0000-4000-8000-000000000001' and item_id='material.fish_carp'),1,'consumed exactly one carp');
select is(public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='delivery'),'b1140000-0000-4000-8000-000000000002'),(select response from income_test where name='delivery-finish'),'finish exact request replay');
select is(public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='delivery'),gen_random_uuid())->'receipt',(select response->'receipt' from income_test where name='delivery-finish'),'different request same session replays original settlement');
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.taerin_carp','INKYUNG-NPC-013',gen_random_uuid())$$,'P0001','INCOME_DAILY_LIMIT','one delivery per day');
select throws_ok($$select public.world_income_status_v1('a1140000-0000-4000-8000-000000000002',(select (response->>'sessionId')::uuid from income_test where name='delivery'))$$,'P0001','INCOME_SESSION_NOT_FOUND','cross actor session unavailable');
insert into income_test values('shift',public.world_income_start_v1('a1140000-0000-4000-8000-000000000001','quest.side.convenience_help','npc.authored.convenience_employer',gen_random_uuid()));
select ok(not (select response->'nextChallenge' ? 'answer' from income_test where name='shift'),'answer is never projected');
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid())$$,'P0001','INCOME_NOT_READY','client cannot assert finished');
-- Fixture advances server time fields without sleeping. Production callers cannot write this table.
update private.world_income_sessions set available_at=clock_timestamp()+interval '1 hour' where kind='SHIFT';
select throws_ok($$select public.world_income_action_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid(),'stock','milk',0)$$,'P0001','INCOME_STEP_TOO_EARLY','minimum active interval');
update private.world_income_sessions set available_at=clock_timestamp()-interval '1 second' where kind='SHIFT';
select throws_ok($$select public.world_income_action_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid(),'stock','wrong',0)$$,'22023','INCOME_WRONG_CHOICE','semantic wrong answer rejected');
select is((select revision from private.world_income_sessions where kind='SHIFT'),0,'wrong choice did not advance');
select throws_ok($$select public.world_income_action_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid(),'tidy','metal',0)$$,'22023','INCOME_STEP_MISMATCH','order enforced');
insert into income_test select 'step0',public.world_income_action_v1(user_id,session_id,'b1140000-0000-4000-8000-000000000003',challenge->>'action',challenge->>'answer',revision) from private.world_income_sessions where kind='SHIFT';
select throws_ok($$select public.world_income_action_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid(),'stock','milk',0)$$,'22023','INCOME_STEP_MISMATCH','stale revision rejected');
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),'b1140000-0000-4000-8000-000000000003')$$,'23505','IDEMPOTENCY_CONFLICT','same request cannot switch operations');
update private.world_income_sessions set available_at=clock_timestamp()-interval '1 second' where kind='SHIFT';
select public.world_income_action_v1(user_id,session_id,gen_random_uuid(),challenge->>'action',challenge->>'answer',revision) from private.world_income_sessions where kind='SHIFT';
update private.world_income_sessions set available_at=clock_timestamp()-interval '1 second' where kind='SHIFT';
select public.world_income_action_v1(user_id,session_id,gen_random_uuid(),challenge->>'action',challenge->>'answer',revision) from private.world_income_sessions where kind='SHIFT';
update private.world_income_runtime set daily_cap=40;
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid())$$,'P0001','INCOME_DAILY_CAP','delivery and shift share common cap');
update private.world_income_runtime set daily_cap=60;
-- Simulate a start before KST midnight: settlement must keep its frozen date, never recompute it.
update private.world_income_sessions set accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date-1 where kind='SHIFT';
insert into income_test values('shift-finish',public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid()));
select is((select response->'receipt'->>'accountingDate' from income_test where name='shift-finish'),((clock_timestamp() at time zone 'Asia/Seoul')::date-1)::text,'cross-midnight finish uses frozen start day');
select is((select count(*) from private.world_reward_transactions where reward_id like 'reward.income.%'),2::bigint,'exactly two reward ledger transactions');
select is((select balance from private.world_wallets where user_id='a1140000-0000-4000-8000-000000000001' and currency_id='currency.induck_coin'),50::bigint,'only 20 plus 30 paid');
select is((public.world_income_status_v1('a1140000-0000-4000-8000-000000000001',null,'quest.side.convenience_help')->'budget'->>'budgetDate'),((clock_timestamp() at time zone 'Asia/Seoul')::date)::text,'preview budget uses current day, not yesterday session');
select is((public.world_income_status_v1('a1140000-0000-4000-8000-000000000001',null,'quest.side.convenience_help')->'budget'->>'remainingShifts'),'1','yesterday settled shift does not block today');
select is((public.world_income_status_v1('a1140000-0000-4000-8000-000000000002',null,'quest.side.convenience_help')->>'coin'),'30','empty-history preview is server priced');
select is((public.world_income_status_v1('a1140000-0000-4000-8000-000000000001',null,'quest.side.taerin_carp')->>'questId'),'quest.side.taerin_carp','status filter isolates requested domain');
update private.world_reward_definitions set status='DISABLED' where reward_id='reward.income.convenience_help';
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000002','quest.side.convenience_help','npc.authored.convenience_employer',gen_random_uuid())$$,'P0001','INCOME_REWARD_UNAVAILABLE','inactive reward blocks start before effort');
update private.world_reward_definitions set status='ACTIVE' where reward_id='reward.income.convenience_help';
update private.world_income_runtime set daily_cap=40;
insert into income_test values('reserve',public.world_income_start_v1('a1140000-0000-4000-8000-000000000002','quest.side.convenience_help','npc.authored.convenience_employer',gen_random_uuid()));
select is((select response->'budget'->>'remainingCoin' from income_test where name='reserve'),'10','start reserves common cap');
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000002','quest.side.taerin_carp','INKYUNG-NPC-013',gen_random_uuid())$$,'P0001','INCOME_DAILY_CAP','another category cannot exceed active reservation');
update private.world_income_sessions set expires_at=clock_timestamp()-interval '1 second' where user_id='a1140000-0000-4000-8000-000000000002';
select is(public.world_income_status_v1('a1140000-0000-4000-8000-000000000002',null,'quest.side.convenience_help')->>'state','EXPIRED','expired sessions project EXPIRED');
select ok(public.world_income_status_v1('a1140000-0000-4000-8000-000000000002',null,'quest.side.convenience_help')->'nextChallenge'='null'::jsonb,'expired challenge hidden');
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000002',(select (response->>'sessionId')::uuid from income_test where name='reserve'),gen_random_uuid())$$,'P0001','INCOME_SESSION_EXPIRED','expired session cannot settle');
insert into income_test values('after-expiry',public.world_income_start_v1('a1140000-0000-4000-8000-000000000002','quest.side.taerin_carp','INKYUNG-NPC-013',gen_random_uuid()));
select is((select response->'budget'->>'remainingCoin' from income_test where name='after-expiry'),'20','expired reservation released');
update private.world_income_sessions set accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date-1 where session_id=(select (response->>'sessionId')::uuid from income_test where name='after-expiry');
select throws_ok($$select public.world_income_start_v1('a1140000-0000-4000-8000-000000000002','quest.side.taerin_carp','INKYUNG-NPC-013',gen_random_uuid())$$,'P0001','INCOME_SESSION_ACTIVE','prior-day live session must be recovered before a new one');
select is(public.world_income_status_v1('a1140000-0000-4000-8000-000000000002',null,'quest.side.taerin_carp')->'budget'->>'remainingDeliveries','0','prior-day live session closes today start preview');
update private.world_reward_definitions set version=version+1 where reward_id='reward.income.taerin_carp';
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000002',(select (response->>'sessionId')::uuid from income_test where name='after-expiry'),gen_random_uuid())$$,'P0001','INCOME_REWARD_UNAVAILABLE','reward version drift rejects frozen session');
update private.world_reward_definitions set version=version-1 where reward_id='reward.income.taerin_carp';
update private.world_income_definitions set definition_version=2 where quest_id='quest.side.taerin_carp';
select throws_ok($$select public.world_income_finish_v1('a1140000-0000-4000-8000-000000000002',(select (response->>'sessionId')::uuid from income_test where name='after-expiry'),gen_random_uuid())$$,'P0001','INCOME_REWARD_UNAVAILABLE','definition version drift rejected');
update private.world_income_runtime set daily_cap=60;
update private.world_income_runtime set enabled=false;
update private.world_income_definitions set status='CLOSED';
update private.world_reward_definitions set status='DISABLED' where reward_id like 'reward.income.%';
select is(public.world_income_finish_v1('a1140000-0000-4000-8000-000000000001',(select (response->>'sessionId')::uuid from income_test where name='shift'),gen_random_uuid())->'receipt',(select response->'receipt' from income_test where name='shift-finish'),'receipt survives all switches closing');
select throws_ok($$update private.world_income_sessions set coin=20 where kind='SHIFT'$$,'42501','INCOME_RECEIPT_IMMUTABLE','settled session immutable');
update public.profiles set is_banned=true where user_id='a1140000-0000-4000-8000-000000000001';
select throws_ok($$select public.world_income_status_v1('a1140000-0000-4000-8000-000000000001')$$,'42501','ACCOUNT_UNAVAILABLE','banned account cannot read historical receipt');
select * from finish();
rollback;
