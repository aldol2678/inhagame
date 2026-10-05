-- Economy P0-A: Wallet + Transaction Ledger (20260927100000). Credit, debit, negative
-- prevention, ledger rows, idempotency and the client/server authority boundary. Real
-- concurrency and cross-connection persistence need separate connections, so they live in
-- supabase/tests/integration/wallet-ledger.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a3000000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'wallet-a@example.test', now(), false),
 ('b3000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', 'wallet-b@example.test', now(), false),
 ('c3000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', null, null, true),
 ('d3000000-0000-4000-8000-0000000000d3', 'authenticated', 'authenticated', 'wallet-d@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a3000000-0000-4000-8000-0000000000a3', '지갑A', false),
 ('b3000000-0000-4000-8000-0000000000b3', '지갑B', false),
 ('c3000000-0000-4000-8000-0000000000c3', '지갑게스트', false),
 ('d3000000-0000-4000-8000-0000000000d3', '지갑정지', true);

-- ---- schema ----
select has_table('private', 'world_currencies', 'currency registry exists');
select has_table('private', 'world_wallets', 'wallet table exists');
select has_table('private', 'world_currency_transactions', 'ledger table exists');
select col_is_pk('private', 'world_wallets', array['user_id', 'currency_id'], 'one wallet per (user, currency)');
select col_is_unique('private', 'world_currency_transactions', array['idempotency_key'], 'idempotency key is unique in the ledger');
select col_type_is('private', 'world_wallets', 'balance', 'bigint', 'balance is an integer');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_currencies'::regclass, 'private.world_wallets'::regclass,
  'private.world_currency_transactions'::regclass)), 'economy tables have RLS');
select results_eq($$select currency_id, display_name from private.world_currencies$$,
  $$values ('currency.induck_coin'::text, '인덕코인'::text)$$, 'the one standing currency is 인덕코인');

-- ---- authority: no Data API role reads or writes the tables; only the server moves value ----
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_wallets', 'private.world_currency_transactions', 'private.world_currencies']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r, unnest(array[
  'public.world_wallet_credit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_debit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_get_balance_v1(uuid,text)',
  'private.world_wallet_apply_v1(uuid,text,bigint,text,text,text,text,text)']) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f))
from unnest(array[
  'public.world_wallet_credit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_debit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_get_balance_v1(uuid,text)']) f;
select ok(not has_function_privilege('service_role', 'private.world_wallet_apply_v1(uuid,text,bigint,text,text,text,text,text)', 'execute'),
  'even the server goes through the credit/debit RPCs, not the internal apply');
select ok(has_function_privilege('authenticated', 'public.get_my_world_wallet_v1()', 'execute'), 'player can read own wallet');
select ok(not has_function_privilege('anon', 'public.get_my_world_wallet_v1()', 'execute'), 'guest has no wallet read');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a3000000-0000-4000-8000-0000000000a3","is_anonymous":false}';
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100, 'REWARD', 'test', 'x', 'client-credit-attempt')$$,
  '42501', null, 'player cannot credit through the RPC');
select throws_ok($$select public.world_wallet_debit_v1('b3000000-0000-4000-8000-0000000000b3', 'currency.induck_coin', 1, 'PURCHASE', 'test', 'x', 'client-debit-attempt')$$,
  '42501', null, 'player cannot debit anyone through the RPC');
select throws_ok($$insert into private.world_wallets(user_id, currency_id, balance) values ('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 999)$$,
  '42501', null, 'player cannot INSERT a wallet');
select throws_ok($$update private.world_wallets set balance = 999$$, '42501', null, 'player cannot UPDATE a wallet');
select throws_ok($$delete from private.world_wallets$$, '42501', null, 'player cannot DELETE a wallet');
select throws_ok($$insert into private.world_currency_transactions(user_id, currency_id, type, amount, balance_before, balance_after, source_type, source_id, idempotency_key)
  values ('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 'REWARD', 5, 0, 5, 'test', 'x', 'client-ledger-insert')$$,
  '42501', null, 'player cannot INSERT a ledger row');
select throws_ok($$update private.world_currency_transactions set amount = 1$$, '42501', null, 'player cannot UPDATE the ledger');
select throws_ok($$delete from private.world_currency_transactions$$, '42501', null, 'player cannot DELETE the ledger');
select throws_ok($$select * from private.world_wallets$$, '42501', null, 'player cannot read raw wallets');
select throws_ok($$select * from private.world_currency_transactions$$, '42501', null, 'player cannot read raw ledger');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100, 'REWARD', 'test', 'x', 'anon-credit-attempt')$$,
  '42501', null, 'guest cannot credit');
select throws_ok($$select public.get_my_world_wallet_v1()$$, '42501', null, 'guest cannot read a wallet');
reset role;

