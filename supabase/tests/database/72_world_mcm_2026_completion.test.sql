-- MCM 2026 P0-E0 (20260927150000): server event window, service-only event progress, server-issued
-- landlord runs, main completion, and the client boundary. No reward is granted anywhere here.
-- Concurrency and cross-connection readback live in
-- supabase/tests/integration/mcm-completion.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a7000000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated', 'mcm-a@example.test', now(), false),
 ('b7000000-0000-4000-8000-0000000000b7', 'authenticated', 'authenticated', 'mcm-b@example.test', now(), false),
 ('c7000000-0000-4000-8000-0000000000c7', 'authenticated', 'authenticated', null, null, true),
 ('d7000000-0000-4000-8000-0000000000d7', 'authenticated', 'authenticated', 'mcm-d@example.test', now(), false),
 ('e7000000-0000-4000-8000-0000000000e7', 'authenticated', 'authenticated', 'mcm-e@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a7000000-0000-4000-8000-0000000000a7', '좀비A', false),
 ('b7000000-0000-4000-8000-0000000000b7', '좀비B', false),
 ('c7000000-0000-4000-8000-0000000000c7', '좀비게스트', false),
 ('d7000000-0000-4000-8000-0000000000d7', '좀비정지', true),
 ('e7000000-0000-4000-8000-0000000000e7', '좀비E', false);

-- ---- A. event window: server time only ----
select results_eq($$select event_id, starts_at, ends_at, is_disabled from private.world_events where event_id = 'event.mcm_2026'$$,
  $$values ('event.mcm_2026'::text, '2026-09-30 00:00:00+09'::timestamptz, '2026-10-01 01:00:00+09'::timestamptz, false)$$,
  'event.mcm_2026 window stored as timestamptz (2026-09-30 00:00 → 2026-10-01 01:00 KST, 20260929231000)');
-- Live phases: PRELUDE/WARNING are client presentation over SCHEDULED; OUTBREAK and ONSITE_LIVE
-- are both ACTIVE (18:00 adds no server rule); ENDED from 01:00.
select results_eq($$select private.world_event_state_v1(e, t::timestamptz) from private.world_events e,
    unnest(array['2026-09-28 12:00:00+09', '2026-09-29 22:59:59+09', '2026-09-29 23:00:00+09',
                 '2026-09-29 23:59:59+09', '2026-09-30 00:00:00+09', '2026-09-30 17:59:59+09',
                 '2026-09-30 18:00:00+09', '2026-10-01 00:59:59+09', '2026-10-01 01:00:00+09']) with ordinality u(t, n)
  where e.event_id = 'event.mcm_2026' order by n$$,
  $$values ('SCHEDULED'::text), ('SCHEDULED'), ('SCHEDULED'), ('SCHEDULED'), ('ACTIVE'), ('ACTIVE'),
           ('ACTIVE'), ('ACTIVE'), ('ENDED')$$,
  'PRELUDE/WARNING stay SCHEDULED; ACTIVE exactly from 00:00:00 through 00:59:59; ENDED at 01:00:00');
select is((select private.world_event_state_v1(e, '2026-09-29 15:00:00Z') from private.world_events e
  where e.event_id = 'event.mcm_2026'), 'ACTIVE', '15:00 UTC on Sep 29 is 00:00 KST: the offset, not a session time zone, decides');
select is((select private.world_event_state_v1(e, '2026-09-30 20:00:00+09') from private.world_events e
  where e.event_id = 'event.mcm_2026'), 'ACTIVE', '20:00 KST on the 30th is inside the window');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('advance_mcm_2026_event_v1', 'get_my_mcm_2026_event_v1', 'start_mcm_landlord_run_v1', 'submit_mcm_landlord_choice_v1')
    and pg_get_function_identity_arguments(p.oid) ~ 'timestamp|p_now|clock'),
  'no public entry point accepts a client time');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'status')->>'eventState',
  case when now() < '2026-09-30 00:00:00+09' then 'SCHEDULED' when now() < '2026-10-01 01:00:00+09' then 'ACTIVE' else 'ENDED' end,
  'the live state is computed from the database clock');
