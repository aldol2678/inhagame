-- INHA WORLD session admin read-back (F08). Function-only; no table, column or data change.
--
-- get_world_session_admin_v1() returns at most 100 accounts and 100 blocks. A caller that treats
-- "the target is not in the list" as proof that the target's heartbeat sessions ended (or that a block
-- was lifted) is wrong whenever the list is truncated. This migration:
--   1. adds exact totals and truncation flags to the roster (additive keys, existing keys unchanged);
--   2. lists the NEWEST blocks first so a block that was just issued is never the one cut by the cap;
--   3. adds get_world_session_admin_target_v1(uuid): an exact, uncapped read for ONE account, which is
--      the only evidence the admin UI may use for "heartbeat sessions ended" / "block active".
-- Same authorization as the roster (active world_admin, not banned, not anonymous). Reads only.

create or replace function public.get_world_session_admin_v1()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
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
    -- The lists below are capped at 100 rows. These totals say how many rows exist, so a caller can
    -- tell "not in the list" apart from "not there": absence from a truncated list proves nothing.
    'accountsTotal', (
      select count(distinct user_id)::integer from public.world_online_sessions
      where last_seen_at >= now()-interval '70 seconds' and user_id is not null
    ),
    'accountsTruncated', (
      select count(distinct user_id) > 100 from public.world_online_sessions
      where last_seen_at >= now()-interval '70 seconds' and user_id is not null
    ),
    'blockedTotal', (
      select count(*)::integer from private.world_session_kick_blocks where blocked_until>now()
    ),
    'blockedTruncated', (
      select count(*) > 100 from private.world_session_kick_blocks where blocked_until>now()
    ),
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
      ) order by b.created_at desc)
      from (
        select k.user_id,p.nickname,k.blocked_until,k.created_at
        from private.world_session_kick_blocks k
        left join public.profiles p on p.user_id=k.user_id
        where k.blocked_until>now()
        order by k.created_at desc
        limit 100
      ) b
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_world_session_admin_v1() from public,anon,authenticated;
grant execute on function public.get_world_session_admin_v1() to authenticated;

create or replace function public.get_world_session_admin_target_v1(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
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
  if p_user_id is null then
    raise exception 'INVALID_KICK_TARGET' using errcode='22023';
  end if;
  return jsonb_build_object(
    'asOf', now(),
    'userId', p_user_id,
    -- every heartbeat row owned by the account, including stale ones: kick deletes them all and a
    -- blocked account cannot create more, so 0 here is the proof the roster list cannot give.
    'sessionRows', (select count(*)::integer from public.world_online_sessions where user_id=p_user_id),
    'activeSessions', (
      select count(*)::integer from public.world_online_sessions
      where user_id=p_user_id and last_seen_at >= now()-interval '70 seconds'
    ),
    'blockedUntil', (
      select k.blocked_until from private.world_session_kick_blocks k
      where k.user_id=p_user_id and k.blocked_until>now()
    )
  );
end;
$function$;

revoke all on function public.get_world_session_admin_target_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_world_session_admin_target_v1(uuid) to authenticated;
