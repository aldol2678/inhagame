-- INHA WORLD guest session binding (F09). Function-only; no table, column or data change.
--
-- 20261010120000 made a session UUID owned by the account that registered it, but a guest row has no
-- account: any caller holding only the UUID could rewrite it (visitor id, zone, space) or claim it at
-- sign-in. A row that carries a browser visitor id is now bound to that id: a call with a different id,
-- or with none, is refused with WORLD_SESSION_OWNER_MISMATCH (the client already rotates its UUID and
-- retries on that error). The legitimate sign-in on the same page presents the same visitor id and is
-- unchanged. Rows that never had a visitor id (v1 clients, browsers without storage) stay unbound:
-- this is defense in depth on top of a 122-bit random UUID, not an authentication boundary.
-- Everything else in the core is identical to 20261010120000.

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
  where (public.world_online_sessions.user_id is null
         or public.world_online_sessions.user_id = excluded.user_id)
    -- Once a row carries a browser visitor id, only calls presenting the SAME id may touch it. This is a
    -- consistency binding, not authorization (the column is analytics-only and a caller may omit it on
    -- rows that never had one): it stops a holder of just the session UUID from rewriting or claiming a
    -- guest row created by another browser.
    and (public.world_online_sessions.visitor_id is null
         or public.world_online_sessions.visitor_id = excluded.visitor_id);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'WORLD_SESSION_OWNER_MISMATCH' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function private.touch_world_online_session_core(uuid,uuid,text,text) from public, anon, authenticated;
