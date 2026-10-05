-- Public forward migration: ported from the private S1-D2 migration. The Production lineage records it
-- under its own version (20261002080000); versions are not shared across the two lineages.
-- INHA WORLD Social S1-D2 · Personal Room Session + friend visits (rebuilt on current main).
--
-- Room Authority stays in public.world_player_rooms (D1.3). This migration adds:
--   * one private access decision (private.world_room_access_v1) that every surface reuses:
--     OWNER / VISITOR / PRIVATE / DENIED. Knowing a room UUID never grants access: a non-owner
--     needs an accepted friendship, no block in either direction, a non-banned owner and a
--     FRIENDS room. Unknown rooms and strangers get the same DENIED (no existence oracle).
--   * resolve_friend_personal_room_v1(owner)  – the friend-visit resolver (Player Card / Friends).
--   * check_world_room_access_v1(room)         – the Room Session join + 15 s revalidation read.
--   * set_my_personal_room_visibility_v1(text) – owner-only PRIVATE / FRIENDS switch.
--   * can_access_world_room_realtime_v1(topic) – boolean used by the Realtime RLS policies for
--     private `world:room:<uuid>` channels.
-- The Realtime installer keeps the guest campus policies of 20260927110305 unchanged and only
-- adds the room-topic branch. PUBLIC rooms are out of scope: the visibility CHECK is untouched.
-- Repeat-safe: CREATE OR REPLACE throughout; no data is written.

create schema if not exists private;
revoke all on schema private from public;

-- ---- the single access decision -----------------------------------------------------------
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
  return 'VISITOR';
end;
$$;
revoke all on function private.world_room_access_v1(uuid, uuid) from public, anon, authenticated;

create or replace function private.world_personal_room_json_v1(p_room public.world_player_rooms)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roomId', p_room.id,
    'ownerUserId', p_room.owner_user_id,
    'roomType', p_room.room_type,
    'visibility', p_room.visibility,
    'createdAt', p_room.created_at,
    'updatedAt', p_room.updated_at
  );
$$;
revoke all on function private.world_personal_room_json_v1(public.world_player_rooms) from public, anon, authenticated;

-- ---- friend visit resolver ------------------------------------------------------------------
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
  if v_access <> 'VISITOR' then
    raise exception 'NOT_FRIENDS' using errcode = '42501';
  end if;

  return private.world_personal_room_json_v1(v_room) || jsonb_build_object(
    'ownerDisplayName', (select p.nickname from public.profiles p where p.user_id = p_owner),
    'role', 'visitor'
  );
end;
$$;

-- ---- session join / revalidation read ---------------------------------------------------
-- Never raises for a denial: the Room Session turns { allowed: false } into an eviction.
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
      'reason', case when v_access = 'PRIVATE' then 'ROOM_PRIVATE' else 'DENIED' end);
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

-- ---- owner privacy switch -----------------------------------------------------------------
create or replace function public.set_my_personal_room_visibility_v1(p_visibility text)
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
  if p_visibility is null or p_visibility not in ('private', 'friends') then
    raise exception 'INVALID_VISIBILITY' using errcode = '22023';
  end if;

  update public.world_player_rooms r
     set visibility = p_visibility,
         -- An identical request is idempotent and leaves updated_at alone.
         updated_at = case when r.visibility = p_visibility then r.updated_at else now() end
   where r.owner_user_id = v_uid
  returning r.* into v_room;

  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.world_personal_room_json_v1(v_room);
end;
$$;

-- ---- Realtime RLS predicate -----------------------------------------------------------------
create or replace function public.can_access_world_room_realtime_v1(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true)
     or p_topic is null
     or p_topic !~ '^world:room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.world_room_access_v1(v_uid, substring(p_topic from 12)::uuid) in ('OWNER', 'VISITOR');
end;
$$;

revoke all on function
  public.resolve_friend_personal_room_v1(uuid),
  public.check_world_room_access_v1(uuid),
  public.set_my_personal_room_visibility_v1(text),
  public.can_access_world_room_realtime_v1(text)
from public, anon, authenticated;
grant execute on function
  public.resolve_friend_personal_room_v1(uuid),
  public.check_world_room_access_v1(uuid),
  public.set_my_personal_room_visibility_v1(text),
  public.can_access_world_room_realtime_v1(text)
to authenticated;

-- ---- Realtime policies: guest campus channels unchanged + private room channels -------------
create or replace function private.install_world_online_realtime_policies()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
      and (
        (select realtime.topic()) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'
        or (select public.can_access_world_room_realtime_v1((select realtime.topic())))
      )
    );

  drop policy if exists "world online players write place zone" on realtime.messages;
  create policy "world online players write place zone"
    on realtime.messages
    for insert
    to authenticated
    with check (
      (select auth.uid()) is not null
      and realtime.messages.extension in ('broadcast', 'presence')
      and (
        (select realtime.topic()) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'
        or (select public.can_access_world_room_realtime_v1((select realtime.topic())))
      )
    );
end;
$$;

revoke all on function private.install_world_online_realtime_policies() from public, anon, authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    perform private.install_world_online_realtime_policies();
  else
    raise notice 'realtime.messages absent (Realtime service not running); world online policies not installed';
  end if;
end;
$$;

