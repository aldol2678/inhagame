-- INHA WORLD Combat Authority P0.
-- Establishes server-owned encounter lifecycle + reconnectable state snapshots without activating combat.
-- Combat owns encounter resolution only. It does NOT own Player EXP, Life XP, Creature XP,
-- Reward, Wallet, Inventory, loot settlement or equipment ownership.

create table if not exists private.world_combat_definition_catalog (
  combat_id text primary key
    check (combat_id ~ '^combat\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(combat_id) <= 120),
  category text not null check (category ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  availability text not null check (availability in ('SAFE','CONDITIONAL','ACTIVE')),
  availability_ref text not null
    check (availability_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
      and char_length(availability_ref) <= 160),
  resolver_ref text not null
    check (resolver_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
      and char_length(resolver_ref) <= 160),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1),
  outcome_schema_version integer not null check (outcome_schema_version >= 1)
);
comment on table private.world_combat_definition_catalog is
  'Write-authority mirror of Combat code definitions. P0 intentionally seeds no encounter identities.';

create table if not exists private.world_combat_encounters (
  encounter_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  combat_id text not null references private.world_combat_definition_catalog(combat_id),
  source_ref text not null
    check (source_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
      and char_length(source_ref) <= 160),
  client_encounter_key uuid not null unique,
  definition_version integer not null check (definition_version >= 1),
  resolver_version integer not null check (resolver_version >= 1),
  status text not null check (status in (
    'CREATED','ACTIVE','SUCCEEDED','FAILED','CANCELLED','EXPIRED'
  )),
  result_ref text check (
    result_ref is null or (
      result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      and char_length(result_ref) <= 200
    )
  ),
  state_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state_payload) = 'object' and octet_length(state_payload::text) <= 8192),
  state_version bigint not null default 0 check (state_version >= 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint world_combat_encounters_terminal_shape check (
    (status = 'SUCCEEDED' and result_ref is not null and finalized_at is not null)
    or
    (status in ('FAILED','CANCELLED','EXPIRED') and result_ref is null and finalized_at is not null)
    or
    (status in ('CREATED','ACTIVE') and result_ref is null and finalized_at is null)
  )
);
comment on table private.world_combat_encounters is
  'Server-owned Combat encounter session and reconnectable resolver state. No reward/EXP settlement lives here.';

create index if not exists world_combat_encounters_user_started_idx
  on private.world_combat_encounters(user_id,started_at desc);

alter table private.world_combat_definition_catalog enable row level security;
alter table private.world_combat_encounters enable row level security;
revoke all on table private.world_combat_definition_catalog,
  private.world_combat_encounters
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_account_ok_v1(p_user uuid)
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
revoke all on function private.world_combat_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_encounter_json_v1(
  p_encounter private.world_combat_encounters)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'encounterId',p_encounter.encounter_id,
    'userId',p_encounter.user_id,
    'combatId',p_encounter.combat_id,
    'sourceRef',p_encounter.source_ref,
    'definitionVersion',p_encounter.definition_version,
    'resolverVersion',p_encounter.resolver_version,
    'status',p_encounter.status,
    'resultRef',p_encounter.result_ref,
    'state',p_encounter.state_payload,
    'stateVersion',p_encounter.state_version,
    'startedAt',p_encounter.started_at,
    'updatedAt',p_encounter.updated_at,
    'finalizedAt',p_encounter.finalized_at
  );
