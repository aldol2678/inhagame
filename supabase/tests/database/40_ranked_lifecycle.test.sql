-- Ranked run lifecycle contract: the server functions behind ranked-run-start / ranked-run-finish
-- and Classic's abandon call. Sessions are written only by the Edge Functions (service role);
-- players can abandon only their own open run.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

\set player '''e1000000-0000-4000-8000-000000000001'''
\set rival '''e2000000-0000-4000-8000-000000000002'''
\set run_open '''f1000000-0000-4000-8000-000000000001'''
\set run_stale '''f2000000-0000-4000-8000-000000000002'''
\set run_rival '''f3000000-0000-4000-8000-000000000003'''
\set run_done '''f4000000-0000-4000-8000-000000000004'''
\set claims_player '''{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}'''
\set claims_rival '''{"sub":"e2000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}'''

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous) values
  (:player, 'authenticated', 'authenticated', 'player@example.test', now(), false),
  (:rival, 'authenticated', 'authenticated', 'rival@example.test', now(), false);
insert into public.ranked_sessions (run_id, user_id, started_at, expires_at, status) values
  (:run_open, :player, now(), now() + interval '5 minutes', 'started'),
  (:run_stale, :player, now() - interval '10 minutes', now() - interval '5 minutes', 'started'),
  (:run_rival, :rival, now(), now() + interval '5 minutes', 'started'),
  (:run_done, :player, now() - interval '3 minutes', now() + interval '2 minutes', 'accepted');

select ok((select nonce is not null and expires_at > started_at from public.ranked_sessions where run_id = :run_open),
  'sessions get a nonce and an expiry');

-- ---- direct access ----
set local role authenticated;
set local request.jwt.claims = :claims_player;
select throws_ok(format('insert into public.ranked_sessions (user_id) values (%L)', :player), '42501', null,
  'players cannot create ranked sessions directly (ranked-run-start does, as service role)');
select throws_ok(format('update public.ranked_sessions set status = %L where run_id = %L', 'accepted', :run_open), '42501', null,
  'players cannot change a session status directly');
select is(
  array(select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname ~ '^record_ranked_result'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  array[]::text[], 'ranked results can only be recorded by the service role');

-- ---- abandon ----
select is(public.abandon_ranked_session_v1(:run_rival), null, 'abandoning another player''s run does nothing');
select is(public.abandon_ranked_session_v1(:run_open), 'abandoned', 'a player abandons their own open run');
select is(public.abandon_ranked_session_v1(:run_open), 'abandoned', 'abandoning again reports the stored status');
select is(public.abandon_ranked_session_v1(:run_stale), 'expired', 'an overdue run becomes expired, not abandoned');
select is(public.abandon_ranked_session_v1(:run_done), 'accepted', 'a finished run is not reopened or abandoned');
reset role;
select is((select status from public.ranked_sessions where run_id = :run_rival), 'started', 'the rival run is untouched');
set local role anon;
select throws_ok(format('select public.abandon_ranked_session_v1(%L)', :run_rival), '42501', null,
  'anon cannot abandon runs');
select throws_ok($$select public.expire_ranked_sessions_v1()$$, '42501', null, 'anon cannot run lifecycle cleanup');
reset role;

-- ---- profiles: players edit their nickname/department, never the ban flag ----
insert into public.profiles (user_id, nickname, is_banned) values (:player, 'duck', true), (:rival, 'rival', false);
set local role authenticated;
set local request.jwt.claims = :claims_player;
select throws_ok(format('update public.profiles set is_banned = false where user_id = %L', :player), '42501', null,
  'a banned player cannot lift their own ban');
select throws_ok(format('insert into public.profiles (user_id, nickname, is_banned) values (%L, %L, false)', :rival, 'x'), '42501', null,
  'players cannot write the ban flag on insert');
select is_empty(format('update public.profiles set nickname = %L where user_id = %L returning 1', 'hacked', :rival),
  'players cannot rename another player');
reset role;
select is((select nickname from public.profiles where user_id = :rival), 'rival', 'the rival profile is unchanged');

-- ---- cleanup (service role, called by ranked-run-start) ----
update public.ranked_sessions set status = 'started', expired_at = null, finished_at = null where run_id = :run_stale;
set local role service_role;
select cmp_ok(public.expire_ranked_sessions_v1(), '>=', 1, 'overdue sessions are expired');
reset role;
select results_eq(format('select status, expired_at = expires_at from public.ranked_sessions where run_id = %L', :run_stale),
  $$values ('expired'::text, true)$$, 'expired_at is the session''s own expiry');
select is((select status from public.ranked_sessions where run_id = :run_rival), 'started', 'open sessions are left alone');

select * from finish();
rollback;
