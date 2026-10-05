-- Progression / Economy P1e: Campus Daily Quiz. One server-owned session per account per Asia/Seoul
-- day; 3 questions, 2+ correct = PASSED and reward.daily.campus_quiz (+50 인덕코인, +25 EXP) in the
-- same transaction as the last answer. Concurrent starts / answers through PostgREST live in
-- supabase/tests/integration/daily-quiz.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('e1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'p1e-a@example.test', now(), false),
 ('e1000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'p1e-b@example.test', now(), false),
 ('e1000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'p1e-c@example.test', now(), false),
 ('e1000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'p1e-d@example.test', now(), false),
 ('e1000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', null, now(), true),
 ('e1000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'p1e-f@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('e1000000-0000-4000-8000-0000000000a1', '퀴즈A', false),
 ('e1000000-0000-4000-8000-0000000000b2', '퀴즈B', false),
 ('e1000000-0000-4000-8000-0000000000c3', '퀴즈C', false),
 ('e1000000-0000-4000-8000-0000000000d4', '퀴즈D', false),
 ('e1000000-0000-4000-8000-0000000000e5', '퀴즈E', false),
 ('e1000000-0000-4000-8000-0000000000f6', '퀴즈F', true);

-- Run one player RPC as that account (authenticated role + JWT claims), then return to postgres.
create function pg_temp.as_player(p uuid, q text, p_anonymous boolean default false) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated',
    'is_anonymous', p_anonymous)::text, true);
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
create function pg_temp.start(p uuid) returns jsonb language sql as $f$
  select pg_temp.as_player(p, 'select public.start_my_world_daily_quiz_v1()');
$f$;
create function pg_temp.state(p uuid) returns jsonb language sql as $f$
  select pg_temp.as_player(p, 'select public.get_my_world_daily_quiz_v1()');
$f$;
create function pg_temp.answer(p uuid, r uuid, qid text, i int) returns jsonb language sql as $f$
  select pg_temp.as_player(p, format('select public.answer_my_world_daily_quiz_v1(%L::uuid, %L, %s::smallint)', r, qid, i));
$f$;
create function pg_temp.correct(qid text) returns int language sql as $f$
  select correct_index::int from private.world_daily_quiz_questions where question_id = qid;
$f$;
create function pg_temp.wrong(qid text) returns int language sql as $f$
  select ((correct_index + 1) % 4)::int from private.world_daily_quiz_questions where question_id = qid;
$f$;
-- Answer the current question of p's run right (true) or wrong (false).
create function pg_temp.reply(p uuid, ok boolean) returns jsonb language plpgsql as $f$
declare s jsonb := pg_temp.state(p);
begin
  return pg_temp.answer(p, (s ->> 'runId')::uuid, s -> 'question' ->> 'questionId',
    case when ok then pg_temp.correct(s -> 'question' ->> 'questionId') else pg_temp.wrong(s -> 'question' ->> 'questionId') end);
end;
$f$;
create function pg_temp.prog(p uuid) returns text language sql as $f$
  select (s ->> 'totalExp') || '/Lv.' || (s ->> 'level') from (select private.world_progression_snapshot_v1(p) s) x;
$f$;
create function pg_temp.coins(p uuid) returns bigint language sql as $f$
  select coalesce((select w.balance from private.world_wallets w where w.user_id = p and w.currency_id = 'currency.induck_coin'), 0);
$f$;
create function pg_temp.n(t regclass, p uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  execute format('select count(*) from %s where user_id = $1', t) into v using p;
  return v;
end;
$f$;
create function pg_temp.quiztx(p uuid) returns bigint language sql as $f$
  select count(*) from private.world_reward_transactions t where t.user_id = p and t.reward_id = 'reward.daily.campus_quiz';
$f$;
-- Onboarding fixture: 200 EXP (First Campus + Main2), Lv.2.
do $$ begin perform private.world_exp_apply_v1('e1000000-0000-4000-8000-0000000000a1', 200, 'qa', 'p1e.fixture', 'p1e:fixture:a1'); end $$;

-- ---- question bank ----
select is((select count(*) from private.world_daily_quiz_questions), 100::bigint, '100 questions in the bank');
select is((select count(*) from private.world_daily_quiz_questions where status = 'ACTIVE'), 100::bigint, 'all 100 questions are ACTIVE');
select results_eq($$select category, count(*) from private.world_daily_quiz_questions
    where category in ('major', 'general', 'inha') group by category order by category$$,
  $$values ('general'::text, 8::bigint), ('inha', 2), ('major', 74)$$,
  'knowledge expansion: 74 major + 8 general + 2 INHA questions');
select results_eq($$select min(position), max(position), count(distinct position) from private.world_daily_quiz_questions$$,
  $$values (1::int, 100::int, 100::bigint)$$, 'question positions are contiguous 1..100');
select results_eq($$
  with expected(department) as (values ('기계공학과'::text), ('항공우주공학과'::text), ('조선해양공학과'::text), ('산업경영공학과'::text), ('화학공학과'::text), ('고분자공학과'::text), ('신소재공학과'::text), ('사회인프라공학과'::text), ('환경공학과'::text), ('공간정보공학과'::text), ('건축학부'::text), ('에너지자원공학과'::text), ('전기전자공학부'::text), ('반도체시스템공학과'::text), ('이차전지융합학과'::text), ('수학과'::text), ('통계학과'::text), ('물리학과'::text), ('화학과'::text), ('해양과학과'::text), ('식품영양학과'::text), ('경영학과'::text), ('파이낸스경영학과'::text), ('아태물류학부'::text), ('국제통상학과'::text), ('국어교육과'::text), ('영어교육과'::text), ('사회교육과'::text), ('체육교육과'::text), ('교육학과'::text), ('수학교육과'::text), ('행정학과'::text), ('정치외교학과'::text), ('미디어커뮤니케이션학과'::text), ('경제학과'::text), ('소비자학과'::text), ('아동심리학과'::text), ('사회복지학과'::text), ('한국어문학과'::text), ('사학과'::text), ('철학과'::text), ('중국학과'::text), ('일본언어문화학과'::text), ('영미유럽인문융합학부'::text), ('문화콘텐츠문화경영학과'::text), ('의예과'::text), ('간호학과'::text), ('조형예술학과'::text), ('디자인융합학과'::text), ('스포츠과학과'::text), ('연극영화학과'::text), ('의류디자인학과'::text), ('인공지능공학과'::text), ('데이터사이언스학과'::text), ('스마트모빌리티공학과'::text), ('디자인테크놀로지학과'::text), ('컴퓨터공학과'::text), ('IBT학과'::text), ('ISE학과'::text), ('KLC학과'::text), ('자유전공학부'::text), ('메카트로닉스공학과'::text), ('소프트웨어융합공학과'::text), ('산업경영학과'::text), ('금융투자학과'::text), ('반도체산업융합학과'::text))
  select count(*)::bigint,
         count(*) filter (where not exists (
           select 1 from private.world_daily_quiz_questions q
           where q.category = 'major' and q.prompt like '[' || expected.department || '%'
         ))::bigint
  from expected$$,
  $$values (66::bigint, 0::bigint)$$,
  'all 66 current playable departments have at least one major question');
select is((select count(*) from private.world_daily_quiz_questions where jsonb_array_length(options) <> 4), 0::bigint, 'every question has exactly 4 options');
select is((select count(*) from private.world_daily_quiz_questions where correct_index not between 0 and 3), 0::bigint, 'correct_index is 0..3');
select is((select count(distinct correct_index) from private.world_daily_quiz_questions), 4::bigint, 'correct answers are spread over all four positions');
select ok(not has_table_privilege('authenticated', 'private.world_daily_quiz_questions', 'select')
  and not has_table_privilege('anon', 'private.world_daily_quiz_questions', 'select'), 'players cannot SELECT the question bank');
select ok(not has_table_privilege('authenticated', 'private.world_daily_quiz_runs', 'select')
  and not has_table_privilege('authenticated', 'private.world_daily_quiz_answers', 'select')
  and not has_table_privilege('authenticated', 'private.world_daily_quiz_runs', 'insert'), 'players cannot read or write runs / answers');
select ok(not has_function_privilege('anon', 'public.start_my_world_daily_quiz_v1()', 'execute')
  and not has_function_privilege('anon', 'public.answer_my_world_daily_quiz_v1(uuid,text,smallint)', 'execute'), 'guests cannot call the quiz RPCs');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%daily_quiz%'
    and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a where a ~ '(date|day|now|time|user)')), 0::bigint,
  'no public quiz RPC takes a date, time or user argument');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select throws_ok($$select * from private.world_daily_quiz_questions$$, '42501', null, 'authenticated SELECT on the bank is denied');
reset role;

-- ---- 5-8. RewardDefinition ----
select results_eq($$select d.status, d.version, d.event_id, d.tags, d.description
    from private.world_reward_definitions d where d.reward_id = 'reward.daily.campus_quiz'$$,
  $$values ('ACTIVE'::text, 1, null::text, array['daily', 'minigame', 'quiz']::text[], '캠퍼스 데일리 퀴즈 완료 보상'::text)$$,
  'reward.daily.campus_quiz ACTIVE v1');
select results_eq($$select g.position, g.grant_entry_id, g.grant_type, g.target_id, g.amount
    from private.world_reward_grants g where g.reward_id = 'reward.daily.campus_quiz' order by g.position$$,
  $$values (0::smallint, 'currency.induck_coin'::text, 'CURRENCY'::text, 'currency.induck_coin'::text, 50::bigint),
           (1::smallint, 'exp.campus', 'EXP', 'exp.campus', 25)$$,
  'grants: +50 인덕코인, +25 EXP, no item');

-- ---- KST day boundary (DB clock only) ----
select results_eq($$select private.world_daily_quiz_today_v1('2026-09-29 14:59:59+00'), private.world_daily_quiz_today_v1('2026-09-29 15:00:00+00'),
    private.world_daily_quiz_today_v1('2026-09-29 23:59:59+09'), private.world_daily_quiz_today_v1('2026-09-30 00:00:00+09')$$,
  $$values ('2026-09-29'::date, '2026-09-30'::date, '2026-09-29'::date, '2026-09-30'::date)$$,
  'the day turns at 00:00 Asia/Seoul (15:00 UTC)');

-- ---- 9-11. accounts ----
select throws_ok($$select pg_temp.as_player('e1000000-0000-4000-8000-0000000000e5', 'select public.start_my_world_daily_quiz_v1()', true)$$,
  '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous account refused');
select throws_ok($$select pg_temp.as_player('e1000000-0000-4000-8000-0000000000f6', 'select public.start_my_world_daily_quiz_v1()')$$,
  '42501', 'ACCOUNT_UNAVAILABLE', 'banned account refused');
select is(pg_temp.state('e1000000-0000-4000-8000-0000000000a1') ->> 'status', 'AVAILABLE', 'permanent account: AVAILABLE before start');
select results_eq($$select s -> 'rewardPreview' from (select pg_temp.state('e1000000-0000-4000-8000-0000000000a1') s) x$$,
  $$values ('[{"amount": 50, "targetId": "currency.induck_coin", "grantType": "CURRENCY"}, {"amount": 25, "targetId": "exp.campus", "grantType": "EXP"}]'::jsonb)$$,
  'the reward preview comes from the server definition');
select is(pg_temp.n('private.world_daily_quiz_runs', 'e1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'reading the state creates no run');

-- ---- 12-14. start ----
select set_config('test.a_start', pg_temp.start('e1000000-0000-4000-8000-0000000000a1')::text, true);
select results_eq($$select s ->> 'status', s ->> 'rewardDate', (s -> 'progress')::text, (s -> 'question' ->> 'index')::int,
    jsonb_array_length(s -> 'question' -> 'options')
    from (select current_setting('test.a_start')::jsonb s) x$$,
  $$values ('ACTIVE'::text, to_char(private.world_daily_quiz_today_v1(), 'YYYY-MM-DD'),
            '{"total": 3, "correct": 0, "answered": 0}'::text, 0, 4)$$,
  'start: ACTIVE, today (KST), question 1 of 3 with 4 options');
select is((select cardinality(question_ids) = 3 and (select count(distinct x) from unnest(question_ids) x) = 3
    and question_ids <@ (select array_agg(question_id) from private.world_daily_quiz_questions where status = 'ACTIVE')
    from private.world_daily_quiz_runs where user_id = 'e1000000-0000-4000-8000-0000000000a1'), true, '3 distinct ACTIVE questions');
select is(pg_temp.start('e1000000-0000-4000-8000-0000000000a1') ->> 'runId', current_setting('test.a_start')::jsonb ->> 'runId',
  'a second start the same day returns the same run');
select is(pg_temp.n('private.world_daily_quiz_runs', 'e1000000-0000-4000-8000-0000000000a1'), 1::bigint, 'one run per day');
select ok(current_setting('test.a_start') !~ '(correctIndex|correct_index)', 'no correct answer in the start response');

-- ---- 17-19. answer validation ----
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, 'quiz.campus.nope', 0)$$,
    current_setting('test.a_start')::jsonb ->> 'runId'), 'P0001', 'QUIZ_QUESTION_MISMATCH', 'wrong question refused');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, %L, 4)$$,
    current_setting('test.a_start')::jsonb ->> 'runId', current_setting('test.a_start')::jsonb -> 'question' ->> 'questionId'),
  '22023', 'INVALID_ANSWER', 'answer index outside 0..3 refused');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000b2', %L, %L, 0)$$,
    current_setting('test.a_start')::jsonb ->> 'runId', current_setting('test.a_start')::jsonb -> 'question' ->> 'questionId'),
  'P0001', 'QUIZ_RUN_NOT_FOUND', 'another account cannot answer this run');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, 'quiz.campus.currency_name', 0)$$,
    gen_random_uuid()), 'P0001', 'QUIZ_RUN_NOT_FOUND', 'unknown run refused');

