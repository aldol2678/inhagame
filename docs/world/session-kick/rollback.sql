-- undo ALL of 20261010120000, 20261010130000, 20261010140000 -> main (acd54a7)
-- Manual rollback (NOT a migration). Function definitions are extracted with pg_get_functiondef() from a
-- database built at the target state, then verified by diffing definitions after applying this file.
-- Function-only: no data is read, changed or restored. Block rows and heartbeat rows are untouched.
begin;
CREATE OR REPLACE FUNCTION public.get_world_session_admin_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
    or not exists (
      select 1
      from private.world_staff_assignments a
      join public.profiles p on p.user_id=a.user_id
      where a.user_id=v_actor
        and a.active and a.role='world_admin' and not p.is_banned
    )
  then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  return jsonb_build_object(
    'asOf', now(),
    'operatorUserId', v_actor,
    'activeWindowSeconds', 70,
    'onlineSessions', (
      select count(*)::integer
      from public.world_online_sessions
      where last_seen_at >= now()-interval '70 seconds'
    ),
    'guestSessions', (
      select count(*)::integer
      from public.world_online_sessions
      where last_seen_at >= now()-interval '70 seconds' and user_id is null
    ),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', s.user_id,
        'nickname', coalesce(s.nickname,'(닉네임 없음)'),
        'sessionCount', s.session_count,
        'space', s.space,
        'placeZoneId', s.place_zone_id,
        'lastSeenAt', s.last_seen_at
      ) order by s.last_seen_at desc)
      from (
        select
          w.user_id,
          max(p.nickname) as nickname,
          count(*)::integer as session_count,
          max(w.last_seen_at) as last_seen_at,
          (array_agg(w.space order by w.last_seen_at desc))[1] as space,
          (array_agg(w.place_zone_id order by w.last_seen_at desc))[1] as place_zone_id
        from public.world_online_sessions w
        left join public.profiles p on p.user_id=w.user_id
        where w.last_seen_at >= now()-interval '70 seconds'
          and w.user_id is not null
        group by w.user_id
        order by max(w.last_seen_at) desc
        limit 100
      ) s
    ),'[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', b.user_id,
        'nickname', coalesce(b.nickname,'(닉네임 없음)'),
        'blockedUntil', b.blocked_until
      ) order by b.blocked_until asc)
      from (
        select k.user_id,p.nickname,k.blocked_until
        from private.world_session_kick_blocks k
        left join public.profiles p on p.user_id=k.user_id
        where k.blocked_until>now()
        order by k.blocked_until asc
        limit 100
      ) b
    ),'[]'::jsonb)
  );
end;
$function$
;
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
drop function if exists public.get_world_session_admin_target_v1(uuid);
drop function if exists private.touch_world_online_session_core(uuid,uuid,text,text);
commit;
