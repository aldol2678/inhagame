-- Data API grant surface after a clean bootstrap. Every privilege the anon and authenticated
-- roles hold in public is listed here, so a migration that widens access fails until the new
-- privilege is added on purpose. The lists reflect the state the committed migrations
-- produce after a clean bootstrap, not new policy.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Functions: anything EXECUTE-able in public except extension members and trigger functions
-- (anon can EXECUTE four trigger functions through legacy defaults, but Postgres refuses to
-- call a trigger function directly, so they are not an API).
create function pg_temp.exec_surface(p_role text, p_exclude_role text default null) returns text[]
language sql stable as $$
  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege(p_role, p.oid, 'execute')
    and (p_exclude_role is null or not has_function_privilege(p_exclude_role, p.oid, 'execute'))
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
$$;
-- Tables and views: table-level S/I/U/D/T(runcate)/R(eferences)/G(trigger), plus ci/cu when
-- some columns are insertable/updatable without the table-level privilege.
create function pg_temp.table_surface(p_role text) returns text[]
language sql stable as $$
  select coalesce(array_agg(c.relname || ':' || concat_ws(',',
      case when has_table_privilege(p_role, c.oid, 'select') then 'S' end,
      case when has_table_privilege(p_role, c.oid, 'insert') then 'I' end,
      case when has_table_privilege(p_role, c.oid, 'update') then 'U' end,
      case when has_table_privilege(p_role, c.oid, 'delete') then 'D' end,
      case when has_table_privilege(p_role, c.oid, 'truncate') then 'T' end,
      case when has_table_privilege(p_role, c.oid, 'references') then 'R' end,
      case when has_table_privilege(p_role, c.oid, 'trigger') then 'G' end,
      case when not has_table_privilege(p_role, c.oid, 'insert') and has_any_column_privilege(p_role, c.oid, 'insert') then 'ci' end,
      case when not has_table_privilege(p_role, c.oid, 'update') and has_any_column_privilege(p_role, c.oid, 'update') then 'cu' end)
    order by c.relname), '{}')
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
    and (has_table_privilege(p_role, c.oid, 'select,insert,update,delete,truncate,references,trigger')
         or has_any_column_privilege(p_role, c.oid, 'select,insert,update'))
$$;

select set_eq($$select unnest(pg_temp.exec_surface('anon'))$$, array[
  -- public leaderboards
  'get_general_leaderboard_v3(bigint,integer)', 'get_general_leaderboard_v4(bigint,integer)',
  'get_general_leaderboard_v5(bigint,integer)',
  'get_grow_rank_board(text)',
  'get_induckup_ranked_leaderboard_v1(integer)', 'get_leaderboard_v3(bigint,integer)',
  'get_leaderboard_v4(bigint,integer)', 'get_leaderboard_v5(bigint,integer)',
  -- World public population count (aggregate only)
  'get_world_online_count_v1()',
  'is_inha_mail(text)',
  -- Classic gameplay telemetry (guest play)
  'log_general_progression_event_v1(text,smallint,smallint,uuid,boolean,uuid,uuid,text,text,text,text,text)',
  'log_general_session_start(uuid,uuid,text,text,text,text,text)',
  'log_general_stage_attempt(smallint,text)',
  'log_general_stage_attempt_v2(smallint,uuid,text,text,text,text)',
  'log_general_stage_attempt_v3(smallint,uuid,uuid,uuid,text,text,text,text,text)',
  'log_general_stage_exit(smallint,uuid,integer,text,text,text,text,text)',
  'log_general_stage_exit_v2(smallint,uuid,integer,text,text,text,text,text,text)',
  'log_general_stage_exit_v3(smallint,uuid,uuid,uuid,integer,text,text,text,text,text,text,text)',
  'log_general_stage_result(smallint,integer,integer,smallint,boolean,text)',
  'log_general_stage_result_v2(smallint,uuid,integer,integer,smallint,boolean,integer,text,text,text,text)',
  'log_general_stage_result_v3(smallint,uuid,uuid,uuid,integer,integer,smallint,boolean,integer,integer,integer,integer,text,text,text,text,text)',
  'log_general_ui_event_v1(text,uuid,uuid,text,text,text,text,text,text)',
  -- hub telemetry (apps/world/api)
  'log_induck_grow_analytics_v1(uuid,uuid,text,smallint,text,numeric,text,text)',
  'log_induck_grow_decision_v1(uuid,uuid,smallint,text,text,text,text,text,text)',
  'log_induck_grow_resource_checkpoint_v1(uuid,uuid,smallint,text,smallint,smallint,integer,smallint,text,text)',
  'log_induck_grow_session_end_v1(uuid,uuid,smallint,text,integer,boolean,text,text,numeric,text,text)',
  'log_inhagame_game_entry_v1(uuid,uuid,text,text)',
  'log_inhagame_hub_event_v1(uuid,uuid,uuid,text,text,text)',
  'log_inhagame_hub_event_v2(uuid,uuid,uuid,text,text,text,text,text)',
  'touch_world_online_session_v1(uuid,text,text)',
  'touch_world_online_session_v2(uuid,uuid,text,text)',
  'ranked_grade_code_v5(integer,integer,integer,integer,integer)'
], 'anon EXECUTE surface is exactly the intended public API');