-- ---- 15-16. correct / wrong answers ----
select set_config('test.a1', pg_temp.reply('e1000000-0000-4000-8000-0000000000a1', true)::text, true);
select results_eq($$select s ->> 'status', (s -> 'lastAnswer' ->> 'correct')::boolean, (s -> 'progress' ->> 'answered')::int,
    (s -> 'progress' ->> 'correct')::int, (s -> 'question' ->> 'index')::int, s ? 'reward'
    from (select current_setting('test.a1')::jsonb s) x$$,
  $$values ('ACTIVE'::text, true, 1, 1, 1, false)$$, 'correct answer: 1/1, next question, no reward yet');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, %L, 0)$$,
    current_setting('test.a_start')::jsonb ->> 'runId', current_setting('test.a_start')::jsonb -> 'question' ->> 'questionId'),
  'P0001', 'QUIZ_ALREADY_ANSWERED', 'the same question cannot be answered again');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, %L, 3)$$,
    current_setting('test.a_start')::jsonb ->> 'runId', current_setting('test.a_start')::jsonb -> 'question' ->> 'questionId'),
  'P0001', 'QUIZ_ALREADY_ANSWERED', 'changing the answer index does not reopen a question');
select set_config('test.a2', pg_temp.reply('e1000000-0000-4000-8000-0000000000a1', false)::text, true);
select results_eq($$select (s -> 'lastAnswer' ->> 'correct')::boolean, (s -> 'progress' ->> 'answered')::int, (s -> 'progress' ->> 'correct')::int
    from (select current_setting('test.a2')::jsonb s) x$$,
  $$values (false, 2, 1)$$, 'wrong answer: 2 answered, 1 correct');
