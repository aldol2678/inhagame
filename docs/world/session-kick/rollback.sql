-- ROLLBACK for 20261009... -> 20261010120000_world_session_kick_hardening.sql (manual, NOT a migration).
-- Restores the exact function bodies that main (acd54a7) ships: v1 from the baseline, v2/kick/restore from
-- 20261009102000. Generated from pg_get_functiondef() of a database built from main, then verified by
-- diffing pg_get_functiondef() after applying this file (see docs/world/session-kick/README.md).
-- Data impact: none. Function-only; ACLs are unchanged by the hardening migration (verified identical).
-- Consequence of rolling back: v1 again has no block check, and the heartbeat/kick race and session
-- UUID takeover described in the audit are open again. Block rows already written stay valid.
begin;
CREATE OR REPLACE FUNCTION public.kick_world_user_v1(p_user_id uuid, p_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_until:=now()+make_interval(mins => p_minutes);
  insert into private.world_session_kick_blocks(user_id,blocked_until,operator_id)
  values(p_user_id,v_until,v_operator)
  on conflict(user_id) do update set
    blocked_until=greatest(private.world_session_kick_blocks.blocked_until,excluded.blocked_until),
    operator_id=excluded.operator_id,created_at=now();
  delete from public.world_online_sessions where user_id=p_user_id;
  get diagnostics v_removed=row_count;
  return jsonb_build_object('userId',p_user_id,'sessionsRemoved',v_removed,
    'blockedUntil',(select blocked_until from private.world_session_kick_blocks where user_id=p_user_id));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.restore_world_user_v1(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  delete from private.world_session_kick_blocks where user_id=p_user_id;
  return found;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_world_online_session_v1(p_session_id uuid, p_place_zone_id text DEFAULT NULL::text, p_space text DEFAULT 'campus'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.touch_world_online_session_v2(p_session_id uuid, p_visitor_id uuid DEFAULT NULL::uuid, p_place_zone_id text DEFAULT NULL::text, p_space text DEFAULT 'campus'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid());
begin
  if p_session_id is null then
    raise exception 'SESSION_ID_REQUIRED' using errcode='22023';
  end if;
  if p_place_zone_id is not null and p_place_zone_id !~ '^AREA_[A-Z0-9_]{1,60}$' then
    raise exception 'INVALID_PLACE_ZONE' using errcode='22023';
  end if;
  if p_space not in ('lobby','campus','club_room','housing_lobby','personal_room') then
    raise exception 'INVALID_SPACE' using errcode='22023';
  end if;
  if v_uid is not null and exists (
    select 1 from private.world_session_kick_blocks
    where user_id=v_uid and blocked_until>now()
  ) then
    -- Defensive cleanup: an already-running client cannot reappear in the online counter.
    delete from public.world_online_sessions where user_id=v_uid;
    raise exception 'WORLD_SESSION_REVOKED' using errcode='42501';
  end if;
  delete from public.world_online_sessions where last_seen_at < now()-interval '1 day';
  insert into public.world_online_sessions (
    session_id,user_id,visitor_id,place_zone_id,space,started_at,last_seen_at
  ) values (
    p_session_id,v_uid,p_visitor_id,p_place_zone_id,p_space,now(),now()
  ) on conflict(session_id) do update set
    user_id=excluded.user_id,
    visitor_id=coalesce(excluded.visitor_id,public.world_online_sessions.visitor_id),
    place_zone_id=excluded.place_zone_id,
    space=excluded.space,
    last_seen_at=excluded.last_seen_at;
end;
$function$
;
drop function if exists private.touch_world_online_session_core(uuid,uuid,text,text);
commit;