select set_eq($$select unnest(pg_temp.exec_surface('authenticated', 'anon'))$$, array[
  'abandon_ranked_session_v1(uuid)',
  -- World Social S1-C1 (20260926030000): card, relationships, blocks, reports; caller = auth.uid().
  'block_world_user(uuid)',
  'end_world_accompany(uuid)',
  'cancel_world_friend_request(uuid)',
  'get_my_world_social()',
  -- World Admin RBAC P0: self access snapshot + permission-gated moderation RPCs.
  'get_my_world_admin_access_v1()',
  -- Display-only staff markers for supplied World player IDs; no permission data.
  'get_world_staff_badges_v1(uuid[])',
  'get_my_world_moderation_admin_v1()',
  'admin_review_world_user_report_v1(bigint,text)',
  -- OPS reads (P1-S0): signed-in callers only; bodies require an active staff role with ops.read.
  'get_inha_duck_ops_private_v1(text)',
  'get_inhagame_member_activity_ops_v1(text)',
  'get_inhagame_member_ops_v1(text)',
  'get_world_online_ops_v1(text)',
  'get_my_world_accompany()',
  'get_world_public_profile(uuid)',
  'get_world_relationship(uuid)',
  'remove_world_friend(uuid)',
  'propose_world_accompany(uuid,text,text)',
  'report_world_user(uuid,text,text)',
  'respond_world_friend_request(uuid,boolean)',
  'respond_world_accompany(uuid,boolean)',
  'send_world_friend_request(uuid)',
  'unblock_world_user(uuid)',
  -- Hub Messages P0-M1: RPC-only private mailbox; no authenticated table grants.
  'archive_hub_conversation_v1(uuid,boolean)',
  'get_hub_messages_v1(uuid,integer,timestamp with time zone)',
  'get_my_hub_conversations_v1(integer)',
  'get_my_hub_unread_count_v1()',
  'mark_hub_conversation_read_v1(uuid)',
  'report_hub_message_v1(uuid,text)',
  'send_hub_message_v1(uuid,text)',
  -- World guestbook and personal rooms: these migrations grant EXECUTE to authenticated.
  'get_world_guestbook_v1(text,integer,timestamp with time zone)',
  'upsert_world_guestbook_entry_v1(text,text)',
  'delete_world_guestbook_entry_v1(text)',
  'get_world_guestbook_v2(text,integer,timestamp with time zone)',
  'create_world_guestbook_entry_v2(text,text)',
  'update_world_guestbook_entry_v2(uuid,text)',
  'delete_world_guestbook_entry_v2(uuid)',
  'get_or_create_my_personal_room_v1()',
  -- Creature P1: own Duck Companion read/bond; observation minting remains service-role only.
  'get_my_duck_companion_v1()',
  'bond_my_duck_companion_v1(text)',
  -- Biryong NPC relationship P0: own server-authoritative Stage/fact projection, read only.
  'get_my_biryong_npc_relationship_v1(text)',
  'get_my_biryong_npc_relationships_v1()',
  -- Housing S1-D2 (20261002130000): friend visit, access check, owner privacy, Realtime predicate.
  'resolve_friend_personal_room_v1(uuid)',
  'check_world_room_access_v1(uuid)',
  'set_my_personal_room_visibility_v1(text)',
  'can_access_world_room_realtime_v1(text)',
  'get_world_room_furniture_v1(uuid)',
  'save_my_room_furniture_v1(uuid,integer,jsonb)',
  'delete_my_inhagame_account_v1(text)',
  'delete_my_grow_progress(timestamp with time zone)',
  'get_my_game_progress(text)',
  -- Grow GPA ranked visibility (production migration 20260925193657).
  'get_my_grow_rank_visibility(text)',
  'set_my_grow_rank_visibility(text,boolean)',
  'get_my_achievements()',
  'get_my_general_rank_v2()',
  'get_my_general_rank_v3()',
  'get_my_induckup_rank_v1()',
  'get_my_profile()',
  'get_my_rank_v3()',
  'get_my_rank_v4()',
  'is_permanent_account()',
  'my_inha_mail_badge()',
  'record_general_stage_best_v2(integer,integer,integer,integer)',
  'save_my_game_progress(text,jsonb,integer,boolean)',
  'save_my_grow_progress(jsonb,timestamp with time zone,boolean)',
  'submit_ranked_recovery_snapshot_v1(uuid,uuid,uuid,text,text,text,jsonb)',
  'submit_ranked_recovery_summary_v1(text,integer,text,integer,text)',
  'touch_inhagame_member_activity_v1(text)',
  -- Economy P0-A (20260927100000): own wallet balance read; caller = auth.uid().
  'get_my_world_wallet_v1()',
  -- Economy/Collection P0-B (20260927110000): own inventory read; caller = auth.uid().
  'get_my_world_inventory_v1()',
  -- Economy P0-F0 (20260928063300): own EXP/derived Level read; caller = auth.uid().
  'get_my_world_progression_v1()',
  -- Progression / Economy P1e (20260929190000): own Campus Daily Quiz; caller = auth.uid(), day = DB Asia/Seoul clock.
  'get_my_world_daily_quiz_v1()',
  'start_my_world_daily_quiz_v1()',
  'answer_my_world_daily_quiz_v1(uuid,text,smallint)',
  -- Progression / Economy P1f (20260929220000): own Campus Attendance; caller = auth.uid(), day = DB Asia/Seoul clock.
  'get_my_world_attendance_v1()',
  'claim_my_world_attendance_v1()',
  -- Appearance / Loadout Authority P0 (20260928160000): own loadout read and equip / unequip; caller = auth.uid().
  'get_my_world_appearance_loadout_v1()',
  'equip_my_world_item_v1(text,text,text)',
  'unequip_my_world_item_v1(text,text)',
  -- Economy P0-D (20260927130000): shop read and purchase; buyer = auth.uid(), price from the listing.
  'get_world_shop_v1(text)',
  'purchase_world_shop_listing_v1(text,text)',
  -- MCM 2026 P0-E0 (20260927150000): own event state + server-judged landlord runs; caller = auth.uid().
  'get_my_mcm_2026_event_v1()',
  'start_mcm_landlord_run_v1()',
  'submit_mcm_landlord_choice_v1(uuid,text)',
  -- MCM 2026 P0-E (20260927160000): claim own verified completion rewards; caller = auth.uid().
  'claim_my_mcm_2026_main_reward_v1()',
  'claim_my_mcm_landlord_first_clear_reward_v1()',
  -- Biryong BR01 account progress (20260927230000): own account snapshot and monotonic merge.
  'get_my_biryong_progress_v1()',
  'merge_my_biryong_progress_v1(jsonb,boolean)'
], 'signed-in-only EXECUTE surface is exactly the intended account API');