-- ---- server flow: credit / debit / negative prevention / ledger ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is((public.world_wallet_get_balance_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin')->>'balance')::bigint,
  0::bigint, 'new account balance is 0');
reset role;
select is((select count(*) from private.world_wallets where user_id = 'a3000000-0000-4000-8000-0000000000a3'),
  0::bigint, 'reading a balance does not provision a wallet');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100,
  'REWARD', 'economy_test', 'credit001', 'economy-test:a3:credit001')->>'balanceAfter', '100', '+100 credit -> 100');
select is(public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 30,
  'REWARD', 'economy_test', 'credit002', 'economy-test:a3:credit002')->>'balanceAfter', '130', '+30 credit -> 130');
select is(public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 50,
  'PURCHASE', 'economy_test', 'debit001', 'economy-test:a3:debit001')->>'balanceAfter', '80', '-50 debit -> 80');
select throws_ok($$select public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100,
  'PURCHASE', 'economy_test', 'debit002', 'economy-test:a3:debit002')$$,
  'P0001', 'INSUFFICIENT_FUNDS', '100 debit on 80 -> INSUFFICIENT_FUNDS');
select is((public.world_wallet_get_balance_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin')->>'balance')::bigint,
  80::bigint, 'final balance is 80');
select is((public.world_wallet_get_balance_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin')->>'version')::bigint,
  3::bigint, 'wallet version counts the three applied changes');
reset role;

select results_eq($$
  select type, amount, balance_before, balance_after, source_type, source_id, idempotency_key
  from private.world_currency_transactions
  where user_id = 'a3000000-0000-4000-8000-0000000000a3' order by balance_before$$,
  $$values ('REWARD'::text, 100::bigint, 0::bigint, 100::bigint, 'economy_test'::text, 'credit001'::text, 'economy-test:a3:credit001'::text),
           ('REWARD', 30, 100, 130, 'economy_test', 'credit002', 'economy-test:a3:credit002'),
           ('PURCHASE', -50, 130, 80, 'economy_test', 'debit001', 'economy-test:a3:debit001')$$,
  'exactly one ledger row per successful change, none for the refused debit');
select is((select count(*) from private.world_currency_transactions where idempotency_key = 'economy-test:a3:debit002'),
  0::bigint, 'refused debit left no ledger row');

-- ---- idempotency ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100,
  'REWARD', 'economy_test', 'credit001', 'economy-test:a3:credit001')->>'status', 'ALREADY_PROCESSED',
  'same credit key again -> ALREADY_PROCESSED');
select is(public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100,
  'REWARD', 'economy_test', 'credit001', 'economy-test:a3:credit001')->>'balanceAfter', '100',
  'replay returns the original result');
select is(public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 50,
  'PURCHASE', 'economy_test', 'debit001', 'economy-test:a3:debit001')->>'status', 'ALREADY_PROCESSED',
  'same debit key again -> ALREADY_PROCESSED');
select is((public.world_wallet_get_balance_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin')->>'balance')::bigint,
  80::bigint, 'replays moved no value');
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 999,
  'REWARD', 'economy_test', 'credit001', 'economy-test:a3:credit001')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'same key with a different amount is refused');
select throws_ok($$select public.world_wallet_credit_v1('b3000000-0000-4000-8000-0000000000b3', 'currency.induck_coin', 100,
  'REWARD', 'economy_test', 'credit001', 'economy-test:a3:credit001')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'same key for another account is refused');
select throws_ok($$select public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 100,
  'PURCHASE', 'economy_test', 'credit001', 'economy-test:a3:credit001')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'a credit key cannot be replayed as a debit');
reset role;
select is((select count(*) from private.world_currency_transactions where user_id = 'a3000000-0000-4000-8000-0000000000a3'),
  3::bigint, 'replays and conflicts added no ledger rows');
select is((select count(*) from private.world_wallets where user_id = 'b3000000-0000-4000-8000-0000000000b3'),
  0::bigint, 'refused conflict left no wallet for the other account');

-- ---- validation ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 0, 'REWARD', 'economy_test', 'x', 'v-zero')$$,
  '22023', 'INVALID_AMOUNT', 'amount 0 is refused');
select throws_ok($$select public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', -10, 'PURCHASE', 'economy_test', 'x', 'v-negative')$$,
  '22023', 'INVALID_AMOUNT', 'negative debit amount (a disguised credit) is refused');
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.campus', 10, 'REWARD', 'economy_test', 'x', 'v-currency')$$,
  '22023', 'INVALID_CURRENCY', 'unknown currency is refused');
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 10, 'PURCHASE', 'economy_test', 'x', 'v-type')$$,
  '22023', 'INVALID_TRANSACTION_TYPE', 'a credit cannot be typed PURCHASE');
select throws_ok($$select public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 10, 'REWARD', 'economy_test', 'x', 'v-type2')$$,
  '22023', 'INVALID_TRANSACTION_TYPE', 'a debit cannot be typed REWARD');
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 10, 'ADMIN', 'ops', 'operator-1', 'v-admin')$$,
  '22023', 'REASON_REQUIRED', 'ADMIN grant must carry a reason');
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 10, 'REWARD', 'economy_test', 'x', null)$$,
  '22023', 'INVALID_IDEMPOTENCY_KEY', 'idempotency key is required');
