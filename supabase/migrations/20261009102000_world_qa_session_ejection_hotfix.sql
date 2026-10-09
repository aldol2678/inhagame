-- INHA WORLD P0 emergency: operator-controlled world-only QA ejection.
-- Authentication, inventory, characters, and historical gameplay data are untouched.
create table if not exists private.world_session_kick_blocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked_until timestamptz not null,
  created_at timestamptz not null default now(),
  operator_id uuid not null references auth.users(id),
  reason text not null default 'operator_kick'
);
alter table private.world_session_kick_blocks enable row level security;
revoke all on private.world_session_kick_blocks from public, anon, authenticated;

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
  delete from private.world_session_kick_blocks where user_id=p_user_id;
  return found;
end;
$function$;
revoke all on function public.restore_world_user_v1(uuid) from public, anon, authenticated;
grant execute on function public.restore_world_user_v1(uuid) to authenticated;

-- Keep existing public heartbeat shape and behavior, but refuse re-registration.
create or replace function public.touch_world_online_session_v2(
  p_session_id uuid,
  p_visitor_id uuid default null,
  p_place_zone_id text default null,
  p_space text default 'campus'
) returns void
language plpgsql security definer set search_path = ''
as $function$
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
$function$;
-- Existing grants remain unchanged on CREATE OR REPLACE.