select is((select count(*) from private.world_daily_quiz_answers a join private.world_daily_quiz_runs r using (run_id)
    where r.user_id = 'e1000000-0000-4000-8000-0000000000a1'), 2::bigint, 'one answer row per answered question');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000a1'), pg_temp.prog('e1000000-0000-4000-8000-0000000000a1'),
    pg_temp.quiztx('e1000000-0000-4000-8000-0000000000a1')$$,
  $$values (0::bigint, '200/Lv.2'::text, 0::bigint)$$, 'nothing granted before the last answer');

-- ---- 20-22, 28-30. 2/3 correct → PASSED + reward in the same transaction ----
select set_config('test.a3', pg_temp.reply('e1000000-0000-4000-8000-0000000000a1', true)::text, true);
select results_eq($$select s ->> 'status', (s -> 'progress' ->> 'correct')::int, s ? 'question', s -> 'reward' ->> 'rewardId',
    s -> 'reward' ->> 'status', (s -> 'reward' ->> 'replayed')::boolean
    from (select current_setting('test.a3')::jsonb s) x$$,
  $$values ('PASSED'::text, 2, false, 'reward.daily.campus_quiz'::text, 'SUCCESS'::text, false)$$,
  '2/3 correct: PASSED with a fresh reward');
select results_eq($$select e ->> 'grantType', e ->> 'targetId', (e ->> 'granted')::bigint, e ->> 'status'
    from jsonb_array_elements(current_setting('test.a3')::jsonb -> 'reward' -> 'entries') e$$,
  $$values ('CURRENCY'::text, 'currency.induck_coin'::text, 50::bigint, 'GRANTED'::text), ('EXP', 'exp.campus', 25, 'GRANTED')$$,
  'entries: +50 인덕코인, +25 EXP');