reset role;
-- Before the window (made independent of when CI happens to run).
update private.world_events set starts_at = now() + interval '1 day', ends_at = now() + interval '2 days'
 where event_id = 'event.mcm_2026';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'status')->>'eventState', 'SCHEDULED', 'scheduled');
select throws_ok($$select public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'start')$$,
  'P0001', 'EVENT_NOT_ACTIVE', 'no progress before the window');
reset role;

-- Open the window around the (frozen) transaction time for the rest of this test.
update private.world_events set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
 where event_id = 'event.mcm_2026';

-- ---- security surface ----
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_events'::regclass, 'private.world_event_progress'::regclass,
  'private.world_landlord_runs'::regclass, 'private.world_landlord_first_clears'::regclass)), 'tables have RLS');
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_events', 'private.world_event_progress', 'private.world_landlord_runs',
                  'private.world_landlord_first_clears']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_function_privilege(r, 'public.advance_mcm_2026_event_v1(uuid,text)', 'execute'),
  format('%s cannot advance event progress', r)) from unnest(array['anon', 'authenticated']) r;
select ok(has_function_privilege('service_role', 'public.advance_mcm_2026_event_v1(uuid,text)', 'execute'),
  'only the trusted server advances event progress');
select ok(has_function_privilege('authenticated', f, 'execute'), format('player can execute %s', f))
from unnest(array['public.get_my_mcm_2026_event_v1()', 'public.start_mcm_landlord_run_v1()',
                  'public.submit_mcm_landlord_choice_v1(uuid,text)']) f;
select ok(not has_function_privilege('anon', f, 'execute'), format('guest cannot execute %s', f))
from unnest(array['public.get_my_mcm_2026_event_v1()', 'public.start_mcm_landlord_run_v1()',
                  'public.submit_mcm_landlord_choice_v1(uuid,text)']) f;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7000000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select throws_ok($$select public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'start')$$,
  '42501', null, 'the browser cannot advance its own progress');
select throws_ok($$insert into private.world_event_progress(user_id, event_id, stage, investigated, venue_unlocked_at, completed_at)
  values ('a7000000-0000-4000-8000-0000000000a7', 'event.mcm_2026', 3, array['staggering','dancing','hungry'], now(), now())$$,
  '42501', null, 'the browser cannot write COMPLETED');
select throws_ok($$insert into private.world_landlord_first_clears(user_id, event_id, run_id)
  values ('a7000000-0000-4000-8000-0000000000a7', 'event.mcm_2026', gen_random_uuid())$$, '42501', null, 'the browser cannot forge a clear');
select throws_ok($$select survivor_actor_id from private.world_landlord_runs$$, '42501', null, 'the browser cannot read survivors');
select throws_ok($$update private.world_events set starts_at = now() - interval '10 days'$$, '42501', null, 'the browser cannot move the window');
-- Arbitrary client JSON claiming completion is not an authority.
select lives_ok($$select public.save_my_game_progress('inha-duck',
  '{"events":{"event.mcm_2026":{"status":"COMPLETED","completedAt":"2026-09-30T19:00:00Z"}}}'::jsonb)$$,
  'a client can still save arbitrary game JSON…');
select is(public.get_my_mcm_2026_event_v1()->'progress'->>'stage', 'NOT_STARTED', '…but it carries no completion authority');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.start_mcm_landlord_run_v1()$$, '42501', null, 'guest cannot start a run');
reset role;

-- ---- B. progress (via the trusted service boundary) ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'investigate_staggering')->'progress'->>'stage',
  'NOT_STARTED', 'an investigation before start does not skip ahead');
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'start')->'progress'->>'stage', 'STARTED', 'start');
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'start')->'progress'->>'stage', 'STARTED',
  'repeated start is idempotent');
select throws_ok($$select public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'complete')$$,
  '22023', 'INVALID_EVENT_ACTION', 'there is no action that completes the event');
select throws_ok($$select public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'venue_unlocked')$$,
  '22023', 'INVALID_EVENT_ACTION', 'there is no action that unlocks the venue');
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'investigate_staggering')->'progress'->'investigated',
  '["staggering"]'::jsonb, 'first investigation recorded');
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'investigate_staggering')->'progress'->'investigated',
  '["staggering"]'::jsonb, 'repeated interaction is idempotent');