-- departments T,R,G: TRUNCATE / REFERENCES / TRIGGER survive from Supabase's legacy default
-- privileges (the migrations revoked only insert/update/delete). PostgREST never issues them,
-- so they are not reachable through the Data API; recorded as a known ambiguity, not changed.
select set_eq($$select unnest(pg_temp.table_surface('anon'))$$, array[
  'departments:S,T,R,G', 'inha_duck_ops_refresh:S', 'world_runtime_flags:S'
], 'anon table privileges');
select set_eq($$select unnest(pg_temp.table_surface('authenticated'))$$, array[
  'departments:S,T,R,G', 'inha_duck_ops_refresh:S', 'profiles:S,ci,cu',
  'user_achievements:S', 'user_game_progress:S,I,U', 'world_runtime_flags:S'
], 'authenticated table privileges');

-- Endless runs have no verified submission path; no Data API role can record a best.
select ok(not has_function_privilege(r, 'public.record_induckup_ranked_best_v1(integer,integer,integer)', 'execute'),
  format('%s cannot directly submit an InduckUp ranked best', r))
from unnest(array['anon', 'authenticated', 'service_role']) r;

-- ---- the privileged server APIs stay service-role only ----
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r, unnest(array[
  'public.get_inhagame_hub_ops_v1()',
  'public.get_induck_grow_ops_v1()',
  'public.get_induck_grow_ops_p1_core_v1()',
  'public.get_induck_grow_ops_p2a_core_v1()',
  'public.claim_inha_mail_badge(uuid,uuid)',
  'public.claim_world_npc_ai_call_v1(uuid)',
  'public.expire_ranked_sessions_v1()',
  'public.finish_grow_rank_v1(uuid,uuid,uuid,text,integer,integer,text)',
  'public.world_wallet_credit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_debit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_get_balance_v1(uuid,text)',
  'public.world_inventory_grant_item_v1(uuid,text,integer,text,text,text,text,jsonb)',
  'public.world_inventory_ensure_default_items_v1(uuid)',
  'public.world_inventory_list_v1(uuid)',
  'public.world_inventory_get_item_v1(uuid,text)',
  'public.world_inventory_has_item_v1(uuid,text)',
  'public.world_reward_grant_v1(uuid,text,text,text,text)',
  'public.world_reward_get_result_v1(text)',
  'public.world_exp_grant_v1(uuid,bigint,text,text,text)',
  'public.world_progression_get_v1(uuid)',
  'public.world_biryong_npc_relationship_advance_v1(uuid,text,smallint,text,text,text,text)',
  'public.advance_mcm_2026_event_v1(uuid,text)'
]) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f))
from unnest(array[
  'public.get_inhagame_hub_ops_v1()',
  'public.get_induck_grow_ops_v1()',
  'public.get_induck_grow_ops_p1_core_v1()',
  'public.get_induck_grow_ops_p2a_core_v1()',
  'public.claim_inha_mail_badge(uuid,uuid)',
  'public.claim_world_npc_ai_call_v1(uuid)',
  'public.expire_ranked_sessions_v1()',
  'public.finish_grow_rank_v1(uuid,uuid,uuid,text,integer,integer,text)',
  'public.world_wallet_credit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_debit_v1(uuid,text,bigint,text,text,text,text,text)',
  'public.world_wallet_get_balance_v1(uuid,text)',
  'public.world_inventory_grant_item_v1(uuid,text,integer,text,text,text,text,jsonb)',
  'public.world_inventory_ensure_default_items_v1(uuid)',
  'public.world_inventory_list_v1(uuid)',
  'public.world_inventory_get_item_v1(uuid,text)',
  'public.world_inventory_has_item_v1(uuid,text)',
  'public.world_reward_grant_v1(uuid,text,text,text,text)',
  'public.world_reward_get_result_v1(text)',
  'public.world_exp_grant_v1(uuid,bigint,text,text,text)',
  'public.world_progression_get_v1(uuid)',
  'public.world_biryong_npc_relationship_advance_v1(uuid,text,smallint,text,text,text,text)',
  'public.advance_mcm_2026_event_v1(uuid,text)'
]) f;

