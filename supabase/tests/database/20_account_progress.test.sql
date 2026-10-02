-- Shared cloud progress contract (get_my_game_progress / save_my_game_progress), used by Classic
-- ('inha-duck'), InduckUp ('induckup') and Survival ('inha-duck-survival'). Callers are emulated
-- with local JWT claims (request.jwt.claims), exactly what PostgREST sets; no real users.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

\set user_a '''a1a1a1a1-0000-4000-8000-000000000001'''
\set user_b '''b2b2b2b2-0000-4000-8000-000000000002'''
\set guest '''c3c3c3c3-0000-4000-8000-000000000003'''
\set claims_a '''{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}'''
\set claims_b '''{"sub":"b2b2b2b2-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}'''
\set claims_guest '''{"sub":"c3c3c3c3-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}'''
\set claims_a_no_flag '''{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated"}'''

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous) values
  (:user_a, 'authenticated', 'authenticated', 'a@example.test', now(), false),
  (:user_b, 'authenticated', 'authenticated', 'b@example.test', now(), false),
  (:guest, 'authenticated', 'authenticated', null, null, true);

-- ---- no session / guest ----
set local role anon;
select throws_ok($$select * from public.get_my_game_progress('induckup')$$, '42501', null,
  'anon (no session) cannot read cloud progress');
select throws_ok($$select public.save_my_game_progress('induckup', '{}'::jsonb)$$, '42501', null,
  'anon (no session) cannot save cloud progress');
select throws_ok($$select * from public.user_game_progress$$, '42501', null, 'anon cannot read the table');
reset role;

set local role authenticated;
set local request.jwt.claims = :claims_guest;
select throws_ok($$select * from public.get_my_game_progress('induckup')$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED',
  'anonymous (guest) accounts keep progress local: read refused');
select throws_ok($$select public.save_my_game_progress('induckup', '{"wave":1}'::jsonb)$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED',
  'anonymous (guest) accounts keep progress local: save refused');
select is(public.is_permanent_account(), false, 'guest is not a permanent account');
set local request.jwt.claims = :claims_a_no_flag;
select throws_ok($$select * from public.get_my_game_progress('induckup')$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED',
  'a token without is_anonymous is treated as a guest (fail closed)');
reset role;

-- ---- save then read ----
set local role authenticated;
set local request.jwt.claims = :claims_a;
select is(public.is_permanent_account(), true, 'user A is a permanent account');
select is(public.save_my_game_progress('induckup', '{"wave":3,"coins":10}'::jsonb, 2, true) - 'updated_at',
  '{"game_slug":"induckup","schema_version":2,"migrated_from_local":true}'::jsonb,
  'save returns the stored metadata');
select results_eq($$select progress, schema_version, migrated_from_local from public.get_my_game_progress('induckup')$$,
  $$values ('{"wave":3,"coins":10}'::jsonb, 2, true)$$, 'read returns what was saved');
select lives_ok($$select public.save_my_game_progress('inha-duck', '{"stage":5}'::jsonb)$$, 'Classic slug saves');
select lives_ok($$select public.save_my_game_progress('inha-duck-survival', '{"day":2}'::jsonb)$$, 'Survival slug saves');
select is_empty($$select * from public.get_my_game_progress('no-such-game')$$, 'reading an unknown game returns no row');

-- ---- update semantics: last write wins; migrated_from_local only turns on ----
select lives_ok($$select public.save_my_game_progress('induckup', '{"wave":1}'::jsonb, 1, false)$$, 'an older snapshot can be saved');
select results_eq($$select progress, schema_version, migrated_from_local from public.get_my_game_progress('induckup')$$,
  $$values ('{"wave":1}'::jsonb, 1, true)$$,
  'save replaces progress (no server-side merge or max); migrated_from_local stays true');
reset role;

-- ---- isolation between accounts ----
set local role authenticated;
set local request.jwt.claims = :claims_b;
select is_empty($$select * from public.get_my_game_progress('induckup')$$, 'user B cannot read user A''s progress');
select lives_ok($$select public.save_my_game_progress('induckup', '{"wave":99}'::jsonb)$$, 'user B saves own progress');
select is((select count(*)::int from public.user_game_progress), 1, 'RLS: user B sees only own rows in the table');
select throws_ok(
  $$insert into public.user_game_progress(user_id, game_id, progress)
    values ('a1a1a1a1-0000-4000-8000-000000000001', (select id from public.games where slug = 'inha-duck'), '{"hacked":true}')$$,
  '42501', null, 'user B cannot insert a row for user A');
select is_empty($$update public.user_game_progress set progress = '{"hacked":true}'
  where user_id = 'a1a1a1a1-0000-4000-8000-000000000001' returning 1$$, 'user B cannot update user A''s row');
select throws_ok($$delete from public.user_game_progress$$, '42501', null, 'progress rows cannot be deleted by clients');
set local request.jwt.claims = :claims_a;
select results_eq($$select progress from public.get_my_game_progress('induckup')$$, $$values ('{"wave":1}'::jsonb)$$,
  'user A''s progress is unchanged by user B');
reset role;

-- ---- malformed input ----
set local role authenticated;
set local request.jwt.claims = :claims_a;
select throws_ok($$select public.save_my_game_progress('no-such-game', '{}'::jsonb)$$, '22023', 'UNKNOWN_GAME', 'unknown game');
select throws_ok($$select public.save_my_game_progress('', '{}'::jsonb)$$, '22023', 'INVALID_GAME_SLUG', 'empty slug');
select throws_ok($$select public.save_my_game_progress(repeat('x', 81), '{}'::jsonb)$$, '22023', 'INVALID_GAME_SLUG', 'slug over 80 chars');
select throws_ok($$select public.save_my_game_progress(null, '{}'::jsonb)$$, '22023', 'INVALID_GAME_SLUG', 'null slug');
select throws_ok($$select public.save_my_game_progress('induckup', '[1,2]'::jsonb)$$, '22023', 'PROGRESS_MUST_BE_OBJECT', 'array progress');
select throws_ok($$select public.save_my_game_progress('induckup', '"x"'::jsonb)$$, '22023', 'PROGRESS_MUST_BE_OBJECT', 'string progress');
select throws_ok($$select public.save_my_game_progress('induckup', null)$$, '22023', 'PROGRESS_MUST_BE_OBJECT', 'null progress');
select throws_ok($$select public.save_my_game_progress('induckup', '{}'::jsonb, 0)$$, '22023', 'INVALID_SCHEMA_VERSION', 'schema version 0');
select throws_ok($$select public.save_my_game_progress('induckup', jsonb_build_object('blob', repeat(md5(random()::text), 5000)))$$,
  '22023', 'PROGRESS_TOO_LARGE', 'progress over 128 KiB');
select results_eq($$select progress from public.get_my_game_progress('induckup')$$, $$values ('{"wave":1}'::jsonb)$$,
  'rejected saves change nothing');
reset role;

select * from finish();
rollback;
