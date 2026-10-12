-- CANDIDATE: forward-only H3 authority clock and finite-retention hardening.
-- Requires the separately approved H3 schema; never installs it implicitly. No production
-- execution, activation, pg_cron job change, or historical-migration edit is authorized here.
-- Existing answered knocks stay idempotent: this is NOT an approval-cancellation API.
alter table private.world_room_knocks alter column created_at set default clock_timestamp();
alter table private.world_room_owner_presence alter column seen_at set default clock_timestamp();


-- Narrow H3 write authority: never reuse transaction-start moderation time from the
-- older generic social helper. Called again after each H3 room/knock lock is acquired.
create function private.world_room_h3_writer_v1()
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u join public.profiles p on p.user_id=u.id
    where u.id=v_user and u.is_anonymous=false and p.is_banned=false) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
  if exists(select 1 from private.world_user_moderation_actions a where a.target_id=v_user
    and a.action='interaction_restriction_24h' and a.starts_at <= clock_timestamp() and a.ends_at > clock_timestamp()) then
    raise exception 'SOCIAL_RESTRICTED' using errcode='42501';
  end if;
  if not private.world_room_cleanup_healthy_v1() then
    raise exception 'CLEANUP_UNAVAILABLE' using errcode='55000';
  end if;
  return v_user;
end;
$$;
revoke all on function private.world_room_h3_writer_v1() from public, anon, authenticated, service_role;

create or replace function private.world_room_owner_present_v1(p_room_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.world_room_owner_presence p
     where p.room_id = p_room_id and p.seen_at > clock_timestamp() - interval '12 seconds'
  );
$$;

create or replace function private.world_room_knock_json_v1(p_knock private.world_room_knocks)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'knockId', p_knock.id,
    'roomId', p_knock.room_id,
    'visitorUserId', p_knock.visitor_user_id,
    'status', case when p_knock.status = 'PENDING' and p_knock.expires_at <= clock_timestamp()
                   then 'EXPIRED' else p_knock.status end,
    'createdAt', p_knock.created_at,
    'expiresAt', p_knock.expires_at,
    'respondedAt', p_knock.responded_at
  );
$$;

create or replace function private.world_room_access_v1(p_viewer uuid, p_room_id uuid)
returns text
language plpgsql
volatile
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
       and k.status = 'DECLINED' and k.responded_at > clock_timestamp() - interval '10 minutes'
  ) then
    return 'DECLINED';
  end if;
  -- H3: while the owner is home, only a visitor the owner let in (or who arrived while the owner
  -- was away) may be in the room.
  if private.world_room_owner_present_v1(p_room_id) and not exists (
    select 1 from private.world_room_knocks k
     where k.room_id = p_room_id and k.visitor_user_id = p_viewer
       and k.status in ('ACCEPTED', 'OPEN') and k.created_at > clock_timestamp() - interval '2 hours'
  ) then
    return 'KNOCK_REQUIRED';
  end if;
  return 'VISITOR';
end;
$$;

create or replace function public.resolve_friend_personal_room_v1(p_owner uuid)
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

create or replace function public.check_world_room_access_v1(p_room uuid)
returns jsonb
language plpgsql
volatile
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

