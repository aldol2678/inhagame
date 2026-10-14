-- SEC-01 STAGE A · ISOLATED LAB CANDIDATE (R0). NOT A MIGRATION. NEVER APPLY TO PRODUCTION.
--
-- Applied only to a disposable local Supabase stack (supabase start) on top of main 0dcae7b +
-- PR #353 83cb427 migrations. Everything lives in schema sec01_lab and public.sec01_* RPCs so it
-- cannot be confused with a real migration. The SEC-01 v0.4 document itself was not available in
-- the repository; the contract below is reconstructed from the Stage A mission text and is labelled
-- as an assumption in the report.
--
-- Contract under test
--   * Approval record + immutable envelope + per-recipient delivery rows + realtime.messages rows are
--     written in ONE transaction (publish_mode 'insert' = direct INSERT, errors propagate).
--     publish_mode 'realtime_send' reproduces the PR #353 provider call for comparison (A3).
--   * requestId: client-generated UUIDv7 at submit time; server rejects ids whose embedded time is
--     outside [now-10min, now+30s]; identical (sender, requestId, body) within 10 minutes of approval
--     replays the stored envelope with no new rows; a different body is a conflict; lookup by
--     requestId is allowed for 30 minutes after approval.
--   * Lock order (all writers): request lock -> authority advisory (sorted user ids) -> pair advisory
--     (sorted keys, same key as private.world_lock_pair) -> session rows (sorted id) -> rate row.
--     Publishers take SHARED advisory locks; block/unblock (existing RPC) take the EXCLUSIVE pair lock.
--   * After every lock wait, authority is re-read with fresh statements and clock_timestamp().
--   * Fault-injection hooks are session GUCs (sec01.*) only readable by this lab code.

create schema if not exists sec01_lab;
revoke all on schema sec01_lab from public, anon, authenticated;

create table sec01_lab.config (
  singleton boolean primary key default true check (singleton),
  lease_ttl interval not null default interval '30 seconds',
  retry_window interval not null default interval '10 minutes',
  lookup_window interval not null default interval '30 minutes',
  publish_mode text not null default 'insert' check (publish_mode in ('insert', 'realtime_send')),
  recheck_clock text not null default 'clock' check (recheck_clock in ('clock', 'txn')),
  lock_mode text not null default 'shared' check (lock_mode in ('shared', 'none')),
  require_uuid_v7 boolean not null default true
);
insert into sec01_lab.config default values;

create table sec01_lab.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  client_session_id uuid not null,
  area_id text not null check (area_id ~ '^AREA_[A-Z0-9_]{1,60}$'),
  generation bigint not null default 1,
  inbox_id uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index sessions_area_idx on sec01_lab.sessions(area_id, lease_expires_at) where ended_at is null;
create unique index sessions_inbox_idx on sec01_lab.sessions(inbox_id);

create table sec01_lab.approvals (
  sender_id uuid not null,
  request_id uuid not null,
  body_sha256 bytea not null,
  envelope jsonb not null,
  session_id uuid not null,
  generation bigint not null,
  area_id text not null,
  approved_at timestamptz not null,
  recipient_count integer not null,
  primary key (sender_id, request_id)
);
create index approvals_age_idx on sec01_lab.approvals(approved_at);

create table sec01_lab.deliveries (
  sender_id uuid not null,
  request_id uuid not null,
  recipient_session_id uuid not null,
  recipient_user_id uuid not null,
  recipient_generation bigint not null,
  topic text not null,
  realtime_message_id uuid not null,
  primary key (sender_id, request_id, recipient_session_id),
  foreign key (sender_id, request_id) references sec01_lab.approvals(sender_id, request_id) on delete cascade
);

create table sec01_lab.rate (
  user_id uuid primary key,
  sent_at timestamptz[] not null default '{}'
);

alter table sec01_lab.config enable row level security;
alter table sec01_lab.sessions enable row level security;
alter table sec01_lab.approvals enable row level security;
alter table sec01_lab.deliveries enable row level security;
alter table sec01_lab.rate enable row level security;
revoke all on all tables in schema sec01_lab from public, anon, authenticated, service_role;