$$;
revoke all on function private.world_combat_encounter_json_v1(private.world_combat_encounters)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_start_v1(
  p_user uuid,
  p_combat_id text,
  p_source_ref text,
  p_client_encounter_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_initial_state jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_definition private.world_combat_definition_catalog%rowtype;
  v_encounter private.world_combat_encounters%rowtype;
begin
  if p_combat_id is null
     or p_combat_id !~ '^combat\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
     or char_length(p_combat_id) > 120 then
    raise exception 'INVALID_COMBAT_ID' using errcode = '22023';
  end if;
  if p_source_ref is null
     or p_source_ref !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
     or char_length(p_source_ref) > 160 then
    raise exception 'INVALID_SOURCE_REF' using errcode = '22023';
  end if;
  if p_client_encounter_key is null then
    raise exception 'INVALID_CLIENT_ENCOUNTER_KEY' using errcode = '22023';
  end if;
  if p_definition_version is null or p_definition_version < 1
     or p_resolver_version is null or p_resolver_version < 1 then
    raise exception 'INVALID_VERSION' using errcode = '22023';
  end if;
  if p_initial_state is null
     or jsonb_typeof(p_initial_state) <> 'object'
     or octet_length(p_initial_state::text) > 8192 then
    raise exception 'INVALID_COMBAT_STATE' using errcode = '22023';
  end if;
  if not private.world_combat_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_combat:' || p_user::text,0));

  select * into v_encounter
    from private.world_combat_encounters e
   where e.client_encounter_key = p_client_encounter_key;
  if found then
    if (v_encounter.user_id,v_encounter.combat_id,v_encounter.source_ref,
        v_encounter.definition_version,v_encounter.resolver_version)
       is distinct from
       (p_user,p_combat_id,p_source_ref,p_definition_version,p_resolver_version) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'encounter',private.world_combat_encounter_json_v1(v_encounter)
    );
  end if;

  if exists (
    select 1
      from private.world_combat_encounters e
     where e.user_id = p_user
       and e.status in ('CREATED','ACTIVE')
  ) then
    raise exception 'COMBAT_ALREADY_ACTIVE' using errcode = 'P0001';
  end if;

  select * into v_definition
    from private.world_combat_definition_catalog d
   where d.combat_id = p_combat_id;
  if not found then
    raise exception 'COMBAT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_definition.status <> 'ACTIVE' then
    raise exception 'COMBAT_INACTIVE' using errcode = 'P0001';
  end if;
  if v_definition.availability = 'SAFE' then
    raise exception 'COMBAT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_definition.definition_version <> p_definition_version then
    raise exception 'COMBAT_DEFINITION_VERSION_MISMATCH' using errcode = 'P0001';
  end if;

  insert into private.world_combat_encounters(
    user_id,combat_id,source_ref,client_encounter_key,definition_version,
    resolver_version,status,state_payload,state_version)
  values (
    p_user,p_combat_id,p_source_ref,p_client_encounter_key,p_definition_version,
    p_resolver_version,'ACTIVE',p_initial_state,0)
  returning * into v_encounter;

  return jsonb_build_object(
    'status','SUCCESS',
    'encounter',private.world_combat_encounter_json_v1(v_encounter)
  );