select is(public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'investigate_hungry')->'progress'->>'stage',
  'STARTED', 'two of three investigations: still STARTED');
select results_eq($$select r->'progress'->>'stage', r->'progress'->'investigated', (r->'progress'->>'venueUnlockedAt') is not null,
    (r->'progress'->>'completedAt') is null
  from (select public.advance_mcm_2026_event_v1('a7000000-0000-4000-8000-0000000000a7', 'investigate_dancing') r) s$$,
  $$values ('VENUE_UNLOCKED'::text, '["dancing", "hungry", "staggering"]'::jsonb, true, true)$$,
  'all three investigations (any order) unlock the venue; investigations only are not completion');
select throws_ok($$select public.advance_mcm_2026_event_v1('c7000000-0000-4000-8000-0000000000c7', 'start')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'guest accounts get no progress');
select throws_ok($$select public.advance_mcm_2026_event_v1('d7000000-0000-4000-8000-0000000000d7', 'start')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'banned accounts get no progress');
reset role;

-- ---- D. landlord minigame: server-issued run ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7000000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select results_eq($$select r ? 'runId', r ? 'deadlineAt', r->>'status', (r->>'durationMs')::int, (r->>'resumed')::boolean,
    exists (select 1 from jsonb_object_keys(r) k where k ilike '%survivor%' or k ilike '%answer%')
  from (select public.start_mcm_landlord_run_v1() r) s$$,
  $$values (true, true, 'ACTIVE'::text, 45000, false, false)$$, 'start returns a run and its deadline, never the survivor');
select is(public.start_mcm_landlord_run_v1()->>'resumed', 'true', 'a second start resumes the same active run');
reset role;
select is((select count(*) from private.world_landlord_runs where user_id = 'a7000000-0000-4000-8000-0000000000a7'), 1::bigint,
  'one run stored');
select ok((select survivor_actor_id from private.world_landlord_runs where user_id = 'a7000000-0000-4000-8000-0000000000a7')
  = any(array['ZUE-MG-001','ZUE-MG-002','ZUE-MG-003','ZUE-MG-004','ZUE-MG-005']), 'the survivor is stored server-side');
select is((select count(distinct private.world_landlord_pick_survivor_v1()) from generate_series(1, 400)), 5::bigint,
  'the server pick covers all five actors (not run % 5)');
-- Stash the run and a wrong actor for the player role, which cannot read the private table.
select set_config('test.run_a', (select run_id::text from private.world_landlord_runs where user_id = 'a7000000-0000-4000-8000-0000000000a7'), true);
select set_config('test.wrong_a', (select case when survivor_actor_id = 'ZUE-MG-001' then 'ZUE-MG-002' else 'ZUE-MG-001' end
  from private.world_landlord_runs where user_id = 'a7000000-0000-4000-8000-0000000000a7'), true);
select set_config('test.right_a', (select survivor_actor_id from private.world_landlord_runs
  where user_id = 'a7000000-0000-4000-8000-0000000000a7'), true);
select set_config('test.deadline_a', (select deadline_at::text from private.world_landlord_runs
  where user_id = 'a7000000-0000-4000-8000-0000000000a7'), true);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7000000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select throws_ok($$select public.submit_mcm_landlord_choice_v1(current_setting('test.run_a')::uuid, 'ZUE-MG-999')$$,
  '22023', 'INVALID_ACTOR', 'unknown actor is rejected without penalty');
select results_eq($$select r->>'status', (r->>'correct')::boolean, (r->>'wrongCount')::int,
    (r->>'deadlineAt')::timestamptz = current_setting('test.deadline_a')::timestamptz - interval '5 seconds'
  from (select public.submit_mcm_landlord_choice_v1(current_setting('test.run_a')::uuid, current_setting('test.wrong_a')) r) s$$,
  $$values ('ACTIVE'::text, false, 1, true)$$, 'a wrong choice costs exactly 5 seconds of server deadline');
set local request.jwt.claims = '{"role":"authenticated","sub":"b7000000-0000-4000-8000-0000000000b7","is_anonymous":false}';
select throws_ok($$select public.submit_mcm_landlord_choice_v1(current_setting('test.run_a')::uuid, current_setting('test.right_a'))$$,
  'P0001', 'RUN_NOT_FOUND', 'another player cannot submit to this run');