-- Envelope and delivery rows are immutable once written (only retention cleanup may delete).
create function sec01_lab.immutable_guard() returns trigger language plpgsql as $$
begin
  raise exception 'SEC01_IMMUTABLE_%', tg_table_name using errcode = '55000';
end;
$$;
create trigger approvals_immutable before update on sec01_lab.approvals
  for each row execute function sec01_lab.immutable_guard();
create trigger deliveries_immutable before update on sec01_lab.deliveries
  for each row execute function sec01_lab.immutable_guard();

-- ---------------------------------------------------------------------------------------------
-- Canonicalization (mirrors apps/world/src/network/protocol.js normalizeChatText).
create function sec01_lab.canon_text(p_text text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_text is null then return null; end if;
  v := normalize(p_text, NFC);
  v := regexp_replace(v, U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F\200B\200E\200F\202A-\202E\2060\2066-\2069\FEFF]', '', 'g');
  v := btrim(regexp_replace(v, U&'[\0009\000A\000D\00A0\2028\2029\3000 ]+', ' ', 'g'), ' ');
  return v;
end;
$$;

-- Coordinates: numeric round half away from zero to 2 places, negative zero -> 0, |v| <= 100000.
create function sec01_lab.canon_coord(p numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p is null or abs(p) > 100000 then null
              when round(p, 2) = 0 then 0::numeric(12,2)
              else round(p, 2)::numeric(12,2) end
$$;

create function sec01_lab.uuid_v7_ms(p uuid) returns bigint
language sql immutable set search_path = '' as $$
  select case when substr(p::text, 15, 1) = '7'
    then ('x' || lpad(replace(substr(p::text, 1, 13), '-', ''), 16, '0'))::bit(64)::bigint end
$$;

create function sec01_lab.now_for_recheck() returns timestamptz
language sql volatile set search_path = '' as $$
  select case (select recheck_clock from sec01_lab.config) when 'txn' then now() else clock_timestamp() end
$$;

create function sec01_lab.hook_sleep(p_name text) returns void
language plpgsql volatile set search_path = '' as $$
declare v double precision := nullif(current_setting('sec01.' || p_name, true), '')::double precision;
begin
  if v is not null and v > 0 then perform pg_sleep(v); end if;
end;
$$;

create function sec01_lab.authority_key(p_user uuid) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('world_user_authority:' || p_user::text, 0)
$$;
-- Identical to private.world_lock_pair's key so the EXISTING block/unblock RPCs conflict with it.
create function sec01_lab.pair_key(p_a uuid, p_b uuid) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('world_pair:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0)
$$;

-- Account-level authority at the given instant (fresh statement => fresh READ COMMITTED snapshot).
create function sec01_lab.account_ok(p_user uuid, p_at timestamptz) returns boolean
language sql volatile security definer set search_path = '' as $$
  select p_user is not null
    and exists (select 1 from auth.users u join public.profiles p on p.user_id = u.id
                where u.id = p_user and u.is_anonymous is not true and p.is_banned = false)
    and not exists (select 1 from private.world_user_moderation_actions a
                    where a.target_id = p_user and a.action = 'interaction_restriction_24h'
                      and a.starts_at <= p_at and a.ends_at > p_at)
$$;

create function sec01_lab.blocked_either(p_a uuid, p_b uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists (select 1 from public.world_user_blocks b
                 where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a))
$$;

create function sec01_lab.caller() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Session lifecycle. One campus chat lease per account; every join/move rotates generation+inbox.
create function public.sec01_join_campus_chat(p_area text, p_client_session uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := sec01_lab.caller(); v_s sec01_lab.sessions%rowtype; v_ttl interval;
begin
  if p_area is null or p_area !~ '^AREA_[A-Z0-9_]{1,60}$' or p_client_session is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid');
  end if;
  perform pg_advisory_xact_lock_shared(sec01_lab.authority_key(v_user));
  if not sec01_lab.account_ok(v_user, clock_timestamp()) then
    return jsonb_build_object('allowed', false, 'reason', 'denied');
  end if;
  select lease_ttl into v_ttl from sec01_lab.config;
  insert into sec01_lab.sessions as s (user_id, client_session_id, area_id, lease_expires_at)
    values (v_user, p_client_session, p_area, clock_timestamp() + v_ttl)
  on conflict (user_id) do update set
    client_session_id = excluded.client_session_id, area_id = excluded.area_id,
    generation = s.generation + 1, inbox_id = gen_random_uuid(),
    lease_expires_at = excluded.lease_expires_at, ended_at = null
  returning * into v_s;
  return jsonb_build_object('allowed', true, 'leaseId', v_s.id, 'generation', v_s.generation,
    'areaId', v_s.area_id, 'topic', 'world:campus-chat:' || v_s.inbox_id, 'ttlMs',
    (extract(epoch from v_ttl) * 1000)::bigint);
end;
$$;

create function public.sec01_renew_campus_chat(p_lease uuid, p_generation bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := sec01_lab.caller(); v_s sec01_lab.sessions%rowtype; v_ttl interval; v_now timestamptz;
begin
  perform pg_advisory_xact_lock_shared(sec01_lab.authority_key(v_user));
  select * into v_s from sec01_lab.sessions where id = p_lease and user_id = v_user for update;
  v_now := clock_timestamp();
  -- A renew never resurrects an ended/expired lease and never applies to another generation.
  if not found or v_s.ended_at is not null or v_s.lease_expires_at <= v_now
     or v_s.generation <> p_generation or not sec01_lab.account_ok(v_user, v_now) then
    return jsonb_build_object('allowed', false, 'reason', 'denied');
  end if;
  select lease_ttl into v_ttl from sec01_lab.config;
  update sec01_lab.sessions set lease_expires_at = v_now + v_ttl where id = p_lease returning * into v_s;
  return jsonb_build_object('allowed', true, 'leaseId', v_s.id, 'generation', v_s.generation,
    'leaseExpiresAt', v_s.lease_expires_at);
end;
$$;

create function public.sec01_move_campus_chat(p_lease uuid, p_generation bigint, p_area text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := sec01_lab.caller(); v_s sec01_lab.sessions%rowtype; v_ttl interval; v_now timestamptz;
begin
  if p_area is null or p_area !~ '^AREA_[A-Z0-9_]{1,60}$' then
    return jsonb_build_object('allowed', false, 'reason', 'invalid');
  end if;
  perform pg_advisory_xact_lock_shared(sec01_lab.authority_key(v_user));
  select * into v_s from sec01_lab.sessions where id = p_lease and user_id = v_user for update;
  v_now := clock_timestamp();
  if not found or v_s.ended_at is not null or v_s.lease_expires_at <= v_now
     or v_s.generation <> p_generation or not sec01_lab.account_ok(v_user, v_now) then
    return jsonb_build_object('allowed', false, 'reason', 'denied');
  end if;
  select lease_ttl into v_ttl from sec01_lab.config;
  update sec01_lab.sessions set area_id = p_area, generation = generation + 1, inbox_id = gen_random_uuid(),
    lease_expires_at = v_now + v_ttl where id = p_lease returning * into v_s;
  return jsonb_build_object('allowed', true, 'leaseId', v_s.id, 'generation', v_s.generation,
    'areaId', v_s.area_id, 'topic', 'world:campus-chat:' || v_s.inbox_id);
end;
$$;

create function public.sec01_leave_campus_chat(p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := sec01_lab.caller();
begin
  perform 1 from sec01_lab.sessions where id = p_lease and user_id = v_user for update;
  update sec01_lab.sessions set ended_at = clock_timestamp(), lease_expires_at = least(lease_expires_at, clock_timestamp())
    where id = p_lease and user_id = v_user and ended_at is null;
  return found;
end;
$$;

-- Realtime private-channel authorization for the per-recipient inbox.
create function public.sec01_can_receive(p_topic text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_inbox uuid;
begin
  if (select auth.uid()) is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true)
     or p_topic is null or p_topic !~ '^world:campus-chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_inbox := substring(p_topic from 19)::uuid;
  return exists (select 1 from sec01_lab.sessions s
                 where s.inbox_id = v_inbox and s.user_id = (select auth.uid())
                   and s.ended_at is null and s.lease_expires_at > clock_timestamp())
     and sec01_lab.account_ok((select auth.uid()), clock_timestamp());
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Approval + publication. Arguments carry no identity, name, recipient, topic or area.
create function public.sec01_send_campus_chat(
  p_lease uuid, p_generation bigint, p_request_id uuid, p_text text,
  p_x numeric, p_y numeric, p_z numeric)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := sec01_lab.caller();
  v_cfg sec01_lab.config%rowtype;
  v_text text; v_x numeric; v_y numeric; v_z numeric; v_hash bytea; v_ms bigint;
  v_existing sec01_lab.approvals%rowtype;
  v_sender sec01_lab.sessions%rowtype;
  v_candidates uuid[]; v_users uuid[]; v_key bigint; v_now timestamptz;
  v_sent timestamptz[]; v_name text; v_env jsonb; v_msg uuid; v_count integer := 0; v_rows integer;
  r record;
begin
  select * into v_cfg from sec01_lab.config;
  if p_request_id is null then return jsonb_build_object('ok', false, 'reason', 'request_id_invalid'); end if;
  if v_cfg.require_uuid_v7 then
    v_ms := sec01_lab.uuid_v7_ms(p_request_id);
    if v_ms is null then return jsonb_build_object('ok', false, 'reason', 'request_id_invalid'); end if;
  end if;
  -- Canonical body (text + rounded coordinates) is the idempotency fingerprint.
  if p_text is null or octet_length(p_text) > 2048 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  v_text := sec01_lab.canon_text(p_text);
  if v_text = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(v_text) > 120 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  v_x := sec01_lab.canon_coord(p_x); v_y := sec01_lab.canon_coord(p_y); v_z := sec01_lab.canon_coord(p_z);
  if v_x is null or v_y is null or v_z is null then return jsonb_build_object('ok', false, 'reason', 'malformed'); end if;
  v_hash := extensions.digest(convert_to(jsonb_build_array(v_text, v_x, v_y, v_z)::text, 'UTF8'), 'sha256');

  -- (0) request lock: serialises concurrent submissions of the same requestId by the same sender.
  perform pg_advisory_xact_lock(hashtextextended('sec01_request:' || v_user::text || ':' || p_request_id::text, 0));
  select * into v_existing from sec01_lab.approvals where sender_id = v_user and request_id = p_request_id;
  if found then
    if v_existing.body_sha256 <> v_hash then
      return jsonb_build_object('ok', false, 'reason', 'request_conflict');
    end if;
    if v_existing.approved_at + v_cfg.retry_window <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'reason', 'retry_expired');
    end if;
    -- Replay: the original immutable envelope, no new approval/delivery/realtime rows.
    return jsonb_build_object('ok', true, 'replayed', true, 'envelope', v_existing.envelope);
  end if;
  if v_cfg.require_uuid_v7 and (v_ms < (extract(epoch from clock_timestamp() - v_cfg.retry_window) * 1000)::bigint
      or v_ms > (extract(epoch from clock_timestamp() + interval '30 seconds') * 1000)::bigint) then
    return jsonb_build_object('ok', false, 'reason', 'request_expired');
  end if;

  -- Unlocked discovery of the sender session and candidate recipients.
  select * into v_sender from sec01_lab.sessions where id = p_lease and user_id = v_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  select coalesce(array_agg(s.id order by s.id), '{}') into v_candidates from sec01_lab.sessions s
    where s.area_id = v_sender.area_id and s.ended_at is null and s.id <> v_sender.id;
  select coalesce(array_agg(distinct u order by u), '{}') into v_users from (
    select v_user as u union all select s.user_id from sec01_lab.sessions s where s.id = any(v_candidates)) q;

  perform sec01_lab.hook_sleep('pause_before_locks');

  if v_cfg.lock_mode = 'shared' then
    -- (1) authority locks, ascending user id.
    for r in select unnest(v_users) as u order by 1 loop
      perform pg_advisory_xact_lock_shared(sec01_lab.authority_key(r.u));
    end loop;
    -- (2) pair locks (same key as existing block/unblock RPCs), ascending key.
    for v_key in select sec01_lab.pair_key(v_user, u) from unnest(v_users) u where u <> v_user order by 1 loop
      perform pg_advisory_xact_lock_shared(v_key);
    end loop;
  end if;
  -- (3) session rows, ascending id (sender included).
  perform 1 from sec01_lab.sessions s where s.id = any(v_candidates || v_sender.id) order by s.id for share;
  -- (4) sender rate row.
  insert into sec01_lab.rate(user_id) values (v_user) on conflict (user_id) do nothing;
  perform 1 from sec01_lab.rate where user_id = v_user for update;

  perform sec01_lab.hook_sleep('pause_after_locks');

  -- Re-read everything after the lock waits with the real current time.
  v_now := sec01_lab.now_for_recheck();
  select * into v_sender from sec01_lab.sessions where id = p_lease and user_id = v_user;
  if not found or v_sender.ended_at is not null or v_sender.lease_expires_at <= v_now
     or v_sender.generation <> p_generation or not sec01_lab.account_ok(v_user, v_now) then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;
  select coalesce(array_agg(t), '{}') into v_sent from unnest((select sent_at from sec01_lab.rate where user_id = v_user)) t
    where t > v_now - interval '5 seconds';
  if cardinality(v_sent) >= 3 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;
  update sec01_lab.rate set sent_at = array_append(v_sent, v_now) where user_id = v_user;

  select left(coalesce(nullif(btrim(p.nickname), ''), '플레이어'), 40) into v_name from public.profiles p where p.user_id = v_user;
  v_env := jsonb_build_object('v', 1, 'kind', 'campus_chat', 'requestId', p_request_id, 'messageId', gen_random_uuid(),
    'senderUserId', v_user, 'senderLeaseId', v_sender.id, 'senderClientSessionId', v_sender.client_session_id,
    'senderName', v_name, 'areaId', v_sender.area_id, 'generation', v_sender.generation,
    'text', v_text, 'pos', jsonb_build_object('x', v_x, 'y', v_y, 'z', v_z),
    'approvedAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  -- Eligible recipients, decided once under the locks with the same v_now.
  select coalesce(array_agg(s.id order by s.id), '{}') into v_candidates from sec01_lab.sessions s
    where s.id = any(v_candidates) and s.area_id = v_sender.area_id and s.ended_at is null
      and s.lease_expires_at > v_now and sec01_lab.account_ok(s.user_id, v_now)
      and not sec01_lab.blocked_either(v_user, s.user_id);
  insert into sec01_lab.approvals(sender_id, request_id, body_sha256, envelope, session_id, generation, area_id, approved_at, recipient_count)
    values (v_user, p_request_id, v_hash, v_env, v_sender.id, v_sender.generation, v_sender.area_id, v_now, cardinality(v_candidates));

  for r in select s.* from sec01_lab.sessions s where s.id = any(v_candidates) order by s.id loop
    v_msg := gen_random_uuid();
    if v_cfg.publish_mode = 'insert' then
      insert into realtime.messages(id, topic, extension, payload, event, private)
        values (v_msg, 'world:campus-chat:' || r.inbox_id, 'broadcast',
                jsonb_build_object('envelope', v_env, 'recipientGeneration', r.generation), 'campus_chat_v1', true);
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then raise exception 'SEC01_PUBLISH_ROW_MISSING' using errcode = '55000'; end if;
    else
      perform realtime.send(jsonb_build_object('envelope', v_env, 'recipientGeneration', r.generation, 'id', v_msg),
                            'campus_chat_v1', 'world:campus-chat:' || r.inbox_id, true);
    end if;
    insert into sec01_lab.deliveries(sender_id, request_id, recipient_session_id, recipient_user_id, recipient_generation, topic, realtime_message_id)
      values (v_user, p_request_id, r.id, r.user_id, r.generation, 'world:campus-chat:' || r.inbox_id, v_msg);
    v_count := v_count + 1;
  end loop;

  perform sec01_lab.hook_sleep('pause_before_commit');
  if coalesce(current_setting('sec01.fail_before_commit', true), '') = 'on' then
    raise exception 'SEC01_INJECTED_FAILURE_BEFORE_COMMIT' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'envelope', v_env, 'recipientCount', v_count);
end;
$$;

create function public.sec01_get_campus_chat_receipt(p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := sec01_lab.caller(); v_a sec01_lab.approvals%rowtype;
begin
  select * into v_a from sec01_lab.approvals where sender_id = v_user and request_id = p_request_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_a.approved_at + (select lookup_window from sec01_lab.config) <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'lookup_expired');
  end if;
  return jsonb_build_object('ok', true, 'envelope', v_a.envelope);
end;
$$;

create function sec01_lab.cleanup() returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from sec01_lab.approvals where approved_at <= clock_timestamp() - (select lookup_window from sec01_lab.config);
  delete from sec01_lab.sessions where lease_expires_at <= clock_timestamp() - interval '1 minute';
end;
$$;

-- LAB-ONLY wrapper demonstrating the lock contract the EXISTING moderation RPC lacks: take the
-- target's authority lock exclusively, then run the unmodified admin RPC in the same transaction.
create function public.sec01_lab_admin_review_locked(p_report_id bigint, p_action text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_target uuid;
begin
  select target_id into v_target from public.world_user_reports where id = p_report_id;
  if v_target is not null then perform pg_advisory_xact_lock(sec01_lab.authority_key(v_target)); end if;
  return public.admin_review_world_user_report_v1(p_report_id, p_action);
end;
$$;

revoke all on all functions in schema sec01_lab from public, anon, authenticated, service_role;
revoke all on function public.sec01_join_campus_chat(text, uuid), public.sec01_renew_campus_chat(uuid, bigint),
  public.sec01_move_campus_chat(uuid, bigint, text), public.sec01_leave_campus_chat(uuid), public.sec01_can_receive(text),
  public.sec01_send_campus_chat(uuid, bigint, uuid, text, numeric, numeric, numeric),
  public.sec01_get_campus_chat_receipt(uuid), public.sec01_lab_admin_review_locked(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sec01_join_campus_chat(text, uuid), public.sec01_renew_campus_chat(uuid, bigint),
  public.sec01_move_campus_chat(uuid, bigint, text), public.sec01_leave_campus_chat(uuid), public.sec01_can_receive(text),
  public.sec01_send_campus_chat(uuid, bigint, uuid, text, numeric, numeric, numeric),
  public.sec01_get_campus_chat_receipt(uuid), public.sec01_lab_admin_review_locked(bigint, text)
  to authenticated;

create policy "sec01 lab campus inbox read" on realtime.messages for select to authenticated
  using (extension = 'broadcast' and topic = (select realtime.topic()) and public.sec01_can_receive((select realtime.topic())));
create policy "sec01 lab campus inbox read guard" on realtime.messages as restrictive for select to anon, authenticated
  using ((coalesce(topic, '') !~ '^world:campus-chat:' and coalesce((select realtime.topic()), '') !~ '^world:campus-chat:')
         or (topic = (select realtime.topic()) and public.sec01_can_receive((select realtime.topic()))));
create policy "sec01 lab campus inbox server writes only" on realtime.messages as restrictive for insert to anon, authenticated
  with check (coalesce(topic, '') !~ '^world:campus-chat:' and coalesce((select realtime.topic()), '') !~ '^world:campus-chat:');