select throws_ok($$select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 10, 'REWARD', 'Bad Source', 'x', 'v-source')$$,
  '22023', 'INVALID_SOURCE', 'source type is validated');
select throws_ok($$select public.world_wallet_credit_v1('c3000000-0000-4000-8000-0000000000c3', 'currency.induck_coin', 10, 'REWARD', 'economy_test', 'x', 'v-guest')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'guest account gets no persistent wallet');
select throws_ok($$select public.world_wallet_credit_v1('d3000000-0000-4000-8000-0000000000d3', 'currency.induck_coin', 10, 'REWARD', 'economy_test', 'x', 'v-banned')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'banned account is refused');
select throws_ok($$select public.world_wallet_credit_v1('e3000000-0000-4000-8000-0000000000e3', 'currency.induck_coin', 10, 'REWARD', 'economy_test', 'x', 'v-missing')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'unknown user is refused');
select is((public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 5, 'ADJUSTMENT', 'ops', 'operator-1',
  'economy-test:a3:adjust001', 'restore lost reward')->>'balanceAfter'), '85', 'ADJUSTMENT with a reason goes through the ledger');
select is((public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 85, 'ADMIN', 'ops', 'operator-1',
  'economy-test:a3:admin001', 'drain to zero')->>'balanceAfter'), '0', 'debit to exactly 0 is allowed');
select throws_ok($$select public.world_wallet_debit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 1, 'PURCHASE', 'economy_test', 'x', 'economy-test:a3:below-zero')$$,
  'P0001', 'INSUFFICIENT_FUNDS', 'balance 0 cannot go negative');
reset role;
select is((select count(*) from private.world_wallets where user_id in (
  'c3000000-0000-4000-8000-0000000000c3', 'd3000000-0000-4000-8000-0000000000d3', 'e3000000-0000-4000-8000-0000000000e3')),
  0::bigint, 'refused accounts have no wallet');

-- ---- integrity: the wallet is exactly the sum of its ledger ----
select is(
  array(select w.user_id::text || ':' || w.balance || '/' || w.version from private.world_wallets w
        where w.balance <> (select coalesce(sum(t.amount), 0) from private.world_currency_transactions t
                            where t.user_id = w.user_id and t.currency_id = w.currency_id)
           or w.version <> (select count(*) from private.world_currency_transactions t
                            where t.user_id = w.user_id and t.currency_id = w.currency_id)),
  array[]::text[], 'every wallet balance equals the sum of its ledger, version equals its row count');
select throws_ok($$update private.world_currency_transactions set amount = 1000 where user_id = 'a3000000-0000-4000-8000-0000000000a3'$$,
  '42501', 'LEDGER_APPEND_ONLY', 'ledger rows are never updated, even by the owner');
select throws_ok($$update private.world_wallets set balance = -1 where user_id = 'a3000000-0000-4000-8000-0000000000a3'$$,
  '23514', null, 'the database itself refuses a negative balance');
select throws_ok($$insert into private.world_currency_transactions(user_id, currency_id, type, amount, balance_before, balance_after, source_type, source_id, idempotency_key)
  values ('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 'REWARD', 5, 0, 50, 'test', 'x', 'bad-math')$$,
  '23514', null, 'ledger rows must satisfy balance_after = balance_before + amount');

-- ---- player read contract: own wallet only ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_wallet_credit_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin', 120,
  'REWARD', 'economy_test', 'credit003', 'economy-test:a3:credit003');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a3000000-0000-4000-8000-0000000000a3","is_anonymous":false}';
select is(public.get_my_world_wallet_v1(),
  '{"currencies":[{"id":"currency.induck_coin","balance":120}]}'::jsonb, 'player A reads own balance 120');
set local request.jwt.claims = '{"role":"authenticated","sub":"b3000000-0000-4000-8000-0000000000b3","is_anonymous":false}';
select is(public.get_my_world_wallet_v1(),
  '{"currencies":[{"id":"currency.induck_coin","balance":0}]}'::jsonb, 'player B sees only own (empty) wallet, never A''s');
set local request.jwt.claims = '{"role":"authenticated","sub":"c3000000-0000-4000-8000-0000000000c3","is_anonymous":true}';
select throws_ok($$select public.get_my_world_wallet_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous session has no wallet');
set local request.jwt.claims = '{"role":"authenticated","sub":"d3000000-0000-4000-8000-0000000000d3","is_anonymous":false}';
select throws_ok($$select public.get_my_world_wallet_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot read');
select throws_ok($$select public.world_wallet_get_balance_v1('a3000000-0000-4000-8000-0000000000a3', 'currency.induck_coin')$$,
  '42501', null, 'player cannot read another account through the server API');
reset role;

select * from finish();
rollback;