create or replace function public.knock_friend_personal_room_v1(p_owner uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.world_room_h3_writer_v1();
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
  -- A pending lock must not preserve the caller/relationship/clock from function entry.
  perform private.world_room_h3_writer_v1();
  if not private.world_room_cleanup_healthy_v1() then
    raise exception 'CLEANUP_UNAVAILABLE' using errcode = '55000';
  end if;

  update private.world_room_knocks k
     set status = 'EXPIRED'
   where k.room_id = v_room.id and k.status = 'PENDING' and k.expires_at <= clock_timestamp();

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
       and k.status in ('ACCEPTED', 'OPEN') and k.created_at > clock_timestamp() - interval '2 hours'
     order by k.created_at desc limit 1;
    if found then
      return private.world_room_knock_json_v1(v_knock)
        || jsonb_build_object('ownerPresent', private.world_room_owner_present_v1(v_room.id));
    end if;
  end if;

  if not private.world_room_owner_present_v1(v_room.id) then
    insert into private.world_room_knocks (room_id, visitor_user_id, status, expires_at, responded_at)
    values (v_room.id, v_caller, 'OPEN', clock_timestamp() + interval '2 hours', clock_timestamp())
    returning * into v_knock;
    return private.world_room_knock_json_v1(v_knock) || jsonb_build_object('ownerPresent', false);
  end if;

  if (select count(*) from private.world_room_knocks k
       where k.room_id = v_room.id and k.visitor_user_id = v_caller
         and k.created_at > clock_timestamp() - interval '2 minutes') >= 5 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
  insert into private.world_room_knocks (room_id, visitor_user_id, status, expires_at)
  values (v_room.id, v_caller, 'PENDING', clock_timestamp() + interval '30 seconds')
  returning * into v_knock;
  return private.world_room_knock_json_v1(v_knock) || jsonb_build_object('ownerPresent', true);
end;
$$;

create or replace function public.get_my_room_knock_v1(p_knock uuid)
returns jsonb
language plpgsql
volatile
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
  perform 1 from public.world_player_rooms r where r.id = v_room.id for update;
  perform private.world_room_h3_writer_v1();
  if not private.world_room_cleanup_healthy_v1() then
    raise exception 'CLEANUP_UNAVAILABLE' using errcode = '55000';
  end if;
  insert into private.world_room_owner_presence (room_id, seen_at) values (v_room.id, clock_timestamp())
  on conflict (room_id) do update set seen_at = excluded.seen_at;
  update private.world_room_knocks k
     set status = 'EXPIRED'
   where k.room_id = v_room.id and k.status = 'PENDING' and k.expires_at <= clock_timestamp();
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

create or replace function public.respond_room_knock_v1(p_knock uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.world_room_caller_v1();
  v_knock private.world_room_knocks%rowtype;
  v_room public.world_player_rooms%rowtype;
  v_room_id uuid;
  v_now timestamptz;
begin
  if p_accept is null then raise exception 'INVALID_RESPONSE' using errcode = '22023'; end if;
  select k.room_id into v_room_id from private.world_room_knocks k
    join public.world_player_rooms r on r.id=k.room_id where k.id=p_knock and r.owner_user_id=v_uid;
  if not found then raise exception 'KNOCK_NOT_FOUND' using errcode = 'P0002'; end if;
  -- All H3 writers/cleanup use room -> knock. Never acquire them in the reverse order.
  select r.* into v_room from public.world_player_rooms r where r.id=v_room_id and r.owner_user_id=v_uid for update;
  if not found then raise exception 'KNOCK_NOT_FOUND' using errcode = 'P0002'; end if;
  select k.* into v_knock from private.world_room_knocks k where k.id=p_knock and k.room_id=v_room.id for update;
  if not found then raise exception 'KNOCK_NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.world_room_h3_writer_v1();
  v_now := clock_timestamp();
  if v_knock.status='PENDING' and v_knock.expires_at <= v_now then
    update private.world_room_knocks set status='EXPIRED' where id=v_knock.id returning * into v_knock;
  end if;
  -- Answered/expired records return unchanged. A later false response does not revoke ACCEPTED.
  if v_knock.status='PENDING' then
    if not private.world_room_cleanup_healthy_v1() then raise exception 'CLEANUP_UNAVAILABLE' using errcode='55000'; end if;
    if private.world_relationship(v_knock.visitor_user_id,v_uid) <> 'friends' then
      raise exception 'NOT_FRIENDS' using errcode='42501';
    end if;
    if v_room.visibility <> 'friends' then raise exception 'ROOM_PRIVATE' using errcode='42501'; end if;
    if private.world_room_access_v1(v_knock.visitor_user_id,v_room.id) not in ('VISITOR','KNOCK_REQUIRED') then
      raise exception 'VISIT_DENIED' using errcode='42501';
    end if;
    update private.world_room_knocks set status=case when p_accept then 'ACCEPTED' else 'DECLINED' end,
      responded_at=clock_timestamp() where id=v_knock.id returning * into v_knock;
  end if;
  return private.world_room_knock_json_v1(v_knock);
end;
$$;

-- Healthy minute cleanup: ACCEPTED/OPEN <= 121 minutes, DECLINED <= 11 minutes
-- (and >= the 2-minute rate window), expired PENDING/EXPIRED <= 3 minutes, and owner
-- presence <= 72 seconds. Outage may retain records until recovery. No transcript is stored.
create or replace function private.world_room_cleanup_v1()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_room uuid;
begin
  perform 1 from private.world_club_rooms where room_id='ROOM_CLUBHOUSE_01' for update;
  -- Plant CARE takes owner inventory -> personal room -> chat lease FOR SHARE. Obtain every
  -- affected personal room before deleting personal chat rows, avoiding lease -> room inversion.
  for v_room in
    select affected.room_id from (
      select k.room_id from private.world_room_knocks k where
        (k.status in ('ACCEPTED','OPEN') and k.created_at <= clock_timestamp()-interval '2 hours')
        or (k.status='DECLINED' and k.responded_at <= clock_timestamp()-interval '10 minutes'
          and k.created_at <= clock_timestamp()-interval '2 minutes')
        or (k.status in ('PENDING','EXPIRED') and k.expires_at <= clock_timestamp()
          and k.created_at <= clock_timestamp()-interval '2 minutes')
      union select p.room_id from private.world_room_owner_presence p where p.seen_at <= clock_timestamp()-interval '12 seconds'
      union select s.room_id::uuid from private.world_room_chat_sessions s
        where s.kind='personal' and s.lease_expires_at <= clock_timestamp()
    ) affected order by affected.room_id
  loop
    perform 1 from public.world_player_rooms where id=v_room for update;
    delete from private.world_room_knocks k where k.room_id=v_room and (
      (k.status in ('ACCEPTED','OPEN') and k.created_at <= clock_timestamp()-interval '2 hours')
      or (k.status='DECLINED' and k.responded_at <= clock_timestamp()-interval '10 minutes'
        and k.created_at <= clock_timestamp()-interval '2 minutes')
      or (k.status in ('PENDING','EXPIRED') and k.expires_at <= clock_timestamp()
        and k.created_at <= clock_timestamp()-interval '2 minutes'));
    delete from private.world_room_owner_presence where room_id=v_room and seen_at <= clock_timestamp()-interval '12 seconds';
    delete from private.world_room_chat_sessions where kind='personal' and room_id=v_room::text and lease_expires_at <= clock_timestamp();
  end loop;
  delete from private.world_club_room_sessions where lease_expires_at <= clock_timestamp();
  -- Personal rows are deleted only inside their room-locked loop above. A row that expires
  -- after the initial scan waits for the next minute rather than reversing lock order.
  delete from private.world_room_chat_sessions where kind='club' and lease_expires_at <= clock_timestamp();
  delete from private.world_club_room_admission_limits where created_at <= clock_timestamp()-interval '1 hour';
  delete from private.world_room_chat_limits l where not exists (
    select 1 from unnest(l.sent_at) t where t > clock_timestamp()-interval '5 seconds');
  update private.world_room_cleanup_state set last_succeeded_at=clock_timestamp() where singleton;
end;
$$;
revoke all on function private.world_room_cleanup_v1() from public, anon, authenticated, service_role;


-- Pin the clock-hardened reviewed bodies, replacing the earlier pre-hardening pin.
create or replace function private.world_room_chat_personal_authority_ready_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select to_regclass('private.world_room_knocks') is not null
    and to_regclass('private.world_room_owner_presence') is not null
    and exists (select 1 from pg_catalog.pg_proc where oid = to_regprocedure('private.world_room_access_v1(uuid,uuid)')
      and prosecdef and provolatile='v' and 'search_path=""' = any(proconfig)
      and md5(prosrc) = '57aa76e56a5d777558239a6496a61347')
    and exists (select 1 from pg_catalog.pg_proc where oid = to_regprocedure('private.world_room_owner_present_v1(uuid)')
      and prosecdef and provolatile='v' and 'search_path=""' = any(proconfig)
      and md5(prosrc) = 'e80c432bffbce06e93786e3e575b3b8d')
$$;

-- Private bridge for friend-only plant CARE. Public room entry cannot be inferred merely
-- from an H3 two-hour receipt: this additionally requires the exact current 30-second lease.
create function private.world_room_chat_plant_lease_v1(p_user uuid,p_room uuid,p_session uuid,p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_lease private.world_room_chat_sessions%rowtype;
begin
  if p_user is null or p_room is null or p_session is null or p_lease is null
    or p_user is distinct from auth.uid() or (auth.jwt()->>'is_anonymous') is distinct from 'false' then return false; end if;
  select s.* into v_lease from private.world_room_chat_sessions s
    where s.id=p_lease and s.user_id=p_user for share;
  -- FOR SHARE blocks a concurrent leave/delete until the surrounding CARE transaction ends.
  -- It also waits behind renewal/replacement, so clock and all authority are read AFTER it.
  return found and v_lease.kind='personal' and v_lease.room_id=p_room::text
    and v_lease.session_id=p_session and v_lease.lease_expires_at > clock_timestamp()
    and private.world_room_chat_access_v1(p_user,'personal',p_room::text,p_session,null)
    and private.world_room_access_v1(p_user,p_room)='VISITOR';
end;
$$;
revoke all on function private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
