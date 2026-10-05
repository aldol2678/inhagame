-- Progression / Economy P1f: 캠퍼스 출석부. One explicit claim per account per Asia/Seoul day (+10),
-- monthly cumulative milestones 3/7/14/21 (+30/+50/+100/+150), no streak, no EXP, no items.
-- The month logic runs through private.world_attendance_claim_v1 with pinned dates; the public RPCs
-- are exercised for account rules and the real DB day. Concurrent claims through PostgREST live in
-- supabase/tests/integration/attendance.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('f1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'p1f-a@example.test', now(), false),
 ('f1000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'p1f-b@example.test', now(), false),
 ('f1000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'p1f-c@example.test', now(), false),
 ('f1000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'p1f-d@example.test', now(), false),
 ('f1000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', null, now(), true),
 ('f1000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'p1f-f@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('f1000000-0000-4000-8000-0000000000a1', '출석A', false),
 ('f1000000-0000-4000-8000-0000000000b2', '출석B', false),
 ('f1000000-0000-4000-8000-0000000000c3', '출석C', false),
 ('f1000000-0000-4000-8000-0000000000d4', '출석D', false),
 ('f1000000-0000-4000-8000-0000000000e5', '출석E', false),
 ('f1000000-0000-4000-8000-0000000000f6', '출석F', true);

create function pg_temp.as_player(p uuid, q text, p_anonymous boolean default false) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'is_anonymous', p_anonymous)::text, true);
  execute 'set local role authenticated';
  execute q into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise;
end;
$f$;
create function pg_temp.claim(p uuid, d date) returns jsonb language sql as $f$
  select private.world_attendance_claim_v1(p, d);
$f$;
create function pg_temp.coins(p uuid) returns bigint language sql as $f$
  select coalesce((select w.balance from private.world_wallets w where w.user_id = p and w.currency_id = 'currency.induck_coin'), 0);
$f$;
create function pg_temp.rows(p uuid) returns bigint language sql as $f$
  select count(*) from private.world_attendance_days where user_id = p;
$f$;
create function pg_temp.tx(p uuid, r text) returns bigint language sql as $f$
  select count(*) from private.world_reward_transactions where user_id = p and reward_id = r;
$f$;
create function pg_temp.ledger(p uuid) returns bigint language sql as $f$
  select count(*) from private.world_currency_transactions where user_id = p;
$f$;

-- ---- 1-4. table privacy ----
select has_table('private', 'world_attendance_days', 'attendance table is private');
select ok((select relrowsecurity from pg_class where oid = 'private.world_attendance_days'::regclass), 'RLS enabled');
select ok(not has_table_privilege('authenticated', 'private.world_attendance_days', 'select')
  and not has_table_privilege('authenticated', 'private.world_attendance_days', 'insert')
  and not has_table_privilege('anon', 'private.world_attendance_days', 'select'), 'no anon / authenticated table access');
select results_eq($$select c.confdeltype::text from pg_constraint c
    where c.conrelid = 'private.world_attendance_days'::regclass and c.contype = 'f' and c.confrelid = 'auth.users'::regclass$$,
  $$values ('c'::text)$$, 'user_id references auth.users on delete cascade');

-- ---- 5-8. RewardDefinitions ----
select results_eq($$select d.reward_id, d.status, d.version, g.grant_type, g.target_id, g.amount
    from private.world_reward_definitions d join private.world_reward_grants g using (reward_id)
   where d.reward_id like 'reward.attendance.%' order by g.amount$$,
  $$values ('reward.attendance.daily'::text, 'ACTIVE'::text, 1, 'CURRENCY'::text, 'currency.induck_coin'::text, 10::bigint),
           ('reward.attendance.monthly_3', 'ACTIVE', 1, 'CURRENCY', 'currency.induck_coin', 30),
           ('reward.attendance.monthly_7', 'ACTIVE', 1, 'CURRENCY', 'currency.induck_coin', 50),
           ('reward.attendance.monthly_14', 'ACTIVE', 1, 'CURRENCY', 'currency.induck_coin', 100),
           ('reward.attendance.monthly_21', 'ACTIVE', 1, 'CURRENCY', 'currency.induck_coin', 150)$$,
  'five coin-only RewardDefinitions: 10 / 30 / 50 / 100 / 150');
select is((select count(*) from private.world_reward_grants where reward_id like 'reward.attendance.%' and grant_type <> 'CURRENCY'), 0::bigint,
  'no EXP or item grants');

-- ---- public surface: no date / month / time / user argument ----
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%attendance%'
    and (p.pronargs > 0)), 0::bigint, 'public attendance RPCs take no arguments at all');
select ok(not has_function_privilege('anon', 'public.claim_my_world_attendance_v1()', 'execute')
  and not has_function_privilege('authenticated', 'private.world_attendance_claim_v1(uuid,date)', 'execute'),
  'guests cannot claim; players cannot call the dated private claim');

-- ---- 9-11. accounts ----
select throws_ok($$select pg_temp.as_player('f1000000-0000-4000-8000-0000000000e5', 'select public.get_my_world_attendance_v1()', true)$$,
  '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous status refused');
select throws_ok($$select pg_temp.as_player('f1000000-0000-4000-8000-0000000000e5', 'select public.claim_my_world_attendance_v1()', true)$$,
  '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous claim refused');
select throws_ok($$select pg_temp.as_player('f1000000-0000-4000-8000-0000000000f6', 'select public.claim_my_world_attendance_v1()')$$,
  '42501', 'ACCOUNT_UNAVAILABLE', 'banned claim refused');
select results_eq($$select s ->> 'rewardDate', (s ->> 'claimedToday')::boolean, (s ->> 'attendedDays')::int, s -> 'attendedDates'
    from (select pg_temp.as_player('f1000000-0000-4000-8000-0000000000d4', 'select public.get_my_world_attendance_v1()') s) x$$,
  $$values (to_char(private.world_attendance_today_v1(), 'YYYY-MM-DD'), false, 0, '[]'::jsonb)$$,
  'permanent account: status for today (DB KST), nothing claimed');
select is(pg_temp.rows('f1000000-0000-4000-8000-0000000000d4'), 0::bigint, 'reading the status never claims');
select set_config('test.d_claim', pg_temp.as_player('f1000000-0000-4000-8000-0000000000d4', 'select public.claim_my_world_attendance_v1()')::text, true);
select results_eq($$select (s ->> 'claimed')::boolean, (s ->> 'replayed')::boolean, (s ->> 'claimedToday')::boolean,
    jsonb_array_length(s -> 'rewards'), s -> 'rewards' -> 0 ->> 'rewardId', s ->> 'rewardDate'
    from (select current_setting('test.d_claim')::jsonb s) x$$,
  $$values (true, false, true, 1, 'reward.attendance.daily'::text, to_char(private.world_attendance_today_v1(), 'YYYY-MM-DD'))$$,
  'the public claim uses the DB KST day and pays the daily reward');
select ok(current_setting('test.d_claim') !~ '(userId|idempotencyKey|childTransactionId|attempts|grantEntryId)',
  'no server-only fields in the claim response');
select results_eq($$select idempotency_key, source_type, source_id from private.world_reward_transactions where user_id = 'f1000000-0000-4000-8000-0000000000d4'$$,
  $$values ('attendance:daily:f1000000-0000-4000-8000-0000000000d4:' || to_char(private.world_attendance_today_v1(), 'YYYY-MM-DD'),
            'SYSTEM'::text, 'attendance.daily'::text)$$, 'daily key with the DB KST date, source SYSTEM / attendance.daily');

-- ---- 12-14. KST day / month boundary ----
select results_eq($$select private.world_attendance_today_v1('2026-09-29 14:59:59+00'), private.world_attendance_today_v1('2026-09-29 15:00:00+00'),
    private.world_attendance_today_v1('2026-09-30 14:59:59+00'), private.world_attendance_today_v1('2026-09-30 15:00:00+00')$$,
  $$values ('2026-09-29'::date, '2026-09-30'::date, '2026-09-30'::date, '2026-10-01'::date)$$,
  '23:59:59 KST is the same day, 00:00 KST the next; 9/30 → 10/1 at 15:00 UTC');

-- ---- 15-16. first claim and same-day replay ----
select set_config('test.a1', pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-01')::text, true);
select results_eq($$select (s ->> 'claimed')::boolean, (s ->> 'attendedDays')::int, s -> 'attendedDates', s ->> 'month',
    s -> 'nextMilestone', jsonb_array_length(s -> 'rewards')
    from (select current_setting('test.a1')::jsonb s) x$$,
  $$values (true, 1, '["2026-09-01"]'::jsonb, '2026-09'::text, '{"days": 3, "bonusCoin": 30}'::jsonb, 1)$$,
  'first claim: 1 day, next milestone 3 (+30), one reward');
select results_eq($$select pg_temp.rows('f1000000-0000-4000-8000-0000000000a1'), pg_temp.coins('f1000000-0000-4000-8000-0000000000a1')$$,
  $$values (1::bigint, 10::bigint)$$, 'row 1, wallet +10');
select results_eq($$select (s ->> 'claimed')::boolean, (s ->> 'replayed')::boolean, s -> 'rewards', (s ->> 'attendedDays')::int
    from (select pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-01') s) x$$,
  $$values (false, true, '[]'::jsonb, 1)$$, 'same-day replay: not claimed, no rewards');
select results_eq($$select pg_temp.rows('f1000000-0000-4000-8000-0000000000a1'), pg_temp.coins('f1000000-0000-4000-8000-0000000000a1'),
    pg_temp.tx('f1000000-0000-4000-8000-0000000000a1', 'reward.attendance.daily')$$,
  $$values (1::bigint, 10::bigint, 1::bigint)$$, 'replay: row unchanged, coin +0, reward +0');

-- ---- 17-23. next days, monthly count, milestones (not a streak: days are skipped on purpose) ----
select results_eq($$select (s ->> 'attendedDays')::int, pg_temp.coins('f1000000-0000-4000-8000-0000000000a1')
    from (select pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-03') s) x$$,
  $$values (2, 20::bigint)$$, 'day 2 (9/3 after skipping 9/2): +10, count 2');
select set_config('test.a3', pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-08')::text, true);
select results_eq($$select (s ->> 'attendedDays')::int, jsonb_array_length(s -> 'rewards'), s -> 'rewards' -> 1 ->> 'rewardId',
    (s -> 'rewards' -> 1 -> 'entries' -> 0 ->> 'granted')::int, s -> 'nextMilestone' ->> 'days'
    from (select current_setting('test.a3')::jsonb s) x$$,
  $$values (3, 2, 'reward.attendance.monthly_3'::text, 30, '7'::text)$$, '3rd attended day (after a 5-day gap): daily + milestone 3');
select is(pg_temp.coins('f1000000-0000-4000-8000-0000000000a1'), 60::bigint, '3rd day pays 10 + 30 = 40 (total 60)');
select results_eq($$select idempotency_key, source_type, source_id from private.world_reward_transactions
   where user_id = 'f1000000-0000-4000-8000-0000000000a1' and reward_id = 'reward.attendance.monthly_3'$$,
  $$values ('attendance:monthly:f1000000-0000-4000-8000-0000000000a1:2026-09:3'::text, 'SYSTEM'::text, 'attendance.monthly.3'::text)$$,
  'milestone key attendance:monthly:<uid>:2026-09:3, source SYSTEM / attendance.monthly.3');
do $$ declare d int; begin
  foreach d in array array[9, 10, 11] loop perform private.world_attendance_claim_v1('f1000000-0000-4000-8000-0000000000a1', make_date(2026, 9, d)); end loop;
end $$;
select results_eq($$select (s ->> 'attendedDays')::int, s -> 'rewards' -> 1 ->> 'rewardId'
    from (select pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-12') s) x$$,
  $$values (7, 'reward.attendance.monthly_7'::text)$$, '7th day: milestone 7');
select is(pg_temp.coins('f1000000-0000-4000-8000-0000000000a1'), 150::bigint, '7 days: 7×10 + 30 + 50 = 150');
do $$ declare d int; begin
  foreach d in array array[13, 14, 15, 16, 17, 18] loop perform private.world_attendance_claim_v1('f1000000-0000-4000-8000-0000000000a1', make_date(2026, 9, d)); end loop;
end $$;
select results_eq($$select (s ->> 'attendedDays')::int, s -> 'rewards' -> 1 ->> 'rewardId', (s -> 'rewards' -> 1 -> 'entries' -> 0 ->> 'granted')::int
    from (select pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-19') s) x$$,
  $$values (14, 'reward.attendance.monthly_14'::text, 100)$$, '14th day: milestone 14 (+100)');
do $$ declare d int; begin
  foreach d in array array[20, 21, 22, 23, 24, 25] loop perform private.world_attendance_claim_v1('f1000000-0000-4000-8000-0000000000a1', make_date(2026, 9, d)); end loop;
end $$;
select set_config('test.a21', pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-26')::text, true);
select results_eq($$select (s ->> 'attendedDays')::int, s -> 'rewards' -> 1 ->> 'rewardId', (s -> 'rewards' -> 1 -> 'entries' -> 0 ->> 'granted')::int,
    s -> 'nextMilestone', (select jsonb_agg((m ->> 'claimed')::boolean) from jsonb_array_elements(s -> 'milestones') m)
    from (select current_setting('test.a21')::jsonb s) x$$,
  $$values (21, 'reward.attendance.monthly_21'::text, 150, 'null'::jsonb, '[true, true, true, true]'::jsonb)$$,
  '21st day: milestone 21 (+150), all milestones claimed, no next milestone');
select is(pg_temp.coins('f1000000-0000-4000-8000-0000000000a1'), 540::bigint, '21 days: 21×10 + 330 = 540');
select results_eq($$select jsonb_array_length(s -> 'rewards'), (s ->> 'attendedDays')::int
    from (select pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-09-27') s) x$$,
  $$values (1, 22)$$, '22nd day: daily only, milestones never repeat');
select results_eq($$select reward_id, count(*) from private.world_reward_transactions
   where user_id = 'f1000000-0000-4000-8000-0000000000a1' group by reward_id order by reward_id$$,
  $$values ('reward.attendance.daily'::text, 22::bigint), ('reward.attendance.monthly_14', 1), ('reward.attendance.monthly_21', 1),
           ('reward.attendance.monthly_3', 1), ('reward.attendance.monthly_7', 1)$$,
  'one daily transaction per day, one per milestone');
select is(pg_temp.ledger('f1000000-0000-4000-8000-0000000000a1'), 26::bigint, 'one currency ledger row per reward (22 + 4)');

-- ---- 32-33. month boundary: October starts at 0, September rows stay ----
select results_eq($$select (s ->> 'claimedToday')::boolean, (s ->> 'attendedDays')::int, s -> 'attendedDates', s ->> 'month'
    from (select private.world_attendance_state_v1('f1000000-0000-4000-8000-0000000000a1', '2026-10-01') s) x$$,
  $$values (false, 0, '[]'::jsonb, '2026-10'::text)$$, '10/1: attendedDays 0, not claimed, no September dates');
select set_config('test.a_oct', pg_temp.claim('f1000000-0000-4000-8000-0000000000a1', '2026-10-01')::text, true);
select results_eq($$select (s ->> 'attendedDays')::int, s -> 'attendedDates', jsonb_array_length(s -> 'rewards')
    from (select current_setting('test.a_oct')::jsonb s) x$$,
  $$values (1, '["2026-10-01"]'::jsonb, 1)$$, 'October claim: a new row, count 1, daily only');
select is((select count(*) from private.world_attendance_days where user_id = 'f1000000-0000-4000-8000-0000000000a1'
    and attendance_date < '2026-10-01'), 22::bigint, 'September rows are kept');
select results_eq($$select (s ->> 'attendedDays')::int, jsonb_array_length(s -> 'attendedDates')
    from (select private.world_attendance_state_v1('f1000000-0000-4000-8000-0000000000a1', '2026-09-15') s) x$$,
  $$values (10, 10)$$, 'a 9/15 view counts and lists only September dates up to that day (no future dates)');

-- ---- 26-28. reward failure rolls everything back; retry pays once ----
create function public.p1f_fail_coin_v1() returns trigger language plpgsql as $f$
begin
  if new.user_id = 'f1000000-0000-4000-8000-0000000000b2' and new.amount = current_setting('test.fail_amount')::bigint then
    raise exception 'P1F_TEST_WALLET_DOWN';
  end if;
  return new;
end;
$f$;
create trigger p1f_fail_coin before insert on private.world_currency_transactions
  for each row execute function public.p1f_fail_coin_v1();
select set_config('test.fail_amount', '10', true);
select throws_ok($$select pg_temp.claim('f1000000-0000-4000-8000-0000000000b2', '2026-09-01')$$,
  'P0001', 'ATTENDANCE_REWARD_FAILED', 'a failing daily reward aborts the claim');
select results_eq($$select pg_temp.rows('f1000000-0000-4000-8000-0000000000b2'), pg_temp.coins('f1000000-0000-4000-8000-0000000000b2'),
    (select count(*) from private.world_reward_transactions where user_id = 'f1000000-0000-4000-8000-0000000000b2')$$,
  $$values (0::bigint, 0::bigint, 0::bigint)$$, 'daily failure: no row, no coin, no reward transaction');
select set_config('test.fail_amount', '0', true);
do $$ begin perform private.world_attendance_claim_v1('f1000000-0000-4000-8000-0000000000b2', '2026-09-01');
  perform private.world_attendance_claim_v1('f1000000-0000-4000-8000-0000000000b2', '2026-09-02'); end $$;
select set_config('test.fail_amount', '30', true);
select throws_ok($$select pg_temp.claim('f1000000-0000-4000-8000-0000000000b2', '2026-09-03')$$,
  'P0001', 'ATTENDANCE_REWARD_FAILED', 'daily SUCCESS + milestone FAILED aborts the whole claim');
select results_eq($$select pg_temp.rows('f1000000-0000-4000-8000-0000000000b2'), pg_temp.coins('f1000000-0000-4000-8000-0000000000b2'),
    (select count(*) from private.world_reward_transactions where user_id = 'f1000000-0000-4000-8000-0000000000b2')$$,
  $$values (2::bigint, 20::bigint, 2::bigint)$$, 'milestone failure: no 3rd row, no 3rd daily, no milestone (still 2 days / 20 coin)');
drop trigger p1f_fail_coin on private.world_currency_transactions;
drop function public.p1f_fail_coin_v1();
select results_eq($$select (s ->> 'attendedDays')::int, jsonb_array_length(s -> 'rewards')
    from (select pg_temp.claim('f1000000-0000-4000-8000-0000000000b2', '2026-09-03') s) x$$,
  $$values (3, 2)$$, 'retry: day 3 with daily + milestone');
select results_eq($$select pg_temp.coins('f1000000-0000-4000-8000-0000000000b2'), pg_temp.tx('f1000000-0000-4000-8000-0000000000b2', 'reward.attendance.daily'),
    pg_temp.tx('f1000000-0000-4000-8000-0000000000b2', 'reward.attendance.monthly_3')$$,
  $$values (60::bigint, 3::bigint, 1::bigint)$$, 'paid exactly once: 3×10 + 30');

-- ---- 29. account isolation ----
select results_eq($$select pg_temp.rows('f1000000-0000-4000-8000-0000000000c3'), pg_temp.coins('f1000000-0000-4000-8000-0000000000c3')$$,
  $$values (0::bigint, 0::bigint)$$, 'C untouched by A, B and D');
select is((private.world_attendance_state_v1('f1000000-0000-4000-8000-0000000000c3', '2026-09-15') ->> 'attendedDays')::int, 0,
  'C sees none of the other accounts'' days');

-- ---- 30. direct abuse ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.world_reward_grant_v1('f1000000-0000-4000-8000-0000000000c3', 'reward.attendance.monthly_21', 'SYSTEM',
    'attendance.monthly.21', 'attendance:monthly:f1000000-0000-4000-8000-0000000000c3:2026-09:21')$$, '42501', null, 'player cannot run the Reward RPC');
select throws_ok($$select private.world_attendance_claim_v1('f1000000-0000-4000-8000-0000000000c3', '2026-09-01')$$, '42501', null,
  'player cannot call the dated private claim');
select throws_ok($$insert into private.world_attendance_days(user_id, attendance_date, daily_reward_transaction_id)
    values ('f1000000-0000-4000-8000-0000000000c3', current_date, gen_random_uuid())$$, '42501', null, 'player cannot write attendance rows');
reset role;

-- ---- 4. account deletion cascades ----
delete from auth.users where id = 'f1000000-0000-4000-8000-0000000000a1';
select is((select count(*) from private.world_attendance_days where user_id = 'f1000000-0000-4000-8000-0000000000a1'), 0::bigint,
  'deleting the account removes all its attendance rows');

select * from finish();
rollback;