-- ---- authority domains: server APIs are service-role only ----
-- Contract: docs/architecture/AUTHORITY_MAP.md section 6. Activity, Collection, Combat, Creature,
-- the Life/Combat -> Creature bridges, onboarding Quest advance and NPC shared ticks are driven by
-- trusted server code (Cloud Run / server API) that passes p_user; no client role may call them.
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r, unnest(array[
  'public.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)',
  'public.world_activity_finalize_v1(uuid,uuid,text,text,text)',
  'public.world_collection_discover_v1(uuid,text,text,text,text,text,jsonb)',
  'public.world_collection_list_v1(uuid)',
  'public.world_combat_start_v1(uuid,text,text,uuid,integer,integer,jsonb)',
  'public.world_combat_state_write_v1(uuid,uuid,bigint,jsonb)',
  'public.world_combat_snapshot_v1(uuid,uuid)',
  'public.world_combat_finalize_v1(uuid,uuid,text,text)',
  'public.world_combat_start_with_creature_v1(uuid,text,text,uuid,integer,integer,jsonb)',
  'public.world_combat_finalize_with_creature_v1(uuid,uuid,text,text)',
  'public.world_life_activity_start_with_creature_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)',
  'public.world_life_activity_finalize_with_creature_v1(uuid,uuid,text,text,text)',
  'public.world_creature_observe_v1(uuid,text,text,text,text,text)',
  'public.world_creature_grant_v1(uuid,text,text,text,text)',
  'public.world_creature_party_set_v1(uuid,uuid,uuid,uuid,bigint,text)',
  'public.world_creature_core_snapshot_v1(uuid)',
  'public.world_creature_activity_accept_v1(uuid,text,text,text,text,bigint,timestamp with time zone)',
  'public.world_creature_evolution_candidate_v1(uuid,uuid,text,text)',
  'public.world_creature_evolution_context_gate_v1(uuid,uuid,text,text)',
  'public.world_creature_evolution_commit_v1(uuid,uuid,text)',
  'public.advance_world_quest_v1(uuid,text)',
  'public.advance_world_navigation_quest_v1(uuid,text)',
  'public.claim_world_npc_shared_tick_v1(text,bigint)',
  'public.commit_world_npc_shared_tick_v1(text,bigint,bigint,jsonb)',
  'public.get_world_npc_shared_state_v1()',
  'public.world_biryong_npc_relationship_advance_v1(uuid,text,smallint,text,text,text,text)'
]) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f))
from unnest(array[
  'public.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)',
  'public.world_activity_finalize_v1(uuid,uuid,text,text,text)',
  'public.world_collection_discover_v1(uuid,text,text,text,text,text,jsonb)',
  'public.world_collection_list_v1(uuid)',
  'public.world_combat_start_v1(uuid,text,text,uuid,integer,integer,jsonb)',
  'public.world_combat_state_write_v1(uuid,uuid,bigint,jsonb)',
  'public.world_combat_snapshot_v1(uuid,uuid)',
  'public.world_combat_finalize_v1(uuid,uuid,text,text)',
  'public.world_combat_start_with_creature_v1(uuid,text,text,uuid,integer,integer,jsonb)',
  'public.world_combat_finalize_with_creature_v1(uuid,uuid,text,text)',
  'public.world_life_activity_start_with_creature_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)',
  'public.world_life_activity_finalize_with_creature_v1(uuid,uuid,text,text,text)',
  'public.world_creature_observe_v1(uuid,text,text,text,text,text)',
  'public.world_creature_grant_v1(uuid,text,text,text,text)',
  'public.world_creature_party_set_v1(uuid,uuid,uuid,uuid,bigint,text)',
  'public.world_creature_core_snapshot_v1(uuid)',
  'public.world_creature_activity_accept_v1(uuid,text,text,text,text,bigint,timestamp with time zone)',
  'public.world_creature_evolution_candidate_v1(uuid,uuid,text,text)',
  'public.world_creature_evolution_context_gate_v1(uuid,uuid,text,text)',
  'public.world_creature_evolution_commit_v1(uuid,uuid,text)',
  'public.advance_world_quest_v1(uuid,text)',
  'public.advance_world_navigation_quest_v1(uuid,text)',
  'public.claim_world_npc_shared_tick_v1(text,bigint)',
  'public.commit_world_npc_shared_tick_v1(text,bigint,bigint,jsonb)',
  'public.get_world_npc_shared_state_v1()',
  'public.world_biryong_npc_relationship_advance_v1(uuid,text,smallint,text,text,text,text)'
]) f;

