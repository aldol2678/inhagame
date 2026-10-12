-- CANDIDATE ONLY. Explicit activation and real two-client RLS verification are required.
-- App history: memory only. Provider DB Broadcast temporarily retains realtime.messages (3 days
-- per Supabase); this is NOT zero-retention or end-to-end encrypted chat.
-- One server-owned inbox per active account, no client broadcast grants, no message-body table.
create table private.world_room_chat_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.world_room_chat_config(singleton, enabled) values (true, false);
create table private.world_room_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  kind text not null check (kind in ('personal', 'club')),
  room_id text not null,
  session_id uuid not null,
  club_admission_id uuid references private.world_club_room_sessions(admission_id) on delete cascade,
  lease_expires_at timestamptz not null,
  inbox_nonce uuid not null default gen_random_uuid(),
  check ((kind = 'personal' and club_admission_id is null and room_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (kind = 'club' and club_admission_id is not null and room_id = 'ROOM_CLUBHOUSE_01'))
);
create index world_room_chat_room_idx on private.world_room_chat_sessions(kind, room_id, lease_expires_at);
-- Rate timestamps contain no message content. Account-level row survives rejoin to prevent bypass; minute cleanup drops it after 5 seconds.
create table private.world_room_chat_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sent_at timestamptz[] not null default '{}'
);
alter table private.world_room_chat_config enable row level security;
alter table private.world_room_chat_sessions enable row level security;
alter table private.world_room_chat_limits enable row level security;
revoke all on private.world_room_chat_config, private.world_room_chat_sessions, private.world_room_chat_limits from public, anon, authenticated, service_role;

-- Pin the reviewed H3 authority, not merely a same-named older D2 helper. These body
-- fingerprints are drift checks (not secrets/cryptographic authentication). Legitimate future
-- helper edits also close personal chat until their changed authority is explicitly reviewed.
-- Do not modify existing helpers or install H3 as a side effect of this candidate.
create function private.world_room_chat_personal_authority_ready_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select to_regclass('private.world_room_knocks') is not null
    and to_regclass('private.world_room_owner_presence') is not null
    and exists (select 1 from pg_catalog.pg_proc where oid = to_regprocedure('private.world_room_access_v1(uuid,uuid)')
      and prosecdef and 'search_path=""' = any(proconfig)
      and md5(prosrc) = 'e0d984bca82cb04600ca40549a94dcbf')
    and exists (select 1 from pg_catalog.pg_proc where oid = to_regprocedure('private.world_room_owner_present_v1(uuid)')
      and prosecdef and 'search_path=""' = any(proconfig)
      and md5(prosrc) = 'e39e01c5fb532cb60a9beb5ecf39d867')
$$;
revoke all on function private.world_room_chat_personal_authority_ready_v1() from public, anon, authenticated, service_role;

