-- INHA WORLD session-kick hardening (isolated draft; world-only).
--
-- Scope: functions only. No table, column, index, grant on data, account, character, inventory,
-- reward or personal-room row is created, altered or deleted. The only rows these functions touch are
-- the ephemeral heartbeat rows (public.world_online_sessions) and the operator block rows
-- (private.world_session_kick_blocks), exactly as the 20261009102000 hotfix already does.
--
-- Fixes:
--   1. v1 and v2 heartbeats share ONE private core, so the block decision cannot diverge again.
--      v1 previously had no block check at all (re-registration bypass for any cached old client).
--   2. heartbeat / kick / restore serialize per target user with the same advisory lock the
--      repository already uses for world_activity, so a heartbeat can no longer pass the block check,
--      lose a race with kick, and commit a ghost session after the kick committed.
--   3. A session UUID is owned by the account that first registered it. Another account, or a
--      signed-out call, can no longer take it over (account switch / hijack / kick evasion by
--      downgrading a row to a guest). guest -> account claim stays allowed (sign-in in the same tab).
--   4. The old "defensive cleanup" deleted rows and then raised, which rolls the delete back; it never
--      persisted. It is removed. Under the lock a blocked account cannot own live rows anyway.
--   5. Block expiry uses clock_timestamp() after the lock is held, not the transaction start time.
--   6. Stale-row cleanup is bounded and uses SKIP LOCKED so concurrent heartbeats of different users
--      cannot deadlock on each other's expired rows.
--   7. EXECUTE grants for v1/v2 are stated explicitly instead of relying on CREATE OR REPLACE.
--
-- Not claimed: this does not close an already-open Supabase Realtime socket. See
-- docs/world/session-kick/README.md (new-join gate draft and the UNKNOWN revocation item).

create or replace function private.touch_world_online_session_core(
  p_session_id uuid,
  p_visitor_id uuid,
  p_place_zone_id text,
  p_space text
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_blocked_until timestamptz;
  v_rows integer;
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

  if v_uid is not null then
    -- Same key as kick_world_user_v1 / restore_world_user_v1: the block decision and the insert below
    -- are atomic with respect to a concurrent kick or restore of this account.
    perform pg_advisory_xact_lock(hashtextextended('world_session:' || v_uid::text, 0));
    select k.blocked_until into v_blocked_until
    from private.world_session_kick_blocks k
    where k.user_id = v_uid;
    if v_blocked_until is not null and v_blocked_until > clock_timestamp() then
      raise exception 'WORLD_SESSION_REVOKED' using errcode = '42501';
    end if;
  end if;

  delete from public.world_online_sessions
  where session_id in (
    select s.session_id from public.world_online_sessions s
    where s.last_seen_at < now() - interval '1 day'
    order by s.last_seen_at
    limit 200
    for update skip locked
  );

  insert into public.world_online_sessions (
    session_id, user_id, visitor_id, place_zone_id, space, started_at, last_seen_at
  ) values (
    p_session_id, v_uid, p_visitor_id, p_place_zone_id, p_space, now(), now()
  ) on conflict (session_id) do update set
    user_id = excluded.user_id,
    visitor_id = coalesce(excluded.visitor_id, public.world_online_sessions.visitor_id),
    place_zone_id = excluded.place_zone_id,
    space = excluded.space,
    last_seen_at = excluded.last_seen_at
  -- Owner may refresh; an unowned (guest) row may be claimed by the signed-in account.
  -- Anyone else, and any signed-out call on an owned row, updates nothing.
  where public.world_online_sessions.user_id is null
     or public.world_online_sessions.user_id = excluded.user_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'WORLD_SESSION_OWNER_MISMATCH' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function private.touch_world_online_session_core(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function public.touch_world_online_session_v1(
  p_session_id uuid,
  p_place_zone_id text default null,
  p_space text default 'campus'
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.touch_world_online_session_core(p_session_id, null, p_place_zone_id, p_space);
end;
$function$;

create or replace function public.touch_world_online_session_v2(
  p_session_id uuid,
  p_visitor_id uuid default null,
  p_place_zone_id text default null,
  p_space text default 'campus'
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.touch_world_online_session_core(p_session_id, p_visitor_id, p_place_zone_id, p_space);
end;
$function$;

revoke all on function public.touch_world_online_session_v1(uuid,text,text) from public, anon, authenticated;
grant execute on function public.touch_world_online_session_v1(uuid,text,text) to anon, authenticated;
revoke all on function public.touch_world_online_session_v2(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.touch_world_online_session_v2(uuid,uuid,text,text) to anon, authenticated;

create or replace function public.kick_world_user_v1(p_user_id uuid, p_minutes integer default 30)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_operator uuid := (select auth.uid());
  v_until timestamptz;
  v_removed integer;
begin
  if v_operator is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
     or not exists (
       select 1 from private.world_staff_assignments a
       join public.profiles p on p.user_id=a.user_id
       where a.user_id=v_operator and a.active and a.role='world_admin' and not p.is_banned
     )
  then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_user_id is null or p_user_id=v_operator or p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'INVALID_KICK_TARGET' using errcode='22023';
  end if;
  if not exists (select 1 from auth.users where id=p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('world_session:' || p_user_id::text, 0));
  v_until:=clock_timestamp()+make_interval(mins => p_minutes);
  insert into private.world_session_kick_blocks(user_id,blocked_until,operator_id)
  values(p_user_id,v_until,v_operator)
  on conflict(user_id) do update set
    blocked_until=greatest(private.world_session_kick_blocks.blocked_until,excluded.blocked_until),
    operator_id=excluded.operator_id,created_at=clock_timestamp();
  delete from public.world_online_sessions where user_id=p_user_id;
  get diagnostics v_removed=row_count;
  return jsonb_build_object('userId',p_user_id,'sessionsRemoved',v_removed,
    'blockedUntil',(select blocked_until from private.world_session_kick_blocks where user_id=p_user_id),
    'serverTime',clock_timestamp());
end;
$function$;
revoke all on function public.kick_world_user_v1(uuid,integer) from public, anon, authenticated;
grant execute on function public.kick_world_user_v1(uuid,integer) to authenticated;

create or replace function public.restore_world_user_v1(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare v_operator uuid := (select auth.uid());
begin
  if v_operator is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
     or not exists (
       select 1 from private.world_staff_assignments a
       join public.profiles p on p.user_id=a.user_id
       where a.user_id=v_operator and a.active and a.role='world_admin' and not p.is_banned
     )
  then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_user_id is null then raise exception 'INVALID_KICK_TARGET' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world_session:' || p_user_id::text, 0));
  delete from private.world_session_kick_blocks where user_id=p_user_id;
  return found;
end;
$function$;
revoke all on function public.restore_world_user_v1(uuid) from public, anon, authenticated;
grant execute on function public.restore_world_user_v1(uuid) to authenticated;
