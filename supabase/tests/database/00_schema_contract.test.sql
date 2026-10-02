-- Schema contract of a database bootstrapped from supabase/migrations: the objects the apps and
-- Edge Functions call exist, the constraints their behavior relies on exist, RLS is on, and
-- SECURITY DEFINER functions pin search_path. Run by `supabase test db` (one rolled-back
-- transaction per file). Grants live in 01_grants_contract.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- tables ----
select has_table('public', t, format('table public.%s exists', t)) from unnest(array[
  'departments', 'experiment_assignments', 'experiments', 'game_builds', 'game_events',
  'game_sessions', 'games', 'general_stage_bests', 'induckup_ranked_bests',
  'inha_duck_ops_auth_state', 'inha_duck_ops_refresh', 'inha_mail_badges', 'inhagame_hub_events', 'induck_grow_analytics_events',
  'induck_grow_resource_checkpoints', 'induck_grow_session_ends', 'induck_grow_decision_events',
  'ops_alert_state', 'ops_event_contracts', 'ops_event_mappings', 'ops_lifecycle_profiles',
  'player_bests', 'player_identity_links', 'players', 'profiles', 'ranked_recovery_eligibility',
  'ranked_recovery_records', 'ranked_runs', 'ranked_sessions', 'runs', 'user_achievements', 'user_game_progress',
  'world_online_sessions'
]) as t;
select has_view('public', 'leaderboard_public', 'view public.leaderboard_public exists');
select has_table('private','inhagame_member_activity_daily','private member activity ledger exists');

