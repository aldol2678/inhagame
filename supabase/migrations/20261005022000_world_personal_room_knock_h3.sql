-- INHA WORLD Housing H3 · knock before visiting a friend's room.
--
-- A friend visit becomes: walk to 제1생활관 → knock → (owner present) wait for the owner's answer.
-- The access decision stays private.world_room_access_v1, extended with two rules:
--   * owner present (the owner's client polled list_my_room_knocks_v1 within the last 12 s):
--     a visitor needs an ACCEPTED knock, or an OPEN one from an earlier owner-absent arrival,
--     from the last 2 hours → otherwise KNOCK_REQUIRED. An admission is not tied to one stay:
--     within those 2 hours the same visitor may re-enter without a new answer.
--   * a DECLINED knock from the last 10 minutes → DECLINED, for the room and that visitor only.
-- Owner absent: a knock is admitted at once by the room's visibility (status OPEN), exactly the
-- S1-D2 behaviour, and is kept as the arrival record.
-- Clients that never poll (older owners) never count as present, so their rooms keep the D2 rule.
-- New surface (authenticated, caller = auth.uid()):
--   knock_friend_personal_room_v1(owner)   visitor: OPEN at once, or PENDING for 30 s
--   get_my_room_knock_v1(knock)            visitor: read own knock (lazy expiry)
--   list_my_room_knocks_v1()               owner: pending knocks for own room + presence heartbeat
--   respond_room_knock_v1(knock, accept)   owner: ACCEPTED / DECLINED, idempotent on repeats
-- Tables are private (no Data API grants); rows reference rooms and cascade with them.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.world_room_knocks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.world_player_rooms(id) on delete cascade,
  visitor_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'OPEN')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'PENDING') = (responded_at is null) or status = 'EXPIRED')
);
create unique index if not exists world_room_knocks_one_pending
  on private.world_room_knocks (room_id, visitor_user_id) where status = 'PENDING';
create index if not exists world_room_knocks_room_visitor_recent
  on private.world_room_knocks (room_id, visitor_user_id, created_at desc);
create index if not exists world_room_knocks_room_pending
  on private.world_room_knocks (room_id, created_at) where status = 'PENDING';
alter table private.world_room_knocks enable row level security;
revoke all on private.world_room_knocks from public, anon, authenticated;