select ok(not (current_setting('test.a3')::jsonb -> 'reward' ?| array['userId', 'idempotencyKey', 'sourceId', 'attempts'])
  and not exists (select 1 from jsonb_array_elements(current_setting('test.a3')::jsonb -> 'reward' -> 'entries') e
                   where e ?| array['childIdempotencyKey', 'childTransactionId', 'grantEntryId'])
  and current_setting('test.a3') !~ '(correctIndex|correct_index)', 'no server-only fields or correct answers in the response');
select is(pg_temp.coins('e1000000-0000-4000-8000-0000000000a1'), 50::bigint, 'wallet 0 → 50');
select is(pg_temp.prog('e1000000-0000-4000-8000-0000000000a1'), '225/Lv.2', 'progression 200 → 225, still Lv.2');
select results_eq($$select t.idempotency_key, t.source_type, t.source_id, t.reward_version, t.status
    from private.world_reward_transactions t
   where t.user_id = 'e1000000-0000-4000-8000-0000000000a1' and t.reward_id = 'reward.daily.campus_quiz'$$,
  $$values ('daily:campus_quiz:e1000000-0000-4000-8000-0000000000a1:' || to_char(private.world_daily_quiz_today_v1(), 'YYYY-MM-DD'),
            'MINIGAME'::text, 'daily.campus_quiz'::text, 1, 'SUCCESS'::text)$$,
  'one RewardTransaction: stable key with the DB KST date, source MINIGAME / daily.campus_quiz');