set local request.jwt.claims = '{"role":"authenticated","sub":"a7000000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select results_eq($$select r->>'status', (r->>'correct')::boolean, (r->>'firstClear')::boolean, (r->>'firstClearedAt') is not null
  from (select public.submit_mcm_landlord_choice_v1(current_setting('test.run_a')::uuid, current_setting('test.right_a')) r) s$$,
  $$values ('CLEARED'::text, true, true, true)$$, 'the survivor clears the run: the first clear is recorded');
select results_eq($$select r->>'status', r->>'correct', (r->>'firstClear')::boolean
  from (select public.submit_mcm_landlord_choice_v1(current_setting('test.run_a')::uuid, current_setting('test.right_a')) r) s$$,
  $$values ('CLEARED'::text, null::text, false)$$, 'resubmitting a cleared run changes nothing');

-- ---- F. main completion (A: investigations done, then the clear) ----
select results_eq($$select r->'progress'->>'stage', (r->'progress'->>'completedAt') is not null
  from (select public.get_my_mcm_2026_event_v1() r) s$$,
  $$values ('COMPLETED'::text, true)$$, 'investigations + venue + server clear = COMPLETED');
select set_config('test.completed_a', public.get_my_mcm_2026_event_v1()->'progress'->>'completedAt', true);
select is(public.start_mcm_landlord_run_v1()->>'resumed', 'false', 'a new run can start after a clear');
reset role;
select set_config('test.run_a2', (select run_id::text from private.world_landlord_runs
  where user_id = 'a7000000-0000-4000-8000-0000000000a7' and status = 'ACTIVE'), true);