create or replace function private.world_room_chat_access_v1(p_user uuid, p_kind text, p_room text, p_session uuid, p_admission uuid default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.world_room_publisher_safe_v1() or not private.world_room_cleanup_healthy_v1() or p_user is null or p_session is null or not exists (
    select 1 from private.world_room_chat_config where singleton and enabled
  ) then return false; end if;
  if exists (select 1 from private.world_user_moderation_actions a
    where a.target_id = p_user and a.action = 'interaction_restriction_24h'
      and a.starts_at <= clock_timestamp() and a.ends_at > clock_timestamp()) then return false; end if;
  if p_kind = 'personal' and p_admission is null and p_room ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if not private.world_room_chat_personal_authority_ready_v1() then return false; end if;
    return private.world_room_access_v1(p_user, p_room::uuid) in ('OWNER', 'VISITOR');
  end if;
  if p_kind = 'club' and p_room = 'ROOM_CLUBHOUSE_01' then
    -- Club admission, capacity and the server-owned membership lease are independent of housing.
    return private.world_club_room_access_v1(p_user, p_room) = 'MEMBER' and exists (
      select 1 from private.world_club_room_sessions s where s.user_id = p_user
        and s.room_id = p_room and s.session_id = p_session and s.admission_id = p_admission and s.lease_expires_at > clock_timestamp()
    );
  end if;
  return false;
end;
$$;

create or replace function private.world_room_chat_lease_json_v1(p_session private.world_room_chat_sessions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', 1, 'allowed', true, 'leaseId', p_session.id,
    'kind', p_session.kind, 'roomId', p_session.room_id, 'userId', p_session.user_id,
    'sessionId', p_session.session_id, 'admissionId', p_session.club_admission_id, 'inboxNonce', p_session.inbox_nonce, 'topic', 'world:room-chat:' || p_session.id::text, 'ttlMs', 30000);
$$;

create or replace function public.can_receive_world_room_chat_v1(p_topic text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_session private.world_room_chat_sessions%rowtype;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true)
    or p_topic is null or p_topic !~ '^world:room-chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
  select * into v_session from private.world_room_chat_sessions s
    where s.id = substring(p_topic from 17)::uuid and s.user_id = auth.uid()
      and s.lease_expires_at > clock_timestamp();
  return found and private.world_room_chat_access_v1(v_session.user_id, v_session.kind, v_session.room_id, v_session.session_id, v_session.club_admission_id);
end;
$$;

create or replace function public.join_world_room_chat_v1(p_kind text, p_room text, p_session uuid, p_admission uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := private.world_room_caller_v1(); v_session private.world_room_chat_sessions%rowtype;
begin
  if p_kind = 'club' then
    perform 1 from private.world_club_rooms where room_id = p_room for update;
  end if;
  if not private.world_room_chat_access_v1(v_user, p_kind, p_room, p_session, p_admission)
    then return jsonb_build_object('allowed', false, 'reason', 'DENIED'); end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null or not exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'world room chat receive own inbox'
  ) then return jsonb_build_object('allowed', false, 'reason', 'UNAVAILABLE'); end if;
  perform pg_advisory_xact_lock(hashtextextended('world-room-chat:' || v_user::text, 0));
  -- Recheck after lock waits; the account/admission may have changed or expired meanwhile.
  if not private.world_room_chat_access_v1(v_user, p_kind, p_room, p_session, p_admission)
    then return jsonb_build_object('allowed', false, 'reason', 'DENIED'); end if;
  delete from private.world_room_chat_sessions where user_id = v_user;
  insert into private.world_room_chat_sessions(user_id, kind, room_id, session_id, club_admission_id, lease_expires_at)
    values (v_user, p_kind, p_room, p_session, p_admission, clock_timestamp() + interval '30 seconds') returning * into v_session;
  return private.world_room_chat_lease_json_v1(v_session);
end;
$$;

create or replace function public.renew_world_room_chat_v1(p_lease uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := private.world_room_caller_v1(); v_session private.world_room_chat_sessions%rowtype;
begin
  select * into v_session from private.world_room_chat_sessions s where s.id = p_lease and s.user_id = v_user;
  if v_session.kind = 'club' then
    perform 1 from private.world_club_rooms where room_id = v_session.room_id for update;
  end if;
  select * into v_session from private.world_room_chat_sessions s where s.id = p_lease and s.user_id = v_user for update;
  if not found or v_session.lease_expires_at <= clock_timestamp() or not
    private.world_room_chat_access_v1(v_user, v_session.kind, v_session.room_id, v_session.session_id, v_session.club_admission_id)
    then return jsonb_build_object('allowed', false, 'reason', 'DENIED'); end if;
  update private.world_room_chat_sessions set inbox_nonce = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '30 seconds' where id = p_lease
    returning * into v_session;
  return private.world_room_chat_lease_json_v1(v_session);
end;
$$;

create or replace function public.leave_world_room_chat_v1(p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from private.world_room_chat_sessions where id = p_lease and user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.send_world_room_chat_v1(p_lease uuid, p_text text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := private.world_room_caller_v1(); v_session private.world_room_chat_sessions%rowtype;
  v_target private.world_room_chat_sessions%rowtype; v_sent timestamptz[]; v_message jsonb; v_name text;
  v_now timestamptz := clock_timestamp(); v_normal text;
begin
  -- Authentication supplies every identity. No name, sender ID, room, recipient or topic argument.
  select * into v_session from private.world_room_chat_sessions s where s.id = p_lease and s.user_id = v_user;
  if v_session.kind = 'club' then
    perform 1 from private.world_club_rooms where room_id = v_session.room_id for update;
  end if;
  select * into v_session from private.world_room_chat_sessions s where s.id = p_lease and s.user_id = v_user for update;
  -- Lock waits must never preserve the function-entry clock for lease/rate authority.
  v_now := clock_timestamp();
  if not found or v_session.lease_expires_at <= v_now or not
    private.world_room_chat_access_v1(v_user, v_session.kind, v_session.room_id, v_session.session_id, v_session.club_admission_id)
    then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  if p_text is null or octet_length(p_text) > 2048 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  -- Match client NFC/controls/whitespace, reject noncanonical input rather than silently changing it.
  v_normal := normalize(p_text, NFC);
  v_normal := regexp_replace(v_normal, U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F\200B\200E\200F\202A-\202E\2060\2066-\2069\FEFF]', '', 'g');
  v_normal := btrim(regexp_replace(v_normal, U&'[\0009\000A\000D\00A0\2028\2029\3000 ]+', ' ', 'g'));
  if v_normal = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(v_normal) > 120 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  if v_normal <> p_text then return jsonb_build_object('ok', false, 'reason', 'malformed'); end if;
  insert into private.world_room_chat_limits(user_id) values (v_user) on conflict (user_id) do nothing;
  perform 1 from private.world_room_chat_limits where user_id = v_user for update;
  v_now := clock_timestamp();
  if v_session.lease_expires_at <= v_now or not
    private.world_room_chat_access_v1(v_user, v_session.kind, v_session.room_id, v_session.session_id, v_session.club_admission_id)
    then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  select coalesce(array_agg(t), '{}'::timestamptz[]) into v_sent from unnest((
    select sent_at from private.world_room_chat_limits where user_id = v_user
  )) as t where t > v_now - interval '5 seconds';
  if cardinality(v_sent) >= 3 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;
  update private.world_room_chat_limits set sent_at = array_append(v_sent, v_now) where user_id = v_user;
  select left(coalesce(nullif(btrim(p.nickname), ''), '플레이어'), 40) into v_name from public.profiles p where p.user_id = v_user;
  v_message := jsonb_build_object('v', 1, 'id', gen_random_uuid(), 'kind', v_session.kind, 'roomId', v_session.room_id,
    'userId', v_user, 'sessionId', v_session.session_id, 'name', v_name, 'text', p_text);
  for v_target in select * from private.world_room_chat_sessions s
    where s.kind = v_session.kind and s.room_id = v_session.room_id and s.id <> v_session.id
      and s.lease_expires_at > clock_timestamp()
  loop
    -- Recheck EACH recipient on EACH send: cached Realtime authorization cannot retain room access.
    if private.world_room_chat_access_v1(v_target.user_id, v_target.kind, v_target.room_id, v_target.session_id, v_target.club_admission_id)
      and not exists (select 1 from public.world_user_blocks b where
        (b.blocker_id = v_user and b.blocked_id = v_target.user_id) or
        (b.blocker_id = v_target.user_id and b.blocked_id = v_user)) then
      perform realtime.send(v_message || jsonb_build_object('inboxNonce', v_target.inbox_nonce), 'room_chat_v1', 'world:room-chat:' || v_target.id::text, true);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'message', v_message);
end;
$$;

revoke all on function private.world_room_chat_access_v1(uuid,text,text,uuid,uuid),
  private.world_room_chat_lease_json_v1(private.world_room_chat_sessions) from public, anon, authenticated, service_role;
revoke all on function public.can_receive_world_room_chat_v1(text), public.join_world_room_chat_v1(text,text,uuid,uuid),
  public.renew_world_room_chat_v1(uuid), public.leave_world_room_chat_v1(uuid), public.send_world_room_chat_v1(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.can_receive_world_room_chat_v1(text), public.join_world_room_chat_v1(text,text,uuid,uuid),
  public.renew_world_room_chat_v1(uuid), public.leave_world_room_chat_v1(uuid), public.send_world_room_chat_v1(uuid,text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'create policy "world room chat receive own inbox" on realtime.messages for select to authenticated
      using (extension = ''broadcast'' and topic = (select realtime.topic()) and public.can_receive_world_room_chat_v1((select realtime.topic())))';
    -- Restrictive guards survive unrelated broad permissive policies. This namespace is server-only.
    execute 'create policy "world room chat restrict inbox reads" on realtime.messages as restrictive for select to anon, authenticated
      using ((topic !~ ''^world:room-chat:'' and coalesce((select realtime.topic()), '''') !~ ''^world:room-chat:'') or
        (topic = (select realtime.topic()) and public.can_receive_world_room_chat_v1((select realtime.topic()))))';
    execute 'create policy "world room chat prohibit client writes" on realtime.messages as restrictive for insert to anon, authenticated
      with check (topic !~ ''^world:room-chat:'' and coalesce((select realtime.topic()), '''') !~ ''^world:room-chat:'')';
  end if;
end;
$$;

-- Healthy once/minute scheduler bounds retained metadata: admission timestamps <= 61 minutes,
-- expired club/chat leases <= expiry + 1 minute, chat rate timestamps <= 65 seconds. Scheduler
-- outage can retain rows until recovery; cleanup health closes admission and publication.
create or replace function private.world_room_cleanup_v1()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform 1 from private.world_club_rooms where room_id = 'ROOM_CLUBHOUSE_01' for update;
  delete from private.world_club_room_sessions where lease_expires_at <= clock_timestamp();
  delete from private.world_room_chat_sessions where lease_expires_at <= clock_timestamp();
  delete from private.world_club_room_admission_limits where created_at <= clock_timestamp() - interval '1 hour';
  delete from private.world_room_chat_limits l where not exists (
    select 1 from unnest(l.sent_at) t where t > clock_timestamp() - interval '5 seconds');
  update private.world_room_cleanup_state set last_succeeded_at = clock_timestamp() where singleton;
end;
$$;
revoke all on function private.world_room_cleanup_v1() from public, anon, authenticated, service_role;
