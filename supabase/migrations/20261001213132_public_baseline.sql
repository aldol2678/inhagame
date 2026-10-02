-- INHAGAME public baseline; source 92ed01630dcf30df8190c0941fa8b45d1625cad4
-- Seed timestamp is the source commit timestamp: 2026-10-01T21:31:32Z
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: analytics; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA analytics;


--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: hub_message_caller(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.hub_message_caller() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.world_social_caller()
$$;


--
-- Name: hub_message_card(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.hub_message_card(p_user uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'userId', p.user_id,
    'nickname', p.nickname,
    'title', p.title,
    'avatar', p.avatar_key,
    'inhaVerified', private.hub_message_inha_verified(p.user_id)
  )
  from public.profiles p
  where p.user_id = p_user and p.is_banned = false
$$;


--
-- Name: hub_message_inha_verified(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.hub_message_inha_verified(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_user
      and u.is_anonymous = false
      and u.email_confirmed_at is not null
      and public.is_inha_mail(u.email)
  ) or exists (
    select 1
    from public.inha_mail_badges b
    join auth.users u on u.id = b.user_id
    where b.user_id = p_user
      and u.is_anonymous = false
      and u.email_confirmed_at is not null
  )
$$;


--
-- Name: hub_message_lock_pair(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.hub_message_lock_pair(p_a uuid, p_b uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select pg_advisory_xact_lock(
    hashtextextended('hub_message_pair:' || least(p_a,p_b)::text || ':' || greatest(p_a,p_b)::text, 0)
  )
$$;


--
-- Name: hub_message_lock_sender(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.hub_message_lock_sender(p_user uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select pg_advisory_xact_lock(hashtextextended('hub_message_sender:' || p_user::text, 0))
$$;


--
-- Name: hub_message_target(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.hub_message_target(p_caller uuid, p_target uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_target is null or p_target = p_caller or not exists (
    select 1
    from auth.users u
    join public.profiles p on p.user_id = u.id
    where u.id = p_target
      and u.is_anonymous is not true
      and p.is_banned = false
  ) then
    raise exception 'TARGET_UNAVAILABLE' using errcode = '22023';
  end if;
  return p_target;
end;
$$;


--
-- Name: inha_duck_ops_basic_digest_valid_v1(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.inha_duck_ops_basic_digest_valid_v1(p_value text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select false;
$$;


--
-- Name: inha_duck_ops_credential_valid_v1(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.inha_duck_ops_credential_valid_v1(p_value text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select false;
$$;


--
-- Name: FUNCTION inha_duck_ops_credential_valid_v1(p_value text); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.inha_duck_ops_credential_valid_v1(p_value text) IS 'Retired by P1-S0. Always false: OPS no longer accepts a presented credential. Authorization is account RBAC only.';


--
-- Name: install_world_online_realtime_policies(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.install_world_online_realtime_policies() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
begin
  drop policy if exists "world online members read place zone" on realtime.messages;
  drop policy if exists "world online members write place zone" on realtime.messages;

  drop policy if exists "world online players read place zone" on realtime.messages;
  create policy "world online players read place zone"
    on realtime.messages
    for select
    to authenticated
    using (
      (select auth.uid()) is not null
      and realtime.messages.extension in ('broadcast', 'presence')
      and (select realtime.topic()) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'
    );

  drop policy if exists "world online players write place zone" on realtime.messages;
  create policy "world online players write place zone"
    on realtime.messages
    for insert
    to authenticated
    with check (
      (select auth.uid()) is not null
      and realtime.messages.extension in ('broadcast', 'presence')
      and (select realtime.topic()) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'
    );
end;
$_$;


--
-- Name: purge_game_events_90d(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_game_events_90d() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_deleted integer;
begin
  with due as (
    select id
    from public.game_events
    where created_at < now() - interval '90 days'
    order by created_at, id
    limit 5000
    for update skip locked
  )
  delete from public.game_events e
  using due
  where e.id = due.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


--
-- Name: purge_induck_grow_analytics_90d(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_induck_grow_analytics_90d() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_deleted integer;
begin
  with due as (
    select event_id from public.induck_grow_analytics_events
    where created_at<now()-interval '90 days' order by created_at,event_id limit 5000 for update skip locked
  )
  delete from public.induck_grow_analytics_events e using due where e.event_id=due.event_id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;


--
-- Name: purge_induck_grow_decisions_90d(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_induck_grow_decisions_90d() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_deleted integer;
begin
  with due as (
    select event_id from public.induck_grow_decision_events
    where created_at<now()-interval '90 days' order by created_at,event_id limit 5000 for update skip locked
  )
  delete from public.induck_grow_decision_events d using due where d.event_id=due.event_id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;


--
-- Name: purge_induck_grow_p2a_90d(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_induck_grow_p2a_90d() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_resource integer;v_ends integer;
begin
  with due as (
    select event_id from public.induck_grow_resource_checkpoints
    where created_at<now()-interval '90 days' order by created_at,event_id limit 5000 for update skip locked
  )
  delete from public.induck_grow_resource_checkpoints c using due where c.event_id=due.event_id;
  get diagnostics v_resource=row_count;
  with due as (
    select event_id from public.induck_grow_session_ends
    where created_at<now()-interval '90 days' order by created_at,event_id limit 5000 for update skip locked
  )
  delete from public.induck_grow_session_ends e using due where e.event_id=due.event_id;
  get diagnostics v_ends=row_count;
  return v_resource+v_ends;
end;
$$;


--
-- Name: purge_inhagame_hub_events_90d(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_inhagame_hub_events_90d() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_deleted integer;
begin
  with due as (
    select event_id from public.inhagame_hub_events
    where created_at < now() - interval '90 days'
    order by created_at,event_id limit 5000 for update skip locked
  )
  delete from public.inhagame_hub_events e using due where e.event_id=due.event_id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;


--
-- Name: purge_world_accompany_1d(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_world_accompany_1d() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_deleted integer;
begin
  with due as (
    select id from public.world_accompany_sessions
    where expires_at < now() - interval '1 day'
    order by expires_at, id limit 5000 for update skip locked
  )
  delete from public.world_accompany_sessions s using due where s.id = due.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


--
-- Name: world_accompany_expire(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_accompany_expire(p_user uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update public.world_accompany_sessions s
     set state = 'expired', ended_at = now(), ended_reason = 'timeout'
   where (s.inviter_id = p_user or s.invitee_id = p_user)
     and s.state in ('offered', 'active') and s.expires_at <= now();
  update public.world_accompany_sessions s
     set state = 'ended', ended_at = now(), ended_reason = 'relationship'
   where (s.inviter_id = p_user or s.invitee_id = p_user)
     and s.state in ('offered', 'active')
     and private.world_relationship(s.inviter_id, s.invitee_id) <> 'friends';
$$;


--
-- Name: world_accompany_lock_users(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_accompany_lock_users(p_a uuid, p_b uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended('world_accompany:' || least(p_a, p_b)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('world_accompany:' || greatest(p_a, p_b)::text, 0));
end;
$$;


--
-- Name: world_admin_caller_v1(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_admin_caller_v1(p_permission text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id=v_uid and p.is_banned=false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;

  if not exists (
    select 1
    from private.world_staff_assignments a
    join private.world_staff_role_permissions rp on rp.role=a.role
    where a.user_id=v_uid
      and a.active=true
      and rp.permission=p_permission
  ) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  return v_uid;
end;
$$;


--
-- Name: world_appearance_caller_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_appearance_caller_v1() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_inventory_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;


--
-- Name: world_appearance_loadout_json_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_appearance_loadout_json_v1(p_user uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object('slots', jsonb_object_agg(s.slot, case when l.item_id is null then 'null'::jsonb
    else jsonb_build_object('itemId', l.item_id, 'catalogStatus', coalesce(c.status, 'UNKNOWN_ITEM'),
                            'equippedAt', l.updated_at) end))
  from unnest(array['BODY', 'FACE', 'HAIR', 'HEAD', 'TOP', 'BOTTOM', 'SHOES', 'BACK', 'ACCESSORY']) as s(slot)
  left join private.world_player_appearance_loadout l on l.user_id = p_user and l.slot = s.slot
  left join private.world_item_catalog c on c.item_id = l.item_id;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: world_appearance_transactions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_appearance_transactions (
    transaction_id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key text NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    slot text NOT NULL,
    requested_item_id text,
    previous_item_id text,
    next_item_id text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT world_appearance_transactions_action_check CHECK ((action = ANY (ARRAY['EQUIP'::text, 'UNEQUIP'::text]))),
    CONSTRAINT world_appearance_transactions_idempotency_key_check CHECK ((idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'::text)),
    CONSTRAINT world_appearance_transactions_shape CHECK ((((action = 'EQUIP'::text) AND (requested_item_id IS NOT NULL) AND (next_item_id = requested_item_id)) OR ((action = 'UNEQUIP'::text) AND (requested_item_id IS NULL) AND (next_item_id IS NULL)))),
    CONSTRAINT world_appearance_transactions_slot_check CHECK ((slot = ANY (ARRAY['BODY'::text, 'FACE'::text, 'HAIR'::text, 'HEAD'::text, 'TOP'::text, 'BOTTOM'::text, 'SHOES'::text, 'BACK'::text, 'ACCESSORY'::text])))
);


--
-- Name: TABLE world_appearance_transactions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_appearance_transactions IS 'INHA WORLD appearance change log. idempotency_key is used once; rows are never updated.';


--
-- Name: world_appearance_record_v1(uuid, text, text, text, text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_appearance_record_v1(p_user uuid, p_key text, p_action text, p_slot text, p_requested text, p_previous text, p_next text) RETURNS private.world_appearance_transactions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_tx private.world_appearance_transactions;
begin
  insert into private.world_appearance_transactions
    (idempotency_key, user_id, action, slot, requested_item_id, previous_item_id, next_item_id)
  values (p_key, p_user, p_action, p_slot, p_requested, p_previous, p_next)
  returning * into v_tx;
  return v_tx;
exception when unique_violation then
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
end;
$$;


--
-- Name: world_appearance_result_v1(private.world_appearance_transactions, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_appearance_result_v1(p_tx private.world_appearance_transactions, p_replayed boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'status', 'SUCCESS',
    'replayed', p_replayed,
    'transactionId', p_tx.transaction_id,
    'action', p_tx.action,
    'slot', p_tx.slot,
    'previousItemId', p_tx.previous_item_id,
    'itemId', p_tx.next_item_id,
    'changed', p_tx.previous_item_id is distinct from p_tx.next_item_id,
    'createdAt', p_tx.created_at,
    -- The loadout as it is now (on a replay: now, not at the original call).
    'loadout', private.world_appearance_loadout_json_v1(p_tx.user_id));
$$;


--
-- Name: world_appearance_slot_ok_v1(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_appearance_slot_ok_v1(p_slot text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select p_slot is not null
     and p_slot = any (array['BODY', 'FACE', 'HAIR', 'HEAD', 'TOP', 'BOTTOM', 'SHOES', 'BACK', 'ACCESSORY']);
$$;


--
-- Name: world_appearance_transactions_append_only_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_appearance_transactions_append_only_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'APPEARANCE_LOG_APPEND_ONLY' using errcode = '42501';
end;
$$;


--
-- Name: world_attendance_caller_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_attendance_caller_v1() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u join public.profiles p on p.user_id = u.id
     where u.id = v_uid and u.is_anonymous is not true and p.is_banned = false) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;


--
-- Name: world_attendance_claim_v1(uuid, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_attendance_claim_v1(p_user uuid, p_today date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := p_user;
  v_today date := p_today;
  v_count integer;
  v_milestone smallint;
  v_daily jsonb;
  v_bonus jsonb;
  v_rewards jsonb := '[]'::jsonb;
begin
  -- One attendance decision per account at a time: concurrent claims wait, then see today's row.
  perform pg_advisory_xact_lock(hashtextextended('world_attendance:' || v_uid::text, 0));
  if exists (select 1 from private.world_attendance_days a where a.user_id = v_uid and a.attendance_date = v_today) then
    return private.world_attendance_state_v1(v_uid, v_today)
      || jsonb_build_object('claimed', false, 'replayed', true, 'rewards', '[]'::jsonb);
  end if;

  select count(*) + 1 into v_count from private.world_attendance_days a
   where a.user_id = v_uid and a.attendance_date >= date_trunc('month', v_today)::date and a.attendance_date < v_today;
  v_milestone := case when v_count in (3, 7, 14, 21) then v_count end;

  v_daily := private.world_reward_grant_v1(v_uid, 'reward.attendance.daily', 'SYSTEM', 'attendance.daily',
    'attendance:daily:' || v_uid::text || ':' || to_char(v_today, 'YYYY-MM-DD'));
  if coalesce(v_daily ->> 'status', 'FAILED') not in ('SUCCESS', 'PARTIAL_SUCCESS') then
    raise exception 'ATTENDANCE_REWARD_FAILED' using errcode = 'P0001';
  end if;
  v_rewards := v_rewards || jsonb_build_array(private.world_daily_quiz_reward_view_v1(v_daily));

  if v_milestone is not null then
    v_bonus := private.world_reward_grant_v1(v_uid, 'reward.attendance.monthly_' || v_milestone, 'SYSTEM',
      'attendance.monthly.' || v_milestone,
      'attendance:monthly:' || v_uid::text || ':' || to_char(v_today, 'YYYY-MM') || ':' || v_milestone);
    if coalesce(v_bonus ->> 'status', 'FAILED') not in ('SUCCESS', 'PARTIAL_SUCCESS') then
      raise exception 'ATTENDANCE_REWARD_FAILED' using errcode = 'P0001';
    end if;
    v_rewards := v_rewards || jsonb_build_array(private.world_daily_quiz_reward_view_v1(v_bonus));
  end if;

  insert into private.world_attendance_days (user_id, attendance_date, daily_reward_transaction_id, milestone,
    milestone_reward_transaction_id)
  values (v_uid, v_today, (v_daily ->> 'rewardTransactionId')::uuid, v_milestone,
    (v_bonus ->> 'rewardTransactionId')::uuid);

  return private.world_attendance_state_v1(v_uid, v_today)
    || jsonb_build_object('claimed', true, 'replayed', false, 'rewards', v_rewards);
end;
$$;


--
-- Name: world_attendance_milestone_coin_v1(integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_attendance_milestone_coin_v1(p_days integer) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select g.amount from private.world_reward_grants g
    join private.world_reward_definitions d on d.reward_id = g.reward_id
   where p_days in (3, 7, 14, 21) and g.reward_id = 'reward.attendance.monthly_' || p_days
     and d.status = 'ACTIVE' and g.grant_type = 'CURRENCY';
$$;


--
-- Name: world_attendance_state_v1(uuid, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_attendance_state_v1(p_user uuid, p_today date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with bounds as (
    select date_trunc('month', p_today)::date as month_start,
           (date_trunc('month', p_today) + interval '1 month')::date as next_month),
  days as (
    select a.attendance_date, a.milestone from private.world_attendance_days a, bounds b
     where a.user_id = p_user and a.attendance_date >= b.month_start and a.attendance_date < b.next_month
       and a.attendance_date <= p_today),
  counted as (select count(*)::int as n from days),
  steps as (select m, private.world_attendance_milestone_coin_v1(m) as coin from unnest(array[3, 7, 14, 21]) m)
  select jsonb_build_object(
    'rewardDate', to_char(p_today, 'YYYY-MM-DD'),
    'month', to_char(p_today, 'YYYY-MM'),
    'claimedToday', exists (select 1 from days where attendance_date = p_today),
    'attendedDays', (select n from counted),
    'attendedDates', coalesce((select jsonb_agg(to_char(attendance_date, 'YYYY-MM-DD') order by attendance_date) from days), '[]'::jsonb),
    'dailyCoin', (select g.amount from private.world_reward_grants g where g.reward_id = 'reward.attendance.daily' and g.grant_type = 'CURRENCY'),
    'nextMilestone', (select jsonb_build_object('days', s.m, 'bonusCoin', s.coin) from steps s
                       where s.m > (select n from counted) order by s.m limit 1),
    'milestones', (select jsonb_agg(jsonb_build_object('days', s.m, 'bonusCoin', s.coin,
                     'claimed', exists (select 1 from days d where d.milestone = s.m)) order by s.m) from steps s));
$$;


--
-- Name: world_attendance_today_v1(timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_attendance_today_v1(p_now timestamp with time zone DEFAULT now()) RETURNS date
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select (p_now at time zone 'Asia/Seoul')::date;
$$;


--
-- Name: world_card(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_card(p_user uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'userId', p.user_id,
    'nickname', p.nickname,
    'title', p.title,
    'avatar', p.avatar_key,
    'inhaVerified',
      (
        (
          u.is_anonymous = false
          and u.email_confirmed_at is not null
          and public.is_inha_mail(u.email)
        )
        or exists (
          select 1
          from public.inha_mail_badges b
          join auth.users bu on bu.id = b.user_id
          where b.user_id = p_user
            and bu.is_anonymous = false
            and bu.email_confirmed_at is not null
        )
      )
  )
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.user_id = p_user
    and p.is_banned = false;
$$;


--
-- Name: world_currency_transactions_append_only_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_currency_transactions_append_only_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;


--
-- Name: world_daily_quiz_account_ok_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_daily_quiz_account_ok_v1(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_user is not null and exists (
    select 1 from auth.users u join public.profiles p on p.user_id = u.id
    where u.id = p_user and u.is_anonymous is not true and p.is_banned = false);
$$;


--
-- Name: world_daily_quiz_caller_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_daily_quiz_caller_v1() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_daily_quiz_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;


--
-- Name: world_daily_quiz_reward_view_v1(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_daily_quiz_reward_view_v1(p_reward jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'rewardId', p_reward -> 'rewardId',
    'rewardVersion', p_reward -> 'rewardVersion',
    'rewardTransactionId', p_reward -> 'rewardTransactionId',
    'status', p_reward -> 'status',
    'replayed', p_reward -> 'replayed',
    'completedAt', p_reward -> 'completedAt',
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantType', e -> 'grantType', 'targetId', e -> 'targetId', 'requested', e -> 'requested',
        'granted', e -> 'granted', 'status', e -> 'status', 'reason', e -> 'reason') order by x.ord)
      from jsonb_array_elements(p_reward -> 'entries') with ordinality as x(e, ord)), '[]'::jsonb));
$$;


--
-- Name: world_daily_quiz_state_v1(uuid, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_daily_quiz_state_v1(p_user uuid, p_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_run private.world_daily_quiz_runs%rowtype;
  v_question private.world_daily_quiz_questions%rowtype;
  v_result jsonb;
begin
  v_result := jsonb_build_object(
    'rewardDate', to_char(p_date, 'YYYY-MM-DD'),
    'rewardPreview', coalesce((
      select jsonb_agg(jsonb_build_object('grantType', g.grant_type, 'targetId', g.target_id, 'amount', g.amount)
                       order by g.position)
        from private.world_reward_grants g
        join private.world_reward_definitions d on d.reward_id = g.reward_id
       where g.reward_id = 'reward.daily.campus_quiz' and d.status = 'ACTIVE'), '[]'::jsonb));
  select * into v_run from private.world_daily_quiz_runs r where r.user_id = p_user and r.reward_date = p_date;
  if not found then
    return v_result || jsonb_build_object('status', 'AVAILABLE',
      'progress', jsonb_build_object('answered', 0, 'total', 3, 'correct', 0));
  end if;
  v_result := v_result || jsonb_build_object(
    'status', v_run.status,
    'runId', v_run.run_id,
    'progress', jsonb_build_object('answered', v_run.answered_count, 'total', 3, 'correct', v_run.correct_count),
    'completedAt', v_run.completed_at);
  if v_run.status = 'ACTIVE' then
    select * into v_question from private.world_daily_quiz_questions q
     where q.question_id = v_run.question_ids[v_run.answered_count + 1];
    v_result := v_result || jsonb_build_object('question', jsonb_build_object(
      'questionId', v_question.question_id,
      'index', v_run.answered_count,
      'prompt', v_question.prompt,
      'options', v_question.options));
  end if;
  return v_result;
end;
$$;


--
-- Name: world_daily_quiz_today_v1(timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_daily_quiz_today_v1(p_now timestamp with time zone DEFAULT now()) RETURNS date
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select (p_now at time zone 'Asia/Seoul')::date;
$$;


--
-- Name: world_events; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_events (
    event_id text NOT NULL,
    title text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_disabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_events_event_id_check CHECK ((event_id ~ '^event\.[a-z0-9_]+$'::text)),
    CONSTRAINT world_events_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80))),
    CONSTRAINT world_events_window CHECK ((starts_at < ends_at))
);


--
-- Name: TABLE world_events; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_events IS 'INHA WORLD event windows. State is computed from server time only.';


--
-- Name: world_event_state_v1(private.world_events, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_event_state_v1(p_event private.world_events, p_now timestamp with time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_event.event_id is null then null
    when p_event.is_disabled then 'DISABLED'
    when p_now < p_event.starts_at then 'SCHEDULED'
    when p_now < p_event.ends_at then 'ACTIVE'
    else 'ENDED' end;
$$;


--
-- Name: world_exp_apply_v1(uuid, bigint, text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_exp_apply_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_total bigint;
  v_before_level integer;
  v_after_level integer;
  v_tx private.world_exp_transactions%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type !~ '^[a-z][a-z0-9_]{0,31}$'
     or p_source_id is null or char_length(p_source_id) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_progression_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  insert into private.world_player_progression(user_id)
  values (p_user)
  on conflict (user_id) do nothing;

  select p.total_exp into strict v_total
    from private.world_player_progression p
   where p.user_id = p_user
   for update;

  select * into v_tx
    from private.world_exp_transactions t
   where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_tx.user_id, v_tx.amount, v_tx.source_type, v_tx.source_id)
       is distinct from (p_user, p_amount, p_source_type, p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_exp_result_v1(v_tx, 'ALREADY_PROCESSED');
  end if;

  if v_total > 9223372036854775807::bigint - p_amount then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  v_before_level := private.world_level_for_exp_v1(v_total);
  v_after_level := private.world_level_for_exp_v1(v_total + p_amount);

  begin
    insert into private.world_exp_transactions(
      user_id, amount, exp_before, exp_after, level_before, level_after,
      source_type, source_id, idempotency_key)
    values (
      p_user, p_amount, v_total, v_total + p_amount, v_before_level, v_after_level,
      p_source_type, p_source_id, p_idempotency_key)
    returning * into v_tx;
  exception when unique_violation then
    select * into strict v_tx
      from private.world_exp_transactions t
     where t.idempotency_key = p_idempotency_key;
    if (v_tx.user_id, v_tx.amount, v_tx.source_type, v_tx.source_id)
       is distinct from (p_user, p_amount, p_source_type, p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_exp_result_v1(v_tx, 'ALREADY_PROCESSED');
  end;

  update private.world_player_progression p
     set total_exp = v_tx.exp_after,
         version = p.version + 1,
         updated_at = now()
   where p.user_id = p_user;

  return private.world_exp_result_v1(v_tx, 'SUCCESS');
end;
$_$;


--
-- Name: world_exp_transactions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_exp_transactions (
    transaction_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    exp_before bigint NOT NULL,
    exp_after bigint NOT NULL,
    level_before integer NOT NULL,
    level_after integer NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_exp_transactions_amount_check CHECK ((amount > 0)),
    CONSTRAINT world_exp_transactions_exp_after_check CHECK ((exp_after >= 0)),
    CONSTRAINT world_exp_transactions_exp_before_check CHECK ((exp_before >= 0)),
    CONSTRAINT world_exp_transactions_idempotency_key_check CHECK ((idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'::text)),
    CONSTRAINT world_exp_transactions_level_after_check CHECK ((level_after >= 1)),
    CONSTRAINT world_exp_transactions_level_before_check CHECK ((level_before >= 1)),
    CONSTRAINT world_exp_transactions_level_monotonic CHECK ((level_after >= level_before)),
    CONSTRAINT world_exp_transactions_math CHECK ((exp_after = (exp_before + amount))),
    CONSTRAINT world_exp_transactions_source_id_check CHECK (((char_length(source_id) >= 1) AND (char_length(source_id) <= 200))),
    CONSTRAINT world_exp_transactions_source_type_check CHECK ((source_type ~ '^[a-z][a-z0-9_]{0,31}$'::text))
);


--
-- Name: TABLE world_exp_transactions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_exp_transactions IS 'INHA WORLD EXP ledger. Positive grants only; rows are immutable and idempotency_key is globally unique.';


--
-- Name: world_exp_result_v1(private.world_exp_transactions, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_exp_result_v1(p_tx private.world_exp_transactions, p_status text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'status', p_status,
    'transactionId', p_tx.transaction_id,
    'userId', p_tx.user_id,
    'amount', p_tx.amount,
    'expBefore', p_tx.exp_before,
    'expAfter', p_tx.exp_after,
    'levelBefore', p_tx.level_before,
    'levelAfter', p_tx.level_after,
    'leveledUp', p_tx.level_after > p_tx.level_before,
    'sourceType', p_tx.source_type,
    'sourceId', p_tx.source_id,
    'idempotencyKey', p_tx.idempotency_key,
    'createdAt', p_tx.created_at
  );
$$;


--
-- Name: world_exp_transactions_append_only_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_exp_transactions_append_only_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;


--
-- Name: world_guestbook_entry_json(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_guestbook_entry_json(p_entry_id uuid, p_viewer uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'id', g.id,
    'userId', g.user_id,
    'nickname', p.nickname,
    'avatar', p.avatar_key,
    'inhaVerified',
      (
        (
          u.is_anonymous = false
          and u.email_confirmed_at is not null
          and public.is_inha_mail(u.email)
        )
        or exists (
          select 1
          from public.inha_mail_badges b
          join auth.users bu on bu.id = b.user_id
          where b.user_id = g.user_id
            and bu.is_anonymous = false
            and bu.email_confirmed_at is not null
        )
      ),
    'content', g.content,
    'createdAt', g.created_at,
    'updatedAt', g.updated_at,
    'mine', g.user_id = p_viewer
  )
  from public.world_guestbook_entries g
  join public.profiles p on p.user_id = g.user_id and p.is_banned = false
  join auth.users u on u.id = g.user_id and u.is_anonymous = false
  where g.id = p_entry_id
    and g.is_hidden = false;
$$;


--
-- Name: world_guestbook_normalize(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_guestbook_normalize() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.content := btrim(new.content);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;


--
-- Name: world_inventory_account_ok_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_inventory_account_ok_v1(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_user is not null and exists (
    select 1
    from auth.users u
    join public.profiles p on p.user_id = u.id
    where u.id = p_user
      and u.is_anonymous is not true
      and p.is_banned = false
  );
$$;


--
-- Name: world_item_grants; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_item_grants (
    grant_id text NOT NULL,
    user_id uuid NOT NULL,
    item_id text NOT NULL,
    result text NOT NULL,
    quantity_requested integer NOT NULL,
    quantity_before integer NOT NULL,
    quantity_granted integer NOT NULL,
    quantity_after integer NOT NULL,
    source_type text NOT NULL,
    source_ref text NOT NULL,
    event_id text,
    acquisition_metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_item_grants_acquisition_metadata_check CHECK (((acquisition_metadata IS NULL) OR ((jsonb_typeof(acquisition_metadata) = 'object'::text) AND (octet_length((acquisition_metadata)::text) <= 2048)))),
    CONSTRAINT world_item_grants_event_id_check CHECK (((event_id IS NULL) OR (event_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text))),
    CONSTRAINT world_item_grants_grant_id_check CHECK ((grant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'::text)),
    CONSTRAINT world_item_grants_quantity_after_check CHECK ((quantity_after >= 0)),
    CONSTRAINT world_item_grants_quantity_before_check CHECK ((quantity_before >= 0)),
    CONSTRAINT world_item_grants_quantity_granted_check CHECK ((quantity_granted >= 0)),
    CONSTRAINT world_item_grants_quantity_math CHECK ((quantity_after = (quantity_before + quantity_granted))),
    CONSTRAINT world_item_grants_quantity_requested_check CHECK ((quantity_requested >= 1)),
    CONSTRAINT world_item_grants_result CHECK ((((result = 'GRANTED'::text) AND (quantity_granted = quantity_requested)) OR ((result = 'ALREADY_OWNED'::text) AND (quantity_granted = 0)))),
    CONSTRAINT world_item_grants_result_check CHECK ((result = ANY (ARRAY['GRANTED'::text, 'ALREADY_OWNED'::text]))),
    CONSTRAINT world_item_grants_source_ref_check CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 200))),
    CONSTRAINT world_item_grants_source_type_check CHECK ((source_type = ANY (ARRAY['DEFAULT'::text, 'QUEST'::text, 'EXPLORATION'::text, 'ACHIEVEMENT'::text, 'EVENT'::text, 'MINIGAME'::text, 'SHOP'::text, 'INHAGAME_REWARD'::text, 'SYSTEM'::text, 'ADMIN'::text])))
);


--
-- Name: TABLE world_item_grants; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_item_grants IS 'INHA WORLD item grant log. grant_id is the idempotency key; rows are never updated.';


--
-- Name: world_inventory_grant_result_v1(private.world_item_grants, text, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_inventory_grant_result_v1(p_grant private.world_item_grants, p_status text, p_acquired_at timestamp with time zone) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'status', p_status,
    'originalStatus', p_grant.result,
    'grantId', p_grant.grant_id,
    'userId', p_grant.user_id,
    'itemId', p_grant.item_id,
    'quantityBefore', p_grant.quantity_before,
    'quantityGranted', p_grant.quantity_granted,
    'quantityAfter', p_grant.quantity_after,
    'sourceType', p_grant.source_type,
    'sourceRef', p_grant.source_ref,
    'eventId', p_grant.event_id,
    'grantedAt', p_grant.created_at,
    'acquiredAt', p_acquired_at
  );
$$;


--
-- Name: world_inventory_grant_v1(uuid, text, integer, text, text, text, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_inventory_grant_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text, p_metadata jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_catalog private.world_item_catalog%rowtype;
  v_grant private.world_item_grants%rowtype;
  v_owned private.world_player_items%rowtype;
  v_before integer;
  v_result text;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_item_id is null or p_item_id !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' or char_length(p_item_id) > 80 then
    raise exception 'INVALID_ITEM_ID' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'DEFAULT', 'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'SHOP',
       'INHAGAME_REWARD', 'SYSTEM', 'ADMIN')
     or p_source_ref is null or char_length(p_source_ref) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_event_id is not null and p_event_id !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' then
    raise exception 'INVALID_EVENT_ID' using errcode = '22023';
  end if;
  if p_metadata is not null and (jsonb_typeof(p_metadata) <> 'object'
       or octet_length(p_metadata::text) > 2048) then
    raise exception 'INVALID_METADATA' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  -- Serialize every grant for this account: idempotency and ownership are decided under one lock.
  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || p_user::text, 0));

  select * into v_grant from private.world_item_grants g where g.grant_id = p_idempotency_key;
  if found then
    if (v_grant.user_id, v_grant.item_id, v_grant.quantity_requested, v_grant.source_type,
        v_grant.source_ref, v_grant.event_id)
       is distinct from (p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_event_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select * into v_owned from private.world_player_items i
     where i.user_id = p_user and i.item_id = p_item_id;
    return private.world_inventory_grant_result_v1(v_grant, 'ALREADY_PROCESSED', v_owned.acquired_at);
  end if;

  select * into v_catalog from private.world_item_catalog c where c.item_id = p_item_id;
  if not found then
    raise exception 'UNKNOWN_ITEM' using errcode = '22023';
  end if;
  if v_catalog.status in ('DISABLED', 'HIDDEN') then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_catalog.ownership_policy = 'UNIQUE' and p_quantity <> 1 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  select * into v_owned from private.world_player_items i
   where i.user_id = p_user and i.item_id = p_item_id
     for update;
  v_before := coalesce(v_owned.quantity, 0);

  if v_catalog.ownership_policy = 'UNIQUE' and v_before > 0 then
    v_result := 'ALREADY_OWNED';
  else
    if v_catalog.ownership_policy = 'STACKABLE' and v_before + p_quantity > v_catalog.max_stack then
      raise exception 'MAX_STACK_EXCEEDED' using errcode = 'P0001';
    end if;
    v_result := 'GRANTED';
  end if;

  begin
    insert into private.world_item_grants (
      grant_id, user_id, item_id, result, quantity_requested,
      quantity_before, quantity_granted, quantity_after,
      source_type, source_ref, event_id, acquisition_metadata)
    values (
      p_idempotency_key, p_user, p_item_id, v_result, p_quantity,
      v_before, case when v_result = 'GRANTED' then p_quantity else 0 end,
      v_before + case when v_result = 'GRANTED' then p_quantity else 0 end,
      p_source_type, p_source_ref, p_event_id, p_metadata)
    returning * into v_grant;
  exception when unique_violation then
    -- Same-account retries are resolved above under the lock, so this key was committed
    -- concurrently for another account: never apply it twice.
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end;

  if v_result = 'GRANTED' then
    if v_before = 0 then
      insert into private.world_player_items (
        user_id, item_id, quantity, source_type, source_ref, event_id, grant_id, acquisition_metadata)
      values (
        p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_event_id, p_idempotency_key, p_metadata)
      returning * into v_owned;
    else
      -- STACKABLE top-up: the first acquisition stays the row's provenance; this grant is in the log.
      update private.world_player_items i
         set quantity = v_grant.quantity_after, updated_at = now()
       where i.id = v_owned.id
      returning * into v_owned;
    end if;
  end if;

  return private.world_inventory_grant_result_v1(v_grant, v_result, v_owned.acquired_at);
end;
$_$;


--
-- Name: world_player_items; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_player_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    item_id text NOT NULL,
    quantity integer NOT NULL,
    source_type text NOT NULL,
    source_ref text NOT NULL,
    event_id text,
    grant_id text NOT NULL,
    acquisition_metadata jsonb,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_player_items_item_id_check CHECK ((item_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text)),
    CONSTRAINT world_player_items_quantity_check CHECK ((quantity >= 1))
);


--
-- Name: TABLE world_player_items; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_player_items IS 'INHA WORLD C1 ownership. Written only by private.world_inventory_grant_v1; provenance is the first acquisition.';


--
-- Name: world_inventory_item_json_v1(private.world_player_items, text, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_inventory_item_json_v1(p_item private.world_player_items, p_catalog_status text, p_server_view boolean) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'itemId', p_item.item_id,
    'quantity', p_item.quantity,
    'acquiredAt', p_item.acquired_at,
    'updatedAt', p_item.updated_at,
    'sourceType', p_item.source_type,
    'sourceRef', p_item.source_ref,
    'eventId', p_item.event_id,
    -- A catalog miss is reported, never dropped: the owned row stays readable.
    'catalogStatus', coalesce(p_catalog_status, 'UNKNOWN_ITEM')
  ) || case when p_server_view then jsonb_build_object(
    'grantId', p_item.grant_id,
    'acquisitionMetadata', p_item.acquisition_metadata) else '{}'::jsonb end;
$$;


--
-- Name: world_item_grants_append_only_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_item_grants_append_only_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'GRANT_LOG_APPEND_ONLY' using errcode = '42501';
end;
$$;


--
-- Name: world_landlord_pick_survivor_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_landlord_pick_survivor_v1() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_byte integer;
begin
  loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    exit when v_byte < 255;
  end loop;
  return (array['ZUE-MG-001', 'ZUE-MG-002', 'ZUE-MG-003', 'ZUE-MG-004', 'ZUE-MG-005'])[v_byte % 5 + 1];
end;
$$;


--
-- Name: world_level_for_exp_v1(bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_level_for_exp_v1(p_total_exp bigint) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_level integer;
begin
  if p_total_exp is null or p_total_exp < 0 then
    raise exception 'INVALID_TOTAL_EXP' using errcode = '22023';
  end if;

  select t.level into v_level
    from private.world_level_thresholds t
   where t.min_total_exp <= p_total_exp
   order by t.level desc
   limit 1;

  if v_level is null then
    raise exception 'PROGRESSION_CONFIG_INVALID' using errcode = 'P0001';
  end if;
  return v_level;
end;
$$;


--
-- Name: world_level_thresholds_immutable_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_level_thresholds_immutable_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'PROGRESSION_CONFIG_IMMUTABLE' using errcode = '42501';
end;
$$;


--
-- Name: world_level_thresholds_validate_insert_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_level_thresholds_validate_insert_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_max_level integer;
  v_max_exp bigint;
begin
  select max(t.level), max(t.min_total_exp)
    into v_max_level, v_max_exp
    from private.world_level_thresholds t;

  if v_max_level is null then
    if new.level <> 1 or new.min_total_exp <> 0 then
      raise exception 'PROGRESSION_CONFIG_INVALID' using errcode = '23514';
    end if;
  elsif new.level <> v_max_level + 1 or new.min_total_exp <= v_max_exp then
    raise exception 'PROGRESSION_CONFIG_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;


--
-- Name: world_lock_pair(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_lock_pair(p_a uuid, p_b uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select pg_advisory_xact_lock(hashtextextended('world_pair:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0));
$$;


--
-- Name: world_mcm_account_ok_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_mcm_account_ok_v1(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_user is not null and exists (
    select 1 from auth.users u join public.profiles p on p.user_id = u.id
    where u.id = p_user and u.is_anonymous is not true and p.is_banned = false);
$$;


--
-- Name: world_mcm_claim_result_v1(text, text, boolean, uuid, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_mcm_claim_result_v1(p_claim_type text, p_status text, p_replayed boolean, p_reward_transaction_id uuid, p_claimed_at timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'claimType', p_claim_type,
    'status', p_status,
    'replayed', p_replayed,
    'rewardId', t.reward_id,
    'rewardStatus', t.status,
    'rewardTransactionId', t.reward_transaction_id,
    'claimedAt', p_claimed_at,
    'rewardResult', jsonb_build_object(
      'status', t.status,
      'completedAt', t.completed_at,
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantType', e.grant_type,
          'targetId', e.target_id,
          'requested', e.requested,
          'granted', e.granted,
          'status', e.status,
          'reason', e.reason) order by e.position)
        from private.world_reward_transaction_entries e
        where e.reward_transaction_id = t.reward_transaction_id), '[]'::jsonb)))
  from private.world_reward_transactions t
  where t.reward_transaction_id = p_reward_transaction_id;
$$;


--
-- Name: world_mcm_claim_reward_v1(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_mcm_claim_reward_v1(p_user uuid, p_claim_type text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_reward_id text;
  v_source_type text;
  v_source_id text;
  v_key text;
  v_source_at timestamptz;
  v_claim private.world_mcm_reward_claims%rowtype;
  v_reward jsonb;
begin
  if p_claim_type = 'MAIN_CLEAR' then
    v_reward_id := 'reward.event.mcm_2026_main_clear';
    v_source_type := 'EVENT';
    v_source_id := 'event.mcm_2026:main_clear';
    v_key := 'event:mcm_2026:' || p_user::text || ':main_clear';
  elsif p_claim_type = 'LANDLORD_FIRST_CLEAR' then
    v_reward_id := 'reward.minigame.landlord_first_clear';
    v_source_type := 'MINIGAME';
    v_source_id := 'event.mcm_2026:landlord_first_clear';
    v_key := 'minigame:landlord:' || p_user::text || ':first_clear';
  else
    raise exception 'INVALID_CLAIM_TYPE' using errcode = '22023';
  end if;

  -- One claim decision per account at a time; concurrent calls wait, then see the final claim.
  perform pg_advisory_xact_lock(hashtextextended('world_mcm_claim:' || p_user::text, 0));

  select * into v_claim from private.world_mcm_reward_claims c
   where c.user_id = p_user and c.claim_type = p_claim_type;
  if found then
    return private.world_mcm_claim_result_v1(
      p_claim_type, 'ALREADY_CLAIMED', true, v_claim.reward_transaction_id, v_claim.claimed_at);
  end if;

  -- Eligibility comes only from the server-verified completion records (never from client state).
  if p_claim_type = 'MAIN_CLEAR' then
    select p.completed_at into v_source_at from private.world_event_progress p
     where p.user_id = p_user and p.event_id = 'event.mcm_2026' and p.stage = 3;
  else
    select c.first_cleared_at into v_source_at from private.world_landlord_first_clears c
     where c.user_id = p_user and c.event_id = 'event.mcm_2026';
  end if;
  if v_source_at is null then
    raise exception 'CLAIM_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  -- P0-C executes (or replays / resumes) the reward; its grants come from the RewardDefinition.
  v_reward := private.world_reward_grant_v1(p_user, v_reward_id, v_source_type, v_source_id, v_key);

  if coalesce(v_reward ->> 'status', 'FAILED') not in ('SUCCESS', 'PARTIAL_SUCCESS') then
    -- Not final: commit P0-C's resumable FAILED state, keep completion, no claim row.
    return private.world_mcm_claim_result_v1(
      p_claim_type, 'REWARD_FAILED', false, (v_reward ->> 'rewardTransactionId')::uuid, null);
  end if;

  insert into private.world_mcm_reward_claims (
    user_id, claim_type, event_id, reward_id, idempotency_key, reward_transaction_id, reward_status,
    source_completed_at)
  values (
    p_user, p_claim_type, 'event.mcm_2026', v_reward_id, v_key, (v_reward ->> 'rewardTransactionId')::uuid,
    v_reward ->> 'status', v_source_at)
  returning * into v_claim;

  -- replayed = true when P0-C returned a stored result (the reward ran before the claim was
  -- finalized): the claim is recovered and no value moved in this call.
  return private.world_mcm_claim_result_v1(
    p_claim_type, 'CLAIMED', coalesce((v_reward ->> 'replayed')::boolean, false),
    v_claim.reward_transaction_id, v_claim.claimed_at);
end;
$$;


--
-- Name: world_mcm_reward_claims_final_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_mcm_reward_claims_final_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'CLAIM_FINAL' using errcode = '42501';
end;
$$;


--
-- Name: world_mcm_state_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_mcm_state_v1(p_user uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'eventId', ev.event_id,
    'eventState', private.world_event_state_v1(ev, now()),
    'startsAt', ev.starts_at,
    'endsAt', ev.ends_at,
    'serverNow', now(),
    'progress', jsonb_build_object(
      'stage', case coalesce(p.stage, 0) when 0 then 'NOT_STARTED' when 1 then 'STARTED'
                 when 2 then 'VENUE_UNLOCKED' else 'COMPLETED' end,
      'investigated', coalesce(to_jsonb(p.investigated), '[]'::jsonb),
      'startedAt', p.started_at,
      'venueUnlockedAt', p.venue_unlocked_at,
      'completedAt', p.completed_at),
    'landlord', jsonb_build_object(
      'firstClearedAt', c.first_cleared_at,
      'activeRun', (select jsonb_build_object('runId', r.run_id, 'startedAt', r.started_at,
                      'deadlineAt', r.deadline_at, 'wrongCount', r.wrong_count)
                      from private.world_landlord_runs r
                     where r.user_id = p_user and r.status = 'ACTIVE' and r.deadline_at > now())))
  from private.world_events ev
  left join private.world_event_progress p on p.user_id = p_user and p.event_id = ev.event_id
  left join private.world_landlord_first_clears c on c.user_id = p_user and c.event_id = ev.event_id
  where ev.event_id = 'event.mcm_2026';
$$;


--
-- Name: world_mcm_try_complete_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_mcm_try_complete_v1(p_user uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update private.world_event_progress e
     set stage = 3, completed_at = now(), updated_at = now()
   where e.user_id = p_user and e.event_id = 'event.mcm_2026' and e.stage = 2
     and exists (select 1 from private.world_landlord_first_clears c
                  where c.user_id = p_user and c.event_id = 'event.mcm_2026');
$$;


--
-- Name: world_ops_read_allowed_v1(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_ops_read_allowed_v1(p_token text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    (select auth.uid()) is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, true) = false
    and exists (
      select 1
      from private.world_staff_assignments a
      join private.world_staff_role_permissions rp on rp.role = a.role
      join public.profiles p on p.user_id = a.user_id
      where a.user_id = (select auth.uid())
        and a.active = true
        and p.is_banned = false
        and rp.permission = 'ops.read'
    );
$$;


--
-- Name: FUNCTION world_ops_read_allowed_v1(p_token text); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.world_ops_read_allowed_v1(p_token text) IS 'Allows legacy OPS credential or an authenticated active staff account with ops.read.';


--
-- Name: world_player_level_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_player_level_v1(p_user uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.world_level_for_exp_v1(coalesce(
    (select p.total_exp from private.world_player_progression p where p.user_id = p_user), 0));
$$;


--
-- Name: world_progression_account_ok_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_progression_account_ok_v1(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_user is not null and exists (
    select 1
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.id = p_user
       and u.is_anonymous is not true
       and p.is_banned = false
  );
$$;


--
-- Name: world_progression_snapshot_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_progression_snapshot_v1(p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_total bigint := 0;
  v_level integer;
  v_start bigint;
  v_next bigint;
  v_max integer;
begin
  select p.total_exp into v_total
    from private.world_player_progression p
   where p.user_id = p_user;
  v_total := coalesce(v_total, 0);

  v_level := private.world_level_for_exp_v1(v_total);
  select t.min_total_exp into strict v_start
    from private.world_level_thresholds t where t.level = v_level;
  select t.min_total_exp into v_next
    from private.world_level_thresholds t where t.level = v_level + 1;
  select max(t.level) into v_max from private.world_level_thresholds t;

  if v_max is null then
    raise exception 'PROGRESSION_CONFIG_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'userId', p_user,
    'totalExp', v_total,
    'level', v_level,
    'currentLevelStartExp', v_start,
    'nextLevelExp', v_next,
    'progressExp', v_total - v_start,
    'progressRequired', case when v_next is null then null else v_next - v_start end,
    'maxDefinedLevel', v_max,
    'isMaxLevel', v_next is null
  );
end;
$$;


--
-- Name: world_purchase_result_v1(uuid, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_purchase_result_v1(p_purchase_id uuid, p_replayed boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'status', 'SUCCESS',
    'replayed', p_replayed,
    'purchaseId', p.purchase_id,
    'shopId', p.shop_id,
    'listingId', p.listing_id,
    'idempotencyKey', p.idempotency_key,
    'item', jsonb_build_object(
      'itemId', p.item_id,
      'quantity', p.quantity,
      'grantId', p.inventory_grant_id,
      'acquiredAt', (select i.acquired_at from private.world_player_items i
                      where i.user_id = p.user_id and i.item_id = p.item_id)),
    'wallet', jsonb_build_object(
      'currencyId', p.currency_id,
      'price', p.price,
      'balanceBefore', p.balance_before,
      'balanceAfter', p.balance_after,
      'transactionId', p.wallet_transaction_id),
    'createdAt', p.created_at)
  from private.world_purchase_transactions p
  where p.purchase_id = p_purchase_id;
$$;


--
-- Name: world_purchase_transactions_append_only_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_purchase_transactions_append_only_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'PURCHASE_APPEND_ONLY' using errcode = '42501';
end;
$$;


--
-- Name: world_relationship(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_relationship(p_caller uuid, p_target uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when exists (select 1 from public.world_user_blocks b where b.blocker_id = p_caller and b.blocked_id = p_target) then 'blocked_by_me'
    when exists (select 1 from public.world_user_blocks b where b.blocker_id = p_target and b.blocked_id = p_caller) then 'unavailable'
    else coalesce((
      select case when f.status = 'accepted' then 'friends'
                  when f.requested_by = p_caller then 'outgoing'
                  else 'incoming' end
      from public.world_friendships f
      where f.user_low = least(p_caller, p_target) and f.user_high = greatest(p_caller, p_target)
    ), 'none')
  end;
$$;


--
-- Name: world_reward_final_rows_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_reward_final_rows_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.status <> 'FAILED' then
    raise exception 'REWARD_RESULT_FINAL' using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: world_reward_grant_v1(uuid, text, text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_def private.world_reward_definitions%rowtype;
  v_tx private.world_reward_transactions%rowtype;
  v_entry private.world_reward_transaction_entries%rowtype;
  v_child jsonb;
  v_child_status text;
  v_status text;
  v_granted bigint;
  v_reason text;
  v_child_tx text;
  v_final text;
begin
  -- Structural preflight: nothing is written if any of these fail.
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'INHAGAME_REWARD', 'SYSTEM', 'ADMIN')
     or p_source_id is null or char_length(p_source_id) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_reward_id is null then
    raise exception 'UNKNOWN_REWARD' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  -- One reward execution per account at a time; a concurrent retry waits, then replays.
  perform pg_advisory_xact_lock(hashtextextended('world_reward:' || p_user::text, 0));

  select * into v_tx from private.world_reward_transactions t where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_tx.user_id, v_tx.reward_id, v_tx.source_type, v_tx.source_id)
       is distinct from (p_user, p_reward_id, p_source_type, p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    if v_tx.status <> 'FAILED' then
      return private.world_reward_result_v1(v_tx.reward_transaction_id, true);
    end if;
    -- Resume a FAILED execution from its own snapshot, not from today's definition.
    update private.world_reward_transactions t
       set attempts = t.attempts + 1, updated_at = now()
     where t.reward_transaction_id = v_tx.reward_transaction_id
    returning * into v_tx;
  else
    select * into v_def from private.world_reward_definitions d where d.reward_id = p_reward_id;
    if not found then
      raise exception 'UNKNOWN_REWARD' using errcode = '22023';
    end if;
    if v_def.status <> 'ACTIVE' then
      raise exception 'REWARD_INACTIVE' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.world_reward_grants g where g.reward_id = p_reward_id) then
      raise exception 'REWARD_EMPTY' using errcode = 'P0001';
    end if;
    if exists (select 1 from private.world_reward_grants g
                where g.reward_id = p_reward_id and g.grant_type not in ('CURRENCY', 'ITEM', 'EXP')) then
      raise exception 'REWARD_UNSUPPORTED_GRANT' using errcode = 'P0001';
    end if;

    begin
      -- Inserted as FAILED (not final) and settled below in this same transaction.
      insert into private.world_reward_transactions (
        user_id, reward_id, reward_version, event_id, source_type, source_id, idempotency_key, status)
      values (
        p_user, p_reward_id, v_def.version, v_def.event_id, p_source_type, p_source_id, p_idempotency_key, 'FAILED')
      returning * into v_tx;
    exception when unique_violation then
      -- Same-account retries are resolved above under the lock; this key belongs to another account.
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end;

    insert into private.world_reward_transaction_entries (
      reward_transaction_id, grant_entry_id, position, grant_type, target_id, requested,
      status, reason, child_idempotency_key)
    select v_tx.reward_transaction_id, g.grant_entry_id, g.position, g.grant_type, g.target_id, g.amount,
           'FAILED', 'NOT_ATTEMPTED', 'reward/' || p_idempotency_key || '/' || g.grant_entry_id
      from private.world_reward_grants g
     where g.reward_id = p_reward_id;
  end if;

  for v_entry in
    select * from private.world_reward_transaction_entries e
     where e.reward_transaction_id = v_tx.reward_transaction_id and e.status = 'FAILED'
     order by e.position
  loop
    begin
      if v_entry.grant_type = 'CURRENCY' then
        v_child := private.world_wallet_apply_v1(
          p_user, v_entry.target_id, v_entry.requested, 'REWARD', 'reward',
          v_tx.reward_id || ':' || v_tx.reward_transaction_id::text, v_entry.child_idempotency_key, null);
        v_status := 'GRANTED';
        v_granted := v_entry.requested;
        v_reason := null;
        v_child_tx := v_child ->> 'transactionId';
      elsif v_entry.grant_type = 'ITEM' then
        v_child := private.world_inventory_grant_v1(
          p_user, v_entry.target_id, v_entry.requested::integer, v_tx.source_type, v_tx.reward_id,
          v_entry.child_idempotency_key, v_tx.event_id,
          jsonb_build_object('rewardTransactionId', v_tx.reward_transaction_id, 'sourceId', v_tx.source_id));
        v_child_status := case when v_child ->> 'status' = 'ALREADY_PROCESSED'
                               then v_child ->> 'originalStatus' else v_child ->> 'status' end;
        -- Readback: the item must be owned now, whether granted here or already owned.
        if not exists (select 1 from private.world_player_items i
                        where i.user_id = p_user and i.item_id = v_entry.target_id) then
          raise exception 'ITEM_READBACK_FAILED';
        end if;
        if v_child_status = 'GRANTED' then
          v_status := 'GRANTED';
          v_granted := v_entry.requested;
          v_reason := null;
        else
          v_status := 'SKIPPED';
          v_granted := 0;
          v_reason := 'ALREADY_OWNED';
        end if;
        v_child_tx := v_child ->> 'grantId';

      elsif v_entry.grant_type = 'EXP' then
        v_child := private.world_exp_apply_v1(
          p_user,
          v_entry.requested,
          'reward',
          v_tx.reward_id || ':' || v_tx.reward_transaction_id::text || ':' || v_entry.grant_entry_id,
          v_entry.child_idempotency_key);
        v_child_status := v_child ->> 'status';
        if v_child_status is null
           or v_child_status not in ('SUCCESS', 'ALREADY_PROCESSED')
           or (v_child ->> 'amount')::bigint is distinct from v_entry.requested
           or v_child ->> 'transactionId' is null then
          raise exception 'EXP_READBACK_FAILED';
        end if;
        v_status := 'GRANTED';
        v_granted := v_entry.requested;
        v_reason := null;
        v_child_tx := v_child ->> 'transactionId';

      else
        -- Defensive only: COLLECTION is rejected by preflight before a transaction exists.
        raise exception 'REWARD_UNSUPPORTED_GRANT';
      end if;
    exception when others then
      -- The child call's own writes were rolled back with this subtransaction; siblings stand.
      v_status := 'FAILED';
      v_granted := 0;
      v_reason := left(sqlerrm, 200);
      v_child_tx := null;
    end;

    update private.world_reward_transaction_entries e
       set status = v_status, granted = v_granted, reason = v_reason,
           child_transaction_id = v_child_tx, attempts = e.attempts + 1, updated_at = now()
     where e.reward_transaction_id = v_entry.reward_transaction_id
       and e.grant_entry_id = v_entry.grant_entry_id;
  end loop;

  select case
           when bool_or(e.status = 'FAILED') then 'FAILED'
           when bool_or(e.status = 'SKIPPED') then 'PARTIAL_SUCCESS'
           else 'SUCCESS' end
    into v_final
    from private.world_reward_transaction_entries e
   where e.reward_transaction_id = v_tx.reward_transaction_id;

  update private.world_reward_transactions t
     set status = v_final, updated_at = now(),
         completed_at = case when v_final = 'FAILED' then null else now() end
   where t.reward_transaction_id = v_tx.reward_transaction_id;

  return private.world_reward_result_v1(v_tx.reward_transaction_id, false);
end;
$_$;


--
-- Name: world_reward_grants_validate_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_reward_grants_validate_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_policy text;
  v_max integer;
begin
  if new.grant_type = 'CURRENCY' then
    if not exists (select 1 from private.world_currencies c where c.currency_id = new.target_id) then
      raise exception 'REWARD_UNKNOWN_CURRENCY' using errcode = '23503';
    end if;
  elsif new.grant_type = 'ITEM' then
    select c.ownership_policy, c.max_stack into v_policy, v_max
      from private.world_item_catalog c where c.item_id = new.target_id;
    if not found then
      raise exception 'REWARD_UNKNOWN_ITEM' using errcode = '23503';
    end if;
    if (v_policy = 'UNIQUE' and new.amount <> 1) or (v_policy = 'STACKABLE' and new.amount > v_max) then
      raise exception 'REWARD_INVALID_QUANTITY' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: world_reward_result_v1(uuid, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_reward_result_v1(p_reward_transaction_id uuid, p_replayed boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'rewardTransactionId', t.reward_transaction_id,
    'rewardId', t.reward_id,
    'rewardVersion', t.reward_version,
    'userId', t.user_id,
    'eventId', t.event_id,
    'sourceType', t.source_type,
    'sourceId', t.source_id,
    'idempotencyKey', t.idempotency_key,
    'status', t.status,
    'replayed', p_replayed,
    'attempts', t.attempts,
    'createdAt', t.created_at,
    'completedAt', t.completed_at,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantEntryId', e.grant_entry_id,
        'grantType', e.grant_type,
        'targetId', e.target_id,
        'requested', e.requested,
        'granted', e.granted,
        'status', e.status,
        'reason', e.reason,
        'childIdempotencyKey', e.child_idempotency_key,
        'childTransactionId', e.child_transaction_id,
        'attempts', e.attempts) order by e.position)
      from private.world_reward_transaction_entries e
      where e.reward_transaction_id = t.reward_transaction_id), '[]'::jsonb))
  from private.world_reward_transactions t
  where t.reward_transaction_id = p_reward_transaction_id;
$$;


--
-- Name: world_room_caller_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_room_caller_v1() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = v_uid
      and p.is_banned = false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  return v_uid;
end;
$$;


--
-- Name: world_shop_listings; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_shop_listings (
    listing_id text NOT NULL,
    shop_id text NOT NULL,
    "position" smallint NOT NULL,
    item_id text NOT NULL,
    currency_id text NOT NULL,
    price bigint NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    required_level integer,
    purchase_limit integer,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_shop_listings_listing_id_check CHECK (((listing_id ~ '^offer\.[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text) AND (char_length(listing_id) <= 80))),
    CONSTRAINT world_shop_listings_position_check CHECK (("position" >= 0)),
    CONSTRAINT world_shop_listings_price_check CHECK ((price > 0)),
    CONSTRAINT world_shop_listings_purchase_limit_check CHECK (((purchase_limit IS NULL) OR (purchase_limit >= 1))),
    CONSTRAINT world_shop_listings_quantity_check CHECK ((quantity >= 1)),
    CONSTRAINT world_shop_listings_required_level_check CHECK (((required_level IS NULL) OR (required_level >= 1))),
    CONSTRAINT world_shop_listings_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'LOCKED'::text, 'DISABLED'::text, 'HIDDEN'::text]))),
    CONSTRAINT world_shop_listings_window CHECK (((start_at IS NULL) OR (end_at IS NULL) OR (start_at < end_at)))
);


--
-- Name: TABLE world_shop_listings; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_shop_listings IS 'INHA WORLD shop listings: price, currency, quantity, level, limit and window. LOCKED = visible, not purchasable.';


--
-- Name: COLUMN world_shop_listings.required_level; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON COLUMN private.world_shop_listings.required_level IS 'Minimum server-derived Level (P0-F0 EXP + thresholds) to buy; null = no gate. Below it: LEVEL_REQUIRED.';


--
-- Name: world_shop_listing_block_v2(private.world_shop_listings, timestamp with time zone, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_shop_listing_block_v2(p_listing private.world_shop_listings, p_now timestamp with time zone, p_player_level integer) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when p_listing.status = 'LOCKED' then 'LISTING_LOCKED'
    when p_listing.status <> 'ACTIVE' then 'LISTING_INACTIVE'
    when p_listing.start_at is not null and p_now < p_listing.start_at then 'LISTING_NOT_STARTED'
    when p_listing.end_at is not null and p_now >= p_listing.end_at then 'LISTING_EXPIRED'
    when p_listing.required_level is not null
         and (p_player_level is null or p_player_level < p_listing.required_level) then 'LEVEL_REQUIRED'
    when not exists (select 1 from private.world_item_catalog c
                      where c.item_id = p_listing.item_id and c.status not in ('DISABLED', 'HIDDEN'))
      then 'ITEM_UNAVAILABLE'
    else null end;
$$;


--
-- Name: world_shop_listings_validate_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_shop_listings_validate_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_policy text;
  v_max integer;
begin
  select c.ownership_policy, c.max_stack into v_policy, v_max
    from private.world_item_catalog c where c.item_id = new.item_id;
  if not found then
    raise exception 'LISTING_UNKNOWN_ITEM' using errcode = '23503';
  end if;
  if (v_policy = 'UNIQUE' and new.quantity <> 1) or (v_policy = 'STACKABLE' and new.quantity > v_max) then
    raise exception 'LISTING_INVALID_QUANTITY' using errcode = '23514';
  end if;
  return new;
end;
$$;


--
-- Name: world_social_caller(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_social_caller() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = v_uid and p.is_banned = false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  if exists (
    select 1
    from private.world_user_moderation_actions a
    where a.target_id = v_uid
      and a.action = 'interaction_restriction_24h'
      and a.ends_at > now()
  ) then
    raise exception 'SOCIAL_RESTRICTED' using errcode = '42501';
  end if;

  return v_uid;
end;
$$;


--
-- Name: world_social_target(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_social_target(p_caller uuid, p_target uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_target is null or p_target = p_caller
     or not exists (select 1 from public.profiles p where p.user_id = p_target and p.is_banned = false) then
    raise exception 'TARGET_UNAVAILABLE' using errcode = '22023';
  end if;
  return p_target;
end;
$$;


--
-- Name: world_wallet_account_ok_v1(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_wallet_account_ok_v1(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_user is not null and exists (
    select 1
    from auth.users u
    join public.profiles p on p.user_id = u.id
    where u.id = p_user
      and u.is_anonymous is not true
      and p.is_banned = false
  );
$$;


--
-- Name: world_wallet_apply_v1(uuid, text, bigint, text, text, text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_wallet_apply_v1(p_user uuid, p_currency_id text, p_delta bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_balance bigint;
  v_tx private.world_currency_transactions%rowtype;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type !~ '^[a-z][a-z0-9_]{0,31}$'
     or p_source_id is null or char_length(p_source_id) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) not between 1 and 500 then
    raise exception 'INVALID_REASON' using errcode = '22023';
  end if;
  if p_type in ('ADMIN', 'ADJUSTMENT') and p_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_currency_id is null or not exists (
    select 1 from private.world_currencies c where c.currency_id = p_currency_id
  ) then
    raise exception 'INVALID_CURRENCY' using errcode = '22023';
  end if;
  if not private.world_wallet_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  -- Lazy provisioning, then a row lock that serializes every change to this wallet.
  insert into private.world_wallets (user_id, currency_id)
  values (p_user, p_currency_id)
  on conflict (user_id, currency_id) do nothing;

  select w.balance
    into strict v_balance
    from private.world_wallets w
   where w.user_id = p_user and w.currency_id = p_currency_id
     for update;

  -- Checked under the lock: a concurrent retry waits here and then sees the committed first attempt.
  select * into v_tx
    from private.world_currency_transactions t
   where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_tx.user_id, v_tx.currency_id, v_tx.amount, v_tx.type, v_tx.source_type, v_tx.source_id)
       is distinct from (p_user, p_currency_id, p_delta, p_type, p_source_type, p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_wallet_result_v1(v_tx, 'ALREADY_PROCESSED');
  end if;

  if v_balance + p_delta < 0 then
    raise exception 'INSUFFICIENT_FUNDS' using errcode = 'P0001';
  end if;

  begin
    insert into private.world_currency_transactions (
      user_id, currency_id, type, amount, balance_before, balance_after,
      source_type, source_id, reason, idempotency_key)
    values (
      p_user, p_currency_id, p_type, p_delta, v_balance, v_balance + p_delta,
      p_source_type, p_source_id, p_reason, p_idempotency_key)
    returning * into v_tx;
  exception when unique_violation then
    -- The same key was committed concurrently for another wallet: never apply it twice.
    select * into strict v_tx
      from private.world_currency_transactions t
     where t.idempotency_key = p_idempotency_key;
    if (v_tx.user_id, v_tx.currency_id, v_tx.amount, v_tx.type, v_tx.source_type, v_tx.source_id)
       is distinct from (p_user, p_currency_id, p_delta, p_type, p_source_type, p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_wallet_result_v1(v_tx, 'ALREADY_PROCESSED');
  end;

  update private.world_wallets w
     set balance = v_tx.balance_after,
         version = w.version + 1,
         updated_at = now()
   where w.user_id = p_user and w.currency_id = p_currency_id;

  return private.world_wallet_result_v1(v_tx, 'SUCCESS');
end;
$_$;


--
-- Name: world_currency_transactions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_currency_transactions (
    transaction_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    currency_id text NOT NULL,
    type text NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    reason text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_currency_transactions_amount_check CHECK ((amount <> 0)),
    CONSTRAINT world_currency_transactions_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT world_currency_transactions_balance_before_check CHECK ((balance_before >= 0)),
    CONSTRAINT world_currency_transactions_balance_math CHECK ((balance_after = (balance_before + amount))),
    CONSTRAINT world_currency_transactions_direction CHECK ((((type = ANY (ARRAY['REWARD'::text, 'REFUND'::text])) AND (amount > 0)) OR ((type = 'PURCHASE'::text) AND (amount < 0)) OR (type = ANY (ARRAY['ADMIN'::text, 'ADJUSTMENT'::text])))),
    CONSTRAINT world_currency_transactions_idempotency_key_check CHECK ((idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'::text)),
    CONSTRAINT world_currency_transactions_operator_reason CHECK (((type <> ALL (ARRAY['ADMIN'::text, 'ADJUSTMENT'::text])) OR (reason IS NOT NULL))),
    CONSTRAINT world_currency_transactions_reason_check CHECK (((reason IS NULL) OR ((char_length(reason) >= 1) AND (char_length(reason) <= 500)))),
    CONSTRAINT world_currency_transactions_source_id_check CHECK (((char_length(source_id) >= 1) AND (char_length(source_id) <= 200))),
    CONSTRAINT world_currency_transactions_source_type_check CHECK ((source_type ~ '^[a-z][a-z0-9_]{0,31}$'::text)),
    CONSTRAINT world_currency_transactions_type_check CHECK ((type = ANY (ARRAY['REWARD'::text, 'PURCHASE'::text, 'REFUND'::text, 'ADMIN'::text, 'ADJUSTMENT'::text])))
);


--
-- Name: TABLE world_currency_transactions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_currency_transactions IS 'INHA WORLD currency ledger. One row per applied credit/debit; idempotency_key is globally unique; rows are never updated.';


--
-- Name: world_wallet_result_v1(private.world_currency_transactions, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.world_wallet_result_v1(p_tx private.world_currency_transactions, p_status text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'status', p_status,
    'transactionId', p_tx.transaction_id,
    'userId', p_tx.user_id,
    'currencyId', p_tx.currency_id,
    'type', p_tx.type,
    'amount', p_tx.amount,
    'balanceBefore', p_tx.balance_before,
    'balanceAfter', p_tx.balance_after,
    'sourceType', p_tx.source_type,
    'sourceId', p_tx.source_id,
    'idempotencyKey', p_tx.idempotency_key,
    'createdAt', p_tx.created_at
  );
$$;


--
-- Name: abandon_ranked_session_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.abandon_ranked_session_v1(p_run_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  update public.ranked_sessions
  set
    status = case when expires_at <= now() then 'expired' else 'abandoned' end,
    abandoned_at = case when expires_at > now() then now() else abandoned_at end,
    expired_at = case when expires_at <= now() then coalesce(expired_at,expires_at) else expired_at end,
    finished_at = coalesce(finished_at,now())
  where run_id=p_run_id
    and user_id=auth.uid()
    and status in ('started','submitted')
  returning status into v_status;

  if v_status is null then
    select status into v_status
    from public.ranked_sessions
    where run_id=p_run_id and user_id=auth.uid();
  end if;

  return v_status;
end;
$$;


--
-- Name: admin_review_world_user_report_v1(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_review_world_user_report_v1(p_report_id bigint, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_permission text;
  v_report public.world_user_reports%rowtype;
  v_until timestamptz;
  v_next_status text;
  v_resolution text;
begin
  if p_report_id is null then
    raise exception 'INVALID_REPORT' using errcode='22023';
  end if;

  v_permission := case p_action
    when 'reviewing' then 'moderation.review'
    when 'warning' then 'moderation.warn'
    when 'interaction_restriction_24h' then 'moderation.restrict_24h'
    when 'dismissed' then 'moderation.dismiss'
    else null
  end;

  if v_permission is null then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  v_actor := private.world_admin_caller_v1(v_permission);

  select *
  into v_report
  from public.world_user_reports
  where id=p_report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND' using errcode='22023';
  end if;

  if v_report.target_id=v_actor then
    raise exception 'SELF_MODERATION_FORBIDDEN' using errcode='22023';
  end if;

  if p_action='reviewing' then
    if v_report.status='pending' then
      update public.world_user_reports
      set status='reviewing', updated_at=now()
      where id=p_report_id;

      insert into private.world_user_moderation_actions(
        report_id,target_id,action,actor_id,actor_source
      )
      values (p_report_id,v_report.target_id,'reviewing',v_actor,'account_admin');
    elsif v_report.status<>'reviewing' then
      raise exception 'REPORT_ALREADY_CLOSED' using errcode='22023';
    end if;
  else
    if v_report.status in ('resolved','dismissed') then
      raise exception 'REPORT_ALREADY_CLOSED' using errcode='22023';
    end if;

    if p_action='warning' then
      v_next_status := 'resolved';
      v_resolution := 'warning';
    elsif p_action='dismissed' then
      v_next_status := 'dismissed';
      v_resolution := 'dismissed';
    else
      v_next_status := 'resolved';
      v_resolution := 'interaction_restriction_24h';

      select greatest(now(),coalesce(max(a.ends_at),now()))+interval '24 hours'
      into v_until
      from private.world_user_moderation_actions a
      where a.target_id=v_report.target_id
        and a.action='interaction_restriction_24h'
        and a.ends_at>now();
    end if;

    update public.world_user_reports
    set
      status=v_next_status,
      resolution=v_resolution,
      reviewed_at=now(),
      updated_at=now()
    where id=p_report_id;

    insert into private.world_user_moderation_actions(
      report_id,target_id,action,starts_at,ends_at,actor_id,actor_source
    )
    values (
      p_report_id,
      v_report.target_id,
      p_action,
      now(),
      case when p_action='interaction_restriction_24h' then v_until else null end,
      v_actor,
      'account_admin'
    );
  end if;

  return jsonb_build_object(
    'id',p_report_id,
    'status',(select status from public.world_user_reports where id=p_report_id),
    'resolution',(select resolution from public.world_user_reports where id=p_report_id),
    'reviewedAt',(select reviewed_at from public.world_user_reports where id=p_report_id),
    'restrictionUntil',(
      select max(a.ends_at)
      from private.world_user_moderation_actions a
      where a.target_id=v_report.target_id
        and a.action='interaction_restriction_24h'
        and a.ends_at>now()
    )
  );
end;
$$;


--
-- Name: FUNCTION admin_review_world_user_report_v1(p_report_id bigint, p_action text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_review_world_user_report_v1(p_report_id bigint, p_action text) IS 'Audited account-authenticated moderation action gated by per-action capability.';


--
-- Name: advance_mcm_2026_event_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_mcm_2026_event_v1(p_user uuid, p_event text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_event private.world_events%rowtype;
  v_npc text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_event is null or p_event not in (
       'status', 'start', 'investigate_staggering', 'investigate_dancing', 'investigate_hungry') then
    raise exception 'INVALID_EVENT_ACTION' using errcode = '22023';
  end if;
  if not private.world_mcm_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;
  if p_event = 'status' then
    return private.world_mcm_state_v1(p_user);
  end if;

  select * into v_event from private.world_events where event_id = 'event.mcm_2026';
  if private.world_event_state_v1(v_event, now()) is distinct from 'ACTIVE' then
    raise exception 'EVENT_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_mcm_2026:' || p_user::text, 0));

  if p_event = 'start' then
    insert into private.world_event_progress (user_id, event_id, stage)
    values (p_user, 'event.mcm_2026', 1)
    on conflict (user_id, event_id) do nothing;
  else
    v_npc := substr(p_event, char_length('investigate_') + 1);
    -- Before 'start' there is no row, so an investigation cannot skip ahead.
    update private.world_event_progress e
       set investigated = array(select distinct unnest(e.investigated || array[v_npc]) order by 1),
           updated_at = now()
     where e.user_id = p_user and e.event_id = 'event.mcm_2026' and e.stage = 1
       and not (v_npc = any(e.investigated));
    update private.world_event_progress e
       set stage = 2, venue_unlocked_at = now(), updated_at = now()
     where e.user_id = p_user and e.event_id = 'event.mcm_2026' and e.stage = 1
       and e.investigated @> array['staggering', 'dancing', 'hungry']::text[];
    perform private.world_mcm_try_complete_v1(p_user);
  end if;

  return private.world_mcm_state_v1(p_user);
end;
$$;


--
-- Name: advance_world_navigation_quest_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_world_navigation_quest_v1(p_user uuid, p_event text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_quest constant text := 'campus_navigation_intro_v1';
  v_stage smallint;
  v_new_stage smallint;
  v_available boolean := false;
  v_reward jsonb;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_event not in (
    'status','start','set_building5_destination','start_auto_building5',
    'pause_auto_building5','resume_auto_building5','visit_building5',
    'set_back_gate_destination','start_auto_back_gate','visit_back_gate'
  ) or p_event is null then
    raise exception 'INVALID_QUEST_EVENT' using errcode = '22023';
  end if;
  if p_user is null or not exists (
    select 1 from public.profiles p where p.user_id = p_user and p.is_banned = false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select exists (
    select 1 from private.world_quest_progress_v1 q
    where q.user_id = p_user and q.quest_id = 'campus_first_walk_v1' and q.stage = 5
  ) into v_available;

  if v_available and p_event = 'start' then
    insert into private.world_quest_progress_v1 (user_id, quest_id, stage)
    values (p_user, v_quest, 1)
    on conflict (user_id, quest_id) do nothing;
  end if;

  update private.world_quest_progress_v1 q
  set stage = q.stage + 1, updated_at = now()
  where q.user_id = p_user and q.quest_id = v_quest
    and (q.stage = 1 and p_event = 'set_building5_destination'
      or q.stage = 2 and p_event = 'start_auto_building5'
      or q.stage = 3 and p_event = 'pause_auto_building5'
      or q.stage = 4 and p_event = 'resume_auto_building5'
      or q.stage = 5 and p_event = 'visit_building5'
      or q.stage = 6 and p_event = 'set_back_gate_destination'
      or q.stage = 7 and p_event = 'start_auto_back_gate'
      or q.stage = 8 and p_event = 'visit_back_gate')
  returning q.stage into v_new_stage;

  -- This call completed Main2 (8 → 9): run the one-time navigation reward in this transaction.
  if p_event = 'visit_back_gate' and v_new_stage = 9 then
    v_reward := private.world_reward_grant_v1(
      p_user, 'reward.quest.navigation_intro', 'QUEST', 'quest.navigation_intro',
      'grant:quest.navigation_intro:' || p_user::text);
    if coalesce(v_reward ->> 'status', 'FAILED') not in ('SUCCESS', 'PARTIAL_SUCCESS') then
      raise exception 'QUEST_REWARD_FAILED' using errcode = 'P0001';
    end if;
  end if;

  select q.stage into v_stage from private.world_quest_progress_v1 q
  where q.user_id = p_user and q.quest_id = v_quest;

  v_result := jsonb_build_object(
    'quest_id', v_quest,
    'stage', coalesce(v_stage, 0),
    'available', v_available
  );
  if v_reward is not null then
    v_result := v_result || jsonb_build_object('reward', jsonb_build_object(
      'rewardId', v_reward -> 'rewardId',
      'rewardVersion', v_reward -> 'rewardVersion',
      'rewardTransactionId', v_reward -> 'rewardTransactionId',
      'status', v_reward -> 'status',
      'replayed', v_reward -> 'replayed',
      'completedAt', v_reward -> 'completedAt',
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantType', e -> 'grantType',
          'targetId', e -> 'targetId',
          'requested', e -> 'requested',
          'granted', e -> 'granted',
          'status', e -> 'status',
          'reason', e -> 'reason') order by x.ord)
        from jsonb_array_elements(v_reward -> 'entries') with ordinality as x(e, ord)), '[]'::jsonb)));
  end if;
  return v_result;
end;
$$;


--
-- Name: advance_world_quest_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_world_quest_v1(p_user uuid, p_event text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_quest constant text := 'campus_first_walk_v1';
  v_stage smallint;
  v_new_stage smallint;
  v_reward jsonb;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_event not in ('status', 'start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001') or p_event is null then
    raise exception 'INVALID_QUEST_EVENT' using errcode = '22023';
  end if;
  if p_user is null or not exists (
    select 1 from public.profiles p where p.user_id = p_user and p.is_banned = false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  if p_event = 'start' then
    insert into private.world_quest_progress_v1 (user_id, quest_id, stage)
    values (p_user, v_quest, 1)
    on conflict (user_id, quest_id) do nothing;
  end if;
  update private.world_quest_progress_v1 q
  set stage = q.stage + 1, updated_at = now()
  where q.user_id = p_user and q.quest_id = v_quest
    and (q.stage = 1 and p_event = 'visit_main_hall'
      or q.stage = 2 and p_event = 'visit_inkyung'
      or q.stage = 3 and p_event = 'talk_002'
      or q.stage = 4 and p_event = 'talk_001')
  returning q.stage into v_new_stage;

  -- This call completed the walk (4 → 5): run the one-time First Campus reward in this transaction.
  if p_event = 'talk_001' and v_new_stage = 5 then
    v_reward := private.world_reward_grant_v1(
      p_user, 'reward.quest.first_campus', 'QUEST', 'quest.first_campus',
      'grant:quest.first_campus:' || p_user::text);
    if coalesce(v_reward ->> 'status', 'FAILED') not in ('SUCCESS', 'PARTIAL_SUCCESS') then
      raise exception 'QUEST_REWARD_FAILED' using errcode = 'P0001';
    end if;
  end if;

  select q.stage into v_stage from private.world_quest_progress_v1 q
  where q.user_id = p_user and q.quest_id = v_quest;
  v_result := jsonb_build_object('quest_id', v_quest, 'stage', coalesce(v_stage, 0));
  if v_reward is not null then
    v_result := v_result || jsonb_build_object('reward', jsonb_build_object(
      'rewardId', v_reward -> 'rewardId',
      'rewardVersion', v_reward -> 'rewardVersion',
      'rewardTransactionId', v_reward -> 'rewardTransactionId',
      'status', v_reward -> 'status',
      'replayed', v_reward -> 'replayed',
      'completedAt', v_reward -> 'completedAt',
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantType', e -> 'grantType',
          'targetId', e -> 'targetId',
          'requested', e -> 'requested',
          'granted', e -> 'granted',
          'status', e -> 'status',
          'reason', e -> 'reason') order by x.ord)
        from jsonb_array_elements(v_reward -> 'entries') with ordinality as x(e, ord)), '[]'::jsonb)));
  end if;
  return v_result;
end;
$$;


--
-- Name: answer_my_world_daily_quiz_v1(uuid, text, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.answer_my_world_daily_quiz_v1(p_run_id uuid, p_question_id text, p_answer_index smallint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_daily_quiz_caller_v1();
  v_today date := private.world_daily_quiz_today_v1();
  v_run private.world_daily_quiz_runs%rowtype;
  v_index smallint;
  v_correct boolean;
  v_status text;
  v_reward jsonb;
  v_result jsonb;
begin
  if p_answer_index is null or p_answer_index not between 0 and 3 then
    raise exception 'INVALID_ANSWER' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('world_daily_quiz:' || v_uid::text, 0));

  -- Another account's run is indistinguishable from a missing one.
  select * into v_run from private.world_daily_quiz_runs r
   where r.run_id = p_run_id and r.user_id = v_uid for update;
  if not found then
    raise exception 'QUIZ_RUN_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_run.reward_date <> v_today then
    raise exception 'QUIZ_RUN_EXPIRED' using errcode = 'P0001';
  end if;
  if v_run.status <> 'ACTIVE' then
    raise exception 'QUIZ_ALREADY_ANSWERED' using errcode = 'P0001';
  end if;
  v_index := v_run.answered_count;
  if p_question_id is distinct from v_run.question_ids[v_index + 1] then
    if p_question_id = any (v_run.question_ids[1:v_index]) then
      raise exception 'QUIZ_ALREADY_ANSWERED' using errcode = 'P0001';
    end if;
    raise exception 'QUIZ_QUESTION_MISMATCH' using errcode = 'P0001';
  end if;

  select q.correct_index = p_answer_index into v_correct
    from private.world_daily_quiz_questions q where q.question_id = p_question_id;
  insert into private.world_daily_quiz_answers (run_id, question_index, question_id, selected_index, correct)
  values (v_run.run_id, v_index, p_question_id, p_answer_index, v_correct);

  v_run.answered_count := v_index + 1;
  v_run.correct_count := v_run.correct_count + case when v_correct then 1 else 0 end;
  v_status := case when v_run.answered_count < 3 then 'ACTIVE'
                   when v_run.correct_count >= 2 then 'PASSED' else 'FAILED' end;

  if v_status = 'PASSED' then
    -- Same transaction as the last answer and the PASSED status: a failed reward rolls all back.
    v_reward := private.world_reward_grant_v1(
      v_uid, 'reward.daily.campus_quiz', 'MINIGAME', 'daily.campus_quiz',
      'daily:campus_quiz:' || v_uid::text || ':' || to_char(v_run.reward_date, 'YYYY-MM-DD'));
    if coalesce(v_reward ->> 'status', 'FAILED') not in ('SUCCESS', 'PARTIAL_SUCCESS') then
      raise exception 'QUIZ_REWARD_FAILED' using errcode = 'P0001';
    end if;
  end if;

  update private.world_daily_quiz_runs r
     set answered_count = v_run.answered_count,
         correct_count = v_run.correct_count,
         status = v_status,
         completed_at = case when v_status = 'ACTIVE' then null else now() end,
         reward_transaction_id = case when v_status = 'PASSED' then (v_reward ->> 'rewardTransactionId')::uuid end
   where r.run_id = v_run.run_id;

  v_result := private.world_daily_quiz_state_v1(v_uid, v_today)
    || jsonb_build_object('lastAnswer', jsonb_build_object(
         'questionId', p_question_id, 'index', v_index, 'selectedIndex', p_answer_index, 'correct', v_correct));
  if v_reward is not null then
    v_result := v_result || jsonb_build_object('reward', private.world_daily_quiz_reward_view_v1(v_reward));
  end if;
  return v_result;
end;
$$;


--
-- Name: archive_hub_conversation_v1(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_hub_conversation_v1(p_conversation uuid, p_archived boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
  v_archived boolean := coalesce(p_archived, true);
begin
  update public.hub_conversation_members
  set
    archived_at = case when v_archived then now() else null end,
    last_read_at = case when v_archived then now() else last_read_at end
  where conversation_id = p_conversation and user_id = v_caller;

  if not found then
    raise exception 'CONVERSATION_UNAVAILABLE' using errcode = '22023';
  end if;

  return jsonb_build_object('conversationId', p_conversation, 'archived', v_archived);
end;
$$;


--
-- Name: attach_inha_duck_event_context(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_inha_duck_event_context() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_game_id uuid;
  v_player_id uuid;
  v_session_id uuid;
  v_client_session_id uuid;
  v_visitor_id uuid;
  v_visitor_text text;
  v_session_text text;
  v_link_auth_user_id uuid;
  v_link_player_id uuid;
  v_now timestamptz := coalesce(new.created_at, now());
begin
  if new.game_id is null then
    select id into v_game_id
    from public.games
    where slug='inha-duck'
    limit 1;
    new.game_id:=v_game_id;
  else
    v_game_id:=new.game_id;
  end if;

  v_visitor_text:=new.metadata->>'visitor_id';
  if v_visitor_text ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_visitor_id:=v_visitor_text::uuid;
  end if;

  if new.player_id is not null then
    v_player_id:=new.player_id;

  elsif new.user_id is not null then
    insert into public.players(auth_user_id,first_seen_at,last_seen_at)
    values(new.user_id,v_now,v_now)
    on conflict(auth_user_id) do update set
      last_seen_at=greatest(public.players.last_seen_at,excluded.last_seen_at)
    returning id into v_player_id;

    if v_visitor_id is not null then
      select auth_user_id,canonical_player_id
        into v_link_auth_user_id,v_link_player_id
      from public.player_identity_links
      where visitor_id=v_visitor_id
        and status='linked'
      limit 1;

      if v_link_auth_user_id is null or v_link_auth_user_id=new.user_id then
        insert into public.player_identity_links(
          visitor_id,auth_user_id,canonical_player_id,status,
          evidence_count,first_evidence_at,last_evidence_at
        )
        values(
          v_visitor_id,new.user_id,v_player_id,'linked',
          1,v_now,v_now
        )
        on conflict(visitor_id,auth_user_id) do update set
          canonical_player_id=excluded.canonical_player_id,
          evidence_count=public.player_identity_links.evidence_count+1,
          last_evidence_at=greatest(public.player_identity_links.last_evidence_at,excluded.last_evidence_at),
          updated_at=now();
      else
        update public.player_identity_links
        set status='conflict',updated_at=now()
        where visitor_id=v_visitor_id;

        insert into public.player_identity_links(
          visitor_id,auth_user_id,canonical_player_id,status,
          evidence_count,first_evidence_at,last_evidence_at
        )
        values(
          v_visitor_id,new.user_id,v_player_id,'conflict',
          1,v_now,v_now
        )
        on conflict(visitor_id,auth_user_id) do update set
          status='conflict',
          canonical_player_id=excluded.canonical_player_id,
          evidence_count=public.player_identity_links.evidence_count+1,
          last_evidence_at=greatest(public.player_identity_links.last_evidence_at,excluded.last_evidence_at),
          updated_at=now();
      end if;
    end if;

    new.player_id:=v_player_id;

  elsif v_visitor_id is not null then
    select canonical_player_id
      into v_link_player_id
    from public.player_identity_links
    where visitor_id=v_visitor_id
      and status='linked'
    limit 1;

    if v_link_player_id is not null then
      v_player_id:=v_link_player_id;
      update public.players
      set last_seen_at=greatest(last_seen_at,v_now)
      where id=v_player_id;
    else
      insert into public.players(visitor_id,first_seen_at,last_seen_at)
      values(v_visitor_id,v_now,v_now)
      on conflict(visitor_id) do update set
        last_seen_at=greatest(public.players.last_seen_at,excluded.last_seen_at)
      returning id into v_player_id;
    end if;

    new.player_id:=v_player_id;
  end if;

  if new.game_session_id is null and new.game_id is not null then
    v_session_text:=new.metadata->>'session_id';

    if v_session_text ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      v_client_session_id:=v_session_text::uuid;

      insert into public.game_sessions(
        game_id,player_id,build_id,client_session_id,
        source,device,platform,started_at,ended_at,metadata
      )
      values(
        new.game_id,new.player_id,new.build_id,v_client_session_id,
        nullif(new.metadata->>'source',''),
        nullif(new.metadata->>'device',''),
        nullif(new.metadata->>'platform',''),
        v_now,
        case when new.event_type in ('exit_run','session_end') then v_now else null end,
        jsonb_strip_nulls(jsonb_build_object(
          'compat_source','inha_duck_event_trigger',
          'client_version',new.metadata->>'client_version',
          'balance_version',new.metadata->>'balance_version',
          'run_type',new.metadata->>'run_type'
        ))
      )
      on conflict(game_id,client_session_id) do update set
        player_id=coalesce(excluded.player_id,public.game_sessions.player_id),
        build_id=coalesce(public.game_sessions.build_id,excluded.build_id),
        source=coalesce(public.game_sessions.source,excluded.source),
        device=coalesce(public.game_sessions.device,excluded.device),
        platform=coalesce(public.game_sessions.platform,excluded.platform),
        started_at=least(public.game_sessions.started_at,excluded.started_at),
        ended_at=coalesce(public.game_sessions.ended_at,excluded.ended_at),
        metadata=public.game_sessions.metadata || excluded.metadata
      returning id into v_session_id;

      new.game_session_id:=v_session_id;
    end if;
  end if;

  return new;
end;
$_$;


--
-- Name: block_world_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_world_user(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  -- Blocking a banned or missing account is refused like any unavailable target.
  perform private.world_social_target(v_caller, p_target);
  perform private.world_lock_pair(v_caller, p_target);
  insert into public.world_user_blocks (blocker_id, blocked_id) values (v_caller, p_target)
  on conflict (blocker_id, blocked_id) do nothing;
  delete from public.world_friendships f
   where f.user_low = least(v_caller, p_target) and f.user_high = greatest(v_caller, p_target);
  return jsonb_build_object('userId', p_target, 'relationship', 'blocked_by_me');
end;
$$;


--
-- Name: cancel_world_friend_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_world_friend_request(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  perform private.world_social_target(v_caller, p_target);
  perform private.world_lock_pair(v_caller, p_target);
  delete from public.world_friendships f
   where f.user_low = least(v_caller, p_target) and f.user_high = greatest(v_caller, p_target)
     and f.status = 'pending' and f.requested_by = v_caller;
  return jsonb_build_object('userId', p_target, 'relationship', private.world_relationship(v_caller, p_target));
end;
$$;


--
-- Name: claim_inha_mail_badge(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_inha_mail_badge(p_primary_id uuid, p_school_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_email text;
  v_verified_at timestamptz := now();
begin
  if p_primary_id = p_school_id then
    raise exception 'A second mailbox is required';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_primary_id and u.is_anonymous = false and u.email_confirmed_at is not null
  ) then
    raise exception 'Primary account is not confirmed';
  end if;
  select lower(u.email) into v_email
  from auth.users u
  where u.id = p_school_id and u.is_anonymous = false
    and u.email_confirmed_at is not null and public.is_inha_mail(u.email);
  if v_email is null then
    raise exception 'School mailbox is not confirmed';
  end if;

  insert into public.inha_mail_badges(user_id,email,verified_at)
    values(p_primary_id,v_email,v_verified_at)
    on conflict (user_id) do update
      set email=excluded.email,verified_at=excluded.verified_at;

  insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  select p_primary_id,'inha_verified_v1',v_verified_at,'inha_mail_verified'
  where exists (select 1 from public.profiles p where p.user_id=p_primary_id and p.is_banned=false)
  on conflict (user_id,achievement_key) do nothing;

  return true;
end;
$$;


--
-- Name: claim_my_mcm_2026_main_reward_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_my_mcm_2026_main_reward_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_mcm_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return private.world_mcm_claim_reward_v1(v_uid, 'MAIN_CLEAR');
end;
$$;


--
-- Name: claim_my_mcm_landlord_first_clear_reward_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_my_mcm_landlord_first_clear_reward_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_mcm_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return private.world_mcm_claim_reward_v1(v_uid, 'LANDLORD_FIRST_CLEAR');
end;
$$;


--
-- Name: claim_my_world_attendance_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_my_world_attendance_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_attendance_caller_v1();
begin
  return private.world_attendance_claim_v1(v_uid, private.world_attendance_today_v1());
end;
$$;


--
-- Name: claim_world_npc_ai_call_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_world_npc_ai_call_v1(p_user uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_user_scope text := 'user:' || p_user::text;
  v_global integer;
  v_user integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_user is null or not exists (
    select 1 from public.profiles p where p.user_id = p_user and p.is_banned = false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;
  -- Serialize global and per-user claims across all server instances.
  perform pg_advisory_xact_lock(hashtextextended('world_npc_ai:' || v_day::text, 0));
  select calls into v_global from private.world_npc_ai_daily_calls
    where usage_day = v_day and scope = 'global';
  select calls into v_user from private.world_npc_ai_daily_calls
    where usage_day = v_day and scope = v_user_scope;
  if coalesce(v_user, 0) >= 3 then return 'USER_LIMIT'; end if;
  if coalesce(v_global, 0) >= 50 then return 'GLOBAL_LIMIT'; end if;
  insert into private.world_npc_ai_daily_calls (usage_day, scope, calls)
    values (v_day, 'global', 1), (v_day, v_user_scope, 1)
    on conflict (usage_day, scope) do update
      set calls = private.world_npc_ai_daily_calls.calls + 1;
  delete from private.world_npc_ai_daily_calls where usage_day < v_day - 31;
  return 'OK';
end;
$$;


--
-- Name: claim_world_npc_shared_tick_v1(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_world_npc_shared_tick_v1(p_period text, p_tick bigint) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_status text;
  v_claimed_at timestamptz;
begin
  if p_period is null or p_period not in ('morning', 'class_time', 'lunch', 'evening')
      or p_tick is null or p_tick < 0 then
    raise exception 'INVALID_NPC_SHARED_TICK' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_npc_shared_tick:' || p_tick::text, 0));

  select s.status, s.claimed_at
    into v_status, v_claimed_at
  from private.world_npc_shared_ticks_v1 s
  where s.tick = p_tick;

  if not found then
    insert into private.world_npc_shared_ticks_v1
      (tick, period, status, effective_at_ms, tick_ms, claimed_at)
    values
      (p_tick, p_period, 'pending', p_tick * 60000, 60000, now());
    return 'CLAIMED';
  end if;

  if v_status = 'committed' then
    return 'EXISTS';
  end if;

  if v_claimed_at < now() - interval '30 seconds' then
    update private.world_npc_shared_ticks_v1
    set period = p_period,
        effective_at_ms = p_tick * 60000,
        tick_ms = 60000,
        claimed_at = now()
    where tick = p_tick and status = 'pending';
    return 'CLAIMED';
  end if;

  return 'EXISTS';
end
$$;


--
-- Name: commit_world_npc_shared_tick_v1(text, bigint, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_world_npc_shared_tick_v1(p_period text, p_tick bigint, p_effective_at_ms bigint, p_decisions jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_id text;
  v_decision jsonb;
  v_count integer;
  v_existing private.world_npc_shared_ticks_v1%rowtype;
begin
  if p_period is null or p_period not in ('morning', 'class_time', 'lunch', 'evening')
      or p_tick is null or p_tick < 0
      or p_effective_at_ms is null or p_effective_at_ms <> p_tick * 60000
      or p_decisions is null or jsonb_typeof(p_decisions) <> 'object' then
    raise exception 'INVALID_NPC_SHARED_COMMIT' using errcode = '22023';
  end if;

  select count(*) into v_count from jsonb_object_keys(p_decisions);
  if v_count > 18 then
    raise exception 'INVALID_NPC_SHARED_DECISIONS' using errcode = '22023';
  end if;

  for v_id, v_decision in
    select key, value from jsonb_each(p_decisions)
  loop
    if v_id !~ '^INKYUNG-NPC-(00[3-9]|01[0-9]|020)$'
        or jsonb_typeof(v_decision) <> 'object'
        or coalesce(v_decision->>'action', '') not in ('stay', 'walk_nearby', 'look_around', 'return_anchor')
        or jsonb_typeof(v_decision->'confidence') <> 'number'
        or (v_decision->>'confidence')::numeric < 0
        or (v_decision->>'confidence')::numeric > 1
        or exists (
          select 1 from jsonb_object_keys(v_decision) as k(key)
          where k.key not in ('action', 'confidence', 'fallback')
        )
        or (v_decision ? 'fallback' and jsonb_typeof(v_decision->'fallback') <> 'string') then
      raise exception 'INVALID_NPC_SHARED_DECISIONS' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('world_npc_shared_tick:' || p_tick::text, 0));

  update private.world_npc_shared_ticks_v1
  set status = 'committed',
      decisions = p_decisions,
      committed_at = now()
  where tick = p_tick
    and period = p_period
    and status = 'pending'
    and effective_at_ms = p_effective_at_ms;

  if not found then
    select * into v_existing
    from private.world_npc_shared_ticks_v1
    where tick = p_tick;

    if not found or v_existing.status <> 'committed'
        or v_existing.period <> p_period
        or v_existing.effective_at_ms <> p_effective_at_ms
        or v_existing.decisions <> p_decisions then
      raise exception 'NPC_SHARED_TICK_NOT_CLAIMED' using errcode = '55000';
    end if;
  end if;

  delete from private.world_npc_shared_ticks_v1
  where tick < p_tick - 1440;

  return public.get_world_npc_shared_state_v1();
end
$_$;


--
-- Name: create_qa_ranked_session(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_qa_ranked_session(p_user_id uuid, p_client_version text DEFAULT NULL::text, p_ruleset_version text DEFAULT 'secret-2.0-r1'::text) RETURNS TABLE(run_id uuid, nonce uuid, started_at timestamp with time zone, expires_at timestamp with time zone, run_type text, ruleset_version text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  insert into public.ranked_sessions(
    user_id, stage_key, client_version, run_type, ruleset_version
  )
  values(
    p_user_id, 'secret', left(coalesce(p_client_version,''),40), 'qa',
    coalesce(nullif(p_ruleset_version,''),'secret-2.0-r1')
  )
  returning ranked_sessions.run_id, ranked_sessions.nonce,
            ranked_sessions.started_at, ranked_sessions.expires_at,
            ranked_sessions.run_type, ranked_sessions.ruleset_version;
end;
$$;


--
-- Name: create_world_guestbook_entry_v2(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_world_guestbook_entry_v2(p_content text, p_location_key text DEFAULT 'main_gate'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
  v_content text := btrim(coalesce(p_content, ''));
  v_daily_used integer := 0;
  v_latest timestamptz;
  v_row public.world_guestbook_entries%rowtype;
begin
  if p_location_key <> 'main_gate' then
    raise exception 'INVALID_LOCATION' using errcode = '22023';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 150 then
    raise exception 'INVALID_CONTENT' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text || ':' || p_location_key, 0)
  );

  select count(*)::integer
  into v_daily_used
  from private.world_guestbook_post_log l
  where l.user_id = v_uid
    and l.location_key = p_location_key
    and (l.created_at at time zone 'Asia/Seoul')::date =
        (now() at time zone 'Asia/Seoul')::date;

  select max(l.created_at)
  into v_latest
  from private.world_guestbook_post_log l
  where l.user_id = v_uid
    and l.location_key = p_location_key;

  if v_daily_used >= 3 then
    raise exception 'DAILY_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_latest is not null and v_latest > now() - interval '60 seconds' then
    raise exception 'GUESTBOOK_COOLDOWN' using errcode = 'P0001';
  end if;

  insert into public.world_guestbook_entries (user_id, location_key, content)
  values (v_uid, p_location_key, v_content)
  returning * into v_row;

  insert into private.world_guestbook_post_log (entry_id, user_id, location_key, created_at)
  values (v_row.id, v_uid, p_location_key, v_row.created_at);

  return private.world_guestbook_entry_json(v_row.id, v_uid);
end;
$$;


--
-- Name: delete_my_grow_progress(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_my_grow_progress(p_expected_updated_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;
  delete from public.user_game_progress
   where user_id=v_uid and game_id=(select id from public.games where slug='induck-grow')
     and updated_at=p_expected_updated_at;
  if found then return true; end if;
  raise exception 'GROW_SAVE_CONFLICT' using errcode='40001';
end;
$$;


--
-- Name: delete_my_inhagame_account_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_my_inhagame_account_v1(p_confirmation text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_last_sign_in_at timestamptz;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;

  if p_confirmation is distinct from '탈퇴' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode='22023';
  end if;

  select u.last_sign_in_at
  into v_last_sign_in_at
  from auth.users u
  where u.id=v_uid and u.is_anonymous=false;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_last_sign_in_at is null or v_last_sign_in_at < now() - interval '15 minutes' then
    raise exception 'ACCOUNT_REAUTH_REQUIRED' using errcode='42501';
  end if;

  if exists (
    select 1
    from private.world_staff_assignments a
    where a.user_id=v_uid and a.active=true
  ) then
    raise exception 'STAFF_ACCOUNT_DELETION_BLOCKED' using errcode='42501';
  end if;

  -- visitor/auth stitching is not backed by auth.users, so remove it explicitly.
  delete from public.player_identity_links
  where auth_user_id=v_uid;

  -- ephemeral presence should disappear immediately rather than wait for its TTL.
  delete from public.world_online_sessions
  where user_id=v_uid;

  -- Most account-owned rows use ON DELETE CASCADE. Operational history that uses
  -- ON DELETE SET NULL becomes de-identified when this row is removed.
  delete from auth.users
  where id=v_uid;

  if not found then
    raise exception 'ACCOUNT_DELETE_FAILED' using errcode='P0001';
  end if;

  return jsonb_build_object('deleted',true);
end;
$$;


--
-- Name: delete_world_guestbook_entry_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_world_guestbook_entry_v1(p_location_key text DEFAULT 'main_gate'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
  v_id uuid;
begin
  select g.id
  into v_id
  from public.world_guestbook_entries g
  where g.user_id = v_uid
    and g.location_key = p_location_key
  order by g.created_at desc, g.id desc
  limit 1;

  if v_id is null then
    return false;
  end if;

  return public.delete_world_guestbook_entry_v2(v_id);
end;
$$;


--
-- Name: delete_world_guestbook_entry_v2(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_world_guestbook_entry_v2(p_entry_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
begin
  delete from public.world_guestbook_entries g
  where g.id = p_entry_id
    and g.user_id = v_uid;

  if not found then
    raise exception 'ENTRY_UNAVAILABLE' using errcode = '22023';
  end if;

  return true;
end;
$$;


--
-- Name: end_world_accompany(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_world_accompany(p_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  update public.world_accompany_sessions s set state = 'ended', ended_at = now(), ended_reason = 'participant'
   where s.id = p_session_id and (s.inviter_id = v_caller or s.invitee_id = v_caller)
     and s.state in ('offered', 'active');
  if not found and not exists (select 1 from public.world_accompany_sessions s
    where s.id = p_session_id and (s.inviter_id = v_caller or s.invitee_id = v_caller)) then
    raise exception 'TARGET_UNAVAILABLE' using errcode = '22023';
  end if;
  return jsonb_build_object('id', p_session_id, 'state', 'ended');
end;
$$;


--
-- Name: equip_my_world_item_v1(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.equip_my_world_item_v1(p_slot text, p_item_id text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := private.world_appearance_caller_v1();
  v_tx private.world_appearance_transactions;
  v_category text;
  v_status text;
  v_previous text;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_appearance_slot_ok_v1(p_slot) then
    raise exception 'INVALID_APPEARANCE_SLOT' using errcode = '22023';
  end if;
  if p_item_id is null or char_length(p_item_id) > 80 or p_item_id !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' then
    raise exception 'INVALID_ITEM_ID' using errcode = '22023';
  end if;

  -- One change per account at a time: the idempotency lookup, the checks and the write are atomic.
  perform pg_advisory_xact_lock(hashtextextended('world_appearance:' || v_uid::text, 0));

  select * into v_tx from private.world_appearance_transactions where idempotency_key = p_idempotency_key;
  if found then
    if v_tx.user_id = v_uid and v_tx.action = 'EQUIP' and v_tx.slot = p_slot
       and v_tx.requested_item_id = p_item_id then
      return private.world_appearance_result_v1(v_tx, true);
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;

  -- Category, slot and status from the server catalog mirror; nothing from the client is trusted.
  select c.category, c.status into v_category, v_status
    from private.world_item_catalog c where c.item_id = p_item_id;
  if not found then
    raise exception 'UNKNOWN_ITEM' using errcode = '22023';
  end if;
  if v_category <> 'WEARABLE' then
    raise exception 'ITEM_NOT_EQUIPPABLE' using errcode = 'P0001';
  end if;
  if upper(split_part(p_item_id, '.', 1)) <> p_slot then
    raise exception 'SLOT_MISMATCH' using errcode = 'P0001';
  end if;
  -- Same rule as new grants (C0 GRANT_BLOCKED_STATUSES): DISABLED / HIDDEN items cannot be put on.
  if v_status in ('DISABLED', 'HIDDEN') then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.world_player_items i where i.user_id = v_uid and i.item_id = p_item_id) then
    raise exception 'ITEM_NOT_OWNED' using errcode = 'P0001';
  end if;

  select l.item_id into v_previous from private.world_player_appearance_loadout l
   where l.user_id = v_uid and l.slot = p_slot for update;

  v_tx := private.world_appearance_record_v1(v_uid, p_idempotency_key, 'EQUIP', p_slot, p_item_id, v_previous, p_item_id);
  if v_previous is distinct from p_item_id then
    insert into private.world_player_appearance_loadout (user_id, slot, item_id, updated_at)
    values (v_uid, p_slot, p_item_id, clock_timestamp())
    on conflict (user_id, slot) do update set item_id = excluded.item_id, updated_at = excluded.updated_at;
  end if;
  return private.world_appearance_result_v1(v_tx, false);
end;
$_$;


--
-- Name: expire_ranked_sessions_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_ranked_sessions_v1() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_count integer;
begin
  update public.ranked_sessions
  set
    status='expired',
    expired_at=coalesce(expired_at,expires_at),
    finished_at=coalesce(finished_at,expires_at)
  where status in ('started','submitted')
    and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: finish_grow_rank_v1(uuid, uuid, uuid, text, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_grow_rank_v1(p_run_id uuid, p_user_id uuid, p_nonce uuid, p_department text, p_twice_points integer, p_credits integer, p_reject_reason text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare s public.grow_rank_sessions%rowtype;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'SERVICE_ONLY' using errcode='42501';end if;
  select * into s from public.grow_rank_sessions where run_id=p_run_id for update;
  if not found or s.user_id<>p_user_id or s.nonce<>p_nonce or s.department<>p_department or
     s.ruleset<>'grow-gpa-lite-v1' then raise exception 'INVALID_RUN' using errcode='42501';end if;
  if s.status<>'started' then return s.status;end if;
  if s.expires_at<=now() then raise exception 'EXPIRED_RUN' using errcode='42501';end if;
  if p_reject_reason is not null then
    update public.grow_rank_sessions set status='rejected',finished_at=now(),reject_reason=left(p_reject_reason,60) where run_id=p_run_id;
    return 'rejected';
  end if;
  if p_twice_points is null or p_credits is null or p_twice_points<0 or p_credits<1 or
     p_twice_points>p_credits*9 then raise exception 'INVALID_GPA';end if;
  insert into public.grow_rank_runs(run_id,user_id,department,ruleset,twice_points,credits)
  values (p_run_id,p_user_id,p_department,s.ruleset,p_twice_points,p_credits);
  insert into public.grow_rank_bests(user_id,department,ruleset,run_id,twice_points,credits,achieved_at)
  values(p_user_id,p_department,s.ruleset,p_run_id,p_twice_points,p_credits,now())
  on conflict(user_id,department,ruleset) do update set
    run_id=excluded.run_id,twice_points=excluded.twice_points,credits=excluded.credits,achieved_at=excluded.achieved_at
  where excluded.twice_points::numeric/excluded.credits >
        public.grow_rank_bests.twice_points::numeric/public.grow_rank_bests.credits;
  update public.grow_rank_sessions set status='accepted',finished_at=now() where run_id=p_run_id;
  return 'accepted';
end $$;


--
-- Name: general_badge_code(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.general_badge_code(p_score integer, p_stars integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when coalesce(p_score,0) >= 1000 and coalesce(p_stars,0) >= 12 then 'inha_king'
    when coalesce(p_score,0) >= 750 and coalesce(p_stars,0) >= 10 then 'campus_master'
    when coalesce(p_score,0) >= 500 and coalesce(p_stars,0) >= 8 then 'campus_explorer'
    when coalesce(p_score,0) >= 350 and coalesce(p_stars,0) >= 6 then 'duck_hunter'
    when coalesce(p_score,0) >= 200 and coalesce(p_stars,0) >= 4 then 'campus_patrol'
    else 'freshman'
  end;
$$;


--
-- Name: get_general_leaderboard(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_general_leaderboard(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, user_id uuid, nickname text, department_id bigint, department_name text, total_score integer, best_combo integer, stages_recorded integer, achieved_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with scores as (
    select
      g.user_id,
      sum(g.best_score)::integer as total_score,
      max(g.best_combo)::integer as best_combo,
      count(*)::integer as stages_recorded,
      max(g.achieved_at) as achieved_at
    from public.general_stage_bests g
    group by g.user_id
  ),
  eligible as (
    select
      s.user_id,
      p.nickname,
      p.department_id,
      d.name as department_name,
      s.total_score,
      s.best_combo,
      s.stages_recorded,
      s.achieved_at
    from scores s
    join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id
    where p_department_id is null or p.department_id=p_department_id
  )
  select
    row_number() over (
      order by e.total_score desc, e.best_combo desc, e.achieved_at asc, e.user_id
    ) as rank,
    e.user_id,e.nickname,e.department_id,e.department_name,
    e.total_score,e.best_combo,e.stages_recorded,e.achieved_at
  from eligible e
  order by e.total_score desc, e.best_combo desc, e.achieved_at asc, e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_general_leaderboard_v2(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_general_leaderboard_v2(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, total_score integer, best_combo integer, stages_recorded integer, achieved_at timestamp with time zone, is_me boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with scores as (
    select
      g.user_id,
      sum(g.best_score)::integer as total_score,
      max(g.best_combo)::integer as best_combo,
      count(*)::integer as stages_recorded,
      max(g.achieved_at) as achieved_at
    from public.general_stage_bests g
    group by g.user_id
  ),
  eligible as (
    select
      s.user_id,
      p.nickname,
      p.department_id,
      d.name as department_name,
      s.total_score,
      s.best_combo,
      s.stages_recorded,
      s.achieved_at
    from scores s
    join public.profiles p
      on p.user_id=s.user_id
     and p.is_banned=false
    left join public.departments d on d.id=p.department_id
    where p_department_id is null or p.department_id=p_department_id
  )
  select
    row_number() over (
      order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
    ) as rank,
    e.nickname,e.department_name,e.total_score,e.best_combo,e.stages_recorded,e.achieved_at,
    coalesce(e.user_id=auth.uid(),false) as is_me
  from eligible e
  order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_general_leaderboard_v3(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_general_leaderboard_v3(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, total_score integer, total_stars integer, best_combo integer, stages_recorded integer, achieved_at timestamp with time zone, is_me boolean, general_badge text, ranked_grade text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with scores as (
    select g.user_id,sum(g.best_score)::integer total_score,sum(g.best_stars)::integer total_stars,
      max(g.best_combo)::integer best_combo,count(*)::integer stages_recorded,max(g.achieved_at) achieved_at
    from public.general_stage_bests g group by g.user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr
    where rr.stage_key='secret' and rr.run_type='ranked' and rr.validation_status='accepted'
  ), ranked as (
    select distinct on(gr.user_id) gr.user_id,gr.grade ranked_grade from grade_runs gr
    order by gr.user_id,case gr.grade when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5 when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0 end desc
  ), eligible as (
    select s.user_id,p.nickname,p.department_id,d.name department_name,s.total_score,s.total_stars,s.best_combo,s.stages_recorded,s.achieved_at,
      public.general_badge_code(s.total_score,s.total_stars) general_badge,coalesce(r.ranked_grade,'F') ranked_grade
    from scores s join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id left join ranked r on r.user_id=s.user_id
    where p_department_id is null or p.department_id=p_department_id
  )
  select row_number() over(order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id),
    e.nickname,e.department_name,e.total_score,e.total_stars,e.best_combo,e.stages_recorded,e.achieved_at,
    coalesce(e.user_id=auth.uid(),false),e.general_badge,e.ranked_grade
  from eligible e order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_general_leaderboard_v4(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_general_leaderboard_v4(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, total_score integer, total_stars integer, best_combo integer, stages_recorded integer, achieved_at timestamp with time zone, is_me boolean, general_badge text, ranked_grade text, inha_mail_verified boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with scores as (
    select g.user_id,sum(g.best_score)::integer total_score,sum(g.best_stars)::integer total_stars,
      max(g.best_combo)::integer best_combo,count(*)::integer stages_recorded,max(g.achieved_at) achieved_at
    from public.general_stage_bests g group by g.user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr
    where rr.stage_key='secret' and rr.run_type='ranked' and rr.validation_status='accepted'
  ), ranked as (
    select distinct on(gr.user_id) gr.user_id,gr.grade ranked_grade from grade_runs gr
    order by gr.user_id,case gr.grade when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5 when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0 end desc
  ), eligible as (
    select s.user_id,p.nickname,p.department_id,d.name department_name,s.total_score,s.total_stars,s.best_combo,s.stages_recorded,s.achieved_at,
      public.general_badge_code(s.total_score,s.total_stars) general_badge,coalesce(r.ranked_grade,'F') ranked_grade
    from scores s join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id left join ranked r on r.user_id=s.user_id
    where p_department_id is null or p.department_id=p_department_id
  )
  select row_number() over(order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id),
    e.nickname,e.department_name,e.total_score,e.total_stars,e.best_combo,e.stages_recorded,e.achieved_at,
    coalesce(e.user_id=auth.uid(),false),e.general_badge,e.ranked_grade,(exists (
      select 1 from auth.users u
      where u.id=e.user_id and u.is_anonymous=false and u.email_confirmed_at is not null
        and (public.is_inha_mail(u.email) or exists (
          select 1 from public.inha_mail_badges b where b.user_id=u.id
        ))
    ))
  from eligible e order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_general_leaderboard_v5(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_general_leaderboard_v5(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, total_score integer, total_stars integer, best_combo integer, stages_recorded integer, achieved_at timestamp with time zone, is_me boolean, general_badge text, ranked_grade text, event_badge text, inha_mail_verified boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with scores as (
    select g.user_id,
           sum(g.best_score)::integer total_score,
           sum(g.best_stars)::integer total_stars,
           max(g.best_combo)::integer best_combo,
           count(*)::integer stages_recorded,
           max(g.achieved_at) achieved_at
    from public.general_stage_bests g
    group by g.user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr
    where rr.stage_key='secret'
      and rr.run_type='ranked'
      and rr.validation_status='accepted'
  ), ranked as (
    select distinct on(gr.user_id)
      gr.user_id, gr.grade ranked_grade
    from grade_runs gr
    order by gr.user_id,
      case gr.grade
        when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5
        when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0
      end desc
  ), eligible as (
    select s.user_id, p.nickname, p.department_id, d.name department_name,
           s.total_score, s.total_stars, s.best_combo, s.stages_recorded, s.achieved_at,
           public.general_badge_code(s.total_score,s.total_stars) general_badge,
           coalesce(r.ranked_grade,'F') ranked_grade,
           eb.badge_code event_badge
    from scores s
    join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id
    left join ranked r on r.user_id=s.user_id
    left join public.classic_event_badges eb
      on eb.user_id=s.user_id and eb.event_key='inha_duck_s1'
    where p_department_id is null or p.department_id=p_department_id
  )
  select row_number() over(
           order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id),
         e.nickname,e.department_name,e.total_score,e.total_stars,e.best_combo,
         e.stages_recorded,e.achieved_at,
         coalesce(e.user_id=(select auth.uid()),false),
         e.general_badge,e.ranked_grade,e.event_badge,
         exists (
           select 1
           from auth.users u
           where u.id=e.user_id
             and u.is_anonymous=false
             and u.email_confirmed_at is not null
             and (
               public.is_inha_mail(u.email)
               or exists (
                 select 1 from public.inha_mail_badges b where b.user_id=u.id
               )
             )
         )
  from eligible e
  order by e.total_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_grow_rank_board(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_grow_rank_board(p_department text) RETURNS TABLE(rank bigint, nickname text, gpa numeric, achieved_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_department not in ('culture','cse','aero','apsl','nursing','theatre') then
    raise exception 'INVALID_DEPARTMENT';end if;
  return query select r.rank,r.nickname,r.gpa,r.achieved_at from (
    select rank() over(order by b.twice_points::numeric/(2*b.credits) desc) as rank,
      p.nickname,b.twice_points::numeric/(2*b.credits) as gpa,b.achieved_at
    from public.grow_rank_bests b
    join public.grow_rank_visibility v on v.user_id=b.user_id and v.department=b.department and v.is_public
    join public.profiles p on p.user_id=b.user_id and p.is_banned=false
    where b.department=p_department and b.ruleset='grow-gpa-lite-v1'
  ) r order by r.rank,r.achieved_at limit 50;
end $$;


--
-- Name: get_hub_messages_v1(uuid, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_hub_messages_v1(p_conversation uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if p_conversation is null or not exists (
    select 1
    from public.hub_conversation_members m
    where m.conversation_id = p_conversation and m.user_id = v_caller
  ) then
    raise exception 'CONVERSATION_UNAVAILABLE' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'conversationId', p_conversation,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'senderId', x.sender_id,
          'body', case when x.deleted_at is null then x.body else null end,
          'deleted', x.deleted_at is not null,
          'createdAt', x.created_at
        )
        order by x.created_at desc, x.id desc
      )
      from (
        select hm.*
        from public.hub_messages hm
        where hm.conversation_id = p_conversation
          and (p_before is null or hm.created_at < p_before)
        order by hm.created_at desc, hm.id desc
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_induck_grow_ops_p1_core_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_induck_grow_ops_p1_core_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with params as (
  select now()-interval '7 days' as since_7d,(now() at time zone 'Asia/Seoul')::date as today
), e as (
  select x.* from public.induck_grow_analytics_events x,params p where x.created_at>=p.since_7d
), today_e as (
  select x.* from public.induck_grow_analytics_events x,params p where (x.created_at at time zone 'Asia/Seoul')::date=p.today
), start_count as (
  select count(distinct session_id)::numeric as n from e where event_type='semester_start'
), weeks as (
  select g.week,count(distinct e.session_id) filter(where e.event_type='week_checkpoint')::int as sessions,
    round(100.0*count(distinct e.session_id) filter(where e.event_type='week_checkpoint')/nullif((select n from start_count),0),1) as start_reach_pct
  from generate_series(1,15) g(week) left join e on e.week=g.week group by g.week
), departments as (
  select s.department,count(distinct s.session_id)::int as starts,count(distinct r.session_id)::int as results,round(avg(r.gpa)::numeric,2) as avg_gpa
  from e s left join e r on r.session_id=s.session_id and r.event_type='semester_result'
  where s.event_type='semester_start' group by s.department
), sources as (
  select acquisition_source as source,
    count(distinct session_id) filter(where event_type='landing')::int as landings,
    count(distinct session_id) filter(where event_type='play_start')::int as plays,
    count(distinct session_id) filter(where event_type='semester_start')::int as semester_starts,
    count(distinct session_id) filter(where event_type='semester_result')::int as results
  from e group by acquisition_source
), daily as (
  select (created_at at time zone 'Asia/Seoul')::date as date_kst,
    count(distinct session_id) filter(where event_type='landing')::int as landings,
    count(distinct session_id) filter(where event_type='play_start')::int as plays,
    count(distinct session_id) filter(where event_type='semester_start')::int as semester_starts,
    count(distinct session_id) filter(where event_type='semester_result')::int as results
  from e group by 1
)
select jsonb_build_object(
  'generated_at',now(),'window_days',7,
  'today',jsonb_build_object(
    'landings',(select count(distinct session_id) from today_e where event_type='landing'),
    'plays',(select count(distinct session_id) from today_e where event_type='play_start'),
    'semester_starts',(select count(distinct session_id) from today_e where event_type='semester_start'),
    'results',(select count(distinct session_id) from today_e where event_type='semester_result'),
    'retries',(select count(distinct session_id) from today_e where event_type='retry'),
    'account_saves',(select count(distinct session_id) from today_e where event_type='account_save')),
  'funnel',jsonb_build_object(
    'landings',(select count(distinct session_id) from e where event_type='landing'),
    'plays',(select count(distinct session_id) from e where event_type='play_start'),
    'semester_starts',(select count(distinct session_id) from e where event_type='semester_start'),
    'week_1',(select count(distinct session_id) from e where event_type='week_checkpoint' and week=1),
    'week_4',(select count(distinct session_id) from e where event_type='week_checkpoint' and week=4),
    'week_8',(select count(distinct session_id) from e where event_type='week_checkpoint' and week=8),
    'week_12',(select count(distinct session_id) from e where event_type='week_checkpoint' and week=12),
    'week_15',(select count(distinct session_id) from e where event_type='week_checkpoint' and week=15),
    'results',(select count(distinct session_id) from e where event_type='semester_result'),
    'retries',(select count(distinct session_id) from e where event_type='retry'),
    'account_saves',(select count(distinct session_id) from e where event_type='account_save')),
  'results',jsonb_build_object(
    'avg_gpa',(select round(avg(gpa)::numeric,2) from e where event_type='semester_result'),
    'min_gpa',(select min(gpa) from e where event_type='semester_result'),
    'max_gpa',(select max(gpa) from e where event_type='semester_result')),
  'week_reach',coalesce((select jsonb_agg(to_jsonb(w) order by w.week) from weeks w),'[]'::jsonb),
  'departments',coalesce((select jsonb_agg(to_jsonb(d) order by d.starts desc,d.department) from departments d),'[]'::jsonb),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.plays desc,s.source) from sources s),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.date_kst desc) from daily d),'[]'::jsonb));
$$;


--
-- Name: get_induck_grow_ops_p2a_core_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_induck_grow_ops_p2a_core_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with params as (select now()-interval '7 days' as since_7d),
ends as (
  select e.* from public.induck_grow_session_ends e,params p where e.created_at>=p.since_7d
), checkpoints as (
  select c.* from public.induck_grow_resource_checkpoints c,params p where c.created_at>=p.since_7d
), end_summary as (
  select count(*)::int as total,count(*) filter(where completed)::int as completed,count(*) filter(where not completed)::int as exited,
    round(100.0*count(*) filter(where completed)/nullif(count(*),0),1) as completion_rate_pct,
    round(avg(duration_sec)::numeric,1) as avg_duration_sec,
    round(avg(last_week) filter(where not completed)::numeric,1) as avg_exit_week
  from ends
), exit_screens as (
  select coalesce(last_screen,'unknown') as screen,count(*)::int as sessions
  from ends where not completed group by 1
), resources as (
  select week,count(distinct session_id)::int as sessions,
    round(avg(stamina)::numeric,1) as avg_stamina,round(avg(stress)::numeric,1) as avg_stress,
    round(avg(money)::numeric,0) as avg_money,round(avg(free_slots)::numeric,1) as avg_free_slots
  from checkpoints group by week
), outcome_resources as (
  select c.week,case when e.completed then 'completed' else 'exit' end as outcome,
    count(distinct c.session_id)::int as sessions,
    round(avg(c.stamina)::numeric,1) as avg_stamina,round(avg(c.stress)::numeric,1) as avg_stress,
    round(avg(c.money)::numeric,0) as avg_money,round(avg(c.free_slots)::numeric,1) as avg_free_slots
  from checkpoints c join ends e on e.session_id=c.session_id
  group by c.week,case when e.completed then 'completed' else 'exit' end
)
select public.get_induck_grow_ops_p1_core_v1()
  || jsonb_build_object('p2a',jsonb_build_object(
    'session_ends',(select to_jsonb(x) from end_summary x),
    'exit_screens',coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc,x.screen) from exit_screens x),'[]'::jsonb),
    'resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.week) from resources x),'[]'::jsonb),
    'outcome_resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.week,x.outcome) from outcome_resources x),'[]'::jsonb)
  ));
$$;


--
-- Name: get_induck_grow_ops_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_induck_grow_ops_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with params as (select now()-interval '7 days' as since_7d),
decisions as (
  select d.* from public.induck_grow_decision_events d,params p where d.created_at>=p.since_7d
), ends as (
  select e.* from public.induck_grow_session_ends e,params p where e.created_at>=p.since_7d
), category_stats as (
  select category,count(*)::int as events,count(distinct session_id)::int as sessions
  from decisions group by category
), choice_stats as (
  select d.category,d.decision_id,d.choice_id,
    count(distinct d.session_id)::int as sessions,
    count(distinct e.session_id)::int as ended_sessions,
    count(distinct e.session_id) filter(where e.completed)::int as completed_sessions,
    round(100.0*count(distinct e.session_id) filter(where e.completed)/nullif(count(distinct e.session_id),0),1) as completion_rate_pct,
    round(avg(e.final_gpa) filter(where e.completed)::numeric,2) as avg_final_gpa
  from decisions d left join ends e on e.session_id=d.session_id
  group by d.category,d.decision_id,d.choice_id
), department_stats as (
  select d.department,count(*)::int as events,count(distinct d.session_id)::int as sessions,
    count(distinct e.session_id) filter(where e.completed)::int as completed_sessions
  from decisions d left join ends e on e.session_id=d.session_id
  group by d.department
)
select public.get_induck_grow_ops_p2a_core_v1()
  || jsonb_build_object('p2b',jsonb_build_object(
    'decision_events',(select count(*) from decisions),
    'decision_sessions',(select count(distinct session_id) from decisions),
    'categories',coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc,x.category) from category_stats x),'[]'::jsonb),
    'choices',coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc,x.category,x.decision_id,x.choice_id) from choice_stats x),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(to_jsonb(x) order by x.sessions desc,x.department) from department_stats x),'[]'::jsonb)
  ));
$$;


--
-- Name: get_induckup_ranked_leaderboard_v1(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_induckup_ranked_leaderboard_v1(p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, best_wave integer, best_score integer, best_duration_ms integer, achieved_at timestamp with time zone, is_me boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with eligible as (
    select
      b.user_id,
      coalesce(nullif(p.nickname,''),'인덕 플레이어') as nickname,
      b.best_wave,
      b.best_score,
      b.best_duration_ms,
      b.achieved_at
    from public.induckup_ranked_bests b
    left join public.profiles p on p.user_id=b.user_id
    where coalesce(p.is_banned,false)=false
  )
  select
    row_number() over (
      order by e.best_wave desc,e.best_score desc,e.best_duration_ms desc,e.achieved_at asc,e.user_id
    ) as rank,
    e.nickname,e.best_wave,e.best_score,e.best_duration_ms,e.achieved_at,
    coalesce(e.user_id=auth.uid(),false) as is_me
  from eligible e
  order by e.best_wave desc,e.best_score desc,e.best_duration_ms desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_inha_duck_behavior_metrics_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_behavior_metrics_v1() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
with game as (
  select id
  from public.games
  where slug='inha-duck'
  limit 1
),
current_balance as (
  select ge.metadata->>'balance_version' as balance_version
  from public.game_events ge
  where ge.game_id=(select id from game)
    and nullif(ge.metadata->>'balance_version','') is not null
  order by ge.created_at desc
  limit 1
),
base as (
  select
    ge.id,
    ge.player_id,
    ge.stage_id,
    ge.event_type,
    ge.status,
    ge.created_at,
    ge.metadata,
    ge.metadata->>'balance_version' as balance_version,
    ge.metadata->>'exit_reason' as exit_reason
  from public.game_events ge
  where ge.game_id=(select id from game)
    and ge.metadata->>'run_type'='production'
    and ge.metadata->>'balance_version'=(select balance_version from current_balance)
    and ge.stage_id between 1 and 4
),
exits as (
  select
    e.*,
    (
      select min(a.created_at)
      from base a
      where a.event_type='stage_attempt'
        and a.player_id=e.player_id
        and a.stage_id=e.stage_id
        and a.created_at>e.created_at
    ) as next_attempt_at
  from base e
  where e.event_type='exit_run'
),
classified_exits as (
  select
    e.*,
    case
      when e.next_attempt_at is not null
       and e.next_attempt_at <= e.created_at + interval '30 seconds'
        then 'run_reset'
      when e.exit_reason='browser_pagehide'
        then 'browser_exit'
      else 'stage_abandon'
    end as exit_class
  from exits e
),
attempts as (
  select
    a.*,
    row_number() over (
      partition by a.player_id,a.stage_id
      order by a.created_at,a.id
    ) as attempt_no,
    (
      select r.status
      from base r
      where r.event_type='stage_result'
        and r.player_id=a.player_id
        and r.stage_id=a.stage_id
        and r.created_at<a.created_at
      order by r.created_at desc,r.id desc
      limit 1
    ) as prior_result
  from base a
  where a.event_type='stage_attempt'
),
retry_metrics as (
  select
    stage_id,
    count(*) filter(where attempt_no=1)::integer as first_attempts,
    count(*) filter(where attempt_no>1)::integer as retries,
    count(*) filter(where attempt_no>1 and prior_result='clear')::integer as retry_after_clear,
    count(*) filter(where attempt_no>1 and prior_result='failed')::integer as retry_after_fail
  from attempts
  group by stage_id
),
exit_metrics as (
  select
    stage_id,
    count(*)::integer as exits_raw,
    count(*) filter(where exit_class='run_reset')::integer as run_resets,
    count(*) filter(where exit_class='stage_abandon')::integer as stage_abandons,
    count(*) filter(where exit_class='browser_exit')::integer as browser_exits,
    round(
      100.0 * count(*) filter(where exit_class='run_reset')
      / nullif(count(*),0),1
    ) as reset_share_pct
  from classified_exits
  group by stage_id
),
stage_ids as (
  select generate_series(1,4)::smallint as stage_id
),
by_stage as (
  select
    s.stage_id,
    coalesce(e.exits_raw,0) as exits_raw,
    coalesce(e.run_resets,0) as run_resets,
    coalesce(e.stage_abandons,0) as stage_abandons,
    coalesce(e.browser_exits,0) as browser_exits,
    coalesce(e.reset_share_pct,0) as reset_share_pct,
    coalesce(r.first_attempts,0) as first_attempts,
    coalesce(r.retries,0) as retries,
    coalesce(r.retry_after_clear,0) as retry_after_clear,
    coalesce(r.retry_after_fail,0) as retry_after_fail
  from stage_ids s
  left join exit_metrics e using(stage_id)
  left join retry_metrics r using(stage_id)
),
today_exit as (
  select
    count(*)::integer as exits_raw,
    count(*) filter(where exit_class='run_reset')::integer as run_resets,
    count(*) filter(where exit_class='stage_abandon')::integer as stage_abandons,
    count(*) filter(where exit_class='browser_exit')::integer as browser_exits
  from classified_exits
  where (created_at at time zone 'Asia/Seoul')::date
        = (now() at time zone 'Asia/Seoul')::date
),
today_retry as (
  select
    count(*) filter(where attempt_no>1)::integer as retries,
    count(*) filter(where attempt_no>1 and prior_result='clear')::integer as retry_after_clear,
    count(*) filter(where attempt_no>1 and prior_result='failed')::integer as retry_after_fail
  from attempts
  where (created_at at time zone 'Asia/Seoul')::date
        = (now() at time zone 'Asia/Seoul')::date
),
total_exit as (
  select
    count(*)::integer as exits_raw,
    count(*) filter(where exit_class='run_reset')::integer as run_resets,
    count(*) filter(where exit_class='stage_abandon')::integer as stage_abandons,
    count(*) filter(where exit_class='browser_exit')::integer as browser_exits,
    round(
      100.0 * count(*) filter(where exit_class='run_reset')
      / nullif(count(*),0),1
    ) as reset_share_pct
  from classified_exits
),
total_retry as (
  select
    count(*) filter(where attempt_no>1)::integer as retries,
    count(*) filter(where attempt_no>1 and prior_result='clear')::integer as retry_after_clear,
    count(*) filter(where attempt_no>1 and prior_result='failed')::integer as retry_after_fail
  from attempts
)
select jsonb_build_object(
  'version','retry-metrics-1',
  'balance_version',(select balance_version from current_balance),
  'reset_window_seconds',30,
  'definitions',jsonb_build_object(
    'run_reset','exit_run followed by the same player retrying the same stage within 30 seconds',
    'stage_abandon','non-browser exit without a same-stage retry within 30 seconds',
    'browser_exit','browser_pagehide exit without a same-stage retry within 30 seconds',
    'retry_after_clear','repeat stage_attempt whose latest earlier stage_result was clear',
    'retry_after_fail','repeat stage_attempt whose latest earlier stage_result was failed'
  ),
  'current_balance',jsonb_build_object(
    'exits_raw',(select exits_raw from total_exit),
    'run_resets',(select run_resets from total_exit),
    'stage_abandons',(select stage_abandons from total_exit),
    'browser_exits',(select browser_exits from total_exit),
    'reset_share_pct',(select reset_share_pct from total_exit),
    'retries',(select retries from total_retry),
    'retry_after_clear',(select retry_after_clear from total_retry),
    'retry_after_fail',(select retry_after_fail from total_retry)
  ),
  'today',jsonb_build_object(
    'exits_raw',(select exits_raw from today_exit),
    'run_resets',(select run_resets from today_exit),
    'stage_abandons',(select stage_abandons from today_exit),
    'browser_exits',(select browser_exits from today_exit),
    'retries',(select retries from today_retry),
    'retry_after_clear',(select retry_after_clear from today_retry),
    'retry_after_fail',(select retry_after_fail from today_retry)
  ),
  'by_stage',(
    select jsonb_agg(to_jsonb(by_stage) order by stage_id)
    from by_stage
  )
);
$$;


--
-- Name: get_inha_duck_ops_core_private_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_ops_core_private_v1(p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.world_ops_read_allowed_v1(p_token) then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  return jsonb_build_object(
    'ops', public.get_inha_duck_ops_dashboard_v1(),
    'transitions', public.get_inha_duck_stage_transition_v1(),
    'intent', public.get_inha_duck_visit_intent_v1(),
    'stage3_gate', public.get_inha_duck_stage3_sample_gate_v1()
  );
end;
$$;


--
-- Name: get_inha_duck_ops_dashboard_core_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_ops_dashboard_core_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_game_id uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_balance_version text;
  v_result jsonb;
begin
  select id into v_game_id
  from public.games
  where slug = 'inha-duck'
  limit 1;

  select ge.metadata ->> 'balance_version'
  into v_balance_version
  from public.game_events ge
  where ge.game_id = v_game_id
    and nullif(ge.metadata ->> 'balance_version','') is not null
  order by ge.created_at desc
  limit 1;

  with
  overview as (
    select jsonb_build_object(
      'active_5m', count(distinct ge.player_id) filter (where ge.created_at >= now() - interval '5 minutes'),
      'active_30m', count(distinct ge.player_id) filter (where ge.created_at >= now() - interval '30 minutes'),
      'active_today', count(distinct ge.player_id) filter (where (ge.created_at at time zone 'Asia/Seoul')::date = v_today),
      'sessions_today', (
        select count(*)
        from public.game_sessions gs
        where gs.game_id = v_game_id
          and (gs.started_at at time zone 'Asia/Seoul')::date = v_today
      ),
      'attempts_today', count(*) filter (
        where ge.event_type='stage_attempt'
          and (ge.created_at at time zone 'Asia/Seoul')::date = v_today
      ),
      'results_today', count(*) filter (
        where ge.event_type='stage_result'
          and (ge.created_at at time zone 'Asia/Seoul')::date = v_today
      ),
      'exits_today', count(*) filter (
        where ge.event_type='exit_run'
          and (ge.created_at at time zone 'Asia/Seoul')::date = v_today
      ),
      'last_event_at', max(ge.created_at)
    ) as j
    from public.game_events ge
    where ge.game_id = v_game_id
  ),
  funnel as (
    select coalesce(to_jsonb(f) - 'game_id' - 'game_slug' - 'game_name', '{}'::jsonb) as j
    from analytics.daily_funnel_metrics f
    where f.game_id = v_game_id and f.date = v_today
    limit 1
  ),
  daily as (
    select coalesce(to_jsonb(d) - 'game_id' - 'game_slug' - 'game_name', '{}'::jsonb) as j
    from analytics.daily_game_metrics d
    where d.game_id = v_game_id and d.date = v_today
    limit 1
  ),
  attempts as (
    select
      ge.run_id,
      ge.stage_id,
      ge.player_id,
      ge.created_at
    from public.game_events ge
    where ge.game_id = v_game_id
      and ge.event_type = 'stage_attempt'
      and ge.run_id is not null
      and (v_balance_version is null or ge.metadata ->> 'balance_version' = v_balance_version)
  ),
  terminals as (
    select distinct on (ge.run_id)
      ge.run_id,
      ge.event_type,
      ge.status,
      ge.score,
      ge.combo,
      ge.stars,
      case when (ge.metadata->>'duration_ms') ~ '^[0-9]+$'
        then (ge.metadata->>'duration_ms')::integer end as duration_ms,
      case when (ge.metadata->>'annyongi_clicks') ~ '^[0-9]+$'
        then (ge.metadata->>'annyongi_clicks')::integer end as annyongi_clicks,
      case when (ge.metadata->>'indeok_hits') ~ '^[0-9]+$'
        then (ge.metadata->>'indeok_hits')::integer end as indeok_hits,
      case when (ge.metadata->>'gold_hits') ~ '^[0-9]+$'
        then (ge.metadata->>'gold_hits')::integer end as gold_hits
    from public.game_events ge
    where ge.game_id = v_game_id
      and ge.event_type in ('stage_result','exit_run')
      and ge.run_id is not null
      and (v_balance_version is null or ge.metadata ->> 'balance_version' = v_balance_version)
    order by ge.run_id,
      case when ge.event_type='stage_result' then 0 else 1 end,
      ge.created_at desc
  ),
  stage_rows as (
    select
      a.stage_id,
      count(*)::integer as attempts,
      count(distinct a.player_id)::integer as players,
      count(*) filter (where t.status='clear')::integer as clears,
      count(*) filter (where t.status='failed')::integer as fails,
      count(*) filter (where t.event_type='exit_run')::integer as exits,
      count(*) filter (where t.run_id is null)::integer as unresolved,
      round(
        100.0 * count(*) filter (where t.status='clear')
        / nullif(count(*),0), 1
      ) as clear_rate_pct,
      round(((avg(t.duration_ms) filter (where t.duration_ms is not null))/1000.0)::numeric,2) as avg_sec,
      round((avg(t.score) filter (where t.score is not null))::numeric,1) as avg_score,
      round((avg(t.stars) filter (where t.stars is not null))::numeric,2) as avg_stars,
      round((avg(t.annyongi_clicks) filter (where t.annyongi_clicks is not null))::numeric,2) as avg_annyongi,
      round((avg(t.indeok_hits) filter (where t.indeok_hits is not null))::numeric,2) as avg_indeok,
      round((avg(t.gold_hits) filter (where t.gold_hits is not null))::numeric,2) as avg_gold
    from attempts a
    left join terminals t using (run_id)
    group by a.stage_id
    order by a.stage_id
  ),
  stage_json as (
    select coalesce(jsonb_agg(to_jsonb(stage_rows) order by stage_id), '[]'::jsonb) as j
    from stage_rows
  ),
  ranked as (
    select jsonb_build_object(
      'sessions_total', count(*),
      'players_total', count(distinct rs.user_id),
      'accepted', count(*) filter (where rs.status='accepted'),
      'rejected', count(*) filter (where rs.status='rejected'),
      'open', count(*) filter (where rs.status='started'),
      'accept_rate_terminal_pct',
        round(
          100.0 * count(*) filter (where rs.status='accepted')
          / nullif(count(*) filter (where rs.status in ('accepted','rejected')),0),
          1
        ),
      'accepted_runs', (
        select count(*) from public.ranked_runs rr
        where rr.run_type='ranked' and rr.validation_status='accepted'
      ),
      'avg_accepted_score', (
        select round(avg(rr.score)::numeric,1)
        from public.ranked_runs rr
        where rr.run_type='ranked' and rr.validation_status='accepted'
      ),
      'median_accepted_score', (
        select percentile_cont(0.5) within group(order by rr.score)
        from public.ranked_runs rr
        where rr.run_type='ranked' and rr.validation_status='accepted'
      )
    ) as j
    from public.ranked_sessions rs
    where rs.run_type='ranked'
  ),
  retention as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'cohort_date', r.cohort_date,
          'cohort_size', r.cohort_size,
          'd1_retention', r.d1_retention,
          'd3_retention', r.d3_retention,
          'd7_retention', r.d7_retention,
          'd14_retention', r.d14_retention,
          'd30_retention', r.d30_retention
        )
        order by r.cohort_date desc
      ),
      '[]'::jsonb
    ) as j
    from (
      select *
      from analytics.retention_cohorts
      where game_id = v_game_id
      order by cohort_date desc
      limit 14
    ) r
  ),
  hourly as (
    select coalesce(
      jsonb_agg(to_jsonb(h) order by h.hour_kst),
      '[]'::jsonb
    ) as j
    from (
      select
        date_trunc('hour', ge.created_at at time zone 'Asia/Seoul') as hour_kst,
        count(*) filter (where ge.event_type='session_start')::integer as session_starts,
        count(distinct ge.player_id)::integer as active_players,
        count(*) filter (where ge.event_type='stage_attempt')::integer as attempts,
        count(*) filter (where ge.event_type='stage_result')::integer as results,
        count(*) filter (where ge.event_type='exit_run')::integer as exits
      from public.game_events ge
      where ge.game_id = v_game_id
        and ge.created_at >= now() - interval '12 hours'
        and ge.event_type in ('session_start','stage_attempt','stage_result','exit_run')
      group by 1
      order by 1
    ) h
  ),
  source_device as (
    select coalesce(
      jsonb_agg(to_jsonb(s) order by s.sessions desc, s.source, s.device),
      '[]'::jsonb
    ) as j
    from (
      select
        coalesce(nullif(ge.metadata->>'source',''), 'unknown') as source,
        coalesce(nullif(ge.metadata->>'device',''), 'unknown') as device,
        count(*)::integer as sessions,
        count(distinct ge.player_id)::integer as players
      from public.game_events ge
      where ge.game_id = v_game_id
        and ge.event_type='session_start'
        and (v_balance_version is null or ge.metadata->>'balance_version'=v_balance_version)
      group by 1,2
    ) s
  )
  select jsonb_build_object(
    'generated_at', now(),
    'date_kst', v_today,
    'balance_version', v_balance_version,
    'overview', (select j from overview),
    'funnel', coalesce((select j from funnel), '{}'::jsonb),
    'daily', coalesce((select j from daily), '{}'::jsonb),
    'stage_balance', (select j from stage_json),
    'ranked', (select j from ranked),
    'retention', (select j from retention),
    'hourly', (select j from hourly),
    'source_device', (select j from source_device)
  )
  into v_result;

  return v_result;
end;
$_$;


--
-- Name: get_inha_duck_ops_dashboard_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_ops_dashboard_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_core jsonb;
  v_behavior jsonb;
  v_ranked jsonb;
  v_stage jsonb;
  v_overview jsonb;
begin
  v_core := public.get_inha_duck_ops_dashboard_core_v1();
  v_behavior := public.get_inha_duck_behavior_metrics_v1();
  v_ranked := public.get_inha_duck_ranked_lifecycle_v2();

  v_overview :=
    coalesce(v_core->'overview','{}'::jsonb)
    || jsonb_build_object(
      'exits_today_raw', coalesce((v_behavior#>>'{today,exits_raw}')::integer,0),
      'run_resets_today', coalesce((v_behavior#>>'{today,run_resets}')::integer,0),
      'stage_abandons_today', coalesce((v_behavior#>>'{today,stage_abandons}')::integer,0),
      'browser_exits_today', coalesce((v_behavior#>>'{today,browser_exits}')::integer,0),
      'retries_today', coalesce((v_behavior#>>'{today,retries}')::integer,0),
      'retry_after_clear_today', coalesce((v_behavior#>>'{today,retry_after_clear}')::integer,0),
      'retry_after_fail_today', coalesce((v_behavior#>>'{today,retry_after_fail}')::integer,0)
    );

  select coalesce(
    jsonb_agg(
      sb.elem
      || jsonb_build_object(
        'exits_raw', coalesce((bm.elem->>'exits_raw')::integer,0),
        'run_resets', coalesce((bm.elem->>'run_resets')::integer,0),
        'stage_abandons', coalesce((bm.elem->>'stage_abandons')::integer,0),
        'browser_exits', coalesce((bm.elem->>'browser_exits')::integer,0),
        'reset_share_pct', coalesce((bm.elem->>'reset_share_pct')::numeric,0),
        'retries', coalesce((bm.elem->>'retries')::integer,0),
        'retry_after_clear', coalesce((bm.elem->>'retry_after_clear')::integer,0),
        'retry_after_fail', coalesce((bm.elem->>'retry_after_fail')::integer,0)
      )
      order by (sb.elem->>'stage_id')::integer
    ),
    '[]'::jsonb
  )
  into v_stage
  from jsonb_array_elements(coalesce(v_core->'stage_balance','[]'::jsonb)) sb(elem)
  left join jsonb_array_elements(coalesce(v_behavior->'by_stage','[]'::jsonb)) bm(elem)
    on (bm.elem->>'stage_id')::integer=(sb.elem->>'stage_id')::integer;

  return
    v_core
    || jsonb_build_object(
      'overview',v_overview,
      'stage_balance',v_stage,
      'behavior',v_behavior,
      'ranked',
        coalesce(v_core->'ranked','{}'::jsonb)
        || coalesce(v_ranked,'{}'::jsonb)
    );
end;
$$;


--
-- Name: get_inha_duck_ops_private_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_ops_private_v1(p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_classic jsonb;
begin
  v_classic:=public.get_inha_duck_ops_core_private_v1(p_token);
  return v_classic||jsonb_build_object('hub',public.get_inhagame_hub_ops_v1(),'grow_analytics',public.get_induck_grow_ops_v1());
end;
$$;


--
-- Name: get_inha_duck_ranked_lifecycle_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_ranked_lifecycle_v1() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
with normalized as (
  select
    rs.*,
    case
      when rs.status in ('started','submitted') and rs.expires_at <= now() then 'expired'
      else rs.status
    end as effective_status
  from public.ranked_sessions rs
  where rs.run_type='ranked'
),
counts as (
  select
    count(*)::integer as sessions_total,
    count(distinct user_id)::integer as players_total,
    count(*) filter(where effective_status='started')::integer as active_started,
    count(*) filter(where effective_status='submitted')::integer as submitted,
    count(*) filter(where effective_status='accepted')::integer as accepted,
    count(*) filter(where effective_status='rejected')::integer as rejected,
    count(*) filter(where effective_status='abandoned')::integer as abandoned,
    count(*) filter(where effective_status='expired')::integer as expired
  from normalized
)
select jsonb_build_object(
  'sessions_total',sessions_total,
  'players_total',players_total,
  'active_started',active_started,
  'submitted',submitted,
  'accepted',accepted,
  'rejected',rejected,
  'abandoned',abandoned,
  'expired',expired,
  'terminal_sessions',accepted+rejected+abandoned+expired,
  'play_completion_rate_pct',
    round(100.0*(accepted+rejected)/nullif(accepted+rejected+abandoned+expired,0),1),
  'submission_validation_rate_pct',
    round(100.0*accepted/nullif(accepted+rejected,0),1)
)
from counts;
$$;


--
-- Name: get_inha_duck_ranked_lifecycle_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_ranked_lifecycle_v2() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
with ordered as (
  select
    rs.*,
    case
      when rs.status in ('started','submitted') and rs.expires_at <= now() then 'expired'
      else rs.status
    end as effective_status,
    lead(rs.started_at) over (
      partition by rs.user_id order by rs.started_at, rs.run_id
    ) as next_started_at
  from public.ranked_sessions rs
  where rs.run_type='ranked'
),
classified as (
  select
    o.*,
    case
      when o.effective_status='abandoned'
       and o.next_started_at is not null
       and o.abandoned_at is not null
       and o.next_started_at >= o.abandoned_at
       and o.next_started_at <= o.abandoned_at + interval '30 seconds'
        then 'reset'
      when o.effective_status='expired'
       and o.next_started_at is not null
       and o.next_started_at < coalesce(o.expired_at,o.expires_at)
        then 'superseded'
      when o.effective_status in ('abandoned','expired')
        then 'genuine_exit'
      when o.effective_status='accepted'
        then 'accepted'
      when o.effective_status='rejected'
        then 'rejected'
      when o.effective_status in ('started','submitted')
        then 'active'
      else 'other'
    end as semantic_status
  from ordered o
),
counts as (
  select
    count(*)::integer as sessions_total,
    count(distinct user_id)::integer as players_total,
    count(*) filter(where effective_status='started')::integer as active_started,
    count(*) filter(where effective_status='submitted')::integer as submitted,
    count(*) filter(where effective_status='accepted')::integer as accepted,
    count(*) filter(where effective_status='rejected')::integer as rejected,
    count(*) filter(where effective_status='abandoned')::integer as abandoned_raw,
    count(*) filter(where effective_status='expired')::integer as expired_raw,
    count(*) filter(where semantic_status='reset')::integer as reset_sessions,
    count(*) filter(where semantic_status='superseded')::integer as superseded_sessions,
    count(*) filter(where semantic_status in ('reset','superseded'))::integer as reset_superseded,
    count(*) filter(where semantic_status='genuine_exit')::integer as genuine_exits,
    count(*) filter(where semantic_status='active')::integer as active_sessions
  from classified
),
recovery as (
  select
    count(*) filter(where record_kind='incident_summary')::integer as incident_summary_records,
    count(*) filter(where record_kind='full_snapshot')::integer as full_snapshot_records,
    count(*)::integer as recovery_records_total,
    count(distinct user_id) filter(where user_id is not null)::integer as recovery_players
  from public.ranked_recovery_records
  where validation_status in ('recovered_unverified','reviewed')
),
eligibility as (
  select
    count(*)::integer as eligible_players,
    count(*) filter(where claimed_at is not null)::integer as claimed_players,
    coalesce(sum(failure_count),0)::integer as failed_start_events
  from public.ranked_recovery_eligibility
  where incident_key='ranked-start-v6-8-20260924'
)
select jsonb_build_object(
  'version','ranked-lifecycle-2',
  'reset_window_seconds',30,
  'sessions_total',c.sessions_total,
  'players_total',c.players_total,
  'accepted',c.accepted,
  'rejected',c.rejected,
  'reset',c.reset_sessions,
  'superseded',c.superseded_sessions,
  'reset_superseded',c.reset_superseded,
  'genuine_exit',c.genuine_exits,
  'active',c.active_sessions,
  'raw',jsonb_build_object(
    'active_started',c.active_started,
    'submitted',c.submitted,
    'accepted',c.accepted,
    'rejected',c.rejected,
    'abandoned',c.abandoned_raw,
    'expired',c.expired_raw
  ),
  'competitive_terminal_sessions',c.accepted+c.rejected+c.genuine_exits,
  'competitive_completion_rate_pct',
    round(100.0*(c.accepted+c.rejected)/nullif(c.accepted+c.rejected+c.genuine_exits,0),1),
  'submission_validation_rate_pct',
    round(100.0*c.accepted/nullif(c.accepted+c.rejected,0),1),
  'reset_superseded_share_pct',
    round(100.0*c.reset_superseded/nullif(c.accepted+c.rejected+c.reset_superseded+c.genuine_exits,0),1),
  'recovery',jsonb_build_object(
    'records_total',r.recovery_records_total,
    'players',r.recovery_players,
    'incident_summary_records',r.incident_summary_records,
    'full_snapshot_records',r.full_snapshot_records,
    'incident_eligible_players',e.eligible_players,
    'incident_claimed_players',e.claimed_players,
    'incident_failed_start_events',e.failed_start_events
  ),
  'definitions',jsonb_build_object(
    'reset','abandoned session followed by the same user starting another ranked session within 30 seconds',
    'superseded','expired session where the same user started another ranked session before the prior session expiry',
    'genuine_exit','abandoned/expired session that does not meet reset or superseded criteria',
    'recovery','locally preserved ranked evidence collected after a server/session failure; not official leaderboard authority'
  )
)
from counts c
cross join recovery r
cross join eligibility e;
$$;


--
-- Name: get_inha_duck_stage3_sample_alert_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_stage3_sample_alert_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_gate jsonb;
  v_attempts integer;
  v_state public.ops_alert_state%rowtype;
begin
  select public.get_inha_duck_stage3_sample_gate_v1() into v_gate;
  v_attempts := coalesce((v_gate->>'attempts')::integer,0);

  update public.ops_alert_state
  set
    status = case
      when notified_at is not null then 'notified'
      when v_attempts >= threshold_value then 'triggered'
      else 'armed'
    end,
    triggered_at = case
      when v_attempts >= threshold_value
        then coalesce(triggered_at,now())
      else triggered_at
    end,
    last_value=v_attempts,
    payload=payload || jsonb_build_object('gate',v_gate),
    updated_at=now()
  where alert_key='inha_duck_stage3_v102_attempts_20'
  returning * into v_state;

  return jsonb_build_object(
    'alert_key',v_state.alert_key,
    'status',v_state.status,
    'triggered_at',v_state.triggered_at,
    'notified_at',v_state.notified_at,
    'attempts',v_attempts,
    'threshold',v_state.threshold_value,
    'should_notify',
      (v_attempts >= v_state.threshold_value and v_state.notified_at is null),
    'gate',v_gate,
    'slack_channel_id',v_state.payload->>'slack_channel_id'
  );
end;
$$;


--
-- Name: get_inha_duck_stage3_sample_gate_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_stage3_sample_gate_v1() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
with game as (
  select id from public.games where slug='inha-duck' limit 1
),
attempts as (
  select
    count(*)::integer as attempt_count,
    count(distinct ge.player_id)::integer as player_count,
    min(ge.created_at) as first_attempt_at,
    max(ge.created_at) as last_attempt_at
  from public.game_events ge
  where ge.game_id=(select id from game)
    and ge.event_type='stage_attempt'
    and ge.stage_id=3
    and ge.metadata->>'balance_version'='classic-balance-1.0.2'
    and ge.metadata->>'run_type'='production'
),
results as (
  select
    count(*)::integer as result_count,
    count(*) filter(where ge.status='clear')::integer as clears,
    count(*) filter(where ge.status='failed')::integer as fails
  from public.game_events ge
  where ge.game_id=(select id from game)
    and ge.event_type='stage_result'
    and ge.stage_id=3
    and ge.metadata->>'balance_version'='classic-balance-1.0.2'
    and ge.metadata->>'run_type'='production'
),
behavior as (
  select elem
  from jsonb_array_elements(
    coalesce(public.get_inha_duck_behavior_metrics_v1()->'by_stage','[]'::jsonb)
  ) elem
  where (elem->>'stage_id')::integer=3
  limit 1
)
select jsonb_build_object(
  'stage_id',3,
  'balance_version','classic-balance-1.0.2',
  'run_type','production',
  'target_attempts',20,
  'attempts',a.attempt_count,
  'remaining',greatest(20-a.attempt_count,0),
  'progress_pct',least(round(100.0*a.attempt_count/20.0,1),100.0),
  'players',a.player_count,
  'results',r.result_count,
  'clears',r.clears,
  'fails',r.fails,
  'exits',coalesce((b.elem->>'exits_raw')::integer,0),
  'exits_raw',coalesce((b.elem->>'exits_raw')::integer,0),
  'run_resets',coalesce((b.elem->>'run_resets')::integer,0),
  'stage_abandons',coalesce((b.elem->>'stage_abandons')::integer,0),
  'browser_exits',coalesce((b.elem->>'browser_exits')::integer,0),
  'retry_after_clear',coalesce((b.elem->>'retry_after_clear')::integer,0),
  'retry_after_fail',coalesce((b.elem->>'retry_after_fail')::integer,0),
  'first_attempt_at',a.first_attempt_at,
  'last_attempt_at',a.last_attempt_at,
  'gate_status',case when a.attempt_count>=20 then 'PASS' else 'COLLECTING' end
)
from attempts a cross join results r
left join behavior b on true;
$$;


--
-- Name: get_inha_duck_stage_transition_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_stage_transition_v1() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
with game as (
  select id
  from public.games
  where slug='inha-duck'
  limit 1
),
telemetry_start as (
  select min(ge.created_at) as started_at
  from public.game_events ge
  where ge.game_id=(select id from game)
    and ge.event_type in (
      'stage_result_view',
      'next_stage_cta_view',
      'next_stage_cta_click',
      'stage_select_return'
    )
),
base as (
  select
    ge.run_id,
    ge.game_session_id,
    ge.stage_id as from_stage,
    (ge.metadata->>'target_stage_id')::smallint as target_stage,
    case
      when ge.metadata ? 'clear'
      then (ge.metadata->>'clear')::boolean
      else null
    end as clear_flag,
    ge.event_type,
    ge.status,
    ge.created_at
  from public.game_events ge
  where ge.game_id=(select id from game)
    and ge.created_at >= coalesce((select started_at from telemetry_start),now())
    and ge.event_type in (
      'stage_result_view',
      'next_stage_cta_view',
      'next_stage_cta_click',
      'stage_select_return'
    )
),
transitions as (
  select generate_series(1,3)::smallint as from_stage
),
agg as (
  select
    t.from_stage,
    (t.from_stage+1)::smallint as to_stage,
    count(distinct b.run_id) filter(
      where b.event_type='stage_result_view'
        and b.status='clear'
        and b.from_stage=t.from_stage
    )::integer as clear_result_views,
    count(distinct b.run_id) filter(
      where b.event_type='next_stage_cta_view'
        and b.from_stage=t.from_stage
        and b.target_stage=t.from_stage+1
    )::integer as cta_views,
    count(distinct b.run_id) filter(
      where b.event_type='next_stage_cta_click'
        and b.from_stage=t.from_stage
        and b.target_stage=t.from_stage+1
    )::integer as cta_clicks,
    count(distinct b.run_id) filter(
      where b.event_type='stage_select_return'
        and b.from_stage=t.from_stage
        and b.clear_flag is true
    )::integer as stage_select_returns
  from transitions t
  left join base b on b.from_stage=t.from_stage
  group by t.from_stage
),
starts as (
  select
    a.from_stage,
    count(distinct c.run_id) filter(where attempt.id is not null)::integer
      as clicks_with_next_stage_start
  from agg a
  left join base c
    on c.event_type='next_stage_cta_click'
   and c.from_stage=a.from_stage
   and c.target_stage=a.to_stage
  left join public.game_events attempt
    on attempt.game_id=(select id from game)
   and attempt.game_session_id=c.game_session_id
   and attempt.event_type='stage_attempt'
   and attempt.stage_id=a.to_stage
   and attempt.created_at>=c.created_at
   and attempt.created_at<=c.created_at+interval '2 minutes'
  group by a.from_stage
)
select jsonb_build_object(
  'telemetry_since',(select started_at from telemetry_start),
  'transitions',
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'from_stage',a.from_stage,
        'to_stage',a.to_stage,
        'clear_result_views',a.clear_result_views,
        'cta_views',a.cta_views,
        'cta_clicks',a.cta_clicks,
        'stage_select_returns',a.stage_select_returns,
        'clicks_with_next_stage_start',s.clicks_with_next_stage_start,
        'cta_click_rate',
          case when a.cta_views=0 then null
               else round(a.cta_clicks::numeric/a.cta_views,4) end,
        'click_to_start_rate',
          case when a.cta_clicks=0 then null
               else round(s.clicks_with_next_stage_start::numeric/a.cta_clicks,4) end,
        'stage_select_return_rate',
          case when a.clear_result_views=0 then null
               else round(a.stage_select_returns::numeric/a.clear_result_views,4) end
      )
      order by a.from_stage
    ),
    '[]'::jsonb
  )
)
from agg a
join starts s using(from_stage);
$$;


--
-- Name: get_inha_duck_visit_intent_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inha_duck_visit_intent_v1() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
with game as (
  select id
  from public.games
  where slug='inha-duck'
  limit 1
),
telemetry_start as (
  select min(ge.created_at) as started_at
  from public.game_events ge
  where ge.game_id=(select id from game)
    and ge.event_type in ('leaderboard_view','stage_select_view','ranked_cta_click','session_end')
),
eligible_sessions as (
  select gs.id, gs.player_id, gs.started_at
  from public.game_sessions gs
  where gs.game_id=(select id from game)
    and gs.started_at >= coalesce((select started_at from telemetry_start), now())
),
signals as (
  select
    es.id as game_session_id,
    es.player_id,
    bool_or(ge.event_type='stage_attempt') as general_play,
    bool_or(ge.event_type='ranked_cta_click') as ranked_play,
    bool_or(ge.event_type='leaderboard_view') as leaderboard_view,
    bool_or(ge.event_type='stage_select_view') as stage_select_view,
    bool_or(ge.event_type='session_end') as session_ended,
    (
      array_agg(
        ge.metadata->>'last_screen'
        order by ge.created_at desc
      ) filter (
        where ge.event_type='session_end'
          and ge.metadata->>'last_screen' is not null
      )
    )[1] as last_screen
  from eligible_sessions es
  left join public.game_events ge
    on ge.game_session_id=es.id
  group by es.id, es.player_id
),
classified as (
  select *,
    case
      when general_play and ranked_play then 'mixed'
      when general_play then 'general'
      when ranked_play then 'ranked'
      when leaderboard_view then 'ranking_only'
      else 'browse_only'
    end as intent
  from signals
),
intent_counts as (
  select intent, count(*)::integer as sessions, count(distinct player_id)::integer as players
  from classified
  group by intent
),
last_screen_counts as (
  select coalesce(last_screen,'unknown') as last_screen, count(*)::integer as sessions
  from classified
  where intent in ('ranking_only','browse_only')
  group by coalesce(last_screen,'unknown')
)
select jsonb_build_object(
  'telemetry_since', (select started_at from telemetry_start),
  'total_sessions', (select count(*) from classified),
  'intent_counts', coalesce(
    (select jsonb_agg(to_jsonb(intent_counts) order by sessions desc, intent) from intent_counts),
    '[]'::jsonb
  ),
  'last_screen_counts', coalesce(
    (select jsonb_agg(to_jsonb(last_screen_counts) order by sessions desc, last_screen) from last_screen_counts),
    '[]'::jsonb
  )
);
$$;


--
-- Name: get_inhagame_hub_ops_core_p1_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inhagame_hub_ops_core_p1_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with limits as (
  select (now() at time zone 'Asia/Seoul')::date as today,
         now() - interval '7 days' as since_7d
), today_events as (
  select e.* from public.inhagame_hub_events e, limits l
  where (e.created_at at time zone 'Asia/Seoul')::date=l.today
), targets as (
  select target, count(*)::int as clicks, count(distinct session_id)::int as sessions
  from today_events where event_type in ('hub_game_click','campus_entry_click')
  group by target
), panels as (
  select surface, count(*)::int as views, count(distinct session_id)::int as sessions
  from today_events where event_type='hub_panel_view'
  group by surface
), zones as (
  select target as zone, count(distinct session_id)::int as sessions
  from today_events where event_type='campus_zone_enter'
  group by target
), daily as (
  select (e.created_at at time zone 'Asia/Seoul')::date as date_kst,
    count(distinct e.session_id) filter(where e.event_type='hub_visit')::int as hub_sessions,
    count(distinct e.visitor_id) filter(where e.event_type='hub_visit')::int as hub_visitors,
    count(*) filter(where e.event_type in ('hub_game_click','campus_entry_click'))::int as game_clicks
  from public.inhagame_hub_events e, limits l
  where e.created_at >= l.since_7d
  group by 1
)
select jsonb_build_object(
  'generated_at',now(),
  'date_kst',(select today from limits),
  'today',jsonb_build_object(
    'hub_visits',(select count(*) from today_events where event_type='hub_visit'),
    'hub_sessions',(select count(distinct session_id) from today_events where event_type='hub_visit'),
    'hub_visitors',(select count(distinct visitor_id) from today_events where event_type='hub_visit'),
    'game_clicks',(select count(*) from today_events where event_type in ('hub_game_click','campus_entry_click')),
    'campus_ready',(select count(distinct session_id) from today_events where event_type='campus_boot_ready'),
    'campus_errors',(select count(*) from today_events where event_type='campus_boot_error')
  ),
  'targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.clicks desc,t.target) from targets t),'[]'::jsonb),
  'panels',coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc,p.surface) from panels p),'[]'::jsonb),
  'zones',coalesce((select jsonb_agg(to_jsonb(z) order by z.sessions desc,z.zone) from zones z),'[]'::jsonb),
  'entry_funnel',(
    select jsonb_agg(jsonb_build_object(
      'target',g.target,
      'impressions',(select count(distinct e.session_id) from today_events e
        where e.event_type='hub_card_impression' and e.target=g.target),
      'clicks',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target),
      'landings',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='game_landing')),
      'plays',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='game_play_start')),
      'first_results',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='game_first_result')),
      'first_clears',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='game_first_clear')),
      'retries',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='game_retry')),
      'ranked_starts',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','profile_game_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='classic_ranked_start')),
      'returning_visitors_7d',(
        select count(*) from (
          select e.visitor_id from public.inhagame_hub_events e
          where e.event_type in ('hub_game_click','campus_entry_click')
            and e.target=g.target and e.created_at>=now()-interval '7 days'
          group by e.visitor_id
          having count(distinct (e.created_at at time zone 'Asia/Seoul')::date)>1
        ) repeat_visitors
      ),
      'errors',(select count(*) from today_events e
        where e.event_type in ('hub_game_click','campus_entry_click') and e.target=g.target
          and exists(select 1 from public.inhagame_hub_events a
            where a.entry_id=e.event_id and a.event_type='game_load_error'))
    ) order by g.target)
    from unnest(array['campus','classic','induck-grow','induckup','survival']) as g(target)
  ),
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.date_kst desc) from daily d),'[]'::jsonb)
);
$$;


--
-- Name: get_inhagame_hub_ops_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inhagame_hub_ops_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with params as (
  select
    now()-interval '7 days' as since_7d,
    '2026-09-25 22:29:00+09'::timestamptz as launch_start
), source_keys as (
  select distinct acquisition_source as source
  from public.inhagame_hub_events, params
  where created_at>=params.since_7d and event_type='hub_visit'
), source_stats as (
  select
    s.source,
    (select count(distinct e.session_id) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='hub_visit' and e.acquisition_source=s.source) as hub_sessions,
    (select count(distinct e.visitor_id) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='hub_visit' and e.acquisition_source=s.source) as hub_visitors,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='hub_game_click' and e.target='induck-grow' and e.acquisition_source=s.source) as grow_clicks,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='game_landing' and e.target='induck-grow' and e.acquisition_source=s.source) as grow_landings,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='game_play_start' and e.target='induck-grow' and e.acquisition_source=s.source) as grow_plays,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='hub_game_click' and e.target='classic' and e.acquisition_source=s.source) as classic_clicks,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='game_landing' and e.target='classic' and e.acquisition_source=s.source) as classic_landings,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='game_play_start' and e.target='classic' and e.acquisition_source=s.source) as classic_plays,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='classic_ranked_start' and e.target='classic' and e.acquisition_source=s.source) as classic_ranked_starts
  from source_keys s
), campaign_keys as (
  select distinct campaign
  from public.inhagame_hub_events, params
  where created_at>=params.since_7d and event_type='hub_visit' and campaign is not null
), campaign_stats as (
  select
    c.campaign,
    (select count(distinct e.session_id) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='hub_visit' and e.campaign=c.campaign) as hub_sessions,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='hub_game_click' and e.target='induck-grow' and e.campaign=c.campaign) as grow_clicks,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='game_play_start' and e.target='induck-grow' and e.campaign=c.campaign) as grow_plays,
    (select count(*) from public.inhagame_hub_events e, params
      where e.created_at>=params.since_7d and e.event_type='classic_ranked_start' and e.target='classic' and e.campaign=c.campaign) as classic_ranked_starts
  from campaign_keys c
), launch as (
  select
    (select launch_start from params) as started_at,
    count(distinct session_id) filter(where event_type='hub_visit') as hub_sessions,
    count(distinct visitor_id) filter(where event_type='hub_visit') as hub_visitors,
    count(*) filter(where event_type='hub_game_click' and target='induck-grow') as grow_clicks,
    count(*) filter(where event_type='game_landing' and target='induck-grow') as grow_landings,
    count(*) filter(where event_type='game_play_start' and target='induck-grow') as grow_plays,
    count(*) filter(where event_type='hub_game_click' and target='classic') as classic_clicks,
    count(*) filter(where event_type='classic_ranked_start' and target='classic') as classic_ranked_starts
  from public.inhagame_hub_events, params
  where created_at>=params.launch_start
)
select public.get_inhagame_hub_ops_core_p1_v1()
  || jsonb_build_object(
    'profile',jsonb_build_object(
      'views',(select count(*) from public.inhagame_hub_events
        where event_type='profile_view' and created_at>=now()-interval '7 days'),
      'edit_opens',(select count(*) from public.inhagame_hub_events
        where event_type='profile_edit_open' and created_at>=now()-interval '7 days'),
      'edit_saves',(select count(*) from public.inhagame_hub_events
        where event_type='profile_edit_save' and created_at>=now()-interval '7 days'),
      'game_clicks',(select count(*) from public.inhagame_hub_events
        where event_type='profile_game_click' and created_at>=now()-interval '7 days')
    ),
    'acquisition',jsonb_build_object(
      'window_days',7,
      'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.hub_sessions desc,s.source) from source_stats s),'[]'::jsonb),
      'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.hub_sessions desc,c.campaign) from campaign_stats c),'[]'::jsonb),
      'launch_window',(select to_jsonb(l) from launch l)
    )
  );
$$;


--
-- Name: get_inhagame_member_activity_ops_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inhagame_member_activity_ops_v1(p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_total integer;
  v_dau integer;
  v_wau integer;
  v_mau integer;
  v_new_active integer;
  v_daily jsonb;
  v_first date;
begin
  if not private.world_ops_read_allowed_v1(p_token) then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  select count(*)::int into v_total
  from auth.users u
  where coalesce(u.is_anonymous,false)=false;

  select count(distinct a.user_id)::int into v_dau
  from private.inhagame_member_activity_daily a
  where a.activity_date_kst=v_today;

  select count(distinct a.user_id)::int into v_wau
  from private.inhagame_member_activity_daily a
  where a.activity_date_kst between v_today-6 and v_today;

  select count(distinct a.user_id)::int into v_mau
  from private.inhagame_member_activity_daily a
  where a.activity_date_kst between v_today-29 and v_today;

  select count(*)::int into v_new_active
  from private.inhagame_member_activity_daily a
  join auth.users u on u.id=a.user_id
  where a.activity_date_kst=v_today
    and (u.created_at at time zone 'Asia/Seoul')::date=v_today;

  select min(activity_date_kst) into v_first
  from private.inhagame_member_activity_daily;

  with days as (
    select generate_series(v_today-13,v_today,interval '1 day')::date as day
  ),
  rows as (
    select
      d.day,
      count(a.user_id)::int as active_members,
      count(a.user_id) filter (
        where (u.created_at at time zone 'Asia/Seoul')::date=d.day
      )::int as new_active
    from days d
    left join private.inhagame_member_activity_daily a
      on a.activity_date_kst=d.day
    left join auth.users u on u.id=a.user_id
    group by d.day
    order by d.day
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date',day,
      'activeMembers',active_members,
      'newActive',new_active,
      'returningActive',greatest(active_members-new_active,0)
    )
    order by day
  ),'[]'::jsonb)
  into v_daily
  from rows;

  return jsonb_build_object(
    'dau',v_dau,
    'wau',v_wau,
    'mau',v_mau,
    'totalMembers',v_total,
    'dauRatePct',case when v_total>0 then round(v_dau::numeric/v_total*100,1) else 0 end,
    'wauRatePct',case when v_total>0 then round(v_wau::numeric/v_total*100,1) else 0 end,
    'mauRatePct',case when v_total>0 then round(v_mau::numeric/v_total*100,1) else 0 end,
    'todayNewActive',v_new_active,
    'todayReturning',greatest(v_dau-v_new_active,0),
    'daily14',v_daily,
    'historyFirstDate',v_first,
    'liveTrackingSince','2026-09-27'::date,
    'historyBackfilled',true,
    'asOf',now()
  );
end;
$$;


--
-- Name: get_inhagame_member_ops_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inhagame_member_ops_v1(p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_total integer;
  v_verified integer;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_daily jsonb;
begin
  if not private.world_ops_read_allowed_v1(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with members as (
    select
      u.id,
      u.created_at,
      (u.created_at at time zone 'Asia/Seoul')::date as created_date_kst,
      (
        (u.email_confirmed_at is not null and public.is_inha_mail(u.email))
        or exists (
          select 1 from public.inha_mail_badges b where b.user_id = u.id
        )
      ) as inha_verified
    from auth.users u
    where coalesce(u.is_anonymous,false)=false
  )
  select count(*)::int, count(*) filter (where inha_verified)::int
  into v_total, v_verified
  from members;

  with days as (
    select generate_series(v_today - 13, v_today, interval '1 day')::date as day
  ),
  members as (
    select (u.created_at at time zone 'Asia/Seoul')::date as created_date_kst
    from auth.users u
    where coalesce(u.is_anonymous,false)=false
  ),
  rows as (
    select
      d.day,
      count(m.created_date_kst)::int as new_members,
      (
        select count(*)::int
        from members x
        where x.created_date_kst <= d.day
      ) as cumulative_members
    from days d
    left join members m on m.created_date_kst = d.day
    group by d.day
    order by d.day
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', day,
        'newMembers', new_members,
        'cumulativeMembers', cumulative_members
      )
      order by day
    ),
    '[]'::jsonb
  )
  into v_daily
  from rows;

  return jsonb_build_object(
    'members', v_total,
    'inhaVerified', v_verified,
    'unverified', greatest(v_total - v_verified, 0),
    'verificationRatePct',
      case when v_total > 0 then round((v_verified::numeric / v_total::numeric) * 100, 1) else 0 end,
    'todayNew', (
      select count(*)::int from auth.users u
      where coalesce(u.is_anonymous,false)=false
        and (u.created_at at time zone 'Asia/Seoul')::date = v_today
    ),
    'last7dNew', (
      select count(*)::int from auth.users u
      where coalesce(u.is_anonymous,false)=false
        and (u.created_at at time zone 'Asia/Seoul')::date between v_today - 6 and v_today
    ),
    'last30dNew', (
      select count(*)::int from auth.users u
      where coalesce(u.is_anonymous,false)=false
        and (u.created_at at time zone 'Asia/Seoul')::date between v_today - 29 and v_today
    ),
    'daily14', v_daily,
    'dateKst', v_today,
    'asOf', now()
  );
end;
$$;


--
-- Name: get_leaderboard(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leaderboard(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, user_id uuid, nickname text, department_id bigint, department_name text, title text, best_score integer, best_combo integer, achieved_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    row_number() over (order by l.best_score desc, l.achieved_at asc, l.user_id) as rank,
    l.user_id,
    l.nickname,
    l.department_id,
    l.department_name,
    l.title,
    l.best_score,
    l.best_combo,
    l.achieved_at
  from public.leaderboard_public l
  where p_department_id is null or l.department_id = p_department_id
  order by l.best_score desc, l.achieved_at asc, l.user_id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;


--
-- Name: get_leaderboard_v2(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leaderboard_v2(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, title text, best_score integer, best_combo integer, achieved_at timestamp with time zone, is_me boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with eligible as (
    select
      pb.user_id,
      p.nickname,
      p.department_id,
      d.name as department_name,
      p.title,
      pb.best_score,
      pb.best_combo,
      pb.achieved_at
    from public.player_bests pb
    join public.profiles p
      on p.user_id=pb.user_id
     and p.is_banned=false
    left join public.departments d on d.id=p.department_id
    where pb.stage_key='secret'
      and (p_department_id is null or p.department_id=p_department_id)
  )
  select
    row_number() over (
      order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
    ) as rank,
    e.nickname,e.department_name,e.title,e.best_score,e.best_combo,e.achieved_at,
    coalesce(e.user_id=auth.uid(),false) as is_me
  from eligible e
  order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_leaderboard_v3(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leaderboard_v3(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, best_score integer, best_combo integer, achieved_at timestamp with time zone, is_me boolean, general_badge text, total_stars integer, ranked_grade text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with general as (
    select g.user_id,sum(g.best_score)::integer total_score,sum(g.best_stars)::integer total_stars from public.general_stage_bests g group by g.user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr where rr.stage_key='secret' and rr.run_type='ranked' and rr.validation_status='accepted'
  ), ranked as (
    select distinct on(gr.user_id) gr.user_id,gr.grade ranked_grade from grade_runs gr
    order by gr.user_id,case gr.grade when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5 when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0 end desc
  ), eligible as (
    select pb.user_id,p.nickname,p.department_id,d.name department_name,pb.best_score,pb.best_combo,pb.achieved_at,
      public.general_badge_code(coalesce(g.total_score,0),coalesce(g.total_stars,0)) general_badge,
      coalesce(g.total_stars,0) total_stars,coalesce(r.ranked_grade,'F') ranked_grade
    from public.player_bests pb join public.profiles p on p.user_id=pb.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id left join general g on g.user_id=pb.user_id
    left join ranked r on r.user_id=pb.user_id
    where pb.stage_key='secret' and (p_department_id is null or p.department_id=p_department_id)
  )
  select row_number() over(order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id),
    e.nickname,e.department_name,e.best_score,e.best_combo,e.achieved_at,coalesce(e.user_id=auth.uid(),false),
    e.general_badge,e.total_stars,e.ranked_grade
  from eligible e order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_leaderboard_v4(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leaderboard_v4(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, best_score integer, best_combo integer, achieved_at timestamp with time zone, is_me boolean, general_badge text, total_stars integer, ranked_grade text, inha_mail_verified boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with general as (
    select g.user_id,sum(g.best_score)::integer total_score,sum(g.best_stars)::integer total_stars from public.general_stage_bests g group by g.user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr where rr.stage_key='secret' and rr.run_type='ranked' and rr.validation_status='accepted'
  ), ranked as (
    select distinct on(gr.user_id) gr.user_id,gr.grade ranked_grade from grade_runs gr
    order by gr.user_id,case gr.grade when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5 when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0 end desc
  ), eligible as (
    select pb.user_id,p.nickname,p.department_id,d.name department_name,pb.best_score,pb.best_combo,pb.achieved_at,
      public.general_badge_code(coalesce(g.total_score,0),coalesce(g.total_stars,0)) general_badge,
      coalesce(g.total_stars,0) total_stars,coalesce(r.ranked_grade,'F') ranked_grade
    from public.player_bests pb join public.profiles p on p.user_id=pb.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id left join general g on g.user_id=pb.user_id
    left join ranked r on r.user_id=pb.user_id
    where pb.stage_key='secret' and (p_department_id is null or p.department_id=p_department_id)
  )
  select row_number() over(order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id),
    e.nickname,e.department_name,e.best_score,e.best_combo,e.achieved_at,coalesce(e.user_id=auth.uid(),false),
    e.general_badge,e.total_stars,e.ranked_grade,(exists (
      select 1 from auth.users u
      where u.id=e.user_id and u.is_anonymous=false and u.email_confirmed_at is not null
        and (public.is_inha_mail(u.email) or exists (
          select 1 from public.inha_mail_badges b where b.user_id=u.id
        ))
    ))
  from eligible e order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_leaderboard_v5(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_leaderboard_v5(p_department_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, nickname text, department_name text, best_score integer, best_combo integer, achieved_at timestamp with time zone, is_me boolean, general_badge text, total_stars integer, ranked_grade text, event_badge text, inha_mail_verified boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with general as (
    select g.user_id,
           sum(g.best_score)::integer total_score,
           sum(g.best_stars)::integer total_stars
    from public.general_stage_bests g
    group by g.user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr
    where rr.stage_key='secret'
      and rr.run_type='ranked'
      and rr.validation_status='accepted'
  ), ranked as (
    select distinct on(gr.user_id)
      gr.user_id, gr.grade ranked_grade
    from grade_runs gr
    order by gr.user_id,
      case gr.grade
        when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5
        when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0
      end desc
  ), eligible as (
    select pb.user_id,p.nickname,p.department_id,d.name department_name,
           pb.best_score,pb.best_combo,pb.achieved_at,
           public.general_badge_code(
             coalesce(g.total_score,0),coalesce(g.total_stars,0)) general_badge,
           coalesce(g.total_stars,0) total_stars,
           coalesce(r.ranked_grade,'F') ranked_grade,
           eb.badge_code event_badge
    from public.player_bests pb
    join public.profiles p on p.user_id=pb.user_id and p.is_banned=false
    left join public.departments d on d.id=p.department_id
    left join general g on g.user_id=pb.user_id
    left join ranked r on r.user_id=pb.user_id
    left join public.classic_event_badges eb
      on eb.user_id=pb.user_id and eb.event_key='inha_duck_s1'
    where pb.stage_key='secret'
      and (p_department_id is null or p.department_id=p_department_id)
  )
  select row_number() over(
           order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id),
         e.nickname,e.department_name,e.best_score,e.best_combo,e.achieved_at,
         coalesce(e.user_id=(select auth.uid()),false),
         e.general_badge,e.total_stars,e.ranked_grade,e.event_badge,
         exists (
           select 1
           from auth.users u
           where u.id=e.user_id
             and u.is_anonymous=false
             and u.email_confirmed_at is not null
             and (
               public.is_inha_mail(u.email)
               or exists (
                 select 1 from public.inha_mail_badges b where b.user_id=u.id
               )
             )
         )
  from eligible e
  order by e.best_score desc,e.best_combo desc,e.achieved_at asc,e.user_id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;


--
-- Name: get_my_achievements(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_achievements() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_classic_at timestamptz;
  v_ranked_at timestamptz;
  v_inha_at timestamptz;
  v_event_place smallint;
  v_event_at timestamptz;
  v_event_key text;
  v_event_title text;
  v_event_description text;
  v_achievements jsonb;
begin
  if v_uid is null
     or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, true)
     or not exists (
       select 1 from auth.users u
       where u.id = v_uid and u.is_anonymous = false
     )
     or not exists (
       select 1 from public.profiles p
       where p.user_id = v_uid and p.is_banned = false
     )
  then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  insert into public.user_achievements
    (user_id, achievement_key, earned_at, evidence_source)
  select v_uid, 'classic_recorded_v1', min(recorded_at), 'classic_record'
  from (
    select achieved_at as recorded_at
    from public.general_stage_bests
    where user_id = v_uid
    union all
    select achieved_at as recorded_at
    from public.player_bests
    where user_id = v_uid
  ) records
  having count(*) > 0
  on conflict (user_id, achievement_key) do nothing;

  insert into public.user_achievements
    (user_id, achievement_key, earned_at, evidence_source)
  select v_uid, 'classic_ranked_accepted_v1', min(r.created_at), 'classic_ranked_accepted'
  from public.ranked_runs r
  where r.user_id = v_uid
    and r.run_type = 'ranked'
    and r.validation_status = 'accepted'
  having count(*) > 0
  on conflict (user_id, achievement_key) do nothing;

  insert into public.user_achievements
    (user_id, achievement_key, earned_at, evidence_source)
  select v_uid, 'inha_verified_v1', min(e.earned_at), 'inha_mail_verified'
  from (
    select u.email_confirmed_at as earned_at
    from auth.users u
    where u.id = v_uid
      and u.is_anonymous = false
      and u.email_confirmed_at is not null
      and public.is_inha_mail(u.email)
    union all
    select b.verified_at
    from public.inha_mail_badges b
    where b.user_id = v_uid
  ) e
  having count(*) > 0
  on conflict (user_id, achievement_key) do nothing;

  select a.earned_at into v_classic_at
  from public.user_achievements a
  where a.user_id = v_uid and a.achievement_key = 'classic_recorded_v1';

  select a.earned_at into v_ranked_at
  from public.user_achievements a
  where a.user_id = v_uid and a.achievement_key = 'classic_ranked_accepted_v1';

  select a.earned_at into v_inha_at
  from public.user_achievements a
  where a.user_id = v_uid and a.achievement_key = 'inha_verified_v1';

  select b.placement, a.earned_at,
         format('classic_inha_duck_s1_rank_%s_v1', b.placement)
    into v_event_place, v_event_at, v_event_key
  from public.classic_event_badges b
  join public.user_achievements a
    on a.user_id = b.user_id
   and a.achievement_key = format('classic_inha_duck_s1_rank_%s_v1', b.placement)
  where b.event_key = 'inha_duck_s1'
    and b.user_id = v_uid
    and b.placement between 1 and 10;

  v_achievements := jsonb_build_array(
    jsonb_build_object(
      'key', 'classic_recorded_v1',
      'scope', 'game',
      'gameSlug', 'inha-duck',
      'title', '클래식 입문',
      'description', 'Classic에서 계정 기록을 남겼어요.',
      'requirement', '계정에 Classic 기록을 남기면 획득해요.',
      'evidence', '계정에 연결된 Classic 최고 기록',
      'earned', v_classic_at is not null,
      'earnedAt', v_classic_at
    ),
    jsonb_build_object(
      'key', 'classic_ranked_accepted_v1',
      'scope', 'game',
      'gameSlug', 'inha-duck',
      'title', '랭킹 첫 기록',
      'description', 'Classic 랭킹전 기록이 서버 검사를 통과했어요.',
      'requirement', 'Classic 랭킹전 기록이 서버 검사에서 승인되면 획득해요.',
      'evidence', '서버가 승인한 본인 Classic 랭킹전 기록',
      'earned', v_ranked_at is not null,
      'earnedAt', v_ranked_at
    ),
    jsonb_build_object(
      'key', 'inha_verified_v1',
      'scope', 'platform',
      'gameSlug', null,
      'title', '인하대 인증',
      'description', '인하대 이메일 소유 확인을 완료했어요.',
      'requirement', '인하대 이메일(@inha.edu 또는 @inha.ac.kr) 인증을 완료하면 획득해요.',
      'evidence', '인하대 학교 이메일 소유 확인',
      'earned', v_inha_at is not null,
      'earnedAt', v_inha_at
    )
  );

  if v_event_place is not null then
    v_event_title := case v_event_place
      when 1 then '인하오리 S1 우승'
      when 2 then '인하오리 S1 준우승'
      when 3 then '인하오리 S1 3위'
      else '인하오리 S1 ' || v_event_place::text || '위'
    end;
    v_event_description := '인하오리 S1 이벤트 최종 랭킹 '
      || v_event_place::text || '위를 기록했어요.';

    v_achievements := v_achievements || jsonb_build_array(
      jsonb_build_object(
        'key', v_event_key,
        'scope', 'game',
        'gameSlug', 'inha-duck',
        'title', v_event_title,
        'description', v_event_description,
        'requirement', '종료된 인하오리 S1 이벤트의 최종 TOP 10 기록입니다.',
        'evidence', '인하오리 S1 이벤트 종료 시점 최종 랭킹',
        'earned', true,
        'earnedAt', v_event_at
      )
    );
  end if;

  return jsonb_build_object(
    'earnedCount',
      (v_classic_at is not null)::int
      + (v_ranked_at is not null)::int
      + (v_inha_at is not null)::int
      + (v_event_place is not null)::int,
    'achievements',
    v_achievements
  );
end;
$$;


--
-- Name: get_my_biryong_progress_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_biryong_progress_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_row private.world_biryong_progress_v1%rowtype;
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  select * into v_row
  from private.world_biryong_progress_v1
  where user_id = auth.uid();

  if not found then return null; end if;

  return jsonb_build_object(
    'discoveredAt', case when v_row.discovered_at is null then null
      else floor(extract(epoch from v_row.discovered_at) * 1000)::bigint end,
    'step', v_row.step,
    'lore', to_jsonb(v_row.lore),
    'shouts', v_row.shouts,
    'completedAt', case when v_row.completed_at is null then null
      else floor(extract(epoch from v_row.completed_at) * 1000)::bigint end
  );
end;
$$;


--
-- Name: get_my_game_progress(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_game_progress(p_game_slug text) RETURNS TABLE(progress jsonb, schema_version integer, migrated_from_local boolean, updated_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  return query
  select ugp.progress, ugp.schema_version, ugp.migrated_from_local, ugp.updated_at
  from public.user_game_progress ugp
  join public.games g on g.id = ugp.game_id
  where ugp.user_id = auth.uid()
    and g.slug = p_game_slug;
end;
$$;


--
-- Name: get_my_general_rank(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_general_rank() RETURNS TABLE(total_score integer, overall_rank bigint, department_rank bigint, department_id bigint, stages_recorded integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with scores as (
    select
      g.user_id,
      sum(g.best_score)::integer as total_score,
      max(g.best_combo)::integer as best_combo,
      count(*)::integer as stages_recorded,
      max(g.achieved_at) as achieved_at
    from public.general_stage_bests g
    group by g.user_id
  ),
  me as (
    select s.*,p.department_id
    from scores s
    join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    where s.user_id=auth.uid()
    limit 1
  ),
  overall as (
    select count(*)+1 as r
    from scores s, me
    where s.total_score > me.total_score
       or (s.total_score = me.total_score and s.best_combo > me.best_combo)
       or (s.total_score = me.total_score and s.best_combo = me.best_combo and s.achieved_at < me.achieved_at)
  ),
  dept as (
    select count(*)+1 as r
    from scores s
    join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    cross join me
    where p.department_id is not distinct from me.department_id
      and (
        s.total_score > me.total_score
        or (s.total_score = me.total_score and s.best_combo > me.best_combo)
        or (s.total_score = me.total_score and s.best_combo = me.best_combo and s.achieved_at < me.achieved_at)
      )
  )
  select me.total_score,overall.r,dept.r,me.department_id,me.stages_recorded
  from me,overall,dept;
$$;


--
-- Name: get_my_general_rank_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_general_rank_v2() RETURNS TABLE(total_score integer, overall_rank bigint, department_rank bigint, department_id bigint, stages_recorded integer, total_stars integer, general_badge text, ranked_grade text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with scores as (
    select g.user_id,sum(g.best_score)::integer total_score,sum(g.best_stars)::integer total_stars,max(g.best_combo)::integer best_combo,count(*)::integer stages_recorded,max(g.achieved_at) achieved_at
    from public.general_stage_bests g group by g.user_id
  ), me as (
    select s.*,p.department_id from scores s join public.profiles p on p.user_id=s.user_id and p.is_banned=false where s.user_id=auth.uid() limit 1
  ), overall as (
    select count(*)+1 r from scores s,me where s.total_score>me.total_score or (s.total_score=me.total_score and s.best_combo>me.best_combo) or (s.total_score=me.total_score and s.best_combo=me.best_combo and s.achieved_at<me.achieved_at)
  ), dept as (
    select count(*)+1 r from scores s join public.profiles p on p.user_id=s.user_id and p.is_banned=false cross join me
    where p.department_id is not distinct from me.department_id and (s.total_score>me.total_score or (s.total_score=me.total_score and s.best_combo>me.best_combo) or (s.total_score=me.total_score and s.best_combo=me.best_combo and s.achieved_at<me.achieved_at))
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr where rr.stage_key='secret' and rr.run_type='ranked' and rr.validation_status='accepted'
  ), rg as (
    select distinct on(gr.user_id) gr.user_id,gr.grade ranked_grade from grade_runs gr
    order by gr.user_id,case gr.grade when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5 when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0 end desc
  )
  select me.total_score,overall.r,dept.r,me.department_id,me.stages_recorded,me.total_stars,
    public.general_badge_code(me.total_score,me.total_stars),coalesce(rg.ranked_grade,'F')
  from me cross join overall cross join dept left join rg on rg.user_id=me.user_id;
$$;


--
-- Name: get_my_general_rank_v3(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_general_rank_v3() RETURNS TABLE(total_score integer, overall_rank bigint, department_rank bigint, department_id bigint, stages_recorded integer, total_stars integer, general_badge text, ranked_grade text, event_badge text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with scores as (
    select g.user_id,
           sum(g.best_score)::integer total_score,
           sum(g.best_stars)::integer total_stars,
           max(g.best_combo)::integer best_combo,
           count(*)::integer stages_recorded,
           max(g.achieved_at) achieved_at
    from public.general_stage_bests g
    group by g.user_id
  ), me as (
    select s.*,p.department_id
    from scores s
    join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    where s.user_id=(select auth.uid())
    limit 1
  ), overall as (
    select count(*)+1 r
    from scores s,me
    where s.total_score>me.total_score
       or (s.total_score=me.total_score and s.best_combo>me.best_combo)
       or (s.total_score=me.total_score and s.best_combo=me.best_combo and s.achieved_at<me.achieved_at)
  ), dept as (
    select count(*)+1 r
    from scores s
    join public.profiles p on p.user_id=s.user_id and p.is_banned=false
    cross join me
    where p.department_id is not distinct from me.department_id
      and (
        s.total_score>me.total_score
        or (s.total_score=me.total_score and s.best_combo>me.best_combo)
        or (s.total_score=me.total_score and s.best_combo=me.best_combo and s.achieved_at<me.achieved_at)
      )
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr
    where rr.stage_key='secret'
      and rr.run_type='ranked'
      and rr.validation_status='accepted'
  ), rg as (
    select distinct on(gr.user_id)
      gr.user_id,gr.grade ranked_grade
    from grade_runs gr
    order by gr.user_id,
      case gr.grade
        when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5
        when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0
      end desc
  )
  select me.total_score,overall.r,dept.r,me.department_id,me.stages_recorded,me.total_stars,
         public.general_badge_code(me.total_score,me.total_stars),
         coalesce(rg.ranked_grade,'F'),
         eb.badge_code
  from me
  cross join overall
  cross join dept
  left join rg on rg.user_id=me.user_id
  left join public.classic_event_badges eb
    on eb.user_id=me.user_id and eb.event_key='inha_duck_s1';
$$;


--
-- Name: get_my_grow_rank_visibility(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_grow_rank_visibility(p_department text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select v.is_public from public.grow_rank_visibility v
    where v.user_id=(select auth.uid()) and v.department=p_department),false)
$$;


--
-- Name: get_my_hub_conversations_v1(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_hub_conversations_v1(p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  return coalesce((
    select jsonb_agg(row_data order by updated_at desc, conversation_id)
    from (
      select
        c.id as conversation_id,
        c.updated_at,
        jsonb_build_object(
          'conversationId', c.id,
          'other', coalesce(
            private.hub_message_card(case when c.user_low = v_caller then c.user_high else c.user_low end),
            jsonb_build_object(
              'userId', case when c.user_low = v_caller then c.user_high else c.user_low end,
              'available', false
            )
          ),
          'updatedAt', c.updated_at,
          'unreadCount', (
            select count(*)
            from public.hub_messages hm
            where hm.conversation_id = c.id
              and hm.sender_id <> v_caller
              and hm.deleted_at is null
              and hm.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
          ),
          'blockedByMe', exists (
            select 1 from public.world_user_blocks b
            where b.blocker_id = v_caller
              and b.blocked_id = case when c.user_low = v_caller then c.user_high else c.user_low end
          ),
          'lastMessage', (
            select jsonb_build_object(
              'id', hm.id,
              'senderId', hm.sender_id,
              'body', case when hm.deleted_at is null then hm.body else null end,
              'deleted', hm.deleted_at is not null,
              'createdAt', hm.created_at
            )
            from public.hub_messages hm
            where hm.conversation_id = c.id
            order by hm.created_at desc, hm.id desc
            limit 1
          )
        ) as row_data
      from public.hub_conversation_members m
      join public.hub_conversations c on c.id = m.conversation_id
      where m.user_id = v_caller
        and m.archived_at is null
      order by c.updated_at desc, c.id
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$$;


--
-- Name: get_my_hub_unread_count_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_hub_unread_count_v1() RETURNS bigint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
begin
  return (
    select count(*)
    from public.hub_conversation_members m
    join public.hub_messages hm on hm.conversation_id = m.conversation_id
    where m.user_id = v_caller
      and m.archived_at is null
      and hm.sender_id <> v_caller
      and hm.deleted_at is null
      and hm.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
  );
end;
$$;


--
-- Name: get_my_induckup_rank_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_induckup_rank_v1() RETURNS TABLE(rank bigint, best_wave integer, best_score integer, best_duration_ms integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with rows as (
    select b.*
    from public.induckup_ranked_bests b
    left join public.profiles p on p.user_id=b.user_id
    where coalesce(p.is_banned,false)=false
  ),
  me as (
    select * from rows where user_id=auth.uid() limit 1
  )
  select
    1 + (
      select count(*)
      from rows r, me
      where r.best_wave > me.best_wave
         or (r.best_wave = me.best_wave and r.best_score > me.best_score)
         or (r.best_wave = me.best_wave and r.best_score = me.best_score
             and r.best_duration_ms > me.best_duration_ms)
         or (r.best_wave = me.best_wave and r.best_score = me.best_score
             and r.best_duration_ms = me.best_duration_ms and r.achieved_at < me.achieved_at)
    ) as rank,
    me.best_wave,me.best_score,me.best_duration_ms
  from me;
$$;


--
-- Name: get_my_mcm_2026_event_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_mcm_2026_event_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_mcm_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return private.world_mcm_state_v1(v_uid);
end;
$$;


--
-- Name: get_my_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_profile() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_uid uuid := (select auth.uid());
declare v_result jsonb;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;
  with identity as (
    select p.nickname,p.title,p.avatar_key,p.department_id,p.created_at,
           d.name as department
    from public.profiles p left join public.departments d on d.id=p.department_id
    where p.user_id=v_uid and p.is_banned=false
  ), activity as (
    select g.slug, min(e.created_at) first_at, max(e.created_at) last_at
    from public.game_events e
    join public.games g on g.id=e.game_id
    left join public.players pl on pl.id=e.player_id
    where e.user_id=v_uid or pl.auth_user_id=v_uid
    group by g.slug
  ), classic_records as (
    select max(best_score) score,max(best_combo) combo,min(achieved_at) first_at,
           max(achieved_at) last_at
    from (
      select best_score,best_combo,achieved_at from public.player_bests where user_id=v_uid
      union all
      select best_score,best_combo,achieved_at from public.general_stage_bests where user_id=v_uid
    ) b
  ), up_record as (
    select best_wave,best_score,achieved_at from public.induckup_ranked_bests where user_id=v_uid
  ), progress as (
    select g.slug,ugp.first_synced_at,ugp.updated_at,ugp.progress
    from public.user_game_progress ugp join public.games g on g.id=ugp.game_id
    where ugp.user_id=v_uid
  ), survival as (
    select p.slug,max(s.key::int) filter (where s.value->>'clear'='true') as cleared,
           max((s.value->>'bestKills')::int) filter
             (where s.value->>'bestKills' ~ '^[0-9]{1,8}$') as kills
    from progress p cross join lateral jsonb_each(
      case when jsonb_typeof(p.progress->'stages')='object'
           then p.progress->'stages' else '{}'::jsonb end
    ) s
    where p.slug='inha-duck-survival' and s.key ~ '^[0-9]{1,3}$'
    group by p.slug
  ), records as (
    select g.slug,g.name,g.status,
      coalesce(a.first_at, case when g.slug='inha-duck' then c.first_at
        when g.slug='induckup' then u.achieved_at end,p.first_synced_at) first_at,
      greatest(a.last_at,
        case when g.slug='inha-duck' then c.last_at
             when g.slug='induckup' then u.achieved_at end,p.updated_at) last_at,
      case when g.slug='inha-duck' and c.score is not null then '최고 점수'
           when g.slug='induckup' and u.best_wave is not null then '최고 Wave'
           when g.slug='inha-duck-survival' and s.cleared is not null then '최고 클리어 스테이지'
           when g.slug='inha-duck-survival' and p.slug is not null then '진행 상태'
           when g.slug='induck-grow' and p.slug is not null then '학기 진행' end headline_key,
      case when g.slug='inha-duck' then c.score::text
           when g.slug='induckup' then u.best_wave::text
           when g.slug='inha-duck-survival' then coalesce(s.cleared::text,'진행 중')
           when g.slug='induck-grow' then case
             when p.progress->>'phase'='final' then '한 학기 완료'
             when p.progress->>'week' ~ '^([1-9]|1[0-5])$' then (p.progress->>'week')||'주차'
             else '진행 중' end end headline_value,
      case when g.slug='inha-duck' and c.combo is not null then '최고 콤보'
           when g.slug='induckup' and u.best_score is not null then '최고 점수'
           when g.slug='inha-duck-survival' and s.kills is not null then '최고 처치'
           when g.slug='induck-grow' and p.progress->>'phase'='final'
             and p.progress->>'gpa' ~ '^[0-4](\.[0-9]{1,3})?$' then '학기 GPA' end subline_key,
      case when g.slug='inha-duck' then c.combo::text
           when g.slug='induckup' then u.best_score::text
           when g.slug='inha-duck-survival' then s.kills::text
           when g.slug='induck-grow' and p.progress->>'phase'='final'
             and p.progress->>'gpa' ~ '^[0-4](\.[0-9]{1,3})?$' then p.progress->>'gpa' end subline_value
    from public.games g left join activity a on a.slug=g.slug
    left join progress p on p.slug=g.slug
    left join survival s on s.slug=g.slug
    left join classic_records c on g.slug='inha-duck'
    left join up_record u on g.slug='induckup'
    where g.status in ('production','testing')
  )
  select jsonb_build_object(
    'profile',(select jsonb_build_object('nickname',i.nickname,'departmentId',i.department_id,
      'department',i.department,'title',i.title,'avatar',i.avatar_key,
      'joinedAt',(select u.created_at from auth.users u where u.id=v_uid),'inhaVerified',public.my_inha_mail_badge()) from identity i),
    'stats',jsonb_build_object('playedGames',(select count(*) from records where first_at is not null)),
    'games',coalesce((select jsonb_agg(jsonb_build_object(
      'slug',slug,'name',name,'status',status,'played',first_at is not null,
      'firstPlayedAt',first_at,'lastPlayedAt',last_at,
      'headline',case when headline_key is not null then
        jsonb_build_object('label',headline_key,'value',headline_value) end,
      'subline',case when subline_key is not null then
        jsonb_build_object('label',subline_key,'value',subline_value) end
    ) order by name) from records),'[]'::jsonb)
  ) into v_result;
  if v_result->'profile'='null'::jsonb then
    raise exception 'PROFILE_NOT_FOUND' using errcode='42501';
  end if;
  return v_result;
end;
$_$;


--
-- Name: get_my_rank(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_rank() RETURNS TABLE(best_score integer, overall_rank bigint, department_rank bigint, department_id bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with me as (
    select l.*
    from public.leaderboard_public l
    where l.user_id = (select auth.uid())
    limit 1
  ),
  overall as (
    select count(*) + 1 as r
    from public.leaderboard_public l, me
    where l.best_score > me.best_score
       or (l.best_score = me.best_score and l.achieved_at < me.achieved_at)
  ),
  dept as (
    select count(*) + 1 as r
    from public.leaderboard_public l, me
    where l.department_id is not distinct from me.department_id
      and (
        l.best_score > me.best_score
        or (l.best_score = me.best_score and l.achieved_at < me.achieved_at)
      )
  )
  select me.best_score, overall.r, dept.r, me.department_id
  from me, overall, dept;
$$;


--
-- Name: get_my_rank_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_rank_v2() RETURNS TABLE(best_score integer, overall_rank bigint, department_rank bigint, department_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with all_rows as (
    select
      pb.user_id,p.department_id,pb.best_score,pb.best_combo,pb.achieved_at
    from public.player_bests pb
    join public.profiles p on p.user_id=pb.user_id and p.is_banned=false
    where pb.stage_key='secret'
  ),
  me as (
    select *
    from all_rows
    where user_id=auth.uid()
    limit 1
  ),
  overall as (
    select count(*)+1 as r
    from all_rows a,me
    where a.best_score>me.best_score
       or (a.best_score=me.best_score and a.best_combo>me.best_combo)
       or (a.best_score=me.best_score and a.best_combo=me.best_combo and a.achieved_at<me.achieved_at)
  ),
  dept as (
    select count(*)+1 as r
    from all_rows a,me
    where a.department_id is not distinct from me.department_id
      and (
        a.best_score>me.best_score
        or (a.best_score=me.best_score and a.best_combo>me.best_combo)
        or (a.best_score=me.best_score and a.best_combo=me.best_combo and a.achieved_at<me.achieved_at)
      )
  )
  select me.best_score,overall.r,dept.r,me.department_id
  from me,overall,dept;
$$;


--
-- Name: get_my_rank_v3(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_rank_v3() RETURNS TABLE(best_score integer, overall_rank bigint, department_rank bigint, department_id bigint, ranked_grade text, general_badge text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with all_rows as (
    select pb.user_id,p.department_id,pb.best_score,pb.best_combo,pb.achieved_at
    from public.player_bests pb join public.profiles p on p.user_id=pb.user_id and p.is_banned=false where pb.stage_key='secret'
  ), me as (select * from all_rows where user_id=auth.uid() limit 1),
  overall as (
    select count(*)+1 r from all_rows a,me where a.best_score>me.best_score or (a.best_score=me.best_score and a.best_combo>me.best_combo) or (a.best_score=me.best_score and a.best_combo=me.best_combo and a.achieved_at<me.achieved_at)
  ), dept as (
    select count(*)+1 r from all_rows a,me where a.department_id is not distinct from me.department_id and (a.best_score>me.best_score or (a.best_score=me.best_score and a.best_combo>me.best_combo) or (a.best_score=me.best_score and a.best_combo=me.best_combo and a.achieved_at<me.achieved_at))
  ), gs as (
    select user_id,sum(best_score)::integer total_score,sum(best_stars)::integer total_stars from public.general_stage_bests group by user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(rr.score,coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),coalesce(rr.moon_bonus_hits,0),coalesce(rr.flight_hits,0),coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr where rr.stage_key='secret' and rr.run_type='ranked' and rr.validation_status='accepted'
  ), rg as (
    select distinct on(gr.user_id) gr.user_id,gr.grade ranked_grade from grade_runs gr
    order by gr.user_id,case gr.grade when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5 when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0 end desc
  )
  select me.best_score,overall.r,dept.r,me.department_id,coalesce(rg.ranked_grade,'F'),
    public.general_badge_code(coalesce(gs.total_score,0),coalesce(gs.total_stars,0))
  from me cross join overall cross join dept left join gs on gs.user_id=me.user_id left join rg on rg.user_id=me.user_id;
$$;


--
-- Name: get_my_rank_v4(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_rank_v4() RETURNS TABLE(best_score integer, overall_rank bigint, department_rank bigint, department_id bigint, ranked_grade text, general_badge text, event_badge text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with all_rows as (
    select pb.user_id,p.department_id,pb.best_score,pb.best_combo,pb.achieved_at
    from public.player_bests pb
    join public.profiles p on p.user_id=pb.user_id and p.is_banned=false
    where pb.stage_key='secret'
  ), me as (
    select * from all_rows where user_id=(select auth.uid()) limit 1
  ), overall as (
    select count(*)+1 r
    from all_rows a,me
    where a.best_score>me.best_score
       or (a.best_score=me.best_score and a.best_combo>me.best_combo)
       or (a.best_score=me.best_score and a.best_combo=me.best_combo and a.achieved_at<me.achieved_at)
  ), dept as (
    select count(*)+1 r
    from all_rows a,me
    where a.department_id is not distinct from me.department_id
      and (
        a.best_score>me.best_score
        or (a.best_score=me.best_score and a.best_combo>me.best_combo)
        or (a.best_score=me.best_score and a.best_combo=me.best_combo and a.achieved_at<me.achieved_at)
      )
  ), gs as (
    select user_id,
           sum(best_score)::integer total_score,
           sum(best_stars)::integer total_stars
    from public.general_stage_bests
    group by user_id
  ), grade_runs as (
    select rr.user_id,
      case when rr.ruleset_version='secret-2.2-r1'
        then public.ranked_grade_code_v5(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
        else public.ranked_grade_code(
          rr.score,
          coalesce(rr.gold_hits,0)+coalesce(rr.indeoki_hits,0),
          coalesce(rr.moon_bonus_hits,0),
          coalesce(rr.flight_hits,0),
          coalesce(rr.completed_calls,0))
      end grade
    from public.ranked_runs rr
    where rr.stage_key='secret'
      and rr.run_type='ranked'
      and rr.validation_status='accepted'
  ), rg as (
    select distinct on(gr.user_id)
      gr.user_id,gr.grade ranked_grade
    from grade_runs gr
    order by gr.user_id,
      case gr.grade
        when 'A+' then 8 when 'A0' then 7 when 'B+' then 6 when 'B0' then 5
        when 'C+' then 4 when 'C0' then 3 when 'D+' then 2 when 'D0' then 1 else 0
      end desc
  )
  select me.best_score,overall.r,dept.r,me.department_id,
         coalesce(rg.ranked_grade,'F'),
         public.general_badge_code(coalesce(gs.total_score,0),coalesce(gs.total_stars,0)),
         eb.badge_code
  from me
  cross join overall
  cross join dept
  left join gs on gs.user_id=me.user_id
  left join rg on rg.user_id=me.user_id
  left join public.classic_event_badges eb
    on eb.user_id=me.user_id and eb.event_key='inha_duck_s1';
$$;


--
-- Name: get_my_world_accompany(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_accompany() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  perform private.world_accompany_expire(v_caller);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'inviterId', s.inviter_id, 'inviteeId', s.invitee_id,
      'peer', private.world_card(case when s.inviter_id = v_caller then s.invitee_id else s.inviter_id end),
      'placeZoneId', s.place_zone_id, 'poiId', s.poi_id, 'state', s.state,
      'createdAt', s.created_at, 'expiresAt', s.expires_at, 'acceptedAt', s.accepted_at
    ) order by s.created_at desc)
    from public.world_accompany_sessions s
    where (s.inviter_id = v_caller or s.invitee_id = v_caller)
      and s.state in ('offered', 'active') and s.expires_at > now()
  ), '[]'::jsonb);
end;
$$;


--
-- Name: get_my_world_admin_access_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_admin_access_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_permissions jsonb;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id=v_uid and p.is_banned=false
  ) then
    return jsonb_build_object('isAdmin',false,'role',null,'permissions','[]'::jsonb);
  end if;

  select a.role
  into v_role
  from private.world_staff_assignments a
  where a.user_id=v_uid and a.active=true;

  if v_role is null then
    return jsonb_build_object('isAdmin',false,'role',null,'permissions','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(rp.permission order by rp.permission),'[]'::jsonb)
  into v_permissions
  from private.world_staff_role_permissions rp
  where rp.role=v_role;

  return jsonb_build_object(
    'isAdmin', v_role='world_admin',
    'role', v_role,
    'permissions', v_permissions
  );
end;
$$;


--
-- Name: FUNCTION get_my_world_admin_access_v1(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_world_admin_access_v1() IS 'Returns the caller own World staff role and capabilities; never grants authority by itself.';


--
-- Name: get_my_world_appearance_loadout_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_appearance_loadout_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_appearance_caller_v1();
begin
  -- Read-only: never creates a loadout row. No rows = every slot empty.
  return private.world_appearance_loadout_json_v1(v_uid);
end;
$$;


--
-- Name: get_my_world_attendance_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_attendance_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_attendance_caller_v1();
begin
  return private.world_attendance_state_v1(v_uid, private.world_attendance_today_v1());
end;
$$;


--
-- Name: get_my_world_daily_quiz_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_daily_quiz_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_daily_quiz_caller_v1();
begin
  return private.world_daily_quiz_state_v1(v_uid, private.world_daily_quiz_today_v1());
end;
$$;


--
-- Name: get_my_world_inventory_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_inventory_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_inventory_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.world_inventory_item_json_v1(i, c.status, false)
                     order by i.acquired_at desc, i.item_id)
      from private.world_player_items i
      left join private.world_item_catalog c on c.item_id = i.item_id
     where i.user_id = v_uid
  ), '[]'::jsonb));
end;
$$;


--
-- Name: get_my_world_moderation_admin_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_moderation_admin_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid;
  v_reports jsonb;
begin
  v_actor := private.world_admin_caller_v1('moderation.read');

  with rows as (
    select
      r.id,
      r.reporter_id,
      r.target_id,
      r.category,
      r.place_zone_id,
      r.created_at,
      r.status,
      r.reviewed_at,
      r.resolution,
      rp.nickname as reporter_nickname,
      tp.nickname as target_nickname,
      tp.avatar_key as target_avatar,
      tp.title as target_title,
      (
        select max(a.ends_at)
        from private.world_user_moderation_actions a
        where a.target_id=r.target_id
          and a.action='interaction_restriction_24h'
          and a.ends_at>now()
      ) as restriction_until,
      (
        select count(*)::integer
        from public.world_user_reports x
        where x.target_id=r.target_id
          and x.created_at>now()-interval '30 days'
      ) as target_reports_30d,
      (
        select count(*)::integer
        from private.world_user_moderation_actions a
        where a.target_id=r.target_id
          and a.action='warning'
      ) as warning_count
    from public.world_user_reports r
    left join public.profiles rp on rp.user_id=r.reporter_id
    left join public.profiles tp on tp.user_id=r.target_id
    order by
      case r.status when 'pending' then 0 when 'reviewing' then 1 when 'resolved' then 2 else 3 end,
      r.created_at desc,
      r.id desc
    limit 200
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'reporterId',reporter_id,
        'reporterNickname',reporter_nickname,
        'targetId',target_id,
        'targetNickname',target_nickname,
        'targetAvatar',target_avatar,
        'targetTitle',target_title,
        'category',category,
        'placeZoneId',place_zone_id,
        'createdAt',created_at,
        'status',status,
        'reviewedAt',reviewed_at,
        'resolution',resolution,
        'restrictionUntil',restriction_until,
        'targetReports30d',target_reports_30d,
        'warningCount',warning_count
      )
      order by
        case status when 'pending' then 0 when 'reviewing' then 1 when 'resolved' then 2 else 3 end,
        created_at desc,
        id desc
    ),
    '[]'::jsonb
  )
  into v_reports
  from rows;

  return jsonb_build_object(
    'generatedAt',now(),
    'actorId',v_actor,
    'counts',jsonb_build_object(
      'pending',(select count(*) from public.world_user_reports where status='pending'),
      'reviewing',(select count(*) from public.world_user_reports where status='reviewing'),
      'resolved',(select count(*) from public.world_user_reports where status='resolved'),
      'dismissed',(select count(*) from public.world_user_reports where status='dismissed'),
      'total',(select count(*) from public.world_user_reports)
    ),
    'reports',v_reports
  );
end;
$$;


--
-- Name: FUNCTION get_my_world_moderation_admin_v1(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_world_moderation_admin_v1() IS 'Account-authenticated moderation queue for staff with moderation.read.';


--
-- Name: get_my_world_progression_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_progression_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_progression_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return private.world_progression_snapshot_v1(v_uid) - 'userId';
end;
$$;


--
-- Name: get_my_world_social(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_social() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(private.world_card(o.other) order by p.nickname)
      from (select case when f.user_low = v_caller then f.user_high else f.user_low end other
            from public.world_friendships f
            where (f.user_low = v_caller or f.user_high = v_caller) and f.status = 'accepted') o
      join public.profiles p on p.user_id = o.other and p.is_banned = false), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(private.world_card(f.requested_by) order by f.created_at desc)
      from public.world_friendships f join public.profiles p on p.user_id = f.requested_by and p.is_banned = false
      where (f.user_low = v_caller or f.user_high = v_caller) and f.status = 'pending' and f.requested_by <> v_caller), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(private.world_card(case when f.user_low = v_caller then f.user_high else f.user_low end) order by f.created_at desc)
      from public.world_friendships f
      join public.profiles p on p.user_id = (case when f.user_low = v_caller then f.user_high else f.user_low end) and p.is_banned = false
      where (f.user_low = v_caller or f.user_high = v_caller) and f.status = 'pending' and f.requested_by = v_caller), '[]'::jsonb),
    -- Only people the caller blocked; who blocked the caller is never listed.
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('userId', p.user_id, 'nickname', p.nickname, 'title', p.title, 'avatar', p.avatar_key) order by b.created_at desc)
      from public.world_user_blocks b join public.profiles p on p.user_id = b.blocked_id
      where b.blocker_id = v_caller), '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_my_world_wallet_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_world_wallet_v1() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_wallet_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return jsonb_build_object('currencies', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.currency_id, 'balance', coalesce(w.balance, 0))
                     order by c.currency_id)
      from private.world_currencies c
      left join private.world_wallets w
        on w.currency_id = c.currency_id and w.user_id = v_uid
  ), '[]'::jsonb));
end;
$$;


--
-- Name: get_or_create_my_personal_room_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_my_personal_room_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_room_caller_v1();
  v_room public.world_player_rooms%rowtype;
begin
  -- Serialize first-entry provisioning across tabs/retries before the unique constraint fallback.
  perform pg_advisory_xact_lock(hashtextextended('world_personal_room:' || v_uid::text, 0));

  insert into public.world_player_rooms (owner_user_id, room_type, visibility)
  values (v_uid, 'DORM_1_BASIC', 'friends')
  on conflict (owner_user_id) do nothing;

  select *
    into strict v_room
    from public.world_player_rooms r
   where r.owner_user_id = v_uid;

  return jsonb_build_object(
    'roomId', v_room.id,
    'ownerUserId', v_room.owner_user_id,
    'roomType', v_room.room_type,
    'visibility', v_room.visibility,
    'createdAt', v_room.created_at,
    'updatedAt', v_room.updated_at
  );
end;
$$;


--
-- Name: get_world_guestbook_v1(text, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_guestbook_v1(p_location_key text DEFAULT 'main_gate'::text, p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
  v_board jsonb;
  v_mine jsonb;
begin
  v_board := public.get_world_guestbook_v2(p_location_key, p_limit, p_before);

  select private.world_guestbook_entry_json(g.id, v_uid)
  into v_mine
  from public.world_guestbook_entries g
  where g.user_id = v_uid
    and g.location_key = p_location_key
    and g.is_hidden = false
  order by g.created_at desc, g.id desc
  limit 1;

  return v_board || jsonb_build_object('myEntry', v_mine);
end;
$$;


--
-- Name: get_world_guestbook_v2(text, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_guestbook_v2(p_location_key text DEFAULT 'main_gate'::text, p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_has_more boolean;
  v_next_before timestamptz;
  v_entries jsonb;
  v_daily_used integer := 0;
  v_cooldown integer := 0;
begin
  if p_location_key <> 'main_gate' then
    raise exception 'INVALID_LOCATION' using errcode = '22023';
  end if;

  with selected as (
    select g.id, g.created_at
    from public.world_guestbook_entries g
    join public.profiles p on p.user_id = g.user_id and p.is_banned = false
    join auth.users u on u.id = g.user_id and u.is_anonymous = false
    where g.location_key = p_location_key
      and g.is_hidden = false
      and (p_before is null or g.created_at < p_before)
    order by g.created_at desc, g.id desc
    limit v_limit + 1
  ),
  page as (
    select * from selected
    order by created_at desc, id desc
    limit v_limit
  )
  select
    coalesce(
      jsonb_agg(
        private.world_guestbook_entry_json(id, v_uid)
        order by created_at desc, id desc
      ),
      '[]'::jsonb
    ),
    (select count(*) > v_limit from selected),
    min(created_at)
  into v_entries, v_has_more, v_next_before
  from page;

  select count(*)::integer
  into v_daily_used
  from private.world_guestbook_post_log l
  where l.user_id = v_uid
    and l.location_key = p_location_key
    and (l.created_at at time zone 'Asia/Seoul')::date =
        (now() at time zone 'Asia/Seoul')::date;

  select coalesce(
    greatest(
      0,
      ceil(extract(epoch from (max(l.created_at) + interval '60 seconds' - now())))::integer
    ),
    0
  )
  into v_cooldown
  from private.world_guestbook_post_log l
  where l.user_id = v_uid
    and l.location_key = p_location_key;

  return jsonb_build_object(
    'locationKey', p_location_key,
    'entries', v_entries,
    'hasMore', coalesce(v_has_more, false),
    'nextBefore', case when coalesce(v_has_more, false) then v_next_before else null end,
    'dailyLimit', 3,
    'dailyUsed', v_daily_used,
    'dailyRemaining', greatest(0, 3 - v_daily_used),
    'cooldownRemainingSeconds', v_cooldown
  );
end;
$$;


--
-- Name: get_world_moderation_ops_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_moderation_ops_v1(p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_reports jsonb;
begin
  if not private.inha_duck_ops_credential_valid_v1(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with rows as (
    select
      r.id,
      r.reporter_id,
      r.target_id,
      r.category,
      r.place_zone_id,
      r.created_at,
      r.status,
      r.reviewed_at,
      r.resolution,
      rp.nickname as reporter_nickname,
      tp.nickname as target_nickname,
      tp.avatar_key as target_avatar,
      tp.title as target_title,
      (
        select max(a.ends_at)
        from private.world_user_moderation_actions a
        where a.target_id = r.target_id
          and a.action = 'interaction_restriction_24h'
          and a.ends_at > now()
      ) as restriction_until,
      (
        select count(*)::integer
        from public.world_user_reports x
        where x.target_id = r.target_id
          and x.created_at > now() - interval '30 days'
      ) as target_reports_30d,
      (
        select count(*)::integer
        from private.world_user_moderation_actions a
        where a.target_id = r.target_id
          and a.action = 'warning'
      ) as warning_count
    from public.world_user_reports r
    left join public.profiles rp on rp.user_id = r.reporter_id
    left join public.profiles tp on tp.user_id = r.target_id
    order by
      case r.status when 'pending' then 0 when 'reviewing' then 1 when 'resolved' then 2 else 3 end,
      r.created_at desc,
      r.id desc
    limit 200
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'reporterId', reporter_id,
        'reporterNickname', reporter_nickname,
        'targetId', target_id,
        'targetNickname', target_nickname,
        'targetAvatar', target_avatar,
        'targetTitle', target_title,
        'category', category,
        'placeZoneId', place_zone_id,
        'createdAt', created_at,
        'status', status,
        'reviewedAt', reviewed_at,
        'resolution', resolution,
        'restrictionUntil', restriction_until,
        'targetReports30d', target_reports_30d,
        'warningCount', warning_count
      )
      order by
        case status when 'pending' then 0 when 'reviewing' then 1 when 'resolved' then 2 else 3 end,
        created_at desc,
        id desc
    ),
    '[]'::jsonb
  )
  into v_reports
  from rows;

  return jsonb_build_object(
    'generatedAt', now(),
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.world_user_reports where status='pending'),
      'reviewing', (select count(*) from public.world_user_reports where status='reviewing'),
      'resolved', (select count(*) from public.world_user_reports where status='resolved'),
      'dismissed', (select count(*) from public.world_user_reports where status='dismissed'),
      'total', (select count(*) from public.world_user_reports)
    ),
    'reports', v_reports
  );
end;
$$;


--
-- Name: get_world_npc_shared_state_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_npc_shared_state_v1() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'version', 1,
    'period', s.period,
    'tick', s.tick,
    'effective_at_ms', s.effective_at_ms,
    'tick_ms', s.tick_ms,
    'decisions', s.decisions
  )
  from private.world_npc_shared_ticks_v1 s
  where s.status = 'committed'
  order by s.tick desc
  limit 1
$$;


--
-- Name: get_world_online_count_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_online_count_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with active as (
    select *
    from public.world_online_sessions
    where last_seen_at >= now() - interval '70 seconds'
  )
  select jsonb_build_object(
    'online', count(*)::int,
    'signedIn', count(user_id)::int,
    'guests', (count(*) - count(user_id))::int,
    'lobby', count(*) filter (where space='lobby')::int,
    'campus', count(*) filter (where space='campus')::int,
    'clubRoom', count(*) filter (where space='club_room')::int,
    'housingLobby', count(*) filter (where space='housing_lobby')::int,
    'personalRoom', count(*) filter (where space='personal_room')::int,
    'asOf', now()
  )
  from active
$$;


--
-- Name: get_world_online_ops_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_online_ops_v1(p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_today_start timestamptz := (v_today::timestamp at time zone 'Asia/Seoul');
  v_tomorrow_start timestamptz := ((v_today + 1)::timestamp at time zone 'Asia/Seoul');
begin
  if not private.world_ops_read_allowed_v1(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with active as (
    select session_id, user_id, visitor_id, place_zone_id, space, started_at, last_seen_at
    from public.world_online_sessions
    where last_seen_at >= now() - interval '70 seconds'
  ),
  today_sessions as (
    select session_id, user_id, visitor_id, started_at, last_seen_at
    from public.world_online_sessions
    where started_at >= v_today_start and started_at < v_tomorrow_start
  ),
  today_seen as (
    select session_id, user_id, visitor_id, started_at, last_seen_at
    from public.world_online_sessions
    where last_seen_at >= v_today_start and last_seen_at < v_tomorrow_start
  ),
  zone_counts as (
    select place_zone_id as zone, count(*)::int as online, count(user_id)::int as signed_in,
      (count(*) - count(user_id))::int as guests
    from active where place_zone_id is not null group by place_zone_id
  )
  select jsonb_build_object(
    'online', (select count(*)::int from active),
    'signedIn', (select count(user_id)::int from active),
    'guests', (select (count(*) - count(user_id))::int from active),
    'lobby', (select count(*) filter (where space='lobby')::int from active),
    'campus', (select count(*) filter (where space='campus')::int from active),
    'clubRoom', (select count(*) filter (where space='club_room')::int from active),
    'housingLobby', (select count(*) filter (where space='housing_lobby')::int from active),
    'personalRoom', (select count(*) filter (where space='personal_room')::int from active),
    'unknownZone', (select count(*) filter (where place_zone_id is null)::int from active),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone',z.zone,'online',z.online,'signedIn',z.signed_in,'guests',z.guests
      ) order by z.online desc,z.zone) from zone_counts z
    ),'[]'::jsonb),
    'today', jsonb_build_object(
      'dateKst',v_today,
      'sessionStarts',(select count(*)::int from today_sessions),
      'signedInSessions',(select count(*) filter (where user_id is not null)::int from today_sessions),
      'signedInUsers',(select count(distinct user_id)::int from today_seen where user_id is not null),
      'guestSessions',(select count(*) filter (where user_id is null)::int from today_sessions),
      'uniqueVisitors',(select count(distinct visitor_id)::int from today_seen where visitor_id is not null),
      'visitorTrackedSessions',(select count(*) filter (where visitor_id is not null)::int from today_seen),
      'observedSessions',(select count(*)::int from today_seen),
      'visitorCoveragePct',(
        select case when count(*)>0
          then round(count(*) filter (where visitor_id is not null)::numeric/count(*)::numeric*100,1)
          else 0 end from today_seen
      ),
      'uniqueVisitorsSupported',true
    ),
    'activeWindowSeconds',70,
    'asOf',now()
  ) into v_result;

  return v_result;
end;
$$;


--
-- Name: FUNCTION get_world_online_ops_v1(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_world_online_ops_v1(p_token text) IS 'Protected INHA WORLD OPS aggregate. Live counts are browser sessions; today.uniqueVisitors counts distinct tracked browser visitor UUIDs seen during the KST day. visitorCoveragePct reports adoption/coverage.';


--
-- Name: get_world_public_profile(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_public_profile(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
declare v_state text;
begin
  perform private.world_social_target(v_caller, p_target);
  v_state := private.world_relationship(v_caller, p_target);
  if v_state = 'unavailable' then
    return jsonb_build_object('userId', p_target, 'available', false, 'relationship', 'unavailable');
  end if;
  return private.world_card(p_target) || jsonb_build_object('available', true, 'relationship', v_state);
end;
$$;


--
-- Name: get_world_relationship(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_relationship(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  perform private.world_social_target(v_caller, p_target);
  return jsonb_build_object('userId', p_target, 'relationship', private.world_relationship(v_caller, p_target));
end;
$$;


--
-- Name: get_world_shop_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_world_shop_v1(p_shop_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_shop private.world_shops%rowtype;
  v_level integer;
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  select * into v_shop from private.world_shops s where s.shop_id = p_shop_id;
  if not found or v_shop.status = 'HIDDEN' then
    raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_level := private.world_player_level_v1(v_uid);
  return jsonb_build_object(
    'shopId', v_shop.shop_id,
    'displayName', v_shop.display_name,
    'status', v_shop.status,
    'playerLevel', v_level,
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'listingId', l.listing_id,
        'itemId', l.item_id,
        'currencyId', l.currency_id,
        'price', l.price,
        'quantity', l.quantity,
        'requiredLevel', l.required_level,
        'purchaseLimit', l.purchase_limit,
        'startAt', l.start_at,
        'endAt', l.end_at,
        'status', l.status,
        'purchasable', v_shop.status = 'ACTIVE' and b.reason is null,
        'unavailableReason', case when v_shop.status <> 'ACTIVE' then 'SHOP_INACTIVE' else b.reason end)
        order by l.position)
        from private.world_shop_listings l
        cross join lateral (select private.world_shop_listing_block_v2(l, now(), v_level) as reason) b
       where l.shop_id = v_shop.shop_id and l.status in ('ACTIVE', 'LOCKED')), '[]'::jsonb));
end;
$$;


--
-- Name: induckup_merge_meta_v1(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.induckup_merge_meta_v1(old_meta jsonb, new_meta jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select (case when jsonb_typeof(new_meta) = 'object' then new_meta else '{}'::jsonb end)
    || jsonb_build_object(
      'version', 1,
      'selectedEquipmentId', case
        when coalesce(old_meta->>'equipmentChangedAt', '') > coalesce(new_meta->>'equipmentChangedAt', '')
          then old_meta->'selectedEquipmentId' else new_meta->'selectedEquipmentId' end,
      'equipmentChangedAt', case
        when coalesce(old_meta->>'equipmentChangedAt', '') > coalesce(new_meta->>'equipmentChangedAt', '')
          then old_meta->'equipmentChangedAt' else new_meta->'equipmentChangedAt' end,
      'selectedCosmeticId', case
        when coalesce(old_meta->>'cosmeticChangedAt', '') > coalesce(new_meta->>'cosmeticChangedAt', '')
          then old_meta->'selectedCosmeticId' else new_meta->'selectedCosmeticId' end,
      'cosmeticChangedAt', case
        when coalesce(old_meta->>'cosmeticChangedAt', '') > coalesce(new_meta->>'cosmeticChangedAt', '')
          then old_meta->'cosmeticChangedAt' else new_meta->'cosmeticChangedAt' end
    );
$$;


--
-- Name: is_inha_mail(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_inha_mail(p_email text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$select lower(coalesce(p_email,'')) ~ '^[^@[:space:]]+@(inha[.]edu|inha[.]ac[.]kr)$'$_$;


--
-- Name: is_permanent_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_permanent_account() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'auth'
    AS $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, true) = false;
$$;


--
-- Name: log_general_progression_event_v1(text, smallint, smallint, uuid, boolean, uuid, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_progression_event_v1(p_event_type text, p_stage_id smallint, p_target_stage_id smallint, p_run_id uuid, p_clear boolean, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_event_type not in (
    'stage_result_view',
    'next_stage_cta_view',
    'next_stage_cta_click',
    'stage_select_return'
  ) then
    raise exception 'INVALID_PROGRESSION_EVENT';
  end if;

  if p_stage_id is null or p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'INVALID_STAGE_ID';
  end if;

  if p_target_stage_id is not null
     and (p_target_stage_id < 1 or p_target_stage_id > 4) then
    raise exception 'INVALID_TARGET_STAGE_ID';
  end if;

  insert into public.game_events(
    user_id,
    event_type,
    run_id,
    stage_id,
    status,
    metadata
  )
  values(
    auth.uid(),
    p_event_type,
    p_run_id,
    p_stage_id,
    case
      when p_event_type='stage_result_view'
        then case when p_clear then 'clear' else 'failed' end
      when p_event_type='next_stage_cta_view' then 'visible'
      when p_event_type='next_stage_cta_click' then 'clicked'
      when p_event_type='stage_select_return' then 'returned'
    end,
    jsonb_strip_nulls(
      jsonb_build_object(
        'visitor_id',p_visitor_id,
        'session_id',p_session_id,
        'target_stage_id',p_target_stage_id,
        'clear',p_clear,
        'client_version',p_client_version,
        'balance_version',p_balance_version,
        'run_type',p_run_type,
        'source',p_source,
        'device',p_device
      )
    )
  );
end;
$$;


--
-- Name: log_general_session_start(uuid, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_session_start(p_visitor_id uuid, p_session_id uuid, p_client_version text DEFAULT NULL::text, p_balance_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.game_events(user_id,event_type,status,metadata)
  values (
    auth.uid(),'session_start','started',
    jsonb_strip_nulls(jsonb_build_object(
      'visitor_id',p_visitor_id,
      'session_id',p_session_id,
      'client_version',p_client_version,
      'balance_version',p_balance_version,
      'run_type',p_run_type,
      'source',p_source,
      'device',p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_attempt(smallint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_attempt(p_stage_id smallint, p_client_version text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;

  insert into public.game_events (
    user_id,
    event_type,
    stage_id,
    metadata
  )
  values (
    v_user_id,
    'stage_attempt',
    p_stage_id,
    jsonb_strip_nulls(jsonb_build_object(
      'client_version', p_client_version
    ))
  );
end;
$$;


--
-- Name: FUNCTION log_general_stage_attempt(p_stage_id smallint, p_client_version text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.log_general_stage_attempt(p_stage_id smallint, p_client_version text) IS 'Log one general-stage attempt when active play begins. Telemetry only; no gameplay/state mutation.';


--
-- Name: log_general_stage_attempt_v2(smallint, uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_attempt_v2(p_stage_id smallint, p_run_id uuid, p_client_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;

  insert into public.game_events (
    user_id,event_type,stage_id,run_id,status,metadata
  )
  values (
    v_user_id,'stage_attempt',p_stage_id,p_run_id,'started',
    jsonb_strip_nulls(jsonb_build_object(
      'client_version', p_client_version,
      'run_type', p_run_type,
      'source', p_source,
      'device', p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_attempt_v3(smallint, uuid, uuid, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_attempt_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_client_version text DEFAULT NULL::text, p_balance_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;
  insert into public.game_events(user_id,event_type,stage_id,run_id,status,metadata)
  values (
    auth.uid(),'stage_attempt',p_stage_id,p_run_id,'started',
    jsonb_strip_nulls(jsonb_build_object(
      'visitor_id',p_visitor_id,
      'session_id',p_session_id,
      'client_version',p_client_version,
      'balance_version',p_balance_version,
      'run_type',p_run_type,
      'source',p_source,
      'device',p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_best_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_best_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE'
     and new.best_score is not distinct from old.best_score
     and new.best_combo is not distinct from old.best_combo
     and new.best_stars is not distinct from old.best_stars then
    return new;
  end if;

  insert into public.game_events(user_id,event_type,stage_id,score,combo,stars,metadata)
  values (
    new.user_id,
    case when tg_op='INSERT' then 'stage_best_created' else 'stage_best_updated' end,
    new.stage_id,new.best_score,new.best_combo,new.best_stars,
    jsonb_build_object(
      'previous_score', case when tg_op='UPDATE' then old.best_score else null end,
      'previous_combo', case when tg_op='UPDATE' then old.best_combo else null end,
      'previous_stars', case when tg_op='UPDATE' then old.best_stars else null end
    )
  );

  return new;
end $$;


--
-- Name: FUNCTION log_general_stage_best_event(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.log_general_stage_best_event() IS 'Logs stage best creation and only material best-value changes; no-op updates are ignored.';


--
-- Name: log_general_stage_exit(smallint, uuid, integer, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_exit(p_stage_id smallint, p_run_id uuid, p_duration_ms integer DEFAULT NULL::integer, p_exit_state text DEFAULT NULL::text, p_client_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;

  insert into public.game_events (
    user_id,event_type,stage_id,run_id,status,metadata
  )
  values (
    v_user_id,'exit_run',p_stage_id,p_run_id,'exit',
    jsonb_strip_nulls(jsonb_build_object(
      'duration_ms', greatest(0,coalesce(p_duration_ms,0)),
      'exit_state', p_exit_state,
      'client_version', p_client_version,
      'run_type', p_run_type,
      'source', p_source,
      'device', p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_exit_v2(smallint, uuid, integer, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_exit_v2(p_stage_id smallint, p_run_id uuid, p_duration_ms integer DEFAULT NULL::integer, p_exit_state text DEFAULT NULL::text, p_exit_reason text DEFAULT 'in_game'::text, p_client_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;

  insert into public.game_events (
    user_id,event_type,stage_id,run_id,status,metadata
  )
  values (
    v_user_id,'exit_run',p_stage_id,p_run_id,'exit',
    jsonb_strip_nulls(jsonb_build_object(
      'duration_ms', greatest(0,coalesce(p_duration_ms,0)),
      'exit_state', p_exit_state,
      'exit_reason', p_exit_reason,
      'client_version', p_client_version,
      'run_type', p_run_type,
      'source', p_source,
      'device', p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_exit_v3(smallint, uuid, uuid, uuid, integer, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_exit_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_duration_ms integer DEFAULT NULL::integer, p_exit_state text DEFAULT NULL::text, p_exit_reason text DEFAULT 'in_game'::text, p_client_version text DEFAULT NULL::text, p_balance_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;
  insert into public.game_events(user_id,event_type,stage_id,run_id,status,metadata)
  values (
    auth.uid(),'exit_run',p_stage_id,p_run_id,'exit',
    jsonb_strip_nulls(jsonb_build_object(
      'visitor_id',p_visitor_id,
      'session_id',p_session_id,
      'duration_ms',greatest(0,coalesce(p_duration_ms,0)),
      'exit_state',p_exit_state,
      'exit_reason',p_exit_reason,
      'client_version',p_client_version,
      'balance_version',p_balance_version,
      'run_type',p_run_type,
      'source',p_source,
      'device',p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_result(smallint, integer, integer, smallint, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;

  insert into public.game_events (
    user_id,
    event_type,
    stage_id,
    score,
    combo,
    stars,
    status,
    metadata
  )
  values (
    v_user_id,
    'stage_result',
    p_stage_id,
    greatest(0, coalesce(p_score,0)),
    greatest(0, coalesce(p_combo,0)),
    greatest(0, least(3, coalesce(p_stars,0))),
    case when p_clear then 'clear' else 'failed' end,
    jsonb_strip_nulls(jsonb_build_object(
      'client_version', p_client_version
    ))
  );
end;
$$;


--
-- Name: FUNCTION log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text) IS 'Log one completed general-stage result. Telemetry only; no gameplay/state mutation.';


--
-- Name: log_general_stage_result_v2(smallint, uuid, integer, integer, smallint, boolean, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_result_v2(p_stage_id smallint, p_run_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer DEFAULT NULL::integer, p_client_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;

  insert into public.game_events (
    user_id,event_type,stage_id,run_id,score,combo,stars,status,metadata
  )
  values (
    v_user_id,'stage_result',p_stage_id,p_run_id,
    greatest(0,coalesce(p_score,0)),
    greatest(0,coalesce(p_combo,0)),
    greatest(0,least(3,coalesce(p_stars,0))),
    case when p_clear then 'clear' else 'failed' end,
    jsonb_strip_nulls(jsonb_build_object(
      'duration_ms', greatest(0,coalesce(p_duration_ms,0)),
      'client_version', p_client_version,
      'run_type', p_run_type,
      'source', p_source,
      'device', p_device
    ))
  );
end;
$$;


--
-- Name: log_general_stage_result_v3(smallint, uuid, uuid, uuid, integer, integer, smallint, boolean, integer, integer, integer, integer, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_stage_result_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer DEFAULT NULL::integer, p_annyongi_clicks integer DEFAULT 0, p_indeok_hits integer DEFAULT 0, p_gold_hits integer DEFAULT 0, p_client_version text DEFAULT NULL::text, p_balance_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_stage_id < 1 or p_stage_id > 4 then
    raise exception 'invalid stage_id';
  end if;
  insert into public.game_events(user_id,event_type,stage_id,run_id,score,combo,stars,status,metadata)
  values (
    auth.uid(),'stage_result',p_stage_id,p_run_id,
    greatest(0,coalesce(p_score,0)),
    greatest(0,coalesce(p_combo,0)),
    greatest(0,least(3,coalesce(p_stars,0))),
    case when p_clear then 'clear' else 'failed' end,
    jsonb_strip_nulls(jsonb_build_object(
      'visitor_id',p_visitor_id,
      'session_id',p_session_id,
      'duration_ms',greatest(0,coalesce(p_duration_ms,0)),
      'annyongi_clicks',greatest(0,coalesce(p_annyongi_clicks,0)),
      'indeok_hits',greatest(0,coalesce(p_indeok_hits,0)),
      'gold_hits',greatest(0,coalesce(p_gold_hits,0)),
      'client_version',p_client_version,
      'balance_version',p_balance_version,
      'run_type',p_run_type,
      'source',p_source,
      'device',p_device
    ))
  );
end;
$$;


--
-- Name: log_general_ui_event_v1(text, uuid, uuid, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_general_ui_event_v1(p_event_type text, p_visitor_id uuid, p_session_id uuid, p_last_screen text DEFAULT NULL::text, p_client_version text DEFAULT NULL::text, p_balance_version text DEFAULT NULL::text, p_run_type text DEFAULT 'production'::text, p_source text DEFAULT 'direct'::text, p_device text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_event_type not in (
    'leaderboard_view',
    'stage_select_view',
    'ranked_cta_click',
    'session_end'
  ) then
    raise exception 'invalid ui event type';
  end if;

  if p_last_screen is not null
     and p_last_screen not in (
       'stage_select',
       'leaderboard',
       'general_game',
       'ranked_game',
       'result',
       'unknown'
     ) then
    raise exception 'invalid last_screen';
  end if;

  insert into public.game_events(
    user_id,
    event_type,
    status,
    metadata
  )
  values (
    auth.uid(),
    p_event_type,
    case when p_event_type='session_end' then 'ended' else 'viewed' end,
    jsonb_strip_nulls(
      jsonb_build_object(
        'visitor_id', p_visitor_id,
        'session_id', p_session_id,
        'last_screen', p_last_screen,
        'client_version', p_client_version,
        'balance_version', p_balance_version,
        'run_type', p_run_type,
        'source', p_source,
        'device', p_device
      )
    )
  );
end;
$$;


--
-- Name: log_induck_grow_analytics_v1(uuid, uuid, text, smallint, text, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_induck_grow_analytics_v1(p_event_id uuid, p_session_id uuid, p_event_type text, p_week smallint DEFAULT NULL::smallint, p_department text DEFAULT NULL::text, p_gpa numeric DEFAULT NULL::numeric, p_acquisition_source text DEFAULT 'unknown'::text, p_campaign text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if p_event_id is null or p_session_id is null
     or p_event_type not in ('landing','play_start','semester_start','week_checkpoint','semester_result','retry','account_save')
     or p_acquisition_source not in ('direct','everytime','internal','external','unknown')
     or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
     or (p_department is not null and p_department !~ '^[a-z][a-z0-9_-]{0,31}$')
     or ((p_event_type='semester_start' and not (p_week=1 and p_department is not null and p_gpa is null))
       or (p_event_type='week_checkpoint' and not (p_week between 1 and 15 and p_department is not null and p_gpa is null))
       or (p_event_type='semester_result' and not (p_week=15 and p_department is not null and p_gpa between 0 and 4.50))
       or (p_event_type in ('landing','play_start','retry','account_save') and not (p_week is null and p_department is null and p_gpa is null)))
     or coalesce((select count(*) from public.induck_grow_analytics_events where session_id=p_session_id and created_at>now()-interval '1 hour'),0)>=80
  then return false; end if;
  insert into public.induck_grow_analytics_events(event_id,session_id,event_type,week,department,gpa,acquisition_source,campaign)
  values(p_event_id,p_session_id,p_event_type,p_week,p_department,p_gpa,p_acquisition_source,p_campaign)
  on conflict do nothing;
  return true;
exception when check_violation then return false;
end;
$_$;


--
-- Name: log_induck_grow_decision_v1(uuid, uuid, smallint, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_induck_grow_decision_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_category text, p_decision_id text, p_choice_id text, p_acquisition_source text DEFAULT 'unknown'::text, p_campaign text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if p_event_id is null or p_session_id is null
     or (p_week is not null and p_week not between 0 and 15)
     or p_department is null or p_department !~ '^[a-z][a-z0-9_-]{0,31}$'
     or p_category not in ('orientation','course','club','student_council','random_event','subscription','career')
     or p_decision_id is null or p_decision_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or p_choice_id is null or p_choice_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or p_acquisition_source not in ('direct','everytime','internal','external','unknown')
     or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
     or coalesce((select count(*) from public.induck_grow_decision_events where session_id=p_session_id and created_at>now()-interval '1 hour'),0)>=80
  then return false; end if;
  if not exists (
    select 1 from public.induck_grow_analytics_events
    where session_id=p_session_id and event_type='landing' and created_at>now()-interval '24 hours'
  ) then return false; end if;
  insert into public.induck_grow_decision_events(
    event_id,session_id,week,department,category,decision_id,choice_id,acquisition_source,campaign
  ) values (
    p_event_id,p_session_id,p_week,p_department,p_category,p_decision_id,p_choice_id,p_acquisition_source,p_campaign
  ) on conflict(event_id) do nothing;
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$_$;


--
-- Name: log_induck_grow_resource_checkpoint_v1(uuid, uuid, smallint, text, smallint, smallint, integer, smallint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_induck_grow_resource_checkpoint_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_stamina smallint, p_stress smallint, p_money integer, p_free_slots smallint, p_acquisition_source text DEFAULT 'unknown'::text, p_campaign text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if p_event_id is null or p_session_id is null
     or p_week not in (1,4,8,12,15)
     or p_department is null or p_department !~ '^[a-z][a-z0-9_-]{0,31}$'
     or p_stamina not between 0 and 100 or p_stress not between 0 and 100
     or p_money not between 0 and 100000000 or p_free_slots not between 0 and 32
     or p_acquisition_source not in ('direct','everytime','internal','external','unknown')
     or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
  then return false; end if;
  if not exists (
    select 1 from public.induck_grow_analytics_events
    where session_id=p_session_id and event_type='semester_start' and created_at>now()-interval '24 hours'
  ) then return false; end if;
  insert into public.induck_grow_resource_checkpoints(
    event_id,session_id,week,department,stamina,stress,money,free_slots,acquisition_source,campaign
  ) values (
    p_event_id,p_session_id,p_week,p_department,p_stamina,p_stress,p_money,p_free_slots,p_acquisition_source,p_campaign
  ) on conflict(session_id,week) do nothing;
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$_$;


--
-- Name: log_induck_grow_session_end_v1(uuid, uuid, smallint, text, integer, boolean, text, text, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_induck_grow_session_end_v1(p_event_id uuid, p_session_id uuid, p_last_week smallint DEFAULT NULL::smallint, p_last_screen text DEFAULT NULL::text, p_duration_sec integer DEFAULT 0, p_completed boolean DEFAULT false, p_end_reason text DEFAULT 'pagehide'::text, p_department text DEFAULT NULL::text, p_final_gpa numeric DEFAULT NULL::numeric, p_acquisition_source text DEFAULT 'unknown'::text, p_campaign text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if p_event_id is null or p_session_id is null
     or (p_last_week is not null and p_last_week not between 1 and 15)
     or (p_last_screen is not null and p_last_screen !~ '^[a-z0-9_-]{1,32}$')
     or p_duration_sec not between 0 and 21600
     or p_end_reason not in ('completed','pagehide','hidden_timeout','error')
     or (p_completed and p_end_reason<>'completed') or (not p_completed and p_end_reason='completed')
     or (p_department is not null and p_department !~ '^[a-z][a-z0-9_-]{0,31}$')
     or (p_final_gpa is not null and p_final_gpa not between 0 and 4.50)
     or (not p_completed and p_final_gpa is not null)
     or p_acquisition_source not in ('direct','everytime','internal','external','unknown')
     or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
  then return false; end if;
  if not exists (
    select 1 from public.induck_grow_analytics_events
    where session_id=p_session_id and event_type='landing' and created_at>now()-interval '24 hours'
  ) then return false; end if;
  insert into public.induck_grow_session_ends(
    event_id,session_id,last_week,last_screen,duration_sec,completed,end_reason,department,final_gpa,acquisition_source,campaign
  ) values (
    p_event_id,p_session_id,p_last_week,p_last_screen,p_duration_sec,p_completed,p_end_reason,p_department,p_final_gpa,p_acquisition_source,p_campaign
  )
  on conflict(session_id) do update set
    event_id=excluded.event_id,
    last_week=coalesce(excluded.last_week,public.induck_grow_session_ends.last_week),
    last_screen=coalesce(excluded.last_screen,public.induck_grow_session_ends.last_screen),
    duration_sec=greatest(public.induck_grow_session_ends.duration_sec,excluded.duration_sec),
    completed=public.induck_grow_session_ends.completed or excluded.completed,
    end_reason=case
      when public.induck_grow_session_ends.completed then public.induck_grow_session_ends.end_reason
      when excluded.completed then 'completed'
      else excluded.end_reason
    end,
    department=coalesce(excluded.department,public.induck_grow_session_ends.department),
    final_gpa=case when excluded.completed then excluded.final_gpa else public.induck_grow_session_ends.final_gpa end,
    acquisition_source=public.induck_grow_session_ends.acquisition_source,
    campaign=public.induck_grow_session_ends.campaign,
    updated_at=now();
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$_$;


--
-- Name: log_inhagame_game_entry_v1(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_inhagame_game_entry_v1(p_event_id uuid, p_entry_id uuid, p_event_type text, p_target text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_click public.inhagame_hub_events%rowtype;
begin
  if p_event_id is null or p_entry_id is null
     or p_event_type not in (
       'game_landing','game_play_start','game_load_error',
       'game_first_result','game_first_clear','game_retry','classic_ranked_start'
     )
     or p_target not in ('classic','induckup','survival','campus','induck-grow')
     or (p_event_type='classic_ranked_start' and p_target<>'classic')
  then return false; end if;

  select * into v_click from public.inhagame_hub_events
  where event_id=p_entry_id
    and event_type in ('hub_game_click','campus_entry_click','profile_game_click')
    and target=p_target
    and created_at>now()-interval '30 minutes';
  if not found then return false; end if;

  if p_event_type='game_play_start' and not exists (
      select 1 from public.inhagame_hub_events
      where entry_id=p_entry_id and event_type='game_landing'
    ) then return false;
  elsif p_event_type='classic_ranked_start' and not exists (
      select 1 from public.inhagame_hub_events
      where entry_id=p_entry_id and event_type='game_landing'
    ) then return false;
  elsif p_event_type='game_first_result' and not exists (
      select 1 from public.inhagame_hub_events
      where entry_id=p_entry_id and event_type='game_play_start'
    ) then return false;
  elsif p_event_type in ('game_first_clear','game_retry') and not exists (
      select 1 from public.inhagame_hub_events
      where entry_id=p_entry_id and event_type='game_first_result'
    ) then return false;
  end if;

  insert into public.inhagame_hub_events(
    event_id,entry_id,session_id,visitor_id,event_type,surface,target,
    acquisition_source,campaign
  )
  values (
    p_event_id,p_entry_id,v_click.session_id,v_click.visitor_id,p_event_type,'game',p_target,
    v_click.acquisition_source,v_click.campaign
  )
  on conflict do nothing;
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$$;


--
-- Name: log_inhagame_hub_event_v1(uuid, uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_inhagame_hub_event_v1(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_event_id is null or p_session_id is null or p_visitor_id is null
     or p_event_type is null or p_event_type not in (
       'hub_visit','hub_panel_view','hub_game_click','campus_entry_click',
       'campus_boot_ready','campus_boot_error','campus_zone_enter','hub_card_impression',
       'profile_view','profile_edit_open','profile_edit_save','profile_game_click'
     ) or coalesce((select count(*) from public.inhagame_hub_events
       where session_id=p_session_id and created_at>now()-interval '1 hour'),0)>=120
  then return false; end if;
  insert into public.inhagame_hub_events(event_id,session_id,visitor_id,event_type,surface,target)
  values(p_event_id,p_session_id,p_visitor_id,p_event_type,p_surface,p_target)
  on conflict(event_id) do nothing;
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$$;


--
-- Name: log_inhagame_hub_event_v2(uuid, uuid, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_inhagame_hub_event_v2(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text DEFAULT NULL::text, p_acquisition_source text DEFAULT 'unknown'::text, p_campaign text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if p_event_id is null or p_session_id is null or p_visitor_id is null
     or p_event_type is null or p_event_type not in (
       'hub_visit','hub_panel_view','hub_game_click','campus_entry_click',
       'campus_boot_ready','campus_boot_error','campus_zone_enter','hub_card_impression',
       'profile_view','profile_edit_open','profile_edit_save','profile_game_click',
       'first_session_start','first_move','first_zone_arrival','first_npc_interaction',
       'first_player_encounter','first_activity_start','first_activity_complete',
       'first_reward','core_loop_complete','world_return','next_discovery_click'
     )
     or p_acquisition_source not in ('direct','everytime','internal','external','unknown')
     or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
     or coalesce((select count(*) from public.inhagame_hub_events
       where session_id=p_session_id and created_at>now()-interval '1 hour'),0)>=120
  then return false; end if;

  insert into public.inhagame_hub_events(
    event_id,session_id,visitor_id,event_type,surface,target,acquisition_source,campaign
  )
  values(
    p_event_id,p_session_id,p_visitor_id,p_event_type,p_surface,p_target,
    p_acquisition_source,p_campaign
  )
  on conflict(event_id) do nothing;
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$_$;


--
-- Name: log_ranked_run_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_ranked_run_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.game_events(user_id,event_type,run_id,score,combo,status,metadata)
  values (
    new.user_id,
    case when new.validation_status='accepted' then 'ranked_run_accepted' else 'ranked_run_rejected' end,
    new.run_id,new.score,new.max_combo,new.validation_status,
    jsonb_build_object(
      'run_type',new.run_type,
      'ruleset_version',new.ruleset_version,
      'completed_calls',new.completed_calls,
      'duration_ms',new.duration_ms,
      'suspicious_flag',new.suspicious_flag,
      'reject_reason',new.reject_reason
    )
  );
  return new;
end $$;


--
-- Name: log_ranked_session_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_ranked_session_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  evt text;
begin
  if tg_op='INSERT' then
    evt := 'ranked_session_started';
  elsif new.status is distinct from old.status then
    evt := 'ranked_session_' || new.status;
  else
    return new;
  end if;

  insert into public.game_events(user_id,event_type,run_id,status,metadata)
  values (
    new.user_id, evt, new.run_id, new.status,
    jsonb_build_object(
      'run_type',new.run_type,
      'ruleset_version',new.ruleset_version,
      'client_version',new.client_version,
      'expires_at',new.expires_at
    )
  );
  return new;
end $$;


--
-- Name: mark_hub_conversation_read_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_hub_conversation_read_v1(p_conversation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
  v_read_at timestamptz := now();
begin
  update public.hub_conversation_members
  set last_read_at = v_read_at
  where conversation_id = p_conversation and user_id = v_caller;

  if not found then
    raise exception 'CONVERSATION_UNAVAILABLE' using errcode = '22023';
  end if;

  return jsonb_build_object('conversationId', p_conversation, 'readAt', v_read_at);
end;
$$;


--
-- Name: mark_inha_duck_stage3_sample_alert_notified_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_inha_duck_stage3_sample_alert_notified_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_state public.ops_alert_state%rowtype;
begin
  update public.ops_alert_state
  set
    status='notified',
    notified_at=coalesce(notified_at,now()),
    updated_at=now()
  where alert_key='inha_duck_stage3_v102_attempts_20'
    and last_value >= threshold_value
  returning * into v_state;

  if not found then
    return jsonb_build_object('marked',false);
  end if;

  return jsonb_build_object(
    'marked',true,
    'notified_at',v_state.notified_at,
    'last_value',v_state.last_value,
    'threshold',v_state.threshold_value
  );
end;
$$;


--
-- Name: merge_my_biryong_progress_v1(jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_my_biryong_progress_v1(p_progress jsonb, p_migrated_from_local boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user uuid := auth.uid();
  v_existing private.world_biryong_progress_v1%rowtype;
  v_step text;
  v_step_rank integer;
  v_existing_rank integer;
  v_discovered timestamptz;
  v_completed timestamptz;
  v_lore text[];
  v_shouts integer;
begin
  if v_user is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if p_progress is null or jsonb_typeof(p_progress) <> 'object' then
    raise exception 'INVALID_BIRYONG_PROGRESS' using errcode = '22023';
  end if;

  v_step := coalesce(p_progress->>'step', 'INTRO');
  v_step_rank := case v_step
    when 'INTRO' then 0 when 'FIND_CENTER' then 1 when 'SHOUT' then 2
    when 'REACTION' then 3 when 'COMPLETE' then 4 else -1 end;
  if v_step_rank < 0 then
    raise exception 'INVALID_BIRYONG_STEP' using errcode = '22023';
  end if;

  if jsonb_typeof(p_progress->'discoveredAt') = 'number' then
    v_discovered := to_timestamp((p_progress->>'discoveredAt')::numeric / 1000);
  end if;
  if jsonb_typeof(p_progress->'completedAt') = 'number' then
    v_completed := to_timestamp((p_progress->>'completedAt')::numeric / 1000);
  end if;
  if v_step <> 'INTRO' and v_discovered is null then v_discovered := now(); end if;
  if v_step = 'COMPLETE' and v_completed is null then v_completed := now(); end if;
  if v_step <> 'COMPLETE' then v_completed := null; end if;

  begin
    v_shouts := greatest(0, coalesce((p_progress->>'shouts')::integer, 0));
  exception when others then
    raise exception 'INVALID_BIRYONG_SHOUTS' using errcode = '22023';
  end;

  if p_progress ? 'lore' and jsonb_typeof(p_progress->'lore') <> 'array' then
    raise exception 'INVALID_BIRYONG_LORE' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[]) into v_lore
  from jsonb_array_elements_text(coalesce(p_progress->'lore', '[]'::jsonb)) as lore(value)
  where char_length(value) between 1 and 96;

  select * into v_existing
  from private.world_biryong_progress_v1
  where user_id = v_user
  for update;

  if not found then
    insert into private.world_biryong_progress_v1(
      user_id, discovered_at, step, lore, shouts, completed_at, migrated_from_local
    ) values (
      v_user, v_discovered, v_step, v_lore, v_shouts, v_completed, coalesce(p_migrated_from_local, false)
    );
  else
    v_existing_rank := case v_existing.step
      when 'INTRO' then 0 when 'FIND_CENTER' then 1 when 'SHOUT' then 2
      when 'REACTION' then 3 when 'COMPLETE' then 4 else -1 end;

    update private.world_biryong_progress_v1
    set discovered_at = case
          when v_existing.discovered_at is null then v_discovered
          when v_discovered is null then v_existing.discovered_at
          else least(v_existing.discovered_at, v_discovered) end,
        step = case when v_step_rank > v_existing_rank then v_step else v_existing.step end,
        lore = array(
          select distinct x from unnest(v_existing.lore || v_lore) x order by x
        ),
        shouts = greatest(v_existing.shouts, v_shouts),
        completed_at = case
          when greatest(v_existing_rank, v_step_rank) < 4 then null
          when v_existing.completed_at is null then v_completed
          when v_completed is null then v_existing.completed_at
          else least(v_existing.completed_at, v_completed) end,
        migrated_from_local = v_existing.migrated_from_local or coalesce(p_migrated_from_local, false),
        updated_at = now()
    where user_id = v_user;
  end if;

  return public.get_my_biryong_progress_v1();
end;
$$;


--
-- Name: my_inha_mail_badge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_inha_mail_badge() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and u.is_anonymous = false
      and u.email_confirmed_at is not null
      and public.is_inha_mail(u.email)
  ) or exists (
    select 1 from public.inha_mail_badges b
    join auth.users u on u.id = b.user_id
    where b.user_id = (select auth.uid())
      and u.is_anonymous = false
      and u.email_confirmed_at is not null
  )
$$;


--
-- Name: propose_world_accompany(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.propose_world_accompany(p_target uuid, p_poi_id text, p_place_zone_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_caller uuid := private.world_social_caller();
declare v_id uuid;
begin
  perform private.world_social_target(v_caller, p_target);
  if p_poi_id not in ('poi.main-gate', 'poi.main-hall', 'poi.inkyung-pond', 'poi.jungseok') or p_poi_id is null then
    raise exception 'INVALID_DESTINATION' using errcode = '22023';
  end if;
  if p_place_zone_id is null or p_place_zone_id !~ '^AREA_[A-Z0-9_]{1,60}$' then
    raise exception 'INVALID_PLACE_ZONE' using errcode = '22023';
  end if;
  perform private.world_accompany_lock_users(v_caller, p_target);
  perform private.world_accompany_expire(v_caller);
  perform private.world_accompany_expire(p_target);
  if private.world_relationship(v_caller, p_target) <> 'friends' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  -- Repeat the same proposal safely after a lost response.
  select s.id into v_id from public.world_accompany_sessions s
   where s.inviter_id = v_caller and s.invitee_id = p_target and s.state = 'offered'
     and s.poi_id = p_poi_id and s.place_zone_id = p_place_zone_id and s.expires_at > now()
   order by s.created_at desc limit 1;
  if v_id is not null then return (select jsonb_build_object('id', s.id, 'state', s.state, 'expiresAt', s.expires_at)
                                from public.world_accompany_sessions s where s.id = v_id); end if;
  if exists (select 1 from public.world_accompany_sessions s
              where (s.inviter_id in (v_caller, p_target) or s.invitee_id in (v_caller, p_target))
                and s.state in ('offered', 'active') and s.expires_at > now()) then
    raise exception 'ALREADY_BUSY' using errcode = '42501';
  end if;
  if (select count(*) from public.world_accompany_sessions s
       where s.inviter_id = v_caller and s.created_at > now() - interval '1 minute') >= 3 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
  insert into public.world_accompany_sessions(inviter_id, invitee_id, place_zone_id, poi_id)
    values(v_caller, p_target, p_place_zone_id, p_poi_id) returning id into v_id;
  return (select jsonb_build_object('id', s.id, 'state', s.state, 'expiresAt', s.expires_at)
          from public.world_accompany_sessions s where s.id = v_id);
end;
$_$;


--
-- Name: purchase_world_shop_listing_v1(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purchase_world_shop_listing_v1(p_listing_id text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
  v_listing private.world_shop_listings%rowtype;
  v_shop private.world_shops%rowtype;
  v_existing private.world_purchase_transactions%rowtype;
  v_block text;
  v_policy text;
  v_wallet jsonb;
  v_grant jsonb;
  v_purchase_id uuid;
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  -- One purchase per account at a time: retries, ownership preflight and limits are decided here.
  perform pg_advisory_xact_lock(hashtextextended('world_shop:' || v_uid::text, 0));

  select * into v_existing from private.world_purchase_transactions p where p.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.user_id, v_existing.listing_id) is distinct from (v_uid, p_listing_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_purchase_result_v1(v_existing.purchase_id, true);
  end if;

  -- Preflight: every structural refusal happens before any value moves.
  select * into v_listing from private.world_shop_listings l where l.listing_id = p_listing_id;
  if not found or v_listing.status = 'HIDDEN' then
    raise exception 'INVALID_LISTING' using errcode = 'P0001';
  end if;
  select * into v_shop from private.world_shops s where s.shop_id = v_listing.shop_id;
  if v_shop.status = 'HIDDEN' then
    raise exception 'INVALID_LISTING' using errcode = 'P0001';
  end if;
  if v_shop.status <> 'ACTIVE' then
    raise exception 'SHOP_INACTIVE' using errcode = 'P0001';
  end if;
  -- The Level gate: derived now from the P0-F0 authority, never from the client or a cached read.
  v_block := private.world_shop_listing_block_v2(v_listing, now(), private.world_player_level_v1(v_uid));
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;
  if v_listing.purchase_limit is not null and (
       select count(*) from private.world_purchase_transactions p
        where p.user_id = v_uid and p.listing_id = v_listing.listing_id) >= v_listing.purchase_limit then
    raise exception 'PURCHASE_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  select c.ownership_policy into v_policy from private.world_item_catalog c where c.item_id = v_listing.item_id;
  if v_policy = 'UNIQUE' and exists (select 1 from private.world_player_items i
                                      where i.user_id = v_uid and i.item_id = v_listing.item_id) then
    raise exception 'ITEM_ALREADY_OWNED' using errcode = 'P0001';
  end if;

  -- Debit (P0-A path). INSUFFICIENT_FUNDS aborts the purchase with nothing moved.
  v_wallet := private.world_wallet_apply_v1(
    v_uid, v_listing.currency_id, -v_listing.price, 'PURCHASE', 'shop', v_listing.listing_id,
    'purchase/' || p_idempotency_key || '/wallet', null);

  -- Grant (P0-B path). Anything but a fresh grant aborts the whole purchase, debit included.
  v_grant := private.world_inventory_grant_v1(
    v_uid, v_listing.item_id, v_listing.quantity, 'SHOP', v_listing.listing_id,
    'purchase/' || p_idempotency_key || '/item', null,
    jsonb_build_object('shopId', v_listing.shop_id, 'price', v_listing.price, 'currencyId', v_listing.currency_id));
  if v_grant ->> 'status' = 'ALREADY_OWNED' then
    raise exception 'ITEM_ALREADY_OWNED' using errcode = 'P0001';
  end if;
  if v_grant ->> 'status' <> 'GRANTED' then
    raise exception 'PURCHASE_GRANT_FAILED' using errcode = 'P0001';
  end if;

  -- Readback of the final state inside the same transaction.
  if not exists (select 1 from private.world_player_items i
                  where i.user_id = v_uid and i.item_id = v_listing.item_id)
     or (select w.balance from private.world_wallets w
          where w.user_id = v_uid and w.currency_id = v_listing.currency_id)
        is distinct from (v_wallet ->> 'balanceAfter')::bigint then
    raise exception 'PURCHASE_READBACK_FAILED' using errcode = 'P0001';
  end if;

  begin
    insert into private.world_purchase_transactions (
      user_id, shop_id, listing_id, item_id, quantity, currency_id, price,
      balance_before, balance_after, wallet_transaction_id, inventory_grant_id, idempotency_key)
    values (
      v_uid, v_listing.shop_id, v_listing.listing_id, v_listing.item_id, v_listing.quantity,
      v_listing.currency_id, v_listing.price,
      (v_wallet ->> 'balanceBefore')::bigint, (v_wallet ->> 'balanceAfter')::bigint,
      (v_wallet ->> 'transactionId')::uuid, v_grant ->> 'grantId', p_idempotency_key)
    returning purchase_id into v_purchase_id;
  exception when unique_violation then
    -- Same-account retries are resolved above under the lock; this key belongs to another account.
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end;

  return private.world_purchase_result_v1(v_purchase_id, false);
end;
$_$;


--
-- Name: ranked_grade_code(integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ranked_grade_code(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when coalesce(p_completed_calls,0)>=2 and coalesce(p_score,0)>=330 and coalesce(p_rare,0)>=10 and coalesce(p_eclipse,0)>=12 and coalesce(p_flight,0)>=12 then 'A+'
    when coalesce(p_completed_calls,0)>=2 and coalesce(p_score,0)>=290 and coalesce(p_rare,0)>=8 and coalesce(p_eclipse,0)>=10 and coalesce(p_flight,0)>=10 then 'A0'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=255 and coalesce(p_rare,0)>=6 and coalesce(p_eclipse,0)>=8 and coalesce(p_flight,0)>=8 then 'B+'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=220 and coalesce(p_rare,0)>=5 and coalesce(p_eclipse,0)>=6 and coalesce(p_flight,0)>=6 then 'B0'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=185 and coalesce(p_rare,0)>=4 and coalesce(p_eclipse,0)>=5 and coalesce(p_flight,0)>=5 then 'C+'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=150 and coalesce(p_rare,0)>=2 and coalesce(p_eclipse,0)>=4 and coalesce(p_flight,0)>=4 then 'C0'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=115 and coalesce(p_rare,0)>=1 and coalesce(p_eclipse,0)>=3 and coalesce(p_flight,0)>=3 then 'D+'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=80 then 'D0'
    else 'F'
  end;
$$;


--
-- Name: ranked_grade_code_v5(integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ranked_grade_code_v5(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when coalesce(p_completed_calls,0)>=2 and coalesce(p_score,0)>=400 and coalesce(p_rare,0)>=10 and coalesce(p_eclipse,0)>=12 and coalesce(p_flight,0)>=12 then 'A+'
    when coalesce(p_completed_calls,0)>=2 and coalesce(p_score,0)>=350 and coalesce(p_rare,0)>=8 and coalesce(p_eclipse,0)>=10 and coalesce(p_flight,0)>=10 then 'A0'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=290 and coalesce(p_rare,0)>=6 and coalesce(p_eclipse,0)>=8 and coalesce(p_flight,0)>=8 then 'B+'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=250 and coalesce(p_rare,0)>=5 and coalesce(p_eclipse,0)>=6 and coalesce(p_flight,0)>=6 then 'B0'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=210 and coalesce(p_rare,0)>=4 and coalesce(p_eclipse,0)>=5 and coalesce(p_flight,0)>=5 then 'C+'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=170 and coalesce(p_rare,0)>=2 and coalesce(p_eclipse,0)>=4 and coalesce(p_flight,0)>=4 then 'C0'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=130 and coalesce(p_rare,0)>=1 and coalesce(p_eclipse,0)>=3 and coalesce(p_flight,0)>=3 then 'D+'
    when coalesce(p_completed_calls,0)>=1 and coalesce(p_score,0)>=90 then 'D0'
    else 'F'
  end;
$$;


--
-- Name: record_general_stage_best(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_general_stage_best(p_stage_id integer, p_score integer, p_combo integer DEFAULT 0) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_total integer;
  v_score_cap integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_stage_id not between 1 and 4 then
    raise exception 'INVALID_STAGE';
  end if;

  v_score_cap := case p_stage_id
    when 1 then 600
    when 2 then 550
    when 3 then 500
    when 4 then 500
  end;

  if p_score < 0 or p_score > v_score_cap then
    raise exception 'GENERAL_SCORE_OUT_OF_RANGE';
  end if;

  if p_combo < 0 or p_combo > 100 then
    raise exception 'GENERAL_COMBO_OUT_OF_RANGE';
  end if;

  if p_score > 250 and p_combo < 5 then
    raise exception 'GENERAL_SCORE_COMBO_MISMATCH';
  end if;

  if p_score > 400 and p_combo < 10 then
    raise exception 'GENERAL_SCORE_COMBO_MISMATCH';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id=v_user_id and is_banned=false
  ) then
    raise exception 'PROFILE_REQUIRED';
  end if;

  insert into public.general_stage_bests(user_id,stage_id,best_score,best_combo,achieved_at)
  values(v_user_id,p_stage_id,p_score,p_combo,now())
  on conflict(user_id,stage_id) do update
  set best_score=excluded.best_score,
      best_combo=excluded.best_combo,
      achieved_at=excluded.achieved_at
  where excluded.best_score>public.general_stage_bests.best_score
     or (
       excluded.best_score=public.general_stage_bests.best_score
       and excluded.best_combo>public.general_stage_bests.best_combo
     );

  select coalesce(sum(best_score),0)::integer
  into v_total
  from public.general_stage_bests
  where user_id=v_user_id;

  return v_total;
end;
$$;


--
-- Name: record_general_stage_best_v2(integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_general_stage_best_v2(p_stage_id integer, p_score integer, p_combo integer DEFAULT 0, p_stars integer DEFAULT 0) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_total integer;
  v_score_cap integer;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_stage_id not between 1 and 4 then raise exception 'INVALID_STAGE'; end if;
  if p_stars not between 0 and 3 then raise exception 'GENERAL_STARS_OUT_OF_RANGE'; end if;
  v_score_cap := case p_stage_id when 1 then 600 when 2 then 550 when 3 then 500 when 4 then 500 end;
  if p_score<0 or p_score>v_score_cap then raise exception 'GENERAL_SCORE_OUT_OF_RANGE'; end if;
  if p_combo<0 or p_combo>100 then raise exception 'GENERAL_COMBO_OUT_OF_RANGE'; end if;
  if p_score>250 and p_combo<5 then raise exception 'GENERAL_SCORE_COMBO_MISMATCH'; end if;
  if p_score>400 and p_combo<10 then raise exception 'GENERAL_SCORE_COMBO_MISMATCH'; end if;

  if p_stage_id=1 then
    if p_stars>=1 and p_score<60 then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=2 and (p_score<120 or p_combo<10) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=3 and (p_score<200 or p_combo<20) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
  elsif p_stage_id=2 then
    if p_stars>=1 and p_score<55 then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=2 and (p_score<90 or p_combo<8) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=3 and (p_score<145 or p_combo<15) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
  elsif p_stage_id=3 then
    if p_stars>=1 and p_score<45 then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=2 and (p_score<70 or p_combo<6) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=3 and (p_score<110 or p_combo<10) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
  else
    if p_stars>=1 and (p_score<45 or p_combo<5) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=2 and (p_score<70 or p_combo<6) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
    if p_stars>=3 and (p_score<100 or p_combo<6) then raise exception 'GENERAL_STARS_MISMATCH'; end if;
  end if;

  if not exists(select 1 from public.profiles where user_id=v_user_id and is_banned=false)
    then raise exception 'PROFILE_REQUIRED'; end if;

  insert into public.general_stage_bests(user_id,stage_id,best_score,best_combo,best_stars,achieved_at)
  values(v_user_id,p_stage_id,p_score,p_combo,p_stars,now())
  on conflict(user_id,stage_id) do update
  set best_score=greatest(public.general_stage_bests.best_score,excluded.best_score),
      best_combo=greatest(public.general_stage_bests.best_combo,excluded.best_combo),
      best_stars=greatest(public.general_stage_bests.best_stars,excluded.best_stars),
      achieved_at=case
        when excluded.best_score>public.general_stage_bests.best_score
          or excluded.best_combo>public.general_stage_bests.best_combo
          or excluded.best_stars>public.general_stage_bests.best_stars
        then now() else public.general_stage_bests.achieved_at end;

  select coalesce(sum(best_score),0)::integer into v_total
  from public.general_stage_bests where user_id=v_user_id;
  return v_total;
end;
$$;


--
-- Name: record_induckup_ranked_best_v1(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_induckup_ranked_best_v1(p_wave integer, p_score integer, p_duration_ms integer) RETURNS TABLE(best_wave integer, best_score integer, best_duration_ms integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_permanent_account() then raise exception 'PERMANENT_ACCOUNT_REQUIRED'; end if;
  if p_wave < 1 or p_wave > 10000 then raise exception 'INVALID_WAVE'; end if;
  if p_score < 0 or p_score > 2000000000 then raise exception 'INVALID_SCORE'; end if;
  if p_duration_ms < 1000 or p_duration_ms > 86400000 then raise exception 'INVALID_DURATION'; end if;

  insert into public.induckup_ranked_bests(user_id,best_wave,best_score,best_duration_ms,achieved_at)
  values(v_user_id,p_wave,p_score,p_duration_ms,now())
  on conflict(user_id) do update
  set best_wave=excluded.best_wave,
      best_score=excluded.best_score,
      best_duration_ms=excluded.best_duration_ms,
      achieved_at=excluded.achieved_at
  where excluded.best_wave > public.induckup_ranked_bests.best_wave
     or (excluded.best_wave = public.induckup_ranked_bests.best_wave
         and excluded.best_score > public.induckup_ranked_bests.best_score)
     or (excluded.best_wave = public.induckup_ranked_bests.best_wave
         and excluded.best_score = public.induckup_ranked_bests.best_score
         and excluded.best_duration_ms > public.induckup_ranked_bests.best_duration_ms);

  return query
  select b.best_wave,b.best_score,b.best_duration_ms
  from public.induckup_ranked_bests b
  where b.user_id=v_user_id;
end;
$$;


--
-- Name: record_ranked_result(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ranked_result(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_total_hits integer, p_dragon_bursts integer, p_duration_ms integer, p_client_version text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run_row_id uuid;
begin
  insert into public.ranked_runs(
    run_id,user_id,stage_key,score,max_combo,annyongi_hits,indeoki_hits,gold_hits,
    total_hits,dragon_bursts,duration_ms,client_version,validation_status
  )
  values(
    p_run_id,p_user_id,'secret',p_score,p_max_combo,p_annyongi_hits,p_indeoki_hits,p_gold_hits,
    p_total_hits,p_dragon_bursts,p_duration_ms,p_client_version,'accepted'
  )
  returning id into v_run_row_id;

  update public.ranked_sessions
     set status='accepted', finished_at=now()
   where run_id=p_run_id and user_id=p_user_id and status='started';

  if not found then
    raise exception 'ranked session not open';
  end if;

  insert into public.player_bests(user_id,stage_key,best_score,best_combo,best_run_id,achieved_at)
  values(p_user_id,'secret',p_score,p_max_combo,v_run_row_id,now())
  on conflict (user_id,stage_key) do update
  set best_score = excluded.best_score,
      best_combo = excluded.best_combo,
      best_run_id = excluded.best_run_id,
      achieved_at = excluded.achieved_at
  where excluded.best_score > public.player_bests.best_score
     or (
       excluded.best_score = public.player_bests.best_score
       and excluded.best_combo > public.player_bests.best_combo
     );

  return v_run_row_id;
end;
$$;


--
-- Name: record_ranked_result_v3(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer, boolean, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ranked_result_v3(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer DEFAULT 0, p_reaction_sample_count integer DEFAULT 0, p_ultra_fast_reaction_count integer DEFAULT 0, p_suspicious_flag boolean DEFAULT false, p_suspicion_reasons text[] DEFAULT '{}'::text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run_row_id uuid;
  v_run_type text;
  v_ruleset_version text;
begin
  select run_type, ruleset_version
    into v_run_type, v_ruleset_version
  from public.ranked_sessions
  where run_id = p_run_id
    and user_id = p_user_id
    and status = 'started'
  for update;

  if not found then
    raise exception 'ranked session not open';
  end if;

  insert into public.ranked_runs(
    run_id,user_id,stage_key,score,max_combo,annyongi_hits,indeoki_hits,gold_hits,
    normal_hits,speedy_hits,total_hits,dragon_calls,moon_bonus_hits,flight_hits,
    dragon_bursts,duration_ms,client_version,validation_status,
    run_type,ruleset_version,input_count,reaction_sample_count,ultra_fast_reaction_count,
    suspicious_flag,suspicion_reasons
  )
  values(
    p_run_id,p_user_id,'secret',p_score,p_max_combo,p_annyongi_hits,p_indeoki_hits,p_gold_hits,
    p_normal_hits,p_speedy_hits,p_total_hits,p_dragon_calls,p_moon_bonus_hits,p_flight_hits,
    0,p_duration_ms,p_client_version,'accepted',
    v_run_type,v_ruleset_version,p_input_count,p_reaction_sample_count,p_ultra_fast_reaction_count,
    p_suspicious_flag,coalesce(p_suspicion_reasons,'{}'::text[])
  )
  returning id into v_run_row_id;

  update public.ranked_sessions
     set status='accepted', finished_at=now()
   where run_id=p_run_id and user_id=p_user_id and status='started';

  if not found then
    raise exception 'ranked session close failed';
  end if;

  -- Phase 1 Shadow Mode:
  -- suspicious ranked runs remain leaderboard-eligible while thresholds are calibrated.
  -- QA runs are never eligible for player_bests.
  if v_run_type = 'ranked' then
    insert into public.player_bests(user_id,stage_key,best_score,best_combo,best_run_id,achieved_at)
    values(p_user_id,'secret',p_score,p_max_combo,v_run_row_id,now())
    on conflict (user_id,stage_key) do update
    set best_score = excluded.best_score,
        best_combo = excluded.best_combo,
        best_run_id = excluded.best_run_id,
        achieved_at = excluded.achieved_at
    where excluded.best_score > public.player_bests.best_score
       or (
         excluded.best_score = public.player_bests.best_score
         and excluded.best_combo > public.player_bests.best_combo
       );
  end if;

  return v_run_row_id;
end;
$$;


--
-- Name: record_ranked_result_v4(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer, boolean, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ranked_result_v4(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer DEFAULT 0, p_reaction_sample_count integer DEFAULT 0, p_ultra_fast_reaction_count integer DEFAULT 0, p_suspicious_flag boolean DEFAULT false, p_suspicion_reasons text[] DEFAULT '{}'::text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run_row_id uuid;
  v_run_type text;
  v_ruleset_version text;
begin
  select run_type,ruleset_version into v_run_type,v_ruleset_version
  from public.ranked_sessions
  where run_id=p_run_id and user_id=p_user_id and status='submitted'
  for update;
  if not found then raise exception 'ranked session not submitted'; end if;

  insert into public.ranked_runs(
    run_id,user_id,stage_key,score,max_combo,annyongi_hits,indeoki_hits,gold_hits,
    normal_hits,speedy_hits,total_hits,dragon_calls,completed_calls,moon_bonus_hits,flight_hits,
    dragon_bursts,duration_ms,client_version,validation_status,run_type,ruleset_version,
    input_count,reaction_sample_count,ultra_fast_reaction_count,suspicious_flag,suspicion_reasons
  ) values(
    p_run_id,p_user_id,'secret',p_score,p_max_combo,p_annyongi_hits,p_indeoki_hits,p_gold_hits,
    p_normal_hits,p_speedy_hits,p_total_hits,p_dragon_calls,p_completed_calls,p_moon_bonus_hits,p_flight_hits,
    0,p_duration_ms,p_client_version,'accepted',v_run_type,v_ruleset_version,
    p_input_count,p_reaction_sample_count,p_ultra_fast_reaction_count,p_suspicious_flag,coalesce(p_suspicion_reasons,'{}')
  ) returning id into v_run_row_id;

  update public.ranked_sessions
  set status='accepted',finished_at=now()
  where run_id=p_run_id and user_id=p_user_id and status='submitted';
  if not found then raise exception 'ranked session close failed'; end if;

  if v_run_type='ranked' then
    insert into public.player_bests(user_id,stage_key,best_score,best_combo,best_run_id,achieved_at)
    values(p_user_id,'secret',p_score,p_max_combo,v_run_row_id,now())
    on conflict(user_id,stage_key) do update
    set best_score=excluded.best_score,best_combo=excluded.best_combo,
        best_run_id=excluded.best_run_id,achieved_at=excluded.achieved_at
    where excluded.best_score>public.player_bests.best_score
       or (excluded.best_score=public.player_bests.best_score and excluded.best_combo>public.player_bests.best_combo);
  end if;

  return v_run_row_id;
end;
$$;


--
-- Name: record_ranked_result_v5(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, boolean, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ranked_result_v5(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_combo_bonus integer, p_flight_base_points integer, p_tier1_hits integer, p_tier2_hits integer, p_tier1_ground_award integer, p_tier2_ground_award integer, p_ascension_bonus integer, p_input_count integer DEFAULT 0, p_reaction_sample_count integer DEFAULT 0, p_ultra_fast_reaction_count integer DEFAULT 0, p_suspicious_flag boolean DEFAULT false, p_suspicion_reasons text[] DEFAULT '{}'::text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run_row_id uuid;
  v_run_type text;
  v_ruleset_version text;
begin
  select run_type,ruleset_version into v_run_type,v_ruleset_version
  from public.ranked_sessions
  where run_id=p_run_id and user_id=p_user_id and status='submitted'
  for update;
  if not found then raise exception 'ranked session not submitted'; end if;

  insert into public.ranked_runs(
    run_id,user_id,stage_key,score,max_combo,annyongi_hits,indeoki_hits,gold_hits,
    normal_hits,speedy_hits,total_hits,dragon_calls,completed_calls,moon_bonus_hits,flight_hits,
    dragon_bursts,duration_ms,client_version,validation_status,run_type,ruleset_version,
    input_count,reaction_sample_count,ultra_fast_reaction_count,suspicious_flag,suspicion_reasons,
    combo_bonus,flight_base_points,tier1_hits,tier2_hits,tier1_ground_award,tier2_ground_award,ascension_bonus
  ) values(
    p_run_id,p_user_id,'secret',p_score,p_max_combo,p_annyongi_hits,p_indeoki_hits,p_gold_hits,
    p_normal_hits,p_speedy_hits,p_total_hits,p_dragon_calls,p_completed_calls,p_moon_bonus_hits,p_flight_hits,
    0,p_duration_ms,p_client_version,'accepted',v_run_type,v_ruleset_version,
    p_input_count,p_reaction_sample_count,p_ultra_fast_reaction_count,p_suspicious_flag,coalesce(p_suspicion_reasons,'{}'),
    p_combo_bonus,p_flight_base_points,p_tier1_hits,p_tier2_hits,p_tier1_ground_award,p_tier2_ground_award,p_ascension_bonus
  ) returning id into v_run_row_id;

  update public.ranked_sessions
  set status='accepted',finished_at=now()
  where run_id=p_run_id and user_id=p_user_id and status='submitted';
  if not found then raise exception 'ranked session close failed'; end if;

  if v_run_type='ranked' then
    insert into public.player_bests(user_id,stage_key,best_score,best_combo,best_run_id,achieved_at)
    values(p_user_id,'secret',p_score,p_max_combo,v_run_row_id,now())
    on conflict(user_id,stage_key) do update
    set best_score=excluded.best_score,best_combo=excluded.best_combo,
        best_run_id=excluded.best_run_id,achieved_at=excluded.achieved_at
    where excluded.best_score>public.player_bests.best_score
       or (excluded.best_score=public.player_bests.best_score and excluded.best_combo>public.player_bests.best_combo);
  end if;

  return v_run_row_id;
end;
$$;


--
-- Name: remove_world_friend(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_world_friend(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  perform private.world_social_target(v_caller, p_target);
  perform private.world_lock_pair(v_caller, p_target);
  delete from public.world_friendships f
   where f.user_low = least(v_caller, p_target) and f.user_high = greatest(v_caller, p_target)
     and f.status = 'accepted';
  return jsonb_build_object('userId', p_target, 'relationship', private.world_relationship(v_caller, p_target));
end;
$$;


--
-- Name: report_hub_message_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_hub_message_v1(p_message uuid, p_category text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
  v_message public.hub_messages%rowtype;
begin
  if p_category is null or p_category not in ('spam','harassment','inappropriate_content','impersonation','other') then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;

  select hm.* into v_message
  from public.hub_messages hm
  join public.hub_conversation_members m
    on m.conversation_id = hm.conversation_id
   and m.user_id = v_caller
  where hm.id = p_message;

  if not found then
    raise exception 'MESSAGE_UNAVAILABLE' using errcode = '22023';
  end if;

  if v_message.sender_id = v_caller then
    raise exception 'CANNOT_REPORT_SELF' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hub_message_report:' || v_caller::text, 0));

  if exists (
    select 1
    from public.hub_message_reports r
    where r.reporter_id = v_caller
      and r.message_id = p_message
      and r.category = p_category
      and r.created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if (
    select count(*)
    from public.hub_message_reports r
    where r.reporter_id = v_caller
      and r.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  insert into public.hub_message_reports(reporter_id, target_id, message_id, category)
  values (v_caller, v_message.sender_id, p_message, p_category);

  return jsonb_build_object('status', 'received');
end;
$$;


--
-- Name: report_world_user(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.report_world_user(p_target uuid, p_category text, p_place_zone_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_caller uuid := private.world_social_caller();
begin
  if p_target is null or p_target = v_caller then raise exception 'CANNOT_REPORT_SELF' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_target) then
    raise exception 'TARGET_UNAVAILABLE' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('spam', 'harassment', 'inappropriate_name', 'other') then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;
  if p_place_zone_id is not null and p_place_zone_id !~ '^AREA_[A-Z0-9_]{1,60}$' then
    raise exception 'INVALID_PLACE_ZONE' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('world_report:' || v_caller::text, 0));
  if exists (select 1 from public.world_user_reports r where r.reporter_id = v_caller and r.target_id = p_target
             and r.category = p_category and r.created_at > now() - interval '24 hours') then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if (select count(*) from public.world_user_reports r where r.reporter_id = v_caller and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
  insert into public.world_user_reports (reporter_id, target_id, category, place_zone_id)
  values (v_caller, p_target, p_category, p_place_zone_id);
  return jsonb_build_object('status', 'received');
end;
$_$;


--
-- Name: respond_world_accompany(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_world_accompany(p_session_id uuid, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
declare v_session public.world_accompany_sessions%rowtype;
begin
  if p_accept is null then raise exception 'INVALID_ARGUMENT' using errcode = '22023'; end if;
  select * into v_session from public.world_accompany_sessions where id = p_session_id and invitee_id = v_caller;
  if not found then raise exception 'TARGET_UNAVAILABLE' using errcode = '22023'; end if;
  perform private.world_accompany_lock_users(v_caller, v_session.inviter_id);
  perform private.world_accompany_expire(v_caller);
  select * into v_session from public.world_accompany_sessions where id = p_session_id and invitee_id = v_caller for update;
  if v_session.state = 'active' and p_accept then return jsonb_build_object('id', v_session.id, 'state', 'active'); end if;
  if v_session.state = 'declined' and not p_accept then return jsonb_build_object('id', v_session.id, 'state', 'declined'); end if;
  if v_session.state <> 'offered' then raise exception 'TARGET_UNAVAILABLE' using errcode = '22023'; end if;
  if private.world_relationship(v_caller, v_session.inviter_id) <> 'friends' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_accept then
    update public.world_accompany_sessions set state = 'active', accepted_at = now(), expires_at = now() + interval '10 minutes'
      where id = p_session_id;
  else
    update public.world_accompany_sessions set state = 'declined', ended_at = now(), ended_reason = 'declined'
      where id = p_session_id;
  end if;
  return jsonb_build_object('id', p_session_id, 'state', case when p_accept then 'active' else 'declined' end);
end;
$$;


--
-- Name: respond_world_friend_request(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_world_friend_request(p_target uuid, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  perform private.world_social_target(v_caller, p_target);
  if p_accept is null then raise exception 'INVALID_ARGUMENT' using errcode = '22023'; end if;
  perform private.world_lock_pair(v_caller, p_target);
  -- Only the recipient of a pending request (requested_by = the other user) may answer it.
  if p_accept then
    update public.world_friendships f
       set status = 'accepted', accepted_at = now(), updated_at = now()
     where f.user_low = least(v_caller, p_target) and f.user_high = greatest(v_caller, p_target)
       and f.status = 'pending' and f.requested_by = p_target;
  else
    delete from public.world_friendships f
     where f.user_low = least(v_caller, p_target) and f.user_high = greatest(v_caller, p_target)
       and f.status = 'pending' and f.requested_by = p_target;
  end if;
  return jsonb_build_object('userId', p_target, 'relationship', private.world_relationship(v_caller, p_target));
end;
$$;


--
-- Name: review_world_user_report_ops_v1(text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_world_user_report_ops_v1(p_token text, p_report_id bigint, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_report public.world_user_reports%rowtype;
  v_until timestamptz;
  v_next_status text;
  v_resolution text;
begin
  if not private.inha_duck_ops_credential_valid_v1(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_report_id is null then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;

  if p_action not in ('reviewing','warning','interaction_restriction_24h','dismissed') then
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;

  select *
  into v_report
  from public.world_user_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND' using errcode = '22023';
  end if;

  if p_action = 'reviewing' then
    if v_report.status = 'pending' then
      update public.world_user_reports
      set status='reviewing', updated_at=now()
      where id=p_report_id;

      insert into private.world_user_moderation_actions(report_id,target_id,action)
      values (p_report_id,v_report.target_id,'reviewing');
    elsif v_report.status <> 'reviewing' then
      raise exception 'REPORT_ALREADY_CLOSED' using errcode = '22023';
    end if;
  else
    if v_report.status in ('resolved','dismissed') then
      raise exception 'REPORT_ALREADY_CLOSED' using errcode = '22023';
    end if;

    if p_action = 'warning' then
      v_next_status := 'resolved';
      v_resolution := 'warning';
    elsif p_action = 'dismissed' then
      v_next_status := 'dismissed';
      v_resolution := 'dismissed';
    else
      v_next_status := 'resolved';
      v_resolution := 'interaction_restriction_24h';

      select greatest(
        now(),
        coalesce(max(a.ends_at), now())
      ) + interval '24 hours'
      into v_until
      from private.world_user_moderation_actions a
      where a.target_id = v_report.target_id
        and a.action = 'interaction_restriction_24h'
        and a.ends_at > now();
    end if;

    update public.world_user_reports
    set
      status = v_next_status,
      resolution = v_resolution,
      reviewed_at = now(),
      updated_at = now()
    where id = p_report_id;

    insert into private.world_user_moderation_actions(
      report_id,target_id,action,starts_at,ends_at
    )
    values (
      p_report_id,
      v_report.target_id,
      p_action,
      now(),
      case when p_action='interaction_restriction_24h' then v_until else null end
    );
  end if;

  return jsonb_build_object(
    'id', p_report_id,
    'status', (select status from public.world_user_reports where id=p_report_id),
    'resolution', (select resolution from public.world_user_reports where id=p_report_id),
    'reviewedAt', (select reviewed_at from public.world_user_reports where id=p_report_id),
    'restrictionUntil', (
      select max(a.ends_at)
      from private.world_user_moderation_actions a
      where a.target_id = v_report.target_id
        and a.action='interaction_restriction_24h'
        and a.ends_at > now()
    )
  );
end;
$$;


--
-- Name: save_my_game_progress(text, jsonb, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_my_game_progress(p_game_slug text, p_progress jsonb, p_schema_version integer DEFAULT 1, p_migrated_from_local boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
declare
  v_game_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  if p_game_slug is null or char_length(p_game_slug) < 1 or char_length(p_game_slug) > 80 then
    raise exception 'INVALID_GAME_SLUG' using errcode = '22023';
  end if;
  if p_progress is null or jsonb_typeof(p_progress) <> 'object' then
    raise exception 'PROGRESS_MUST_BE_OBJECT' using errcode = '22023';
  end if;
  if pg_column_size(p_progress) > 131072 then
    raise exception 'PROGRESS_TOO_LARGE' using errcode = '22023';
  end if;
  if coalesce(p_schema_version, 0) < 1 then
    raise exception 'INVALID_SCHEMA_VERSION' using errcode = '22023';
  end if;

  select id into v_game_id from public.games where slug = p_game_slug limit 1;
  if v_game_id is null then
    raise exception 'UNKNOWN_GAME' using errcode = '22023';
  end if;

  insert into public.user_game_progress (
    user_id, game_id, progress, schema_version, migrated_from_local, first_synced_at, updated_at
  )
  values (auth.uid(), v_game_id, p_progress, p_schema_version, p_migrated_from_local, now(), now())
  on conflict (user_id, game_id) do update
  set progress = case
        when p_game_slug = 'induckup' and (
          jsonb_typeof(public.user_game_progress.progress->'meta') = 'object'
          or jsonb_typeof(excluded.progress->'meta') = 'object'
        ) then jsonb_set(excluded.progress, '{meta}', public.induckup_merge_meta_v1(
          public.user_game_progress.progress->'meta', excluded.progress->'meta'), true)
        else excluded.progress end,
      schema_version = excluded.schema_version,
      migrated_from_local = public.user_game_progress.migrated_from_local or excluded.migrated_from_local,
      updated_at = now();

  select jsonb_build_object(
    'game_slug', g.slug,
    'schema_version', ugp.schema_version,
    'migrated_from_local', ugp.migrated_from_local,
    'updated_at', ugp.updated_at
  ) into v_result
  from public.user_game_progress ugp
  join public.games g on g.id = ugp.game_id
  where ugp.user_id = auth.uid() and ugp.game_id = v_game_id;
  return v_result;
end;
$$;


--
-- Name: save_my_grow_progress(jsonb, timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_my_grow_progress(p_progress jsonb, p_expected_updated_at timestamp with time zone, p_migrated_from_local boolean DEFAULT false) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid());
declare v_game uuid;
declare v_time timestamptz;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;
  if p_progress is null or jsonb_typeof(p_progress)<>'object'
    or pg_column_size(p_progress)>1048576 then
    raise exception 'INVALID_GROW_PROGRESS' using errcode='22023';
  end if;
  select id into v_game from public.games where slug='induck-grow';
  if v_game is null then raise exception 'UNKNOWN_GAME' using errcode='22023'; end if;
  if p_expected_updated_at is null then
    insert into public.user_game_progress
      (user_id,game_id,progress,schema_version,migrated_from_local)
    values(v_uid,v_game,p_progress,1,p_migrated_from_local)
    on conflict (user_id,game_id) do nothing
    returning updated_at into v_time;
  else
    update public.user_game_progress
       set progress=p_progress, schema_version=1,
           migrated_from_local=migrated_from_local or p_migrated_from_local,
           updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
     where user_id=v_uid and game_id=v_game and updated_at=p_expected_updated_at
     returning updated_at into v_time;
  end if;
  if v_time is null then raise exception 'GROW_SAVE_CONFLICT' using errcode='40001'; end if;
  return v_time;
end;
$$;


--
-- Name: send_hub_message_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_hub_message_v1(p_recipient uuid, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := private.hub_message_caller();
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation uuid;
  v_message uuid;
  v_created_at timestamptz;
  v_new boolean := false;
begin
  perform private.hub_message_target(v_caller, p_recipient);

  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'INVALID_MESSAGE' using errcode = '22023';
  end if;

  perform private.hub_message_lock_pair(v_caller, p_recipient);

  if exists (
    select 1
    from public.world_user_blocks b
    where (b.blocker_id = v_caller and b.blocked_id = p_recipient)
       or (b.blocker_id = p_recipient and b.blocked_id = v_caller)
  ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select c.id into v_conversation
  from public.hub_conversations c
  where c.user_low = least(v_caller, p_recipient)
    and c.user_high = greatest(v_caller, p_recipient);

  if v_conversation is null then
    if not private.hub_message_inha_verified(v_caller) then
      raise exception 'INHA_VERIFICATION_REQUIRED' using errcode = '42501';
    end if;

    -- Pair locks prevent duplicate conversations; sender locks make the fan-out limits race-safe
    -- across simultaneous first messages to different recipients.
    perform private.hub_message_lock_sender(v_caller);

    if (
      select count(*)
      from public.hub_conversations c
      where c.created_by = v_caller
        and c.created_at > now() - interval '10 minutes'
    ) >= 5 then
      raise exception 'RATE_LIMITED' using errcode = '54000';
    end if;

    if (
      select count(*)
      from public.hub_conversations c
      where c.created_by = v_caller
        and c.created_at > now() - interval '24 hours'
    ) >= 20 then
      raise exception 'RATE_LIMITED' using errcode = '54000';
    end if;

    insert into public.hub_conversations(user_low, user_high, created_by)
    values (least(v_caller,p_recipient), greatest(v_caller,p_recipient), v_caller)
    returning id into v_conversation;

    insert into public.hub_conversation_members(conversation_id, user_id)
    values
      (v_conversation, v_caller),
      (v_conversation, p_recipient);

    v_new := true;
  end if;

  insert into public.hub_messages(conversation_id, sender_id, body)
  values (v_conversation, v_caller, v_body)
  returning id, created_at into v_message, v_created_at;

  update public.hub_conversations
  set updated_at = v_created_at
  where id = v_conversation;

  -- A fresh message brings an archived conversation back for both participants.
  update public.hub_conversation_members
  set archived_at = null
  where conversation_id = v_conversation;

  return jsonb_build_object(
    'conversationId', v_conversation,
    'messageId', v_message,
    'senderId', v_caller,
    'body', v_body,
    'createdAt', v_created_at,
    'newConversation', v_new
  );
end;
$$;


--
-- Name: send_world_friend_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_world_friend_request(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
declare v_state text;
begin
  perform private.world_social_target(v_caller, p_target);
  perform private.world_lock_pair(v_caller, p_target);
  v_state := private.world_relationship(v_caller, p_target);
  if v_state in ('blocked_by_me', 'unavailable') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_state = 'none' then
    insert into public.world_friendships (user_low, user_high, status, requested_by)
    values (least(v_caller, p_target), greatest(v_caller, p_target), 'pending', v_caller)
    on conflict (user_low, user_high) do nothing;
  end if;
  -- outgoing/incoming/friends are returned as-is: a crossed request never auto-accepts.
  return jsonb_build_object('userId', p_target, 'relationship', private.world_relationship(v_caller, p_target));
end;
$$;


--
-- Name: set_my_grow_rank_visibility(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_grow_rank_visibility(p_department text, p_public boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) or
     p_department not in ('culture','cse','aero','apsl','nursing','theatre') or p_public is null or
     not exists(select 1 from public.profiles where user_id=v_uid and is_banned=false) then
     raise exception 'INVALID_VISIBILITY' using errcode='42501';
  end if;
  insert into public.grow_rank_visibility(user_id,department,is_public) values(v_uid,p_department,p_public)
  on conflict(user_id,department) do update set is_public=excluded.is_public;
  return p_public;
end $$;


--
-- Name: start_mcm_landlord_run_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_mcm_landlord_run_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_event private.world_events%rowtype;
  v_run private.world_landlord_runs%rowtype;
  v_resumed boolean := true;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_mcm_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  select * into v_event from private.world_events where event_id = 'event.mcm_2026';
  if private.world_event_state_v1(v_event, now()) is distinct from 'ACTIVE' then
    raise exception 'EVENT_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_landlord:' || v_uid::text, 0));

  -- A run past its deadline is over, whether or not the player came back to it.
  update private.world_landlord_runs r
     set status = 'FAILED', ended_at = now()
   where r.user_id = v_uid and r.status = 'ACTIVE' and r.deadline_at <= now();

  select * into v_run from private.world_landlord_runs r where r.user_id = v_uid and r.status = 'ACTIVE';
  if not found then
    insert into private.world_landlord_runs (user_id, event_id, status, survivor_actor_id, deadline_at)
    values (v_uid, 'event.mcm_2026', 'ACTIVE', private.world_landlord_pick_survivor_v1(),
            now() + interval '45 seconds')
    returning * into v_run;
    v_resumed := false;
  end if;

  return jsonb_build_object(
    'runId', v_run.run_id,
    'status', v_run.status,
    'resumed', v_resumed,
    'startedAt', v_run.started_at,
    'deadlineAt', v_run.deadline_at,
    'serverNow', now(),
    'durationMs', 45000,
    'wrongPenaltyMs', 5000,
    'wrongCount', v_run.wrong_count,
    'actorIds', jsonb_build_array('ZUE-MG-001', 'ZUE-MG-002', 'ZUE-MG-003', 'ZUE-MG-004', 'ZUE-MG-005'));
end;
$$;


--
-- Name: start_my_world_daily_quiz_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_my_world_daily_quiz_v1() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_daily_quiz_caller_v1();
  v_today date := private.world_daily_quiz_today_v1();
  v_questions text[];
begin
  -- One quiz decision per account at a time: concurrent starts wait, then see the same run.
  perform pg_advisory_xact_lock(hashtextextended('world_daily_quiz:' || v_uid::text, 0));
  if not exists (select 1 from private.world_daily_quiz_runs r where r.user_id = v_uid and r.reward_date = v_today) then
    select array_agg(x.question_id) into v_questions from (
      select q.question_id from private.world_daily_quiz_questions q
       where q.status = 'ACTIVE' order by gen_random_uuid() limit 3) x;
    if coalesce(cardinality(v_questions), 0) < 3 then
      raise exception 'QUIZ_UNAVAILABLE' using errcode = 'P0001';
    end if;
    insert into private.world_daily_quiz_runs (user_id, reward_date, question_ids)
    values (v_uid, v_today, v_questions)
    on conflict (user_id, reward_date) do nothing;
  end if;
  return private.world_daily_quiz_state_v1(v_uid, v_today);
end;
$$;


--
-- Name: submit_mcm_landlord_choice_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_mcm_landlord_choice_v1(p_run_id uuid, p_actor_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_event private.world_events%rowtype;
  v_run private.world_landlord_runs%rowtype;
  v_correct boolean := null;
  v_first boolean := false;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_mcm_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  if p_actor_id is null
     or p_actor_id not in ('ZUE-MG-001', 'ZUE-MG-002', 'ZUE-MG-003', 'ZUE-MG-004', 'ZUE-MG-005') then
    raise exception 'INVALID_ACTOR' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_landlord:' || v_uid::text, 0));

  select * into v_run from private.world_landlord_runs r where r.run_id = p_run_id for update;
  if not found or v_run.user_id <> v_uid then
    raise exception 'RUN_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_run.status = 'ACTIVE' then
    select * into v_event from private.world_events where event_id = v_run.event_id;
    if private.world_event_state_v1(v_event, now()) is distinct from 'ACTIVE' then
      raise exception 'EVENT_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if now() > v_run.deadline_at then
      update private.world_landlord_runs r set status = 'FAILED', ended_at = now()
       where r.run_id = v_run.run_id returning * into v_run;
    elsif p_actor_id = v_run.survivor_actor_id then
      v_correct := true;
      update private.world_landlord_runs r set status = 'CLEARED', ended_at = now()
       where r.run_id = v_run.run_id returning * into v_run;
      insert into private.world_landlord_first_clears (user_id, event_id, run_id)
      values (v_uid, v_run.event_id, v_run.run_id)
      on conflict (user_id, event_id) do nothing;
      v_first := found;
      perform private.world_mcm_try_complete_v1(v_uid);
    else
      v_correct := false;
      update private.world_landlord_runs r
         set wrong_count = r.wrong_count + 1,
             deadline_at = r.deadline_at - interval '5 seconds',
             status = case when r.deadline_at - interval '5 seconds' < now() then 'FAILED' else 'ACTIVE' end,
             ended_at = case when r.deadline_at - interval '5 seconds' < now() then now() end
       where r.run_id = v_run.run_id returning * into v_run;
    end if;
  end if;

  -- A terminal run is reported as it stands: resubmitting never clears it twice.
  return jsonb_build_object(
    'runId', v_run.run_id,
    'status', v_run.status,
    'correct', v_correct,
    'firstClear', v_first,
    'wrongCount', v_run.wrong_count,
    'deadlineAt', v_run.deadline_at,
    'serverNow', now(),
    'firstClearedAt', (select c.first_cleared_at from private.world_landlord_first_clears c
                        where c.user_id = v_uid and c.event_id = v_run.event_id));
end;
$$;


--
-- Name: submit_ranked_recovery_snapshot_v1(uuid, uuid, uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_ranked_recovery_snapshot_v1(p_client_snapshot_id uuid, p_visitor_id uuid, p_session_id uuid, p_reason text, p_ruleset_version text, p_client_version text, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_score integer;
  v_id uuid;
begin
  if p_client_snapshot_id is null then
    return jsonb_build_object('status','invalid_snapshot_id');
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status','invalid_payload');
  end if;

  begin
    v_score := greatest(0, least(4000, coalesce((p_payload->>'score')::integer,0)));
  exception when others then
    return jsonb_build_object('status','invalid_score');
  end;

  insert into public.ranked_recovery_records(
    user_id,visitor_id,session_id,record_kind,client_snapshot_id,score,
    best_contract,reason,ruleset_version,client_version,
    validation_status,source,payload
  )
  values(
    v_user_id,p_visitor_id,p_session_id,'full_snapshot',p_client_snapshot_id,v_score,
    left(nullif(p_payload->>'contract',''),32),
    left(coalesce(nullif(p_reason,''),'ranked_session_unavailable'),64),
    left(nullif(p_ruleset_version,''),40),
    left(nullif(p_client_version,''),40),
    'recovered_unverified','ranked_fallback_snapshot',p_payload
  )
  on conflict (client_snapshot_id) where record_kind='full_snapshot' and client_snapshot_id is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.ranked_recovery_records
    where client_snapshot_id=p_client_snapshot_id
      and record_kind='full_snapshot'
    limit 1;
    return jsonb_build_object('status','already_recorded','record_id',v_id);
  end if;

  return jsonb_build_object('status','recorded','record_id',v_id);
end;
$$;


--
-- Name: submit_ranked_recovery_summary_v1(text, integer, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_ranked_recovery_summary_v1(p_incident_key text, p_best_score integer, p_best_contract text, p_local_plays integer, p_client_version text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_eligible public.ranked_recovery_eligibility%rowtype;
  v_existing public.ranked_recovery_records%rowtype;
begin
  if v_user_id is null then
    return jsonb_build_object('status','unauthenticated');
  end if;

  select * into v_eligible
  from public.ranked_recovery_eligibility
  where incident_key=p_incident_key and user_id=v_user_id;

  if not found then
    return jsonb_build_object('status','not_eligible');
  end if;

  select * into v_existing
  from public.ranked_recovery_records
  where incident_key=p_incident_key
    and user_id=v_user_id
    and record_kind='incident_summary'
  limit 1;

  if found then
    return jsonb_build_object(
      'status','already_recorded',
      'record_id',v_existing.id,
      'score',v_existing.score,
      'validation_status',v_existing.validation_status
    );
  end if;

  if coalesce(p_best_score,-1) < 0 or p_best_score > 4000 then
    return jsonb_build_object('status','invalid_score');
  end if;

  if coalesce(p_local_plays,-1) < 0 or p_local_plays > 10000 then
    return jsonb_build_object('status','invalid_plays');
  end if;

  insert into public.ranked_recovery_records(
    incident_key,user_id,record_kind,score,best_contract,local_plays,
    client_version,validation_status,source,payload
  )
  values(
    p_incident_key,v_user_id,'incident_summary',p_best_score,
    left(nullif(p_best_contract,''),32),p_local_plays,
    left(nullif(p_client_version,''),40),'recovered_unverified',
    'local_secret_history',
    jsonb_build_object(
      'failure_count',v_eligible.failure_count,
      'first_failed_at',v_eligible.first_failed_at,
      'last_failed_at',v_eligible.last_failed_at
    )
  )
  returning * into v_existing;

  update public.ranked_recovery_eligibility
  set claimed_at=coalesce(claimed_at,now())
  where incident_key=p_incident_key and user_id=v_user_id;

  return jsonb_build_object(
    'status','recorded',
    'record_id',v_existing.id,
    'score',v_existing.score,
    'validation_status',v_existing.validation_status
  );
end;
$$;


--
-- Name: sync_inha_duck_general_run(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_inha_duck_general_run(p_run_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_game_id uuid;
  v_player_id uuid;
  v_game_session_id uuid;
  v_build_id uuid;
  v_stage_id smallint;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_duration_ms integer;
  v_score integer;
  v_result text;
  v_mode text;
  v_event_count integer;
  v_metadata jsonb;
begin
  if p_run_id is null then
    return;
  end if;

  select
    (array_agg(ge.game_id order by ge.created_at)
      filter (where ge.game_id is not null))[1],
    (array_agg(ge.player_id order by ge.created_at)
      filter (where ge.player_id is not null))[1],
    (array_agg(ge.game_session_id order by ge.created_at)
      filter (where ge.game_session_id is not null))[1],
    (array_agg(ge.build_id order by ge.created_at)
      filter (where ge.build_id is not null))[1],
    (array_agg(ge.stage_id order by ge.created_at)
      filter (where ge.stage_id is not null))[1],
    min(ge.created_at) filter (where ge.event_type='stage_attempt'),
    max(ge.created_at) filter (where ge.event_type in ('stage_result','exit_run')),
    count(*)::integer
  into
    v_game_id,
    v_player_id,
    v_game_session_id,
    v_build_id,
    v_stage_id,
    v_started_at,
    v_ended_at,
    v_event_count
  from public.game_events ge
  where ge.run_id = p_run_id
    and ge.event_type in ('stage_attempt','stage_result','exit_run');

  if v_event_count = 0 then
    return;
  end if;

  if v_game_id is null then
    select id
      into v_game_id
    from public.games
    where slug='inha-duck'
    limit 1;
  end if;

  select
    case
      when ge.metadata ? 'duration_ms'
       and (ge.metadata->>'duration_ms') ~ '^[0-9]+$'
      then (ge.metadata->>'duration_ms')::integer
      else null
    end,
    ge.score,
    coalesce(ge.status,
      case when ge.event_type='exit_run' then 'exit' else ge.event_type end),
    coalesce(nullif(ge.metadata->>'run_type',''), 'production'),
    jsonb_strip_nulls(
      jsonb_build_object(
        'projection_source', 'inha_duck_general',
        'stage_id', ge.stage_id,
        'combo', ge.combo,
        'stars', ge.stars,
        'client_version', ge.metadata->>'client_version',
        'balance_version', ge.metadata->>'balance_version',
        'source', ge.metadata->>'source',
        'device', ge.metadata->>'device',
        'exit_state', ge.metadata->>'exit_state',
        'exit_reason', ge.metadata->>'exit_reason',
        'game_metrics', jsonb_strip_nulls(
          jsonb_build_object(
            'annyongi_clicks', ge.metadata->>'annyongi_clicks',
            'indeok_hits', ge.metadata->>'indeok_hits',
            'gold_hits', ge.metadata->>'gold_hits'
          )
        )
      )
    )
  into
    v_duration_ms,
    v_score,
    v_result,
    v_mode,
    v_metadata
  from public.game_events ge
  where ge.run_id = p_run_id
    and ge.event_type in ('stage_result','exit_run')
  order by
    case when ge.event_type='stage_result' then 0 else 1 end,
    ge.created_at desc
  limit 1;

  if not found then
    select
      coalesce(nullif(ge.metadata->>'run_type',''), 'production'),
      jsonb_strip_nulls(
        jsonb_build_object(
          'projection_source', 'inha_duck_general',
          'stage_id', ge.stage_id,
          'client_version', ge.metadata->>'client_version',
          'balance_version', ge.metadata->>'balance_version',
          'source', ge.metadata->>'source',
          'device', ge.metadata->>'device'
        )
      )
    into v_mode, v_metadata
    from public.game_events ge
    where ge.run_id = p_run_id
      and ge.event_type='stage_attempt'
    order by ge.created_at
    limit 1;

    v_result := 'started';
  end if;

  v_metadata :=
    coalesce(v_metadata, '{}'::jsonb)
    || jsonb_build_object('event_count', v_event_count);

  insert into public.runs (
    id,
    game_id,
    player_id,
    game_session_id,
    build_id,
    mode,
    stage_key,
    started_at,
    ended_at,
    duration_ms,
    score,
    result,
    metadata,
    created_at
  )
  values (
    p_run_id,
    v_game_id,
    v_player_id,
    v_game_session_id,
    v_build_id,
    v_mode,
    case when v_stage_id is null then null else 'stage-' || v_stage_id::text end,
    coalesce(v_started_at, (
      select min(created_at)
      from public.game_events
      where run_id=p_run_id
        and event_type in ('stage_attempt','stage_result','exit_run')
    )),
    v_ended_at,
    v_duration_ms,
    v_score,
    v_result,
    v_metadata,
    coalesce(v_started_at, now())
  )
  on conflict (id)
  do update set
    game_id = excluded.game_id,
    player_id = coalesce(excluded.player_id, public.runs.player_id),
    game_session_id = coalesce(excluded.game_session_id, public.runs.game_session_id),
    build_id = coalesce(excluded.build_id, public.runs.build_id),
    mode = excluded.mode,
    stage_key = excluded.stage_key,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_ms = excluded.duration_ms,
    score = excluded.score,
    result = excluded.result,
    metadata = excluded.metadata;
end;
$_$;


--
-- Name: sync_inha_duck_ranked_run(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_inha_duck_ranked_run(p_run_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_game_id uuid;
  v_player_id uuid;
  v_user_id uuid;
begin
  select rs.user_id
    into v_user_id
  from public.ranked_sessions rs
  where rs.run_id = p_run_id;

  if not found then
    return;
  end if;

  select g.id
    into v_game_id
  from public.games g
  where g.slug = 'inha-duck'
  limit 1;

  if v_game_id is null then
    raise exception 'INHA_DUCK_GAME_NOT_REGISTERED';
  end if;

  insert into public.players (
    auth_user_id,
    first_seen_at,
    last_seen_at
  )
  select
    rs.user_id,
    rs.started_at,
    greatest(rs.started_at, coalesce(rs.finished_at, rs.started_at))
  from public.ranked_sessions rs
  where rs.run_id = p_run_id
  on conflict (auth_user_id)
  do update set
    first_seen_at = least(public.players.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.players.last_seen_at, excluded.last_seen_at)
  returning id into v_player_id;

  insert into public.runs (
    id,
    game_id,
    player_id,
    game_session_id,
    build_id,
    mode,
    stage_key,
    started_at,
    ended_at,
    duration_ms,
    score,
    result,
    metadata,
    created_at
  )
  select
    rs.run_id,
    v_game_id,
    v_player_id,
    null,
    null,
    rs.run_type,
    rs.stage_key,
    rs.started_at,
    rs.finished_at,
    rr.duration_ms,
    rr.score,
    coalesce(rr.validation_status, rs.status),
    jsonb_strip_nulls(
      jsonb_build_object(
        'projection_source', 'inha_duck_ranked',
        'client_version', coalesce(rr.client_version, rs.client_version),
        'ruleset_version', rs.ruleset_version,
        'session_status', rs.status,
        'validation_status', rr.validation_status,
        'max_combo', rr.max_combo,
        'suspicious_flag', rr.suspicious_flag,
        'reject_reason', rr.reject_reason,
        'completed_calls', rr.completed_calls,
        'input_count', rr.input_count,
        'reaction_sample_count', rr.reaction_sample_count,
        'ultra_fast_reaction_count', rr.ultra_fast_reaction_count,
        'game_metrics',
          case
            when rr.id is null then null
            else jsonb_strip_nulls(
              jsonb_build_object(
                'annyongi_hits', rr.annyongi_hits,
                'indeoki_hits', rr.indeoki_hits,
                'gold_hits', rr.gold_hits,
                'normal_hits', rr.normal_hits,
                'speedy_hits', rr.speedy_hits,
                'total_hits', rr.total_hits,
                'dragon_calls', rr.dragon_calls,
                'completed_calls', rr.completed_calls,
                'moon_bonus_hits', rr.moon_bonus_hits,
                'flight_hits', rr.flight_hits,
                'combo_bonus', rr.combo_bonus,
                'flight_base_points', rr.flight_base_points,
                'tier1_hits', rr.tier1_hits,
                'tier2_hits', rr.tier2_hits,
                'tier1_ground_award', rr.tier1_ground_award,
                'tier2_ground_award', rr.tier2_ground_award,
                'ascension_bonus', rr.ascension_bonus
              )
            )
          end
      )
    ),
    rs.created_at
  from public.ranked_sessions rs
  left join public.ranked_runs rr
    on rr.run_id = rs.run_id
  where rs.run_id = p_run_id
  on conflict (id)
  do update set
    game_id = excluded.game_id,
    player_id = coalesce(excluded.player_id, public.runs.player_id),
    mode = excluded.mode,
    stage_key = excluded.stage_key,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_ms = excluded.duration_ms,
    score = excluded.score,
    result = excluded.result,
    metadata = excluded.metadata;
end;
$$;


--
-- Name: touch_inha_duck_ops_refresh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_inha_duck_ops_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.inha_duck_ops_refresh
  set seq = seq + 1,
      updated_at = now()
  where id = 1;
  return coalesce(new, old);
end;
$$;


--
-- Name: touch_inhagame_member_activity_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_inhagame_member_activity_v1(p_surface text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_date date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null or not exists (
    select 1 from auth.users u
    where u.id = v_uid and coalesce(u.is_anonymous,false)=false
  ) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;

  if p_surface not in ('hub','world','classic','induckup','survival','induck-grow') then
    raise exception 'INVALID_ACTIVITY_SURFACE' using errcode='22023';
  end if;

  insert into private.inhagame_member_activity_daily(
    user_id, activity_date_kst, first_seen_at, last_seen_at, surfaces
  )
  values(v_uid, v_date, now(), now(), array[p_surface])
  on conflict (user_id, activity_date_kst) do update set
    first_seen_at = least(private.inhagame_member_activity_daily.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(private.inhagame_member_activity_daily.last_seen_at, excluded.last_seen_at),
    surfaces = array(
      select distinct x
      from unnest(private.inhagame_member_activity_daily.surfaces || excluded.surfaces) as x
      order by x
    );
end;
$$;


--
-- Name: touch_world_online_session_v1(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_world_online_session_v1(p_session_id uuid, p_place_zone_id text DEFAULT NULL::text, p_space text DEFAULT 'campus'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_session_id is null then
    raise exception 'SESSION_ID_REQUIRED' using errcode = '22023';
  end if;
  if p_place_zone_id is not null and p_place_zone_id !~ '^AREA_[A-Z0-9_]{1,60}$' then
    raise exception 'INVALID_PLACE_ZONE' using errcode = '22023';
  end if;
  if p_space not in ('lobby','campus','club_room','housing_lobby','personal_room') then
    raise exception 'INVALID_SPACE' using errcode = '22023';
  end if;

  delete from public.world_online_sessions
   where last_seen_at < now() - interval '1 day';

  insert into public.world_online_sessions(
    session_id, user_id, place_zone_id, space, started_at, last_seen_at
  )
  values(
    p_session_id, v_uid, p_place_zone_id, p_space, now(), now()
  )
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    place_zone_id = excluded.place_zone_id,
    space = excluded.space,
    last_seen_at = excluded.last_seen_at;
end;
$_$;


--
-- Name: touch_world_online_session_v2(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid DEFAULT NULL::uuid, p_place_zone_id text DEFAULT NULL::text, p_space text DEFAULT 'campus'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_session_id is null then
    raise exception 'SESSION_ID_REQUIRED' using errcode = '22023';
  end if;
  if p_place_zone_id is not null and p_place_zone_id !~ '^AREA_[A-Z0-9_]{1,60}$' then
    raise exception 'INVALID_PLACE_ZONE' using errcode = '22023';
  end if;
  if p_space not in ('lobby','campus','club_room','housing_lobby','personal_room') then
    raise exception 'INVALID_SPACE' using errcode = '22023';
  end if;

  delete from public.world_online_sessions
   where last_seen_at < now() - interval '1 day';

  insert into public.world_online_sessions(
    session_id, user_id, visitor_id, place_zone_id, space, started_at, last_seen_at
  )
  values(
    p_session_id, v_uid, p_visitor_id, p_place_zone_id, p_space, now(), now()
  )
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    visitor_id = coalesce(excluded.visitor_id, public.world_online_sessions.visitor_id),
    place_zone_id = excluded.place_zone_id,
    space = excluded.space,
    last_seen_at = excluded.last_seen_at;
end;
$_$;


--
-- Name: FUNCTION touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid, p_place_zone_id text, p_space text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid, p_place_zone_id text, p_space text) IS 'World population heartbeat v2. Adds best-effort persistent browser visitor UUID while auth uid remains server-derived.';


--
-- Name: trg_sync_inha_duck_general_run(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_inha_duck_general_run() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.sync_inha_duck_general_run(new.run_id);
  return new;
end;
$$;


--
-- Name: trg_sync_inha_duck_ranked_result(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_inha_duck_ranked_result() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.sync_inha_duck_ranked_run(new.run_id);
  return new;
end;
$$;


--
-- Name: trg_sync_inha_duck_ranked_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_inha_duck_ranked_session() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.sync_inha_duck_ranked_run(new.run_id);
  return new;
end;
$$;


--
-- Name: unblock_world_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unblock_world_user(p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_caller uuid := private.world_social_caller();
begin
  if p_target is null or p_target = v_caller then raise exception 'TARGET_UNAVAILABLE' using errcode = '22023'; end if;
  perform private.world_lock_pair(v_caller, p_target);
  -- Only the caller's own block can be removed; the friendship is not restored.
  delete from public.world_user_blocks b where b.blocker_id = v_caller and b.blocked_id = p_target;
  return jsonb_build_object('userId', p_target, 'relationship', private.world_relationship(v_caller, p_target));
end;
$$;


--
-- Name: unequip_my_world_item_v1(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unequip_my_world_item_v1(p_slot text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := private.world_appearance_caller_v1();
  v_tx private.world_appearance_transactions;
  v_previous text;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_appearance_slot_ok_v1(p_slot) then
    raise exception 'INVALID_APPEARANCE_SLOT' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_appearance:' || v_uid::text, 0));

  select * into v_tx from private.world_appearance_transactions where idempotency_key = p_idempotency_key;
  if found then
    if v_tx.user_id = v_uid and v_tx.action = 'UNEQUIP' and v_tx.slot = p_slot then
      return private.world_appearance_result_v1(v_tx, true);
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;

  select l.item_id into v_previous from private.world_player_appearance_loadout l
   where l.user_id = v_uid and l.slot = p_slot for update;

  v_tx := private.world_appearance_record_v1(v_uid, p_idempotency_key, 'UNEQUIP', p_slot, null, v_previous, null);
  if v_previous is not null then
    delete from private.world_player_appearance_loadout l where l.user_id = v_uid and l.slot = p_slot;
  end if;
  return private.world_appearance_result_v1(v_tx, false);
end;
$_$;


--
-- Name: update_world_guestbook_entry_v2(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_world_guestbook_entry_v2(p_entry_id uuid, p_content text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
  v_content text := btrim(coalesce(p_content, ''));
  v_id uuid;
begin
  if char_length(v_content) < 1 or char_length(v_content) > 150 then
    raise exception 'INVALID_CONTENT' using errcode = '22023';
  end if;

  update public.world_guestbook_entries g
  set content = v_content
  where g.id = p_entry_id
    and g.user_id = v_uid
    and g.is_hidden = false
  returning g.id into v_id;

  if v_id is null then
    raise exception 'ENTRY_UNAVAILABLE' using errcode = '22023';
  end if;

  return private.world_guestbook_entry_json(v_id, v_uid);
end;
$$;


--
-- Name: upsert_world_guestbook_entry_v1(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_world_guestbook_entry_v1(p_content text, p_location_key text DEFAULT 'main_gate'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.world_social_caller();
  v_id uuid;
begin
  select g.id
  into v_id
  from public.world_guestbook_entries g
  where g.user_id = v_uid
    and g.location_key = p_location_key
    and g.is_hidden = false
  order by g.created_at desc, g.id desc
  limit 1;

  if v_id is null then
    return public.create_world_guestbook_entry_v2(p_content, p_location_key);
  end if;

  return public.update_world_guestbook_entry_v2(v_id, p_content);
end;
$$;


--
-- Name: verify_inha_duck_ops_basic_v1(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_inha_duck_ops_basic_v1(p_token text, p_basic_sha256 text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select false;
$$;


--
-- Name: world_exp_grant_v1(uuid, bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_exp_grant_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.world_exp_apply_v1(
    p_user, p_amount, p_source_type, p_source_id, p_idempotency_key);
$$;


--
-- Name: world_inventory_ensure_default_items_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_inventory_ensure_default_items_v1(p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_item text;
  v_results jsonb := '[]'::jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  foreach v_item in array array['head.inha_cap', 'top.inha_basic', 'back.freshman_bag'] loop
    v_results := v_results || jsonb_build_array(private.world_inventory_grant_v1(
      p_user, v_item, 1, 'DEFAULT', 'collection.c1.default',
      'default:' || v_item || ':' || p_user::text, null, null));
  end loop;
  return jsonb_build_object('items', v_results);
end;
$$;


--
-- Name: world_inventory_get_item_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_inventory_get_item_v1(p_user uuid, p_item_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_item private.world_player_items%rowtype;
  v_status text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  select * into v_item from private.world_player_items i
   where i.user_id = p_user and i.item_id = p_item_id;
  if not found then
    return jsonb_build_object('userId', p_user, 'itemId', p_item_id, 'owned', false, 'item', null);
  end if;
  select c.status into v_status from private.world_item_catalog c where c.item_id = p_item_id;
  return jsonb_build_object('userId', p_user, 'itemId', p_item_id, 'owned', true,
    'item', private.world_inventory_item_json_v1(v_item, v_status, true));
end;
$$;


--
-- Name: world_inventory_grant_item_v1(uuid, text, integer, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_inventory_grant_item_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_inventory_grant_v1(
    p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_idempotency_key, p_event_id, p_metadata);
end;
$$;


--
-- Name: world_inventory_has_item_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_inventory_has_item_v1(p_user uuid, p_item_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return exists (select 1 from private.world_player_items i
                  where i.user_id = p_user and i.item_id = p_item_id);
end;
$$;


--
-- Name: world_inventory_list_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_inventory_list_v1(p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return jsonb_build_object('userId', p_user, 'items', coalesce((
    select jsonb_agg(private.world_inventory_item_json_v1(i, c.status, true)
                     order by i.acquired_at desc, i.item_id)
      from private.world_player_items i
      left join private.world_item_catalog c on c.item_id = i.item_id
     where i.user_id = p_user
  ), '[]'::jsonb));
end;
$$;


--
-- Name: world_progression_get_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_progression_get_v1(p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.world_progression_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;
  return private.world_progression_snapshot_v1(p_user);
end;
$$;


--
-- Name: world_reward_get_result_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_reward_get_result_v1(p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  select t.reward_transaction_id into v_id
    from private.world_reward_transactions t where t.idempotency_key = p_idempotency_key;
  if v_id is null then
    return null;
  end if;
  return private.world_reward_result_v1(v_id, true);
end;
$$;


--
-- Name: world_reward_grant_v1(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_reward_grant_v1(p_user, p_reward_id, p_source_type, p_source_id, p_idempotency_key);
end;
$$;


--
-- Name: world_wallet_credit_v1(uuid, text, bigint, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_wallet_credit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('REWARD', 'REFUND', 'ADMIN', 'ADJUSTMENT') then
    raise exception 'INVALID_TRANSACTION_TYPE' using errcode = '22023';
  end if;
  return private.world_wallet_apply_v1(
    p_user, p_currency_id, p_amount, p_type, p_source_type, p_source_id, p_idempotency_key, p_reason);
end;
$$;


--
-- Name: world_wallet_debit_v1(uuid, text, bigint, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_wallet_debit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('PURCHASE', 'ADMIN', 'ADJUSTMENT') then
    raise exception 'INVALID_TRANSACTION_TYPE' using errcode = '22023';
  end if;
  return private.world_wallet_apply_v1(
    p_user, p_currency_id, -p_amount, p_type, p_source_type, p_source_id, p_idempotency_key, p_reason);
end;
$$;


--
-- Name: world_wallet_get_balance_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.world_wallet_get_balance_v1(p_user uuid, p_currency_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_wallet private.world_wallets%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;
  if p_currency_id is null or not exists (
    select 1 from private.world_currencies c where c.currency_id = p_currency_id
  ) then
    raise exception 'INVALID_CURRENCY' using errcode = '22023';
  end if;
  select * into v_wallet
    from private.world_wallets w
   where w.user_id = p_user and w.currency_id = p_currency_id;
  return jsonb_build_object(
    'userId', p_user,
    'currencyId', p_currency_id,
    'balance', coalesce(v_wallet.balance, 0),
    'version', coalesce(v_wallet.version, 0),
    'updatedAt', v_wallet.updated_at);
end;
$$;


--
-- Name: game_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_events (
    id bigint NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    stage_id smallint,
    run_id uuid,
    score integer,
    combo integer,
    stars smallint,
    status text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    game_id uuid,
    player_id uuid,
    game_session_id uuid,
    build_id uuid,
    event_version smallint DEFAULT 1 NOT NULL,
    CONSTRAINT game_events_event_type_check CHECK (((char_length(event_type) >= 1) AND (char_length(event_type) <= 64))),
    CONSTRAINT game_events_stage_id_check CHECK (((stage_id IS NULL) OR ((stage_id >= 1) AND (stage_id <= 4)))),
    CONSTRAINT game_events_stars_check CHECK (((stars IS NULL) OR ((stars >= 0) AND (stars <= 3))))
);


--
-- Name: TABLE game_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.game_events IS 'Operational telemetry for Inha Duck Classic. Trigger-only, no gameplay/rules/UI changes. Starts collecting from migration time; no historical backfill.';


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'prototype'::text NOT NULL,
    released_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT games_status_check CHECK ((status = ANY (ARRAY['prototype'::text, 'testing'::text, 'production'::text, 'paused'::text, 'retired'::text])))
);


--
-- Name: runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runs (
    id uuid NOT NULL,
    game_id uuid NOT NULL,
    player_id uuid,
    game_session_id uuid,
    build_id uuid,
    mode text,
    stage_key text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_ms integer,
    score integer,
    result text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runs_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0)))
);


--
-- Name: player_activity_days; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.player_activity_days WITH (security_invoker='true') AS
 WITH activity AS (
         SELECT ge.game_id,
            ge.player_id,
            ((ge.created_at AT TIME ZONE 'Asia/Seoul'::text))::date AS activity_date
           FROM public.game_events ge
          WHERE ((ge.game_id IS NOT NULL) AND (ge.player_id IS NOT NULL))
        UNION
         SELECT r.game_id,
            r.player_id,
            ((r.started_at AT TIME ZONE 'Asia/Seoul'::text))::date AS activity_date
           FROM public.runs r
          WHERE ((r.game_id IS NOT NULL) AND (r.player_id IS NOT NULL) AND (r.started_at IS NOT NULL))
        )
 SELECT DISTINCT a.game_id,
    g.slug AS game_slug,
    g.name AS game_name,
    a.player_id,
    a.activity_date
   FROM (activity a
     JOIN public.games g ON ((g.id = a.game_id)));


--
-- Name: run_facts; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.run_facts WITH (security_invoker='true') AS
 SELECT r.id AS run_id,
    r.game_id,
    g.slug AS game_slug,
    g.name AS game_name,
    r.player_id,
    r.game_session_id,
    r.build_id,
    r.mode,
    r.stage_key,
    r.started_at,
    r.ended_at,
    ((r.started_at AT TIME ZONE 'Asia/Seoul'::text))::date AS activity_date,
    r.duration_ms,
    r.score,
    r.result,
        CASE
            WHEN (r.result = ANY (ARRAY['clear'::text, 'accepted'::text])) THEN 'success'::text
            WHEN (r.result = ANY (ARRAY['failed'::text, 'rejected'::text])) THEN 'failure'::text
            WHEN (r.result = 'exit'::text) THEN 'exit'::text
            WHEN ((r.result = 'started'::text) OR (r.ended_at IS NULL)) THEN 'open'::text
            ELSE 'other'::text
        END AS outcome_class,
    r.metadata
   FROM (public.runs r
     JOIN public.games g ON ((g.id = r.game_id)));


--
-- Name: daily_funnel_metrics; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.daily_funnel_metrics WITH (security_invoker='true') AS
 WITH activity AS (
         SELECT player_activity_days.game_id,
            player_activity_days.activity_date,
            count(DISTINCT player_activity_days.player_id) AS active_players
           FROM analytics.player_activity_days
          GROUP BY player_activity_days.game_id, player_activity_days.activity_date
        ), session_start AS (
         SELECT game_events.game_id,
            ((game_events.created_at AT TIME ZONE 'Asia/Seoul'::text))::date AS activity_date,
            count(DISTINCT game_events.player_id) AS session_start_players
           FROM public.game_events
          WHERE ((game_events.event_type = 'session_start'::text) AND (game_events.game_id IS NOT NULL) AND (game_events.player_id IS NOT NULL))
          GROUP BY game_events.game_id, (((game_events.created_at AT TIME ZONE 'Asia/Seoul'::text))::date)
        ), run_player_stats AS (
         SELECT run_facts.game_id,
            run_facts.activity_date,
            run_facts.player_id,
            count(*) AS run_count,
            bool_or((run_facts.outcome_class <> 'open'::text)) AS has_terminal_run,
            bool_or((run_facts.outcome_class = 'success'::text)) AS has_success
           FROM analytics.run_facts
          WHERE (run_facts.player_id IS NOT NULL)
          GROUP BY run_facts.game_id, run_facts.activity_date, run_facts.player_id
        ), run_funnel AS (
         SELECT run_player_stats.game_id,
            run_player_stats.activity_date,
            count(*) AS run_start_players,
            count(*) FILTER (WHERE run_player_stats.has_terminal_run) AS terminal_run_players,
            count(*) FILTER (WHERE (run_player_stats.run_count >= 2)) AS repeat_run_players,
            count(*) FILTER (WHERE run_player_stats.has_success) AS success_players
           FROM run_player_stats
          GROUP BY run_player_stats.game_id, run_player_stats.activity_date
        )
 SELECT a.activity_date AS date,
    a.game_id,
    g.slug AS game_slug,
    g.name AS game_name,
    a.active_players,
    COALESCE(ss.session_start_players, (0)::bigint) AS session_start_players,
    COALESCE(rf.run_start_players, (0)::bigint) AS run_start_players,
    COALESCE(rf.terminal_run_players, (0)::bigint) AS terminal_run_players,
    COALESCE(rf.repeat_run_players, (0)::bigint) AS repeat_run_players,
    COALESCE(rf.success_players, (0)::bigint) AS success_players,
        CASE
            WHEN (a.active_players = 0) THEN NULL::numeric
            ELSE round(((COALESCE(rf.run_start_players, (0)::bigint))::numeric / (a.active_players)::numeric), 4)
        END AS active_to_run_rate,
        CASE
            WHEN (COALESCE(rf.run_start_players, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((COALESCE(rf.terminal_run_players, (0)::bigint))::numeric / (rf.run_start_players)::numeric), 4)
        END AS run_to_terminal_rate,
        CASE
            WHEN (COALESCE(rf.run_start_players, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((COALESCE(rf.repeat_run_players, (0)::bigint))::numeric / (rf.run_start_players)::numeric), 4)
        END AS run_to_repeat_rate,
        CASE
            WHEN (COALESCE(rf.run_start_players, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((COALESCE(rf.success_players, (0)::bigint))::numeric / (rf.run_start_players)::numeric), 4)
        END AS run_to_success_rate
   FROM (((activity a
     JOIN public.games g ON ((g.id = a.game_id)))
     LEFT JOIN session_start ss ON (((ss.game_id = a.game_id) AND (ss.activity_date = a.activity_date))))
     LEFT JOIN run_funnel rf ON (((rf.game_id = a.game_id) AND (rf.activity_date = a.activity_date))));


--
-- Name: game_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    player_id uuid,
    build_id uuid,
    client_session_id uuid NOT NULL,
    source text,
    device text,
    platform text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: daily_game_metrics; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.daily_game_metrics WITH (security_invoker='true') AS
 WITH dates AS (
         SELECT DISTINCT player_activity_days.game_id,
            player_activity_days.activity_date
           FROM analytics.player_activity_days
        ), player_daily AS (
         SELECT player_activity_days.game_id,
            player_activity_days.activity_date,
            count(DISTINCT player_activity_days.player_id) AS active_players
           FROM analytics.player_activity_days
          GROUP BY player_activity_days.game_id, player_activity_days.activity_date
        ), first_seen AS (
         SELECT player_activity_days.game_id,
            player_activity_days.player_id,
            min(player_activity_days.activity_date) AS first_activity_date
           FROM analytics.player_activity_days
          GROUP BY player_activity_days.game_id, player_activity_days.player_id
        ), new_daily AS (
         SELECT first_seen.game_id,
            first_seen.first_activity_date AS activity_date,
            count(*) AS new_players
           FROM first_seen
          GROUP BY first_seen.game_id, first_seen.first_activity_date
        ), run_daily AS (
         SELECT run_facts.game_id,
            run_facts.activity_date,
            count(*) AS runs,
            count(*) FILTER (WHERE (run_facts.outcome_class = 'success'::text)) AS successful_runs,
            count(*) FILTER (WHERE (run_facts.outcome_class = 'failure'::text)) AS failed_runs,
            count(*) FILTER (WHERE (run_facts.outcome_class = 'exit'::text)) AS exited_runs,
            count(*) FILTER (WHERE (run_facts.outcome_class = 'open'::text)) AS open_runs,
            count(DISTINCT run_facts.player_id) FILTER (WHERE (run_facts.player_id IS NOT NULL)) AS run_players,
            round((avg(run_facts.duration_ms) FILTER (WHERE (run_facts.duration_ms IS NOT NULL)) / 1000.0), 2) AS avg_run_duration_sec,
            round(avg(run_facts.score) FILTER (WHERE (run_facts.score IS NOT NULL)), 2) AS avg_score
           FROM analytics.run_facts
          GROUP BY run_facts.game_id, run_facts.activity_date
        ), run_repeat AS (
         SELECT x.game_id,
            x.activity_date,
            count(*) FILTER (WHERE (x.daily_runs >= 2)) AS repeat_run_players
           FROM ( SELECT run_facts.game_id,
                    run_facts.activity_date,
                    run_facts.player_id,
                    count(*) AS daily_runs
                   FROM analytics.run_facts
                  WHERE (run_facts.player_id IS NOT NULL)
                  GROUP BY run_facts.game_id, run_facts.activity_date, run_facts.player_id) x
          GROUP BY x.game_id, x.activity_date
        ), session_daily AS (
         SELECT game_sessions.game_id,
            ((game_sessions.started_at AT TIME ZONE 'Asia/Seoul'::text))::date AS activity_date,
            count(*) AS sessions,
            count(*) FILTER (WHERE (game_sessions.ended_at IS NOT NULL)) AS closed_sessions,
            round(avg(EXTRACT(epoch FROM (game_sessions.ended_at - game_sessions.started_at))) FILTER (WHERE ((game_sessions.ended_at IS NOT NULL) AND (game_sessions.ended_at >= game_sessions.started_at))), 2) AS avg_closed_session_duration_sec
           FROM public.game_sessions
          GROUP BY game_sessions.game_id, (((game_sessions.started_at AT TIME ZONE 'Asia/Seoul'::text))::date)
        )
 SELECT d.activity_date AS date,
    d.game_id,
    g.slug AS game_slug,
    g.name AS game_name,
    COALESCE(pd.active_players, (0)::bigint) AS active_players,
    COALESCE(nd.new_players, (0)::bigint) AS new_players,
    COALESCE(sd.sessions, (0)::bigint) AS sessions,
    COALESCE(sd.closed_sessions, (0)::bigint) AS closed_sessions,
    sd.avg_closed_session_duration_sec,
    COALESCE(rd.runs, (0)::bigint) AS runs,
    COALESCE(rd.successful_runs, (0)::bigint) AS successful_runs,
    COALESCE(rd.failed_runs, (0)::bigint) AS failed_runs,
    COALESCE(rd.exited_runs, (0)::bigint) AS exited_runs,
    COALESCE(rd.open_runs, (0)::bigint) AS open_runs,
    COALESCE(rd.run_players, (0)::bigint) AS run_players,
    COALESCE(rr.repeat_run_players, (0)::bigint) AS repeat_run_players,
    rd.avg_run_duration_sec,
    rd.avg_score,
        CASE
            WHEN (COALESCE(rd.run_players, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((COALESCE(rr.repeat_run_players, (0)::bigint))::numeric / (rd.run_players)::numeric), 4)
        END AS repeat_player_rate
   FROM ((((((dates d
     JOIN public.games g ON ((g.id = d.game_id)))
     LEFT JOIN player_daily pd ON (((pd.game_id = d.game_id) AND (pd.activity_date = d.activity_date))))
     LEFT JOIN new_daily nd ON (((nd.game_id = d.game_id) AND (nd.activity_date = d.activity_date))))
     LEFT JOIN run_daily rd ON (((rd.game_id = d.game_id) AND (rd.activity_date = d.activity_date))))
     LEFT JOIN run_repeat rr ON (((rr.game_id = d.game_id) AND (rr.activity_date = d.activity_date))))
     LEFT JOIN session_daily sd ON (((sd.game_id = d.game_id) AND (sd.activity_date = d.activity_date))));


--
-- Name: ops_event_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_event_mappings (
    game_id uuid NOT NULL,
    raw_event_type text NOT NULL,
    canonical_event text NOT NULL,
    metric_role text DEFAULT 'primary'::text NOT NULL,
    mapping_version smallint DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_event_mappings_mapping_version_check CHECK ((mapping_version >= 1)),
    CONSTRAINT ops_event_mappings_metric_role_check CHECK ((metric_role = ANY (ARRAY['primary'::text, 'supporting'::text, 'diagnostic'::text])))
);


--
-- Name: event_contract_coverage_v1; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.event_contract_coverage_v1 WITH (security_invoker='true') AS
 SELECT g.slug AS game_slug,
    count(*) AS events_total,
    count(*) FILTER (WHERE (m.canonical_event IS NOT NULL)) AS events_mapped,
    count(*) FILTER (WHERE (m.canonical_event IS NULL)) AS events_unmapped,
    round(((100.0 * (count(*) FILTER (WHERE (m.canonical_event IS NOT NULL)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS coverage_pct,
    (count(DISTINCT ge.event_type))::integer AS raw_event_types,
    (count(DISTINCT ge.event_type) FILTER (WHERE (m.canonical_event IS NULL)))::integer AS unmapped_event_types
   FROM ((public.game_events ge
     JOIN public.games g ON ((g.id = ge.game_id)))
     LEFT JOIN public.ops_event_mappings m ON (((m.game_id = ge.game_id) AND (m.raw_event_type = ge.event_type))))
  GROUP BY g.slug;


--
-- Name: ops_event_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_event_contracts (
    canonical_event text NOT NULL,
    category text NOT NULL,
    lifecycle_signal text DEFAULT 'none'::text NOT NULL,
    run_scoped boolean DEFAULT false NOT NULL,
    terminal_signal boolean DEFAULT false NOT NULL,
    contract_version smallint DEFAULT 1 NOT NULL,
    required_context jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_event_contracts_category_check CHECK ((category = ANY (ARRAY['session'::text, 'run'::text, 'progression'::text, 'choice'::text, 'reward'::text, 'failure'::text, 'record'::text, 'ui'::text, 'error'::text, 'recovery'::text]))),
    CONSTRAINT ops_event_contracts_contract_version_check CHECK ((contract_version >= 1)),
    CONSTRAINT ops_event_contracts_lifecycle_signal_check CHECK ((lifecycle_signal = ANY (ARRAY['none'::text, 'session_start'::text, 'session_end'::text, 'run_start'::text, 'run_result'::text, 'exit_signal'::text, 'validation_submit'::text, 'validation_accept'::text, 'validation_reject'::text])))
);


--
-- Name: normalized_game_events_v1; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.normalized_game_events_v1 WITH (security_invoker='true') AS
 SELECT ge.id,
    ge.game_id,
    g.slug AS game_slug,
    ge.player_id,
    ge.game_session_id,
    ge.build_id,
    ge.run_id,
    ge.event_type AS raw_event_type,
    COALESCE(m.canonical_event, 'unmapped'::text) AS canonical_event,
    COALESCE(c.category, 'unmapped'::text) AS category,
    COALESCE(c.lifecycle_signal, 'none'::text) AS lifecycle_signal,
    COALESCE(m.metric_role, 'diagnostic'::text) AS metric_role,
    ge.event_version,
    ge.stage_id,
    ge.score,
    ge.combo,
    ge.stars,
    ge.status,
    ge.metadata,
    ge.created_at
   FROM (((public.game_events ge
     JOIN public.games g ON ((g.id = ge.game_id)))
     LEFT JOIN public.ops_event_mappings m ON (((m.game_id = ge.game_id) AND (m.raw_event_type = ge.event_type))))
     LEFT JOIN public.ops_event_contracts c ON ((c.canonical_event = m.canonical_event)));


--
-- Name: retention_cohorts; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.retention_cohorts WITH (security_invoker='true') AS
 WITH activity AS (
         SELECT player_activity_days.game_id,
            player_activity_days.player_id,
            player_activity_days.activity_date
           FROM analytics.player_activity_days
        ), cohorts AS (
         SELECT activity.game_id,
            activity.player_id,
            min(activity.activity_date) AS cohort_date
           FROM activity
          GROUP BY activity.game_id, activity.player_id
        ), cohort_sizes AS (
         SELECT cohorts.game_id,
            cohorts.cohort_date,
            count(*) AS cohort_size
           FROM cohorts
          GROUP BY cohorts.game_id, cohorts.cohort_date
        ), returns AS (
         SELECT c.game_id,
            c.cohort_date,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM activity a
                  WHERE ((a.game_id = c.game_id) AND (a.player_id = c.player_id) AND (a.activity_date = (c.cohort_date + 1)))))) AS d1_returners,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM activity a
                  WHERE ((a.game_id = c.game_id) AND (a.player_id = c.player_id) AND (a.activity_date = (c.cohort_date + 3)))))) AS d3_returners,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM activity a
                  WHERE ((a.game_id = c.game_id) AND (a.player_id = c.player_id) AND (a.activity_date = (c.cohort_date + 7)))))) AS d7_returners,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM activity a
                  WHERE ((a.game_id = c.game_id) AND (a.player_id = c.player_id) AND (a.activity_date = (c.cohort_date + 14)))))) AS d14_returners,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM activity a
                  WHERE ((a.game_id = c.game_id) AND (a.player_id = c.player_id) AND (a.activity_date = (c.cohort_date + 30)))))) AS d30_returners
           FROM cohorts c
          GROUP BY c.game_id, c.cohort_date
        ), clock AS (
         SELECT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date AS today_kst
        )
 SELECT cs.cohort_date,
    cs.game_id,
    g.slug AS game_slug,
    g.name AS game_name,
    cs.cohort_size,
        CASE
            WHEN (clock.today_kst >= (cs.cohort_date + 1)) THEN r.d1_returners
            ELSE NULL::bigint
        END AS d1_returners,
        CASE
            WHEN (clock.today_kst >= (cs.cohort_date + 3)) THEN r.d3_returners
            ELSE NULL::bigint
        END AS d3_returners,
        CASE
            WHEN (clock.today_kst >= (cs.cohort_date + 7)) THEN r.d7_returners
            ELSE NULL::bigint
        END AS d7_returners,
        CASE
            WHEN (clock.today_kst >= (cs.cohort_date + 14)) THEN r.d14_returners
            ELSE NULL::bigint
        END AS d14_returners,
        CASE
            WHEN (clock.today_kst >= (cs.cohort_date + 30)) THEN r.d30_returners
            ELSE NULL::bigint
        END AS d30_returners,
        CASE
            WHEN (clock.today_kst < (cs.cohort_date + 1)) THEN NULL::numeric
            ELSE round(((r.d1_returners)::numeric / (cs.cohort_size)::numeric), 4)
        END AS d1_retention,
        CASE
            WHEN (clock.today_kst < (cs.cohort_date + 3)) THEN NULL::numeric
            ELSE round(((r.d3_returners)::numeric / (cs.cohort_size)::numeric), 4)
        END AS d3_retention,
        CASE
            WHEN (clock.today_kst < (cs.cohort_date + 7)) THEN NULL::numeric
            ELSE round(((r.d7_returners)::numeric / (cs.cohort_size)::numeric), 4)
        END AS d7_retention,
        CASE
            WHEN (clock.today_kst < (cs.cohort_date + 14)) THEN NULL::numeric
            ELSE round(((r.d14_returners)::numeric / (cs.cohort_size)::numeric), 4)
        END AS d14_retention,
        CASE
            WHEN (clock.today_kst < (cs.cohort_date + 30)) THEN NULL::numeric
            ELSE round(((r.d30_returners)::numeric / (cs.cohort_size)::numeric), 4)
        END AS d30_retention
   FROM (((cohort_sizes cs
     JOIN returns r ON (((r.game_id = cs.game_id) AND (r.cohort_date = cs.cohort_date))))
     JOIN public.games g ON ((g.id = cs.game_id)))
     CROSS JOIN clock);


--
-- Name: inhagame_member_activity_daily; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.inhagame_member_activity_daily (
    user_id uuid NOT NULL,
    activity_date_kst date NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    surfaces text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT inhagame_member_activity_surfaces_check CHECK ((cardinality(surfaces) <= 6))
);


--
-- Name: world_attendance_days; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_attendance_days (
    user_id uuid NOT NULL,
    attendance_date date NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    daily_reward_transaction_id uuid NOT NULL,
    milestone smallint,
    milestone_reward_transaction_id uuid,
    CONSTRAINT world_attendance_days_milestone_check CHECK (((milestone IS NULL) OR (milestone = ANY (ARRAY[3, 7, 14, 21])))),
    CONSTRAINT world_attendance_days_milestone_tx CHECK (((milestone IS NULL) = (milestone_reward_transaction_id IS NULL)))
);


--
-- Name: TABLE world_attendance_days; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_attendance_days IS 'Campus Attendance (P1f): one explicit claim per account per Asia/Seoul day. Monthly count = rows in the KST month.';


--
-- Name: world_biryong_progress_v1; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_biryong_progress_v1 (
    user_id uuid NOT NULL,
    discovered_at timestamp with time zone,
    step text DEFAULT 'INTRO'::text NOT NULL,
    lore text[] DEFAULT '{}'::text[] NOT NULL,
    shouts integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    migrated_from_local boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_biryong_complete_time CHECK (((step = 'COMPLETE'::text) = (completed_at IS NOT NULL))),
    CONSTRAINT world_biryong_progress_v1_shouts_check CHECK ((shouts >= 0)),
    CONSTRAINT world_biryong_progress_v1_step_check CHECK ((step = ANY (ARRAY['INTRO'::text, 'FIND_CENTER'::text, 'SHOUT'::text, 'REACTION'::text, 'COMPLETE'::text])))
);


--
-- Name: world_currencies; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_currencies (
    currency_id text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_currencies_currency_id_check CHECK ((currency_id ~ '^currency\.[a-z][a-z0-9_]{0,47}$'::text)),
    CONSTRAINT world_currencies_display_name_check CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 40)))
);


--
-- Name: TABLE world_currencies; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_currencies IS 'INHA WORLD economy currency registry. P0-A: currency.induck_coin (인덕코인) only.';


--
-- Name: world_daily_quiz_answers; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_daily_quiz_answers (
    run_id uuid NOT NULL,
    question_index smallint NOT NULL,
    question_id text NOT NULL,
    selected_index smallint NOT NULL,
    correct boolean NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_daily_quiz_answers_question_index_check CHECK (((question_index >= 0) AND (question_index <= 2))),
    CONSTRAINT world_daily_quiz_answers_selected_index_check CHECK (((selected_index >= 0) AND (selected_index <= 3)))
);


--
-- Name: world_daily_quiz_questions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_daily_quiz_questions (
    question_id text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "position" integer NOT NULL,
    category text NOT NULL,
    prompt text NOT NULL,
    options jsonb NOT NULL,
    correct_index smallint NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_daily_quiz_questions_category_check CHECK ((category ~ '^[a-z][a-z0-9_]{0,31}$'::text)),
    CONSTRAINT world_daily_quiz_questions_correct_index_check CHECK (((correct_index >= 0) AND (correct_index <= 3))),
    CONSTRAINT world_daily_quiz_questions_options_check CHECK (((jsonb_typeof(options) = 'array'::text) AND (jsonb_array_length(options) = 4) AND (jsonb_typeof((options -> 0)) = 'string'::text) AND (jsonb_typeof((options -> 1)) = 'string'::text) AND (jsonb_typeof((options -> 2)) = 'string'::text) AND (jsonb_typeof((options -> 3)) = 'string'::text))),
    CONSTRAINT world_daily_quiz_questions_position_check CHECK (("position" >= 1)),
    CONSTRAINT world_daily_quiz_questions_prompt_check CHECK (((char_length(prompt) >= 4) AND (char_length(prompt) <= 200))),
    CONSTRAINT world_daily_quiz_questions_question_id_check CHECK ((question_id ~ '^quiz\.campus\.[a-z0-9_]{1,60}$'::text)),
    CONSTRAINT world_daily_quiz_questions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text]))),
    CONSTRAINT world_daily_quiz_questions_version_check CHECK ((version >= 1))
);


--
-- Name: TABLE world_daily_quiz_questions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_daily_quiz_questions IS 'Campus Daily Quiz question bank. Private: correct_index is only read by the answer RPC.';


--
-- Name: world_daily_quiz_runs; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_daily_quiz_runs (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reward_date date NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    question_ids text[] NOT NULL,
    answered_count smallint DEFAULT 0 NOT NULL,
    correct_count smallint DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    reward_transaction_id uuid,
    CONSTRAINT world_daily_quiz_runs_answered_count_check CHECK (((answered_count >= 0) AND (answered_count <= 3))),
    CONSTRAINT world_daily_quiz_runs_check CHECK (((correct_count >= 0) AND (correct_count <= answered_count))),
    CONSTRAINT world_daily_quiz_runs_final CHECK ((((status = 'ACTIVE'::text) AND (answered_count < 3) AND (completed_at IS NULL) AND (reward_transaction_id IS NULL)) OR ((status = 'PASSED'::text) AND (answered_count = 3) AND (correct_count >= 2) AND (completed_at IS NOT NULL) AND (reward_transaction_id IS NOT NULL)) OR ((status = 'FAILED'::text) AND (answered_count = 3) AND (correct_count < 2) AND (completed_at IS NOT NULL) AND (reward_transaction_id IS NULL)))),
    CONSTRAINT world_daily_quiz_runs_question_ids_check CHECK ((cardinality(question_ids) = 3)),
    CONSTRAINT world_daily_quiz_runs_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PASSED'::text, 'FAILED'::text])))
);


--
-- Name: TABLE world_daily_quiz_runs; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_daily_quiz_runs IS 'Campus Daily Quiz sessions: one per (user, Asia/Seoul reward_date). PASSED always carries its reward.';


--
-- Name: world_event_progress; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_event_progress (
    user_id uuid NOT NULL,
    event_id text NOT NULL,
    stage smallint NOT NULL,
    investigated text[] DEFAULT '{}'::text[] NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    venue_unlocked_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT world_event_progress_completed CHECK (((stage = 3) = (completed_at IS NOT NULL))),
    CONSTRAINT world_event_progress_event_id_check CHECK ((event_id = 'event.mcm_2026'::text)),
    CONSTRAINT world_event_progress_investigated_check CHECK ((investigated <@ ARRAY['staggering'::text, 'dancing'::text, 'hungry'::text])),
    CONSTRAINT world_event_progress_stage_check CHECK (((stage >= 1) AND (stage <= 3))),
    CONSTRAINT world_event_progress_venue CHECK (((stage >= 2) = (venue_unlocked_at IS NOT NULL))),
    CONSTRAINT world_event_progress_venue_needs_all CHECK (((stage < 2) OR (investigated @> ARRAY['staggering'::text, 'dancing'::text, 'hungry'::text])))
);


--
-- Name: TABLE world_event_progress; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_event_progress IS 'MCM 2026 account progress. Written only by the service-role advance RPC and the server-judged landlord run.';


--
-- Name: world_guestbook_post_log; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_guestbook_post_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    user_id uuid NOT NULL,
    location_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: world_item_catalog; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_item_catalog (
    item_id text NOT NULL,
    category text NOT NULL,
    ownership_policy text NOT NULL,
    max_stack integer,
    status text NOT NULL,
    CONSTRAINT world_item_catalog_category_check CHECK ((category = ANY (ARRAY['WEARABLE'::text, 'BADGE'::text, 'EMOTE'::text, 'FURNITURE'::text, 'MOUNT'::text, 'MOUNT_COSMETIC'::text, 'MEMORABILIA'::text]))),
    CONSTRAINT world_item_catalog_item_id_check CHECK (((item_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text) AND (char_length(item_id) <= 80))),
    CONSTRAINT world_item_catalog_ownership_policy_check CHECK ((ownership_policy = ANY (ARRAY['UNIQUE'::text, 'STACKABLE'::text]))),
    CONSTRAINT world_item_catalog_stack_policy CHECK ((((ownership_policy = 'UNIQUE'::text) AND (max_stack IS NULL)) OR ((ownership_policy = 'STACKABLE'::text) AND (max_stack >= 2)))),
    CONSTRAINT world_item_catalog_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'LOCKED'::text, 'COMING_SOON'::text, 'DISABLED'::text, 'HIDDEN'::text])))
);


--
-- Name: TABLE world_item_catalog; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_item_catalog IS 'Grant-authority mirror of the C0 code catalog (apps/world/src/collection/item-catalog.js). Never owns prices.';


--
-- Name: world_landlord_first_clears; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_landlord_first_clears (
    user_id uuid NOT NULL,
    event_id text NOT NULL,
    run_id uuid NOT NULL,
    first_cleared_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE world_landlord_first_clears; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_landlord_first_clears IS 'The first server-judged landlord clear per account (source for reward.minigame.landlord_first_clear).';


--
-- Name: world_landlord_runs; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_landlord_runs (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_id text NOT NULL,
    status text NOT NULL,
    survivor_actor_id text NOT NULL,
    wrong_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    deadline_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT world_landlord_runs_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'CLEARED'::text, 'FAILED'::text]))),
    CONSTRAINT world_landlord_runs_survivor_actor_id_check CHECK ((survivor_actor_id = ANY (ARRAY['ZUE-MG-001'::text, 'ZUE-MG-002'::text, 'ZUE-MG-003'::text, 'ZUE-MG-004'::text, 'ZUE-MG-005'::text]))),
    CONSTRAINT world_landlord_runs_terminal CHECK (((status = 'ACTIVE'::text) = (ended_at IS NULL))),
    CONSTRAINT world_landlord_runs_wrong_count_check CHECK ((wrong_count >= 0))
);


--
-- Name: TABLE world_landlord_runs; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_landlord_runs IS 'Server-issued landlord minigame runs. The survivor, deadline and verdict are server-owned.';


--
-- Name: world_level_thresholds; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_level_thresholds (
    level integer NOT NULL,
    min_total_exp bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_level_thresholds_level1_zero CHECK (((level <> 1) OR (min_total_exp = 0))),
    CONSTRAINT world_level_thresholds_level_check CHECK ((level >= 1)),
    CONSTRAINT world_level_thresholds_min_total_exp_check CHECK ((min_total_exp >= 0))
);


--
-- Name: TABLE world_level_thresholds; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_level_thresholds IS 'INHA WORLD level thresholds. Existing rows are immutable; future migrations append the next level only.';


--
-- Name: world_mcm_reward_claims; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_mcm_reward_claims (
    user_id uuid NOT NULL,
    claim_type text NOT NULL,
    event_id text NOT NULL,
    reward_id text NOT NULL,
    idempotency_key text NOT NULL,
    reward_transaction_id uuid NOT NULL,
    reward_status text NOT NULL,
    source_completed_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_mcm_reward_claims_claim_type_check CHECK ((claim_type = ANY (ARRAY['MAIN_CLEAR'::text, 'LANDLORD_FIRST_CLEAR'::text]))),
    CONSTRAINT world_mcm_reward_claims_reward_status_check CHECK ((reward_status = ANY (ARRAY['SUCCESS'::text, 'PARTIAL_SUCCESS'::text])))
);


--
-- Name: TABLE world_mcm_reward_claims; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_mcm_reward_claims IS 'MCM 2026 final reward claims (COMPLETED ≠ CLAIMED). Written once by the claim RPCs; never updated.';


--
-- Name: world_npc_ai_daily_calls; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_npc_ai_daily_calls (
    usage_day date NOT NULL,
    scope text NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    CONSTRAINT world_npc_ai_daily_calls_calls_check CHECK ((calls >= 0))
);


--
-- Name: world_npc_shared_ticks_v1; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_npc_shared_ticks_v1 (
    tick bigint NOT NULL,
    period text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    effective_at_ms bigint NOT NULL,
    tick_ms integer DEFAULT 60000 NOT NULL,
    decisions jsonb,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_at timestamp with time zone,
    CONSTRAINT world_npc_shared_ticks_v1_effective_at_ms_check CHECK ((effective_at_ms >= 0)),
    CONSTRAINT world_npc_shared_ticks_v1_period_check CHECK ((period = ANY (ARRAY['morning'::text, 'class_time'::text, 'lunch'::text, 'evening'::text]))),
    CONSTRAINT world_npc_shared_ticks_v1_state_check CHECK ((((status = 'pending'::text) AND (decisions IS NULL) AND (committed_at IS NULL)) OR ((status = 'committed'::text) AND (jsonb_typeof(decisions) = 'object'::text) AND (committed_at IS NOT NULL)))),
    CONSTRAINT world_npc_shared_ticks_v1_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'committed'::text]))),
    CONSTRAINT world_npc_shared_ticks_v1_tick_check CHECK ((tick >= 0)),
    CONSTRAINT world_npc_shared_ticks_v1_tick_ms_check CHECK (((tick_ms >= 10000) AND (tick_ms <= 300000)))
);


--
-- Name: world_player_appearance_loadout; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_player_appearance_loadout (
    user_id uuid NOT NULL,
    slot text NOT NULL,
    item_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_player_appearance_loadout_item_id_check CHECK (((item_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text) AND (char_length(item_id) <= 80))),
    CONSTRAINT world_player_appearance_loadout_slot_check CHECK ((slot = ANY (ARRAY['BODY'::text, 'FACE'::text, 'HAIR'::text, 'HEAD'::text, 'TOP'::text, 'BOTTOM'::text, 'SHOES'::text, 'BACK'::text, 'ACCESSORY'::text]))),
    CONSTRAINT world_player_appearance_loadout_slot_prefix CHECK ((slot = upper(split_part(item_id, '.'::text, 1))))
);


--
-- Name: TABLE world_player_appearance_loadout; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_player_appearance_loadout IS 'INHA WORLD current appearance loadout: which owned itemId fills each appearance slot. No metadata, no Level.';


--
-- Name: world_player_progression; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_player_progression (
    user_id uuid NOT NULL,
    total_exp bigint DEFAULT 0 NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_player_progression_total_exp_check CHECK ((total_exp >= 0)),
    CONSTRAINT world_player_progression_version_check CHECK ((version >= 0))
);


--
-- Name: TABLE world_player_progression; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_player_progression IS 'INHA WORLD total EXP projection. Level is never stored here; it is derived from world_level_thresholds.';


--
-- Name: world_purchase_transactions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_purchase_transactions (
    purchase_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id text NOT NULL,
    listing_id text NOT NULL,
    item_id text NOT NULL,
    quantity integer NOT NULL,
    currency_id text NOT NULL,
    price bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    wallet_transaction_id uuid NOT NULL,
    inventory_grant_id text NOT NULL,
    idempotency_key text NOT NULL,
    status text DEFAULT 'COMPLETED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_purchase_transactions_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT world_purchase_transactions_balance_before_check CHECK ((balance_before >= 0)),
    CONSTRAINT world_purchase_transactions_idempotency_key_check CHECK ((idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'::text)),
    CONSTRAINT world_purchase_transactions_price_check CHECK ((price > 0)),
    CONSTRAINT world_purchase_transactions_price_math CHECK ((balance_after = (balance_before - price))),
    CONSTRAINT world_purchase_transactions_quantity_check CHECK ((quantity >= 1)),
    CONSTRAINT world_purchase_transactions_status_check CHECK ((status = 'COMPLETED'::text))
);


--
-- Name: TABLE world_purchase_transactions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_purchase_transactions IS 'INHA WORLD completed purchases. Failed purchases roll back entirely and leave no row.';


--
-- Name: world_quest_progress_v1; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_quest_progress_v1 (
    user_id uuid NOT NULL,
    quest_id text NOT NULL,
    stage smallint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_quest_progress_v1_quest_id_check CHECK ((quest_id = ANY (ARRAY['campus_first_walk_v1'::text, 'campus_navigation_intro_v1'::text]))),
    CONSTRAINT world_quest_progress_v1_stage_check CHECK (((stage >= 1) AND (stage <= 9)))
);


--
-- Name: world_reward_definitions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_reward_definitions (
    reward_id text NOT NULL,
    status text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    event_id text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_reward_definitions_description_check CHECK (((char_length(description) >= 1) AND (char_length(description) <= 200))),
    CONSTRAINT world_reward_definitions_event_id_check CHECK (((event_id IS NULL) OR (event_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text))),
    CONSTRAINT world_reward_definitions_reward_id_check CHECK (((reward_id ~ '^reward\.[a-z][a-z0-9_]*\.[a-z0-9_]+$'::text) AND (char_length(reward_id) <= 80))),
    CONSTRAINT world_reward_definitions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text]))),
    CONSTRAINT world_reward_definitions_version_check CHECK ((version >= 1))
);


--
-- Name: TABLE world_reward_definitions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_reward_definitions IS 'INHA WORLD RewardDefinition canon. Grants are rows in world_reward_grants; clients never supply amounts or targets.';


--
-- Name: world_reward_grants; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_reward_grants (
    reward_id text NOT NULL,
    grant_entry_id text NOT NULL,
    "position" smallint NOT NULL,
    grant_type text NOT NULL,
    target_id text NOT NULL,
    amount bigint NOT NULL,
    CONSTRAINT world_reward_grants_amount_check CHECK ((amount >= 1)),
    CONSTRAINT world_reward_grants_grant_entry_id_check CHECK (((grant_entry_id ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$'::text) AND (char_length(grant_entry_id) <= 60))),
    CONSTRAINT world_reward_grants_grant_type_check CHECK ((grant_type = ANY (ARRAY['CURRENCY'::text, 'ITEM'::text, 'EXP'::text, 'COLLECTION'::text]))),
    CONSTRAINT world_reward_grants_position_check CHECK (("position" >= 0)),
    CONSTRAINT world_reward_grants_target_id_check CHECK (((char_length(target_id) >= 1) AND (char_length(target_id) <= 80)))
);


--
-- Name: TABLE world_reward_grants; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_reward_grants IS 'RewardDefinition grants. CURRENCY, ITEM and EXP are executable. COLLECTION remains reserved until a Collection authority exists.';


--
-- Name: world_reward_transaction_entries; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_reward_transaction_entries (
    reward_transaction_id uuid NOT NULL,
    grant_entry_id text NOT NULL,
    "position" smallint NOT NULL,
    grant_type text NOT NULL,
    target_id text NOT NULL,
    requested bigint NOT NULL,
    granted bigint DEFAULT 0 NOT NULL,
    status text NOT NULL,
    reason text,
    child_idempotency_key text NOT NULL,
    child_transaction_id text,
    attempts integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_reward_entries_result CHECK ((((status = 'GRANTED'::text) AND (granted = requested) AND (child_transaction_id IS NOT NULL)) OR ((status = ANY (ARRAY['SKIPPED'::text, 'FAILED'::text])) AND (granted = 0) AND (reason IS NOT NULL)))),
    CONSTRAINT world_reward_transaction_entries_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT world_reward_transaction_entries_grant_type_check CHECK ((grant_type = ANY (ARRAY['CURRENCY'::text, 'ITEM'::text, 'EXP'::text]))),
    CONSTRAINT world_reward_transaction_entries_granted_check CHECK ((granted >= 0)),
    CONSTRAINT world_reward_transaction_entries_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 200))),
    CONSTRAINT world_reward_transaction_entries_requested_check CHECK ((requested >= 1)),
    CONSTRAINT world_reward_transaction_entries_status_check CHECK ((status = ANY (ARRAY['GRANTED'::text, 'SKIPPED'::text, 'FAILED'::text])))
);


--
-- Name: TABLE world_reward_transaction_entries; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_reward_transaction_entries IS 'Per-grant Reward results. CURRENCY, ITEM and EXP are executable; GRANTED/SKIPPED rows are final and only FAILED rows are retried.';


--
-- Name: world_reward_transactions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_reward_transactions (
    reward_transaction_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reward_id text NOT NULL,
    reward_version integer NOT NULL,
    event_id text,
    source_type text NOT NULL,
    source_id text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT world_reward_transactions_attempts_check CHECK ((attempts >= 1)),
    CONSTRAINT world_reward_transactions_completion CHECK (((status = 'FAILED'::text) = (completed_at IS NULL))),
    CONSTRAINT world_reward_transactions_idempotency_key_check CHECK ((idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'::text)),
    CONSTRAINT world_reward_transactions_source_id_check CHECK (((char_length(source_id) >= 1) AND (char_length(source_id) <= 200))),
    CONSTRAINT world_reward_transactions_source_type_check CHECK ((source_type = ANY (ARRAY['QUEST'::text, 'EXPLORATION'::text, 'ACHIEVEMENT'::text, 'EVENT'::text, 'MINIGAME'::text, 'INHAGAME_REWARD'::text, 'SYSTEM'::text, 'ADMIN'::text]))),
    CONSTRAINT world_reward_transactions_status_check CHECK ((status = ANY (ARRAY['SUCCESS'::text, 'PARTIAL_SUCCESS'::text, 'FAILED'::text])))
);


--
-- Name: TABLE world_reward_transactions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_reward_transactions IS 'INHA WORLD reward executions. SUCCESS / PARTIAL_SUCCESS are final; FAILED is resumed by retrying the same key.';


--
-- Name: world_shops; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_shops (
    shop_id text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL,
    vendor_id text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_shops_display_name_check CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 40))),
    CONSTRAINT world_shops_shop_id_check CHECK (((shop_id ~ '^shop\.[a-z][a-z0-9_]*$'::text) AND (char_length(shop_id) <= 60))),
    CONSTRAINT world_shops_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text, 'HIDDEN'::text]))),
    CONSTRAINT world_shops_vendor_id_check CHECK (((vendor_id IS NULL) OR ((char_length(vendor_id) >= 1) AND (char_length(vendor_id) <= 80))))
);


--
-- Name: TABLE world_shops; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_shops IS 'INHA WORLD shops. HIDDEN shops are invisible, DISABLED shops are visible but sell nothing.';


--
-- Name: world_staff_assignments; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_staff_assignments (
    user_id uuid NOT NULL,
    role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_staff_assignments_role_check CHECK ((role = ANY (ARRAY['world_admin'::text, 'sound_gm'::text])))
);


--
-- Name: TABLE world_staff_assignments; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_staff_assignments IS 'Server-authoritative World staff roles. Never writable by browser roles.';


--
-- Name: world_staff_role_permissions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_staff_role_permissions (
    role text NOT NULL,
    permission text NOT NULL,
    CONSTRAINT world_staff_role_permissions_permission_check CHECK ((permission = ANY (ARRAY['admin.console'::text, 'ops.read'::text, 'moderation.read'::text, 'moderation.review'::text, 'moderation.warn'::text, 'moderation.restrict_24h'::text, 'moderation.dismiss'::text]))),
    CONSTRAINT world_staff_role_permissions_role_check CHECK ((role = ANY (ARRAY['world_admin'::text, 'sound_gm'::text])))
);


--
-- Name: TABLE world_staff_role_permissions; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_staff_role_permissions IS 'Capability map for World staff roles. P0 grants moderation operations only.';


--
-- Name: world_user_moderation_actions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_user_moderation_actions (
    id bigint NOT NULL,
    report_id bigint,
    target_id uuid NOT NULL,
    action text NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_source text DEFAULT 'ops_token'::text NOT NULL,
    CONSTRAINT world_user_moderation_action_end_check CHECK ((((action = 'interaction_restriction_24h'::text) AND (ends_at IS NOT NULL) AND (ends_at > starts_at)) OR ((action <> 'interaction_restriction_24h'::text) AND (ends_at IS NULL)))),
    CONSTRAINT world_user_moderation_actions_action_check CHECK ((action = ANY (ARRAY['reviewing'::text, 'warning'::text, 'interaction_restriction_24h'::text, 'dismissed'::text]))),
    CONSTRAINT world_user_moderation_actor_source_check CHECK ((actor_source = ANY (ARRAY['ops_token'::text, 'account_admin'::text])))
);


--
-- Name: world_user_moderation_actions_id_seq; Type: SEQUENCE; Schema: private; Owner: -
--

ALTER TABLE private.world_user_moderation_actions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME private.world_user_moderation_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: world_wallets; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.world_wallets (
    user_id uuid NOT NULL,
    currency_id text NOT NULL,
    balance bigint DEFAULT 0 NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_wallets_balance_check CHECK ((balance >= 0)),
    CONSTRAINT world_wallets_version_check CHECK ((version >= 0))
);


--
-- Name: TABLE world_wallets; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.world_wallets IS 'INHA WORLD wallet projection. Written only by private.world_wallet_apply_v1; version counts applied ledger rows.';


--
-- Name: classic_event_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classic_event_badges (
    event_key text NOT NULL,
    user_id uuid NOT NULL,
    placement smallint NOT NULL,
    badge_code text NOT NULL,
    best_run_id uuid NOT NULL,
    final_score integer NOT NULL,
    final_combo integer NOT NULL,
    final_achieved_at timestamp with time zone NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classic_event_badges_badge_code_check CHECK ((badge_code ~ '^[a-z0-9_]{3,80}$'::text)),
    CONSTRAINT classic_event_badges_event_key_check CHECK ((event_key ~ '^[a-z0-9_]{3,80}$'::text)),
    CONSTRAINT classic_event_badges_final_combo_check CHECK ((final_combo >= 0)),
    CONSTRAINT classic_event_badges_final_score_check CHECK ((final_score >= 0)),
    CONSTRAINT classic_event_badges_inha_duck_s1_code_check CHECK (((event_key <> 'inha_duck_s1'::text) OR ((placement = 1) AND (badge_code = 'inha_duck_s1_gold'::text)) OR ((placement = 2) AND (badge_code = 'inha_duck_s1_silver'::text)) OR ((placement = 3) AND (badge_code = 'inha_duck_s1_bronze'::text)) OR (((placement >= 4) AND (placement <= 10)) AND (badge_code = 'inha_duck_s1_top10'::text)))),
    CONSTRAINT classic_event_badges_placement_check CHECK (((placement >= 1) AND (placement <= 10)))
);


--
-- Name: TABLE classic_event_badges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.classic_event_badges IS 'Frozen Classic seasonal event award records. Inha Duck S1 preserves exact places 1-10; places 4-10 share the visible TOP 10 badge.';


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id bigint NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT departments_name_len CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.departments ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.departments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: experiment_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_assignments (
    experiment_id uuid NOT NULL,
    player_id uuid NOT NULL,
    variant text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    name text NOT NULL,
    hypothesis text,
    status text DEFAULT 'draft'::text NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT experiments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'running'::text, 'paused'::text, 'completed'::text])))
);


--
-- Name: game_builds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_builds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    version text NOT NULL,
    client_version text,
    balance_version text,
    ruleset_version text,
    git_commit text,
    deployed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: game_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.game_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.game_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: general_stage_bests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.general_stage_bests (
    user_id uuid NOT NULL,
    stage_id smallint NOT NULL,
    best_score integer DEFAULT 0 NOT NULL,
    best_combo integer DEFAULT 0 NOT NULL,
    achieved_at timestamp with time zone DEFAULT now() NOT NULL,
    best_stars smallint DEFAULT 0 NOT NULL,
    CONSTRAINT general_stage_bests_best_combo_check CHECK ((best_combo >= 0)),
    CONSTRAINT general_stage_bests_best_score_check CHECK ((best_score >= 0)),
    CONSTRAINT general_stage_bests_best_stars_check CHECK (((best_stars >= 0) AND (best_stars <= 3))),
    CONSTRAINT general_stage_bests_stage_id_check CHECK (((stage_id >= 1) AND (stage_id <= 4)))
);


--
-- Name: grow_rank_bests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grow_rank_bests (
    user_id uuid NOT NULL,
    department text NOT NULL,
    ruleset text NOT NULL,
    run_id uuid NOT NULL,
    twice_points integer NOT NULL,
    credits integer NOT NULL,
    achieved_at timestamp with time zone NOT NULL
);


--
-- Name: grow_rank_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grow_rank_runs (
    run_id uuid NOT NULL,
    user_id uuid NOT NULL,
    department text NOT NULL,
    ruleset text NOT NULL,
    twice_points integer NOT NULL,
    credits integer NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grow_rank_runs_check CHECK ((twice_points <= (credits * 9))),
    CONSTRAINT grow_rank_runs_credits_check CHECK (((credits >= 1) AND (credits <= 30))),
    CONSTRAINT grow_rank_runs_twice_points_check CHECK (((twice_points >= 0) AND (twice_points <= 200)))
);


--
-- Name: grow_rank_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grow_rank_sessions (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    department text NOT NULL,
    ruleset text NOT NULL,
    nonce uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'started'::text NOT NULL,
    reject_reason text,
    CONSTRAINT grow_rank_sessions_check CHECK ((expires_at > started_at)),
    CONSTRAINT grow_rank_sessions_department_check CHECK ((department = ANY (ARRAY['culture'::text, 'cse'::text, 'aero'::text, 'apsl'::text, 'nursing'::text, 'theatre'::text]))),
    CONSTRAINT grow_rank_sessions_ruleset_check CHECK ((ruleset = 'grow-gpa-lite-v1'::text)),
    CONSTRAINT grow_rank_sessions_status_check CHECK ((status = ANY (ARRAY['started'::text, 'accepted'::text, 'rejected'::text])))
);


--
-- Name: grow_rank_visibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grow_rank_visibility (
    user_id uuid NOT NULL,
    department text NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    CONSTRAINT grow_rank_visibility_department_check CHECK ((department = ANY (ARRAY['culture'::text, 'cse'::text, 'aero'::text, 'apsl'::text, 'nursing'::text, 'theatre'::text])))
);


--
-- Name: hub_conversation_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_conversation_members (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_read_at timestamp with time zone,
    archived_at timestamp with time zone
);


--
-- Name: hub_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_low uuid NOT NULL,
    user_high uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hub_conversations_creator_member CHECK (((created_by = user_low) OR (created_by = user_high))),
    CONSTRAINT hub_conversations_pair_order CHECK ((user_low < user_high))
);


--
-- Name: hub_message_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_message_reports (
    id bigint NOT NULL,
    reporter_id uuid NOT NULL,
    target_id uuid NOT NULL,
    message_id uuid NOT NULL,
    category text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    CONSTRAINT hub_message_reports_category CHECK ((category = ANY (ARRAY['spam'::text, 'harassment'::text, 'inappropriate_content'::text, 'impersonation'::text, 'other'::text]))),
    CONSTRAINT hub_message_reports_not_self CHECK ((reporter_id <> target_id)),
    CONSTRAINT hub_message_reports_status CHECK ((status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: hub_message_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.hub_message_reports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.hub_message_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: hub_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT hub_messages_body_length CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 1000))),
    CONSTRAINT hub_messages_deleted_time CHECK (((deleted_at IS NULL) OR (deleted_at >= created_at)))
);


--
-- Name: induck_grow_analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.induck_grow_analytics_events (
    event_id uuid NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    week smallint,
    department text,
    gpa numeric(3,2),
    acquisition_source text DEFAULT 'unknown'::text NOT NULL,
    campaign text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT induck_grow_analytics_campaign_check CHECK (((campaign IS NULL) OR (campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text))),
    CONSTRAINT induck_grow_analytics_department_check CHECK (((department IS NULL) OR (department ~ '^[a-z][a-z0-9_-]{0,31}$'::text))),
    CONSTRAINT induck_grow_analytics_event_context_check CHECK ((((event_type = 'semester_start'::text) AND (week = 1) AND (department IS NOT NULL) AND (gpa IS NULL)) OR ((event_type = 'week_checkpoint'::text) AND ((week >= 1) AND (week <= 15)) AND (department IS NOT NULL) AND (gpa IS NULL)) OR ((event_type = 'semester_result'::text) AND (week = 15) AND (department IS NOT NULL) AND ((gpa >= (0)::numeric) AND (gpa <= 4.50))) OR ((event_type = ANY (ARRAY['landing'::text, 'play_start'::text, 'retry'::text, 'account_save'::text])) AND (week IS NULL) AND (department IS NULL) AND (gpa IS NULL)))),
    CONSTRAINT induck_grow_analytics_events_acquisition_source_check CHECK ((acquisition_source = ANY (ARRAY['direct'::text, 'everytime'::text, 'internal'::text, 'external'::text, 'unknown'::text]))),
    CONSTRAINT induck_grow_analytics_events_event_type_check CHECK ((event_type = ANY (ARRAY['landing'::text, 'play_start'::text, 'semester_start'::text, 'week_checkpoint'::text, 'semester_result'::text, 'retry'::text, 'account_save'::text])))
);


--
-- Name: induck_grow_decision_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.induck_grow_decision_events (
    event_id uuid NOT NULL,
    session_id uuid NOT NULL,
    week smallint,
    department text NOT NULL,
    category text NOT NULL,
    decision_id text NOT NULL,
    choice_id text NOT NULL,
    acquisition_source text DEFAULT 'unknown'::text NOT NULL,
    campaign text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT induck_grow_decision_events_acquisition_source_check CHECK ((acquisition_source = ANY (ARRAY['direct'::text, 'everytime'::text, 'internal'::text, 'external'::text, 'unknown'::text]))),
    CONSTRAINT induck_grow_decision_events_campaign_check CHECK (((campaign IS NULL) OR (campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text))),
    CONSTRAINT induck_grow_decision_events_category_check CHECK ((category = ANY (ARRAY['orientation'::text, 'course'::text, 'club'::text, 'student_council'::text, 'random_event'::text, 'subscription'::text, 'career'::text]))),
    CONSTRAINT induck_grow_decision_events_choice_id_check CHECK ((choice_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text)),
    CONSTRAINT induck_grow_decision_events_decision_id_check CHECK ((decision_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text)),
    CONSTRAINT induck_grow_decision_events_department_check CHECK ((department ~ '^[a-z][a-z0-9_-]{0,31}$'::text)),
    CONSTRAINT induck_grow_decision_events_week_check CHECK (((week >= 0) AND (week <= 15)))
);


--
-- Name: induck_grow_resource_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.induck_grow_resource_checkpoints (
    event_id uuid NOT NULL,
    session_id uuid NOT NULL,
    week smallint NOT NULL,
    department text NOT NULL,
    stamina smallint NOT NULL,
    stress smallint NOT NULL,
    money integer NOT NULL,
    free_slots smallint NOT NULL,
    acquisition_source text DEFAULT 'unknown'::text NOT NULL,
    campaign text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT induck_grow_resource_checkpoints_acquisition_source_check CHECK ((acquisition_source = ANY (ARRAY['direct'::text, 'everytime'::text, 'internal'::text, 'external'::text, 'unknown'::text]))),
    CONSTRAINT induck_grow_resource_checkpoints_campaign_check CHECK (((campaign IS NULL) OR (campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text))),
    CONSTRAINT induck_grow_resource_checkpoints_department_check CHECK ((department ~ '^[a-z][a-z0-9_-]{0,31}$'::text)),
    CONSTRAINT induck_grow_resource_checkpoints_free_slots_check CHECK (((free_slots >= 0) AND (free_slots <= 32))),
    CONSTRAINT induck_grow_resource_checkpoints_money_check CHECK (((money >= 0) AND (money <= 100000000))),
    CONSTRAINT induck_grow_resource_checkpoints_stamina_check CHECK (((stamina >= 0) AND (stamina <= 100))),
    CONSTRAINT induck_grow_resource_checkpoints_stress_check CHECK (((stress >= 0) AND (stress <= 100))),
    CONSTRAINT induck_grow_resource_checkpoints_week_check CHECK ((week = ANY (ARRAY[1, 4, 8, 12, 15])))
);


--
-- Name: induck_grow_session_ends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.induck_grow_session_ends (
    event_id uuid NOT NULL,
    session_id uuid NOT NULL,
    last_week smallint,
    last_screen text,
    duration_sec integer NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    end_reason text NOT NULL,
    department text,
    final_gpa numeric(3,2),
    acquisition_source text DEFAULT 'unknown'::text NOT NULL,
    campaign text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT induck_grow_session_end_completed_check CHECK (((completed AND (end_reason = 'completed'::text)) OR ((NOT completed) AND (end_reason <> 'completed'::text)))),
    CONSTRAINT induck_grow_session_ends_acquisition_source_check CHECK ((acquisition_source = ANY (ARRAY['direct'::text, 'everytime'::text, 'internal'::text, 'external'::text, 'unknown'::text]))),
    CONSTRAINT induck_grow_session_ends_campaign_check CHECK (((campaign IS NULL) OR (campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text))),
    CONSTRAINT induck_grow_session_ends_department_check CHECK (((department IS NULL) OR (department ~ '^[a-z][a-z0-9_-]{0,31}$'::text))),
    CONSTRAINT induck_grow_session_ends_duration_sec_check CHECK (((duration_sec >= 0) AND (duration_sec <= 21600))),
    CONSTRAINT induck_grow_session_ends_end_reason_check CHECK ((end_reason = ANY (ARRAY['completed'::text, 'pagehide'::text, 'hidden_timeout'::text, 'error'::text]))),
    CONSTRAINT induck_grow_session_ends_final_gpa_check CHECK (((final_gpa IS NULL) OR ((final_gpa >= (0)::numeric) AND (final_gpa <= 4.50)))),
    CONSTRAINT induck_grow_session_ends_last_screen_check CHECK (((last_screen IS NULL) OR (last_screen ~ '^[a-z0-9_-]{1,32}$'::text))),
    CONSTRAINT induck_grow_session_ends_last_week_check CHECK (((last_week >= 1) AND (last_week <= 15)))
);


--
-- Name: induckup_ranked_bests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.induckup_ranked_bests (
    user_id uuid NOT NULL,
    best_wave integer DEFAULT 0 NOT NULL,
    best_score integer DEFAULT 0 NOT NULL,
    best_duration_ms integer DEFAULT 0 NOT NULL,
    achieved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT induckup_ranked_bests_best_duration_ms_check CHECK (((best_duration_ms >= 0) AND (best_duration_ms <= 86400000))),
    CONSTRAINT induckup_ranked_bests_best_score_check CHECK (((best_score >= 0) AND (best_score <= 2000000000))),
    CONSTRAINT induckup_ranked_bests_best_wave_check CHECK (((best_wave >= 0) AND (best_wave <= 10000)))
);


--
-- Name: inha_duck_ops_auth_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inha_duck_ops_auth_state (
    auth_key text NOT NULL,
    basic_sha256 text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE inha_duck_ops_auth_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inha_duck_ops_auth_state IS 'Retired by P1-S0. Must stay empty; no function reads it. OPS authorization is account RBAC only.';


--
-- Name: inha_duck_ops_refresh; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inha_duck_ops_refresh (
    id smallint DEFAULT 1 NOT NULL,
    seq bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inha_duck_ops_refresh_id_check CHECK ((id = 1))
);


--
-- Name: inha_mail_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inha_mail_badges (
    user_id uuid NOT NULL,
    email text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inha_mail_badges_valid_email CHECK ((lower(email) ~ '^[^@[:space:]]+@(inha[.]edu|inha[.]ac[.]kr)$'::text))
);


--
-- Name: inhagame_hub_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inhagame_hub_events (
    event_id uuid NOT NULL,
    session_id uuid NOT NULL,
    visitor_id uuid NOT NULL,
    event_type text NOT NULL,
    surface text NOT NULL,
    target text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    entry_id uuid,
    acquisition_source text DEFAULT 'unknown'::text NOT NULL,
    campaign text,
    CONSTRAINT hub_event_context_check CHECK ((((entry_id IS NULL) AND (((event_type = 'hub_visit'::text) AND (surface = 'home'::text) AND (target IS NULL)) OR ((event_type = 'hub_panel_view'::text) AND (surface = ANY (ARRAY['home'::text, 'ranking'::text, 'friends'::text, 'messages'::text, 'account'::text, 'settings'::text])) AND (target IS NULL)) OR ((event_type = 'hub_game_click'::text) AND (surface = ANY (ARRAY['home'::text, 'ranking'::text, 'account'::text])) AND (target = ANY (ARRAY['classic'::text, 'induckup'::text, 'survival'::text, 'induck-grow'::text]))) OR ((event_type = 'campus_entry_click'::text) AND (surface = 'home'::text) AND (target = 'campus'::text)) OR ((event_type = 'hub_card_impression'::text) AND (surface = 'home'::text) AND (target = ANY (ARRAY['classic'::text, 'induckup'::text, 'survival'::text, 'campus'::text, 'induck-grow'::text]))) OR ((event_type = ANY (ARRAY['campus_boot_ready'::text, 'campus_boot_error'::text])) AND (surface = 'campus'::text) AND (target IS NULL)) OR ((event_type = 'campus_zone_enter'::text) AND (surface = 'campus'::text) AND (target = ANY (ARRAY['C01_GATE'::text, 'C02_MAIN_HALL'::text, 'C03_CENTRAL'::text]))) OR ((event_type = ANY (ARRAY['profile_view'::text, 'profile_edit_open'::text, 'profile_edit_save'::text])) AND (surface = 'profile'::text) AND (target IS NULL)) OR ((event_type = 'profile_game_click'::text) AND (surface = 'profile'::text) AND (target = ANY (ARRAY['classic'::text, 'induckup'::text, 'survival'::text, 'campus'::text, 'induck-grow'::text]))) OR ((event_type = ANY (ARRAY['first_session_start'::text, 'first_move'::text, 'first_zone_arrival'::text, 'first_npc_interaction'::text, 'first_player_encounter'::text, 'world_return'::text])) AND (surface = 'campus'::text) AND (target IS NULL)) OR ((event_type = ANY (ARRAY['first_activity_start'::text, 'first_activity_complete'::text])) AND (surface = 'campus'::text) AND (target = 'inkyung_living'::text)) OR ((event_type = ANY (ARRAY['first_reward'::text, 'core_loop_complete'::text])) AND (surface = 'campus'::text) AND (target = 'first_campus'::text)) OR ((event_type = 'next_discovery_click'::text) AND (surface = 'campus'::text) AND (target = 'main2_back_gate_guide'::text)))) OR ((entry_id IS NOT NULL) AND (event_type = ANY (ARRAY['game_landing'::text, 'game_play_start'::text, 'game_load_error'::text, 'game_first_result'::text, 'game_first_clear'::text, 'game_retry'::text, 'classic_ranked_start'::text])) AND (surface = 'game'::text) AND (target = ANY (ARRAY['classic'::text, 'induckup'::text, 'survival'::text, 'campus'::text, 'induck-grow'::text])) AND ((event_type <> 'classic_ranked_start'::text) OR (target = 'classic'::text))))),
    CONSTRAINT inhagame_hub_events_acquisition_source_check CHECK ((acquisition_source = ANY (ARRAY['direct'::text, 'everytime'::text, 'internal'::text, 'external'::text, 'unknown'::text]))),
    CONSTRAINT inhagame_hub_events_campaign_check CHECK (((campaign IS NULL) OR (campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text))),
    CONSTRAINT inhagame_hub_events_event_type_check CHECK ((event_type = ANY (ARRAY['hub_visit'::text, 'hub_panel_view'::text, 'hub_game_click'::text, 'campus_entry_click'::text, 'campus_boot_ready'::text, 'campus_boot_error'::text, 'campus_zone_enter'::text, 'hub_card_impression'::text, 'game_landing'::text, 'game_play_start'::text, 'game_load_error'::text, 'game_first_result'::text, 'game_first_clear'::text, 'game_retry'::text, 'classic_ranked_start'::text, 'profile_view'::text, 'profile_edit_open'::text, 'profile_edit_save'::text, 'profile_game_click'::text, 'first_session_start'::text, 'first_move'::text, 'first_zone_arrival'::text, 'first_npc_interaction'::text, 'first_player_encounter'::text, 'first_activity_start'::text, 'first_activity_complete'::text, 'first_reward'::text, 'core_loop_complete'::text, 'world_return'::text, 'next_discovery_click'::text]))),
    CONSTRAINT inhagame_hub_events_surface_check CHECK ((surface = ANY (ARRAY['home'::text, 'ranking'::text, 'friends'::text, 'messages'::text, 'account'::text, 'settings'::text, 'campus'::text, 'game'::text, 'profile'::text]))),
    CONSTRAINT inhagame_hub_events_target_check CHECK (((target IS NULL) OR (target = ANY (ARRAY['classic'::text, 'induckup'::text, 'survival'::text, 'campus'::text, 'induck-grow'::text, 'C01_GATE'::text, 'C02_MAIN_HALL'::text, 'C03_CENTRAL'::text, 'inkyung_living'::text, 'first_campus'::text, 'main2_back_gate_guide'::text]))))
);


--
-- Name: player_bests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_bests (
    user_id uuid NOT NULL,
    stage_key text DEFAULT 'secret'::text NOT NULL,
    best_score integer NOT NULL,
    best_combo integer DEFAULT 0 NOT NULL,
    best_run_id uuid NOT NULL,
    achieved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_bests_nonnegative CHECK (((best_score >= 0) AND (best_combo >= 0))),
    CONSTRAINT player_bests_stage CHECK ((stage_key = 'secret'::text))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    nickname text NOT NULL,
    department_id bigint,
    title text,
    is_banned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_key text DEFAULT 'classic'::text NOT NULL,
    CONSTRAINT profiles_avatar_key_check CHECK ((avatar_key = ANY (ARRAY['classic'::text, 'scholar'::text, 'explorer'::text, 'star'::text]))),
    CONSTRAINT profiles_nickname_chars CHECK ((nickname ~ '^[0-9A-Za-z가-힣_ ]+$'::text)),
    CONSTRAINT profiles_nickname_len CHECK (((char_length(nickname) >= 2) AND (char_length(nickname) <= 12))),
    CONSTRAINT profiles_title_len CHECK (((title IS NULL) OR (char_length(title) <= 40)))
);


--
-- Name: leaderboard_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.leaderboard_public WITH (security_invoker='true') AS
 SELECT pb.user_id,
    pb.stage_key,
    pb.best_score,
    pb.best_combo,
    pb.achieved_at,
    p.nickname,
    p.department_id,
    d.name AS department_name,
    p.title
   FROM ((public.player_bests pb
     JOIN public.profiles p ON (((p.user_id = pb.user_id) AND (p.is_banned = false))))
     LEFT JOIN public.departments d ON ((d.id = p.department_id)))
  WHERE (pb.stage_key = 'secret'::text);


--
-- Name: ops_alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_alert_state (
    alert_key text NOT NULL,
    status text DEFAULT 'armed'::text NOT NULL,
    triggered_at timestamp with time zone,
    notified_at timestamp with time zone,
    last_value numeric,
    threshold_value numeric,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_alert_state_status_check CHECK ((status = ANY (ARRAY['armed'::text, 'triggered'::text, 'notified'::text])))
);


--
-- Name: ops_lifecycle_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_lifecycle_profiles (
    game_id uuid NOT NULL,
    mode text DEFAULT '*'::text NOT NULL,
    classifier_version text DEFAULT 'lifecycle-1'::text NOT NULL,
    reset_window_seconds integer DEFAULT 30 NOT NULL,
    genuine_exit_grace_seconds integer DEFAULT 30 NOT NULL,
    supersede_on_new_run boolean DEFAULT true NOT NULL,
    terminal_precedence jsonb DEFAULT '["rejected", "completed", "reset", "superseded", "genuine_exit", "active"]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_lifecycle_profiles_genuine_exit_grace_seconds_check CHECK (((genuine_exit_grace_seconds >= 0) AND (genuine_exit_grace_seconds <= 86400))),
    CONSTRAINT ops_lifecycle_profiles_reset_window_seconds_check CHECK (((reset_window_seconds >= 0) AND (reset_window_seconds <= 3600)))
);


--
-- Name: player_identity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_identity_links (
    visitor_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    canonical_player_id uuid NOT NULL,
    status text DEFAULT 'linked'::text NOT NULL,
    evidence_count integer DEFAULT 1 NOT NULL,
    first_evidence_at timestamp with time zone DEFAULT now() NOT NULL,
    last_evidence_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_source text DEFAULT 'same_event_auth_and_visitor'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_identity_links_evidence_count_check CHECK ((evidence_count >= 1)),
    CONSTRAINT player_identity_links_status_check CHECK ((status = ANY (ARRAY['linked'::text, 'conflict'::text])))
);


--
-- Name: TABLE player_identity_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.player_identity_links IS 'Identity stitching evidence for Inha Duck. Only same-event auth_user_id + visitor_id evidence auto-links; conflicting auth identities for one visitor are quarantined as conflict.';


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid,
    visitor_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ranked_recovery_eligibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ranked_recovery_eligibility (
    incident_key text NOT NULL,
    user_id uuid NOT NULL,
    failure_count integer NOT NULL,
    first_failed_at timestamp with time zone,
    last_failed_at timestamp with time zone,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ranked_recovery_eligibility_failure_count_check CHECK ((failure_count > 0))
);


--
-- Name: ranked_recovery_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ranked_recovery_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_key text,
    user_id uuid,
    visitor_id uuid,
    session_id uuid,
    record_kind text NOT NULL,
    client_snapshot_id uuid,
    score integer,
    best_contract text,
    local_plays integer,
    reason text,
    ruleset_version text,
    client_version text,
    validation_status text DEFAULT 'recovered_unverified'::text NOT NULL,
    source text DEFAULT 'client_recovery'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ranked_recovery_records_local_plays_check CHECK (((local_plays IS NULL) OR (local_plays >= 0))),
    CONSTRAINT ranked_recovery_records_record_kind_check CHECK ((record_kind = ANY (ARRAY['incident_summary'::text, 'full_snapshot'::text]))),
    CONSTRAINT ranked_recovery_records_score_check CHECK (((score IS NULL) OR ((score >= 0) AND (score <= 4000)))),
    CONSTRAINT ranked_recovery_records_validation_status_check CHECK ((validation_status = ANY (ARRAY['recovered_unverified'::text, 'reviewed'::text, 'discarded'::text])))
);


--
-- Name: TABLE ranked_recovery_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ranked_recovery_records IS 'Unverified recovery evidence only. Never used directly as official ranked leaderboard authority.';


--
-- Name: ranked_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ranked_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    user_id uuid NOT NULL,
    stage_key text DEFAULT 'secret'::text NOT NULL,
    score integer NOT NULL,
    max_combo integer NOT NULL,
    annyongi_hits integer DEFAULT 0 NOT NULL,
    indeoki_hits integer DEFAULT 0 NOT NULL,
    gold_hits integer DEFAULT 0 NOT NULL,
    total_hits integer DEFAULT 0 NOT NULL,
    dragon_bursts integer DEFAULT 0 NOT NULL,
    duration_ms integer NOT NULL,
    client_version text,
    validation_status text NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    run_type text DEFAULT 'ranked'::text NOT NULL,
    ruleset_version text DEFAULT 'secret-2.0-r1'::text NOT NULL,
    normal_hits integer DEFAULT 0 NOT NULL,
    speedy_hits integer DEFAULT 0 NOT NULL,
    dragon_calls integer DEFAULT 0 NOT NULL,
    moon_bonus_hits integer DEFAULT 0 NOT NULL,
    flight_hits integer DEFAULT 0 NOT NULL,
    input_count integer DEFAULT 0 NOT NULL,
    reaction_sample_count integer DEFAULT 0 NOT NULL,
    ultra_fast_reaction_count integer DEFAULT 0 NOT NULL,
    suspicious_flag boolean DEFAULT false NOT NULL,
    suspicion_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    completed_calls integer DEFAULT 0 NOT NULL,
    combo_bonus integer DEFAULT 0 NOT NULL,
    flight_base_points integer DEFAULT 0 NOT NULL,
    tier1_hits integer DEFAULT 0 NOT NULL,
    tier2_hits integer DEFAULT 0 NOT NULL,
    tier1_ground_award integer DEFAULT 0 NOT NULL,
    tier2_ground_award integer DEFAULT 0 NOT NULL,
    ascension_bonus integer DEFAULT 0 NOT NULL,
    CONSTRAINT ranked_runs_anticheat_counts_check CHECK (((normal_hits >= 0) AND (speedy_hits >= 0) AND ((dragon_calls >= 0) AND (dragon_calls <= 2)) AND (moon_bonus_hits >= 0) AND (flight_hits >= 0) AND (input_count >= 0) AND (reaction_sample_count >= 0) AND (ultra_fast_reaction_count >= 0) AND (ultra_fast_reaction_count <= reaction_sample_count))),
    CONSTRAINT ranked_runs_ascension_award_plausible CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR ((tier1_ground_award + tier2_ground_award) <= ((((normal_hits + (speedy_hits * 2)) + (gold_hits * 3)) + (indeoki_hits * 5)) + combo_bonus)))),
    CONSTRAINT ranked_runs_ascension_bonus_exact CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR (ascension_bonus = ((tier1_ground_award / 5) + (tier2_ground_award / 2))))),
    CONSTRAINT ranked_runs_combo_bonus_plausible CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR (combo_bonus <= (((((normal_hits + (speedy_hits * 2)) + (gold_hits * 3)) + (indeoki_hits * 5)) + (moon_bonus_hits * 2)) + flight_base_points)))),
    CONSTRAINT ranked_runs_completed_calls_check CHECK (((completed_calls >= 0) AND (completed_calls <= 2))),
    CONSTRAINT ranked_runs_flight_ledger_bounds CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR ((flight_hits = 0) AND (flight_base_points = 0)) OR ((flight_hits > 0) AND ((flight_base_points >= flight_hits) AND (flight_base_points <= (flight_hits * 5)))))),
    CONSTRAINT ranked_runs_ledger_nonnegative CHECK (((combo_bonus >= 0) AND (flight_base_points >= 0) AND (tier1_hits >= 0) AND (tier2_hits >= 0) AND (tier1_ground_award >= 0) AND (tier2_ground_award >= 0) AND (ascension_bonus >= 0))),
    CONSTRAINT ranked_runs_nonnegative CHECK (((score >= 0) AND (max_combo >= 0) AND (annyongi_hits >= 0) AND (indeoki_hits >= 0) AND (gold_hits >= 0) AND (total_hits >= 0) AND (dragon_bursts >= 0) AND (duration_ms >= 0))),
    CONSTRAINT ranked_runs_run_type_check CHECK ((run_type = ANY (ARRAY['ranked'::text, 'qa'::text]))),
    CONSTRAINT ranked_runs_stage CHECK ((stage_key = 'secret'::text)),
    CONSTRAINT ranked_runs_tier1_award_bounds CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR ((tier1_hits = 0) AND (tier1_ground_award = 0)) OR ((tier1_hits > 0) AND ((tier1_ground_award >= tier1_hits) AND (tier1_ground_award <= (tier1_hits * 10)))))),
    CONSTRAINT ranked_runs_tier2_award_bounds CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR ((tier2_hits = 0) AND (tier2_ground_award = 0)) OR ((tier2_hits > 0) AND ((tier2_ground_award >= tier2_hits) AND (tier2_ground_award <= (tier2_hits * 10)))))),
    CONSTRAINT ranked_runs_tier_hits_within_total CHECK (((validation_status <> 'accepted'::text) OR (ruleset_version <> 'secret-2.2-r1'::text) OR ((tier1_hits + tier2_hits) <= total_hits))),
    CONSTRAINT ranked_runs_validation CHECK ((validation_status = ANY (ARRAY['accepted'::text, 'rejected'::text])))
);


--
-- Name: ranked_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ranked_sessions (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stage_key text DEFAULT 'secret'::text NOT NULL,
    nonce uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'started'::text NOT NULL,
    client_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    run_type text DEFAULT 'ranked'::text NOT NULL,
    ruleset_version text DEFAULT 'secret-2.0-r1'::text NOT NULL,
    submitted_at timestamp with time zone,
    abandoned_at timestamp with time zone,
    expired_at timestamp with time zone,
    CONSTRAINT ranked_sessions_run_type_check CHECK ((run_type = ANY (ARRAY['ranked'::text, 'qa'::text]))),
    CONSTRAINT ranked_sessions_stage CHECK ((stage_key = 'secret'::text)),
    CONSTRAINT ranked_sessions_status CHECK ((status = ANY (ARRAY['started'::text, 'submitted'::text, 'accepted'::text, 'rejected'::text, 'abandoned'::text, 'expired'::text])))
);


--
-- Name: user_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_achievements (
    user_id uuid NOT NULL,
    achievement_key text NOT NULL,
    earned_at timestamp with time zone NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    condition_version smallint DEFAULT 1 NOT NULL,
    evidence_source text NOT NULL,
    CONSTRAINT user_achievements_achievement_key_check CHECK (((achievement_key = ANY (ARRAY['classic_recorded_v1'::text, 'classic_ranked_accepted_v1'::text, 'inha_verified_v1'::text])) OR (achievement_key ~ '^classic_inha_duck_s1_rank_([1-9]|10)_v1$'::text))),
    CONSTRAINT user_achievements_condition_version_check CHECK ((condition_version = 1)),
    CONSTRAINT user_achievements_evidence_source_check CHECK ((((achievement_key = 'classic_recorded_v1'::text) AND (evidence_source = 'classic_record'::text)) OR ((achievement_key = 'classic_ranked_accepted_v1'::text) AND (evidence_source = 'classic_ranked_accepted'::text)) OR ((achievement_key = 'inha_verified_v1'::text) AND (evidence_source = 'inha_mail_verified'::text)) OR ((achievement_key ~ '^classic_inha_duck_s1_rank_([1-9]|10)_v1$'::text) AND (evidence_source = 'classic_event_final_rank'::text))))
);


--
-- Name: TABLE user_achievements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_achievements IS 'Private derived awards: Classic records, accepted ranked runs, verified Inha mail ownership, and frozen Classic seasonal placements.';


--
-- Name: user_game_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_game_progress (
    user_id uuid NOT NULL,
    game_id uuid NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    migrated_from_local boolean DEFAULT false NOT NULL,
    first_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_game_progress_schema_version_check CHECK ((schema_version >= 1))
);


--
-- Name: TABLE user_game_progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_game_progress IS 'Per-account cloud progress. Not authoritative for competitive ranked validation. Permanent accounts only via RLS/RPC.';


--
-- Name: world_accompany_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_accompany_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inviter_id uuid NOT NULL,
    invitee_id uuid NOT NULL,
    place_zone_id text NOT NULL,
    poi_id text NOT NULL,
    state text DEFAULT 'offered'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:01:00'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    ended_at timestamp with time zone,
    ended_reason text,
    CONSTRAINT world_accompany_not_self CHECK ((inviter_id <> invitee_id)),
    CONSTRAINT world_accompany_poi CHECK ((poi_id = ANY (ARRAY['poi.main-gate'::text, 'poi.main-hall'::text, 'poi.inkyung-pond'::text, 'poi.jungseok'::text]))),
    CONSTRAINT world_accompany_state CHECK ((state = ANY (ARRAY['offered'::text, 'active'::text, 'ended'::text, 'declined'::text, 'expired'::text]))),
    CONSTRAINT world_accompany_zone CHECK ((place_zone_id ~ '^AREA_[A-Z0-9_]{1,60}$'::text))
);


--
-- Name: world_friendships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_friendships (
    user_low uuid NOT NULL,
    user_high uuid NOT NULL,
    status text NOT NULL,
    requested_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    CONSTRAINT world_friendships_accepted_at CHECK (((status = 'accepted'::text) = (accepted_at IS NOT NULL))),
    CONSTRAINT world_friendships_canonical CHECK ((user_low < user_high)),
    CONSTRAINT world_friendships_requester_member CHECK (((requested_by = user_low) OR (requested_by = user_high))),
    CONSTRAINT world_friendships_status CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text]))),
    CONSTRAINT world_friendships_times CHECK (((updated_at >= created_at) AND ((accepted_at IS NULL) OR (accepted_at >= created_at))))
);


--
-- Name: world_guestbook_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_guestbook_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    location_key text DEFAULT 'main_gate'::text NOT NULL,
    content text NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_guestbook_content_length_check CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 150))),
    CONSTRAINT world_guestbook_location_p0_check CHECK ((location_key = 'main_gate'::text))
);


--
-- Name: TABLE world_guestbook_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.world_guestbook_entries IS 'InhaWorld place guestbook. P0 supports main_gate only; permanent signed-in, non-banned users may read/write.';


--
-- Name: world_online_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_online_sessions (
    session_id uuid NOT NULL,
    user_id uuid,
    place_zone_id text,
    space text DEFAULT 'campus'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    visitor_id uuid,
    CONSTRAINT world_online_sessions_place_zone_check CHECK (((place_zone_id IS NULL) OR (place_zone_id ~ '^AREA_[A-Z0-9_]{1,60}$'::text))),
    CONSTRAINT world_online_sessions_space_check CHECK ((space = ANY (ARRAY['lobby'::text, 'campus'::text, 'club_room'::text, 'housing_lobby'::text, 'personal_room'::text])))
);


--
-- Name: TABLE world_online_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.world_online_sessions IS 'Ephemeral operational heartbeat for current INHAGAME Campus population. Active = last_seen_at within 70 seconds. Browser sessions, not unique people.';


--
-- Name: COLUMN world_online_sessions.visitor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.world_online_sessions.visitor_id IS 'Best-effort persistent browser visitor UUID shared with INHAGAME Hub telemetry. Analytics only; never authorization.';


--
-- Name: world_player_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_player_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    room_type text DEFAULT 'DORM_1_BASIC'::text NOT NULL,
    visibility text DEFAULT 'friends'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_player_rooms_room_type_check CHECK ((room_type = 'DORM_1_BASIC'::text)),
    CONSTRAINT world_player_rooms_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'friends'::text])))
);


--
-- Name: TABLE world_player_rooms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.world_player_rooms IS 'INHA WORLD personal housing authority. One persistent room per permanent account in S1-D1.3.';


--
-- Name: world_user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_user_blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_user_blocks_not_self CHECK ((blocker_id <> blocked_id))
);


--
-- Name: world_user_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_user_reports (
    id bigint NOT NULL,
    reporter_id uuid NOT NULL,
    target_id uuid NOT NULL,
    category text NOT NULL,
    place_zone_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_at timestamp with time zone,
    resolution text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT world_user_reports_category CHECK ((category = ANY (ARRAY['spam'::text, 'harassment'::text, 'inappropriate_name'::text, 'other'::text]))),
    CONSTRAINT world_user_reports_not_self CHECK ((reporter_id <> target_id)),
    CONSTRAINT world_user_reports_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['warning'::text, 'interaction_restriction_24h'::text, 'dismissed'::text])))),
    CONSTRAINT world_user_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT world_user_reports_zone CHECK (((place_zone_id IS NULL) OR (place_zone_id ~ '^AREA_[A-Z0-9_]{1,60}$'::text)))
);


--
-- Name: world_user_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.world_user_reports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.world_user_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inhagame_member_activity_daily inhagame_member_activity_daily_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.inhagame_member_activity_daily
    ADD CONSTRAINT inhagame_member_activity_daily_pkey PRIMARY KEY (user_id, activity_date_kst);


--
-- Name: world_appearance_transactions world_appearance_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_appearance_transactions
    ADD CONSTRAINT world_appearance_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: world_appearance_transactions world_appearance_transactions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_appearance_transactions
    ADD CONSTRAINT world_appearance_transactions_pkey PRIMARY KEY (transaction_id);


--
-- Name: world_attendance_days world_attendance_days_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_attendance_days
    ADD CONSTRAINT world_attendance_days_pkey PRIMARY KEY (user_id, attendance_date);


--
-- Name: world_biryong_progress_v1 world_biryong_progress_v1_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_biryong_progress_v1
    ADD CONSTRAINT world_biryong_progress_v1_pkey PRIMARY KEY (user_id);


--
-- Name: world_currencies world_currencies_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_currencies
    ADD CONSTRAINT world_currencies_pkey PRIMARY KEY (currency_id);


--
-- Name: world_currency_transactions world_currency_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_currency_transactions
    ADD CONSTRAINT world_currency_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: world_currency_transactions world_currency_transactions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_currency_transactions
    ADD CONSTRAINT world_currency_transactions_pkey PRIMARY KEY (transaction_id);


--
-- Name: world_daily_quiz_answers world_daily_quiz_answers_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_answers
    ADD CONSTRAINT world_daily_quiz_answers_pkey PRIMARY KEY (run_id, question_index);


--
-- Name: world_daily_quiz_questions world_daily_quiz_questions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_questions
    ADD CONSTRAINT world_daily_quiz_questions_pkey PRIMARY KEY (question_id);


--
-- Name: world_daily_quiz_questions world_daily_quiz_questions_position_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_questions
    ADD CONSTRAINT world_daily_quiz_questions_position_key UNIQUE ("position");


--
-- Name: world_daily_quiz_runs world_daily_quiz_runs_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_runs
    ADD CONSTRAINT world_daily_quiz_runs_pkey PRIMARY KEY (run_id);


--
-- Name: world_daily_quiz_runs world_daily_quiz_runs_user_id_reward_date_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_runs
    ADD CONSTRAINT world_daily_quiz_runs_user_id_reward_date_key UNIQUE (user_id, reward_date);


--
-- Name: world_event_progress world_event_progress_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_event_progress
    ADD CONSTRAINT world_event_progress_pkey PRIMARY KEY (user_id, event_id);


--
-- Name: world_events world_events_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_events
    ADD CONSTRAINT world_events_pkey PRIMARY KEY (event_id);


--
-- Name: world_exp_transactions world_exp_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_exp_transactions
    ADD CONSTRAINT world_exp_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: world_exp_transactions world_exp_transactions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_exp_transactions
    ADD CONSTRAINT world_exp_transactions_pkey PRIMARY KEY (transaction_id);


--
-- Name: world_guestbook_post_log world_guestbook_post_log_entry_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_guestbook_post_log
    ADD CONSTRAINT world_guestbook_post_log_entry_id_key UNIQUE (entry_id);


--
-- Name: world_guestbook_post_log world_guestbook_post_log_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_guestbook_post_log
    ADD CONSTRAINT world_guestbook_post_log_pkey PRIMARY KEY (id);


--
-- Name: world_item_catalog world_item_catalog_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_item_catalog
    ADD CONSTRAINT world_item_catalog_pkey PRIMARY KEY (item_id);


--
-- Name: world_item_grants world_item_grants_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_item_grants
    ADD CONSTRAINT world_item_grants_pkey PRIMARY KEY (grant_id);


--
-- Name: world_landlord_first_clears world_landlord_first_clears_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_first_clears
    ADD CONSTRAINT world_landlord_first_clears_pkey PRIMARY KEY (user_id, event_id);


--
-- Name: world_landlord_runs world_landlord_runs_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_runs
    ADD CONSTRAINT world_landlord_runs_pkey PRIMARY KEY (run_id);


--
-- Name: world_level_thresholds world_level_thresholds_min_total_exp_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_level_thresholds
    ADD CONSTRAINT world_level_thresholds_min_total_exp_key UNIQUE (min_total_exp);


--
-- Name: world_level_thresholds world_level_thresholds_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_level_thresholds
    ADD CONSTRAINT world_level_thresholds_pkey PRIMARY KEY (level);


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_idempotency_key_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_pkey PRIMARY KEY (user_id, claim_type);


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_reward_transaction_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_reward_transaction_key UNIQUE (reward_transaction_id);


--
-- Name: world_npc_ai_daily_calls world_npc_ai_daily_calls_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_npc_ai_daily_calls
    ADD CONSTRAINT world_npc_ai_daily_calls_pkey PRIMARY KEY (usage_day, scope);


--
-- Name: world_npc_shared_ticks_v1 world_npc_shared_ticks_v1_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_npc_shared_ticks_v1
    ADD CONSTRAINT world_npc_shared_ticks_v1_pkey PRIMARY KEY (tick);


--
-- Name: world_player_appearance_loadout world_player_appearance_loadout_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_appearance_loadout
    ADD CONSTRAINT world_player_appearance_loadout_pkey PRIMARY KEY (user_id, slot);


--
-- Name: world_player_items world_player_items_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_items
    ADD CONSTRAINT world_player_items_pkey PRIMARY KEY (id);


--
-- Name: world_player_items world_player_items_user_item_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_items
    ADD CONSTRAINT world_player_items_user_item_key UNIQUE (user_id, item_id);


--
-- Name: world_player_progression world_player_progression_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_progression
    ADD CONSTRAINT world_player_progression_pkey PRIMARY KEY (user_id);


--
-- Name: world_purchase_transactions world_purchase_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_purchase_transactions
    ADD CONSTRAINT world_purchase_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: world_purchase_transactions world_purchase_transactions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_purchase_transactions
    ADD CONSTRAINT world_purchase_transactions_pkey PRIMARY KEY (purchase_id);


--
-- Name: world_quest_progress_v1 world_quest_progress_v1_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_quest_progress_v1
    ADD CONSTRAINT world_quest_progress_v1_pkey PRIMARY KEY (user_id, quest_id);


--
-- Name: world_reward_definitions world_reward_definitions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_definitions
    ADD CONSTRAINT world_reward_definitions_pkey PRIMARY KEY (reward_id);


--
-- Name: world_reward_grants world_reward_grants_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_grants
    ADD CONSTRAINT world_reward_grants_pkey PRIMARY KEY (reward_id, grant_entry_id);


--
-- Name: world_reward_grants world_reward_grants_position_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_grants
    ADD CONSTRAINT world_reward_grants_position_key UNIQUE (reward_id, "position");


--
-- Name: world_reward_grants world_reward_grants_target_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_grants
    ADD CONSTRAINT world_reward_grants_target_key UNIQUE (reward_id, grant_type, target_id);


--
-- Name: world_reward_transaction_entries world_reward_transaction_entries_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_transaction_entries
    ADD CONSTRAINT world_reward_transaction_entries_pkey PRIMARY KEY (reward_transaction_id, grant_entry_id);


--
-- Name: world_reward_transactions world_reward_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_transactions
    ADD CONSTRAINT world_reward_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: world_reward_transactions world_reward_transactions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_transactions
    ADD CONSTRAINT world_reward_transactions_pkey PRIMARY KEY (reward_transaction_id);


--
-- Name: world_shop_listings world_shop_listings_item_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_shop_listings
    ADD CONSTRAINT world_shop_listings_item_key UNIQUE (shop_id, item_id);


--
-- Name: world_shop_listings world_shop_listings_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_shop_listings
    ADD CONSTRAINT world_shop_listings_pkey PRIMARY KEY (listing_id);


--
-- Name: world_shop_listings world_shop_listings_position_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_shop_listings
    ADD CONSTRAINT world_shop_listings_position_key UNIQUE (shop_id, "position");


--
-- Name: world_shops world_shops_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_shops
    ADD CONSTRAINT world_shops_pkey PRIMARY KEY (shop_id);


--
-- Name: world_staff_assignments world_staff_assignments_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_staff_assignments
    ADD CONSTRAINT world_staff_assignments_pkey PRIMARY KEY (user_id);


--
-- Name: world_staff_role_permissions world_staff_role_permissions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_staff_role_permissions
    ADD CONSTRAINT world_staff_role_permissions_pkey PRIMARY KEY (role, permission);


--
-- Name: world_user_moderation_actions world_user_moderation_actions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_user_moderation_actions
    ADD CONSTRAINT world_user_moderation_actions_pkey PRIMARY KEY (id);


--
-- Name: world_wallets world_wallets_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_wallets
    ADD CONSTRAINT world_wallets_pkey PRIMARY KEY (user_id, currency_id);


--
-- Name: classic_event_badges classic_event_badges_event_key_placement_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classic_event_badges
    ADD CONSTRAINT classic_event_badges_event_key_placement_key UNIQUE (event_key, placement);


--
-- Name: classic_event_badges classic_event_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classic_event_badges
    ADD CONSTRAINT classic_event_badges_pkey PRIMARY KEY (event_key, user_id);


--
-- Name: departments departments_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: experiment_assignments experiment_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_pkey PRIMARY KEY (experiment_id, player_id);


--
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (id);


--
-- Name: game_builds game_builds_game_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_builds
    ADD CONSTRAINT game_builds_game_id_version_key UNIQUE (game_id, version);


--
-- Name: game_builds game_builds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_builds
    ADD CONSTRAINT game_builds_pkey PRIMARY KEY (id);


--
-- Name: game_events game_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_pkey PRIMARY KEY (id);


--
-- Name: game_sessions game_sessions_game_id_client_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_game_id_client_session_id_key UNIQUE (game_id, client_session_id);


--
-- Name: game_sessions game_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: games games_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_slug_key UNIQUE (slug);


--
-- Name: general_stage_bests general_stage_bests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_stage_bests
    ADD CONSTRAINT general_stage_bests_pkey PRIMARY KEY (user_id, stage_id);


--
-- Name: grow_rank_bests grow_rank_bests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_bests
    ADD CONSTRAINT grow_rank_bests_pkey PRIMARY KEY (user_id, department, ruleset);


--
-- Name: grow_rank_runs grow_rank_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_runs
    ADD CONSTRAINT grow_rank_runs_pkey PRIMARY KEY (run_id);


--
-- Name: grow_rank_sessions grow_rank_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_sessions
    ADD CONSTRAINT grow_rank_sessions_pkey PRIMARY KEY (run_id);


--
-- Name: grow_rank_visibility grow_rank_visibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_visibility
    ADD CONSTRAINT grow_rank_visibility_pkey PRIMARY KEY (user_id, department);


--
-- Name: hub_conversation_members hub_conversation_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversation_members
    ADD CONSTRAINT hub_conversation_members_pkey PRIMARY KEY (conversation_id, user_id);


--
-- Name: hub_conversations hub_conversations_pair_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversations
    ADD CONSTRAINT hub_conversations_pair_unique UNIQUE (user_low, user_high);


--
-- Name: hub_conversations hub_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversations
    ADD CONSTRAINT hub_conversations_pkey PRIMARY KEY (id);


--
-- Name: hub_message_reports hub_message_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_message_reports
    ADD CONSTRAINT hub_message_reports_pkey PRIMARY KEY (id);


--
-- Name: hub_messages hub_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_messages
    ADD CONSTRAINT hub_messages_pkey PRIMARY KEY (id);


--
-- Name: induck_grow_analytics_events induck_grow_analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induck_grow_analytics_events
    ADD CONSTRAINT induck_grow_analytics_events_pkey PRIMARY KEY (event_id);


--
-- Name: induck_grow_decision_events induck_grow_decision_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induck_grow_decision_events
    ADD CONSTRAINT induck_grow_decision_events_pkey PRIMARY KEY (event_id);


--
-- Name: induck_grow_resource_checkpoints induck_grow_resource_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induck_grow_resource_checkpoints
    ADD CONSTRAINT induck_grow_resource_checkpoints_pkey PRIMARY KEY (event_id);


--
-- Name: induck_grow_resource_checkpoints induck_grow_resource_checkpoints_session_id_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induck_grow_resource_checkpoints
    ADD CONSTRAINT induck_grow_resource_checkpoints_session_id_week_key UNIQUE (session_id, week);


--
-- Name: induck_grow_session_ends induck_grow_session_ends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induck_grow_session_ends
    ADD CONSTRAINT induck_grow_session_ends_pkey PRIMARY KEY (event_id);


--
-- Name: induck_grow_session_ends induck_grow_session_ends_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induck_grow_session_ends
    ADD CONSTRAINT induck_grow_session_ends_session_id_key UNIQUE (session_id);


--
-- Name: induckup_ranked_bests induckup_ranked_bests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induckup_ranked_bests
    ADD CONSTRAINT induckup_ranked_bests_pkey PRIMARY KEY (user_id);


--
-- Name: inha_duck_ops_auth_state inha_duck_ops_auth_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inha_duck_ops_auth_state
    ADD CONSTRAINT inha_duck_ops_auth_state_pkey PRIMARY KEY (auth_key);


--
-- Name: inha_duck_ops_refresh inha_duck_ops_refresh_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inha_duck_ops_refresh
    ADD CONSTRAINT inha_duck_ops_refresh_pkey PRIMARY KEY (id);


--
-- Name: inha_mail_badges inha_mail_badges_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inha_mail_badges
    ADD CONSTRAINT inha_mail_badges_email_key UNIQUE (email);


--
-- Name: inha_mail_badges inha_mail_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inha_mail_badges
    ADD CONSTRAINT inha_mail_badges_pkey PRIMARY KEY (user_id);


--
-- Name: inhagame_hub_events inhagame_hub_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inhagame_hub_events
    ADD CONSTRAINT inhagame_hub_events_pkey PRIMARY KEY (event_id);


--
-- Name: ops_alert_state ops_alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_alert_state
    ADD CONSTRAINT ops_alert_state_pkey PRIMARY KEY (alert_key);


--
-- Name: ops_event_contracts ops_event_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_event_contracts
    ADD CONSTRAINT ops_event_contracts_pkey PRIMARY KEY (canonical_event);


--
-- Name: ops_event_mappings ops_event_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_event_mappings
    ADD CONSTRAINT ops_event_mappings_pkey PRIMARY KEY (game_id, raw_event_type);


--
-- Name: ops_lifecycle_profiles ops_lifecycle_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_lifecycle_profiles
    ADD CONSTRAINT ops_lifecycle_profiles_pkey PRIMARY KEY (game_id, mode);


--
-- Name: player_bests player_bests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_bests
    ADD CONSTRAINT player_bests_pkey PRIMARY KEY (user_id, stage_key);


--
-- Name: player_identity_links player_identity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_identity_links
    ADD CONSTRAINT player_identity_links_pkey PRIMARY KEY (visitor_id, auth_user_id);


--
-- Name: players players_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: players players_visitor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_visitor_id_key UNIQUE (visitor_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: ranked_recovery_eligibility ranked_recovery_eligibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_recovery_eligibility
    ADD CONSTRAINT ranked_recovery_eligibility_pkey PRIMARY KEY (incident_key, user_id);


--
-- Name: ranked_recovery_records ranked_recovery_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_recovery_records
    ADD CONSTRAINT ranked_recovery_records_pkey PRIMARY KEY (id);


--
-- Name: ranked_runs ranked_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_runs
    ADD CONSTRAINT ranked_runs_pkey PRIMARY KEY (id);


--
-- Name: ranked_runs ranked_runs_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_runs
    ADD CONSTRAINT ranked_runs_run_id_key UNIQUE (run_id);


--
-- Name: ranked_sessions ranked_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_sessions
    ADD CONSTRAINT ranked_sessions_pkey PRIMARY KEY (run_id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: user_achievements user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_pkey PRIMARY KEY (user_id, achievement_key);


--
-- Name: user_game_progress user_game_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_game_progress
    ADD CONSTRAINT user_game_progress_pkey PRIMARY KEY (user_id, game_id);


--
-- Name: world_accompany_sessions world_accompany_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_accompany_sessions
    ADD CONSTRAINT world_accompany_sessions_pkey PRIMARY KEY (id);


--
-- Name: world_friendships world_friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_friendships
    ADD CONSTRAINT world_friendships_pkey PRIMARY KEY (user_low, user_high);


--
-- Name: world_guestbook_entries world_guestbook_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_guestbook_entries
    ADD CONSTRAINT world_guestbook_entries_pkey PRIMARY KEY (id);


--
-- Name: world_online_sessions world_online_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_online_sessions
    ADD CONSTRAINT world_online_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: world_player_rooms world_player_rooms_owner_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_player_rooms
    ADD CONSTRAINT world_player_rooms_owner_unique UNIQUE (owner_user_id);


--
-- Name: world_player_rooms world_player_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_player_rooms
    ADD CONSTRAINT world_player_rooms_pkey PRIMARY KEY (id);


--
-- Name: world_user_blocks world_user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_user_blocks
    ADD CONSTRAINT world_user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: world_user_reports world_user_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_user_reports
    ADD CONSTRAINT world_user_reports_pkey PRIMARY KEY (id);


--
-- Name: inhagame_member_activity_date_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX inhagame_member_activity_date_idx ON private.inhagame_member_activity_daily USING btree (activity_date_kst DESC);


--
-- Name: world_appearance_transactions_user_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_appearance_transactions_user_idx ON private.world_appearance_transactions USING btree (user_id, created_at DESC);


--
-- Name: world_currency_transactions_user_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_currency_transactions_user_created_idx ON private.world_currency_transactions USING btree (user_id, currency_id, created_at DESC);


--
-- Name: world_exp_transactions_user_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_exp_transactions_user_created_idx ON private.world_exp_transactions USING btree (user_id, created_at DESC);


--
-- Name: world_guestbook_post_log_user_place_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_guestbook_post_log_user_place_created_idx ON private.world_guestbook_post_log USING btree (user_id, location_key, created_at DESC);


--
-- Name: world_item_grants_user_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_item_grants_user_idx ON private.world_item_grants USING btree (user_id, created_at DESC);


--
-- Name: world_landlord_runs_one_active; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX world_landlord_runs_one_active ON private.world_landlord_runs USING btree (user_id) WHERE (status = 'ACTIVE'::text);


--
-- Name: world_purchase_transactions_user_listing_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_purchase_transactions_user_listing_idx ON private.world_purchase_transactions USING btree (user_id, listing_id);


--
-- Name: world_reward_transactions_user_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_reward_transactions_user_idx ON private.world_reward_transactions USING btree (user_id, created_at DESC);


--
-- Name: world_user_moderation_actions_actor_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_user_moderation_actions_actor_idx ON private.world_user_moderation_actions USING btree (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);


--
-- Name: world_user_moderation_report_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_user_moderation_report_idx ON private.world_user_moderation_actions USING btree (report_id, created_at DESC);


--
-- Name: world_user_moderation_target_active_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX world_user_moderation_target_active_idx ON private.world_user_moderation_actions USING btree (target_id, ends_at DESC) WHERE (action = 'interaction_restriction_24h'::text);


--
-- Name: classic_event_badges_best_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classic_event_badges_best_run_idx ON public.classic_event_badges USING btree (best_run_id);


--
-- Name: classic_event_badges_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classic_event_badges_user_idx ON public.classic_event_badges USING btree (user_id);


--
-- Name: game_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_created_at_idx ON public.game_events USING btree (created_at DESC);


--
-- Name: game_events_game_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_game_created_idx ON public.game_events USING btree (game_id, created_at DESC);


--
-- Name: game_events_game_player_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_game_player_created_idx ON public.game_events USING btree (game_id, player_id, created_at DESC) WHERE (player_id IS NOT NULL);


--
-- Name: game_events_game_session_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_game_session_created_idx ON public.game_events USING btree (game_session_id, created_at) WHERE (game_session_id IS NOT NULL);


--
-- Name: game_events_game_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_game_type_created_idx ON public.game_events USING btree (game_id, event_type, created_at DESC);


--
-- Name: game_events_player_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_player_created_idx ON public.game_events USING btree (player_id, created_at DESC);


--
-- Name: game_events_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_run_idx ON public.game_events USING btree (run_id) WHERE (run_id IS NOT NULL);


--
-- Name: game_events_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_type_created_idx ON public.game_events USING btree (event_type, created_at DESC);


--
-- Name: game_events_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_events_user_created_idx ON public.game_events USING btree (user_id, created_at DESC);


--
-- Name: game_sessions_game_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_sessions_game_started_idx ON public.game_sessions USING btree (game_id, started_at DESC);


--
-- Name: game_sessions_player_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_sessions_player_started_idx ON public.game_sessions USING btree (player_id, started_at DESC) WHERE (player_id IS NOT NULL);


--
-- Name: grow_rank_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grow_rank_board_idx ON public.grow_rank_bests USING btree (department, ruleset);


--
-- Name: grow_rank_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grow_rank_sessions_user_idx ON public.grow_rank_sessions USING btree (user_id, started_at DESC);


--
-- Name: hub_conversation_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_conversation_members_user_idx ON public.hub_conversation_members USING btree (user_id, archived_at, conversation_id);


--
-- Name: hub_conversations_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_conversations_updated_idx ON public.hub_conversations USING btree (updated_at DESC, id);


--
-- Name: hub_message_reports_reporter_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_message_reports_reporter_created_idx ON public.hub_message_reports USING btree (reporter_id, created_at DESC);


--
-- Name: hub_message_reports_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_message_reports_status_created_idx ON public.hub_message_reports USING btree (status, created_at DESC);


--
-- Name: hub_message_reports_target_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_message_reports_target_created_idx ON public.hub_message_reports USING btree (target_id, created_at DESC);


--
-- Name: hub_messages_conversation_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_messages_conversation_created_idx ON public.hub_messages USING btree (conversation_id, created_at DESC, id DESC);


--
-- Name: hub_messages_sender_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hub_messages_sender_created_idx ON public.hub_messages USING btree (sender_id, created_at DESC);


--
-- Name: induck_grow_analytics_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_analytics_created_idx ON public.induck_grow_analytics_events USING btree (created_at DESC);


--
-- Name: induck_grow_analytics_singleton_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX induck_grow_analytics_singleton_idx ON public.induck_grow_analytics_events USING btree (session_id, event_type) WHERE (event_type = ANY (ARRAY['landing'::text, 'play_start'::text, 'semester_start'::text, 'semester_result'::text, 'retry'::text, 'account_save'::text]));


--
-- Name: induck_grow_analytics_source_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_analytics_source_created_idx ON public.induck_grow_analytics_events USING btree (acquisition_source, created_at DESC);


--
-- Name: induck_grow_analytics_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX induck_grow_analytics_week_idx ON public.induck_grow_analytics_events USING btree (session_id, week) WHERE (event_type = 'week_checkpoint'::text);


--
-- Name: induck_grow_decision_events_choice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_decision_events_choice_idx ON public.induck_grow_decision_events USING btree (category, decision_id, choice_id, created_at DESC);


--
-- Name: induck_grow_decision_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_decision_events_created_idx ON public.induck_grow_decision_events USING btree (created_at DESC);


--
-- Name: induck_grow_decision_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_decision_events_session_idx ON public.induck_grow_decision_events USING btree (session_id, created_at DESC);


--
-- Name: induck_grow_resource_checkpoints_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_resource_checkpoints_created_idx ON public.induck_grow_resource_checkpoints USING btree (created_at DESC);


--
-- Name: induck_grow_session_ends_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_session_ends_created_idx ON public.induck_grow_session_ends USING btree (created_at DESC);


--
-- Name: induck_grow_session_ends_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induck_grow_session_ends_outcome_idx ON public.induck_grow_session_ends USING btree (completed, last_week, created_at DESC);


--
-- Name: induckup_ranked_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX induckup_ranked_order_idx ON public.induckup_ranked_bests USING btree (best_wave DESC, best_score DESC, best_duration_ms DESC, achieved_at);


--
-- Name: inhagame_hub_entry_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inhagame_hub_entry_lookup ON public.inhagame_hub_events USING btree (entry_id) WHERE (entry_id IS NOT NULL);


--
-- Name: inhagame_hub_entry_stage_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inhagame_hub_entry_stage_unique ON public.inhagame_hub_events USING btree (entry_id, event_type) WHERE (entry_id IS NOT NULL);


--
-- Name: inhagame_hub_events_acquisition_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inhagame_hub_events_acquisition_created_idx ON public.inhagame_hub_events USING btree (acquisition_source, created_at DESC);


--
-- Name: inhagame_hub_events_campaign_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inhagame_hub_events_campaign_created_idx ON public.inhagame_hub_events USING btree (campaign, created_at DESC) WHERE (campaign IS NOT NULL);


--
-- Name: inhagame_hub_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inhagame_hub_events_created_idx ON public.inhagame_hub_events USING btree (created_at DESC);


--
-- Name: inhagame_hub_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inhagame_hub_events_session_idx ON public.inhagame_hub_events USING btree (session_id, created_at DESC);


--
-- Name: player_bests_best_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_bests_best_run_idx ON public.player_bests USING btree (best_run_id);


--
-- Name: player_bests_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_bests_score_idx ON public.player_bests USING btree (stage_key, best_score DESC, achieved_at);


--
-- Name: player_identity_links_auth_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_identity_links_auth_idx ON public.player_identity_links USING btree (auth_user_id);


--
-- Name: player_identity_links_one_active_visitor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX player_identity_links_one_active_visitor_idx ON public.player_identity_links USING btree (visitor_id) WHERE (status = 'linked'::text);


--
-- Name: profiles_department_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_department_idx ON public.profiles USING btree (department_id);


--
-- Name: ranked_recovery_records_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ranked_recovery_records_user_created_idx ON public.ranked_recovery_records USING btree (user_id, created_at DESC);


--
-- Name: ranked_recovery_snapshot_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ranked_recovery_snapshot_once_idx ON public.ranked_recovery_records USING btree (client_snapshot_id) WHERE ((record_kind = 'full_snapshot'::text) AND (client_snapshot_id IS NOT NULL));


--
-- Name: ranked_recovery_summary_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ranked_recovery_summary_once_idx ON public.ranked_recovery_records USING btree (incident_key, user_id) WHERE (record_kind = 'incident_summary'::text);


--
-- Name: ranked_runs_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ranked_runs_user_created_idx ON public.ranked_runs USING btree (user_id, created_at DESC);


--
-- Name: ranked_sessions_user_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ranked_sessions_user_started_idx ON public.ranked_sessions USING btree (user_id, started_at DESC);


--
-- Name: runs_game_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_game_created_idx ON public.runs USING btree (game_id, created_at DESC);


--
-- Name: runs_game_player_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_game_player_started_idx ON public.runs USING btree (game_id, player_id, started_at DESC) WHERE (player_id IS NOT NULL);


--
-- Name: runs_player_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_player_created_idx ON public.runs USING btree (player_id, created_at DESC);


--
-- Name: runs_stage_key_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_stage_key_created_idx ON public.runs USING btree (stage_key, created_at DESC) WHERE (stage_key IS NOT NULL);


--
-- Name: user_game_progress_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_game_progress_updated_at_idx ON public.user_game_progress USING btree (updated_at DESC);


--
-- Name: world_accompany_invitee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_accompany_invitee_idx ON public.world_accompany_sessions USING btree (invitee_id, state, expires_at);


--
-- Name: world_accompany_inviter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_accompany_inviter_idx ON public.world_accompany_sessions USING btree (inviter_id, state, expires_at);


--
-- Name: world_friendships_high_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_friendships_high_idx ON public.world_friendships USING btree (user_high);


--
-- Name: world_guestbook_location_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_guestbook_location_created_idx ON public.world_guestbook_entries USING btree (location_key, created_at DESC) WHERE (is_hidden = false);


--
-- Name: world_guestbook_user_place_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_guestbook_user_place_created_idx ON public.world_guestbook_entries USING btree (user_id, location_key, created_at DESC);


--
-- Name: world_online_sessions_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_online_sessions_last_seen_idx ON public.world_online_sessions USING btree (last_seen_at DESC);


--
-- Name: world_online_sessions_space_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_online_sessions_space_last_seen_idx ON public.world_online_sessions USING btree (space, last_seen_at DESC);


--
-- Name: world_online_sessions_visitor_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_online_sessions_visitor_last_seen_idx ON public.world_online_sessions USING btree (visitor_id, last_seen_at DESC) WHERE (visitor_id IS NOT NULL);


--
-- Name: world_online_sessions_zone_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_online_sessions_zone_last_seen_idx ON public.world_online_sessions USING btree (place_zone_id, last_seen_at DESC) WHERE (place_zone_id IS NOT NULL);


--
-- Name: world_user_blocks_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_user_blocks_blocked_idx ON public.world_user_blocks USING btree (blocked_id);


--
-- Name: world_user_reports_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_user_reports_reporter_idx ON public.world_user_reports USING btree (reporter_id, created_at DESC);


--
-- Name: world_user_reports_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_user_reports_status_created_idx ON public.world_user_reports USING btree (status, created_at DESC);


--
-- Name: world_user_reports_target_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX world_user_reports_target_created_idx ON public.world_user_reports USING btree (target_id, created_at DESC);


--
-- Name: world_appearance_transactions world_appearance_transactions_append_only; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_appearance_transactions_append_only BEFORE UPDATE ON private.world_appearance_transactions FOR EACH ROW EXECUTE FUNCTION private.world_appearance_transactions_append_only_v1();


--
-- Name: world_currency_transactions world_currency_transactions_append_only; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_currency_transactions_append_only BEFORE UPDATE ON private.world_currency_transactions FOR EACH ROW EXECUTE FUNCTION private.world_currency_transactions_append_only_v1();


--
-- Name: world_exp_transactions world_exp_transactions_append_only; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_exp_transactions_append_only BEFORE UPDATE ON private.world_exp_transactions FOR EACH ROW EXECUTE FUNCTION private.world_exp_transactions_append_only_v1();


--
-- Name: world_item_grants world_item_grants_append_only; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_item_grants_append_only BEFORE UPDATE ON private.world_item_grants FOR EACH ROW EXECUTE FUNCTION private.world_item_grants_append_only_v1();


--
-- Name: world_level_thresholds world_level_thresholds_immutable; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_level_thresholds_immutable BEFORE DELETE OR UPDATE ON private.world_level_thresholds FOR EACH ROW EXECUTE FUNCTION private.world_level_thresholds_immutable_v1();


--
-- Name: world_level_thresholds world_level_thresholds_validate_insert; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_level_thresholds_validate_insert BEFORE INSERT ON private.world_level_thresholds FOR EACH ROW EXECUTE FUNCTION private.world_level_thresholds_validate_insert_v1();


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_final; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_mcm_reward_claims_final BEFORE UPDATE ON private.world_mcm_reward_claims FOR EACH ROW EXECUTE FUNCTION private.world_mcm_reward_claims_final_v1();


--
-- Name: world_purchase_transactions world_purchase_transactions_append_only; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_purchase_transactions_append_only BEFORE UPDATE ON private.world_purchase_transactions FOR EACH ROW EXECUTE FUNCTION private.world_purchase_transactions_append_only_v1();


--
-- Name: world_reward_transaction_entries world_reward_entries_final; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_reward_entries_final BEFORE UPDATE ON private.world_reward_transaction_entries FOR EACH ROW EXECUTE FUNCTION private.world_reward_final_rows_v1();


--
-- Name: world_reward_grants world_reward_grants_validate; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_reward_grants_validate BEFORE INSERT OR UPDATE ON private.world_reward_grants FOR EACH ROW EXECUTE FUNCTION private.world_reward_grants_validate_v1();


--
-- Name: world_reward_transactions world_reward_transactions_final; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_reward_transactions_final BEFORE UPDATE ON private.world_reward_transactions FOR EACH ROW EXECUTE FUNCTION private.world_reward_final_rows_v1();


--
-- Name: world_shop_listings world_shop_listings_validate; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER world_shop_listings_validate BEFORE INSERT OR UPDATE ON private.world_shop_listings FOR EACH ROW EXECUTE FUNCTION private.world_shop_listings_validate_v1();


--
-- Name: game_events trg_game_events_attach_context; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_game_events_attach_context BEFORE INSERT ON public.game_events FOR EACH ROW EXECUTE FUNCTION public.attach_inha_duck_event_context();


--
-- Name: game_events trg_game_events_sync_general_run; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_game_events_sync_general_run AFTER INSERT OR UPDATE ON public.game_events FOR EACH ROW WHEN (((new.run_id IS NOT NULL) AND (new.event_type = ANY (ARRAY['stage_attempt'::text, 'stage_result'::text, 'exit_run'::text])))) EXECUTE FUNCTION public.trg_sync_inha_duck_general_run();


--
-- Name: general_stage_bests trg_general_stage_best_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_general_stage_best_event AFTER INSERT OR UPDATE ON public.general_stage_bests FOR EACH ROW EXECUTE FUNCTION public.log_general_stage_best_event();


--
-- Name: game_events trg_ops_refresh_game_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ops_refresh_game_events AFTER INSERT OR UPDATE ON public.game_events FOR EACH STATEMENT EXECUTE FUNCTION public.touch_inha_duck_ops_refresh();


--
-- Name: game_sessions trg_ops_refresh_game_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ops_refresh_game_sessions AFTER INSERT OR UPDATE ON public.game_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.touch_inha_duck_ops_refresh();


--
-- Name: ranked_runs trg_ops_refresh_ranked_runs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ops_refresh_ranked_runs AFTER INSERT OR UPDATE ON public.ranked_runs FOR EACH STATEMENT EXECUTE FUNCTION public.touch_inha_duck_ops_refresh();


--
-- Name: ranked_sessions trg_ops_refresh_ranked_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ops_refresh_ranked_sessions AFTER INSERT OR UPDATE ON public.ranked_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.touch_inha_duck_ops_refresh();


--
-- Name: ranked_runs trg_ranked_run_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ranked_run_event AFTER INSERT ON public.ranked_runs FOR EACH ROW EXECUTE FUNCTION public.log_ranked_run_event();


--
-- Name: ranked_runs trg_ranked_runs_sync_common_run; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ranked_runs_sync_common_run AFTER INSERT OR UPDATE ON public.ranked_runs FOR EACH ROW EXECUTE FUNCTION public.trg_sync_inha_duck_ranked_result();


--
-- Name: ranked_sessions trg_ranked_session_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ranked_session_event AFTER INSERT OR UPDATE ON public.ranked_sessions FOR EACH ROW EXECUTE FUNCTION public.log_ranked_session_event();


--
-- Name: ranked_sessions trg_ranked_sessions_sync_common_run; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ranked_sessions_sync_common_run AFTER INSERT OR UPDATE ON public.ranked_sessions FOR EACH ROW EXECUTE FUNCTION public.trg_sync_inha_duck_ranked_session();


--
-- Name: world_guestbook_entries world_guestbook_normalize_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER world_guestbook_normalize_before_write BEFORE INSERT OR UPDATE OF content ON public.world_guestbook_entries FOR EACH ROW EXECUTE FUNCTION private.world_guestbook_normalize();


--
-- Name: inhagame_member_activity_daily inhagame_member_activity_daily_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.inhagame_member_activity_daily
    ADD CONSTRAINT inhagame_member_activity_daily_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_appearance_transactions world_appearance_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_appearance_transactions
    ADD CONSTRAINT world_appearance_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_attendance_days world_attendance_days_daily_reward_transaction_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_attendance_days
    ADD CONSTRAINT world_attendance_days_daily_reward_transaction_id_fkey FOREIGN KEY (daily_reward_transaction_id) REFERENCES private.world_reward_transactions(reward_transaction_id);


--
-- Name: world_attendance_days world_attendance_days_milestone_reward_transaction_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_attendance_days
    ADD CONSTRAINT world_attendance_days_milestone_reward_transaction_id_fkey FOREIGN KEY (milestone_reward_transaction_id) REFERENCES private.world_reward_transactions(reward_transaction_id);


--
-- Name: world_attendance_days world_attendance_days_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_attendance_days
    ADD CONSTRAINT world_attendance_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_biryong_progress_v1 world_biryong_progress_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_biryong_progress_v1
    ADD CONSTRAINT world_biryong_progress_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_currency_transactions world_currency_transactions_wallet_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_currency_transactions
    ADD CONSTRAINT world_currency_transactions_wallet_fkey FOREIGN KEY (user_id, currency_id) REFERENCES private.world_wallets(user_id, currency_id) ON DELETE CASCADE;


--
-- Name: world_daily_quiz_answers world_daily_quiz_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_answers
    ADD CONSTRAINT world_daily_quiz_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES private.world_daily_quiz_questions(question_id);


--
-- Name: world_daily_quiz_answers world_daily_quiz_answers_run_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_answers
    ADD CONSTRAINT world_daily_quiz_answers_run_id_fkey FOREIGN KEY (run_id) REFERENCES private.world_daily_quiz_runs(run_id) ON DELETE CASCADE;


--
-- Name: world_daily_quiz_runs world_daily_quiz_runs_reward_transaction_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_runs
    ADD CONSTRAINT world_daily_quiz_runs_reward_transaction_id_fkey FOREIGN KEY (reward_transaction_id) REFERENCES private.world_reward_transactions(reward_transaction_id);


--
-- Name: world_daily_quiz_runs world_daily_quiz_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_daily_quiz_runs
    ADD CONSTRAINT world_daily_quiz_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_event_progress world_event_progress_event_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_event_progress
    ADD CONSTRAINT world_event_progress_event_id_fkey FOREIGN KEY (event_id) REFERENCES private.world_events(event_id);


--
-- Name: world_event_progress world_event_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_event_progress
    ADD CONSTRAINT world_event_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_exp_transactions world_exp_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_exp_transactions
    ADD CONSTRAINT world_exp_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES private.world_player_progression(user_id) ON DELETE CASCADE;


--
-- Name: world_guestbook_post_log world_guestbook_post_log_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_guestbook_post_log
    ADD CONSTRAINT world_guestbook_post_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_item_grants world_item_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_item_grants
    ADD CONSTRAINT world_item_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_landlord_first_clears world_landlord_first_clears_event_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_first_clears
    ADD CONSTRAINT world_landlord_first_clears_event_id_fkey FOREIGN KEY (event_id) REFERENCES private.world_events(event_id);


--
-- Name: world_landlord_first_clears world_landlord_first_clears_run_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_first_clears
    ADD CONSTRAINT world_landlord_first_clears_run_id_fkey FOREIGN KEY (run_id) REFERENCES private.world_landlord_runs(run_id) ON DELETE CASCADE;


--
-- Name: world_landlord_first_clears world_landlord_first_clears_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_first_clears
    ADD CONSTRAINT world_landlord_first_clears_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_landlord_runs world_landlord_runs_event_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_runs
    ADD CONSTRAINT world_landlord_runs_event_id_fkey FOREIGN KEY (event_id) REFERENCES private.world_events(event_id);


--
-- Name: world_landlord_runs world_landlord_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_landlord_runs
    ADD CONSTRAINT world_landlord_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_event_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_event_id_fkey FOREIGN KEY (event_id) REFERENCES private.world_events(event_id);


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_reward_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES private.world_reward_definitions(reward_id);


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_reward_transaction_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_reward_transaction_id_fkey FOREIGN KEY (reward_transaction_id) REFERENCES private.world_reward_transactions(reward_transaction_id) ON DELETE CASCADE;


--
-- Name: world_mcm_reward_claims world_mcm_reward_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_mcm_reward_claims
    ADD CONSTRAINT world_mcm_reward_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_player_appearance_loadout world_player_appearance_loadout_owned; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_appearance_loadout
    ADD CONSTRAINT world_player_appearance_loadout_owned FOREIGN KEY (user_id, item_id) REFERENCES private.world_player_items(user_id, item_id) ON DELETE CASCADE;


--
-- Name: world_player_appearance_loadout world_player_appearance_loadout_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_appearance_loadout
    ADD CONSTRAINT world_player_appearance_loadout_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_player_items world_player_items_grant_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_items
    ADD CONSTRAINT world_player_items_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES private.world_item_grants(grant_id) ON DELETE CASCADE;


--
-- Name: world_player_items world_player_items_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_items
    ADD CONSTRAINT world_player_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_player_progression world_player_progression_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_player_progression
    ADD CONSTRAINT world_player_progression_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_purchase_transactions world_purchase_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_purchase_transactions
    ADD CONSTRAINT world_purchase_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_quest_progress_v1 world_quest_progress_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_quest_progress_v1
    ADD CONSTRAINT world_quest_progress_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_reward_grants world_reward_grants_reward_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_grants
    ADD CONSTRAINT world_reward_grants_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES private.world_reward_definitions(reward_id);


--
-- Name: world_reward_transaction_entries world_reward_transaction_entries_reward_transaction_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_transaction_entries
    ADD CONSTRAINT world_reward_transaction_entries_reward_transaction_id_fkey FOREIGN KEY (reward_transaction_id) REFERENCES private.world_reward_transactions(reward_transaction_id) ON DELETE CASCADE;


--
-- Name: world_reward_transactions world_reward_transactions_reward_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_transactions
    ADD CONSTRAINT world_reward_transactions_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES private.world_reward_definitions(reward_id);


--
-- Name: world_reward_transactions world_reward_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_reward_transactions
    ADD CONSTRAINT world_reward_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_shop_listings world_shop_listings_currency_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_shop_listings
    ADD CONSTRAINT world_shop_listings_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES private.world_currencies(currency_id);


--
-- Name: world_shop_listings world_shop_listings_shop_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_shop_listings
    ADD CONSTRAINT world_shop_listings_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES private.world_shops(shop_id);


--
-- Name: world_staff_assignments world_staff_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_staff_assignments
    ADD CONSTRAINT world_staff_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_user_moderation_actions world_user_moderation_actions_actor_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_user_moderation_actions
    ADD CONSTRAINT world_user_moderation_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: world_user_moderation_actions world_user_moderation_actions_report_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_user_moderation_actions
    ADD CONSTRAINT world_user_moderation_actions_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.world_user_reports(id) ON DELETE SET NULL;


--
-- Name: world_user_moderation_actions world_user_moderation_actions_target_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_user_moderation_actions
    ADD CONSTRAINT world_user_moderation_actions_target_id_fkey FOREIGN KEY (target_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_wallets world_wallets_currency_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_wallets
    ADD CONSTRAINT world_wallets_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES private.world_currencies(currency_id);


--
-- Name: world_wallets world_wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.world_wallets
    ADD CONSTRAINT world_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: classic_event_badges classic_event_badges_best_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classic_event_badges
    ADD CONSTRAINT classic_event_badges_best_run_id_fkey FOREIGN KEY (best_run_id) REFERENCES public.ranked_runs(id) ON DELETE RESTRICT;


--
-- Name: classic_event_badges classic_event_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classic_event_badges
    ADD CONSTRAINT classic_event_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: experiment_assignments experiment_assignments_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(id) ON DELETE CASCADE;


--
-- Name: experiment_assignments experiment_assignments_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: experiments experiments_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_builds game_builds_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_builds
    ADD CONSTRAINT game_builds_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_events game_events_build_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.game_builds(id);


--
-- Name: game_events game_events_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: game_events game_events_game_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_game_session_id_fkey FOREIGN KEY (game_session_id) REFERENCES public.game_sessions(id);


--
-- Name: game_events game_events_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: game_events game_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: game_sessions game_sessions_build_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.game_builds(id) ON DELETE SET NULL;


--
-- Name: game_sessions game_sessions_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_sessions game_sessions_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;


--
-- Name: general_stage_bests general_stage_bests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_stage_bests
    ADD CONSTRAINT general_stage_bests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: grow_rank_bests grow_rank_bests_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_bests
    ADD CONSTRAINT grow_rank_bests_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.grow_rank_runs(run_id);


--
-- Name: grow_rank_bests grow_rank_bests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_bests
    ADD CONSTRAINT grow_rank_bests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: grow_rank_runs grow_rank_runs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_runs
    ADD CONSTRAINT grow_rank_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.grow_rank_sessions(run_id) ON DELETE CASCADE;


--
-- Name: grow_rank_runs grow_rank_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_runs
    ADD CONSTRAINT grow_rank_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: grow_rank_sessions grow_rank_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_sessions
    ADD CONSTRAINT grow_rank_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: grow_rank_visibility grow_rank_visibility_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grow_rank_visibility
    ADD CONSTRAINT grow_rank_visibility_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_conversation_members hub_conversation_members_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversation_members
    ADD CONSTRAINT hub_conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.hub_conversations(id) ON DELETE CASCADE;


--
-- Name: hub_conversation_members hub_conversation_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversation_members
    ADD CONSTRAINT hub_conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_conversations hub_conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversations
    ADD CONSTRAINT hub_conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_conversations hub_conversations_user_high_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversations
    ADD CONSTRAINT hub_conversations_user_high_fkey FOREIGN KEY (user_high) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_conversations hub_conversations_user_low_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_conversations
    ADD CONSTRAINT hub_conversations_user_low_fkey FOREIGN KEY (user_low) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_message_reports hub_message_reports_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_message_reports
    ADD CONSTRAINT hub_message_reports_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.hub_messages(id) ON DELETE CASCADE;


--
-- Name: hub_message_reports hub_message_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_message_reports
    ADD CONSTRAINT hub_message_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_message_reports hub_message_reports_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_message_reports
    ADD CONSTRAINT hub_message_reports_target_id_fkey FOREIGN KEY (target_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hub_messages hub_messages_sender_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_messages
    ADD CONSTRAINT hub_messages_sender_member_fk FOREIGN KEY (conversation_id, sender_id) REFERENCES public.hub_conversation_members(conversation_id, user_id) ON DELETE CASCADE;


--
-- Name: induckup_ranked_bests induckup_ranked_bests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.induckup_ranked_bests
    ADD CONSTRAINT induckup_ranked_bests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: inha_mail_badges inha_mail_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inha_mail_badges
    ADD CONSTRAINT inha_mail_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ops_event_mappings ops_event_mappings_canonical_event_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_event_mappings
    ADD CONSTRAINT ops_event_mappings_canonical_event_fkey FOREIGN KEY (canonical_event) REFERENCES public.ops_event_contracts(canonical_event);


--
-- Name: ops_event_mappings ops_event_mappings_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_event_mappings
    ADD CONSTRAINT ops_event_mappings_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: ops_lifecycle_profiles ops_lifecycle_profiles_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_lifecycle_profiles
    ADD CONSTRAINT ops_lifecycle_profiles_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: player_bests player_bests_best_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_bests
    ADD CONSTRAINT player_bests_best_run_id_fkey FOREIGN KEY (best_run_id) REFERENCES public.ranked_runs(id) ON DELETE RESTRICT;


--
-- Name: player_bests player_bests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_bests
    ADD CONSTRAINT player_bests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: player_identity_links player_identity_links_canonical_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_identity_links
    ADD CONSTRAINT player_identity_links_canonical_player_id_fkey FOREIGN KEY (canonical_player_id) REFERENCES public.players(id) ON DELETE RESTRICT;


--
-- Name: players players_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ranked_recovery_eligibility ranked_recovery_eligibility_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_recovery_eligibility
    ADD CONSTRAINT ranked_recovery_eligibility_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ranked_recovery_records ranked_recovery_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_recovery_records
    ADD CONSTRAINT ranked_recovery_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ranked_runs ranked_runs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_runs
    ADD CONSTRAINT ranked_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.ranked_sessions(run_id) ON DELETE CASCADE;


--
-- Name: ranked_runs ranked_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_runs
    ADD CONSTRAINT ranked_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ranked_sessions ranked_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranked_sessions
    ADD CONSTRAINT ranked_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: runs runs_build_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.game_builds(id) ON DELETE SET NULL;


--
-- Name: runs runs_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: runs runs_game_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_game_session_id_fkey FOREIGN KEY (game_session_id) REFERENCES public.game_sessions(id) ON DELETE SET NULL;


--
-- Name: runs runs_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;


--
-- Name: user_achievements user_achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_game_progress user_game_progress_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_game_progress
    ADD CONSTRAINT user_game_progress_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: user_game_progress user_game_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_game_progress
    ADD CONSTRAINT user_game_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_accompany_sessions world_accompany_sessions_invitee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_accompany_sessions
    ADD CONSTRAINT world_accompany_sessions_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_accompany_sessions world_accompany_sessions_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_accompany_sessions
    ADD CONSTRAINT world_accompany_sessions_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_friendships world_friendships_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_friendships
    ADD CONSTRAINT world_friendships_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_friendships world_friendships_user_high_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_friendships
    ADD CONSTRAINT world_friendships_user_high_fkey FOREIGN KEY (user_high) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_friendships world_friendships_user_low_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_friendships
    ADD CONSTRAINT world_friendships_user_low_fkey FOREIGN KEY (user_low) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_guestbook_entries world_guestbook_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_guestbook_entries
    ADD CONSTRAINT world_guestbook_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_online_sessions world_online_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_online_sessions
    ADD CONSTRAINT world_online_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: world_player_rooms world_player_rooms_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_player_rooms
    ADD CONSTRAINT world_player_rooms_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_user_blocks world_user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_user_blocks
    ADD CONSTRAINT world_user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_user_blocks world_user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_user_blocks
    ADD CONSTRAINT world_user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_user_reports world_user_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_user_reports
    ADD CONSTRAINT world_user_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: world_user_reports world_user_reports_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_user_reports
    ADD CONSTRAINT world_user_reports_target_id_fkey FOREIGN KEY (target_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: inhagame_member_activity_daily; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.inhagame_member_activity_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: world_appearance_transactions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_appearance_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_attendance_days; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_attendance_days ENABLE ROW LEVEL SECURITY;

--
-- Name: world_biryong_progress_v1; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_biryong_progress_v1 ENABLE ROW LEVEL SECURITY;

--
-- Name: world_currencies; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_currencies ENABLE ROW LEVEL SECURITY;

--
-- Name: world_currency_transactions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_currency_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_daily_quiz_answers; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_daily_quiz_answers ENABLE ROW LEVEL SECURITY;

--
-- Name: world_daily_quiz_questions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_daily_quiz_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_daily_quiz_runs; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_daily_quiz_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: world_event_progress; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_event_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: world_events; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_events ENABLE ROW LEVEL SECURITY;

--
-- Name: world_exp_transactions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_exp_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_item_catalog; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_item_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: world_item_grants; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_item_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: world_landlord_first_clears; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_landlord_first_clears ENABLE ROW LEVEL SECURITY;

--
-- Name: world_landlord_runs; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_landlord_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: world_level_thresholds; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_level_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: world_mcm_reward_claims; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_mcm_reward_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: world_npc_ai_daily_calls; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_npc_ai_daily_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: world_npc_shared_ticks_v1; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_npc_shared_ticks_v1 ENABLE ROW LEVEL SECURITY;

--
-- Name: world_player_appearance_loadout; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_player_appearance_loadout ENABLE ROW LEVEL SECURITY;

--
-- Name: world_player_items; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_player_items ENABLE ROW LEVEL SECURITY;

--
-- Name: world_player_progression; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_player_progression ENABLE ROW LEVEL SECURITY;

--
-- Name: world_purchase_transactions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_purchase_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_quest_progress_v1; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_quest_progress_v1 ENABLE ROW LEVEL SECURITY;

--
-- Name: world_reward_definitions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_reward_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_reward_grants; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_reward_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: world_reward_transaction_entries; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_reward_transaction_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: world_reward_transactions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_reward_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_shop_listings; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_shop_listings ENABLE ROW LEVEL SECURITY;

--
-- Name: world_shops; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_shops ENABLE ROW LEVEL SECURITY;

--
-- Name: world_staff_assignments; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_staff_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: world_staff_role_permissions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_staff_role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_wallets; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.world_wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: user_game_progress Permanent users insert own game progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permanent users insert own game progress" ON public.user_game_progress FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND (COALESCE(((auth.jwt() ->> 'is_anonymous'::text))::boolean, true) = false)));


--
-- Name: user_game_progress Permanent users read own game progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permanent users read own game progress" ON public.user_game_progress FOR SELECT TO authenticated USING (((auth.uid() = user_id) AND (COALESCE(((auth.jwt() ->> 'is_anonymous'::text))::boolean, true) = false)));


--
-- Name: user_game_progress Permanent users update own game progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permanent users update own game progress" ON public.user_game_progress FOR UPDATE TO authenticated USING (((auth.uid() = user_id) AND (COALESCE(((auth.jwt() ->> 'is_anonymous'::text))::boolean, true) = false))) WITH CHECK (((auth.uid() = user_id) AND (COALESCE(((auth.jwt() ->> 'is_anonymous'::text))::boolean, true) = false)));


--
-- Name: classic_event_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classic_event_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: departments departments_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_public_read ON public.departments FOR SELECT TO authenticated, anon USING ((active = true));


--
-- Name: experiment_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: experiments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: game_builds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_builds ENABLE ROW LEVEL SECURITY;

--
-- Name: game_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;

--
-- Name: game_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

--
-- Name: general_stage_bests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.general_stage_bests ENABLE ROW LEVEL SECURITY;

--
-- Name: grow_rank_bests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grow_rank_bests ENABLE ROW LEVEL SECURITY;

--
-- Name: grow_rank_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grow_rank_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: grow_rank_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grow_rank_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: grow_rank_visibility; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grow_rank_visibility ENABLE ROW LEVEL SECURITY;

--
-- Name: hub_conversation_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hub_conversation_members ENABLE ROW LEVEL SECURITY;

--
-- Name: hub_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hub_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: hub_message_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hub_message_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: hub_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hub_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: induck_grow_analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.induck_grow_analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: induck_grow_decision_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.induck_grow_decision_events ENABLE ROW LEVEL SECURITY;

--
-- Name: induck_grow_resource_checkpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.induck_grow_resource_checkpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: induck_grow_session_ends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.induck_grow_session_ends ENABLE ROW LEVEL SECURITY;

--
-- Name: induckup_ranked_bests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.induckup_ranked_bests ENABLE ROW LEVEL SECURITY;

--
-- Name: inha_duck_ops_auth_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inha_duck_ops_auth_state ENABLE ROW LEVEL SECURITY;

--
-- Name: inha_duck_ops_refresh; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inha_duck_ops_refresh ENABLE ROW LEVEL SECURITY;

--
-- Name: inha_duck_ops_refresh inha_duck_ops_refresh_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inha_duck_ops_refresh_read ON public.inha_duck_ops_refresh FOR SELECT TO authenticated, anon USING (true);


--
-- Name: inha_mail_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inha_mail_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: inhagame_hub_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inhagame_hub_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_alert_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_alert_state ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_event_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_event_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_event_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_event_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_lifecycle_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_lifecycle_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: player_bests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_bests ENABLE ROW LEVEL SECURITY;

--
-- Name: player_identity_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_identity_links ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles profiles_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles profiles_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ranked_recovery_eligibility; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ranked_recovery_eligibility ENABLE ROW LEVEL SECURITY;

--
-- Name: ranked_recovery_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ranked_recovery_records ENABLE ROW LEVEL SECURITY;

--
-- Name: ranked_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ranked_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: ranked_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ranked_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_achievements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

--
-- Name: user_achievements user_achievements_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_achievements_self_read ON public.user_achievements FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(((auth.jwt() ->> 'is_anonymous'::text))::boolean, true) = false)));


--
-- Name: user_game_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_game_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: world_accompany_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_accompany_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_friendships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_friendships ENABLE ROW LEVEL SECURITY;

--
-- Name: world_guestbook_entries world_guestbook_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY world_guestbook_delete_own ON public.world_guestbook_entries FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, true) = false) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.is_banned = false))))));


--
-- Name: world_guestbook_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_guestbook_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: world_guestbook_entries world_guestbook_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY world_guestbook_insert_own ON public.world_guestbook_entries FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (is_hidden = false) AND (location_key = 'main_gate'::text) AND (COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, true) = false) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.is_banned = false))))));


--
-- Name: world_guestbook_entries world_guestbook_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY world_guestbook_read ON public.world_guestbook_entries FOR SELECT TO authenticated USING (((is_hidden = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, true) = false) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.is_banned = false))))));


--
-- Name: world_guestbook_entries world_guestbook_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY world_guestbook_update_own ON public.world_guestbook_entries FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (is_hidden = false) AND (COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, true) = false) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.is_banned = false)))))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (is_hidden = false) AND (location_key = 'main_gate'::text) AND (COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, true) = false) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.is_banned = false))))));


--
-- Name: world_online_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_online_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: world_player_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_player_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: world_user_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_user_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: world_user_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.world_user_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA private TO service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION hub_message_caller(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.hub_message_caller() FROM PUBLIC;


--
-- Name: FUNCTION hub_message_card(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.hub_message_card(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION hub_message_inha_verified(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.hub_message_inha_verified(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION hub_message_lock_pair(p_a uuid, p_b uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.hub_message_lock_pair(p_a uuid, p_b uuid) FROM PUBLIC;


--
-- Name: FUNCTION hub_message_lock_sender(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.hub_message_lock_sender(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION hub_message_target(p_caller uuid, p_target uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.hub_message_target(p_caller uuid, p_target uuid) FROM PUBLIC;


--
-- Name: FUNCTION inha_duck_ops_basic_digest_valid_v1(p_value text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.inha_duck_ops_basic_digest_valid_v1(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION inha_duck_ops_credential_valid_v1(p_value text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.inha_duck_ops_credential_valid_v1(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION install_world_online_realtime_policies(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.install_world_online_realtime_policies() FROM PUBLIC;


--
-- Name: FUNCTION purge_game_events_90d(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_game_events_90d() FROM PUBLIC;


--
-- Name: FUNCTION purge_induck_grow_analytics_90d(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_induck_grow_analytics_90d() FROM PUBLIC;


--
-- Name: FUNCTION purge_induck_grow_decisions_90d(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_induck_grow_decisions_90d() FROM PUBLIC;


--
-- Name: FUNCTION purge_induck_grow_p2a_90d(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_induck_grow_p2a_90d() FROM PUBLIC;


--
-- Name: FUNCTION purge_inhagame_hub_events_90d(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_inhagame_hub_events_90d() FROM PUBLIC;


--
-- Name: FUNCTION purge_world_accompany_1d(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_world_accompany_1d() FROM PUBLIC;


--
-- Name: FUNCTION world_accompany_expire(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_accompany_expire(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_accompany_lock_users(p_a uuid, p_b uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_accompany_lock_users(p_a uuid, p_b uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_admin_caller_v1(p_permission text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_admin_caller_v1(p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.world_admin_caller_v1(p_permission text) TO service_role;


--
-- Name: FUNCTION world_appearance_caller_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_appearance_caller_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_appearance_loadout_json_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_appearance_loadout_json_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_appearance_record_v1(p_user uuid, p_key text, p_action text, p_slot text, p_requested text, p_previous text, p_next text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_appearance_record_v1(p_user uuid, p_key text, p_action text, p_slot text, p_requested text, p_previous text, p_next text) FROM PUBLIC;


--
-- Name: FUNCTION world_appearance_result_v1(p_tx private.world_appearance_transactions, p_replayed boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_appearance_result_v1(p_tx private.world_appearance_transactions, p_replayed boolean) FROM PUBLIC;


--
-- Name: FUNCTION world_appearance_slot_ok_v1(p_slot text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_appearance_slot_ok_v1(p_slot text) FROM PUBLIC;


--
-- Name: FUNCTION world_appearance_transactions_append_only_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_appearance_transactions_append_only_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_attendance_caller_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_attendance_caller_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_attendance_claim_v1(p_user uuid, p_today date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_attendance_claim_v1(p_user uuid, p_today date) FROM PUBLIC;


--
-- Name: FUNCTION world_attendance_milestone_coin_v1(p_days integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_attendance_milestone_coin_v1(p_days integer) FROM PUBLIC;


--
-- Name: FUNCTION world_attendance_state_v1(p_user uuid, p_today date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_attendance_state_v1(p_user uuid, p_today date) FROM PUBLIC;


--
-- Name: FUNCTION world_attendance_today_v1(p_now timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_attendance_today_v1(p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION world_card(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_card(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_currency_transactions_append_only_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_currency_transactions_append_only_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_daily_quiz_account_ok_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_daily_quiz_account_ok_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_daily_quiz_caller_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_daily_quiz_caller_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_daily_quiz_reward_view_v1(p_reward jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_daily_quiz_reward_view_v1(p_reward jsonb) FROM PUBLIC;


--
-- Name: FUNCTION world_daily_quiz_state_v1(p_user uuid, p_date date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_daily_quiz_state_v1(p_user uuid, p_date date) FROM PUBLIC;


--
-- Name: FUNCTION world_daily_quiz_today_v1(p_now timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_daily_quiz_today_v1(p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION world_event_state_v1(p_event private.world_events, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_event_state_v1(p_event private.world_events, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION world_exp_apply_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_exp_apply_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text) FROM PUBLIC;


--
-- Name: FUNCTION world_exp_result_v1(p_tx private.world_exp_transactions, p_status text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_exp_result_v1(p_tx private.world_exp_transactions, p_status text) FROM PUBLIC;


--
-- Name: FUNCTION world_exp_transactions_append_only_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_exp_transactions_append_only_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_guestbook_entry_json(p_entry_id uuid, p_viewer uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_guestbook_entry_json(p_entry_id uuid, p_viewer uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_guestbook_normalize(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_guestbook_normalize() FROM PUBLIC;


--
-- Name: FUNCTION world_inventory_account_ok_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_inventory_account_ok_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_inventory_grant_result_v1(p_grant private.world_item_grants, p_status text, p_acquired_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_inventory_grant_result_v1(p_grant private.world_item_grants, p_status text, p_acquired_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION world_inventory_grant_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text, p_metadata jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_inventory_grant_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text, p_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION world_inventory_item_json_v1(p_item private.world_player_items, p_catalog_status text, p_server_view boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_inventory_item_json_v1(p_item private.world_player_items, p_catalog_status text, p_server_view boolean) FROM PUBLIC;


--
-- Name: FUNCTION world_item_grants_append_only_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_item_grants_append_only_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_landlord_pick_survivor_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_landlord_pick_survivor_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_level_for_exp_v1(p_total_exp bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_level_for_exp_v1(p_total_exp bigint) FROM PUBLIC;


--
-- Name: FUNCTION world_level_thresholds_immutable_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_level_thresholds_immutable_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_level_thresholds_validate_insert_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_level_thresholds_validate_insert_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_lock_pair(p_a uuid, p_b uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_lock_pair(p_a uuid, p_b uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_mcm_account_ok_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_mcm_account_ok_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_mcm_claim_result_v1(p_claim_type text, p_status text, p_replayed boolean, p_reward_transaction_id uuid, p_claimed_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_mcm_claim_result_v1(p_claim_type text, p_status text, p_replayed boolean, p_reward_transaction_id uuid, p_claimed_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION world_mcm_claim_reward_v1(p_user uuid, p_claim_type text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_mcm_claim_reward_v1(p_user uuid, p_claim_type text) FROM PUBLIC;


--
-- Name: FUNCTION world_mcm_reward_claims_final_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_mcm_reward_claims_final_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_mcm_state_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_mcm_state_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_mcm_try_complete_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_mcm_try_complete_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_ops_read_allowed_v1(p_token text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_ops_read_allowed_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.world_ops_read_allowed_v1(p_token text) TO service_role;


--
-- Name: FUNCTION world_player_level_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_player_level_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_progression_account_ok_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_progression_account_ok_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_progression_snapshot_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_progression_snapshot_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_purchase_result_v1(p_purchase_id uuid, p_replayed boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_purchase_result_v1(p_purchase_id uuid, p_replayed boolean) FROM PUBLIC;


--
-- Name: FUNCTION world_purchase_transactions_append_only_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_purchase_transactions_append_only_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_relationship(p_caller uuid, p_target uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_relationship(p_caller uuid, p_target uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_reward_final_rows_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_reward_final_rows_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text) FROM PUBLIC;


--
-- Name: FUNCTION world_reward_grants_validate_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_reward_grants_validate_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_reward_result_v1(p_reward_transaction_id uuid, p_replayed boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_reward_result_v1(p_reward_transaction_id uuid, p_replayed boolean) FROM PUBLIC;


--
-- Name: FUNCTION world_room_caller_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_room_caller_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_shop_listing_block_v2(p_listing private.world_shop_listings, p_now timestamp with time zone, p_player_level integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_shop_listing_block_v2(p_listing private.world_shop_listings, p_now timestamp with time zone, p_player_level integer) FROM PUBLIC;


--
-- Name: FUNCTION world_shop_listings_validate_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_shop_listings_validate_v1() FROM PUBLIC;


--
-- Name: FUNCTION world_social_caller(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_social_caller() FROM PUBLIC;


--
-- Name: FUNCTION world_social_target(p_caller uuid, p_target uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_social_target(p_caller uuid, p_target uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_wallet_account_ok_v1(p_user uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_wallet_account_ok_v1(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION world_wallet_apply_v1(p_user uuid, p_currency_id text, p_delta bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_wallet_apply_v1(p_user uuid, p_currency_id text, p_delta bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text) FROM PUBLIC;


--
-- Name: FUNCTION world_wallet_result_v1(p_tx private.world_currency_transactions, p_status text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.world_wallet_result_v1(p_tx private.world_currency_transactions, p_status text) FROM PUBLIC;


--
-- Name: FUNCTION abandon_ranked_session_v1(p_run_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.abandon_ranked_session_v1(p_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abandon_ranked_session_v1(p_run_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.abandon_ranked_session_v1(p_run_id uuid) TO service_role;


--
-- Name: FUNCTION admin_review_world_user_report_v1(p_report_id bigint, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_review_world_user_report_v1(p_report_id bigint, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_review_world_user_report_v1(p_report_id bigint, p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_review_world_user_report_v1(p_report_id bigint, p_action text) TO service_role;


--
-- Name: FUNCTION advance_mcm_2026_event_v1(p_user uuid, p_event text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.advance_mcm_2026_event_v1(p_user uuid, p_event text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_mcm_2026_event_v1(p_user uuid, p_event text) TO service_role;


--
-- Name: FUNCTION advance_world_navigation_quest_v1(p_user uuid, p_event text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.advance_world_navigation_quest_v1(p_user uuid, p_event text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_world_navigation_quest_v1(p_user uuid, p_event text) TO service_role;


--
-- Name: FUNCTION advance_world_quest_v1(p_user uuid, p_event text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.advance_world_quest_v1(p_user uuid, p_event text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_world_quest_v1(p_user uuid, p_event text) TO service_role;


--
-- Name: FUNCTION answer_my_world_daily_quiz_v1(p_run_id uuid, p_question_id text, p_answer_index smallint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.answer_my_world_daily_quiz_v1(p_run_id uuid, p_question_id text, p_answer_index smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.answer_my_world_daily_quiz_v1(p_run_id uuid, p_question_id text, p_answer_index smallint) TO authenticated;


--
-- Name: FUNCTION archive_hub_conversation_v1(p_conversation uuid, p_archived boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.archive_hub_conversation_v1(p_conversation uuid, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.archive_hub_conversation_v1(p_conversation uuid, p_archived boolean) TO authenticated;


--
-- Name: FUNCTION attach_inha_duck_event_context(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.attach_inha_duck_event_context() FROM PUBLIC;
GRANT ALL ON FUNCTION public.attach_inha_duck_event_context() TO service_role;


--
-- Name: FUNCTION block_world_user(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.block_world_user(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.block_world_user(p_target uuid) TO authenticated;


--
-- Name: FUNCTION cancel_world_friend_request(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_world_friend_request(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_world_friend_request(p_target uuid) TO authenticated;


--
-- Name: FUNCTION claim_inha_mail_badge(p_primary_id uuid, p_school_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_inha_mail_badge(p_primary_id uuid, p_school_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_inha_mail_badge(p_primary_id uuid, p_school_id uuid) TO service_role;


--
-- Name: FUNCTION claim_my_mcm_2026_main_reward_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_my_mcm_2026_main_reward_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_my_mcm_2026_main_reward_v1() TO authenticated;


--
-- Name: FUNCTION claim_my_mcm_landlord_first_clear_reward_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_my_mcm_landlord_first_clear_reward_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_my_mcm_landlord_first_clear_reward_v1() TO authenticated;


--
-- Name: FUNCTION claim_my_world_attendance_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_my_world_attendance_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_my_world_attendance_v1() TO authenticated;


--
-- Name: FUNCTION claim_world_npc_ai_call_v1(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_world_npc_ai_call_v1(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_world_npc_ai_call_v1(p_user uuid) TO service_role;


--
-- Name: FUNCTION claim_world_npc_shared_tick_v1(p_period text, p_tick bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_world_npc_shared_tick_v1(p_period text, p_tick bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_world_npc_shared_tick_v1(p_period text, p_tick bigint) TO service_role;


--
-- Name: FUNCTION commit_world_npc_shared_tick_v1(p_period text, p_tick bigint, p_effective_at_ms bigint, p_decisions jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.commit_world_npc_shared_tick_v1(p_period text, p_tick bigint, p_effective_at_ms bigint, p_decisions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.commit_world_npc_shared_tick_v1(p_period text, p_tick bigint, p_effective_at_ms bigint, p_decisions jsonb) TO service_role;


--
-- Name: FUNCTION create_qa_ranked_session(p_user_id uuid, p_client_version text, p_ruleset_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_qa_ranked_session(p_user_id uuid, p_client_version text, p_ruleset_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_qa_ranked_session(p_user_id uuid, p_client_version text, p_ruleset_version text) TO service_role;


--
-- Name: FUNCTION create_world_guestbook_entry_v2(p_content text, p_location_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_world_guestbook_entry_v2(p_content text, p_location_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_world_guestbook_entry_v2(p_content text, p_location_key text) TO authenticated;


--
-- Name: FUNCTION delete_my_grow_progress(p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_my_grow_progress(p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_my_grow_progress(p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION delete_my_inhagame_account_v1(p_confirmation text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_my_inhagame_account_v1(p_confirmation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_my_inhagame_account_v1(p_confirmation text) TO authenticated;


--
-- Name: FUNCTION delete_world_guestbook_entry_v1(p_location_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_world_guestbook_entry_v1(p_location_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_world_guestbook_entry_v1(p_location_key text) TO authenticated;


--
-- Name: FUNCTION delete_world_guestbook_entry_v2(p_entry_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_world_guestbook_entry_v2(p_entry_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_world_guestbook_entry_v2(p_entry_id uuid) TO authenticated;


--
-- Name: FUNCTION end_world_accompany(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.end_world_accompany(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.end_world_accompany(p_session_id uuid) TO authenticated;


--
-- Name: FUNCTION equip_my_world_item_v1(p_slot text, p_item_id text, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.equip_my_world_item_v1(p_slot text, p_item_id text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.equip_my_world_item_v1(p_slot text, p_item_id text, p_idempotency_key text) TO authenticated;


--
-- Name: FUNCTION expire_ranked_sessions_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_ranked_sessions_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_ranked_sessions_v1() TO service_role;


--
-- Name: FUNCTION finish_grow_rank_v1(p_run_id uuid, p_user_id uuid, p_nonce uuid, p_department text, p_twice_points integer, p_credits integer, p_reject_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finish_grow_rank_v1(p_run_id uuid, p_user_id uuid, p_nonce uuid, p_department text, p_twice_points integer, p_credits integer, p_reject_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_grow_rank_v1(p_run_id uuid, p_user_id uuid, p_nonce uuid, p_department text, p_twice_points integer, p_credits integer, p_reject_reason text) TO service_role;


--
-- Name: FUNCTION general_badge_code(p_score integer, p_stars integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.general_badge_code(p_score integer, p_stars integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.general_badge_code(p_score integer, p_stars integer) TO service_role;


--
-- Name: FUNCTION get_general_leaderboard(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_general_leaderboard(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_general_leaderboard(p_department_id bigint, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_general_leaderboard_v2(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_general_leaderboard_v2(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v2(p_department_id bigint, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_general_leaderboard_v3(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_general_leaderboard_v3(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v3(p_department_id bigint, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v3(p_department_id bigint, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v3(p_department_id bigint, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_general_leaderboard_v4(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_general_leaderboard_v4(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v4(p_department_id bigint, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v4(p_department_id bigint, p_limit integer) TO authenticated;


--
-- Name: FUNCTION get_general_leaderboard_v5(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_general_leaderboard_v5(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v5(p_department_id bigint, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_general_leaderboard_v5(p_department_id bigint, p_limit integer) TO authenticated;


--
-- Name: FUNCTION get_grow_rank_board(p_department text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_grow_rank_board(p_department text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_grow_rank_board(p_department text) TO anon;
GRANT ALL ON FUNCTION public.get_grow_rank_board(p_department text) TO authenticated;


--
-- Name: FUNCTION get_hub_messages_v1(p_conversation uuid, p_limit integer, p_before timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_hub_messages_v1(p_conversation uuid, p_limit integer, p_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_hub_messages_v1(p_conversation uuid, p_limit integer, p_before timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION get_induck_grow_ops_p1_core_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_induck_grow_ops_p1_core_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_induck_grow_ops_p1_core_v1() TO service_role;


--
-- Name: FUNCTION get_induck_grow_ops_p2a_core_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_induck_grow_ops_p2a_core_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_induck_grow_ops_p2a_core_v1() TO service_role;


--
-- Name: FUNCTION get_induck_grow_ops_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_induck_grow_ops_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_induck_grow_ops_v1() TO service_role;


--
-- Name: FUNCTION get_induckup_ranked_leaderboard_v1(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_induckup_ranked_leaderboard_v1(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_induckup_ranked_leaderboard_v1(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_induckup_ranked_leaderboard_v1(p_limit integer) TO authenticated;


--
-- Name: FUNCTION get_inha_duck_behavior_metrics_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_behavior_metrics_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_behavior_metrics_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_ops_core_private_v1(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_ops_core_private_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_ops_core_private_v1(p_token text) TO service_role;


--
-- Name: FUNCTION get_inha_duck_ops_dashboard_core_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_ops_dashboard_core_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_ops_dashboard_core_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_ops_dashboard_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_ops_dashboard_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_ops_dashboard_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_ops_private_v1(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_ops_private_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_ops_private_v1(p_token text) TO service_role;
GRANT ALL ON FUNCTION public.get_inha_duck_ops_private_v1(p_token text) TO authenticated;


--
-- Name: FUNCTION get_inha_duck_ranked_lifecycle_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_ranked_lifecycle_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_ranked_lifecycle_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_ranked_lifecycle_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_ranked_lifecycle_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_ranked_lifecycle_v2() TO service_role;


--
-- Name: FUNCTION get_inha_duck_stage3_sample_alert_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_stage3_sample_alert_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_stage3_sample_alert_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_stage3_sample_gate_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_stage3_sample_gate_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_stage3_sample_gate_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_stage_transition_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_stage_transition_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_stage_transition_v1() TO service_role;


--
-- Name: FUNCTION get_inha_duck_visit_intent_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inha_duck_visit_intent_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inha_duck_visit_intent_v1() TO service_role;


--
-- Name: FUNCTION get_inhagame_hub_ops_core_p1_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inhagame_hub_ops_core_p1_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inhagame_hub_ops_core_p1_v1() TO service_role;


--
-- Name: FUNCTION get_inhagame_hub_ops_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inhagame_hub_ops_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inhagame_hub_ops_v1() TO service_role;


--
-- Name: FUNCTION get_inhagame_member_activity_ops_v1(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inhagame_member_activity_ops_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inhagame_member_activity_ops_v1(p_token text) TO service_role;
GRANT ALL ON FUNCTION public.get_inhagame_member_activity_ops_v1(p_token text) TO authenticated;


--
-- Name: FUNCTION get_inhagame_member_ops_v1(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inhagame_member_ops_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inhagame_member_ops_v1(p_token text) TO service_role;
GRANT ALL ON FUNCTION public.get_inhagame_member_ops_v1(p_token text) TO authenticated;


--
-- Name: FUNCTION get_leaderboard(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_leaderboard(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_leaderboard(p_department_id bigint, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_leaderboard_v2(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_leaderboard_v2(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_leaderboard_v2(p_department_id bigint, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_leaderboard_v3(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_leaderboard_v3(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_leaderboard_v3(p_department_id bigint, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_leaderboard_v3(p_department_id bigint, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_leaderboard_v3(p_department_id bigint, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_leaderboard_v4(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_leaderboard_v4(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_leaderboard_v4(p_department_id bigint, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_leaderboard_v4(p_department_id bigint, p_limit integer) TO authenticated;


--
-- Name: FUNCTION get_leaderboard_v5(p_department_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_leaderboard_v5(p_department_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_leaderboard_v5(p_department_id bigint, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_leaderboard_v5(p_department_id bigint, p_limit integer) TO authenticated;


--
-- Name: FUNCTION get_my_achievements(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_achievements() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_achievements() TO authenticated;


--
-- Name: FUNCTION get_my_biryong_progress_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_biryong_progress_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_biryong_progress_v1() TO authenticated;


--
-- Name: FUNCTION get_my_game_progress(p_game_slug text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_game_progress(p_game_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_game_progress(p_game_slug text) TO authenticated;


--
-- Name: FUNCTION get_my_general_rank(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_general_rank() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_general_rank() TO service_role;


--
-- Name: FUNCTION get_my_general_rank_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_general_rank_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_general_rank_v2() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_general_rank_v2() TO service_role;


--
-- Name: FUNCTION get_my_general_rank_v3(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_general_rank_v3() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_general_rank_v3() TO authenticated;


--
-- Name: FUNCTION get_my_grow_rank_visibility(p_department text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_grow_rank_visibility(p_department text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_grow_rank_visibility(p_department text) TO authenticated;


--
-- Name: FUNCTION get_my_hub_conversations_v1(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_hub_conversations_v1(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_hub_conversations_v1(p_limit integer) TO authenticated;


--
-- Name: FUNCTION get_my_hub_unread_count_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_hub_unread_count_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_hub_unread_count_v1() TO authenticated;


--
-- Name: FUNCTION get_my_induckup_rank_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_induckup_rank_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_induckup_rank_v1() TO authenticated;


--
-- Name: FUNCTION get_my_mcm_2026_event_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_mcm_2026_event_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_mcm_2026_event_v1() TO authenticated;


--
-- Name: FUNCTION get_my_profile(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_profile() TO authenticated;


--
-- Name: FUNCTION get_my_rank(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_rank() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_rank() TO service_role;


--
-- Name: FUNCTION get_my_rank_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_rank_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_rank_v2() TO service_role;


--
-- Name: FUNCTION get_my_rank_v3(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_rank_v3() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_rank_v3() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_rank_v3() TO service_role;


--
-- Name: FUNCTION get_my_rank_v4(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_rank_v4() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_rank_v4() TO authenticated;


--
-- Name: FUNCTION get_my_world_accompany(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_accompany() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_accompany() TO authenticated;


--
-- Name: FUNCTION get_my_world_admin_access_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_admin_access_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_admin_access_v1() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_world_admin_access_v1() TO service_role;


--
-- Name: FUNCTION get_my_world_appearance_loadout_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_appearance_loadout_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_appearance_loadout_v1() TO authenticated;


--
-- Name: FUNCTION get_my_world_attendance_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_attendance_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_attendance_v1() TO authenticated;


--
-- Name: FUNCTION get_my_world_daily_quiz_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_daily_quiz_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_daily_quiz_v1() TO authenticated;


--
-- Name: FUNCTION get_my_world_inventory_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_inventory_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_inventory_v1() TO authenticated;


--
-- Name: FUNCTION get_my_world_moderation_admin_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_moderation_admin_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_moderation_admin_v1() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_world_moderation_admin_v1() TO service_role;


--
-- Name: FUNCTION get_my_world_progression_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_progression_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_progression_v1() TO authenticated;


--
-- Name: FUNCTION get_my_world_social(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_social() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_social() TO authenticated;


--
-- Name: FUNCTION get_my_world_wallet_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_world_wallet_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_world_wallet_v1() TO authenticated;


--
-- Name: FUNCTION get_or_create_my_personal_room_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_or_create_my_personal_room_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_or_create_my_personal_room_v1() TO authenticated;


--
-- Name: FUNCTION get_world_guestbook_v1(p_location_key text, p_limit integer, p_before timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_guestbook_v1(p_location_key text, p_limit integer, p_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_guestbook_v1(p_location_key text, p_limit integer, p_before timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION get_world_guestbook_v2(p_location_key text, p_limit integer, p_before timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_guestbook_v2(p_location_key text, p_limit integer, p_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_guestbook_v2(p_location_key text, p_limit integer, p_before timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION get_world_moderation_ops_v1(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_moderation_ops_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_moderation_ops_v1(p_token text) TO service_role;


--
-- Name: FUNCTION get_world_npc_shared_state_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_npc_shared_state_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_npc_shared_state_v1() TO service_role;


--
-- Name: FUNCTION get_world_online_count_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_online_count_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_online_count_v1() TO anon;
GRANT ALL ON FUNCTION public.get_world_online_count_v1() TO authenticated;
GRANT ALL ON FUNCTION public.get_world_online_count_v1() TO service_role;


--
-- Name: FUNCTION get_world_online_ops_v1(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_online_ops_v1(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_online_ops_v1(p_token text) TO service_role;
GRANT ALL ON FUNCTION public.get_world_online_ops_v1(p_token text) TO authenticated;


--
-- Name: FUNCTION get_world_public_profile(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_public_profile(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_public_profile(p_target uuid) TO authenticated;


--
-- Name: FUNCTION get_world_relationship(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_relationship(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_relationship(p_target uuid) TO authenticated;


--
-- Name: FUNCTION get_world_shop_v1(p_shop_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_world_shop_v1(p_shop_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_world_shop_v1(p_shop_id text) TO authenticated;


--
-- Name: FUNCTION induckup_merge_meta_v1(old_meta jsonb, new_meta jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.induckup_merge_meta_v1(old_meta jsonb, new_meta jsonb) FROM PUBLIC;


--
-- Name: FUNCTION is_permanent_account(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_permanent_account() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_permanent_account() TO authenticated;


--
-- Name: FUNCTION log_general_progression_event_v1(p_event_type text, p_stage_id smallint, p_target_stage_id smallint, p_run_id uuid, p_clear boolean, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_progression_event_v1(p_event_type text, p_stage_id smallint, p_target_stage_id smallint, p_run_id uuid, p_clear boolean, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_progression_event_v1(p_event_type text, p_stage_id smallint, p_target_stage_id smallint, p_run_id uuid, p_clear boolean, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_progression_event_v1(p_event_type text, p_stage_id smallint, p_target_stage_id smallint, p_run_id uuid, p_clear boolean, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_progression_event_v1(p_event_type text, p_stage_id smallint, p_target_stage_id smallint, p_run_id uuid, p_clear boolean, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_session_start(p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_session_start(p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_session_start(p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_session_start(p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_session_start(p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_attempt(p_stage_id smallint, p_client_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_attempt(p_stage_id smallint, p_client_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_attempt(p_stage_id smallint, p_client_version text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_attempt(p_stage_id smallint, p_client_version text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_attempt(p_stage_id smallint, p_client_version text) TO service_role;


--
-- Name: FUNCTION log_general_stage_attempt_v2(p_stage_id smallint, p_run_id uuid, p_client_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_attempt_v2(p_stage_id smallint, p_run_id uuid, p_client_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_attempt_v2(p_stage_id smallint, p_run_id uuid, p_client_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_attempt_v2(p_stage_id smallint, p_run_id uuid, p_client_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_attempt_v2(p_stage_id smallint, p_run_id uuid, p_client_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_attempt_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_attempt_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_attempt_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_attempt_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_attempt_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_best_event(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_general_stage_best_event() TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_best_event() TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_best_event() TO service_role;


--
-- Name: FUNCTION log_general_stage_exit(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_client_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_exit(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_client_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_exit(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_client_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_exit(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_client_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_exit(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_client_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_exit_v2(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_exit_v2(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_exit_v2(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_exit_v2(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_exit_v2(p_stage_id smallint, p_run_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_exit_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_exit_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_exit_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_exit_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_exit_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_duration_ms integer, p_exit_state text, p_exit_reason text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_result(p_stage_id smallint, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_client_version text) TO service_role;


--
-- Name: FUNCTION log_general_stage_result_v2(p_stage_id smallint, p_run_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_client_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_result_v2(p_stage_id smallint, p_run_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_client_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_result_v2(p_stage_id smallint, p_run_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_client_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_result_v2(p_stage_id smallint, p_run_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_client_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_result_v2(p_stage_id smallint, p_run_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_client_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_stage_result_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_annyongi_clicks integer, p_indeok_hits integer, p_gold_hits integer, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_stage_result_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_annyongi_clicks integer, p_indeok_hits integer, p_gold_hits integer, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_stage_result_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_annyongi_clicks integer, p_indeok_hits integer, p_gold_hits integer, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_stage_result_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_annyongi_clicks integer, p_indeok_hits integer, p_gold_hits integer, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_stage_result_v3(p_stage_id smallint, p_run_id uuid, p_visitor_id uuid, p_session_id uuid, p_score integer, p_combo integer, p_stars smallint, p_clear boolean, p_duration_ms integer, p_annyongi_clicks integer, p_indeok_hits integer, p_gold_hits integer, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_general_ui_event_v1(p_event_type text, p_visitor_id uuid, p_session_id uuid, p_last_screen text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_general_ui_event_v1(p_event_type text, p_visitor_id uuid, p_session_id uuid, p_last_screen text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_general_ui_event_v1(p_event_type text, p_visitor_id uuid, p_session_id uuid, p_last_screen text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO anon;
GRANT ALL ON FUNCTION public.log_general_ui_event_v1(p_event_type text, p_visitor_id uuid, p_session_id uuid, p_last_screen text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.log_general_ui_event_v1(p_event_type text, p_visitor_id uuid, p_session_id uuid, p_last_screen text, p_client_version text, p_balance_version text, p_run_type text, p_source text, p_device text) TO service_role;


--
-- Name: FUNCTION log_induck_grow_analytics_v1(p_event_id uuid, p_session_id uuid, p_event_type text, p_week smallint, p_department text, p_gpa numeric, p_acquisition_source text, p_campaign text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_induck_grow_analytics_v1(p_event_id uuid, p_session_id uuid, p_event_type text, p_week smallint, p_department text, p_gpa numeric, p_acquisition_source text, p_campaign text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_induck_grow_analytics_v1(p_event_id uuid, p_session_id uuid, p_event_type text, p_week smallint, p_department text, p_gpa numeric, p_acquisition_source text, p_campaign text) TO anon;
GRANT ALL ON FUNCTION public.log_induck_grow_analytics_v1(p_event_id uuid, p_session_id uuid, p_event_type text, p_week smallint, p_department text, p_gpa numeric, p_acquisition_source text, p_campaign text) TO authenticated;
GRANT ALL ON FUNCTION public.log_induck_grow_analytics_v1(p_event_id uuid, p_session_id uuid, p_event_type text, p_week smallint, p_department text, p_gpa numeric, p_acquisition_source text, p_campaign text) TO service_role;


--
-- Name: FUNCTION log_induck_grow_decision_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_category text, p_decision_id text, p_choice_id text, p_acquisition_source text, p_campaign text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_induck_grow_decision_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_category text, p_decision_id text, p_choice_id text, p_acquisition_source text, p_campaign text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_induck_grow_decision_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_category text, p_decision_id text, p_choice_id text, p_acquisition_source text, p_campaign text) TO anon;
GRANT ALL ON FUNCTION public.log_induck_grow_decision_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_category text, p_decision_id text, p_choice_id text, p_acquisition_source text, p_campaign text) TO authenticated;
GRANT ALL ON FUNCTION public.log_induck_grow_decision_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_category text, p_decision_id text, p_choice_id text, p_acquisition_source text, p_campaign text) TO service_role;


--
-- Name: FUNCTION log_induck_grow_resource_checkpoint_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_stamina smallint, p_stress smallint, p_money integer, p_free_slots smallint, p_acquisition_source text, p_campaign text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_induck_grow_resource_checkpoint_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_stamina smallint, p_stress smallint, p_money integer, p_free_slots smallint, p_acquisition_source text, p_campaign text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_induck_grow_resource_checkpoint_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_stamina smallint, p_stress smallint, p_money integer, p_free_slots smallint, p_acquisition_source text, p_campaign text) TO anon;
GRANT ALL ON FUNCTION public.log_induck_grow_resource_checkpoint_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_stamina smallint, p_stress smallint, p_money integer, p_free_slots smallint, p_acquisition_source text, p_campaign text) TO authenticated;
GRANT ALL ON FUNCTION public.log_induck_grow_resource_checkpoint_v1(p_event_id uuid, p_session_id uuid, p_week smallint, p_department text, p_stamina smallint, p_stress smallint, p_money integer, p_free_slots smallint, p_acquisition_source text, p_campaign text) TO service_role;


--
-- Name: FUNCTION log_induck_grow_session_end_v1(p_event_id uuid, p_session_id uuid, p_last_week smallint, p_last_screen text, p_duration_sec integer, p_completed boolean, p_end_reason text, p_department text, p_final_gpa numeric, p_acquisition_source text, p_campaign text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_induck_grow_session_end_v1(p_event_id uuid, p_session_id uuid, p_last_week smallint, p_last_screen text, p_duration_sec integer, p_completed boolean, p_end_reason text, p_department text, p_final_gpa numeric, p_acquisition_source text, p_campaign text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_induck_grow_session_end_v1(p_event_id uuid, p_session_id uuid, p_last_week smallint, p_last_screen text, p_duration_sec integer, p_completed boolean, p_end_reason text, p_department text, p_final_gpa numeric, p_acquisition_source text, p_campaign text) TO anon;
GRANT ALL ON FUNCTION public.log_induck_grow_session_end_v1(p_event_id uuid, p_session_id uuid, p_last_week smallint, p_last_screen text, p_duration_sec integer, p_completed boolean, p_end_reason text, p_department text, p_final_gpa numeric, p_acquisition_source text, p_campaign text) TO authenticated;
GRANT ALL ON FUNCTION public.log_induck_grow_session_end_v1(p_event_id uuid, p_session_id uuid, p_last_week smallint, p_last_screen text, p_duration_sec integer, p_completed boolean, p_end_reason text, p_department text, p_final_gpa numeric, p_acquisition_source text, p_campaign text) TO service_role;


--
-- Name: FUNCTION log_inhagame_game_entry_v1(p_event_id uuid, p_entry_id uuid, p_event_type text, p_target text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_inhagame_game_entry_v1(p_event_id uuid, p_entry_id uuid, p_event_type text, p_target text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_inhagame_game_entry_v1(p_event_id uuid, p_entry_id uuid, p_event_type text, p_target text) TO service_role;
GRANT ALL ON FUNCTION public.log_inhagame_game_entry_v1(p_event_id uuid, p_entry_id uuid, p_event_type text, p_target text) TO anon;
GRANT ALL ON FUNCTION public.log_inhagame_game_entry_v1(p_event_id uuid, p_entry_id uuid, p_event_type text, p_target text) TO authenticated;


--
-- Name: FUNCTION log_inhagame_hub_event_v1(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_inhagame_hub_event_v1(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_inhagame_hub_event_v1(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text) TO service_role;
GRANT ALL ON FUNCTION public.log_inhagame_hub_event_v1(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text) TO anon;
GRANT ALL ON FUNCTION public.log_inhagame_hub_event_v1(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text) TO authenticated;


--
-- Name: FUNCTION log_inhagame_hub_event_v2(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text, p_acquisition_source text, p_campaign text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_inhagame_hub_event_v2(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text, p_acquisition_source text, p_campaign text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_inhagame_hub_event_v2(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text, p_acquisition_source text, p_campaign text) TO anon;
GRANT ALL ON FUNCTION public.log_inhagame_hub_event_v2(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text, p_acquisition_source text, p_campaign text) TO authenticated;
GRANT ALL ON FUNCTION public.log_inhagame_hub_event_v2(p_event_id uuid, p_session_id uuid, p_visitor_id uuid, p_event_type text, p_surface text, p_target text, p_acquisition_source text, p_campaign text) TO service_role;


--
-- Name: FUNCTION log_ranked_run_event(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_ranked_run_event() TO anon;
GRANT ALL ON FUNCTION public.log_ranked_run_event() TO authenticated;
GRANT ALL ON FUNCTION public.log_ranked_run_event() TO service_role;


--
-- Name: FUNCTION log_ranked_session_event(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_ranked_session_event() TO anon;
GRANT ALL ON FUNCTION public.log_ranked_session_event() TO authenticated;
GRANT ALL ON FUNCTION public.log_ranked_session_event() TO service_role;


--
-- Name: FUNCTION mark_hub_conversation_read_v1(p_conversation uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_hub_conversation_read_v1(p_conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_hub_conversation_read_v1(p_conversation uuid) TO authenticated;


--
-- Name: FUNCTION mark_inha_duck_stage3_sample_alert_notified_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_inha_duck_stage3_sample_alert_notified_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_inha_duck_stage3_sample_alert_notified_v1() TO service_role;


--
-- Name: FUNCTION merge_my_biryong_progress_v1(p_progress jsonb, p_migrated_from_local boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_my_biryong_progress_v1(p_progress jsonb, p_migrated_from_local boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_my_biryong_progress_v1(p_progress jsonb, p_migrated_from_local boolean) TO authenticated;


--
-- Name: FUNCTION my_inha_mail_badge(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_inha_mail_badge() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_inha_mail_badge() TO authenticated;


--
-- Name: FUNCTION propose_world_accompany(p_target uuid, p_poi_id text, p_place_zone_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.propose_world_accompany(p_target uuid, p_poi_id text, p_place_zone_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.propose_world_accompany(p_target uuid, p_poi_id text, p_place_zone_id text) TO authenticated;


--
-- Name: FUNCTION purchase_world_shop_listing_v1(p_listing_id text, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purchase_world_shop_listing_v1(p_listing_id text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.purchase_world_shop_listing_v1(p_listing_id text, p_idempotency_key text) TO authenticated;


--
-- Name: FUNCTION ranked_grade_code(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ranked_grade_code(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ranked_grade_code(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) TO service_role;


--
-- Name: FUNCTION ranked_grade_code_v5(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ranked_grade_code_v5(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) TO anon;
GRANT ALL ON FUNCTION public.ranked_grade_code_v5(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) TO authenticated;
GRANT ALL ON FUNCTION public.ranked_grade_code_v5(p_score integer, p_rare integer, p_eclipse integer, p_flight integer, p_completed_calls integer) TO service_role;


--
-- Name: FUNCTION record_general_stage_best(p_stage_id integer, p_score integer, p_combo integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_general_stage_best(p_stage_id integer, p_score integer, p_combo integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_general_stage_best(p_stage_id integer, p_score integer, p_combo integer) TO service_role;


--
-- Name: FUNCTION record_general_stage_best_v2(p_stage_id integer, p_score integer, p_combo integer, p_stars integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_general_stage_best_v2(p_stage_id integer, p_score integer, p_combo integer, p_stars integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_general_stage_best_v2(p_stage_id integer, p_score integer, p_combo integer, p_stars integer) TO authenticated;
GRANT ALL ON FUNCTION public.record_general_stage_best_v2(p_stage_id integer, p_score integer, p_combo integer, p_stars integer) TO service_role;


--
-- Name: FUNCTION record_induckup_ranked_best_v1(p_wave integer, p_score integer, p_duration_ms integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_induckup_ranked_best_v1(p_wave integer, p_score integer, p_duration_ms integer) FROM PUBLIC;


--
-- Name: FUNCTION record_ranked_result(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_total_hits integer, p_dragon_bursts integer, p_duration_ms integer, p_client_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_ranked_result(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_total_hits integer, p_dragon_bursts integer, p_duration_ms integer, p_client_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_ranked_result(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_total_hits integer, p_dragon_bursts integer, p_duration_ms integer, p_client_version text) TO service_role;


--
-- Name: FUNCTION record_ranked_result_v3(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_ranked_result_v3(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_ranked_result_v3(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]) TO service_role;


--
-- Name: FUNCTION record_ranked_result_v4(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_ranked_result_v4(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_ranked_result_v4(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]) TO service_role;


--
-- Name: FUNCTION record_ranked_result_v5(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_combo_bonus integer, p_flight_base_points integer, p_tier1_hits integer, p_tier2_hits integer, p_tier1_ground_award integer, p_tier2_ground_award integer, p_ascension_bonus integer, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_ranked_result_v5(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_combo_bonus integer, p_flight_base_points integer, p_tier1_hits integer, p_tier2_hits integer, p_tier1_ground_award integer, p_tier2_ground_award integer, p_ascension_bonus integer, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_ranked_result_v5(p_run_id uuid, p_user_id uuid, p_score integer, p_max_combo integer, p_annyongi_hits integer, p_indeoki_hits integer, p_gold_hits integer, p_normal_hits integer, p_speedy_hits integer, p_total_hits integer, p_dragon_calls integer, p_completed_calls integer, p_moon_bonus_hits integer, p_flight_hits integer, p_duration_ms integer, p_client_version text, p_combo_bonus integer, p_flight_base_points integer, p_tier1_hits integer, p_tier2_hits integer, p_tier1_ground_award integer, p_tier2_ground_award integer, p_ascension_bonus integer, p_input_count integer, p_reaction_sample_count integer, p_ultra_fast_reaction_count integer, p_suspicious_flag boolean, p_suspicion_reasons text[]) TO service_role;


--
-- Name: FUNCTION remove_world_friend(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_world_friend(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_world_friend(p_target uuid) TO authenticated;


--
-- Name: FUNCTION report_hub_message_v1(p_message uuid, p_category text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_hub_message_v1(p_message uuid, p_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_hub_message_v1(p_message uuid, p_category text) TO authenticated;


--
-- Name: FUNCTION report_world_user(p_target uuid, p_category text, p_place_zone_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.report_world_user(p_target uuid, p_category text, p_place_zone_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_world_user(p_target uuid, p_category text, p_place_zone_id text) TO authenticated;


--
-- Name: FUNCTION respond_world_accompany(p_session_id uuid, p_accept boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.respond_world_accompany(p_session_id uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_world_accompany(p_session_id uuid, p_accept boolean) TO authenticated;


--
-- Name: FUNCTION respond_world_friend_request(p_target uuid, p_accept boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.respond_world_friend_request(p_target uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_world_friend_request(p_target uuid, p_accept boolean) TO authenticated;


--
-- Name: FUNCTION review_world_user_report_ops_v1(p_token text, p_report_id bigint, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_world_user_report_ops_v1(p_token text, p_report_id bigint, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_world_user_report_ops_v1(p_token text, p_report_id bigint, p_action text) TO service_role;


--
-- Name: FUNCTION save_my_game_progress(p_game_slug text, p_progress jsonb, p_schema_version integer, p_migrated_from_local boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_my_game_progress(p_game_slug text, p_progress jsonb, p_schema_version integer, p_migrated_from_local boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_my_game_progress(p_game_slug text, p_progress jsonb, p_schema_version integer, p_migrated_from_local boolean) TO authenticated;


--
-- Name: FUNCTION save_my_grow_progress(p_progress jsonb, p_expected_updated_at timestamp with time zone, p_migrated_from_local boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_my_grow_progress(p_progress jsonb, p_expected_updated_at timestamp with time zone, p_migrated_from_local boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_my_grow_progress(p_progress jsonb, p_expected_updated_at timestamp with time zone, p_migrated_from_local boolean) TO authenticated;


--
-- Name: FUNCTION send_hub_message_v1(p_recipient uuid, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_hub_message_v1(p_recipient uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_hub_message_v1(p_recipient uuid, p_body text) TO authenticated;


--
-- Name: FUNCTION send_world_friend_request(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_world_friend_request(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_world_friend_request(p_target uuid) TO authenticated;


--
-- Name: FUNCTION set_my_grow_rank_visibility(p_department text, p_public boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_grow_rank_visibility(p_department text, p_public boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_grow_rank_visibility(p_department text, p_public boolean) TO authenticated;


--
-- Name: FUNCTION start_mcm_landlord_run_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_mcm_landlord_run_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_mcm_landlord_run_v1() TO authenticated;


--
-- Name: FUNCTION start_my_world_daily_quiz_v1(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_my_world_daily_quiz_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_my_world_daily_quiz_v1() TO authenticated;


--
-- Name: FUNCTION submit_mcm_landlord_choice_v1(p_run_id uuid, p_actor_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_mcm_landlord_choice_v1(p_run_id uuid, p_actor_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_mcm_landlord_choice_v1(p_run_id uuid, p_actor_id text) TO authenticated;


--
-- Name: FUNCTION submit_ranked_recovery_snapshot_v1(p_client_snapshot_id uuid, p_visitor_id uuid, p_session_id uuid, p_reason text, p_ruleset_version text, p_client_version text, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_ranked_recovery_snapshot_v1(p_client_snapshot_id uuid, p_visitor_id uuid, p_session_id uuid, p_reason text, p_ruleset_version text, p_client_version text, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_ranked_recovery_snapshot_v1(p_client_snapshot_id uuid, p_visitor_id uuid, p_session_id uuid, p_reason text, p_ruleset_version text, p_client_version text, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.submit_ranked_recovery_snapshot_v1(p_client_snapshot_id uuid, p_visitor_id uuid, p_session_id uuid, p_reason text, p_ruleset_version text, p_client_version text, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION submit_ranked_recovery_summary_v1(p_incident_key text, p_best_score integer, p_best_contract text, p_local_plays integer, p_client_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_ranked_recovery_summary_v1(p_incident_key text, p_best_score integer, p_best_contract text, p_local_plays integer, p_client_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_ranked_recovery_summary_v1(p_incident_key text, p_best_score integer, p_best_contract text, p_local_plays integer, p_client_version text) TO authenticated;
GRANT ALL ON FUNCTION public.submit_ranked_recovery_summary_v1(p_incident_key text, p_best_score integer, p_best_contract text, p_local_plays integer, p_client_version text) TO service_role;


--
-- Name: FUNCTION sync_inha_duck_general_run(p_run_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_inha_duck_general_run(p_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_inha_duck_general_run(p_run_id uuid) TO service_role;


--
-- Name: FUNCTION sync_inha_duck_ranked_run(p_run_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_inha_duck_ranked_run(p_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_inha_duck_ranked_run(p_run_id uuid) TO service_role;


--
-- Name: FUNCTION touch_inha_duck_ops_refresh(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_inha_duck_ops_refresh() FROM PUBLIC;


--
-- Name: FUNCTION touch_inhagame_member_activity_v1(p_surface text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_inhagame_member_activity_v1(p_surface text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_inhagame_member_activity_v1(p_surface text) TO authenticated;


--
-- Name: FUNCTION touch_world_online_session_v1(p_session_id uuid, p_place_zone_id text, p_space text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_world_online_session_v1(p_session_id uuid, p_place_zone_id text, p_space text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_world_online_session_v1(p_session_id uuid, p_place_zone_id text, p_space text) TO anon;
GRANT ALL ON FUNCTION public.touch_world_online_session_v1(p_session_id uuid, p_place_zone_id text, p_space text) TO authenticated;


--
-- Name: FUNCTION touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid, p_place_zone_id text, p_space text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid, p_place_zone_id text, p_space text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid, p_place_zone_id text, p_space text) TO anon;
GRANT ALL ON FUNCTION public.touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid, p_place_zone_id text, p_space text) TO authenticated;


--
-- Name: FUNCTION trg_sync_inha_duck_general_run(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_sync_inha_duck_general_run() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_sync_inha_duck_general_run() TO service_role;


--
-- Name: FUNCTION trg_sync_inha_duck_ranked_result(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_sync_inha_duck_ranked_result() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_sync_inha_duck_ranked_result() TO service_role;


--
-- Name: FUNCTION trg_sync_inha_duck_ranked_session(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_sync_inha_duck_ranked_session() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_sync_inha_duck_ranked_session() TO service_role;


--
-- Name: FUNCTION unblock_world_user(p_target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.unblock_world_user(p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.unblock_world_user(p_target uuid) TO authenticated;


--
-- Name: FUNCTION unequip_my_world_item_v1(p_slot text, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.unequip_my_world_item_v1(p_slot text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.unequip_my_world_item_v1(p_slot text, p_idempotency_key text) TO authenticated;


--
-- Name: FUNCTION update_world_guestbook_entry_v2(p_entry_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_world_guestbook_entry_v2(p_entry_id uuid, p_content text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_world_guestbook_entry_v2(p_entry_id uuid, p_content text) TO authenticated;


--
-- Name: FUNCTION upsert_world_guestbook_entry_v1(p_content text, p_location_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_world_guestbook_entry_v1(p_content text, p_location_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_world_guestbook_entry_v1(p_content text, p_location_key text) TO authenticated;


--
-- Name: FUNCTION verify_inha_duck_ops_basic_v1(p_token text, p_basic_sha256 text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_inha_duck_ops_basic_v1(p_token text, p_basic_sha256 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_inha_duck_ops_basic_v1(p_token text, p_basic_sha256 text) TO service_role;


--
-- Name: FUNCTION world_exp_grant_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_exp_grant_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_exp_grant_v1(p_user uuid, p_amount bigint, p_source_type text, p_source_id text, p_idempotency_key text) TO service_role;


--
-- Name: FUNCTION world_inventory_ensure_default_items_v1(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_inventory_ensure_default_items_v1(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_inventory_ensure_default_items_v1(p_user uuid) TO service_role;


--
-- Name: FUNCTION world_inventory_get_item_v1(p_user uuid, p_item_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_inventory_get_item_v1(p_user uuid, p_item_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_inventory_get_item_v1(p_user uuid, p_item_id text) TO service_role;


--
-- Name: FUNCTION world_inventory_grant_item_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text, p_metadata jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_inventory_grant_item_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_inventory_grant_item_v1(p_user uuid, p_item_id text, p_quantity integer, p_source_type text, p_source_ref text, p_idempotency_key text, p_event_id text, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION world_inventory_has_item_v1(p_user uuid, p_item_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_inventory_has_item_v1(p_user uuid, p_item_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_inventory_has_item_v1(p_user uuid, p_item_id text) TO service_role;


--
-- Name: FUNCTION world_inventory_list_v1(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_inventory_list_v1(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_inventory_list_v1(p_user uuid) TO service_role;


--
-- Name: FUNCTION world_progression_get_v1(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_progression_get_v1(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_progression_get_v1(p_user uuid) TO service_role;


--
-- Name: FUNCTION world_reward_get_result_v1(p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_reward_get_result_v1(p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_reward_get_result_v1(p_idempotency_key text) TO service_role;


--
-- Name: FUNCTION world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text) TO service_role;


--
-- Name: FUNCTION world_wallet_credit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_wallet_credit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_wallet_credit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text) TO service_role;


--
-- Name: FUNCTION world_wallet_debit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_wallet_debit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_wallet_debit_v1(p_user uuid, p_currency_id text, p_amount bigint, p_type text, p_source_type text, p_source_id text, p_idempotency_key text, p_reason text) TO service_role;


--
-- Name: FUNCTION world_wallet_get_balance_v1(p_user uuid, p_currency_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.world_wallet_get_balance_v1(p_user uuid, p_currency_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.world_wallet_get_balance_v1(p_user uuid, p_currency_id text) TO service_role;


--
-- Name: TABLE game_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_events TO service_role;


--
-- Name: TABLE games; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.games TO service_role;


--
-- Name: TABLE runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.runs TO service_role;


--
-- Name: TABLE game_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_sessions TO service_role;


--
-- Name: TABLE ops_event_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_event_mappings TO service_role;


--
-- Name: TABLE ops_event_contracts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_event_contracts TO service_role;


--
-- Name: TABLE world_biryong_progress_v1; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE private.world_biryong_progress_v1 TO service_role;


--
-- Name: TABLE world_npc_shared_ticks_v1; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.world_npc_shared_ticks_v1 TO service_role;


--
-- Name: TABLE world_quest_progress_v1; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE private.world_quest_progress_v1 TO service_role;


--
-- Name: TABLE world_staff_assignments; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.world_staff_assignments TO service_role;


--
-- Name: TABLE world_staff_role_permissions; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.world_staff_role_permissions TO service_role;


--
-- Name: TABLE world_user_moderation_actions; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.world_user_moderation_actions TO service_role;


--
-- Name: TABLE classic_event_badges; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.classic_event_badges TO service_role;


--
-- Name: TABLE departments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.departments TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.departments TO authenticated;
GRANT ALL ON TABLE public.departments TO service_role;


--
-- Name: SEQUENCE departments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.departments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.departments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.departments_id_seq TO service_role;


--
-- Name: TABLE experiment_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.experiment_assignments TO service_role;


--
-- Name: TABLE experiments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.experiments TO service_role;


--
-- Name: TABLE game_builds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_builds TO service_role;


--
-- Name: SEQUENCE game_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.game_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.game_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.game_events_id_seq TO service_role;


--
-- Name: TABLE general_stage_bests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.general_stage_bests TO service_role;


--
-- Name: TABLE grow_rank_bests; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.grow_rank_bests TO service_role;


--
-- Name: TABLE grow_rank_runs; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.grow_rank_runs TO service_role;


--
-- Name: TABLE grow_rank_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.grow_rank_sessions TO service_role;


--
-- Name: TABLE grow_rank_visibility; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.grow_rank_visibility TO service_role;


--
-- Name: TABLE hub_conversation_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hub_conversation_members TO service_role;


--
-- Name: TABLE hub_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hub_conversations TO service_role;


--
-- Name: TABLE hub_message_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hub_message_reports TO service_role;


--
-- Name: SEQUENCE hub_message_reports_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON SEQUENCE public.hub_message_reports_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.hub_message_reports_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.hub_message_reports_id_seq TO service_role;


--
-- Name: TABLE hub_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hub_messages TO service_role;


--
-- Name: TABLE induck_grow_analytics_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.induck_grow_analytics_events TO service_role;


--
-- Name: TABLE induck_grow_decision_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.induck_grow_decision_events TO service_role;


--
-- Name: TABLE induck_grow_resource_checkpoints; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.induck_grow_resource_checkpoints TO service_role;


--
-- Name: TABLE induck_grow_session_ends; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.induck_grow_session_ends TO service_role;


--
-- Name: TABLE induckup_ranked_bests; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.induckup_ranked_bests TO service_role;


--
-- Name: TABLE inha_duck_ops_auth_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inha_duck_ops_auth_state TO service_role;


--
-- Name: TABLE inha_duck_ops_refresh; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.inha_duck_ops_refresh TO service_role;
GRANT SELECT ON TABLE public.inha_duck_ops_refresh TO anon;
GRANT SELECT ON TABLE public.inha_duck_ops_refresh TO authenticated;


--
-- Name: TABLE inha_mail_badges; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.inha_mail_badges TO service_role;


--
-- Name: TABLE inhagame_hub_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.inhagame_hub_events TO service_role;


--
-- Name: TABLE player_bests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.player_bests TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(user_id) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.nickname; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(nickname),UPDATE(nickname) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.department_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(department_id),UPDATE(department_id) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.title; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(title) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(updated_at),UPDATE(updated_at) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.avatar_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(avatar_key),UPDATE(avatar_key) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE leaderboard_public; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leaderboard_public TO service_role;


--
-- Name: TABLE ops_alert_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_alert_state TO service_role;


--
-- Name: TABLE ops_lifecycle_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_lifecycle_profiles TO service_role;


--
-- Name: TABLE player_identity_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.player_identity_links TO service_role;


--
-- Name: TABLE players; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.players TO service_role;


--
-- Name: TABLE ranked_recovery_eligibility; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ranked_recovery_eligibility TO service_role;


--
-- Name: TABLE ranked_recovery_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ranked_recovery_records TO service_role;


--
-- Name: TABLE ranked_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ranked_runs TO service_role;


--
-- Name: TABLE ranked_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ranked_sessions TO service_role;


--
-- Name: TABLE user_achievements; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.user_achievements TO service_role;
GRANT SELECT ON TABLE public.user_achievements TO authenticated;


--
-- Name: TABLE user_game_progress; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.user_game_progress TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.user_game_progress TO authenticated;


--
-- Name: TABLE world_accompany_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.world_accompany_sessions TO service_role;


--
-- Name: TABLE world_friendships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.world_friendships TO service_role;


--
-- Name: TABLE world_guestbook_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.world_guestbook_entries TO service_role;


--
-- Name: TABLE world_online_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.world_online_sessions TO service_role;


--
-- Name: TABLE world_player_rooms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.world_player_rooms TO service_role;


--
-- Name: TABLE world_user_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.world_user_blocks TO service_role;


--
-- Name: TABLE world_user_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.world_user_reports TO service_role;


--
-- Name: SEQUENCE world_user_reports_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE ON SEQUENCE public.world_user_reports_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.world_user_reports_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.world_user_reports_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



CREATE POLICY "world online players read place zone" ON realtime.messages AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (extension = ANY (ARRAY['broadcast'::text, 'presence'::text])) AND (( SELECT realtime.topic() AS topic) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'::text)));
CREATE POLICY "world online players write place zone" ON realtime.messages AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (extension = ANY (ARRAY['broadcast'::text, 'presence'::text])) AND (( SELECT realtime.topic() AS topic) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'::text)));
ALTER PUBLICATION supabase_realtime ADD TABLE "public"."inha_duck_ops_refresh";
ALTER PUBLICATION supabase_realtime ADD TABLE "public"."player_bests";
-- Deterministic reference seeds only.
INSERT INTO "public"."games" ("created_at","id","metadata","name","released_at","slug","status","updated_at") VALUES ('2026-10-01T21:31:32Z','2619e309-a236-57cb-b232-38144cb46ca4','{"account_platform":"inhagame"}','인덕 서바이벌',NULL,'inha-duck-survival','testing','2026-10-01T21:31:32Z');
INSERT INTO "public"."games" ("created_at","id","metadata","name","released_at","slug","status","updated_at") VALUES ('2026-10-01T21:31:32Z','3a10becf-686c-5ba7-8daa-3867946c83ee','{"account_platform":"inhagame"}','인덕업',NULL,'induckup','testing','2026-10-01T21:31:32Z');
INSERT INTO "public"."games" ("created_at","id","metadata","name","released_at","slug","status","updated_at") VALUES ('2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535','{"legacy_project":"inha-duck","migration_source":"multi_game_core_v1"}','인하오리 Classic',NULL,'inha-duck','production','2026-10-01T21:31:32Z');
INSERT INTO "public"."games" ("created_at","id","metadata","name","released_at","slug","status","updated_at") VALUES ('2026-10-01T21:31:32Z','f06be21f-756b-50ca-8b29-5930502db86c','{"account_platform":"inhagame"}','인덕이 키우기','2026-10-01T21:31:32Z','induck-grow','production','2026-10-01T21:31:32Z');
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',1,'학과 미선택',9999);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',10,'환경공학과',9);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',11,'공간정보공학과',10);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',12,'건축학부',11);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',13,'에너지자원공학과',12);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',14,'전기전자공학부',13);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',15,'반도체시스템공학과',14);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',16,'이차전지융합학과',15);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',17,'수학과',16);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',18,'통계학과',17);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',19,'물리학과',18);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',2,'기계공학과',1);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',20,'화학과',19);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',21,'해양과학과',20);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',22,'식품영양학과',21);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',23,'경영학과',22);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',24,'파이낸스경영학과',23);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',25,'아태물류학부',24);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',26,'국제통상학과',25);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',27,'국어교육과',26);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',28,'영어교육과',27);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',29,'사회교육과',28);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',3,'항공우주공학과',2);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',30,'체육교육과',29);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',31,'교육학과',30);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',32,'수학교육과',31);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',33,'행정학과',32);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',34,'정치외교학과',33);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',35,'미디어커뮤니케이션학과',34);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',36,'경제학과',35);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',37,'소비자학과',36);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',38,'아동심리학과',37);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',39,'사회복지학과',38);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',4,'조선해양공학과',3);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',40,'한국어문학과',39);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',41,'사학과',40);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',42,'철학과',41);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',43,'중국학과',42);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',44,'일본언어문화학과',43);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',45,'영미유럽인문융합학부',44);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',46,'문화콘텐츠문화경영학과',45);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',47,'의예과',46);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',48,'간호학과',47);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',49,'조형예술학과',48);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',5,'산업경영공학과',4);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',50,'디자인융합학과',49);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',51,'스포츠과학과',50);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',52,'연극영화학과',51);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',53,'의류디자인학과',52);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',54,'인공지능공학과',53);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',55,'데이터사이언스학과',54);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',56,'스마트모빌리티공학과',55);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',57,'디자인테크놀로지학과',56);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',58,'컴퓨터공학과',57);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',59,'IBT학과',58);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',6,'화학공학과',5);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',60,'ISE학과',59);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',61,'KLC학과',60);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',62,'자유전공학부',61);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',63,'메카트로닉스공학과',62);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',64,'소프트웨어융합공학과',63);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',65,'산업경영학과',64);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',66,'금융투자학과',65);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',67,'반도체산업융합학과',66);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',7,'고분자공학과',6);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',8,'신소재공학과',7);
INSERT INTO "public"."departments" ("active","created_at","id","name","sort_order") VALUES (true,'2026-10-01T21:31:32Z',9,'사회인프라공학과',8);
INSERT INTO "private"."world_currencies" ("created_at","currency_id","display_name") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin','인덕코인');
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('controls',0,'2026-10-01T21:31:32Z','["E","F","C","Enter"]',3,'PC에서 감정표현 메뉴를 여는 키는?','quiz.campus.emote_key','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('controls',1,'2026-10-01T21:31:32Z','["E","F","M","V"]',2,'PC에서 NPC와 대화하거나 앉기·방명록·문 같은 상호작용을 하는 키는?','quiz.campus.interact_key','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('controls',1,'2026-10-01T21:31:32Z','["Tab","V","C","E"]',5,'PC에서 1인칭·3인칭 시점을 전환하는 키는?','quiz.campus.view_key','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('controls',3,'2026-10-01T21:31:32Z','["F","V","Space","M"]',4,'PC에서 탈것에 타거나 내리는 키는?','quiz.campus.mount_key','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('economy',0,'2026-10-01T21:31:32Z','["인덕코인","인하포인트","캠퍼스머니","오리코인"]',1,'INHA WORLD에서 상점 결제에 쓰는 재화의 이름은?','quiz.campus.currency_name','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('equipment',1,'2026-10-01T21:31:32Z','["상의","머리","등","신발"]',14,'인덕 캠퍼스 캡은 옷장에서 어느 슬롯에 착용될까?','quiz.campus.cap_slot','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('navigation',1,'2026-10-01T21:31:32Z','["본관","5호관","학생회관","정문"]',9,'길찾기 익히기에서 처음 목적지로 설정하는 건물은?','quiz.campus.navigation_target','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('navigation',1,'2026-10-01T21:31:32Z','["점프","일시정지 후 재개","탈것 타기","감정표현"]',10,'길찾기 익히기에서 자동이동 도중 한 번 해 보는 조작은?','quiz.campus.navigation_pause','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('navigation',3,'2026-10-01T21:31:32Z','["정문","인경호","본관 앞","후문"]',11,'길찾기 익히기를 마치려면 자동이동으로 어디까지 돌아가야 할까?','quiz.campus.navigation_return','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('progression',1,'2026-10-01T21:31:32Z','["50","100","200","300"]',15,'Lv.2가 되려면 누적 EXP가 얼마 필요할까?','quiz.campus.level_two','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('quest',1,'2026-10-01T21:31:32Z','["가유담","나나율","후문 안내 학생","인덕이"]',6,'정문에서 첫 캠퍼스 탐방을 시작하게 해 주는 학생은?','quiz.campus.first_walk_npc','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('quest',1,'2026-10-01T21:31:32Z','["본관 앞","인경호","학생회관","5호관"]',7,'첫 캠퍼스 탐방에서 가유담을 만나는 곳은?','quiz.campus.first_walk_guide','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('quest',2,'2026-10-01T21:31:32Z','["5호관","후문","본관 앞","학생회관"]',8,'첫 캠퍼스 탐방에서 인경호보다 먼저 방문하는 곳은?','quiz.campus.first_walk_order','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('reward',0,'2026-10-01T21:31:32Z','["정문 첫걸음 배지","건물주 챌린지 배지","인경호 산책 배지","5호관 탐험 배지"]',13,'첫 캠퍼스 탐방을 완료하면 받는 배지는?','quiz.campus.first_walk_badge','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('shop',0,'2026-10-01T21:31:32Z','["학생회관 상점","정문 매점","본관 기념품점","인경호 매점"]',12,'캠퍼스에서 인덕코인으로 아이템을 사는 상점의 이름은?','quiz.campus.shop_name','ACTIVE',1);
INSERT INTO "private"."world_daily_quiz_questions" ("category","correct_index","created_at","options","position","prompt","question_id","status","version") VALUES ('world',0,'2026-10-01T21:31:32Z','["☰ 메뉴","지도","채팅창","프로필 카드"]',16,'인벤토리·옷장·상점은 어디에서 열 수 있을까?','quiz.campus.menu_panels','ACTIVE',1);
INSERT INTO "private"."world_events" ("created_at","ends_at","event_id","is_disabled","starts_at","title") VALUES ('2026-10-01T21:31:32Z','2026-09-30T16:00:00+00:00','event.mcm_2026',false,'2026-09-29T15:00:00+00:00','좀비대학교 · 2026 문콘경 일일호프');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('BADGE','badge.campus_explorer',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('BADGE','badge.campus_first_step',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('BADGE','badge.main_gate',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('BADGE','badge.mcm_2026_landlord',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('EMOTE','emote.wave_plus',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.campus_map_poster',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.campus_rug_blue',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.dorm_desk_lamp',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.dorm_resident_plate',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.induck_chair',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.induck_cushion',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.mcm_2026_landlord_figure',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.mcm_2026_poster',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('FURNITURE','furniture.mini_induck',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('MEMORABILIA','memorabilia.campus_mug',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('MEMORABILIA','memorabilia.mcm_2026_wristband',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','back.freshman_bag',NULL,'UNIQUE','ACTIVE');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','back.induck_backpack',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','head.induck_cap',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','head.inha_cap',NULL,'UNIQUE','ACTIVE');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','head.inkyung_duck',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','shoes.campus_sneakers',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','top.induck_hoodie',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','top.inha_basic',NULL,'UNIQUE','ACTIVE');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','top.mcm_2026_survivor',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_item_catalog" ("category","item_id","max_stack","ownership_policy","status") VALUES ('WEARABLE','top.mcm_jacket',NULL,'UNIQUE','COMING_SOON');
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',1,0);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',2,100);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',3,300);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',4,600);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',5,1000);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',6,1500);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',7,2100);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',8,2800);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',9,3600);
INSERT INTO "private"."world_level_thresholds" ("created_at","level","min_total_exp") VALUES ('2026-10-01T21:31:32Z',10,4500);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','2026 문콘경 일일호프 핵심 이벤트 완주 보상','event.mcm_2026','reward.event.mcm_2026_main_clear','ACTIVE',ARRAY['event','mcm_2026']::text[],2);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','건물주 미니게임 첫 클리어 보상','event.mcm_2026','reward.minigame.landlord_first_clear','ACTIVE',ARRAY['minigame','mcm_2026']::text[],2);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','길찾기 익히기 완료 보상',NULL,'reward.quest.navigation_intro','ACTIVE',ARRAY['quest','tutorial','navigation']::text[],1);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','첫 캠퍼스 탐방 완료 보상',NULL,'reward.quest.first_campus','ACTIVE',ARRAY['quest']::text[],2);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','캠퍼스 데일리 퀴즈 완료 보상',NULL,'reward.daily.campus_quiz','ACTIVE',ARRAY['daily','minigame','quiz']::text[],1);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','캠퍼스 출석부 이번 달 14일 출석 보상',NULL,'reward.attendance.monthly_14','ACTIVE',ARRAY['attendance','monthly']::text[],1);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','캠퍼스 출석부 이번 달 21일 출석 보상',NULL,'reward.attendance.monthly_21','ACTIVE',ARRAY['attendance','monthly']::text[],1);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','캠퍼스 출석부 이번 달 3일 출석 보상',NULL,'reward.attendance.monthly_3','ACTIVE',ARRAY['attendance','monthly']::text[],1);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','캠퍼스 출석부 이번 달 7일 출석 보상',NULL,'reward.attendance.monthly_7','ACTIVE',ARRAY['attendance','monthly']::text[],1);
INSERT INTO "private"."world_reward_definitions" ("created_at","description","event_id","reward_id","status","tags","version") VALUES ('2026-10-01T21:31:32Z','캠퍼스 출석부 일일 출석 보상',NULL,'reward.attendance.daily','ACTIVE',ARRAY['attendance','daily']::text[],1);
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (1,'item.badge.main_gate','ITEM',0,'reward.quest.first_campus','badge.main_gate');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (1,'item.badge.mcm_2026_landlord','ITEM',0,'reward.minigame.landlord_first_clear','badge.mcm_2026_landlord');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (1,'item.furniture.mcm_2026_poster','ITEM',2,'reward.event.mcm_2026_main_clear','furniture.mcm_2026_poster');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (1,'item.top.mcm_2026_survivor','ITEM',1,'reward.event.mcm_2026_main_clear','top.mcm_2026_survivor');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (10,'currency.induck_coin','CURRENCY',0,'reward.attendance.daily','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (100,'currency.induck_coin','CURRENCY',0,'reward.attendance.monthly_14','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (100,'exp.campus','EXP',1,'reward.quest.first_campus','exp.campus');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (100,'exp.campus','EXP',1,'reward.quest.navigation_intro','exp.campus');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (150,'currency.induck_coin','CURRENCY',0,'reward.attendance.monthly_21','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (150,'exp.campus','EXP',3,'reward.event.mcm_2026_main_clear','exp.campus');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (180,'currency.induck_coin','CURRENCY',0,'reward.quest.navigation_intro','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (25,'exp.campus','EXP',1,'reward.daily.campus_quiz','exp.campus');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (30,'currency.induck_coin','CURRENCY',0,'reward.attendance.monthly_3','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (50,'currency.induck_coin','CURRENCY',0,'reward.attendance.monthly_7','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (50,'currency.induck_coin','CURRENCY',0,'reward.daily.campus_quiz','currency.induck_coin');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (50,'exp.campus','EXP',1,'reward.minigame.landlord_first_clear','exp.campus');
INSERT INTO "private"."world_reward_grants" ("amount","grant_entry_id","grant_type","position","reward_id","target_id") VALUES (80,'currency.induck_coin','CURRENCY',0,'reward.event.mcm_2026_main_clear','currency.induck_coin');
INSERT INTO "private"."world_shops" ("created_at","display_name","shop_id","status","tags","vendor_id") VALUES ('2026-10-01T21:31:32Z','문콘경 학과 상점','shop.department_mcm','ACTIVE',ARRAY['department','mcm']::text[],NULL);
INSERT INTO "private"."world_shops" ("created_at","display_name","shop_id","status","tags","vendor_id") VALUES ('2026-10-01T21:31:32Z','생활관 가구점','shop.dorm_furniture','ACTIVE',ARRAY['dorm','furniture']::text[],NULL);
INSERT INTO "private"."world_shops" ("created_at","display_name","shop_id","status","tags","vendor_id") VALUES ('2026-10-01T21:31:32Z','학생회관 굿즈샵','shop.student_center','ACTIVE',ARRAY['campus']::text[],NULL);
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'back.induck_backpack','offer.student_center.induck_backpack',5,420,NULL,1,3,'shop.student_center',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'furniture.campus_map_poster','offer.student_center.campus_map_poster',3,250,NULL,1,2,'shop.student_center',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'furniture.campus_rug_blue','offer.dorm_furniture.campus_rug_blue',2,360,NULL,1,3,'shop.dorm_furniture',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'furniture.dorm_desk_lamp','offer.dorm_furniture.dorm_desk_lamp',1,280,NULL,1,2,'shop.dorm_furniture',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'furniture.induck_chair','offer.dorm_furniture.induck_chair',3,420,NULL,1,3,'shop.dorm_furniture',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'furniture.induck_cushion','offer.dorm_furniture.induck_cushion',0,220,NULL,1,1,'shop.dorm_furniture',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'furniture.mini_induck','offer.dorm_furniture.mini_induck',4,650,NULL,1,5,'shop.dorm_furniture',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'head.induck_cap','offer.student_center.induck_cap',1,180,NULL,1,1,'shop.student_center',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'memorabilia.campus_mug','offer.student_center.campus_mug',0,120,NULL,1,NULL,'shop.student_center',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'shoes.campus_sneakers','offer.student_center.campus_sneakers',2,240,NULL,1,2,'shop.student_center',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'top.induck_hoodie','offer.student_center.induck_hoodie',4,320,NULL,1,2,'shop.student_center',NULL,'ACTIVE');
INSERT INTO "private"."world_shop_listings" ("created_at","currency_id","end_at","item_id","listing_id","position","price","purchase_limit","quantity","required_level","shop_id","start_at","status") VALUES ('2026-10-01T21:31:32Z','currency.induck_coin',NULL,'top.mcm_jacket','offer.department_mcm.mcm_jacket',0,480,NULL,1,4,'shop.department_mcm',NULL,'ACTIVE');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('admin.console','world_admin');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('moderation.dismiss','world_admin');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('moderation.read','world_admin');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('moderation.restrict_24h','world_admin');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('moderation.review','world_admin');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('moderation.warn','world_admin');
INSERT INTO "private"."world_staff_role_permissions" ("permission","role") VALUES ('ops.read','world_admin');
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('choice','choice',1,'2026-10-01T21:31:32Z','Player makes a meaningful gameplay/build/evolution choice.','none','["game_id","choice_type"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('error','error',1,'2026-10-01T21:31:32Z','Client/server/gameplay error relevant to operations.','none','["game_id","error_code"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('failure','failure',1,'2026-10-01T21:31:32Z','Gameplay failure/death signal. If it terminates a run, also emit run_result.','none','["game_id","run_id","failure_type"]',true,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('progression_update','progression',1,'2026-10-01T21:31:32Z','Stage, level, unlock or persistent progression changes.','none','["game_id"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('record_update','record',1,'2026-10-01T21:31:32Z','Personal best, rank, badge or other persistent record changes.','none','["game_id","record_type"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('recovery_evidence','recovery',1,'2026-10-01T21:31:32Z','Evidence recovered after telemetry or authoritative-session failure; never leaderboard authority by itself.','none','["game_id"]',true,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('reward','reward',1,'2026-10-01T21:31:32Z','Reward, currency, unlock or loot granted.','none','["game_id","reward_type"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('run_exit_signal','run',1,'2026-10-01T21:31:32Z','Raw signal that a run was left or invalidated. Must be semantically classified before treating it as churn.','exit_signal','["game_id","run_id"]',true,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('run_result','run',1,'2026-10-01T21:31:32Z','A run produces a gameplay result such as clear, fail, death, score or completion.','run_result','["game_id","run_id"]',true,true);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('run_start','run',1,'2026-10-01T21:31:32Z','A playable attempt/run begins.','run_start','["game_id","run_id"]',true,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('run_validation_accept','run',1,'2026-10-01T21:31:32Z','Authoritative run validation accepted.','validation_accept','["game_id","run_id"]',true,true);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('run_validation_reject','run',1,'2026-10-01T21:31:32Z','Authoritative run validation rejected.','validation_reject','["game_id","run_id"]',true,true);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('run_validation_submit','run',1,'2026-10-01T21:31:32Z','Run result submitted for authoritative validation.','validation_submit','["game_id","run_id"]',true,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('session_end','session',1,'2026-10-01T21:31:32Z','Player/client session ends.','session_end','["game_id"]',false,true);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('session_start','session',1,'2026-10-01T21:31:32Z','Player/client session begins.','session_start','["game_id"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('ui_action','ui',1,'2026-10-01T21:31:32Z','Meaningful UI action or CTA interaction.','none','["game_id","action"]',false,false);
INSERT INTO "public"."ops_event_contracts" ("canonical_event","category","contract_version","created_at","description","lifecycle_signal","required_context","run_scoped","terminal_signal") VALUES ('ui_view','ui',1,'2026-10-01T21:31:32Z','Meaningful UI surface was viewed.','none','["game_id","surface"]',false,false);
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('record_update','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Personal stage best created.','stage_best_created');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('record_update','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Personal stage best improved/updated.','stage_best_updated');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_exit_signal','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Requires retry-aware semantic classifier.','exit_run');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_exit_signal','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'supporting','Raw exit signal; classify reset vs genuine exit.','ranked_session_abandoned');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_exit_signal','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'supporting','Raw expiry signal; classify superseded vs genuine exit.','ranked_session_expired');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_result','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','General-mode run result.','stage_result');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_start','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','General-mode run start.','stage_attempt');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_start','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Ranked-mode run/session start.','ranked_session_started');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_validation_accept','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Authoritative ranked accepted result.','ranked_run_accepted');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_validation_accept','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'supporting','Duplicate lifecycle evidence from ranked_sessions.','ranked_session_accepted');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_validation_reject','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Authoritative ranked rejected result.','ranked_run_rejected');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_validation_reject','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'supporting','Duplicate lifecycle evidence from ranked_sessions.','ranked_session_rejected');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('run_validation_submit','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'supporting','Submission signal; ranked_runs remains authoritative result source.','ranked_session_submitted');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('session_end','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Direct canonical match.','session_end');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('session_start','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Direct canonical match.','session_start');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_action','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Next-stage CTA click.','next_stage_cta_click');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_action','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Ranked CTA click.','ranked_cta_click');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_action','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Return to stage select.','stage_select_return');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_view','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Leaderboard surface.','leaderboard_view');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_view','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Next-stage CTA exposure.','next_stage_cta_view');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_view','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Result surface.','stage_result_view');
INSERT INTO "public"."ops_event_mappings" ("canonical_event","created_at","game_id","mapping_version","metric_role","notes","raw_event_type") VALUES ('ui_view','2026-10-01T21:31:32Z','88db5186-c719-5b75-90df-27a54e6a2535',1,'primary','Stage-select surface.','stage_select_view');
INSERT INTO "public"."ops_lifecycle_profiles" ("classifier_version","game_id","genuine_exit_grace_seconds","metadata","mode","reset_window_seconds","supersede_on_new_run","terminal_precedence","updated_at") VALUES ('inha-general-lifecycle-1','88db5186-c719-5b75-90df-27a54e6a2535',30,'{"notes":"exit_run followed by same-stage retry within 30s is reset"}','general',30,true,'["rejected","completed","reset","superseded","genuine_exit","active"]','2026-10-01T21:31:32Z');
INSERT INTO "public"."ops_lifecycle_profiles" ("classifier_version","game_id","genuine_exit_grace_seconds","metadata","mode","reset_window_seconds","supersede_on_new_run","terminal_precedence","updated_at") VALUES ('ranked-lifecycle-2','88db5186-c719-5b75-90df-27a54e6a2535',30,'{"notes":"abandon within 30s is reset; expiry superseded by newer session before expiry"}','ranked',30,true,'["rejected","completed","reset","superseded","genuine_exit","active"]','2026-10-01T21:31:32Z');