create table if not exists private.world_room_owner_presence (
  room_id uuid primary key references public.world_player_rooms(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table private.world_room_owner_presence enable row level security;
revoke all on private.world_room_owner_presence from public, anon, authenticated;

-- ---- shared helpers -------------------------------------------------------------------------
create or replace function private.world_room_owner_present_v1(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.world_room_owner_presence p
     where p.room_id = p_room_id and p.seen_at > now() - interval '12 seconds'
  );
$$;
revoke all on function private.world_room_owner_present_v1(uuid) from public, anon, authenticated;

create or replace function private.world_room_knock_json_v1(p_knock private.world_room_knocks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'knockId', p_knock.id,
    'roomId', p_knock.room_id,
    'visitorUserId', p_knock.visitor_user_id,
    'status', case when p_knock.status = 'PENDING' and p_knock.expires_at <= now()
                   then 'EXPIRED' else p_knock.status end,
    'createdAt', p_knock.created_at,
    'expiresAt', p_knock.expires_at,
    'respondedAt', p_knock.responded_at
  );
$$;
revoke all on function private.world_room_knock_json_v1(private.world_room_knocks) from public, anon, authenticated;

-- ---- the single access decision (D2 rules + H3 knock rules) ---------------------------------
create or replace function private.world_room_access_v1(p_viewer uuid, p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.world_player_rooms%rowtype;
begin
  if p_viewer is null or p_room_id is null then
    return 'DENIED';
  end if;
  -- The viewer must be a permanent, non-banned account (guests never enter a personal room).
  if not exists (
    select 1
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.id = p_viewer
       and u.is_anonymous is not true
       and p.is_banned = false
  ) then
    return 'DENIED';
  end if;

  select r.* into v_room from public.world_player_rooms r where r.id = p_room_id;
  if not found then
    return 'DENIED';
  end if;
  if v_room.owner_user_id = p_viewer then
    return 'OWNER';
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = v_room.owner_user_id and p.is_banned = false
  ) then
    return 'DENIED';
  end if;
  -- world_relationship checks blocks in both directions before friendship.
  if private.world_relationship(p_viewer, v_room.owner_user_id) <> 'friends' then
    return 'DENIED';
  end if;
  if v_room.visibility <> 'friends' then
    return 'PRIVATE';
  end if;
  -- H3: an owner's "not now" holds for 10 minutes, for this room and this visitor only.
  if exists (
    select 1 from private.world_room_knocks k
     where k.room_id = p_room_id and k.visitor_user_id = p_viewer
       and k.status = 'DECLINED' and k.responded_at > now() - interval '10 minutes'
  ) then
    return 'DECLINED';
  end if;
  -- H3: while the owner is home, only a visitor the owner let in (or who arrived while the owner
  -- was away) may be in the room.
  if private.world_room_owner_present_v1(p_room_id) and not exists (
    select 1 from private.world_room_knocks k
     where k.room_id = p_room_id and k.visitor_user_id = p_viewer
       and k.status in ('ACCEPTED', 'OPEN') and k.created_at > now() - interval '2 hours'
  ) then
    return 'KNOCK_REQUIRED';
  end if;
  return 'VISITOR';
end;
$$;
revoke all on function private.world_room_access_v1(uuid, uuid) from public, anon, authenticated;

-- ---- friend visit resolver: distinct reasons for the H3 outcomes ----------------------------
create or replace function public.resolve_friend_personal_room_v1(p_owner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.world_social_caller();
  v_room public.world_player_rooms%rowtype;
  v_access text;
begin
  perform private.world_social_target(v_caller, p_owner);
  -- Friendship first, so a non-friend never learns whether the target has a room.
  if private.world_relationship(v_caller, p_owner) <> 'friends' then
    raise exception 'NOT_FRIENDS' using errcode = '42501';
  end if;

  select r.* into v_room from public.world_player_rooms r where r.owner_user_id = p_owner;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_access := private.world_room_access_v1(v_caller, v_room.id);
  if v_access = 'PRIVATE' then
    raise exception 'ROOM_PRIVATE' using errcode = '42501';
  end if;
  if v_access = 'DECLINED' then
    raise exception 'VISIT_DECLINED' using errcode = '42501';
  end if;
  if v_access = 'KNOCK_REQUIRED' then
    raise exception 'KNOCK_REQUIRED' using errcode = '42501';
  end if;
  if v_access <> 'VISITOR' then
    raise exception 'NOT_FRIENDS' using errcode = '42501';
  end if;

  return private.world_personal_room_json_v1(v_room) || jsonb_build_object(
    'ownerDisplayName', (select p.nickname from public.profiles p where p.user_id = p_owner),
    'role', 'visitor'
  );
end;
$$;

-- ---- session join / revalidation read: distinct reasons for the H3 outcomes -----------------
create or replace function public.check_world_room_access_v1(p_room uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_access text;
  v_room public.world_player_rooms%rowtype;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    return jsonb_build_object('roomId', p_room, 'allowed', false, 'role', null, 'reason', 'PERMANENT_ACCOUNT_REQUIRED');
  end if;
  v_access := private.world_room_access_v1(v_uid, p_room);
  if v_access not in ('OWNER', 'VISITOR') then
    return jsonb_build_object('roomId', p_room, 'allowed', false, 'role', null,
      'reason', case v_access
        when 'PRIVATE' then 'ROOM_PRIVATE'
        when 'DECLINED' then 'VISIT_DECLINED'
        when 'KNOCK_REQUIRED' then 'KNOCK_REQUIRED'
        else 'DENIED' end);
  end if;
  select r.* into v_room from public.world_player_rooms r where r.id = p_room;
  return jsonb_build_object(
    'roomId', v_room.id,
    'allowed', true,
    'role', lower(v_access),
    'reason', null,
    'ownerUserId', v_room.owner_user_id,
    'visibility', v_room.visibility
  );
end;
$$;

-- ---- visitor: knock -------------------------------------------------------------------------
create or replace function public.knock_friend_personal_room_v1(p_owner uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.world_social_caller();
  v_room public.world_player_rooms%rowtype;
  v_access text;
  v_knock private.world_room_knocks%rowtype;
begin
  perform private.world_social_target(v_caller, p_owner);
  if private.world_relationship(v_caller, p_owner) <> 'friends' then
    raise exception 'NOT_FRIENDS' using errcode = '42501';
  end if;
  select r.* into v_room from public.world_player_rooms r where r.owner_user_id = p_owner;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Serialize knocks per room so presence, rate limit and the pending slot agree.
  perform 1 from public.world_player_rooms r where r.id = v_room.id for update;

  update private.world_room_knocks k
     set status = 'EXPIRED'
   where k.room_id = v_room.id and k.status = 'PENDING' and k.expires_at <= now();

  v_access := private.world_room_access_v1(v_caller, v_room.id);
  if v_access = 'PRIVATE' then
    raise exception 'ROOM_PRIVATE' using errcode = '42501';
  end if;
  if v_access = 'DECLINED' then
    raise exception 'VISIT_DECLINED' using errcode = '42501';
  end if;
  if v_access not in ('VISITOR', 'KNOCK_REQUIRED') then
    raise exception 'NOT_FRIENDS' using errcode = '42501';
  end if;

  -- A repeated knock while one is still waiting returns that knock.
  select k.* into v_knock from private.world_room_knocks k
   where k.room_id = v_room.id and k.visitor_user_id = v_caller and k.status = 'PENDING';
  if found then
    return private.world_room_knock_json_v1(v_knock) || jsonb_build_object('ownerPresent', true);
  end if;

  -- A still-valid admission is reused rather than stacking a new row per knock.
  if v_access = 'VISITOR' then
    select k.* into v_knock from private.world_room_knocks k
     where k.room_id = v_room.id and k.visitor_user_id = v_caller
       and k.status in ('ACCEPTED', 'OPEN') and k.created_at > now() - interval '2 hours'
     order by k.created_at desc limit 1;
    if found then
      return private.world_room_knock_json_v1(v_knock)
        || jsonb_build_object('ownerPresent', private.world_room_owner_present_v1(v_room.id));
    end if;
  end if;

  if not private.world_room_owner_present_v1(v_room.id) then
    insert into private.world_room_knocks (room_id, visitor_user_id, status, expires_at, responded_at)
    values (v_room.id, v_caller, 'OPEN', now() + interval '2 hours', now())
    returning * into v_knock;
    return private.world_room_knock_json_v1(v_knock) || jsonb_build_object('ownerPresent', false);
  end if;

  if (select count(*) from private.world_room_knocks k
       where k.room_id = v_room.id and k.visitor_user_id = v_caller
         and k.created_at > now() - interval '2 minutes') >= 5 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
  insert into private.world_room_knocks (room_id, visitor_user_id, status, expires_at)
  values (v_room.id, v_caller, 'PENDING', now() + interval '30 seconds')
  returning * into v_knock;
  return private.world_room_knock_json_v1(v_knock) || jsonb_build_object('ownerPresent', true);
end;
$$;

-- ---- visitor: read own knock ----------------------------------------------------------------
create or replace function public.get_my_room_knock_v1(p_knock uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.world_room_caller_v1();
  v_knock private.world_room_knocks%rowtype;
begin
  select k.* into v_knock from private.world_room_knocks k
   where k.id = p_knock and k.visitor_user_id = v_caller;
  if not found then
    raise exception 'KNOCK_NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.world_room_knock_json_v1(v_knock);
end;
$$;

-- ---- owner: pending knocks + presence heartbeat ---------------------------------------------
create or replace function public.list_my_room_knocks_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_room_caller_v1();
  v_room public.world_player_rooms%rowtype;
begin
  select r.* into v_room from public.world_player_rooms r where r.owner_user_id = v_uid;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into private.world_room_owner_presence (room_id, seen_at) values (v_room.id, now())
  on conflict (room_id) do update set seen_at = excluded.seen_at;
  update private.world_room_knocks k
     set status = 'EXPIRED'
   where k.room_id = v_room.id and k.status = 'PENDING' and k.expires_at <= now();
  return jsonb_build_object(
    'roomId', v_room.id,
    'knocks', coalesce((
      select jsonb_agg(private.world_room_knock_json_v1(k)
               || jsonb_build_object('visitorDisplayName', p.nickname)
             order by k.created_at)
        from private.world_room_knocks k
        left join public.profiles p on p.user_id = k.visitor_user_id
       where k.room_id = v_room.id and k.status = 'PENDING'
         -- A visitor who has since been blocked or unfriended no longer appears.
         and private.world_relationship(v_uid, k.visitor_user_id) = 'friends'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---- owner: answer a knock ------------------------------------------------------------------
create or replace function public.respond_room_knock_v1(p_knock uuid, p_accept boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_room_caller_v1();
  v_knock private.world_room_knocks%rowtype;
begin
  if p_accept is null then
    raise exception 'INVALID_RESPONSE' using errcode = '22023';
  end if;
  select k.* into v_knock
    from private.world_room_knocks k
    join public.world_player_rooms r on r.id = k.room_id
   where k.id = p_knock and r.owner_user_id = v_uid
   for update of k;
  if not found then
    raise exception 'KNOCK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_knock.status = 'PENDING' and v_knock.expires_at <= now() then
    update private.world_room_knocks set status = 'EXPIRED' where id = v_knock.id returning * into v_knock;
  end if;
  -- Answered or expired knocks are returned unchanged (a lost response may retry).
  if v_knock.status = 'PENDING' then
    update private.world_room_knocks
       set status = case when p_accept then 'ACCEPTED' else 'DECLINED' end, responded_at = now()
     where id = v_knock.id
    returning * into v_knock;
  end if;
  return private.world_room_knock_json_v1(v_knock);
end;
$$;

revoke all on function
  public.knock_friend_personal_room_v1(uuid),
  public.get_my_room_knock_v1(uuid),
  public.list_my_room_knocks_v1(),
  public.respond_room_knock_v1(uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.knock_friend_personal_room_v1(uuid),
  public.get_my_room_knock_v1(uuid),
  public.list_my_room_knocks_v1(),
  public.respond_room_knock_v1(uuid, boolean)
to authenticated;
