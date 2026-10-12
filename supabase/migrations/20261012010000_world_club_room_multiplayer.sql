-- Local replay candidate only. This file does not authorize applying any database change.
-- One common six-person club room; no club membership, club creation, or progression writes.
-- A recipient-specific, never-reused inbox prevents cached Realtime authorization from leaking
-- future packets after its lease ends. All client publications go through a validating RPC.

create table private.world_club_rooms (
  room_id text primary key check (room_id = 'ROOM_CLUBHOUSE_01'),
  capacity integer not null default 6 check (capacity = 6),
  revision bigint not null default 0 check (revision >= 0)
);
insert into private.world_club_rooms(room_id) values ('ROOM_CLUBHOUSE_01');

-- Keep tombstones after leave, replacement, and expiry. Reusing an old topic is unsafe even
-- when Realtime cached its previous subscriber's authorization. Do not TTL-delete this ledger.
create table private.world_club_room_session_ids (
  session_id uuid primary key,
  room_id text not null references private.world_club_rooms(room_id),
  -- Deliberately no auth.users FK: deleted accounts must not make old inbox IDs reusable.
  user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (room_id, user_id, session_id)
);
-- Account-scoped admission bounds survive leave/expiry/session replacement. The descending
-- index bounds both latest-admission and rolling-window lookups without deleting tombstones.
create index world_club_room_session_ids_user_created_idx
  on private.world_club_room_session_ids(user_id, created_at desc);