select is(pg_temp.n('private.world_currency_transactions', 'e1000000-0000-4000-8000-0000000000a1'), 1::bigint, 'one currency ledger row');
select is((select count(*) from private.world_exp_transactions where user_id = 'e1000000-0000-4000-8000-0000000000a1' and source_type = 'reward'), 1::bigint,
  'one reward EXP ledger row');
select is((select reward_transaction_id::text from private.world_daily_quiz_runs where user_id = 'e1000000-0000-4000-8000-0000000000a1'),
  current_setting('test.a3')::jsonb -> 'reward' ->> 'rewardTransactionId', 'the run records its reward transaction');

-- ---- 25. replay / duplicate after PASSED: no reward, no new run ----
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, %L, 0)$$,
    current_setting('test.a_start')::jsonb ->> 'runId', (select question_ids[3] from private.world_daily_quiz_runs where user_id = 'e1000000-0000-4000-8000-0000000000a1')),
  'P0001', 'QUIZ_ALREADY_ANSWERED', 'a repeated final answer is refused');
select results_eq($$select s ->> 'status', s ? 'reward', s ? 'question' from (select pg_temp.start('e1000000-0000-4000-8000-0000000000a1') s) x$$,
  $$values ('PASSED'::text, false, false)$$, 'start after PASSED: same PASSED run, no reward, no question');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000a1'), pg_temp.prog('e1000000-0000-4000-8000-0000000000a1'),
    pg_temp.quiztx('e1000000-0000-4000-8000-0000000000a1'), pg_temp.n('private.world_daily_quiz_runs', 'e1000000-0000-4000-8000-0000000000a1')$$,
  $$values (50::bigint, '225/Lv.2'::text, 1::bigint, 1::bigint)$$, 'replay: coin +0, EXP +0, one run');