-- ---- functions the clients call (name and exact argument types) ----
select has_function('public', f, a, format('%s(%s)', f, array_to_string(a, ','))) from (values
  ('log_inhagame_hub_event_v1', array['uuid', 'uuid', 'uuid', 'text', 'text', 'text']),
  ('log_inhagame_hub_event_v2', array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text']),
  ('log_inhagame_game_entry_v1', array['uuid', 'uuid', 'text', 'text']),
  ('log_induck_grow_analytics_v1', array['uuid','uuid','text','smallint','text','numeric','text','text']),
  ('log_induck_grow_resource_checkpoint_v1', array['uuid','uuid','smallint','text','smallint','smallint','integer','smallint','text','text']),
  ('log_induck_grow_session_end_v1', array['uuid','uuid','smallint','text','integer','boolean','text','text','numeric','text','text']),
  ('log_induck_grow_decision_v1', array['uuid','uuid','smallint','text','text','text','text','text','text']),
  ('get_induck_grow_ops_p1_core_v1', array[]::text[]),
  ('get_induck_grow_ops_p2a_core_v1', array[]::text[]),
  ('get_induck_grow_ops_v1', array[]::text[]),
  ('get_inhagame_hub_ops_v1', array[]::text[]),
  ('get_my_game_progress', array['text']),
  ('get_my_achievements', array[]::text[]),
  ('save_my_game_progress', array['text', 'jsonb', 'integer', 'boolean']),
  ('is_permanent_account', array[]::text[]),
  ('my_inha_mail_badge', array[]::text[]),
  ('claim_inha_mail_badge', array['uuid', 'uuid']),
  ('is_inha_mail', array['text']),
  ('expire_ranked_sessions_v1', array[]::text[]),
  ('abandon_ranked_session_v1', array['uuid']),
  ('get_inha_duck_ops_private_v1', array['text']),
  ('get_inhagame_member_ops_v1', array['text']),
  ('get_inhagame_member_activity_ops_v1', array['text']),
  ('touch_inhagame_member_activity_v1', array['text']),
  ('get_world_moderation_ops_v1', array['text']),
  ('review_world_user_report_ops_v1', array['text','bigint','text']),
  ('get_inha_duck_ops_core_private_v1', array['text']),
  ('get_my_profile', array[]::text[]),
  ('get_world_public_profile', array['uuid']),
  ('get_world_relationship', array['uuid']),
  ('send_world_friend_request', array['uuid']),
  ('respond_world_friend_request', array['uuid', 'boolean']),
  ('cancel_world_friend_request', array['uuid']),
  ('remove_world_friend', array['uuid']),
  ('block_world_user', array['uuid']),
  ('unblock_world_user', array['uuid']),
  ('get_my_world_social', array[]::text[]),
  ('report_world_user', array['uuid', 'text', 'text']),
  ('send_hub_message_v1', array['uuid', 'text']),
  ('get_my_hub_conversations_v1', array['integer']),
  ('get_hub_messages_v1', array['uuid', 'integer', 'timestamp with time zone']),
  ('mark_hub_conversation_read_v1', array['uuid']),
  ('get_my_hub_unread_count_v1', array[]::text[]),
  ('archive_hub_conversation_v1', array['uuid', 'boolean']),
  ('report_hub_message_v1', array['uuid', 'text']),
  ('get_my_world_accompany', array[]::text[]),
  ('propose_world_accompany', array['uuid', 'text', 'text']),
  ('respond_world_accompany', array['uuid', 'boolean']),
  ('end_world_accompany', array['uuid']),
  ('touch_world_online_session_v1', array['uuid','text','text']),
  ('get_world_online_count_v1', array[]::text[]),
  ('get_world_online_ops_v1', array['text'])
) as f(f, a);
-- Called by name from apps/* and supabase/functions/* (see the dependency map in .github/ci/README.md).
select has_function('public', f, format('%s exists', f)) from unnest(array[
  'get_induckup_ranked_leaderboard_v1', 'get_my_induckup_rank_v1', 'record_induckup_ranked_best_v1',
  'get_leaderboard_v4', 'get_general_leaderboard_v4', 'get_my_rank_v3', 'get_my_general_rank_v2',
  'record_general_stage_best_v2', 'record_ranked_result_v4', 'record_ranked_result_v5',
  'log_general_session_start', 'log_general_stage_attempt_v3', 'log_general_stage_result_v3',
  'log_general_stage_exit_v3', 'log_general_ui_event_v1', 'log_general_progression_event_v1',
  'submit_ranked_recovery_snapshot_v1', 'submit_ranked_recovery_summary_v1',
  'verify_inha_duck_ops_basic_v1'
]) as f;

-- ---- keys and constraints the runtime relies on ----
select col_is_pk('public', 'inhagame_hub_events', 'event_id', 'hub event_id is the idempotency key');
select index_is_unique('public', 'inhagame_hub_events', 'inhagame_hub_entry_stage_unique',
  'one row per (entry_id, stage)');
select is(
  (select pg_get_indexdef(i.indexrelid) from pg_index i where i.indexrelid = 'public.inhagame_hub_entry_stage_unique'::regclass),
  'CREATE UNIQUE INDEX inhagame_hub_entry_stage_unique ON public.inhagame_hub_events USING btree (entry_id, event_type) WHERE (entry_id IS NOT NULL)',
  'entry stage uniqueness is (entry_id, event_type) for entry rows only');
select has_index('public', 'inhagame_hub_events', 'inhagame_hub_entry_lookup', 'entry lookup index');
select has_index('public', 'inhagame_hub_events', 'inhagame_hub_events_session_idx', 'per-session rate-limit index');
select has_index('public', 'inhagame_hub_events', 'inhagame_hub_events_acquisition_created_idx', 'acquisition source index');
select has_column('public', 'inhagame_hub_events', 'acquisition_source', 'normalized acquisition source column');
select has_column('public', 'inhagame_hub_events', 'campaign', 'normalized campaign column');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.inhagame_hub_events'::regclass
  and conname = 'hub_event_context_check' and contype = 'c'), 'hub event context check exists');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.inhagame_hub_events'::regclass
  and conname = 'inhagame_hub_events_event_type_check' and contype = 'c'), 'hub event type check exists');

select col_is_pk('public', 'user_achievements', array['user_id','achievement_key'], 'one award per user and key');
select fk_ok('public', 'user_achievements', 'user_id', 'auth', 'users', 'id');
select col_is_pk('public', 'user_game_progress', array['user_id', 'game_id'], 'one progress row per user and game');
select fk_ok('public', 'user_game_progress', 'game_id', 'public', 'games', 'id');
select fk_ok('public', 'user_game_progress', 'user_id', 'auth', 'users', 'id');
select col_is_unique('public', 'games', 'slug', 'game slugs are unique');
select set_has($$select slug from public.games$$,
  $$values ('inha-duck'), ('induckup'), ('inha-duck-survival')$$,
  'the game slugs the apps save progress under are seeded');

select col_is_pk('public', 'inha_mail_badges', 'user_id', 'one mail badge per account');
select col_is_unique('public', 'inha_mail_badges', 'email', 'a school mailbox backs one account');
select col_is_pk('public', 'induckup_ranked_bests', 'user_id', 'one InduckUp best per account');
select col_is_pk('public', 'ranked_sessions', 'run_id', 'ranked run id');
select col_is_pk('public', 'profiles', 'user_id', 'one profile per account');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.ranked_sessions'::regclass
  and conname = 'ranked_sessions_status' and contype = 'c'), 'ranked session status check exists');

-- ---- RLS ----
select is(
  array(select c.relname::text from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
        order by 1),
  array[]::text[],
  'every table in public has row level security enabled');

-- ---- SECURITY DEFINER hygiene ----
-- Pinned means a search_path setting on the function itself. The repository pins either '' or
-- an explicit list such as `public` / `public, auth`; both are intentional, a missing one is not.
select is(
  array(select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%')
        order by 1),
  array[]::text[],
  'every SECURITY DEFINER function pins search_path');
select is(
  array(select p.oid::regprocedure::text from pg_proc p, unnest(p.proconfig) s
        where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
          and s like 'search_path=%' and (s ~ '\$user' or (s ~ 'pg_temp' and s !~ 'pg_temp"?$'))
        order by 1),
  array[]::text[],
  'no SECURITY DEFINER search_path resolves through $user or puts pg_temp before trusted schemas');


-- Explicit public exclusion: no observer secret/runtime authority is installed.
select ok(to_regprocedure('public.get_inha_duck_observer_gateway_secret_v1(text)') is null, 'observer secret authority is absent');
select ok(to_regprocedure('public.get_inha_duck_observer_runtime_v1(integer)') is null, 'private observer runtime is absent');

select * from finish();
rollback;