create table private.world_club_room_sessions (
  room_id text not null references private.world_club_rooms(room_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null unique,
  lease_expires_at timestamptz not null,
  inbox_nonce uuid not null default gen_random_uuid(),
  seat_id text check (seat_id in ('chair_s0','chair_n0','chair_s1','chair_n1','chair_s2','chair_n2')),
  joined_at timestamptz not null default clock_timestamp(),
  equipment jsonb not null default '{}'::jsonb check (jsonb_typeof(equipment) = 'object' and octet_length(equipment::text) <= 4096),
  last_pose jsonb,
  last_client_pose_seq bigint not null default -1,
  pose_revision bigint not null default -1,
  last_pose_at timestamptz,
  last_action_at timestamptz,
  last_presence_at timestamptz,
  primary key (room_id, user_id),
  unique (room_id, seat_id),
  foreign key (room_id, user_id, session_id)
    references private.world_club_room_session_ids(room_id, user_id, session_id)
);
-- A room-wide monotonic revision lets clients discard responses that arrive out of order.
-- The trigger also covers cleanup and future trusted writers, rather than relying on each RPC.
create function private.world_club_room_revision_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.world_club_rooms set revision = revision + 1
    where room_id = case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  return null;
end;
$$;
create trigger world_club_room_revision after insert or update or delete on private.world_club_room_sessions
  for each row execute function private.world_club_room_revision_v1();

alter table private.world_club_rooms enable row level security;
alter table private.world_club_room_session_ids enable row level security;
alter table private.world_club_room_sessions enable row level security;
revoke all on private.world_club_rooms, private.world_club_room_session_ids,
  private.world_club_room_sessions from public, anon, authenticated, service_role;

-- Provider-owned EXECUTE grants are not the authority boundary: its invoker function may
-- swallow an RLS rejection and return normally. Never alter its permissions. Detect unsafe
-- definer semantics / disabled RLS / client BYPASSRLS on every admission and publication.
create function private.world_room_publisher_safe_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_proc where oid = to_regprocedure('realtime.send(jsonb,text,text,boolean)') and not prosecdef)
    and exists (select 1 from pg_catalog.pg_class where oid = to_regclass('realtime.messages') and relrowsecurity)
    and not exists (select 1 from pg_catalog.pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
$$;
revoke all on function private.world_room_publisher_safe_v1() from public, anon, authenticated, service_role;

create function private.world_club_room_access_v1(p_viewer uuid, p_room_id text)
returns text language sql stable security definer set search_path = '' as $$
  select case when private.world_room_publisher_safe_v1() and p_room_id = 'ROOM_CLUBHOUSE_01' and exists (
    select 1 from auth.users u join public.profiles p on p.user_id = u.id
    where u.id = p_viewer and u.is_anonymous = false and p.is_banned = false
      and not exists (
        select 1 from private.world_user_moderation_actions a
        where a.target_id = u.id and a.action = 'interaction_restriction_24h'
          and a.starts_at <= clock_timestamp() and a.ends_at > clock_timestamp()
      )
  ) then 'MEMBER' else 'DENIED' end
$$;

create function private.world_club_room_equipment_v1(p_raw jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_out jsonb := '{}'::jsonb; v_slot text; v_item jsonb;
begin
  if jsonb_typeof(p_raw) is distinct from 'object' then return v_out; end if;
  foreach v_slot in array array['BODY','FACE','HAIR','HEAD','TOP','BOTTOM','SHOES','BACK','ACCESSORY'] loop
    v_item := p_raw -> v_slot;
    if jsonb_typeof(v_item) = 'object'
      and jsonb_typeof(v_item -> 'itemId') = 'string'
      and (v_item ->> 'itemId') ~ '^[a-z][a-z0-9_]{0,39}\.[a-z0-9_]{1,40}$'
      and jsonb_typeof(v_item -> 'catalogStatus') = 'string'
      and (v_item ->> 'catalogStatus') in ('ACTIVE','COMING_SOON','LOCKED','DISABLED','HIDDEN','UNKNOWN_ITEM') then
      v_out := v_out || jsonb_build_object(v_slot, jsonb_build_object(
        'itemId', v_item ->> 'itemId', 'catalogStatus', v_item ->> 'catalogStatus'));
    end if;
  end loop;
  return v_out;
end;
$$;

create function private.world_club_room_presence_v1(p_session private.world_club_room_sessions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('v', 1, 'sessionId', (p_session).session_id, 'userId', (p_session).user_id,
    'displayName', case when btrim(p.nickname) ~ '^[가-힣A-Za-z0-9_ ]{2,12}$' then btrim(p.nickname) else '인덕이' end,
    'placeZoneId', (p_session).room_id,
    'joinedAt', floor(extract(epoch from (p_session).joined_at) * 1000)::bigint)
    || case when (p_session).equipment <> '{}'::jsonb then jsonb_build_object('equipment', (p_session).equipment) else '{}'::jsonb end
  from public.profiles p where p.user_id = (p_session).user_id
$$;

-- Call only while holding the room row FOR UPDATE. Expiry and authorization are checked again
-- on snapshots/fanout; cleanup is not the security boundary and needs no scheduled worker.
create function private.world_club_room_prune_v1(p_room text)
returns void language sql volatile security definer set search_path = '' as $$
  delete from private.world_club_room_sessions s where s.room_id = p_room
    and (s.lease_expires_at <= clock_timestamp()
      or private.world_club_room_access_v1(s.user_id, s.room_id) <> 'MEMBER')
$$;

create function private.world_club_room_result_v1(p_allowed boolean, p_reason text, p_room text, p_session uuid, p_viewer uuid)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('allowed', coalesce(p_allowed, false), 'reason', p_reason,
    'roomId', p_room, 'sessionId', p_session, 'userId', p_viewer,
    'capacity', 6, 'revision', 0, 'leaseMs', case when p_allowed then 20000 else 0 end, 'participants', '[]'::jsonb, 'seats', '[]'::jsonb, 'poses', '[]'::jsonb)
$$;

create function private.world_club_room_snapshot_v1(p_room text, p_session uuid, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_lease timestamptz; v_nonce uuid;
begin
  if private.world_club_room_access_v1(p_viewer, p_room) <> 'MEMBER' or not exists (
    select 1 from private.world_club_room_sessions s where s.room_id = p_room
      and s.user_id = p_viewer and s.session_id = p_session and s.lease_expires_at > clock_timestamp()
  ) then return private.world_club_room_result_v1(false, 'SESSION_REQUIRED', p_room, p_session, p_viewer); end if;
  select s.lease_expires_at, s.inbox_nonce into v_lease, v_nonce from private.world_club_room_sessions s
    where s.room_id = p_room and s.user_id = p_viewer and s.session_id = p_session;
  v_result := private.world_club_room_result_v1(true, 'OK', p_room, p_session, p_viewer)
    || jsonb_build_object('inboxNonce', v_nonce, 'revision', (select r.revision from private.world_club_rooms r where r.room_id = p_room),
      'leaseMs', greatest(0, floor(extract(epoch from (v_lease - clock_timestamp())) * 1000)::integer));
  return v_result || (
    select jsonb_build_object(
      'participants', coalesce(jsonb_agg(private.world_club_room_presence_v1(s) order by s.joined_at, s.session_id), '[]'::jsonb),
      'seats', coalesce(jsonb_agg(jsonb_build_object('seatId', s.seat_id, 'sessionId', s.session_id, 'userId', s.user_id)
        order by s.seat_id) filter (where s.seat_id is not null), '[]'::jsonb),
      'poses', coalesce(jsonb_agg(jsonb_build_object('sessionId', s.session_id, 'packet', s.last_pose)
        order by s.session_id) filter (where s.last_pose is not null), '[]'::jsonb))
    from private.world_club_room_sessions s where s.room_id = p_room
      and s.lease_expires_at > clock_timestamp()
      and private.world_club_room_access_v1(s.user_id, s.room_id) = 'MEMBER'
  );
end;
$$;

create function private.world_club_room_mutate_v1(p_operation text, p_room text, p_session uuid, p_seat text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_now timestamptz; v_current private.world_club_room_sessions;
  v_changed boolean := false; v_last_admission timestamptz; v_recent_admissions integer;
begin
  if p_room is distinct from 'ROOM_CLUBHOUSE_01' then
    return private.world_club_room_result_v1(false, 'INVALID_ROOM', p_room, p_session, v_uid);
  end if;
  if p_session is null then return private.world_club_room_result_v1(false, 'INVALID_SESSION', p_room, p_session, v_uid); end if;
  if v_uid is null or (auth.jwt() ->> 'is_anonymous') is distinct from 'false' then
    return private.world_club_room_result_v1(false, 'DENIED', p_room, p_session, v_uid);
  end if;
  -- The fixed row serializes capacity, user replacement, expiration and seat claims together.
  perform 1 from private.world_club_rooms r where r.room_id = p_room for update;
  if not found then return private.world_club_room_result_v1(false, 'INVALID_ROOM', p_room, p_session, v_uid); end if;
  perform private.world_club_room_prune_v1(p_room);
  v_now := clock_timestamp();
  if private.world_club_room_access_v1(v_uid, p_room) <> 'MEMBER' then
    return private.world_club_room_result_v1(false, 'DENIED', p_room, p_session, v_uid);
  end if;
  select s.* into v_current from private.world_club_room_sessions s where s.room_id = p_room and s.user_id = v_uid;
  if p_operation = 'join' then
    if v_current.session_id = p_session then
      update private.world_club_room_sessions set inbox_nonce = gen_random_uuid(), lease_expires_at = v_now + interval '20 seconds'
        where room_id = p_room and user_id = v_uid and session_id = p_session;
      return private.world_club_room_snapshot_v1(p_room, p_session, v_uid);
    end if;
    if exists (select 1 from private.world_club_room_session_ids where session_id = p_session) then
      return private.world_club_room_result_v1(false, 'SESSION_REUSED', p_room, p_session, v_uid);
    end if;
    -- A fresh UUID must not reset publish throttles repeatedly or grow durable tombstones at
    -- an unbounded per-account rate. The room lock serializes these checks with the insert.
    -- Same-live-UUID retries returned above, so they neither consume quota nor hit cooldown.
    select i.created_at into v_last_admission from private.world_club_room_session_ids i
      where i.user_id = v_uid order by i.created_at desc limit 1;
    if v_last_admission > v_now - interval '1 second' then
      return private.world_club_room_result_v1(false, 'JOIN_COOLDOWN', p_room, p_session, v_uid);
    end if;
    select count(*) into v_recent_admissions from (
      select 1 from private.world_club_room_session_ids i
      where i.user_id = v_uid and i.created_at > v_now - interval '1 hour' limit 60
    ) recent;
    if v_recent_admissions >= 60 then
      return private.world_club_room_result_v1(false, 'RATE_LIMITED', p_room, p_session, v_uid);
    end if;
    if v_current.session_id is null and (select count(*) from private.world_club_room_sessions where room_id = p_room) >= 6 then
      return private.world_club_room_result_v1(false, 'ROOM_FULL', p_room, p_session, v_uid);
    end if;
    delete from private.world_club_room_sessions where room_id = p_room and user_id = v_uid;
    insert into private.world_club_room_session_ids(session_id, room_id, user_id) values (p_session, p_room, v_uid);
    insert into private.world_club_room_sessions(room_id, user_id, session_id, lease_expires_at, joined_at)
      values (p_room, v_uid, p_session, v_now + interval '20 seconds', v_now);
    return private.world_club_room_snapshot_v1(p_room, p_session, v_uid);
  end if;
  if v_current.session_id is distinct from p_session then
    return private.world_club_room_result_v1(false,
      case when v_current.session_id is null then 'SESSION_EXPIRED' else 'SESSION_REPLACED' end, p_room, p_session, v_uid);
  end if;
  if p_operation = 'heartbeat' then
    update private.world_club_room_sessions set inbox_nonce = gen_random_uuid(), lease_expires_at = v_now + interval '20 seconds'
      where room_id = p_room and user_id = v_uid and session_id = p_session;
  elsif p_operation = 'leave' then
    delete from private.world_club_room_sessions where room_id = p_room and user_id = v_uid and session_id = p_session;
    return private.world_club_room_result_v1(true, 'LEFT', p_room, p_session, v_uid)
      || jsonb_build_object('revision', (select revision from private.world_club_rooms where room_id = p_room), 'leaseMs', 0);
  elsif p_operation in ('claim','release') then
    if p_seat is null or p_seat not in ('chair_s0','chair_n0','chair_s1','chair_n1','chair_s2','chair_n2') then
      return private.world_club_room_snapshot_v1(p_room, p_session, v_uid)
        || jsonb_build_object('claimed', false, 'released', false, 'reason', 'INVALID_SEAT');
    end if;
    if p_operation = 'claim' then
      if exists (select 1 from private.world_club_room_sessions s
        where s.room_id = p_room and s.seat_id = p_seat and s.session_id <> p_session) then
        return private.world_club_room_snapshot_v1(p_room, p_session, v_uid)
          || jsonb_build_object('claimed', false, 'reason', 'SEAT_TAKEN');
      end if;
      update private.world_club_room_sessions set seat_id = p_seat, pose_revision = pose_revision + 1,
        last_pose = jsonb_build_object('v', 1, 'seq', pose_revision + 1,
          'x', case right(p_seat, 1) when '0' then -0.7 when '1' then 0 else 0.7 end,
          'y', 1.30, 'z', case when p_seat like 'chair_s%' then -0.34 else 1.14 end,
          'yaw', case when p_seat like 'chair_s%' then 0 else 180 end, 'vx', 0, 'vz', 0, 'anim', 'sit')
        where room_id = p_room and user_id = v_uid and session_id = p_session;
      return private.world_club_room_snapshot_v1(p_room, p_session, v_uid) || jsonb_build_object('claimed', true);
    else
      update private.world_club_room_sessions set seat_id = null, pose_revision = pose_revision + 1,
        last_pose = jsonb_build_object('v', 1, 'seq', pose_revision + 1,
          'x', case right(p_seat, 1) when '0' then -0.7 when '1' then 0 else 0.7 end,
          'y', 1.15, 'z', case when p_seat like 'chair_s%' then -0.94 else 1.74 end,
          'yaw', case when p_seat like 'chair_s%' then 0 else 180 end, 'vx', 0, 'vz', 0, 'anim', 'idle')
        where room_id = p_room and user_id = v_uid and session_id = p_session and seat_id = p_seat;
      v_changed := found;
      return private.world_club_room_snapshot_v1(p_room, p_session, v_uid) || jsonb_build_object('released', v_changed);
    end if;
  else
    return private.world_club_room_result_v1(false, 'INVALID_OPERATION', p_room, p_session, v_uid);
  end if;
  return private.world_club_room_snapshot_v1(p_room, p_session, v_uid);
end;
$$;

create function public.join_world_club_room_v1(p_room text, p_session uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.world_club_room_mutate_v1('join', p_room, p_session)
$$;
create function public.heartbeat_world_club_room_v1(p_room text, p_session uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.world_club_room_mutate_v1('heartbeat', p_room, p_session)
$$;
create function public.leave_world_club_room_v1(p_room text, p_session uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.world_club_room_mutate_v1('leave', p_room, p_session)
$$;
create function public.claim_world_club_room_seat_v1(p_room text, p_session uuid, p_seat text)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.world_club_room_mutate_v1('claim', p_room, p_session, p_seat)
$$;
create function public.release_world_club_room_seat_v1(p_room text, p_session uuid, p_seat text)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.world_club_room_mutate_v1('release', p_room, p_session, p_seat)
$$;

-- Returns only the receiver-compatible allowlist. JSON numbers are finite decimal values;
-- strings such as NaN/Infinity and excessively large JSON numerics fail before any float cast.
create function private.world_club_room_pose_v1(p_packet jsonb, p_seat text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_key text; v_n numeric; v_yaw numeric; v_out jsonb; v_x numeric; v_z numeric;
begin
  if jsonb_typeof(p_packet) is distinct from 'object' or p_packet -> 'v' is distinct from '1'::jsonb
    or p_packet ? 'mount' or p_packet ->> 'anim' is null
    or p_packet ->> 'anim' not in ('idle','walk','run','air','sit') then return null; end if;
  foreach v_key in array array['seq','x','y','z','yaw','vx','vz'] loop
    if jsonb_typeof(p_packet -> v_key) is distinct from 'number' then return null; end if;
    v_n := (p_packet ->> v_key)::numeric;
    if (v_key = 'seq' and (v_n < 0 or v_n > 9007199254740991 or v_n <> trunc(v_n)))
      or (v_key = 'x' and abs(v_n) > 4.5)
      or (v_key = 'z' and abs(v_n) > 3.25)
      or (v_key = 'y' and (v_n < 0 or v_n > 3.2))
      or (v_key = 'yaw' and abs(v_n) > 100000)
      or (v_key in ('vx','vz') and abs(v_n) > 10) then return null; end if;
  end loop;
  v_yaw := mod(mod((p_packet ->> 'yaw')::numeric, 360) + 540, 360) - 180;
  if v_yaw = -180 then v_yaw := 180; end if;
  v_out := jsonb_build_object('v', 1, 'seq', (p_packet ->> 'seq')::bigint,
    'x', p_packet -> 'x', 'y', p_packet -> 'y', 'z', p_packet -> 'z', 'yaw', v_yaw,
    'vx', p_packet -> 'vx', 'vz', p_packet -> 'vz', 'anim', p_packet ->> 'anim');
  if p_packet ->> 'anim' = 'sit' and p_seat is null then return null; end if;
  if p_seat is not null then
    if p_seat not in ('chair_s0','chair_n0','chair_s1','chair_n1','chair_s2','chair_n2') then return null; end if;
    v_x := case right(p_seat, 1) when '0' then -0.7 when '1' then 0 else 0.7 end;
    v_z := case when p_seat like 'chair_s%' then -0.34 else 1.14 end;
    v_out := v_out || jsonb_build_object('x', v_x, 'y', 1.30, 'z', v_z,
      'yaw', case when p_seat like 'chair_s%' then 0 else 180 end, 'vx', 0, 'vz', 0, 'anim', 'sit');
  end if;
  return v_out;
end;
$$;

-- All current recipients are checked for every publication, not only at channel subscription.
-- This helper intentionally uses dynamic SQL so a stripped replay fixture without Realtime can
-- still compile. Its public caller explicitly rejects REALTIME_UNAVAILABLE before accepting a packet.
create function private.world_club_room_fanout_v1(p_room text, p_session uuid, p_event text, p_packet jsonb, p_presence jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_target record; v_count integer := 0; v_envelope jsonb;
begin
  v_envelope := jsonb_build_object('roomId', p_room, 'sid', p_session, 'p', p_packet, 'event', p_event, 'presence', p_presence);
  for v_target in select s.session_id, s.inbox_nonce from private.world_club_room_sessions s
    where s.room_id = p_room and s.session_id <> p_session and s.lease_expires_at > clock_timestamp()
      and private.world_club_room_access_v1(s.user_id, s.room_id) = 'MEMBER'
  loop
    execute 'select realtime.send($1, $2, $3, $4)'
      using v_envelope || jsonb_build_object('inboxNonce', v_target.inbox_nonce), 'club-packet'::text, 'world:club:' || p_room || ':' || v_target.session_id::text, true;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.publish_world_club_room_v1(p_room text, p_session uuid, p_event text, p_packet jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_now timestamptz; v_sender private.world_club_room_sessions;
  v_clean jsonb; v_presence jsonb; v_count integer; v_action_id numeric;
begin
  if p_room is distinct from 'ROOM_CLUBHOUSE_01' or p_session is null
    or v_uid is null or (auth.jwt() ->> 'is_anonymous') is distinct from 'false' then
    return jsonb_build_object('allowed', false, 'sent', false, 'reason', 'DENIED');
  end if;
  if not private.world_room_publisher_safe_v1() then
    return jsonb_build_object('allowed', false, 'sent', false, 'reason', 'REALTIME_UNAVAILABLE');
  end if;
  perform 1 from private.world_club_rooms r where r.room_id = p_room for update;
  if not found then return jsonb_build_object('allowed', false, 'sent', false, 'reason', 'DENIED'); end if;
  perform private.world_club_room_prune_v1(p_room);
  if private.world_club_room_access_v1(v_uid, p_room) <> 'MEMBER' then
    return jsonb_build_object('allowed', false, 'sent', false, 'reason', 'DENIED');
  end if;
  select s.* into v_sender from private.world_club_room_sessions s
    where s.room_id = p_room and s.user_id = v_uid and s.session_id = p_session and s.lease_expires_at > clock_timestamp();
  if not found then return jsonb_build_object('allowed', false, 'sent', false, 'reason', 'SESSION_REQUIRED'); end if;
  if p_packet is null or jsonb_typeof(p_packet) <> 'object' or octet_length(p_packet::text) > 4096
    or p_event is null or p_event not in ('pose','action','presence') then
    return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'INVALID_PACKET');
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return jsonb_build_object('allowed', false, 'sent', false, 'reason', 'REALTIME_UNAVAILABLE');
  end if;
  v_now := clock_timestamp();
  if p_event = 'pose' then
    v_clean := private.world_club_room_pose_v1(p_packet, v_sender.seat_id);
    if v_clean is null then return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'INVALID_PACKET'); end if;
    if (v_clean ->> 'seq')::bigint <= v_sender.last_client_pose_seq then
      return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'STALE_PACKET');
    end if;
    if v_sender.last_pose_at > v_now - interval '100 milliseconds' then
      return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'RATE_LIMITED');
    end if;
    -- Seat transitions and client movement share a server sequence without consuming client IDs.
    v_clean := v_clean || jsonb_build_object('seq', v_sender.pose_revision + 1);
    update private.world_club_room_sessions set last_pose = v_clean, last_pose_at = v_now,
      last_client_pose_seq = (p_packet ->> 'seq')::bigint, pose_revision = pose_revision + 1
      where session_id = p_session;
  elsif p_event = 'action' then
    if p_packet -> 'v' is distinct from '1'::jsonb or jsonb_typeof(p_packet -> 'id') is distinct from 'number'
      or jsonb_typeof(p_packet -> 'payload') is distinct from 'object'
      or p_packet ->> 'type' is null or p_packet ->> 'type' not in ('jump','emote') then
      return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'INVALID_PACKET');
    end if;
    -- protocol.encodeAction/validateAction use numeric safe integer IDs, not UUID/string IDs.
    -- Type validation above precedes this cast so malformed strings cannot raise a cast error.
    v_action_id := (p_packet ->> 'id')::numeric;
    if v_action_id < 0 or v_action_id > 9007199254740991 or v_action_id <> trunc(v_action_id) then
      return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'INVALID_PACKET');
    end if;
    if p_packet ->> 'type' = 'emote' then
      if p_packet #>> '{payload,emote}' is null or p_packet #>> '{payload,emote}' not in ('wave','clap','laugh','dance','photo_pose') then
        return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'INVALID_PACKET');
      end if;
      v_clean := jsonb_build_object('emote', p_packet #>> '{payload,emote}');
    else v_clean := '{}'::jsonb;
    end if;
    if v_sender.last_action_at > v_now - interval '500 milliseconds' then
      return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'RATE_LIMITED');
    end if;
    v_clean := jsonb_build_object('v', 1, 'id', v_action_id::bigint, 'type', p_packet ->> 'type', 'payload', v_clean);
    update private.world_club_room_sessions set last_action_at = v_now where session_id = p_session;
  else
    if v_sender.last_presence_at > v_now - interval '1 second' then
      return jsonb_build_object('allowed', true, 'sent', false, 'reason', 'RATE_LIMITED');
    end if;
    update private.world_club_room_sessions set equipment = private.world_club_room_equipment_v1(p_packet -> 'equipment'),
      last_presence_at = v_now where session_id = p_session returning * into v_sender;
  end if;
  v_presence := private.world_club_room_presence_v1(v_sender);
  if p_event = 'presence' then v_clean := v_presence; end if;
  v_count := private.world_club_room_fanout_v1(p_room, p_session, p_event, v_clean, v_presence);
  return jsonb_build_object('allowed', true, 'sent', true, 'reason', 'OK', 'recipients', v_count);
end;
$$;

create function public.can_access_world_club_room_realtime_v1(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_session uuid;
begin
  if v_uid is null or (auth.jwt() ->> 'is_anonymous') is distinct from 'false'
    or p_topic is null or p_topic !~ '^world:club:ROOM_CLUBHOUSE_01:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_session := split_part(p_topic, ':', 4)::uuid;
  return private.world_club_room_access_v1(v_uid, 'ROOM_CLUBHOUSE_01') = 'MEMBER' and exists (
    select 1 from private.world_club_room_sessions s where s.room_id = 'ROOM_CLUBHOUSE_01'
      and s.user_id = v_uid and s.session_id = v_session and s.lease_expires_at > clock_timestamp());
end;
$$;

-- Separate installer: never replace the campus/personal-room policy installer.
create function private.install_world_club_room_realtime_policies_v1()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  execute 'drop policy if exists "world club leased inbox read" on realtime.messages';
  execute $policy$create policy "world club leased inbox read" on realtime.messages for select to authenticated
    using (extension = 'broadcast' and realtime.messages.topic = (select realtime.topic())
      and public.can_access_world_club_room_realtime_v1((select realtime.topic())))$policy$;
  -- Restrictive guards keep an unrelated permissive policy from enabling club spoofing/reads.
  execute 'drop policy if exists "world club inbox read guard" on realtime.messages';
  execute $policy$create policy "world club inbox read guard" on realtime.messages as restrictive for select to anon, authenticated
    using ((coalesce((select realtime.topic()), '') !~ '^world:club:'
        and coalesce(realtime.messages.topic, '') !~ '^world:club:') or
      (extension = 'broadcast' and realtime.messages.topic = (select realtime.topic())
        and public.can_access_world_club_room_realtime_v1((select realtime.topic()))))$policy$;
  execute 'drop policy if exists "world club server writes only" on realtime.messages';
  execute $policy$create policy "world club server writes only" on realtime.messages as restrictive for insert to anon, authenticated
    with check (coalesce((select realtime.topic()), '') !~ '^world:club:'
      and coalesce(realtime.messages.topic, '') !~ '^world:club:')$policy$;
end;
$$;

revoke all on function private.world_club_room_revision_v1(),
  private.world_club_room_access_v1(uuid,text),
  private.world_club_room_equipment_v1(jsonb),
  private.world_club_room_presence_v1(private.world_club_room_sessions),
  private.world_club_room_prune_v1(text),
  private.world_club_room_result_v1(boolean,text,text,uuid,uuid),
  private.world_club_room_snapshot_v1(text,uuid,uuid),
  private.world_club_room_mutate_v1(text,text,uuid,text),
  private.world_club_room_pose_v1(jsonb,text),
  private.world_club_room_fanout_v1(text,uuid,text,jsonb,jsonb),
  private.install_world_club_room_realtime_policies_v1()
from public, anon, authenticated, service_role;
revoke all on function public.join_world_club_room_v1(text,uuid),
  public.heartbeat_world_club_room_v1(text,uuid), public.leave_world_club_room_v1(text,uuid),
  public.claim_world_club_room_seat_v1(text,uuid,text), public.release_world_club_room_seat_v1(text,uuid,text),
  public.publish_world_club_room_v1(text,uuid,text,jsonb), public.can_access_world_club_room_realtime_v1(text)
from public, anon, authenticated, service_role;
grant execute on function public.join_world_club_room_v1(text,uuid),
  public.heartbeat_world_club_room_v1(text,uuid), public.leave_world_club_room_v1(text,uuid),
  public.claim_world_club_room_seat_v1(text,uuid,text), public.release_world_club_room_seat_v1(text,uuid,text),
  public.publish_world_club_room_v1(text,uuid,text,jsonb), public.can_access_world_club_room_realtime_v1(text)
to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    perform private.install_world_club_room_realtime_policies_v1();
  else
    raise notice 'Realtime absent: club policies not installed. Run only this installer when Realtime is available.';
  end if;
end;
$$;