-- ---- defence in depth: even a second run for the same KST date cannot pay twice (the key has the date) ----
update private.world_daily_quiz_runs set reward_date = reward_date - 1 where user_id = 'e1000000-0000-4000-8000-0000000000a1';
select set_config('test.a_again', pg_temp.start('e1000000-0000-4000-8000-0000000000a1')::text, true);
select isnt(current_setting('test.a_again')::jsonb ->> 'runId', current_setting('test.a_start')::jsonb ->> 'runId', 'a second run exists for today');
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000a1', true); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000a1', true); end $$;
select results_eq($$select s -> 'reward' ->> 'status', (s -> 'reward' ->> 'replayed')::boolean
    from (select pg_temp.reply('e1000000-0000-4000-8000-0000000000a1', true) s) x$$,
  $$values ('SUCCESS'::text, true)$$, 'its PASS replays the stored reward for the same date key');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000a1'), pg_temp.prog('e1000000-0000-4000-8000-0000000000a1'),
    pg_temp.quiztx('e1000000-0000-4000-8000-0000000000a1')$$,
  $$values (50::bigint, '225/Lv.2'::text, 1::bigint)$$, 'no second payment on the same KST date');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000a1', %L, 'quiz.campus.currency_name', 0)$$,
    current_setting('test.a_start')::jsonb ->> 'runId'), 'P0001', 'QUIZ_RUN_EXPIRED', 'a run dated another day cannot be answered');

-- ---- 23-24. 1/3 correct → FAILED, no reward call, no retry ----
do $$ begin perform pg_temp.start('e1000000-0000-4000-8000-0000000000b2'); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000b2', true); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000b2', false); end $$;
select set_config('test.b3', pg_temp.reply('e1000000-0000-4000-8000-0000000000b2', false)::text, true);
select results_eq($$select s ->> 'status', (s -> 'progress' ->> 'correct')::int, s ? 'reward', s ? 'question'
    from (select current_setting('test.b3')::jsonb s) x$$,
  $$values ('FAILED'::text, 1, false, false)$$, '1/3 correct: FAILED, no reward');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000b2'), pg_temp.prog('e1000000-0000-4000-8000-0000000000b2'),
    (select count(*) from private.world_reward_transactions where user_id = 'e1000000-0000-4000-8000-0000000000b2')$$,
  $$values (0::bigint, '0/Lv.1'::text, 0::bigint)$$, 'FAILED: coin 0, EXP 0, no RewardTransaction at all');
select is(pg_temp.start('e1000000-0000-4000-8000-0000000000b2') ->> 'status', 'FAILED', 'no new run the same day after FAILED');
select is(pg_temp.n('private.world_daily_quiz_runs', 'e1000000-0000-4000-8000-0000000000b2'), 1::bigint, 'still one run');

-- ---- 19. isolation: B's play did not touch A, and A's runs are not B's ----
select is(pg_temp.state('e1000000-0000-4000-8000-0000000000d4') ->> 'status', 'AVAILABLE', 'D untouched by A and B');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000d4'), pg_temp.prog('e1000000-0000-4000-8000-0000000000d4')$$,
  $$values (0::bigint, '0/Lv.1'::text)$$, 'D wallet / EXP untouched');

-- ---- a new KST day: yesterday's run neither blocks nor answers today ----
insert into private.world_daily_quiz_runs (user_id, reward_date, question_ids)
values ('e1000000-0000-4000-8000-0000000000d4', private.world_daily_quiz_today_v1() - 1,
        array['quiz.campus.currency_name', 'quiz.campus.interact_key', 'quiz.campus.emote_key']);
select is(pg_temp.state('e1000000-0000-4000-8000-0000000000d4') ->> 'status', 'AVAILABLE', 'yesterday''s unfinished run does not block today');
select throws_ok(format($$select pg_temp.answer('e1000000-0000-4000-8000-0000000000d4', %L, 'quiz.campus.currency_name', 0)$$,
    (select run_id from private.world_daily_quiz_runs where user_id = 'e1000000-0000-4000-8000-0000000000d4')),
  'P0001', 'QUIZ_RUN_EXPIRED', 'yesterday''s run cannot be answered today');
do $$ begin perform pg_temp.start('e1000000-0000-4000-8000-0000000000d4'); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000d4', true); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000d4', false); end $$;
select results_eq($$select s ->> 'status', s -> 'reward' ->> 'status', (s -> 'reward' ->> 'replayed')::boolean
    from (select pg_temp.reply('e1000000-0000-4000-8000-0000000000d4', true) s) x$$,
  $$values ('PASSED'::text, 'SUCCESS'::text, false)$$, 'today''s run passes with a fresh reward');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000d4'), pg_temp.prog('e1000000-0000-4000-8000-0000000000d4'),
    pg_temp.n('private.world_daily_quiz_runs', 'e1000000-0000-4000-8000-0000000000d4')$$,
  $$values (50::bigint, '25/Lv.1'::text, 2::bigint)$$, 'D: +50 coin, +25 EXP; one run per day');