end;
$$;
revoke all on function private.world_combat_start_v1(uuid,text,text,uuid,integer,integer,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_state_write_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_expected_version bigint,
  p_state jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
begin
  if p_encounter_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_COMBAT_STATE_WRITE' using errcode = '22023';
  end if;
  if p_state is null
     or jsonb_typeof(p_state) <> 'object'
     or octet_length(p_state::text) > 8192 then
    raise exception 'INVALID_COMBAT_STATE' using errcode = '22023';
  end if;
  if not private.world_combat_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_encounter
    from private.world_combat_encounters e
   where e.encounter_id = p_encounter_id
     and e.user_id = p_user
   for update;
  if not found then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_encounter.status <> 'ACTIVE' then
    raise exception 'COMBAT_ENCOUNTER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_encounter.state_version <> p_expected_version then
    raise exception 'COMBAT_STATE_VERSION_CONFLICT' using errcode = '40001';
  end if;

  update private.world_combat_encounters e
     set state_payload = p_state,
         state_version = e.state_version + 1,
         updated_at = now()
   where e.encounter_id = p_encounter_id
  returning * into v_encounter;

  return jsonb_build_object(
    'status','SUCCESS',
    'encounter',private.world_combat_encounter_json_v1(v_encounter)
  );
end;
$$;
revoke all on function private.world_combat_state_write_v1(uuid,uuid,bigint,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_snapshot_v1(
  p_user uuid,
  p_encounter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
begin
  if not private.world_combat_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_encounter
    from private.world_combat_encounters e
   where e.encounter_id = p_encounter_id
     and e.user_id = p_user;
  if not found then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode = 'P0002';
  end if;

  return private.world_combat_encounter_json_v1(v_encounter);
end;
$$;
revoke all on function private.world_combat_snapshot_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_finalize_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_terminal_status text,
  p_result_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
begin
  if p_terminal_status not in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    raise exception 'INVALID_TERMINAL_STATUS' using errcode = '22023';
  end if;
  if p_terminal_status = 'SUCCEEDED' then
    if p_result_ref is null
       or p_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
       or char_length(p_result_ref) > 200 then
      raise exception 'RESULT_REF_REQUIRED' using errcode = '22023';
    end if;
  elsif p_result_ref is not null then
    raise exception 'RESULT_REF_FORBIDDEN' using errcode = '22023';
  end if;
  if not private.world_combat_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_combat:' || p_user::text,0));

  select * into v_encounter
    from private.world_combat_encounters e
   where e.encounter_id = p_encounter_id
     and e.user_id = p_user
   for update;
  if not found then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_encounter.status in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    if (v_encounter.status,v_encounter.result_ref)
       is distinct from (p_terminal_status,p_result_ref) then
      raise exception 'COMBAT_OUTCOME_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'encounter',private.world_combat_encounter_json_v1(v_encounter)
    );
  end if;
  if v_encounter.status <> 'ACTIVE' then
    raise exception 'COMBAT_ENCOUNTER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  update private.world_combat_encounters e
     set status = p_terminal_status,
         result_ref = p_result_ref,
         finalized_at = now(),
         updated_at = now()
   where e.encounter_id = p_encounter_id
  returning * into v_encounter;

  return jsonb_build_object(
    'status','SUCCESS',
    'encounter',private.world_combat_encounter_json_v1(v_encounter)
  );
end;
$$;
revoke all on function private.world_combat_finalize_v1(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.world_combat_start_v1(
  p_user uuid,
  p_combat_id text,
  p_source_ref text,
  p_client_encounter_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_initial_state jsonb default '{}'::jsonb)
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
  return private.world_combat_start_v1(
    p_user,p_combat_id,p_source_ref,p_client_encounter_key,
    p_definition_version,p_resolver_version,p_initial_state);
end;
$$;

create or replace function public.world_combat_state_write_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_expected_version bigint,
  p_state jsonb)
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
  return private.world_combat_state_write_v1(
    p_user,p_encounter_id,p_expected_version,p_state);
end;
$$;

create or replace function public.world_combat_snapshot_v1(
  p_user uuid,
  p_encounter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_combat_snapshot_v1(p_user,p_encounter_id);
end;
$$;

create or replace function public.world_combat_finalize_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_terminal_status text,
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
  return private.world_combat_finalize_v1(
    p_user,p_encounter_id,p_terminal_status,p_result_ref);
end;
$$;

revoke execute on function public.world_combat_start_v1(uuid,text,text,uuid,integer,integer,jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_combat_state_write_v1(uuid,uuid,bigint,jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_combat_snapshot_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_combat_finalize_v1(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.world_combat_start_v1(uuid,text,text,uuid,integer,integer,jsonb)
  to service_role;
grant execute on function public.world_combat_state_write_v1(uuid,uuid,bigint,jsonb)
  to service_role;
grant execute on function public.world_combat_snapshot_v1(uuid,uuid)
  to service_role;
grant execute on function public.world_combat_finalize_v1(uuid,uuid,text,text)
  to service_role;
