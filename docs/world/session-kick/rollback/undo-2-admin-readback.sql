-- undo 20261010130000_world_session_admin_readback -> state after 20261010120000
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
drop function if exists public.get_world_session_admin_target_v1(uuid);
commit;