-- ---- 26-27. reward failure rolls the final answer and PASSED back; the retry succeeds once ----
do $$ begin perform pg_temp.start('e1000000-0000-4000-8000-0000000000c3'); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000c3', true); end $$;
do $$ begin perform pg_temp.reply('e1000000-0000-4000-8000-0000000000c3', true); end $$;
create function public.p1e_fail_coin_v1() returns trigger language plpgsql as $f$
begin
  if new.user_id = 'e1000000-0000-4000-8000-0000000000c3' then raise exception 'P1E_TEST_WALLET_DOWN'; end if;
  return new;
end;
$f$;
create trigger p1e_fail_coin before insert on private.world_currency_transactions
  for each row execute function public.p1e_fail_coin_v1();
select throws_ok($$select pg_temp.reply('e1000000-0000-4000-8000-0000000000c3', true)$$,
  'P0001', 'QUIZ_REWARD_FAILED', 'a failing reward child aborts the final answer');
select results_eq($$select s ->> 'status', (s -> 'progress' ->> 'answered')::int, (s -> 'question' ->> 'index')::int
    from (select pg_temp.state('e1000000-0000-4000-8000-0000000000c3') s) x$$,
  $$values ('ACTIVE'::text, 2, 2)$$, 'the run is still ACTIVE with question 3 open');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000c3'), pg_temp.prog('e1000000-0000-4000-8000-0000000000c3'),
    (select count(*) from private.world_reward_transactions where user_id = 'e1000000-0000-4000-8000-0000000000c3'),
    (select count(*) from private.world_daily_quiz_answers a join private.world_daily_quiz_runs r using (run_id) where r.user_id = 'e1000000-0000-4000-8000-0000000000c3')$$,
  $$values (0::bigint, '0/Lv.1'::text, 0::bigint, 2::bigint)$$, 'no coin, EXP, reward row or third answer was kept');
drop trigger p1e_fail_coin on private.world_currency_transactions;
drop function public.p1e_fail_coin_v1();
select results_eq($$select s ->> 'status', s -> 'reward' ->> 'status' from (select pg_temp.reply('e1000000-0000-4000-8000-0000000000c3', true) s) x$$,
  $$values ('PASSED'::text, 'SUCCESS'::text)$$, 'the retry passes with the reward');
select results_eq($$select pg_temp.coins('e1000000-0000-4000-8000-0000000000c3'), pg_temp.prog('e1000000-0000-4000-8000-0000000000c3'),
    pg_temp.quiztx('e1000000-0000-4000-8000-0000000000c3'), pg_temp.n('private.world_currency_transactions', 'e1000000-0000-4000-8000-0000000000c3')$$,
  $$values (50::bigint, '25/Lv.1'::text, 1::bigint, 1::bigint)$$, 'C: +50 coin, +25 EXP exactly once');

-- ---- 31. direct abuse ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.world_reward_grant_v1('e1000000-0000-4000-8000-0000000000d4', 'reward.daily.campus_quiz', 'MINIGAME',
    'daily.campus_quiz', 'daily:campus_quiz:e1000000-0000-4000-8000-0000000000d4:2026-09-29')$$, '42501', null, 'player cannot run the Reward RPC');
select throws_ok($$select private.world_daily_quiz_today_v1()$$, '42501', null, 'player cannot call private quiz helpers');
select throws_ok($$update private.world_daily_quiz_runs set status = 'PASSED'$$, '42501', null, 'player cannot write runs');
reset role;

-- ---- account deletion cascades the quiz rows ----
delete from auth.users where id = 'e1000000-0000-4000-8000-0000000000b2';
select is((select count(*) from private.world_daily_quiz_runs where user_id = 'e1000000-0000-4000-8000-0000000000b2'), 0::bigint,
  'deleting the account removes its runs and answers');
delete from auth.users where id = 'e1000000-0000-4000-8000-0000000000c3';
select is((select count(*) from private.world_daily_quiz_runs where user_id = 'e1000000-0000-4000-8000-0000000000c3'), 0::bigint,
  'a PASSED run is removed together with its reward transaction');

select * from finish();
rollback;