-- ---- private schema: primitives are reachable only through reviewed public functions ----
-- No API role (not even service_role) executes a private function directly, except the two
-- staff-permission helpers below. Mutation primitives live in private, so this is the backstop
-- behind the call-graph allowlist in 93_authority_primitive_callers.
select is_empty(
  format($$select p.oid::regprocedure::text from pg_proc p
           where p.pronamespace = 'private'::regnamespace and has_function_privilege(%L, p.oid, 'execute')$$, r),
  format('%s cannot execute any private function', r))
from unnest(array['anon', 'authenticated']) r;
select set_eq(
  $$select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'private'::regnamespace and has_function_privilege('service_role', p.oid, 'execute')$$,
  array['private.world_admin_caller_v1(text)', 'private.world_ops_read_allowed_v1(text)'],
  'service_role executes only the staff-permission helpers in private');
select ok(not has_function_privilege(r, p.oid, 'execute'), format('%s cannot execute primitive %s', r, p.oid::regprocedure))
from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
where p.pronamespace = 'private'::regnamespace and p.proname in (
  'world_wallet_apply_v1', 'world_exp_apply_v1', 'world_inventory_grant_v1', 'world_inventory_consume_v1',
  'world_inventory_mutate_v1', 'world_reward_grant_v1', 'world_life_skill_xp_apply_v1', 'world_life_node_unlock_v1',
  'world_collection_discover_v1', 'world_creature_grant_v1', 'world_creature_activity_accept_v1',
  'world_creature_evolution_commit_v1', 'world_combat_finalize_v1', 'world_activity_finalize_v1');