select set_config('test.right_a2', (select survivor_actor_id from private.world_landlord_runs
  where user_id = 'a7000000-0000-4000-8000-0000000000a7' and status = 'ACTIVE'), true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7000000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select is(public.submit_mcm_landlord_choice_v1(current_setting('test.run_a2')::uuid, current_setting('test.right_a2'))->>'firstClear',
  'false', 'a later clear is not a second first clear');
select is(public.get_my_mcm_2026_event_v1()->'progress'->>'completedAt', current_setting('test.completed_a'),
  'the completion timestamp is stable');
reset role;
select is((select count(*) from private.world_landlord_first_clears where user_id = 'a7000000-0000-4000-8000-0000000000a7'),
  1::bigint, 'exactly one first clear');

-- ---- minigame only is not completion; B completes later, once ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b7000000-0000-4000-8000-0000000000b7","is_anonymous":false}';
select public.start_mcm_landlord_run_v1();
reset role;
select set_config('test.run_b', (select run_id::text from private.world_landlord_runs where user_id = 'b7000000-0000-4000-8000-0000000000b7'), true);
select set_config('test.right_b', (select survivor_actor_id from private.world_landlord_runs where user_id = 'b7000000-0000-4000-8000-0000000000b7'), true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b7000000-0000-4000-8000-0000000000b7","is_anonymous":false}';
select is(public.submit_mcm_landlord_choice_v1(current_setting('test.run_b')::uuid, current_setting('test.right_b'))->>'firstClear',
  'true', 'B clears the minigame');
select is(public.get_my_mcm_2026_event_v1()->'progress'->>'stage', 'NOT_STARTED', 'minigame only is not completion');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.advance_mcm_2026_event_v1('b7000000-0000-4000-8000-0000000000b7', a)
from unnest(array['start', 'investigate_hungry', 'investigate_dancing']) a;
select is(public.advance_mcm_2026_event_v1('b7000000-0000-4000-8000-0000000000b7', 'investigate_staggering')->'progress'->>'stage',
  'COMPLETED', 'the last investigation completes B at once because the clear is already recorded');
reset role;

-- ---- deadline: expiry and penalty-to-zero fail the run (E) ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e7000000-0000-4000-8000-0000000000e7","is_anonymous":false}';
select public.start_mcm_landlord_run_v1();
reset role;
update private.world_landlord_runs set deadline_at = now() - interval '1 second'
 where user_id = 'e7000000-0000-4000-8000-0000000000e7' and status = 'ACTIVE';
select set_config('test.run_e', (select run_id::text from private.world_landlord_runs where user_id = 'e7000000-0000-4000-8000-0000000000e7'), true);
select set_config('test.right_e', (select survivor_actor_id from private.world_landlord_runs where user_id = 'e7000000-0000-4000-8000-0000000000e7'), true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e7000000-0000-4000-8000-0000000000e7","is_anonymous":false}';
select results_eq($$select r->>'status', r->>'correct', (r->>'firstClear')::boolean
  from (select public.submit_mcm_landlord_choice_v1(current_setting('test.run_e')::uuid, current_setting('test.right_e')) r) s$$,
  $$values ('FAILED'::text, null::text, false)$$, 'even the right answer after the server deadline fails');
select is(public.start_mcm_landlord_run_v1()->>'resumed', 'false', 'a failed run can be retried with a new run');
reset role;
update private.world_landlord_runs set deadline_at = now() + interval '3 seconds'
 where user_id = 'e7000000-0000-4000-8000-0000000000e7' and status = 'ACTIVE';
select set_config('test.run_e2', (select run_id::text from private.world_landlord_runs
  where user_id = 'e7000000-0000-4000-8000-0000000000e7' and status = 'ACTIVE'), true);
select set_config('test.wrong_e2', (select case when survivor_actor_id = 'ZUE-MG-001' then 'ZUE-MG-002' else 'ZUE-MG-001' end
  from private.world_landlord_runs where user_id = 'e7000000-0000-4000-8000-0000000000e7' and status = 'ACTIVE'), true);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e7000000-0000-4000-8000-0000000000e7","is_anonymous":false}';
select is(public.submit_mcm_landlord_choice_v1(current_setting('test.run_e2')::uuid, current_setting('test.wrong_e2'))->>'status',
  'FAILED', 'a wrong choice that pushes the deadline past now fails the run');
set local request.jwt.claims = '{"role":"authenticated","sub":"c7000000-0000-4000-8000-0000000000c7","is_anonymous":true}';
select throws_ok($$select public.start_mcm_landlord_run_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous sessions cannot play');
set local request.jwt.claims = '{"role":"authenticated","sub":"d7000000-0000-4000-8000-0000000000d7","is_anonymous":false}';
select throws_ok($$select public.start_mcm_landlord_run_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned accounts cannot play');
reset role;
select is((select count(*) from private.world_landlord_first_clears where user_id = 'e7000000-0000-4000-8000-0000000000e7'),
  0::bigint, 'failed runs record no clear');

-- ---- window closes: nothing moves ----
update private.world_events set is_disabled = true where event_id = 'event.mcm_2026';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e7000000-0000-4000-8000-0000000000e7","is_anonymous":false}';
select is(public.get_my_mcm_2026_event_v1()->>'eventState', 'DISABLED', 'a disabled event reports DISABLED');
select throws_ok($$select public.start_mcm_landlord_run_v1()$$, 'P0001', 'EVENT_NOT_ACTIVE', 'no runs while disabled');
reset role;
update private.world_events set is_disabled = false, starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour'
 where event_id = 'event.mcm_2026';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_mcm_2026_event_v1('e7000000-0000-4000-8000-0000000000e7', 'status')->>'eventState', 'ENDED', 'ended');
select throws_ok($$select public.advance_mcm_2026_event_v1('e7000000-0000-4000-8000-0000000000e7', 'start')$$,
  'P0001', 'EVENT_NOT_ACTIVE', 'no progress after the window');
reset role;

-- ---- no reward side effects ----
select is((select count(*) from private.world_reward_transactions where user_id in (
  'a7000000-0000-4000-8000-0000000000a7', 'b7000000-0000-4000-8000-0000000000b7')), 0::bigint, 'completion granted no reward');
select is((select count(*) from private.world_player_items where user_id in (
  'a7000000-0000-4000-8000-0000000000a7', 'b7000000-0000-4000-8000-0000000000b7')), 0::bigint, 'completion granted no item');
select is((select count(*) from private.world_wallets where user_id in (
  'a7000000-0000-4000-8000-0000000000a7', 'b7000000-0000-4000-8000-0000000000b7')), 0::bigint, 'completion touched no wallet');

select * from finish();
rollback;
