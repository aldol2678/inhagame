-- Public forward migration: ported from the private Activity authority migration (Production lineage
-- version 20261002120404). Versions are not shared across the two lineages.
-- INHA WORLD P0 Activity / Outcome Authority.
--
-- Persistent T1 attempt identity + terminal outcome only.
-- Does NOT own activity gameplay resolution, Quest/Event progress, Reward, Inventory, Collection or Life Skill.
-- Start/finalize are service-role only. Player-facing read/resume RPCs are deferred to the thin client phase.

create table if not exists private.world_activity_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null
    check (activity_id ~ '^activity\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(activity_id) <= 120),
  source_ref text not null
    check (source_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
      and char_length(source_ref) <= 160),
  client_attempt_key uuid not null,
  status text not null
    check (status in ('CREATED','ACTIVE','SUCCEEDED','FAILED','CANCELLED','EXPIRED')),
  outcome_type text
    check (outcome_type is null or outcome_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  result_ref text
    check (result_ref is null or result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  definition_version integer not null check (definition_version >= 1),
  resolver_version integer not null check (resolver_version >= 1),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  finalized_at timestamptz,
  expires_at timestamptz,
  constraint world_activity_attempts_client_key unique (user_id, client_attempt_key),
  constraint world_activity_attempts_expiry check (expires_at is null or expires_at > created_at),
  constraint world_activity_attempts_state_shape check (
    (status = 'CREATED'
      and activated_at is null and finalized_at is null
      and outcome_type is null and result_ref is null)
    or
    (status = 'ACTIVE'
      and activated_at is not null and finalized_at is null
      and outcome_type is null and result_ref is null)
    or
    (status = 'SUCCEEDED'
      and activated_at is not null and finalized_at is not null
      and outcome_type is not null and result_ref is not null)
    or
    (status in ('FAILED','CANCELLED','EXPIRED')
      and activated_at is not null and finalized_at is not null
      and outcome_type is not null and result_ref is null)
  )
);
comment on table private.world_activity_attempts is
  'P0 T1 Activity attempt authority. Terminal outcome is immutable; settlement belongs to other domains.';

create unique index if not exists world_activity_attempts_one_active_source
  on private.world_activity_attempts(user_id, activity_id, source_ref)
  where status in ('CREATED','ACTIVE');
create index if not exists world_activity_attempts_user_created_idx
  on private.world_activity_attempts(user_id, created_at desc);

alter table private.world_activity_attempts enable row level security;
revoke all on table private.world_activity_attempts from public, anon, authenticated, service_role;

create or replace function private.world_activity_attempt_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    raise exception 'ACTIVITY_TERMINAL_IMMUTABLE' using errcode = '42501';
  end if;

  if (new.attempt_id, new.user_id, new.activity_id, new.source_ref, new.client_attempt_key,
      new.definition_version, new.resolver_version, new.created_at, new.expires_at)
     is distinct from
     (old.attempt_id, old.user_id, old.activity_id, old.source_ref, old.client_attempt_key,
      old.definition_version, old.resolver_version, old.created_at, old.expires_at) then
    raise exception 'ACTIVITY_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;

  if old.status = 'CREATED' and new.status = 'ACTIVE' then
    if new.activated_at is null or new.finalized_at is not null
       or new.outcome_type is not null or new.result_ref is not null then
      raise exception 'ACTIVITY_TRANSITION_INVALID' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'ACTIVE' and new.status in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    return new;
  end if;

  raise exception 'ACTIVITY_TRANSITION_INVALID' using errcode = '23514';
end;
$$;
revoke all on function private.world_activity_attempt_guard_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_activity_attempt_guard on private.world_activity_attempts;
create trigger world_activity_attempt_guard
  before update on private.world_activity_attempts
  for each row execute function private.world_activity_attempt_guard_v1();

create or replace function private.world_activity_account_ok_v1(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.id = p_user
       and u.is_anonymous is not true
       and p.is_banned = false
  );
$$;
revoke all on function private.world_activity_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_activity_attempt_json_v1(p_attempt private.world_activity_attempts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId', p_attempt.attempt_id,
    'userId', p_attempt.user_id,
    'activityId', p_attempt.activity_id,
    'sourceRef', p_attempt.source_ref,
    'clientAttemptKey', p_attempt.client_attempt_key,
    'status', p_attempt.status,
    'outcomeType', p_attempt.outcome_type,
    'resultRef', p_attempt.result_ref,
    'definitionVersion', p_attempt.definition_version,
    'resolverVersion', p_attempt.resolver_version,
    'createdAt', p_attempt.created_at,
    'activatedAt', p_attempt.activated_at,
    'finalizedAt', p_attempt.finalized_at,
    'expiresAt', p_attempt.expires_at
  );
$$;
revoke all on function private.world_activity_attempt_json_v1(private.world_activity_attempts)
  from public, anon, authenticated, service_role;

create or replace function private.world_activity_validate_identity_v1(
  p_activity_id text,
  p_source_ref text,
  p_definition_version integer,
  p_resolver_version integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_activity_id is null
     or p_activity_id !~ '^activity\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
     or char_length(p_activity_id) > 120 then
    raise exception 'INVALID_ACTIVITY_ID' using errcode = '22023';
  end if;
  if p_source_ref is null
     or p_source_ref !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
     or char_length(p_source_ref) > 160 then
    raise exception 'INVALID_SOURCE_REF' using errcode = '22023';
  end if;
  if p_definition_version is null or p_definition_version < 1
     or p_resolver_version is null or p_resolver_version < 1 then
    raise exception 'INVALID_RULE_VERSION' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.world_activity_validate_identity_v1(text,text,integer,integer)
  from public, anon, authenticated, service_role;

create or replace function private.world_activity_start_v1(
  p_user uuid,
  p_activity_id text,
  p_source_ref text,
  p_client_attempt_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_expires_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.world_activity_attempts%rowtype;
begin
  perform private.world_activity_validate_identity_v1(
    p_activity_id, p_source_ref, p_definition_version, p_resolver_version);

  if p_client_attempt_key is null then
    raise exception 'INVALID_CLIENT_ATTEMPT_KEY' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'INVALID_EXPIRY' using errcode = '22023';
  end if;
  if not private.world_activity_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text, 0));

  select * into v_attempt
    from private.world_activity_attempts a
   where a.user_id = p_user
     and a.client_attempt_key = p_client_attempt_key;
  if found then
    if (v_attempt.activity_id, v_attempt.source_ref, v_attempt.definition_version, v_attempt.resolver_version)
       is distinct from (p_activity_id, p_source_ref, p_definition_version, p_resolver_version) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status', 'ALREADY_PROCESSED',
      'attempt', private.world_activity_attempt_json_v1(v_attempt)
    );
  end if;

  -- Expire stale ACTIVE rows before enforcing one active attempt per semantic source.
  select * into v_attempt
    from private.world_activity_attempts a
   where a.user_id = p_user
     and a.activity_id = p_activity_id
     and a.source_ref = p_source_ref
     and a.status = 'ACTIVE'
   for update;
  if found and v_attempt.expires_at is not null and v_attempt.expires_at <= now() then
    update private.world_activity_attempts a
       set status = 'EXPIRED',
           outcome_type = 'EXPIRED',
           finalized_at = now()
     where a.attempt_id = v_attempt.attempt_id;
    v_attempt := null;
  end if;

  select * into v_attempt
    from private.world_activity_attempts a
   where a.user_id = p_user
     and a.activity_id = p_activity_id
     and a.source_ref = p_source_ref
     and a.status in ('CREATED','ACTIVE')
   limit 1;
  if found then
    return jsonb_build_object(
      'status', 'ATTEMPT_ALREADY_ACTIVE',
      'attempt', private.world_activity_attempt_json_v1(v_attempt)
    );
  end if;

  insert into private.world_activity_attempts(
    user_id, activity_id, source_ref, client_attempt_key, status,
    definition_version, resolver_version, activated_at, expires_at)
  values (
    p_user, p_activity_id, p_source_ref, p_client_attempt_key, 'ACTIVE',
    p_definition_version, p_resolver_version, now(), p_expires_at)
  returning * into v_attempt;

  return jsonb_build_object(
    'status', 'STARTED',
    'attempt', private.world_activity_attempt_json_v1(v_attempt)
  );
end;
$$;
revoke all on function private.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.world_activity_finalize_v1(
  p_user uuid,
  p_attempt_id uuid,
  p_terminal_status text,
  p_outcome_type text,
  p_result_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.world_activity_attempts%rowtype;
begin
  if p_attempt_id is null then
    raise exception 'INVALID_ATTEMPT_ID' using errcode = '22023';
  end if;
  if p_terminal_status not in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    raise exception 'INVALID_TERMINAL_STATUS' using errcode = '22023';
  end if;
  if p_outcome_type is null or p_outcome_type !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'INVALID_OUTCOME_TYPE' using errcode = '22023';
  end if;
  if p_terminal_status = 'SUCCEEDED' then
    if p_result_ref is null
       or p_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
      raise exception 'RESULT_REF_REQUIRED' using errcode = '22023';
    end if;
  elsif p_result_ref is not null then
    raise exception 'RESULT_REF_FORBIDDEN' using errcode = '22023';
  end if;
  if not private.world_activity_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text, 0));

  select * into v_attempt
    from private.world_activity_attempts a
   where a.attempt_id = p_attempt_id
     and a.user_id = p_user
   for update;
  if not found then
    raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_attempt.status in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    if (v_attempt.status, v_attempt.outcome_type, v_attempt.result_ref)
       is distinct from (p_terminal_status, p_outcome_type, p_result_ref) then
      raise exception 'OUTCOME_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status', 'ALREADY_PROCESSED',
      'attempt', private.world_activity_attempt_json_v1(v_attempt)
    );
  end if;

  if v_attempt.status <> 'ACTIVE' then
    raise exception 'INVALID_ATTEMPT_STATE' using errcode = 'P0001';
  end if;

  if v_attempt.expires_at is not null and v_attempt.expires_at <= now() then
    update private.world_activity_attempts a
       set status = 'EXPIRED',
           outcome_type = 'EXPIRED',
           finalized_at = now()
     where a.attempt_id = p_attempt_id
    returning * into v_attempt;
    return jsonb_build_object(
      'status', 'STALE_ATTEMPT',
      'attempt', private.world_activity_attempt_json_v1(v_attempt)
    );
  end if;

  update private.world_activity_attempts a
     set status = p_terminal_status,
         outcome_type = p_outcome_type,
         result_ref = p_result_ref,
         finalized_at = now()
   where a.attempt_id = p_attempt_id
  returning * into v_attempt;

  return jsonb_build_object(
    'status', 'SUCCESS',
    'attempt', private.world_activity_attempt_json_v1(v_attempt)
  );
end;
$$;
revoke all on function private.world_activity_finalize_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.world_activity_start_v1(
  p_user uuid,
  p_activity_id text,
  p_source_ref text,
  p_client_attempt_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_expires_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_activity_start_v1(
    p_user, p_activity_id, p_source_ref, p_client_attempt_key,
    p_definition_version, p_resolver_version, p_expires_at);
end;
$$;

create or replace function public.world_activity_finalize_v1(
  p_user uuid,
  p_attempt_id uuid,
  p_terminal_status text,
  p_outcome_type text,
  p_result_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_activity_finalize_v1(
    p_user, p_attempt_id, p_terminal_status, p_outcome_type, p_result_ref);
end;
$$;

revoke execute on function public.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_activity_finalize_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamptz)
  to service_role;
grant execute on function public.world_activity_finalize_v1(uuid,uuid,text,text,text)
  to service_role;

-- Player-facing read/resume RPCs are intentionally deferred to the thin Activity Client phase.
-- M2 keeps the persistent attempt authority server-only so the public authenticated API surface
-- does not widen before the client/account-generation contract is implemented.