-- Direct table DML in private by an API role bypasses every primitive. Exact surface, recorded as
-- found (not new policy): service_role keeps the ops/legacy write paths listed here.
select set_eq(
  $$select r || ':' || c.relname || ':' || concat_ws(',',
      case when has_table_privilege(r, c.oid, 'insert') then 'I' end,
      case when has_table_privilege(r, c.oid, 'update') then 'U' end,
      case when has_table_privilege(r, c.oid, 'delete') then 'D' end,
      case when has_table_privilege(r, c.oid, 'truncate') then 'T' end)
    from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
    where c.relnamespace = 'private'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
      and has_table_privilege(r, c.oid, 'insert,update,delete,truncate')$$,
  array[
    'service_role:world_biryong_progress_v1:I,U',
    'service_role:world_npc_shared_ticks_v1:I,U,D',
    -- Finding (AUTHORITY_MAP section 8): lets server code set a stage without advance_world_*_quest_v1.
    'service_role:world_quest_progress_v1:I,U',
    'service_role:world_room_layouts:I,U,D',
    'service_role:world_staff_assignments:I,U,D,T',
    'service_role:world_staff_role_permissions:I,U,D,T',
    'service_role:world_user_moderation_actions:I,U,D,T'
  ],
  'API-role DML on private tables is exactly the recorded surface (no role writes Wallet/EXP/Inventory/Life/Creature state directly)');

-- ---- column-level: players never write moderation or ownership-sensitive columns ----
select ok(not has_column_privilege('authenticated', 'public.profiles', c, p), format('authenticated cannot %s profiles.%s', p, c))
from unnest(array['is_banned', 'created_at']) c, unnest(array['INSERT', 'UPDATE']) p;
-- Profile P1 (20260925115441) lets players edit their title and avatar, not insert them.
select ok(has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE'), format('authenticated can UPDATE profiles.%s', c))
from unnest(array['nickname', 'department_id', 'title', 'avatar_key']) c;
select ok(not has_column_privilege('authenticated', 'public.profiles', c, 'INSERT'), format('authenticated cannot INSERT profiles.%s', c))
from unnest(array['title', 'avatar_key']) c;
select ok(not has_column_privilege('authenticated', 'public.profiles', 'user_id', 'UPDATE'),
  'authenticated cannot move a profile to another user');

-- ---- non-public schemas ----
select ok(not has_schema_privilege(r, 'private', 'usage'), format('%s has no access to schema private', r))
from unnest(array['anon', 'authenticated']) r;
select is(
  array(select r || ':' || c.relname from pg_class c, unnest(array['anon', 'authenticated']) r
        where c.relnamespace = 'analytics'::regnamespace and has_table_privilege(r, c.oid, 'select') order by 1),
  array[]::text[], 'analytics views are not readable by anon or authenticated');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.leaderboard_public'::regclass),
  'leaderboard_public applies the caller''s RLS (security_invoker)');


-- Explicit public exclusion: no observer secret/runtime authority is installed.
select ok(to_regprocedure('public.get_inha_duck_observer_gateway_secret_v1(text)') is null, 'observer secret authority is absent');
select ok(to_regprocedure('public.get_inha_duck_observer_runtime_v1(integer)') is null, 'private observer runtime is absent');

select * from finish();
rollback;
